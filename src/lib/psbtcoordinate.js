import * as btc from '@scure/btc-signer';
import { base64, hex } from '@scure/base';
import { secp256k1 } from '@noble/curves/secp256k1.js';

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

// A p2ms (sortedmulti) input's own finalize() path - see @scure/btc-signer's
// finalizeIdx - only ever checks that a partialSig entry's *pubkey* is one
// of the witnessScript's own pubkeys, then counts how many such entries
// exist up to m. It never verifies the signature bytes are cryptographically
// valid. Anyone returning a PSBT can staple arbitrary bytes onto any of the
// wallet's own pubkeys, and neither this file's old signatureProgress nor
// the library's own finalize() would have caught it - finalize() would
// happily assemble and "complete" a transaction real nodes reject on
// broadcast. This is the one gate that actually checks a signature is real
// before it counts toward the quorum or reaches finalize() at all.
//
// Returns { valid: Set<pubkeyHex>, invalid: pubkeyHex[] } - entries for
// pubkeys the witnessScript doesn't even recognize are ignored entirely
// (neither valid nor invalid): they can't affect the quorum either way, and
// treating them as "invalid" would reject a PSBT that's merely carrying
// unrelated metadata rather than a forged signature.
function classifyPartialSigs(tx, index, input) {
  const valid = new Set();
  const invalid = [];
  if (!input.witnessScript || !input.partialSig?.length) return { valid, invalid };

  let decoded;
  try {
    decoded = btc.OutScript.decode(input.witnessScript);
  } catch {
    return { valid, invalid };
  }
  if (decoded.type !== 'ms') return { valid, invalid };
  const scriptPubkeys = new Set(decoded.pubkeys.map((p) => hex.encode(p)));

  const prevout = prevoutFor(input);
  if (!prevout) return { valid, invalid };

  for (const [pubkey, sigWithType] of input.partialSig) {
    const pubHex = hex.encode(pubkey);
    if (!scriptPubkeys.has(pubHex)) continue;

    let ok = false;
    if (sigWithType && sigWithType.length >= 2) {
      const hashType = sigWithType[sigWithType.length - 1];
      const der = sigWithType.subarray(0, sigWithType.length - 1);
      try {
        // BIP143: the "scriptCode" committed to for a P2WSH input is the
        // witnessScript itself, exactly what this input already carries.
        // prehash:false is required - sigHash is already the final 32-byte
        // digest ECDSA signs (matching @scure/btc-signer's own signECDSA),
        // but noble's verify() defaults to re-hashing the message itself.
        const sigHash = tx.preimageWitnessV0(index, input.witnessScript, hashType, prevout.amount);
        ok = secp256k1.verify(der, sigHash, pubkey, { format: 'der', lowS: true, prehash: false });
      } catch {
        ok = false;
      }
    }
    if (ok) valid.add(pubHex);
    else invalid.push(pubHex);
  }
  return { valid, invalid };
}

/**
 * Merges a newly-pasted, partially-signed PSBT into the running coordinator
 * PSBT. `Transaction.combine` (from @scure/btc-signer) already implements
 * BIP174 combining - it verifies both PSBTs share the same unsigned
 * transaction before merging partialSig/other per-input data, so a PSBT for
 * a different spend is rejected rather than silently corrupting the result -
 * but it never checks that a partialSig is a *genuine* signature (see
 * classifyPartialSigs above). Combining happens on a clone first, so a
 * forged/corrupt signature is rejected before it ever touches the
 * coordinator's real working PSBT, not after.
 */
export function combineSignedPsbt(baseTx, incomingTx) {
  const trial = btc.Transaction.fromPSBT(baseTx.toPSBT(), { allowUnknown: true });
  trial.combine(incomingTx);
  for (let i = 0; i < trial.inputsLength; i++) {
    const { invalid } = classifyPartialSigs(trial, i, trial.getInput(i));
    if (invalid.length) {
      throw new Error(
        `El input ${i} trae una firma que no es valida para la clave ${invalid[0].slice(0, 8)}... - puede ser un PSBT corrupto, de otra ronda de firma, o alterado. Pedile a ese cosigner que firme de nuevo este mismo PSBT sin firmar.`
      );
    }
  }
  return trial;
}

/** Per-input count of *cryptographically verified* signatures so far,
 * against the wallet's own M - see classifyPartialSigs. */
export function signatureProgress(tx, m) {
  const perInput = [];
  for (let i = 0; i < tx.inputsLength; i++) {
    const input = tx.getInput(i);
    const finalized = Boolean(input.finalScriptWitness?.length || input.finalScriptSig?.length);
    const count = finalized ? m : classifyPartialSigs(tx, i, input).valid.size;
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

// Above this fraction of the inputs' value, a fee looks like a mistake (a
// bad custom sats/vB entry, a typo, an unexpectedly tiny change output)
// rather than a deliberate choice - unlike psbt-signer-btc, this coordinator
// builds the transaction itself from UTXOs it fetched directly (see
// network.js's EsploraProvider.unspent, which hashes and verifies each
// prevout), so the amounts here can't be lied about the way an externally-
// supplied PSBT's could - this is purely a "did I typo the fee" safety net.
export const FEE_WARNING_RATIO = 0.10;

function equalScripts(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Human-readable summary for the mandatory review-before-export screen.
 * `changeScript` (from buildSpendTx) identifies the change output by its
 * actual derived script, not by trusting a `bip32Derivation` field's mere
 * presence - see the comment on buildSpendTx's return value. */
export function describeSpend(tx, network, changeScript) {
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
    const isChange = equalScripts(output.script, changeScript);
    outputs.push({ amount: output.amount, address: scriptToAddress(output.script, network), isChange });
  }
  const fee = inputsTotal - outputsTotal;
  const feeRatio = inputsTotal > 0n ? Number(fee) / Number(inputsTotal) : 0;
  const feeWarning = fee < 0n || feeRatio > FEE_WARNING_RATIO;
  return { inputsTotal, outputsTotal, fee, outputs, feeWarning };
}

/** Tries to finalize (all inputs signed with verified signatures) and
 * extract the raw tx. Re-checks signatureProgress itself first - Transaction
 * .finalize()'s own p2ms path only counts partialSig entries by pubkey
 * (see classifyPartialSigs above), it doesn't verify them, so relying on it
 * alone would undo the guarantee combineSignedPsbt exists to provide. */
export function finalizeSpend(tx, m) {
  const { ready } = signatureProgress(tx, m);
  if (!ready) {
    throw new Error('Todavia no hay suficientes firmas validas en todos los inputs para completar el quorum.');
  }
  tx.finalize();
  return { hex: tx.hex, txid: tx.id };
}
