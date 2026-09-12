import * as btc from '@scure/btc-signer';
import { base64, hex } from '@scure/base';
import QRCode from 'qrcode';
import {
  parseCosignerXpub, assertNoDuplicateCosigners, buildMultisigDescriptor, parseMultisigDescriptor,
} from './lib/descriptor.js';
import { createProvider, btcNetwork, fetchFeeEstimates, fetchUtxosForAddresses } from './lib/network.js';
import {
  scanMultisigWallet, firstUnusedReceiveAddress, firstUnusedChangeAddress, RECEIVE_CHAIN,
} from './lib/scan.js';
import { annotateUtxosForSpend, buildSpendTx } from './lib/txbuilder.js';
import {
  decodePsbt, encodePsbt, combineSignedPsbt, signatureProgress, describeSpend, finalizeSpend,
} from './lib/psbtcoordinate.js';
import { encodeToQrParts, decodeQrParts, looksLikeBbqrPart } from './lib/qrtransport.js';
import { QrScanner } from './lib/qrscanner.js';
import { t, DEFAULT_LANG } from './lib/i18n.js';

const $ = (id) => document.getElementById(id);
const SCREENS = ['setup', 'scan', 'dashboard', 'send'];

const state = {
  isTestnet: true,
  network: btcNetwork(true),
  lang: DEFAULT_LANG,
  mode: 'manual', // 'manual' | 'descriptor'
  n: 3,
  wallet: null, // { m, n, cosigners: [{name, fingerprint, path, xpub, node}], addresses, totalBalance }
  showAllAddresses: false,
  send: null, // { feeRates, builtTx, unsignedPsbtB64, collectingTx }
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

// ---------- QR scanner (shared across setup + collect-signatures) ----------

let qrScanner = null;
let scanCollected = null;
let scanOnComplete = null;

// Everything the camera feeds in is untrusted: whatever happens to be on the
// screen or paper being pointed at. BBQr's own header caps a sequence at
// 'zz' base36 = 1296 parts, and each QR tops out around 3KB of payload, so
// anything past these bounds is not a real sequence being scanned - it's a
// stream of junk (or a hostile display) that would otherwise grow the
// collected set without limit.
const MAX_QR_PARTS = 1296;
const MAX_QR_TOTAL_CHARS = 1296 * 4096;

function openQrScanner(onComplete) {
  scanCollected = new Map(); // part index -> raw part text
  scanOnComplete = onComplete;
  setError('qr-scanner-error', null);
  $('qr-scanner-status').textContent = tr('qr.scanner.waiting');
  $('qr-scanner-overlay').hidden = false;
  if (!qrScanner) qrScanner = new QrScanner($('qr-scanner-video'));
  qrScanner.start(handleQrDecoded).catch((err) => {
    setError('qr-scanner-error', tr('error.cameraFailed', { msg: err.message }));
  });
}

function closeQrScanner() {
  if (qrScanner) qrScanner.stop();
  $('qr-scanner-overlay').hidden = true;
  scanCollected = null;
  scanOnComplete = null;
}

function handleQrDecoded(text) {
  if (!looksLikeBbqrPart(text)) {
    finishQrScan(text);
    return;
  }
  // BBQr header: "B$" + encoding + fileType + total(2, base36) + index(2, base36).
  const total = parseInt(text.slice(4, 6), 36);
  const partIndex = parseInt(text.slice(6, 8), 36);
  if (!Number.isFinite(total) || !Number.isFinite(partIndex) || total < 1 || total > MAX_QR_PARTS
      || partIndex < 0 || partIndex >= total) {
    setError('qr-scanner-error', tr('error.qrDecodeFailed', { msg: 'cabecera BBQr invalida' }));
    return;
  }

  // Key by part index, not by raw string: two slightly different reads of the
  // same part must not both count toward "we have them all".
  scanCollected.set(partIndex, text);

  let totalChars = 0;
  for (const part of scanCollected.values()) totalChars += part.length;
  if (totalChars > MAX_QR_TOTAL_CHARS) {
    setError('qr-scanner-error', tr('error.qrDecodeFailed', { msg: 'secuencia demasiado grande' }));
    scanCollected.clear();
    return;
  }

  $('qr-scanner-status').textContent = tr('qr.scanner.progress', {
    n: scanCollected.size, total,
  });
  if (scanCollected.size >= total) {
    try {
      const ordered = [...scanCollected.entries()].sort((a, b) => a[0] - b[0]).map(([, part]) => part);
      const decoded = decodeQrParts(ordered);
      finishQrScan(decoded);
    } catch (err) {
      setError('qr-scanner-error', tr('error.qrDecodeFailed', { msg: err.message }));
      scanCollected.clear();
    }
  }
}

function finishQrScan(text) {
  const onComplete = scanOnComplete;
  closeQrScanner();
  if (onComplete) onComplete(text);
}

function initQrScanner() {
  $('qr-scanner-cancel-btn').addEventListener('click', closeQrScanner);
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
          <div class="file-load-row">
            <button type="button" class="btn-secondary f-scan" data-i18n="qr.scan.button">📷 Escanear</button>
          </div>
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

  $('cosigner-list').addEventListener('click', (ev) => {
    const btn = ev.target.closest('.f-scan');
    if (!btn) return;
    const card = btn.closest('.cosigner-card');
    openQrScanner((text) => {
      card.querySelector('.f-xpub').value = text;
    });
  });

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
  $('descriptor-scan-btn').addEventListener('click', () => {
    openQrScanner((text) => { $('descriptor-input').value = text; });
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
      node: parseCosignerXpub(c.xpub, c.path, state.isTestnet),
    }));
    assertNoDuplicateCosigners(cosigners);
    return { m: parsed.m, cosigners, checksumVerified: parsed.checksumVerified };
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
      node: parseCosignerXpub(c.xpub.trim(), c.path.trim(), state.isTestnet),
    };
  });

  assertNoDuplicateCosigners(cosigners);

  return { m, cosigners, checksumVerified: true }; // manual entry has no descriptor checksum to speak of
}

