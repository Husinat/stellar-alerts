/**
 * Validates whether a given string is a valid Stellar Ed25519 Public Key (starts with G, 56 chars).
 */
export function isValidStellarPublicKey(publicKey: string): boolean {
  return (
    typeof publicKey === 'string' &&
    publicKey.length === 56 &&
    publicKey.startsWith('G')
  );
}

export interface WalletDTO {
  id: string;
  userId: string;
  publicKey: string;
  label?: string | null;
  createdAt: Date | string;
}

export interface PaymentDTO {
  id: string;
  walletId: string;
  txHash: string;
  fromAddress: string;
  amount: number | string;
  asset: string;
  memo?: string | null;
  receivedAt: Date | string;
}
