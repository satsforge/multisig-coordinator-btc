import { HDKey } from '@scure/bip32';
import { base58check } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2.js';
import { sortedMultisig } from '@scure/btc-signer';

const b58c = base58check(sha256);

// ---------- BIP380 descriptor checksum ----------
// Reference algorithm from BIP380 ("Output Script Descriptors General
// Operation"). This is a plain transcription of the spec's pseudocode -
// nothing here is specific to multisig, it works on any descriptor string.

const CHECKSUM_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const INPUT_CHARSET =
  "0123456789()[],'/*abcdefgh@:$%{}IJKLMNOPQRSTUVWXYZ&+-.;<=>?!^_|~ijklmnopqrstuvwxyzABCDEFGH`#\"\\ ";
const GENERATOR = [0xf5dee51989n, 0xa9fdca3312n, 0x1bab10e32dn, 0x3706b1677an, 0x644d626ffdn];

function polymod(symbols) {
  // 40-bit register (8 checksum chars * 5 bits), NOT bech32's 30-bit one -
  // the mask/shift width must match, or the generator constants (correct
  // for this 40-bit variant) produce a checksum nothing else can verify.
  let chk = 1n;
  for (const value of symbols) {
    const top = chk >> 35n;
    chk = ((chk & 0x7ffffffffn) << 5n) ^ BigInt(value);
    for (let i = 0; i < 5; i++) {
      if ((top >> BigInt(i)) & 1n) chk ^= GENERATOR[i];
    }
  }
  return chk;
}

function expand(text) {
  const groups = [];
  const symbols = [];
  for (const ch of text) {
    const v = INPUT_CHARSET.indexOf(ch);
    if (v === -1) throw new Error(`Caracter invalido en el descriptor: "${ch}"`);
    symbols.push(v & 31);
    groups.push(v >> 5);
    if (groups.length === 3) {
      symbols.push(groups[0] * 9 + groups[1] * 3 + groups[2]);
      groups.length = 0;
    }
  }
  if (groups.length === 1) symbols.push(groups[0]);
  else if (groups.length === 2) symbols.push(groups[0] * 3 + groups[1]);
  return symbols;
}

/** Appends "#" + the 8-character BIP380 checksum to a descriptor (without one). */
export function descsumCreate(descriptor) {
  const symbols = expand(descriptor).concat([0, 0, 0, 0, 0, 0, 0, 0]);
  const checksum = polymod(symbols) ^ 1n;
  let suffix = '';
  for (let i = 0; i < 8; i++) {
    suffix += CHECKSUM_CHARSET[Number((checksum >> BigInt(5 * (7 - i))) & 31n)];
  }
  return `${descriptor}#${suffix}`;
}

/** Verifies a descriptor's own "#checksum" suffix. Returns false (not throw) on a bad checksum. */
export function descsumCheck(descriptorWithChecksum) {
  const hashIdx = descriptorWithChecksum.indexOf('#');
  if (hashIdx === -1) return false;
  const body = descriptorWithChecksum.slice(0, hashIdx);
  const checksum = descriptorWithChecksum.slice(hashIdx + 1);
  if (checksum.length !== 8) return false;
  let symbols;
  try {
    symbols = expand(body);
  } catch {
    return false;
  }
  for (const ch of checksum) {
    const v = CHECKSUM_CHARSET.indexOf(ch);
    if (v === -1) return false;
    symbols.push(v);
  }
  return polymod(symbols) === 1n;
}

