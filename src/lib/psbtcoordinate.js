import * as btc from '@scure/btc-signer';
import { base64, hex } from '@scure/base';

// Hex/base64 alphabets overlap (any hex string also looks like valid
// base64) - try the encoding the string looks most like first, fall back to
// the other before giving up. Same heuristic as the rest of the suite.
export function decodePsbt(text) {
  const trimmed = text.replace(/\s+/g, '');
  if (!trimmed) throw new Error('Pega o carga un PSBT primero.');
  const looksHex = /^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0;
  const encodings = looksHex ? ['hex', 'base64'] : ['base64', 'hex'];

  let lastError = null;
  for (const encoding of encodings) {
    try {
      const bytes = encoding === 'hex' ? hex.decode(trimmed) : base64.decode(trimmed);
      return btc.Transaction.fromPSBT(bytes, { allowUnknown: true });
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`No se pudo decodificar el PSBT (ni base64 ni hex valido): ${lastError?.message ?? ''}`);
}

export function encodePsbt(tx) {
  return base64.encode(tx.toPSBT());
}

/**
 * Merges a newly-pasted, partially-signed PSBT into the running coordinator
 * PSBT. `Transaction.combine` (from @scure/btc-signer) already implements
 * BIP174 combining - it verifies both PSBTs share the same unsigned
 * transaction before merging partialSig/other per-input data, so a PSBT for
 * a different spend is rejected rather than silently corrupting the result.
 */
export function combineSignedPsbt(baseTx, incomingTx) {
  baseTx.combine(incomingTx);
  return baseTx;
}

/** Per-input signature count so far, against the wallet's own M. */
export function signatureProgress(tx, m) {
  const perInput = [];
  for (let i = 0; i < tx.inputsLength; i++) {
    const input = tx.getInput(i);
    const finalized = Boolean(input.finalScriptWitness?.length || input.finalScriptSig?.length);
    const count = finalized ? m : (input.partialSig?.length ?? 0);
    perInput.push({ index: i, count, finalized });
  }
  const ready = perInput.every((row) => row.finalized || row.count >= m);
  return { perInput, ready };
}

function scriptToAddress(script, network) {
  try {
    return btc.Address(network).encode(btc.OutScript.decode(script));
  } catch {
    return null;
  }
}

function prevoutFor(input) {
  if (input.witnessUtxo) return input.witnessUtxo;
  if (input.nonWitnessUtxo) {
    const raw = input.nonWitnessUtxo;
    const decoded =
      raw instanceof Uint8Array
        ? btc.RawTx.decode(raw)
        : typeof raw === 'string'
          ? btc.RawTx.decode(hex.decode(raw))
          : raw;
    return decoded.outputs[input.index];
  }
  return null;
}

/** Human-readable summary for the mandatory review-before-export screen. */
export function describeSpend(tx, network) {
  let inputsTotal = 0n;
  for (let i = 0; i < tx.inputsLength; i++) {
    const prevout = prevoutFor(tx.getInput(i));
    if (prevout) inputsTotal += prevout.amount;
  }
  let outputsTotal = 0n;
  const outputs = [];
  for (let i = 0; i < tx.outputsLength; i++) {
    const output = tx.getOutput(i);
    outputsTotal += output.amount;
    const isChange = Boolean(output.bip32Derivation?.length);
    outputs.push({ amount: output.amount, address: scriptToAddress(output.script, network), isChange });
  }
  return { inputsTotal, outputsTotal, fee: inputsTotal - outputsTotal, outputs };
}

/** Tries to finalize (all inputs signed) and extract the raw tx. */
export function finalizeSpend(tx) {
  tx.finalize();
  return { hex: tx.hex, txid: tx.id };
}
