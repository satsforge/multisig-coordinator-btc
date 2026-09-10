import * as btc from '@scure/btc-signer';
import QRCode from 'qrcode';
import {
  parseExtendedPubkey, buildMultisigDescriptor, parseMultisigDescriptor,
} from './lib/descriptor.js';
import { createProvider, btcNetwork } from './lib/network.js';
import { scanMultisigWallet, firstUnusedReceiveAddress, RECEIVE_CHAIN } from './lib/scan.js';
import { t, DEFAULT_LANG } from './lib/i18n.js';

const $ = (id) => document.getElementById(id);
const SCREENS = ['setup', 'scan', 'dashboard'];

const state = {
  isTestnet: true,
  network: btcNetwork(true),
  lang: DEFAULT_LANG,
  mode: 'manual', // 'manual' | 'descriptor'
  n: 3,
  wallet: null, // { m, n, cosigners: [{name, fingerprint, path, xpub, node}], addresses, totalBalance }
  showAllAddresses: false,
};

function tr(key, vars) {
  return t(key, state.lang, vars);
}

function showScreen(name) {
  for (const s of SCREENS) $(`screen-${s}`).hidden = s !== name;
}

function fmtBtc(sats) {
  return btc.Decimal.encode(sats);
}

function setError(elId, message) {
  const el = $(elId);
  el.textContent = message ?? '';
  el.hidden = !message;
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---------- Topbar ----------

function updateThemeButtonLabel() {
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  $('theme-toggle').textContent = tr(isLight ? 'topbar.theme.toDark' : 'topbar.theme.toLight');
}

function updateLangButtonLabel() {
  $('lang-toggle').textContent = tr(state.lang === 'es' ? 'topbar.lang.toEnglish' : 'topbar.lang.toSpanish');
}

function updateNetworkBadge() {
  const badge = $('network-badge');
  badge.textContent = tr(state.isTestnet ? 'network.badge.testnet' : 'network.badge.mainnet');
  badge.classList.toggle('badge-testnet', state.isTestnet);
  badge.classList.toggle('badge-mainnet', !state.isTestnet);
}

function applyTranslations() {
  document.documentElement.lang = state.lang;
  document.title = tr('meta.title');
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.innerHTML = tr(el.dataset.i18n); });
  updateThemeButtonLabel();
  updateLangButtonLabel();
  updateNetworkBadge();
  renderCosignerFields(state.n);
  if (state.wallet) renderDashboard();
}

function initTopbar() {
  $('lang-toggle').addEventListener('click', () => {
    state.lang = state.lang === 'es' ? 'en' : 'es';
    applyTranslations();
  });
  $('theme-toggle').addEventListener('click', () => {
    const html = document.documentElement;
    html.setAttribute('data-theme', html.getAttribute('data-theme') === 'light' ? 'dark' : 'light');
    updateThemeButtonLabel();
  });
}

// ---------- Setup: network + quorum + cosigner fields ----------

function defaultPath() {
  return state.isTestnet ? "48'/1'/0'/2'" : "48'/0'/0'/2'";
}

function readCosignerCards() {
  return [...document.querySelectorAll('.cosigner-card')].map((card) => ({
    name: card.querySelector('.f-name').value,
    xpub: card.querySelector('.f-xpub').value,
    fingerprint: card.querySelector('.f-fingerprint').value,
    path: card.querySelector('.f-path').value,
  }));
}

