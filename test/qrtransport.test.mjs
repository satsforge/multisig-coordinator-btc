import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from '@noble/hashes/utils.js';
import { mnemonicToSeedSync } from '@scure/bip39';
import { HDKey } from '@scure/bip32';
import * as btc from '@scure/btc-signer';
import { base64 } from '@scure/base';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { deriveMultisigPayment, parseExtendedPubkey } from '../src/lib/descriptor.js';
import { buildSpendTx, annotateUtxosForSpend } from '../src/lib/txbuilder.js';
import { encodeToQrParts, decodeQrParts, looksLikeBbqrPart } from '../src/lib/qrtransport.js';

// Rasterizes a BBQr part string into RGBA pixel data using the SAME `qrcode`
// library the app bundles for display, then decodes it with the SAME jsQR
// library the app bundles for camera scanning. This exercises the real
// image<->scan pipeline end to end (unlike a text-level round trip alone) -
// the one part of Phase 3 that doesn't require a live camera or hardware
// wallet to verify for real.
function rasterizeQr(text) {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'L' });
  const scale = 4;
  const margin = 4;
  const size = qr.modules.size;
  const imgSize = (size + margin * 2) * scale;
  const data = new Uint8ClampedArray(imgSize * imgSize * 4).fill(255);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!qr.modules.data[y * size + x]) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const px = (margin + x) * scale + dx;
          const py = (margin + y) * scale + dy;
          const idx = (py * imgSize + px) * 4;
          data[idx] = 0;
          data[idx + 1] = 0;
          data[idx + 2] = 0;
        }
      }
    }
  }
  return { data, width: imgSize, height: imgSize };
}

function scanParts(parts) {
  return parts.map((part) => {
    const { data, width, height } = rasterizeQr(part);
    const result = jsQR(data, width, height);
    assert.ok(result, 'jsQR must decode a QR image this same pipeline just rendered');
    return result.data;
  });
}

function realUnsignedPsbtBytes() {
  const ACCOUNT_PATH = "48'/0'/0'/2'";
  const mnemonics = [
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong',
    'legal winner thank year wave sausage worth useful legal winner thank yellow',
  ];
  const network = btc.NETWORK;
  const cosigners = mnemonics.map((m) => {
    const seed = mnemonicToSeedSync(m, '');
    const root = HDKey.fromMasterSeed(seed);
    const fingerprint = root.fingerprint.toString(16).padStart(8, '0');
    const xpub = root.derive(`m/${ACCOUNT_PATH}`).publicExtendedKey;
    return { fingerprint, path: ACCOUNT_PATH, xpub, node: parseExtendedPubkey(xpub, false) };
  });
  const wallet = { m: 2, n: 3, cosigners };
  const payment0 = deriveMultisigPayment(cosigners.map((c) => c.node), 2, 0, 0, network);
  const funding = new btc.Transaction({ version: 1 });
  funding.addInput({ txid: new Uint8Array(32), index: 0xffffffff });
  funding.addOutput({ script: payment0.script, amount: 150_000n });
  const utxo = {
    txid: funding.id, index: 0, nonWitnessUtxo: funding.unsignedTx,
    addressEntry: { chain: 0, index: 0, address: payment0.address },
  };
  const utxos = annotateUtxosForSpend([utxo], wallet, network);
  const destinationAddress = btc.getAddress('wpkh', randomBytes(32), network);
  const built = buildSpendTx({
    wallet, utxos, destinationAddress, amountSats: 40_000n, feePerByte: 2n,
    changeEntry: { chain: 1, index: 0 }, network, sendMax: false,
  });
  return built.tx.toPSBT();
}

test('a real multisig unsigned PSBT round-trips through BBQr -> real QR images -> jsQR scan -> BBQr join', () => {
  const original = realUnsignedPsbtBytes();
  const parts = encodeToQrParts(original, 'P');
  assert.ok(parts.length >= 1);
  for (const part of parts) assert.equal(looksLikeBbqrPart(part), true);

  const scanned = scanParts(parts);
  // Parts must reassemble correctly regardless of scan order, since a
  // camera won't necessarily see an animated sequence start-to-end.
  const shuffled = [...scanned].reverse();
  const decoded = decodeQrParts(shuffled);
  const decodedBytes = base64.decode(decoded);
  assert.deepEqual(decodedBytes, original);
});

test('a small payload splits into exactly one QR part', () => {
  const parts = encodeToQrParts(new TextEncoder().encode('hello'), 'U');
  assert.equal(parts.length, 1);
  const decoded = decodeQrParts(parts);
  assert.equal(decoded, 'hello');
});

test('a large payload splits into multiple QR parts, all of which scan and reassemble correctly', () => {
  const big = randomBytes(4000);
  const parts = encodeToQrParts(big, 'B');
  assert.ok(parts.length > 1, 'a 4000-byte payload should not fit in a single QR part');

  const scanned = scanParts(parts);
  const decoded = decodeQrParts(scanned);
  const decodedBytes = base64.decode(decoded);
  assert.deepEqual(decodedBytes, big);
});

test('looksLikeBbqrPart rejects plain text that is not BBQr-framed', () => {
  assert.equal(looksLikeBbqrPart('cHNidP8BAH0'), false);
  assert.equal(looksLikeBbqrPart(''), false);
  assert.equal(looksLikeBbqrPart(null), false);
});