// ---------- Scan ----------

function chainLabel(chain) {
  return tr(chain === RECEIVE_CHAIN ? 'scan.chain.receive' : 'scan.chain.change');
}

async function startScan({ m, cosigners, checksumVerified = true }) {
  showScreen('scan');
  const progressEl = $('scan-progress');
  try {
    const provider = createProvider(state.isTestnet);
    const nodes = cosigners.map((c) => c.node);
    const { addresses, totalBalance } = await scanMultisigWallet(nodes, m, state.network, provider, ({ chain, index }) => {
      progressEl.textContent = tr('scan.progress', { chainLabel: chainLabel(chain), index });
    });
    state.wallet = { m, n: cosigners.length, cosigners, addresses, totalBalance, checksumVerified };
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
  if (!next) {
    // Shouldn't happen under normal scanning (see scan.js's comment on
    // firstUnusedOnChain), but clear stale content rather than silently
    // leaving a previous wallet's address on screen if it ever does.
    $('receive-address').textContent = '';
    $('receive-qr').hidden = true;
    return;
  }
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
  const { m, n, totalBalance, checksumVerified } = state.wallet;
  $('dashboard-quorum-badge').textContent = tr('dashboard.quorum', { m, n });
  $('dashboard-balance').textContent = `${fmtBtc(totalBalance)} BTC`;
  $('dashboard-send-btn').disabled = totalBalance <= 0n;
  // A descriptor pasted without its "#checksum" is still accepted (some
  // tools omit it, or a human retypes it by hand) - but with no checksum, a
  // single altered/mistyped character in the body is indistinguishable from
  // a correct one, and this descriptor alone determines every address this
  // wallet will ever recognize as its own. Stays visible for the whole
  // session rather than a one-time dismissible notice, since the risk
  // (funding an address derived from a silently-wrong descriptor) doesn't
  // go away once the wallet screen loads.
  $('dashboard-checksum-warning').hidden = checksumVerified !== false;
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
  $('dashboard-send-btn').addEventListener('click', () => { startSendFlow(); });

  $('dashboard-update-btn').addEventListener('click', async () => {
    if (!state.wallet) return;
    await startScan({ m: state.wallet.m, cosigners: state.wallet.cosigners, checksumVerified: state.wallet.checksumVerified });
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

// ---------- Send: build ----------

function showSendPanels(names) {
  const all = ['send-build-panel', 'send-review-panel', 'send-export-panel', 'send-collect-panel', 'send-result-panel'];
  for (const id of all) $(id).hidden = !names.includes(id);
}

async function startSendFlow() {
  if (!state.wallet) return;
  stopQrAnimation();
  state.send = { feeRates: null, builtTx: null, unsignedPsbtB64: null, collectingTx: null };
  $('send-build-form').reset();
  $('send-amount').disabled = false;
  setError('send-build-error', null);
  for (const key of ['fast', 'medium', 'economy']) $(`fee-${key}-value`).textContent = '...';
  showSendPanels(['send-build-panel']);
  showScreen('send');

  try {
    const provider = createProvider(state.isTestnet);
    const feeRates = await fetchFeeEstimates(provider);
    state.send.feeRates = feeRates;
    for (const key of ['fast', 'medium', 'economy']) {
      $(`fee-${key}-value`).textContent = feeRates[key] !== null ? `${feeRates[key]} ${tr('send.fee.unit')}` : '';
    }
  } catch {
    // Fee estimates are a convenience; the custom-fee field still works if this fails.
    for (const key of ['fast', 'medium', 'economy']) $(`fee-${key}-value`).textContent = '';
  }
}

function feePerByteFromForm() {
  const choice = document.querySelector('input[name="fee-choice"]:checked')?.value ?? 'medium';
  if (choice === 'custom') {
    const raw = $('fee-custom-input').value.trim();
    const n = Number(raw);
    if (!raw || !Number.isFinite(n) || n <= 0) throw new Error('Tarifa personalizada invalida.');
    return BigInt(Math.round(n));
  }
  const fromEstimate = state.send?.feeRates?.[choice];
  // fetchFeeEstimates (network.js) returns null per-tier when its own
  // request failed - silently substituting a guessed rate here would build
  // a transaction at a fee the user never actually chose, with nothing on
  // screen to say so. Fail loudly instead: the form's own error banner
  // already surfaces whatever this throws, and "usá una tarifa
  // personalizada" is a real, always-available way forward.
  if (!fromEstimate) {
    throw new Error(
      'No se pudo obtener una estimacion de comision para esta opcion. Reintenta, o usa "Personalizada" con un valor en sats/vB.'
    );
  }
  return fromEstimate;
}

function initSendBuildPanel() {
  $('send-max-checkbox').addEventListener('change', () => {
    $('send-amount').disabled = $('send-max-checkbox').checked;
  });

  $('send-cancel-btn').addEventListener('click', () => {
    stopQrAnimation();
    state.send = null;
    showScreen('dashboard');
  });

  $('send-build-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    setError('send-build-error', null);
    try {
      const destinationAddress = $('send-destination').value.trim();
      if (!destinationAddress) throw new Error('Falta la direccion de destino.');
      const sendMax = $('send-max-checkbox').checked;
      let amountSats = 0n;
      if (!sendMax) {
        const raw = $('send-amount').value.trim();
        if (!raw || Number(raw) <= 0) throw new Error('Monto invalido.');
        amountSats = btc.Decimal.decode(raw);
      }
      const feePerByte = feePerByteFromForm();

      const fundedEntries = state.wallet.addresses.filter((a) => a.balance > 0n);
      if (!fundedEntries.length) throw new Error('Esta wallet no tiene UTXOs para gastar.');
      const provider = createProvider(state.isTestnet);
      const rawUtxos = await fetchUtxosForAddresses(provider, fundedEntries);
      const utxos = annotateUtxosForSpend(rawUtxos, state.wallet, state.network);

      const changeEntry = firstUnusedChangeAddress(state.wallet.addresses);
      if (!changeEntry) {
        throw new Error(
          'No se encontro una direccion de cambio sin usar - esto no deberia pasar; probá "Actualizar" en el dashboard para re-escanear la wallet.'
        );
      }
      const built = buildSpendTx({
        wallet: state.wallet, utxos, destinationAddress, amountSats, feePerByte,
        changeEntry, network: state.network, sendMax,
      });
      if (!built) throw new Error(tr('error.insufficientFunds'));

      state.send.builtTx = built.tx;
      state.send.changeScript = built.changeScript ?? null; // absent for "send all" - no change output exists
      renderSendReview(built.tx, state.send.changeScript);
      showSendPanels(['send-review-panel']);
    } catch (err) {
      setError('send-build-error', tr('error.sendBuildFailed', { msg: err.message }));
    }
  });
}

// ---------- Send: review + export ----------

function renderSendReview(tx, changeScript) {
  const summary = describeSpend(tx, state.network, changeScript);
  $('review-inputs-total').textContent = `${fmtBtc(summary.inputsTotal)} BTC`;
  $('review-outputs-total').textContent = `${fmtBtc(summary.outputsTotal)} BTC`;
  $('review-fee').textContent = `${fmtBtc(summary.fee)} BTC`;

  const list = $('review-outputs');
  list.innerHTML = '';
  for (const output of summary.outputs) {
    const li = document.createElement('li');
    li.className = 'output-row';
    const address = output.address ?? '';
    li.innerHTML = `
      <span class="output-address">${address}${output.isChange ? `<span class="output-change-tag">${tr('send.review.change')}</span>` : ''}</span>
      <span class="output-amount">${fmtBtc(output.amount)} BTC</span>
    `;
    list.appendChild(li);
  }

  const warningEl = $('review-fee-warning');
  const ackWrap = $('review-fee-ack-wrap');
  warningEl.hidden = !summary.feeWarning;
  ackWrap.hidden = !summary.feeWarning;
  $('review-fee-ack-checkbox').checked = false;
  syncSendExportButton();
}

function syncSendExportButton() {
  const needsAck = !$('review-fee-ack-wrap').hidden;
  $('send-export-btn').disabled = needsAck && !$('review-fee-ack-checkbox').checked;
}

// ---------- Animated (BBQr) QR export ----------
// A single-sig PSBT with one or two inputs usually fits one QR; a real
// multisig PSBT - witnessScript + one bip32Derivation per cosigner on every
// input, plus the change output - regularly does not. BBQr (Coldcard's
// format, also read by Sparrow/other coordinators) splits it across several
// QR frames that this cycles through automatically instead of silently
// hiding the code once it no longer fits in one.
let qrAnimationTimer = null;

function stopQrAnimation() {
  if (qrAnimationTimer) clearInterval(qrAnimationTimer);
  qrAnimationTimer = null;
}

async function renderAnimatedQr(imgEl, labelEl, bytes, fileType) {
  stopQrAnimation();
  let parts;
  try {
    parts = encodeToQrParts(bytes, fileType);
  } catch {
    imgEl.hidden = true;
    labelEl.textContent = '';
    return;
  }
  const frames = (await Promise.all(
    parts.map((part) => QRCode.toDataURL(part, { margin: 1, width: 240 }).catch(() => null))
  )).filter(Boolean);
  if (!frames.length) {
    imgEl.hidden = true;
    labelEl.textContent = '';
    return;
  }
  let i = 0;
  imgEl.src = frames[0];
  imgEl.hidden = false;
  labelEl.textContent = frames.length > 1 ? tr('qr.animated.part', { n: 1, total: frames.length }) : '';
  if (frames.length > 1) {
    qrAnimationTimer = setInterval(() => {
      i = (i + 1) % frames.length;
      imgEl.src = frames[i];
      labelEl.textContent = tr('qr.animated.part', { n: i + 1, total: frames.length });
    }, 600);
  }
}

async function renderUnsignedExport() {
  const psbtB64 = encodePsbt(state.send.builtTx);
  state.send.unsignedPsbtB64 = psbtB64;
  $('send-unsigned-psbt').value = psbtB64;
  await renderAnimatedQr($('send-unsigned-qr'), $('send-unsigned-qr-label'), base64.decode(psbtB64), 'P');
}

function renderSendProgress() {
  const { collectingTx } = state.send;
  const { perInput, ready } = signatureProgress(collectingTx, state.wallet.m);
  const list = $('send-progress-list');
  list.innerHTML = '';
  for (const row of perInput) {
    const li = document.createElement('li');
    li.className = `address-row progress-row${row.finalized || row.count >= state.wallet.m ? ' progress-done' : ''}`;
    const text = row.finalized || row.count >= state.wallet.m
      ? tr('send.collect.progress.done', { i: row.index })
      : tr('send.collect.progress.input', { i: row.index, count: row.count, m: state.wallet.m });
    li.innerHTML = `<span>${text}</span>`;
    list.appendChild(li);
  }
  $('send-finalize-btn').disabled = !ready;
  return ready;
}

function initSendReviewPanel() {
  $('review-fee-ack-checkbox').addEventListener('change', syncSendExportButton);

  $('send-review-cancel-btn').addEventListener('click', () => {
    stopQrAnimation();
    state.send = null;
    showScreen('dashboard');
  });

  $('send-export-btn').addEventListener('click', async () => {
    await renderUnsignedExport();
    state.send.collectingTx = decodePsbt(state.send.unsignedPsbtB64);
    $('send-signed-input').value = '';
    setError('send-collect-error', null);
    renderSendProgress();
    showSendPanels(['send-export-panel', 'send-collect-panel']);
  });

  $('send-unsigned-copy-btn').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('send-unsigned-psbt').value);
      flashButton('send-unsigned-copy-btn', tr('send.export.copied'));
    } catch { /* clipboard may be unavailable; text is selectable regardless */ }
  });

  $('send-unsigned-download-btn').addEventListener('click', () => {
    downloadText('multisig-unsigned-psbt.txt', $('send-unsigned-psbt').value);
  });
}

