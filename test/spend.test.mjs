import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mnemonicToSeedSync } from '@scure/bip39';
import { HDKey } from '@scure/bip32';
import * as btc from '@scure/btc-signer';
import { randomBytes } from '@noble/hashes/utils.js';
import { parseExtendedPubkey, deriveMultisigPayment } from '../src/lib/descriptor.js';
import { annotateUtxosForSpend, buildSpendTx } from '../src/lib/txbuilder.js';
import {
  decodePsbt, encodePsbt, combineSignedPsbt, signatureProgress, describeSpend, finalizeSpend,
} from '../src/lib/psbtcoordinate.js';

const network = btc.NETWORK;
const ACCOUNT_PATH = "48'/0'/0'/2'";

function cosignerFixture(mnemonic) {
  const seed = mnemonicToSeedSync(mnemonic, '');
  const root = HDKey.fromMasterSeed(seed);
  const fingerprint = root.fingerprint.toString(16).padStart(8, '0');
  const priv = root.derive(`m/${ACCOUNT_PATH}`);
  return { fingerprint, priv, xpub: priv.publicExtendedKey };
}

function buildWallet(fixtures, m) {
  const cosigners = fixtures.map((f) => ({
    fingerprint: f.fingerprint,
    path: ACCOUNT_PATH,
    xpub: f.xpub,
    node: parseExtendedPubkey(f.xpub, false),
  }));
  return { m, n: cosigners.length, cosigners };
}

function fundReceive0(wallet, amount) {
  const payment0 = deriveMultisigPayment(wallet.cosigners.map((c) => c.node), wallet.m, 0, 0, network);
  const funding = new btc.Transaction({ version: 1 });
  funding.addInput({ txid: new Uint8Array(32), index: 0xffffffff });
  funding.addOutput({ script: payment0.script, amount });
  const utxo = {
    txid: funding.id,
    index: 0,
    nonWitnessUtxo: funding.unsignedTx,
    addressEntry: { chain: 0, index: 0, address: payment0.address },
  };
  return { payment0, utxo };
}

test('2-of-3 spend: build unsigned PSBT, two independent cosigners sign, coordinator combines and finalizes', () => {
  const fixtures = [
    cosignerFixture('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'),
    cosignerFixture('zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong'),
    cosignerFixture('legal winner thank year wave sausage worth useful legal winner thank yellow'),
  ];
  const wallet = buildWallet(fixtures, 2);
  const { utxo } = fundReceive0(wallet, 100_000n);
  const utxos = annotateUtxosForSpend([utxo], wallet, network);

  const destinationAddress = btc.getAddress('wpkh', randomBytes(32), network);
  const changeEntry = { chain: 1, index: 0 };
  const built = buildSpendTx({
    wallet, utxos, destinationAddress, amountSats: 40_000n, feePerByte: 2n, changeEntry, network, sendMax: false,
  });
  assert.ok(built, 'buildSpendTx should find enough funds');

  // Hand-off to cosigners happens as a base64 PSBT, same as a real export.
  const unsignedPsbtB64 = encodePsbt(built.tx);

  // Cosigner A and B each independently decode the SAME unsigned PSBT and
  // sign with their own real private key - the coordinator never sees these.
  const nodeAChild = fixtures[0].priv.deriveChild(0).deriveChild(0);
  const txA = decodePsbt(unsignedPsbtB64);
  txA.sign(nodeAChild.privateKey);
  const signedAB64 = encodePsbt(txA);

  const nodeBChild = fixtures[1].priv.deriveChild(0).deriveChild(0);
  const txB = decodePsbt(unsignedPsbtB64);
  txB.sign(nodeBChild.privateKey);
  const signedBB64 = encodePsbt(txB);

  // Coordinator side: combine both partially-signed PSBTs.
  let combined = decodePsbt(unsignedPsbtB64);
  combined = combineSignedPsbt(combined, decodePsbt(signedAB64));
  let progress = signatureProgress(combined, wallet.m);
  assert.equal(progress.ready, false);
  assert.equal(progress.perInput[0].count, 1);

  combined = combineSignedPsbt(combined, decodePsbt(signedBB64));
  progress = signatureProgress(combined, wallet.m);
  assert.equal(progress.ready, true);
  assert.equal(progress.perInput[0].count, 2);

  const summary = describeSpend(combined, network, built.changeScript);
  assert.equal(summary.inputsTotal, 100_000n);
  assert.equal(summary.inputsTotal - summary.outputsTotal, summary.fee);
  assert.ok(summary.fee > 0n && summary.fee < 5000n);
  const changeOutput = summary.outputs.find((o) => o.isChange);
  assert.ok(changeOutput, 'change output should be flagged by matching buildSpendTx\'s own changeScript');

  const result = finalizeSpend(combined, wallet.m);
  assert.equal(result.txid, built.tx.id);
  assert.ok(result.hex.length > 0);
});

