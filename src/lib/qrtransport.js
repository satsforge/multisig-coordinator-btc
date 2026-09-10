import { splitQRs, joinQRs } from 'bbqr';
import { base64 } from '@scure/base';

// Thin seam over the official Coinkite `bbqr` library (used by Coldcard and
// widely supported by other signers/coordinators) - this file owns the only
// two decisions this tool makes about the format: which fileType code to
// use for each kind of payload, and how to turn the decoded bytes back into
// the text string the rest of the app already knows how to parse.

/** Splits arbitrary bytes into one or more BBQr QR-code payload strings. */
export function encodeToQrParts(bytes, fileType) {
  return splitQRs(bytes, fileType, { minSplit: 1 }).parts;
}

/** A scanned string is a BBQr part if it carries the "B$" framing header. */
export function looksLikeBbqrPart(text) {
  return typeof text === 'string' && text.length >= 2 && text[0] === 'B' && text[1] === '$';
}

/**
 * Reassembles a complete set of scanned BBQr parts back into text this
 * tool's own parsers (decodePsbt, parseMultisigDescriptor, ...) already
 * accept: binary payloads (PSBT/transaction) become base64, text payloads
 * decode as UTF-8 directly.
 */
export function decodeQrParts(parts) {
  const { fileType, raw } = joinQRs(parts);
  if (fileType === 'U' || fileType === 'J') {
    return new TextDecoder().decode(raw);
  }
  return base64.encode(raw);
}