function renderCosignerFields(n) {
  const existing = readCosignerCards();
  const list = $('cosigner-list');
  list.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const prior = existing[i] || {};
    const card = document.createElement('div');
    card.className = 'cosigner-card';
    card.innerHTML = `
      <div class="cosigner-card-title">Cosigner ${i + 1}</div>
      <div class="cosigner-grid">
        <label class="field">
          <span data-i18n="setup.cosigner.name">Nombre</span>
          <input type="text" class="f-name" value="${prior.name ? escapeAttr(prior.name) : `Cosigner ${i + 1}`}">
        </label>
        <label class="field">
          <span data-i18n="setup.cosigner.fingerprint">Fingerprint (8 caracteres hex)</span>
          <input type="text" class="f-fingerprint" maxlength="8" autocomplete="off" spellcheck="false" value="${prior.fingerprint ? escapeAttr(prior.fingerprint) : ''}">
        </label>
        <label class="field field-xpub">
          <span data-i18n="setup.cosigner.xpub">Clave publica extendida (xpub/Zpub/tpub/Vpub...)</span>
          <textarea class="f-xpub" rows="2" autocomplete="off" spellcheck="false">${prior.xpub ? escapeText(prior.xpub) : ''}</textarea>
        </label>
        <label class="field field-xpub">
          <span data-i18n="setup.cosigner.path">Ruta de derivacion</span>
          <input type="text" class="f-path" autocomplete="off" spellcheck="false" value="${prior.path ? escapeAttr(prior.path) : defaultPath()}">
        </label>
      </div>
    `;
    list.appendChild(card);
  }
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    if (list.contains(el)) el.innerHTML = tr(el.dataset.i18n);
  });
}

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
function escapeText(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

function initSetupScreen() {
  const mainnetRadio = $('network-mainnet');
  const testnetRadio = $('network-testnet');
  const mainnetConfirm = $('mainnet-confirm-wrap');
  const mainnetConfirmCheckbox = $('mainnet-confirm-checkbox');

  function syncNetworkUI() {
    mainnetConfirm.hidden = !mainnetRadio.checked;
    $('setup-build-btn').disabled = mainnetRadio.checked && !mainnetConfirmCheckbox.checked;
    state.isTestnet = testnetRadio.checked;
    state.network = btcNetwork(state.isTestnet);
    updateNetworkBadge();
  }
  mainnetRadio.addEventListener('change', syncNetworkUI);
  testnetRadio.addEventListener('change', syncNetworkUI);
  mainnetConfirmCheckbox.addEventListener('change', syncNetworkUI);
  syncNetworkUI();

  const mInput = $('quorum-m');
  const nInput = $('quorum-n');
  nInput.addEventListener('change', () => {
    let n = parseInt(nInput.value, 10);
    if (!Number.isInteger(n) || n < 1) n = 1;
    if (n > 15) n = 15;
    nInput.value = n;
    state.n = n;
    mInput.max = String(n);
    if (parseInt(mInput.value, 10) > n) mInput.value = String(n);
    renderCosignerFields(n);
  });
  renderCosignerFields(state.n);

  $('mode-manual-btn').addEventListener('click', () => setMode('manual'));
  $('mode-descriptor-btn').addEventListener('click', () => setMode('descriptor'));

  function setMode(mode) {
    state.mode = mode;
    $('mode-manual-btn').setAttribute('aria-pressed', String(mode === 'manual'));
    $('mode-descriptor-btn').setAttribute('aria-pressed', String(mode === 'descriptor'));
    $('manual-fields').hidden = mode !== 'manual';
    $('descriptor-fields').hidden = mode !== 'descriptor';
  }

  const descriptorFileInput = $('descriptor-file-input');
  $('descriptor-file-btn').addEventListener('click', () => descriptorFileInput.click());
  descriptorFileInput.addEventListener('change', async () => {
    const file = descriptorFileInput.files[0];
    descriptorFileInput.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      $('descriptor-input').value = text.trim();
    } catch (err) {
      setError('setup-error', tr('error.fileReadFailed', { msg: err.message }));
    }
  });

  $('setup-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    setError('setup-error', null);
    try {
      const built = buildWalletFromForm();
      startScan(built);
    } catch (err) {
      setError('setup-error', tr('error.setupFailed', { msg: err.message }));
    }
  });
}

function buildWalletFromForm() {
  if (state.mode === 'descriptor') {
    const parsed = parseMultisigDescriptor($('descriptor-input').value);
    const cosigners = parsed.cosigners.map((c, i) => ({
      name: `Cosigner ${i + 1}`,
      fingerprint: c.fingerprint,
      path: c.path,
      xpub: c.xpub,
      node: parseExtendedPubkey(c.xpub, state.isTestnet),
    }));
    return { m: parsed.m, cosigners };
  }

  const m = parseInt($('quorum-m').value, 10);
  const raw = readCosignerCards();
  if (!Number.isInteger(m) || m < 1) throw new Error('M invalido.');
  if (m > raw.length) throw new Error(`M (${m}) no puede ser mayor que la cantidad de cosigners (${raw.length}).`);

  const cosigners = raw.map((c, i) => {
    if (!c.xpub.trim()) throw new Error(`Falta la clave publica del cosigner ${i + 1}.`);
    if (!/^[0-9a-fA-F]{8}$/.test(c.fingerprint.trim())) {
      throw new Error(`Fingerprint invalido para el cosigner ${i + 1} (deben ser 8 caracteres hex).`);
    }
    return {
      name: c.name.trim() || `Cosigner ${i + 1}`,
      fingerprint: c.fingerprint.trim().toLowerCase(),
      path: c.path.trim(),
      xpub: c.xpub.trim(),
      node: parseExtendedPubkey(c.xpub, state.isTestnet),
    };
  });

  // Every cosigner's xpub must be genuinely different - repeating one would
  // silently turn an "M-of-N" wallet into something weaker than intended.
  const seen = new Set();
  for (const c of cosigners) {
    if (seen.has(c.xpub)) throw new Error(`La clave publica del cosigner "${c.name}" esta repetida.`);
    seen.add(c.xpub);
  }

  return { m, cosigners };
}

// ---------- Scan ----------

function chainLabel(chain) {
  return tr(chain === RECEIVE_CHAIN ? 'scan.chain.receive' : 'scan.chain.change');
}