test('buildSpendTx returns undefined when funds are insufficient', () => {
  const fixtures = [
    cosignerFixture('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'),
    cosignerFixture('zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong'),
  ];
  const wallet = buildWallet(fixtures, 2);
  const { utxo } = fundReceive0(wallet, 1000n);
  const utxos = annotateUtxosForSpend([utxo], wallet, network);
  const destinationAddress = btc.getAddress('wpkh', randomBytes(32), network);
  const built = buildSpendTx({
    wallet, utxos, destinationAddress, amountSats: 40_000n, feePerByte: 2n,
    changeEntry: { chain: 1, index: 0 }, network, sendMax: false,
  });
  assert.equal(built, undefined);
});

test('signatureProgress reports zero before any signature and reflects an already-finalized input', () => {
  const fixtures = [
    cosignerFixture('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'),
    cosignerFixture('zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong'),
  ];
  const wallet = buildWallet(fixtures, 2);
  const { utxo } = fundReceive0(wallet, 100_000n);
  const utxos = annotateUtxosForSpend([utxo], wallet, network);
  const destinationAddress = btc.getAddress('wpkh', randomBytes(32), network);
  const built = buildSpendTx({
    wallet, utxos, destinationAddress, amountSats: 40_000n, feePerByte: 2n,
    changeEntry: { chain: 1, index: 0 }, network, sendMax: false,
  });

  const before = signatureProgress(built.tx, wallet.m);
  assert.equal(before.ready, false);
  assert.equal(before.perInput[0].count, 0);

  const nodeAChild = fixtures[0].priv.deriveChild(0).deriveChild(0);
  const nodeBChild = fixtures[1].priv.deriveChild(0).deriveChild(0);
  built.tx.sign(nodeAChild.privateKey);
  built.tx.sign(nodeBChild.privateKey);
  built.tx.finalize();
  const after = signatureProgress(built.tx, wallet.m);
  assert.equal(after.ready, true);
  assert.equal(after.perInput[0].finalized, true);
});

