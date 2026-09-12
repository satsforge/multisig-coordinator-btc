import { HDKey } from '@scure/bip32';
import { base58check, hex } from '@scure/base';
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

// The private-key counterpart of every prefix in KNOWN_VERSIONS above, used
// ONLY to recognize one and name it in the error - never to build a node
// from it. Without this table none of them reach the `node.privateKey` check
// further down: their version bytes simply aren't in KNOWN_VERSIONS, so the
// generic "prefijo no reconocido" fires first, which reads like a typo and
// invites the user to retry. Pasting an xprv into a *coordinator* is the one
// mistake in a multisig setup that must be unmistakable - at that point the
// cosigner has handed their private key to whoever runs this screen.
const KNOWN_PRIVATE_VERSIONS = {
  0x0488ade4: 'xprv',
  0x049d7878: 'yprv',
  0x0295b005: 'Yprv',
  0x04b2430c: 'zprv',
  0x02aa7a99: 'Zprv',
  0x04358394: 'tprv',
  0x044a4e28: 'uprv',
  0x024285b5: 'Uprv',
  0x045f18bc: 'vprv',
  0x02575048: 'Vprv',
};

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
    const privateLabel = KNOWN_PRIVATE_VERSIONS[version];
    if (privateLabel) {
      throw new Error(
        `Esto es una clave PRIVADA (${privateLabel}), no publica. Un coordinador solo necesita la clave publica extendida de cada cosigner - no pegues nunca una clave privada aca. Si ya la compartiste con alguien mas, considerala comprometida y movee los fondos.`
      );
    }
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

/**
 * Confirms a cosigner's xpub is actually the key its declared derivation
 * path says it is - specifically, that the xpub's own on-chain `depth`
 * matches how many segments the path has. Nothing else in this tool checks
 * this: `deriveMultisigPayment` will happily derive `node.deriveChild(chain)
 * .deriveChild(index)` from *any* node regardless of depth, producing real,
 * usable-looking addresses either way. The problem only surfaces later - the
 * `bip32Derivation` this tool exports tells every signer "derive
 * fingerprint/path/chain/index from your own master key", so if the pasted
 * xpub was actually the master (depth 0) while the path claims depth 4
 * (BIP48's `48'/coin'/account'/2'`), the wallet's real addresses come from
 * `master/chain/index` but every signer goes looking for
 * `master/48'/coin'/account'/2'/chain/index` instead - a different key
 * entirely. Funds sent to such a wallet cannot be spent through the normal
 * flow, and nothing before this point would have said so.
 */
export function validateXpubDepth(node, pathText) {
  const declaredDepth = parsePath(pathText).length;
  if (node.depth !== declaredDepth) {
    throw new Error(
      `La clave publica tiene profundidad ${node.depth} pero la ruta declarada ("${pathText}") implica profundidad ${declaredDepth} - probablemente pegaste la clave equivocada (por ejemplo la maestra en vez de la de cuenta). Los fondos enviados a esta wallet no se van a poder firmar despues.`
    );
  }
}

/** parseExtendedPubkey + validateXpubDepth in one call - the shape every
 * caller that also has a declared path (manual entry, or a parsed
 * descriptor) should use instead of parseExtendedPubkey alone. */
export function parseCosignerXpub(text, pathText, expectedTestnet) {
  const node = parseExtendedPubkey(text, expectedTestnet);
  validateXpubDepth(node, pathText);
  return node;
}

/**
 * Throws if two cosigners resolve to the exact same public key. Comparing
 * the raw xpub *strings* (as this app briefly did) misses the case where
 * the same key is simply re-serialized under a different SLIP132 prefix -
 * a tpub and a Vpub can be cosmetically different strings for byte-for-byte
 * the same chain code and public key, since the prefix is only advisory
 * labeling (see parseExtendedPubkey's own comment on this). Comparing the
 * parsed node's actual publicKey catches that; `sortedMultisig`'s own
 * uniqPubkey check would too, but only after silently building the wallet
 * with the duplicate, which is not the same as refusing it up front with a
 * clear reason.
 */
export function assertNoDuplicateCosigners(cosigners) {
  const seenBy = new Map(); // pubkeyHex -> the first cosigner's label
  cosigners.forEach((c, i) => {
    const pubHex = hex.encode(c.node.publicKey);
    const label = c.name || `#${i + 1}`;
    const first = seenBy.get(pubHex);
    if (first) {
      throw new Error(
        `Los cosigners "${first}" y "${label}" son la misma clave (aunque esten escritas distinto) - repetir una clave convertiria un "M-de-N" en una wallet mas debil de lo que parece.`
      );
    }
    seenBy.set(pubHex, label);
  });
}

// ---------- Derivation path helpers ----------

/** Parses "48h/0h/0h/2h" or "48'/0'/0'/2'" (with or without a leading "m/") into [48,true,0,true,0,true,2,true] pairs. */
// The whole segment must be digits plus an optional hardened marker - no
// trailing garbage. parseInt alone would silently accept "48x" as 48 (and
// "0x10" as 0, stopping at the first non-digit character), turning one
// mistyped character into a completely different, unhardened or
// wrong-index derivation that then propagates into every exported
// bip32Derivation and descriptor - with no error anywhere to catch it.
const PATH_SEGMENT_RE = /^(\d+)([hH']?)$/;

export function parsePath(pathText) {
  const cleaned = pathText.trim().replace(/^m\/?/i, '');
  if (!cleaned) return [];
  return cleaned.split('/').map((segment) => {
    const match = PATH_SEGMENT_RE.exec(segment);
    if (!match) {
      throw new Error(`Segmento de ruta invalido: "${segment}"`);
    }
    const index = parseInt(match[1], 10);
    if (!Number.isSafeInteger(index) || index < 0 || index >= 0x80000000) {
      throw new Error(`Segmento de ruta invalido: "${segment}"`);
    }
    return { index, hardened: match[2] !== '' };
  });
}

export function formatPathForDescriptor(pathText) {
  return parsePath(pathText)
    .map((s) => `${s.index}${s.hardened ? 'h' : ''}`)
    .join('/');
}

// BIP32Der (the PSBT bip32Derivation field) stores each path segment as one
// raw 32-bit number, hardened segments folded in via the top bit (BIP32's
// own convention - the same one HDKey.deriveChild expects).
const HARDENED_OFFSET = 0x80000000;
export function numericPath(pathText) {
  return parsePath(pathText).map(({ index, hardened }) => (hardened ? index + HARDENED_OFFSET : index));
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

  // A present checksum is verified strictly - a mismatch always throws. One
  // that's simply absent is still accepted (some tools omit it, or a human
  // might retype the descriptor by hand), but the caller gets told so: with
  // no checksum, a single altered/mistyped character anywhere in the body
  // is otherwise indistinguishable from a correct descriptor, and this
  // descriptor alone determines which addresses the wallet - and every
  // cosigner's signer - will ever recognize as its own.
  const hashIdx = trimmed.indexOf('#');
  const checksumVerified = hashIdx !== -1;
  if (checksumVerified && !descsumCheck(trimmed)) {
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

  return { m, n: cosigners.length, chain, cosigners, checksumVerified };
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