// ---------- Extended public key parsing (SLIP132) ----------
// Same lenient approach as my_btc_wallet's watchonly.js: the version-byte
// prefix (xpub/Zpub/tpub/Vpub/...) is read directly from the encoded bytes
// and is purely advisory (SLIP132 labeling, not a consensus rule) - the
// derived key material is identical regardless of which prefix a given
// signer's software chose to print. Multisig-specific prefixes (Ypub/Zpub
// mainnet, Upub/Vpub testnet) are accepted alongside the generic/BIP44 ones,
// since most real-world tools (Sparrow, Coldcard, Caravan) do the same.
const KNOWN_VERSIONS = {
  0x0488b21e: { isTestnet: false, label: 'xpub' },
  0x049d7cb2: { isTestnet: false, label: 'ypub' },
  0x0295b43f: { isTestnet: false, label: 'Ypub' },
  0x04b24746: { isTestnet: false, label: 'zpub' },
  0x02aa7ed3: { isTestnet: false, label: 'Zpub' },
  0x043587cf: { isTestnet: true, label: 'tpub' },
  0x044a5262: { isTestnet: true, label: 'upub' },
  0x024289ef: { isTestnet: true, label: 'Upub' },
  0x045f1cf6: { isTestnet: true, label: 'vpub' },
  0x02575483: { isTestnet: true, label: 'Vpub' },
};
const PRIVATE_VERSION = { false: 0x0488ade4, true: 0x04358394 };

export function parseExtendedPubkey(text, expectedTestnet) {
  const trimmed = text.trim();
  let payload;
  try {
    payload = b58c.decode(trimmed);
  } catch {
    throw new Error('No es una clave publica extendida valida (xpub/Zpub/tpub/Vpub...).');
  }
  if (payload.length < 4) {
    throw new Error('No es una clave publica extendida valida (xpub/Zpub/tpub/Vpub...).');
  }
  const version = ((payload[0] << 24) | (payload[1] << 16) | (payload[2] << 8) | payload[3]) >>> 0;
  const known = KNOWN_VERSIONS[version];
  if (!known) {
    throw new Error('Prefijo de clave publica extendida no reconocido.');
  }
  if (known.isTestnet !== expectedTestnet) {
    throw new Error(
      `Esta clave (${known.label}) es de ${known.isTestnet ? 'testnet' : 'mainnet'}, pero elegiste ${expectedTestnet ? 'testnet' : 'mainnet'}.`
    );
  }
  let node;
  try {
    node = HDKey.fromExtendedKey(trimmed, { public: version, private: PRIVATE_VERSION[known.isTestnet] });
  } catch (err) {
    throw new Error(`No se pudo leer la clave publica: ${err.message}`);
  }
  if (node.privateKey) {
    throw new Error('Esto es una clave privada, no publica.');
  }
  if (!node.publicKey) {
    throw new Error('No se pudo leer la clave publica.');
  }
  return node;
}

// ---------- Derivation path helpers ----------

