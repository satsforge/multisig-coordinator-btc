import { deriveMultisigPayment } from './descriptor.js';

const GAP_LIMIT = 20;
export const RECEIVE_CHAIN = 0;
export const CHANGE_CHAIN = 1;

/**
 * Gap-limit scans both chains of an M-of-N multisig wallet against a live
 * Esplora provider. Mirrors my_btc_wallet's watch-only scan (same gap-limit
 * value, same "balance() is enough, no need for the full UTXO list yet"
 * choice), generalized to derive a multisig payment per index instead of a
 * single-key one. Never touches a private key - `accountNodes` are already
 * public-only nodes (see descriptor.js's parseExtendedPubkey).
 */
export async function scanMultisigWallet(accountNodes, m, network, provider, onProgress) {
  const addresses = [];
  let totalBalance = 0n;

  for (const chain of [RECEIVE_CHAIN, CHANGE_CHAIN]) {
    let consecutiveUnused = 0;
    let index = 0;
    while (consecutiveUnused < GAP_LIMIT) {
      const payment = deriveMultisigPayment(accountNodes, m, chain, index, network);
      if (onProgress) onProgress({ chain, index, address: payment.address });

      const info = await provider.balance(payment.address);
      const used = info.txCount > 0;
      addresses.push({
        chain,
        index,
        address: payment.address,
        balance: info.balance,
        txCount: info.txCount,
      });
      totalBalance += info.balance;

      consecutiveUnused = used ? 0 : consecutiveUnused + 1;
      index++;
    }
  }

  return { addresses, totalBalance };
}

// scanMultisigWallet's own gap-limit loop never stops until it finds
// GAP_LIMIT (20) *consecutive* unused addresses on a chain, so under normal
// operation there are always unused ones to find here - falling back to
// onChain[0] (routinely an already-used address, since index 0 is the very
// first one the scan ever checked) would silently hand out a reused address
// instead of surfacing that something violated that invariant.
function firstUnusedOnChain(addresses, chain) {
  const onChain = addresses.filter((a) => a.chain === chain);
  return onChain.find((a) => a.txCount === 0) ?? null;
}

/** First unused receive address (chain 0), for the "Recibir" panel. */
export function firstUnusedReceiveAddress(addresses) {
  return firstUnusedOnChain(addresses, RECEIVE_CHAIN);
}

/** First unused change address (chain 1), for a spend's change output. */
export function firstUnusedChangeAddress(addresses) {
  return firstUnusedOnChain(addresses, CHANGE_CHAIN);
}
