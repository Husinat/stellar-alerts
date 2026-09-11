/**
 * Batched Read Layer
 * 
 * Groups semantically related API calls into a single batched operation.
 * Implements caching with per-window TTL to minimize RPC fan-out on
 * dashboard and portfolio screens.
 * 
 * Before: Each row triggers separate get_pool/get_user_bet/claim-status calls
 * After: Single batched call fetches all data at once, cached for TTL window
 */

import { WalletDTO, PaymentDTO } from '@stellar-alerts/shared';
import { WalletAdapter } from '../adapters/wallet.adapter';
import { PaymentAdapter } from '../adapters/payment.adapter';
import { Cache } from './cache';

export interface UserPortfolioData {
  wallets: WalletDTO[];
  payments: PaymentDTO[];
  summary: {
    totalVolumeXLM: number;
    totalPayments: number;
  };
}

export interface DashboardData {
  wallets: WalletDTO[];
  allPayments: PaymentDTO[];
  summary: {
    totalVolumeXLM: number;
    totalPayments: number;
  };
}

export interface BatchReaderConfig {
  walletAdapter: WalletAdapter;
  paymentAdapter: PaymentAdapter;
  cacheTtlMs?: number; // Default: 30 seconds
}

export class BatchReader {
  private walletAdapter: WalletAdapter;
  private paymentAdapter: PaymentAdapter;
  private portfolioCache: Cache<UserPortfolioData>;
  private dashboardCache: Cache<DashboardData>;
  private walletCache: Cache<WalletDTO[]>;

  constructor(config: BatchReaderConfig) {
    this.walletAdapter = config.walletAdapter;
    this.paymentAdapter = config.paymentAdapter;
    
    const ttlMs = config.cacheTtlMs ?? 30000; // 30s default
    
    this.portfolioCache = new Cache({ ttlMs });
    this.dashboardCache = new Cache({ ttlMs });
    this.walletCache = new Cache({ ttlMs });
  }

  /**
   * Fetch complete user portfolio in a single batched operation.
   * 
   * Replaces:
   * - Individual wallet fetches per row
   * - Individual payment fetches per wallet
   * - Separate summary fetch
   * 
   * With a single cached response.
   */
  async fetchUserPortfolioBatched(walletId?: string): Promise<UserPortfolioData> {
    const cacheKey = `portfolio:${walletId || 'all'}`;
    
    // Check cache first
    const cached = this.portfolioCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // Execute all fetches in parallel
    const [wallets, payments, summary] = await Promise.all([
      this.walletAdapter.getWallets(),
      this.paymentAdapter.getPayments(walletId),
      this.paymentAdapter.getPaymentsSummary(),
    ]);

    const result: UserPortfolioData = {
      wallets,
      payments,
      summary,
    };

    // Store in cache
    this.portfolioCache.set(cacheKey, result);

    return result;
  }

  /**
   * Fetch complete dashboard data in a single batched operation.
   * 
   * Groups wallet list, all payments, and summary stats into one call.
   */
  async fetchDashboardBatched(): Promise<DashboardData> {
    const cacheKey = 'dashboard:main';
    
    // Check cache first
    const cached = this.dashboardCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // Execute all fetches in parallel
    const [wallets, allPayments, summary] = await Promise.all([
      this.walletAdapter.getWallets(),
      this.paymentAdapter.getPayments(),
      this.paymentAdapter.getPaymentsSummary(),
    ]);

    const result: DashboardData = {
      wallets,
      allPayments,
      summary,
    };

    // Store in cache
    this.dashboardCache.set(cacheKey, result);

    return result;
  }

  /**
   * Fetch wallets with caching.
   * 
   * Simple cached wallet list for components that only need wallet data.
   */
  async fetchWalletsCached(): Promise<WalletDTO[]> {
    const cacheKey = 'wallets:all';
    
    // Check cache first
    const cached = this.walletCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const wallets = await this.walletAdapter.getWallets();
    
    // Store in cache
    this.walletCache.set(cacheKey, wallets);

    return wallets;
  }

  /**
   * Invalidate all caches.
   * 
   * Call this after mutations (create/delete wallet, etc.) to ensure
   * fresh data on next fetch.
   */
  invalidateAll(): void {
    this.portfolioCache.clear();
    this.dashboardCache.clear();
    this.walletCache.clear();
  }

  /**
   * Invalidate portfolio cache.
   */
  invalidatePortfolio(walletId?: string): void {
    const cacheKey = `portfolio:${walletId || 'all'}`;
    this.portfolioCache.delete(cacheKey);
  }

  /**
   * Invalidate dashboard cache.
   */
  invalidateDashboard(): void {
    this.dashboardCache.delete('dashboard:main');
  }
}
