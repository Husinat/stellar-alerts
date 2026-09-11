/**
 * Adapter Layer Exports
 * 
 * Individual adapters for fine-grained control when needed.
 * For dashboard/portfolio use, prefer the batched reader.
 */

export { ApiAdapter } from './api.adapter';
export { WalletAdapter } from './wallet.adapter';
export { PaymentAdapter } from './payment.adapter';
export type { ApiConfig } from './api.adapter';
export type {
  GetWalletsResponse,
} from './wallet.adapter';
export type {
  GetPaymentsResponse,
  GetPaymentsSummaryResponse,
} from './payment.adapter';
