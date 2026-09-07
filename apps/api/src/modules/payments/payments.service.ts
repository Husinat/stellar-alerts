import { prisma } from '../../lib/prisma';
import { addDifferentialPrivacyNoise } from '../../utils/differential-privacy';
import {
  convertUsdToFiat,
  isSupportedFiatCurrency,
  type SupportedFiatCurrency,
} from '../../lib/exchange-rates';

export class PaymentsService {
  /**
   * Lists payments for `userId`. When `walletId` is given, results are
   * additionally scoped to a wallet owned by that user — a caller can no
   * longer read another user's payments by guessing/reusing a walletId.
   * When omitted (the dashboard's "All Wallets" view), every wallet the
   * user owns is included.
   */
  async getPayments(userId: string, walletId?: string, limit: number = 20) {
    console.log(
      `[PaymentsService] Fetching up to ${limit} payments for user ${userId}${walletId ? ` (wallet ${walletId})` : ' (all wallets)'}`,
    );
    return prisma.payment.findMany({
      where: walletId ? { walletId, wallet: { userId } } : { wallet: { userId } },
      orderBy: { receivedAt: 'desc' },
      take: limit,
    });
  }

  async getPaymentsSummary(userId: string, walletId?: string, fiatCurrency?: string) {
    console.log(
      `[PaymentsService] Fetching summary for user ${userId}${walletId ? ` (wallet ${walletId})` : ' (all wallets)'}`,
    );
    const result = await prisma.payment.aggregate({
      where: walletId ? { walletId, wallet: { userId } } : { wallet: { userId } },
      _sum: { amount: true },
      _count: { id: true },
    });

    const totalReceivedUsd = Number(result._sum.amount || 0);
    const paymentCount = result._count.id || 0;

    const summary: Record<string, unknown> = {
      totalReceived: totalReceivedUsd,
      totalVolumeXLM: totalReceivedUsd,
      paymentCount,
      totalPayments: paymentCount,
    };

    // Fiat conversion when requested
    if (fiatCurrency && isSupportedFiatCurrency(fiatCurrency)) {
      const conversion = await convertUsdToFiat(
        totalReceivedUsd,
        fiatCurrency as SupportedFiatCurrency,
      );
      summary.fiatConversion = {
        currency: conversion.currency,
        convertedTotal: conversion.convertedAmount,
        exchangeRate: conversion.rate,
      };
    }

    return summary;
  }

  /**
   * Fetches public volume statistics protected with Laplace differential privacy noise.
   * Epsilon parameter controls privacy budget (lower epsilon = more privacy/noise).
   */
  async getPublicVolumeStats(epsilon: number = 0.5) {
    console.log(`[PaymentsService] Fetching differentially private public volume stats (epsilon=${epsilon})`);
    const aggregate = await prisma.payment.aggregate({
      _sum: { amount: true },
      _count: { id: true },
    });

    const rawTotalVolume = Number(aggregate._sum.amount || 0);
    const noisyVolume = addDifferentialPrivacyNoise(rawTotalVolume, epsilon, 1.0);

    return {
      rawTotalVolume,
      noisyTotalVolume: noisyVolume,
      totalPayments: aggregate._count.id || 0,
      epsilon,
      anonymized: true,
    };
  }
}

export const paymentsService = new PaymentsService();
