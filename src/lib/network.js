import { EsploraProvider } from '@scure/btc-signer/net.js';
import * as btc from '@scure/btc-signer';

const BASE_URL = {
  mainnet: 'https://mempool.space/api',
  testnet: 'https://mempool.space/testnet/api',
};

export function btcNetwork(isTestnet) {
  return isTestnet ? btc.TEST_NETWORK : btc.NETWORK;
}

export function createProvider(isTestnet) {
  const url = isTestnet ? BASE_URL.testnet : BASE_URL.mainnet;
  return new EsploraProvider(fetch.bind(globalThis), url, btcNetwork(isTestnet));
}

// Esplora fee-estimate confirmation targets shown when building a spend.
export const FEE_TARGETS = [
  { key: 'fast', target: 1 },
  { key: 'medium', target: 6 },
  { key: 'economy', target: 144 },
];

export async function fetchFeeEstimates(provider) {
  const entries = await Promise.all(
    FEE_TARGETS.map(async ({ key, target }) => {
      try {
        return [key, await provider.fee(target)];
      } catch {
        return [key, null];
      }
    })
  );
  return Object.fromEntries(entries);
}

/**
 * Fetches full UTXOs (not just balance) for a set of wallet addresses -
 * needed once building a spend, unlike Phase 1's lightweight balance-only
 * scan. Deliberately sequential (one address at a time), same reasoning as
 * BTC Airgap Bridge: a burst of parallel requests is what triggers
 * mempool.space's rate limiting in practice.
 */
export async function fetchUtxosForAddresses(provider, addressEntries) {
  const utxos = [];
  for (const entry of addressEntries) {
    const { utxo } = await provider.unspent(entry.address);
    for (const item of utxo) {
      utxos.push({ txid: item.txid, index: item.index, nonWitnessUtxo: item.nonWitnessUtxo, addressEntry: entry });
    }
  }
  return utxos;
}