test('combineSignedPsbt rejects a forged signature (real bytes, wrong pubkey) instead of counting it toward the quorum', () => {
  // Regression: Transaction.finalize()'s own p2ms path (and the old
  // signatureProgress) only ever checked that a partialSig entry's pubkey
  // was one of the witnessScript's own keys and counted how many such
  // entries existed - never that the signature itself was valid. A
  // malicious or buggy cosigner could staple a real DER signature (say,
  // replayed from a different key's own valid signature) onto any pubkey
  // in the script and it would count.
  const fixtures = [
    cosignerFixture('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'),
    cosignerFixture('zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong'),
    cosignerFixture('legal winner thank year wave sausage worth useful legal winner thank yellow'),
  ];
  const wallet = buildWallet(fixtures, 2);
  const { utxo } = fundReceive0(wallet, 100_000n);
  const utxos = annotateUtxosForSpend([utxo], wallet, network);
  const destinationAddress = btc.getAddress('wpkh', randomBytes(32), network);
  const built = buildSpendTx({
    wallet, utxos, destinationAddress, amountSats: 40_000n, feePerByte: 2n,
    changeEntry: { chain: 1, index: 0 }, network, sendMax: false,
  });
  const unsignedPsbtB64 = encodePsbt(built.tx);

  const nodeAChild = fixtures[0].priv.deriveChild(0).deriveChild(0);
  const txA = decodePsbt(unsignedPsbtB64);
  txA.signIdx(nodeAChild.privateKey, 0);

  let coordinator = decodePsbt(unsignedPsbtB64);
  coordinator = combineSignedPsbt(coordinator, txA);
  assert.equal(signatureProgress(coordinator, wallet.m).perInput[0].count, 1);

  // Forge a second "signature": cosigner A's real sig, replayed under
  // cosigner B's pubkey. The bytes are a genuine, well-formed DER
  // signature - just not one B ever produced for this input.
  const forgedNode = fixtures[1].priv.deriveChild(0).deriveChild(0);
  const realSigBytes = coordinator.getInput(0).partialSig[0][1];
  const forged = decodePsbt(unsignedPsbtB64);
  forged.updateInput(0, { partialSig: [[forgedNode.publicKey, realSigBytes]] });

  assert.throws(() => combineSignedPsbt(coordinator, forged), /firma que no es valida/);
  // The coordinator's own working PSBT must be untouched by the rejected attempt.
  assert.equal(signatureProgress(coordinator, wallet.m).perInput[0].count, 1);
  assert.throws(() => finalizeSpend(coordinator, wallet.m), /firmas validas/);
});

test('describeSpend flags an anomalously high fee, and only the real change output as change', () => {
  const fixtures = [
    cosignerFixture('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'),
    cosignerFixture('zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong'),
  ];
  const wallet = buildWallet(fixtures, 2);
  const { utxo } = fundReceive0(wallet, 100_000n);
  const utxos = annotateUtxosForSpend([utxo], wallet, network);
  const destinationAddress = btc.getAddress('wpkh', randomBytes(32), network);
  const changeEntry = { chain: 1, index: 0 };

  const cheap = buildSpendTx({
    wallet, utxos, destinationAddress, amountSats: 90_000n, feePerByte: 2n, changeEntry, network, sendMax: false,
  });
  assert.equal(describeSpend(cheap.tx, network, cheap.changeScript).feeWarning, false);

  // A wildly high sats/vB rate (a mistyped custom fee, say) eats well over
  // 10% of the 100_000-sat input in real fee.
  const expensive = buildSpendTx({
    wallet, utxos, destinationAddress, amountSats: 10_000n, feePerByte: 60n, changeEntry, network, sendMax: false,
  });
  assert.ok(expensive, 'buildSpendTx should still find enough funds at this rate');
  const summary = describeSpend(expensive.tx, network, expensive.changeScript);
  assert.equal(summary.feeWarning, true);
  // Regression: isChange used to be "does this output carry a
  // bip32Derivation field", which any PSBT touched outside this coordinator
  // could attach to an arbitrary output. Matching the real changeScript
  // buildSpendTx derived is tied to the actual output this build produced.
  const changeOutputs = summary.outputs.filter((o) => o.isChange);
  assert.equal(changeOutputs.length, 1);
});

test('annotateUtxosForSpend rejects a UTXO whose real script does not match the address it was reported under', () => {
  // Regression: a network provider (or a bug in indexing) reporting a UTXO
  // under the wrong address used to sail straight into the built PSBT -
  // @scure/btc-signer's own checkScript would eventually catch the mismatch,
  // but only much later, mid-signing, with a cryptic internal error.
  const fixtures = [
    cosignerFixture('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'),
    cosignerFixture('zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong'),
  ];
  const wallet = buildWallet(fixtures, 2);
  const { utxo } = fundReceive0(wallet, 100_000n);
  // Claim this same UTXO belongs to a *different* index than it really pays.
  const mislabeled = { ...utxo, addressEntry: { chain: 0, index: 1 } };
  assert.throws(
    () => annotateUtxosForSpend([mislabeled], wallet, network),
    /no coincide con el script/
  );

  // The correctly-labeled UTXO still works.
  assert.doesNotThrow(() => annotateUtxosForSpend([utxo], wallet, network));
});
