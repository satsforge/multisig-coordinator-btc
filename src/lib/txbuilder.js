import * as btc from '@scure/btc-signer';
import { deriveMultisigPayment, numericPath } from './descriptor.js';

/**
 * Builds the PSBT metadata (outer scriptPubKey, witnessScript,
 * bip32Derivation) for one address of the wallet at a known (chain, index).
 * `bip32Derivation` only ever carries PUBLIC information - which pubkey
 * belongs to which cosigner's fingerprint/path - so that whichever cosigner
 * eventually signs this PSBT (in PSBT Signer BTC, a hardware wallet, or any
 * other BIP174-aware tool) can find its own key without brute-forcing.
 */
export function annotateMultisigPayment(wallet, chain, index, network) {
  const nodes = wallet.cosigners.map((c) => c.node);
  const payment = deriveMultisigPayment(nodes, wallet.m, chain, index, network);
  const bip32Derivation = wallet.cosigners.map((c) => {
    const childPub = c.node.deriveChild(chain).deriveChild(index).publicKey;
    const path = [...numericPath(c.path), chain, index];
    return [childPub, { fingerprint: parseInt(c.fingerprint, 16), path }];
  });
  return { script: payment.script, witnessScript: payment.witnessScript, address: payment.address, bip32Derivation };
}

/**
 * Turns raw Esplora UTXOs (see network.js's fetchUtxosForAddresses) into
 * PSBT-ready inputs, each carrying the witnessScript + bip32Derivation for
 * its own (chain, index) - the annotation `selectUTXO` and, later, any
 * cosigner's signer needs.
 */
export function annotateUtxosForSpend(utxos, wallet, network) {
  return utxos.map((utxo) => {
    const { chain, index } = utxo.addressEntry;
    const payment = annotateMultisigPayment(wallet, chain, index, network);
    return {
      txid: utxo.txid,
      index: utxo.index,
      nonWitnessUtxo: utxo.nonWitnessUtxo,
      witnessScript: payment.witnessScript,
      bip32Derivation: payment.bip32Derivation,
    };
  });
}

/**
 * Builds (but does not sign) a spend PSBT from the multisig wallet. Mirrors
 * my_btc_wallet's buildSendTx (same selectUTXO strategy/shape), but every
 * input is multisig-annotated and the change output also carries its own
 * bip32Derivation so a signer can recognize it as its own.
 */
export function buildSpendTx({ wallet, utxos, destinationAddress, amountSats, feePerByte, changeEntry, network, sendMax }) {
  const outputs = sendMax ? [] : [{ address: destinationAddress, amount: amountSats }];
  const strategy = sendMax ? 'all' : 'default';
  const changePayment = annotateMultisigPayment(wallet, changeEntry.chain, changeEntry.index, network);
  const selected = btc.selectUTXO(utxos, outputs, strategy, {
    changeAddress: sendMax ? destinationAddress : changePayment.address,
    feePerByte,
    network,
    bip69: true,
    createTx: true,
  });
  if (!selected || sendMax) return selected;

  // selectUTXO's own change output doesn't know about bip32Derivation - add
  // it after the fact by finding the output it created for changePayment.address.
  for (let i = 0; i < selected.tx.outputsLength; i++) {
    const out = selected.tx.getOutput(i);
    if (out.script && changePayment.script && equalScripts(out.script, changePayment.script)) {
      selected.tx.updateOutput(i, { bip32Derivation: changePayment.bip32Derivation });
    }
  }
  return selected;
}

function equalScripts(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
