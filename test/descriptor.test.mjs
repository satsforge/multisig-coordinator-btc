import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mnemonicToSeedSync } from '@scure/bip39';
import { HDKey } from '@scure/bip32';
import { base58check } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2.js';
import * as btc from '@scure/btc-signer';

// Re-encodes a BIP32 payload under a different version prefix, to build the
// SLIP132 variants HDKey itself never serializes.
const b58cTest = base58check(sha256);
import {
  descsumCreate, descsumCheck,
  parseExtendedPubkey, parseCosignerXpub, validateXpubDepth, assertNoDuplicateCosigners,
  buildMultisigDescriptor, parseMultisigDescriptor,
  deriveMultisigPayment, parsePath, formatPathForDescriptor,
} from '../src/lib/descriptor.js';

// The worked example from the BIP380 spec text itself - a correct
// implementation of the checksum algorithm must reproduce this exactly.
const BIP380_VECTOR = { body: 'raw(deadbeef)', full: 'raw(deadbeef)#89f8spxm' };

test('descsumCreate reproduces the official BIP380 example checksum', () => {
  assert.equal(descsumCreate(BIP380_VECTOR.body), BIP380_VECTOR.full);
});

test('descsumCheck accepts the official BIP380 example and rejects a tampered one', () => {
  assert.equal(descsumCheck(BIP380_VECTOR.full), true);
  assert.equal(descsumCheck(`${BIP380_VECTOR.body}#tjg09x5x`), false);
  assert.equal(descsumCheck(BIP380_VECTOR.body), false); // no "#" at all
});

test('parsePath / formatPathForDescriptor round-trip both apostrophe and "h" notations', () => {
  assert.deepEqual(parsePath("m/48'/0'/0'/2'"), [
    { index: 48, hardened: true }, { index: 0, hardened: true },
    { index: 0, hardened: true }, { index: 2, hardened: true },
  ]);
  assert.deepEqual(parsePath('48h/0h/0h/2h'), parsePath("48'/0'/0'/2'"));
  assert.equal(formatPathForDescriptor("m/48'/0'/0'/2'"), '48h/0h/0h/2h');
});

function fakeXpub(seed, path, isTestnet) {
  const root = HDKey.fromMasterSeed(seed);
  const node = root.derive(`m/${path.replace(/h/g, "'")}`);
  // HDKey always serializes with mainnet version bytes; splice in the
  // correct prefix for the network under test, mirroring my_btc_wallet's
  // own watchonly.test.mjs approach for building test vectors.
  const raw = node.publicExtendedKey;
  return { raw, publicOnlyKey: node.publicKey, node };
}

