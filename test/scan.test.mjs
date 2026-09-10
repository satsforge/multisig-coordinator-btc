import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mnemonicToSeedSync } from '@scure/bip39';
import { HDKey } from '@scure/bip32';
import * as btc from '@scure/btc-signer';
import { deriveMultisigPayment } from '../src/lib/descriptor.js';
import { scanMultisigWallet, firstUnusedReceiveAddress, RECEIVE_CHAIN, CHANGE_CHAIN } from '../src/lib/scan.js';

const network = btc.NETWORK;

function accountNodes() {
  const seedA = mnemonicToSeedSync('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about', '');
  const seedB = mnemonicToSeedSync('zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong', '');
  return [
    HDKey.fromMasterSeed(seedA).derive("m/48'/0'/0'/2'"),
    HDKey.fromMasterSeed(seedB).derive("m/48'/0'/0'/2'"),
  ];
}

// A fake Esplora provider: addresses in `funded` have a balance/txCount,
// everything else looks empty. Records every address queried so the test
// can assert the scan actually stopped at the gap limit instead of running
// forever.
function fakeProvider(funded) {
  const queried = [];
  return {
    queried,
    async balance(address) {
      queried.push(address);
      const hit = funded.get(address);
      return hit ?? { symbol: 'BTC', decimals: 8, balance: 0n, txCount: 0 };
    },
  };
}

test('scanMultisigWallet stops at the gap limit on an all-empty wallet', async () => {
  const nodes = accountNodes();
  const provider = fakeProvider(new Map());
  const { addresses, totalBalance } = await scanMultisigWallet(nodes, 2, network, provider);
  // 20 unused on each of 2 chains = 40 addresses total, nothing beyond.
  assert.equal(addresses.length, 40);
  assert.equal(addresses.filter((a) => a.chain === RECEIVE_CHAIN).length, 20);
  assert.equal(addresses.filter((a) => a.chain === CHANGE_CHAIN).length, 20);
  assert.equal(totalBalance, 0n);
});

test('scanMultisigWallet extends past the gap limit when a later address is used, and sums balances', async () => {
  const nodes = accountNodes();
  // Fund receive index 15 - inside the standard 20-address window, so the
  // scan actually reaches it, resets its unused counter there, and keeps
  // going until 20 MORE consecutive unused addresses follow it.
  const fundedAddress = deriveMultisigPayment(nodes, 2, RECEIVE_CHAIN, 15, network).address;
  const funded = new Map([[fundedAddress, { symbol: 'BTC', decimals: 8, balance: 55_000n, txCount: 1 }]]);
  const provider = fakeProvider(funded);

  const { addresses, totalBalance } = await scanMultisigWallet(nodes, 2, network, provider);
  assert.equal(totalBalance, 55_000n);
  const hit = addresses.find((a) => a.address === fundedAddress);
  assert.ok(hit);
  assert.equal(hit.index, 15);
  assert.equal(hit.balance, 55_000n);
  // Receive chain must have scanned past index 15 + 20 more unused (i.e. at least up to 34).
  const receiveIndices = addresses.filter((a) => a.chain === RECEIVE_CHAIN).map((a) => a.index);
  assert.ok(Math.max(...receiveIndices) >= 34);
});

test('firstUnusedReceiveAddress skips used receive addresses', async () => {
  const nodes = accountNodes();
  const usedAddress = deriveMultisigPayment(nodes, 2, RECEIVE_CHAIN, 0, network).address;
  const funded = new Map([[usedAddress, { symbol: 'BTC', decimals: 8, balance: 1000n, txCount: 1 }]]);
  const provider = fakeProvider(funded);
  const { addresses } = await scanMultisigWallet(nodes, 2, network, provider);
  const next = firstUnusedReceiveAddress(addresses);
  assert.equal(next.chain, RECEIVE_CHAIN);
  assert.equal(next.txCount, 0);
  assert.notEqual(next.address, usedAddress);
});
