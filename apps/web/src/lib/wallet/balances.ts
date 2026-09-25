/**
 * Fetches an account's balances directly from Horizon for display right
 * after connecting a wallet. Horizon returns 404 for unfunded accounts,
 * which is a normal state for a freshly created testnet keypair, not an
 * error worth surfacing as one.
 */
const HORIZON_URL =
  process.env.NEXT_PUBLIC_HORIZON_URL || 'https://horizon-testnet.stellar.org';

export interface WalletBalance {
  assetCode: string;
  assetIssuer: string | null;
  balance: string;
}

export interface FetchBalancesResult {
  balances: WalletBalance[];
  isFunded: boolean;
}

export async function fetchAccountBalances(publicKey: string): Promise<FetchBalancesResult> {
  const res = await fetch(`${HORIZON_URL}/accounts/${encodeURIComponent(publicKey)}`);

  if (res.status === 404) {
    return { balances: [], isFunded: false };
  }

  if (!res.ok) {
    throw new Error(`Horizon returned ${res.status} while fetching balances`);
  }

  const data = await res.json();
  const rawBalances: any[] = Array.isArray(data?.balances) ? data.balances : [];

  const balances: WalletBalance[] = rawBalances.map((entry) => ({
    assetCode: entry.asset_type === 'native' ? 'XLM' : entry.asset_code || 'Unknown',
    assetIssuer: entry.asset_type === 'native' ? null : entry.asset_issuer || null,
    balance: entry.balance,
  }));

  return { balances, isFunded: true };
}