test('buildMultisigDescriptor + parseMultisigDescriptor round-trip a 2-of-3 wallet', () => {
  const seedA = mnemonicToSeedSync('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about', '');
  const seedB = mnemonicToSeedSync('zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong', '');
  const seedC = mnemonicToSeedSync('legal winner thank year wave sausage worth useful legal winner thank yellow', '');

  const path = "48h/0h/0h/2h";
  const cosigners = [
    { fingerprint: 'aabbccdd', path, xpub: HDKey.fromMasterSeed(seedA).derive("m/48'/0'/0'/2'").publicExtendedKey },
    { fingerprint: '11223344', path, xpub: HDKey.fromMasterSeed(seedB).derive("m/48'/0'/0'/2'").publicExtendedKey },
    { fingerprint: '55667788', path, xpub: HDKey.fromMasterSeed(seedC).derive("m/48'/0'/0'/2'").publicExtendedKey },
  ];

  const externalDescriptor = buildMultisigDescriptor(2, cosigners, 0);
  assert.match(externalDescriptor, /^wsh\(sortedmulti\(2,/);
  assert.equal(descsumCheck(externalDescriptor), true);

  const parsed = parseMultisigDescriptor(externalDescriptor);
  assert.equal(parsed.m, 2);
  assert.equal(parsed.n, 3);
  assert.equal(parsed.chain, 0);
  assert.deepEqual(
    parsed.cosigners.map((c) => c.fingerprint).sort(),
    cosigners.map((c) => c.fingerprint).sort()
  );
  for (const c of parsed.cosigners) {
    assert.equal(formatPathForDescriptor(c.path), path);
  }
});

test('parseMultisigDescriptor rejects a tampered checksum', () => {
  const seed = mnemonicToSeedSync('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about', '');
  const xpub = HDKey.fromMasterSeed(seed).derive("m/48'/0'/0'/2'").publicExtendedKey;
  const good = buildMultisigDescriptor(2, [
    { fingerprint: 'aabbccdd', path: '48h/0h/0h/2h', xpub },
    { fingerprint: '11223344', path: '48h/0h/0h/2h', xpub },
  ], 0);
  const bad = good.slice(0, -1) + (good.at(-1) === 'q' ? 'p' : 'q');
  assert.throws(() => parseMultisigDescriptor(bad), /checksum/);
});

test('parseMultisigDescriptor rejects mismatched M > N', () => {
  assert.throws(
    () => parseMultisigDescriptor('wsh(sortedmulti(3,[aabbccdd/48h/0h/0h/2h]xpub6D1RGjZiDWdhzst6Fu2bRLaZx4XQVv7dPogQaTnycFacVhCFDCTJSbMatMmfwVDFvsDfbjtf7c8PrGY88UJ6NMKLykdBrsjh9pY1AKDhJBG/0/*))'),
    /no puede ser mayor/
  );
});

test('parseExtendedPubkey accepts mainnet xpub and Zpub-style prefixes interchangeably', () => {
  const seed = mnemonicToSeedSync('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about', '');
  const node = HDKey.fromMasterSeed(seed).derive("m/48'/0'/0'/2'");
  const xpub = node.publicExtendedKey; // HDKey always serializes as mainnet "xpub"
  const parsed = parseExtendedPubkey(xpub, false);
  assert.deepEqual(Uint8Array.from(parsed.publicKey), Uint8Array.from(node.publicKey));
});

test('parseExtendedPubkey rejects a private extended key, naming it explicitly', () => {
  // Pasting an xprv into a coordinator means the cosigner just handed over
  // their private key - the error has to say so, not read like a typo.
  const seed = mnemonicToSeedSync('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about', '');
  const xprv = HDKey.fromMasterSeed(seed).derive("m/48'/0'/0'/2'").privateExtendedKey;
  assert.throws(() => parseExtendedPubkey(xprv, false), /clave PRIVADA \(xprv\)/);
});

test('parseExtendedPubkey names SLIP132 multisig private prefixes (Zprv/Vprv) too', () => {
  // Sparrow/Coldcard-style multisig exports use the capitalized prefixes, so
  // the matching private ones are exactly what a confused cosigner is most
  // likely to paste here. Re-encoding under each version also self-checks the
  // constants: a wrong value wouldn't produce the expected human prefix.
  const seed = mnemonicToSeedSync('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about', '');
  const payload = b58cTest.decode(HDKey.fromMasterSeed(seed).derive("m/48'/0'/0'/2'").privateExtendedKey);
  for (const [label, bytes, isTestnet] of [
    ['Zprv', [0x02, 0xaa, 0x7a, 0x99], false],
    ['Vprv', [0x02, 0x57, 0x50, 0x48], true],
  ]) {
    const reencoded = new Uint8Array(payload.length);
    reencoded.set(payload);
    reencoded.set(bytes, 0);
    const text = b58cTest.encode(reencoded);
    assert.ok(text.startsWith(label), `expected a ${label}..., got ${text.slice(0, 6)}`);
    assert.throws(() => parseExtendedPubkey(text, isTestnet), new RegExp(`clave PRIVADA \\(${label}\\)`));
  }
});

test('deriveMultisigPayment produces a valid bech32 P2WSH address matching manual derivation', () => {
  const seedA = mnemonicToSeedSync('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about', '');
  const seedB = mnemonicToSeedSync('zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong', '');
  const network = btc.NETWORK;

  const nodeA = HDKey.fromMasterSeed(seedA).derive("m/48'/0'/0'/2'");
  const nodeB = HDKey.fromMasterSeed(seedB).derive("m/48'/0'/0'/2'");

  const payment = deriveMultisigPayment([nodeA, nodeB], 2, 0, 5, network);
  assert.ok(payment.address.startsWith('bc1q'));

  // Manual re-derivation via the same public-only path must agree.
  const pubA = nodeA.deriveChild(0).deriveChild(5).publicKey;
  const pubB = nodeB.deriveChild(0).deriveChild(5).publicKey;
  const manual = btc.sortedMultisig(2, [pubA, pubB], true, network);
  assert.equal(payment.address, manual.address);

  // Deterministic: re-deriving the same index gives the same address.
  const again = deriveMultisigPayment([nodeA, nodeB], 2, 0, 5, network);
  assert.equal(payment.address, again.address);
  // A different index must give a different address.
  const other = deriveMultisigPayment([nodeA, nodeB], 2, 0, 6, network);
  assert.notEqual(payment.address, other.address);
});

// ---------------------------------------------------------------------------
// Known-answer vector produced by Bitcoin Core itself (v31.1), the
// authoritative implementation. Everything above re-derives with the same
// @scure/btc-signer call the code under test uses, so a wrong BIP67 sort
// order or a malformed witness script would agree with itself and still
// pass. This anchors the single most consequential property of a multisig
// coordinator - that the addresses it shows are the ones every other wallet
// derives from the same descriptor - to an outside source.
//
// Regenerate with (a mainnet-configured node, no chain data needed since
// deriveaddresses is pure key math):
//   bitcoind -chain=main -datadir=<tmp> -maxconnections=0 -listen=0 -dnsseed=0
//   bitcoin-cli -chain=main -datadir=<tmp> getdescriptorinfo "<descriptor>"
//   bitcoin-cli -chain=main -datadir=<tmp> deriveaddresses "<descriptor>" '[0,4]'
const CORE_VECTOR = {
  phrases: [
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    'legal winner thank year wave sausage worth useful legal winner thank yellow',
    'letter advice cage absurd amount doctor acoustic avoid letter advice cage above',
  ],
  accountPath: "48'/0'/0'/2'",
  m: 2,
  // Full descriptor strings as Bitcoin Core accepted them verbatim, checksum included.
  descriptors: {
    0: 'wsh(sortedmulti(2,[73c5da0a/48h/0h/0h/2h]xpub6DkFAXWQ2dHxq2vatrt9qyA3bXYU4ToWQwCHbf5XB2mSTexcHZCeKS1VZYcPoBd5X8yVcbXFHJR9R8UCVpt82VX1VhR28mCyxUFL4r6KFrf/0/*,[b8688df1/48h/0h/0h/2h]xpub6FQya7zGhR92kacYsNnjreouvnHJMpXYsUXnW6NJJAJRCKsa26TzDy4LdnGhEurr3d6y1J8PJ7EEMKQp74XTqYvmGJNogYXSKDszYHtF8mX/0/*,[28645006/48h/0h/0h/2h]xpub6DnEBNkSJKBYQmsbhS1sP9cNdtU5c9PLFGCjTJmxicxc13WB8zNNGQazabQpyFAGW5bV9tMko4uBxDxjUKL6dSAcx1tEbgEHtgSqyRsekh6/0/*))#j6u0jndq',
    1: 'wsh(sortedmulti(2,[73c5da0a/48h/0h/0h/2h]xpub6DkFAXWQ2dHxq2vatrt9qyA3bXYU4ToWQwCHbf5XB2mSTexcHZCeKS1VZYcPoBd5X8yVcbXFHJR9R8UCVpt82VX1VhR28mCyxUFL4r6KFrf/1/*,[b8688df1/48h/0h/0h/2h]xpub6FQya7zGhR92kacYsNnjreouvnHJMpXYsUXnW6NJJAJRCKsa26TzDy4LdnGhEurr3d6y1J8PJ7EEMKQp74XTqYvmGJNogYXSKDszYHtF8mX/1/*,[28645006/48h/0h/0h/2h]xpub6DnEBNkSJKBYQmsbhS1sP9cNdtU5c9PLFGCjTJmxicxc13WB8zNNGQazabQpyFAGW5bV9tMko4uBxDxjUKL6dSAcx1tEbgEHtgSqyRsekh6/1/*))#h0h4v4ag',
  },
  // deriveaddresses output, indices 0..4 of each chain.
  addresses: {
    0: [
      'bc1qm43n7nnev58aj3nrznz2xscgv98t7gxycq5pmp20a5vzfp5t0q2s7r6twa',
      'bc1qh0jxweder0zfwz363juas8vhav6p4d4hmk6yx7kphd3gvf769fzq2dp3an',
      'bc1qklz3sd5m7zmv4kkkxh2g24gdj24x0d3ghhmtl2wju3ghhgduzjfqcseehe',
      'bc1qptx7x973dy29xe74mp2t0dmsx2ytccfc88ka4a2cljjzyy6xdcnqsmvg7j',
      'bc1qjupra389z97c02lhaecpcxdy4jdckg6n9fpr3jvghsmzemy455csja3fm4',
    ],
    1: [
      'bc1qy0qa9lx04k0lk9lrv4542ndehul9spkcafdtcpdv38qx6ft5km2ssnce5d',
      'bc1q5gy9eqgu0ssvpuxx4fzw4v6xpwlxe67rpc9kgaw27fhj2v0ff2eq2vca9v',
      'bc1q44ef9slkuexf7ah7m9gz4dlu895fk0x6a0gvw8j5fqzqcdlvvn2qlcfc8d',
      'bc1qu7z0wxe58r3wsexs6vvpqc5t88gph786ygvdsq6uvzaacfd29tnqkk2mex',
      'bc1qyd7mqkhmqqj2a65m8guhyzfgzte70q2zf3gzhjq0ffwlnunsqdps4jn7z6',
    ],
  },
};

function coreVectorCosigners() {
  return CORE_VECTOR.phrases.map((phrase, i) => {
    const root = HDKey.fromMasterSeed(mnemonicToSeedSync(phrase, ''));
    const account = root.derive(`m/${CORE_VECTOR.accountPath}`);
    return {
      name: `Cosigner ${i + 1}`,
      fingerprint: root.fingerprint.toString(16).padStart(8, '0'),
      path: CORE_VECTOR.accountPath,
      xpub: account.publicExtendedKey,
    };
  });
}

test('the exported descriptor (and its BIP380 checksum) is byte-identical to what Bitcoin Core accepts', () => {
  const cosigners = coreVectorCosigners();
  for (const chain of [0, 1]) {
    assert.equal(
      buildMultisigDescriptor(CORE_VECTOR.m, cosigners, chain),
      CORE_VECTOR.descriptors[chain],
      `chain ${chain}`
    );
  }
});

test('derived addresses match Bitcoin Core deriveaddresses for the same descriptor', () => {
  const nodes = coreVectorCosigners().map((c) => parseExtendedPubkey(c.xpub, false));
  for (const chain of [0, 1]) {
    CORE_VECTOR.addresses[chain].forEach((expected, index) => {
      const derived = deriveMultisigPayment(nodes, CORE_VECTOR.m, chain, index, btc.NETWORK).address;
      assert.equal(derived, expected, `chain ${chain} index ${index}`);
    });
  }
});

test('the Core vector really depends on BIP67 sorting (unsorted multi would differ)', () => {
  // Guards against a future change swapping sortedmulti for plain multi:
  // with these particular keys the sorted and unsorted scripts differ, so
  // the vector above would stop matching.
  const nodes = coreVectorCosigners().map((c) => parseExtendedPubkey(c.xpub, false));
  const pubkeys = nodes.map((n) => n.deriveChild(0).deriveChild(0).publicKey);
  const sorted = btc.p2wsh(btc.p2ms(CORE_VECTOR.m, [...pubkeys].sort((a, b) => {
    const ah = Buffer.from(a).toString('hex');
    const bh = Buffer.from(b).toString('hex');
    return ah < bh ? -1 : ah > bh ? 1 : 0;
  }), true), btc.NETWORK).address;
  const unsorted = btc.p2wsh(btc.p2ms(CORE_VECTOR.m, pubkeys, true), btc.NETWORK).address;
  assert.notEqual(sorted, unsorted, 'test fixture is only meaningful if key order changes the address');
  assert.equal(sorted, CORE_VECTOR.addresses[0][0]);
});

test('validateXpubDepth rejects a master xpub pasted against a BIP48 account path', () => {
  // Regression for the "wrong key, path lies about it" footgun: a cosigner
  // who pastes their MASTER xpub (depth 0) while the declared path implies
  // a BIP48 account key (depth 4) gets a wallet whose real addresses
  // (derived from the master) can never be signed by any tool following
  // the exported bip32Derivation (which tells signers to derive
  // master/48'/coin'/account'/2'/chain/index - a different key entirely).
  const seed = mnemonicToSeedSync(
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about', ''
  );
  const master = HDKey.fromMasterSeed(seed);
  assert.equal(master.depth, 0);
  assert.throws(
    () => validateXpubDepth(master, "48'/0'/0'/2'"),
    /profundidad 0.*profundidad 4/s
  );

  // The correctly-derived account-level xpub for the same path passes.
  const account = master.derive("m/48'/0'/0'/2'");
  assert.doesNotThrow(() => validateXpubDepth(account, "48'/0'/0'/2'"));
});

test('parseCosignerXpub combines parsing and the depth check in one call', () => {
  const seed = mnemonicToSeedSync(
    'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong', ''
  );
  const master = HDKey.fromMasterSeed(seed);
  assert.throws(() => parseCosignerXpub(master.publicExtendedKey, "48'/0'/0'/2'", false), /profundidad/);

  const account = master.derive("m/48'/0'/0'/2'");
  const node = parseCosignerXpub(account.publicExtendedKey, "48'/0'/0'/2'", false);
  assert.equal(node.depth, 4);
});

test('parsePath rejects a segment with trailing garbage instead of silently truncating it', () => {
  // Regression: parseInt("48x", 10) === 48, and parseInt("0x10", 10) === 0 -
  // both used to be accepted as if the mistyped suffix simply wasn't there,
  // silently changing which key gets derived (and whether it's hardened).
  assert.throws(() => parsePath("48x/1'/0'/2'"), /Segmento de ruta invalido/);
  assert.throws(() => parsePath("0x10/1'/0'/2'"), /Segmento de ruta invalido/);
  assert.throws(() => parsePath("48'/1'/0'/2'/"), /Segmento de ruta invalido/); // trailing slash -> empty segment
  // Still accepts everything it always did.
  assert.deepEqual(parsePath("48'/1'/0'/2'"), parsePath('48h/1h/0h/2h'));
});

test('assertNoDuplicateCosigners catches the same key re-serialized under a different SLIP132 prefix', () => {
  // Regression: comparing raw xpub *strings* misses that a tpub and a Vpub
  // can encode byte-for-byte the same chain code/public key - the version
  // prefix is purely advisory labeling (see parseExtendedPubkey's own
  // comment on this), so two differently-prefixed strings for the same key
  // used to sail right past a string-based duplicate check.
  const seed = mnemonicToSeedSync(
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about', ''
  );
  const account = HDKey.fromMasterSeed(seed).derive("m/48'/1'/0'/2'");
  const asTpub = parseExtendedPubkey(account.publicExtendedKey, false); // parsed as "mainnet" xpub is fine for this test - only publicKey bytes matter here
  // Re-encode the exact same key/chaincode under the testnet Vpub version bytes.
  const vpubPayload = b58cTest.decode(account.publicExtendedKey);
  const reencoded = new Uint8Array(vpubPayload.length);
  reencoded.set(vpubPayload);
  reencoded.set([0x02, 0x57, 0x54, 0x83], 0); // Vpub version bytes
  const vpubText = b58cTest.encode(reencoded);
  const asVpub = parseExtendedPubkey(vpubText, true);
  assert.deepEqual(Uint8Array.from(asTpub.publicKey), Uint8Array.from(asVpub.publicKey));

  assert.throws(
    () => assertNoDuplicateCosigners([
      { name: 'Alice', node: asTpub },
      { name: 'Bob', node: asVpub },
    ]),
    /Alice.*Bob|Bob.*Alice/
  );
  // A genuinely different key does not trigger it.
  const other = HDKey.fromMasterSeed(mnemonicToSeedSync('zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong', ''))
    .derive("m/48'/0'/0'/2'");
  assert.doesNotThrow(() => assertNoDuplicateCosigners([{ name: 'Alice', node: asTpub }, { name: 'Carol', node: other }]));
});

test('parseMultisigDescriptor reports whether a checksum was actually present and verified', () => {
  const seedA = mnemonicToSeedSync('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about', '');
  const seedB = mnemonicToSeedSync('zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong', '');
  const xpubA = HDKey.fromMasterSeed(seedA).derive("m/48'/0'/0'/2'").publicExtendedKey;
  const xpubB = HDKey.fromMasterSeed(seedB).derive("m/48'/0'/0'/2'").publicExtendedKey;
  const body = `wsh(sortedmulti(2,[aabbccdd/48h/0h/0h/2h]${xpubA}/0/*,[11223344/48h/0h/0h/2h]${xpubB}/0/*))`;
  const withChecksum = descsumCreate(body);

  const verified = parseMultisigDescriptor(withChecksum);
  assert.equal(verified.checksumVerified, true);

  // Regression: a descriptor missing its "#checksum" entirely used to be
  // accepted with no signal whatsoever that nothing had been verified - a
  // single altered character in the body is otherwise indistinguishable
  // from a correct descriptor.
  const noChecksum = parseMultisigDescriptor(body);
  assert.equal(noChecksum.checksumVerified, false);
  assert.equal(noChecksum.m, 2);
  assert.equal(noChecksum.cosigners.length, 2);
});
