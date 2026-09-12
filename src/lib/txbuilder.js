import * as btc from '@scure/btc-signer';
import { hex } from '@scure/base';
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

// The real locking script the UTXO's own funding transaction actually pays,
// read straight from the (already txid-hash-verified, per EsploraProvider
// .unspent) nonWitnessUtxo - the one piece of this UTXO nothing upstream can
// lie about.
function realScriptOf(utxo) {
  const raw = utxo.nonWitnessUtxo;
  if (!raw) return null;
  const decoded = raw instanceof Uint8Array
    ? btc.RawTx.decode(raw)
    : typeof raw === 'string'
      ? btc.RawTx.decode(hex.decode(raw))
      : raw;
  return decoded.outputs[utxo.index]?.script ?? null;
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
    // A UTXO reported by the network provider under address A's endpoint is
    // trusted, by this app, to actually belong to address A - nothing
    // upstream double-checks that. @scure/btc-signer's own checkScript would
    // eventually catch a real mismatch too (witnessScript must hash to the
    // real P2WSH program), but only much later, mid-signing, with a cryptic
    // internal error. Checking it here, against the one address this code
    // actually knows the UTXO is supposed to belong to, fails fast with a
    // message that says what's actually wrong.
    const realScript = realScriptOf(utxo);
    if (realScript && !equalScripts(realScript, payment.script)) {
      throw new Error(
        `El UTXO recibido para la direccion ${payment.address} no coincide con el script que le corresponde - puede ser un problema con el proveedor de red. Probá "Actualizar" en el dashboard antes de reintentar.`
      );
    }
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
  if (!selected) return selected;
  if (sendMax) return selected; // no separate change output when sending the whole balance

  // selectUTXO's own change output doesn't know about bip32Derivation - add
  // it after the fact by finding the output it created for changePayment.address.
  for (let i = 0; i < selected.tx.outputsLength; i++) {
    const out = selected.tx.getOutput(i);
    if (out.script && changePayment.script && equalScripts(out.script, changePayment.script)) {
      selected.tx.updateOutput(i, { bip32Derivation: changePayment.bip32Derivation });
    }
  }
  // Handed back alongside the tx so a reviewer (describeSpend) can identify
  // the change output by its actual script, the same one just derived and
  // compared above - not by trusting that a `bip32Derivation` field is
  // present on an output, which is only true today because this tx was
  // built entirely locally. That coupling would silently break if
  // describeSpend were ever run on a PSBT that passed through anything
  // external first (a returned, cosigner-touched PSBT can carry its own
  // metadata on any output).
  return { ...selected, changeScript: changePayment.script };
}

function equalScripts(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
