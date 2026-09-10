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