/** Parses "48h/0h/0h/2h" or "48'/0'/0'/2'" (with or without a leading "m/") into [48,true,0,true,0,true,2,true] pairs. */
export function parsePath(pathText) {
  const cleaned = pathText.trim().replace(/^m\/?/i, '');
  if (!cleaned) return [];
  return cleaned.split('/').map((segment) => {
    const hardened = /[h']$/i.test(segment);
    const index = parseInt(hardened ? segment.slice(0, -1) : segment, 10);
    if (!Number.isInteger(index) || index < 0 || index >= 0x80000000) {
      throw new Error(`Segmento de ruta invalido: "${segment}"`);
    }
    return { index, hardened };
  });
}

export function formatPathForDescriptor(pathText) {
  return parsePath(pathText)
    .map((s) => `${s.index}${s.hardened ? 'h' : ''}`)
    .join('/');
}

// ---------- Building a descriptor from cosigners ----------

/**
 * Builds one wsh(sortedmulti(...)) descriptor (with its checksum) for a
 * given chain (0 = receive/external, 1 = change/internal). `cosigners` is
 * an array of {fingerprint (8 hex chars), path (e.g. "48h/0h/0h/2h"), xpub}.
 * Cosigner order in the string doesn't matter for the resulting addresses -
 * sortedmulti sorts pubkeys at derivation time (BIP67) - but keeping a
 * stable order makes the exported text diff-friendly across re-exports.
 */
export function buildMultisigDescriptor(m, cosigners, chain) {
  if (!Number.isInteger(m) || m < 1 || m > cosigners.length) {
    throw new Error('Cantidad de firmas requeridas (M) invalida.');
  }
  if (chain !== 0 && chain !== 1) throw new Error('Chain invalido (debe ser 0 o 1).');
  const keys = cosigners
    .map(({ fingerprint, path, xpub }) => {
      const fgp = fingerprint.trim().toLowerCase();
      if (!/^[0-9a-f]{8}$/.test(fgp)) {
        throw new Error(`Fingerprint invalido (deben ser 8 caracteres hex): "${fingerprint}"`);
      }
      const formattedPath = formatPathForDescriptor(path);
      return `[${fgp}/${formattedPath}]${xpub.trim()}/${chain}/*`;
    })
    .join(',');
  return descsumCreate(`wsh(sortedmulti(${m},${keys}))`);
}

const DESCRIPTOR_RE =
  /^wsh\(sortedmulti\((\d+),((?:\[[0-9a-fA-F]{8}(?:\/[0-9]+h?'?)*\][A-Za-z0-9]+\/[01]\/\*,?)+)\)\)(#[a-z0-9]{8})?$/;
const KEY_RE = /\[([0-9a-fA-F]{8})((?:\/[0-9]+[h']?)*)\]([A-Za-z0-9]+)\/([01])\/\*/g;

/**
 * Parses a "wsh(sortedmulti(M,[fgp/path]xpub/chain/*,...))#checksum" string
 * (the standard output of Sparrow, Coldcard, Bitcoin Core, and this tool's
 * own export) back into {m, n, chain, cosigners}. The checksum is verified
 * if present, but not required - some tools omit it, or a human might
 * retype the descriptor without it.
 */
export function parseMultisigDescriptor(text) {
  const trimmed = text.trim().replace(/\s+/g, '');
  if (!trimmed) throw new Error('Pega un descriptor primero.');

  const hashIdx = trimmed.indexOf('#');
  if (hashIdx !== -1 && !descsumCheck(trimmed)) {
    throw new Error('El checksum del descriptor no coincide - revisalo, puede estar mal copiado.');
  }

  const match = DESCRIPTOR_RE.exec(trimmed);
  if (!match) {
    throw new Error(
      'No se reconoce el formato. Se espera algo como wsh(sortedmulti(2,[fgp/48h/0h/0h/2h]xpub.../0/*,...))'
    );
  }
  const m = parseInt(match[1], 10);

  const cosigners = [];
  let chain = null;
  KEY_RE.lastIndex = 0;
  let keyMatch;
  while ((keyMatch = KEY_RE.exec(trimmed))) {
    const [, fingerprint, pathRaw, xpub, chainStr] = keyMatch;
    const keyChain = parseInt(chainStr, 10);
    if (chain === null) chain = keyChain;
    else if (chain !== keyChain) {
      throw new Error('Todas las claves del descriptor deben usar la misma rama (/0/* o /1/*).');
    }
    cosigners.push({ fingerprint: fingerprint.toLowerCase(), path: pathRaw.replace(/^\//, ''), xpub });
  }
  if (!cosigners.length) throw new Error('No se encontro ninguna clave en el descriptor.');
  if (m > cosigners.length) throw new Error(`M (${m}) no puede ser mayor que la cantidad de cosigners (${cosigners.length}).`);

  return { m, n: cosigners.length, chain, cosigners };
}

// ---------- Address derivation ----------

/**
 * Derives the M-of-N P2WSH multisig payment (address + witnessScript) for
 * one chain/index, from each cosigner's already-parsed public-only account
 * node (see parseExtendedPubkey). Pure public-key derivation the whole way
 * down - never touches a private key, exactly like my_btc_wallet's
 * watch-only mode. Child pubkeys are sorted per BIP67 by `sortedMultisig`
 * itself, so the order `accountNodes` are passed in doesn't affect the
 * resulting address.
 */
export function deriveMultisigPayment(accountNodes, m, chain, index, network) {
  const pubkeys = accountNodes.map((node) => node.deriveChild(chain).deriveChild(index).publicKey);
  return sortedMultisig(m, pubkeys, true, network);
}
