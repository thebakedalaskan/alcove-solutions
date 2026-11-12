/*
 * Open in wallet, on a phone: a link that opens the payment in a wallet app with the token, the address and the exact
 * amount filled in (EIP-681), wherever the route itself names the token's contract. 1Click's routes for USDC on Ethereum,
 * Base and Arbitrum do (`nep141:base-0x8335….omft.near`), and their tokens have 6 decimals there, as the server's
 * allowlist pins them. Anywhere else there's no link, and Open in wallet copies the address instead: a link that named
 * the wrong token would send the wrong thing.
 */
import type { TopUpRoute } from '@alcove/api';

/** The EVM chains whose routes name their token, by 1Click's chain name, with their chain ID. */
const CHAIN_IDS = new Map<string, number>([['eth', 1], ['base', 8453], ['arb', 42161]]);
const DECIMALS = 6;

/** `amount` ("187.5") in the token's smallest units ("187500000"), or null when it has more places than the token. */
function baseUnits(amount: string): string | null {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(amount.trim());
  if (!m) return null;
  const fraction = m[2] ?? '';
  if (fraction.length > DECIMALS) return null;
  const units = `${m[1] ?? '0'}${fraction.padEnd(DECIMALS, '0')}`.replace(/^0+(?=\d)/, '');
  return units;
}

/** The link that pays `amount` of the route's token to `address` from a wallet on this phone, or null where there's none. */
export function walletLink(route: TopUpRoute, address: string, amount: string): string | null {
  const id = CHAIN_IDS.get(route.chain);
  const named = /^nep141:([a-z]+)-(0x[0-9a-fA-F]{40})\.omft\.near$/.exec(route.id);
  if (id === undefined || !named || named[1] !== route.chain || !/^0x[0-9a-fA-F]{40}$/.test(address)) return null;
  const units = baseUnits(amount);
  return units === null ? null : `ethereum:${named[2] ?? ''}@${id}/transfer?address=${address}&uint256=${units}`;
}