function flashButton(id, tempText) {
  const btnEl = $(id);
  const original = btnEl.textContent;
  btnEl.textContent = tempText;
  setTimeout(() => { btnEl.textContent = original; }, 1500);
}

// ---------- Send: collect signatures + finalize ----------

function initSendCollectPanel() {
  const fileInput = $('send-signed-file-input');
  $('send-signed-file-btn').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      $('send-signed-input').value = text.trim();
    } catch (err) {
      setError('send-collect-error', tr('error.fileReadFailed', { msg: err.message }));
    }
  });

  $('send-collect-add-btn').addEventListener('click', () => {
    setError('send-collect-error', null);
    try {
      const incoming = decodePsbt($('send-signed-input').value);
      state.send.collectingTx = combineSignedPsbt(state.send.collectingTx, incoming);
      $('send-signed-input').value = '';
      renderSendProgress();
    } catch (err) {
      setError('send-collect-error', tr('error.collectFailed', { msg: err.message }));
    }
  });

  $('send-signed-scan-btn').addEventListener('click', () => {
    openQrScanner((text) => { $('send-signed-input').value = text; });
  });

  $('send-collect-back-btn').addEventListener('click', () => {
    stopQrAnimation();
    state.send = null;
    showScreen('dashboard');
  });

  $('send-finalize-btn').addEventListener('click', async () => {
    setError('send-collect-error', null);
    try {
      const result = finalizeSpend(state.send.collectingTx, state.wallet.m);
      $('send-result-txid').textContent = result.txid;
      $('send-result-hex').value = result.hex;
      await renderAnimatedQr($('send-result-qr'), $('send-result-qr-label'), hex.decode(result.hex), 'T');
      showSendPanels(['send-result-panel']);
    } catch (err) {
      setError('send-collect-error', tr('error.finalizeFailed', { msg: err.message }));
    }
  });
}

function initSendResultPanel() {
  $('send-result-copy-btn').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('send-result-hex').value);
      flashButton('send-result-copy-btn', tr('send.export.copied'));
    } catch { /* clipboard may be unavailable; text is selectable regardless */ }
  });

  $('send-result-download-btn').addEventListener('click', () => {
    downloadText('multisig-signed-tx.txt', $('send-result-hex').value);
  });

  $('send-result-back-btn').addEventListener('click', async () => {
    stopQrAnimation();
    state.send = null;
    await startScan({ m: state.wallet.m, cosigners: state.wallet.cosigners, checksumVerified: state.wallet.checksumVerified });
  });
}

function initSendScreen() {
  initSendBuildPanel();
  initSendReviewPanel();
  initSendCollectPanel();
  initSendResultPanel();
}

// ---------- Boot ----------

function init() {
  initTopbar();
  initQrScanner();
  initSetupScreen();
  initDashboardScreen();
  initSendScreen();
  applyTranslations();
  showScreen('setup');
}

init();
