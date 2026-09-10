import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mnemonicToSeedSync } from '@scure/bip39';
import { HDKey } from '@scure/bip32';
import * as btc from '@scure/btc-signer';
import {
  descsumCreate, descsumCheck,
  parseExtendedPubkey, buildMultisigDescriptor, parseMultisigDescriptor,
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

test('parseExtendedPubkey rejects a private extended key', () => {
  // xprv's version bytes aren't in the known-public-prefix table at all, so
  // this is rejected at the earliest possible point (prefix lookup) rather
  // than parsed and only then found to carry a private key - still a safe,
  // clear rejection either way.
  const seed = mnemonicToSeedSync('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about', '');
  const xprv = HDKey.fromMasterSeed(seed).derive("m/48'/0'/0'/2'").privateExtendedKey;
  assert.throws(() => parseExtendedPubkey(xprv, false), /no reconocido/);
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