async function startScan({ m, cosigners }) {
  showScreen('scan');
  const progressEl = $('scan-progress');
  try {
    const provider = createProvider(state.isTestnet);
    const nodes = cosigners.map((c) => c.node);
    const { addresses, totalBalance } = await scanMultisigWallet(nodes, m, state.network, provider, ({ chain, index }) => {
      progressEl.textContent = tr('scan.progress', { chainLabel: chainLabel(chain), index });
    });
    state.wallet = { m, n: cosigners.length, cosigners, addresses, totalBalance };
    state.showAllAddresses = false;
    renderDashboard();
    showScreen('dashboard');
  } catch (err) {
    setError('setup-error', tr('error.scanFailed', { msg: err.message }));
    showScreen('setup');
  }
}

// ---------- Dashboard ----------

async function renderReceivePanel() {
  const next = firstUnusedReceiveAddress(state.wallet.addresses);
  if (!next) return;
  $('receive-address').textContent = next.address;
  try {
    const dataUrl = await QRCode.toDataURL(next.address, { margin: 1, width: 220 });
    $('receive-qr').src = dataUrl;
    $('receive-qr').hidden = false;
  } catch {
    $('receive-qr').hidden = true;
  }
}

function renderAddressList() {
  const list = $('address-list');
  list.innerHTML = '';
  const addresses = state.showAllAddresses
    ? state.wallet.addresses
    : state.wallet.addresses.filter((a) => a.balance > 0n || a.txCount > 0);

  $('addresses-toggle-btn').textContent = state.showAllAddresses
    ? tr('dashboard.addresses.showFunded')
    : tr('dashboard.addresses.showAll', { n: state.wallet.addresses.length });

  if (!addresses.length) {
    const li = document.createElement('li');
    li.className = 'address-empty';
    li.textContent = tr('dashboard.addresses.empty');
    list.appendChild(li);
    return;
  }
  for (const a of addresses) {
    const li = document.createElement('li');
    li.className = 'address-row';
    const chainName = a.chain === RECEIVE_CHAIN ? tr('dashboard.addresses.receive') : tr('dashboard.addresses.change');
    li.innerHTML = `
      <span class="address-path">${chainName} #${a.index}</span>
      <span class="address-value">${a.address}</span>
      ${a.balance > 0n ? `<span class="address-balance">${fmtBtc(a.balance)} BTC</span>` : ''}
    `;
    list.appendChild(li);
  }
}

function renderDashboard() {
  const { m, n, totalBalance } = state.wallet;
  $('dashboard-quorum-badge').textContent = tr('dashboard.quorum', { m, n });
  $('dashboard-balance').textContent = `${fmtBtc(totalBalance)} BTC`;
  renderReceivePanel();
  renderAddressList();
}

function exportText() {
  const { m, cosigners } = state.wallet;
  const external = buildMultisigDescriptor(m, cosigners, 0);
  const internal = buildMultisigDescriptor(m, cosigners, 1);
  const lines = [
    `# Coordinador Multifirma BTC - ${m}-of-${cosigners.length} (${state.isTestnet ? 'testnet' : 'mainnet'})`,
    '#',
    '# Descriptor externo (recepcion, /0/*):',
    external,
    '#',
    '# Descriptor interno (cambio, /1/*):',
    internal,
    '#',
    '# Cosigners:',
    ...cosigners.map((c, i) => `#   ${i + 1}. ${c.name} - fingerprint ${c.fingerprint} - ruta ${c.path}`),
  ];
  return lines.join('\n') + '\n';
}

function initDashboardScreen() {
  $('dashboard-update-btn').addEventListener('click', async () => {
    if (!state.wallet) return;
    await startScan({ m: state.wallet.m, cosigners: state.wallet.cosigners });
  });

  $('dashboard-new-btn').addEventListener('click', () => {
    state.wallet = null;
    showScreen('setup');
  });

  $('receive-copy-btn').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('receive-address').textContent);
      const btnEl = $('receive-copy-btn');
      const original = btnEl.textContent;
      btnEl.textContent = tr('dashboard.copied');
      setTimeout(() => { btnEl.textContent = original; }, 1500);
    } catch { /* clipboard may be unavailable; text is selectable regardless */ }
  });

  $('export-download-btn').addEventListener('click', () => {
    if (!state.wallet) return;
    downloadText(
      `multisig-${state.wallet.m}-of-${state.wallet.n}-${state.isTestnet ? 'testnet' : 'mainnet'}.txt`,
      exportText()
    );
  });

  $('addresses-toggle-btn').addEventListener('click', () => {
    state.showAllAddresses = !state.showAllAddresses;
    renderAddressList();
  });
}

// ---------- Boot ----------

function init() {
  initTopbar();
  initSetupScreen();
  initDashboardScreen();
  applyTranslations();
  showScreen('setup');
}

init();
