import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockPayment } = vi.hoisted(() => ({
  mockPayment: {
    findMany: vi.fn(),
    aggregate: vi.fn(),
  },
}));

vi.mock('../../../lib/prisma', () => ({
  prisma: {
    payment: mockPayment,
    sorobanEventSnapshot: {
      findMany: vi.fn(),
    },
    sorobanContractSubscription: {
      findMany: vi.fn(),
    },
  },
  prismaRead: {
    payment: mockPayment,
    sorobanEventSnapshot: {
      findMany: vi.fn(),
    },
    sorobanContractSubscription: {
      findMany: vi.fn(),
    },
  },
}));

import { PaymentsService } from '../payments.service';
import { prisma } from '../../../lib/prisma';

describe('PaymentsService', () => {
  let service: PaymentsService;

  beforeEach(() => {
    service = new PaymentsService();
    vi.clearAllMocks();
  });

  describe('getPayments', () => {
    it('scopes to every wallet the user owns when no walletId is given', async () => {
      (prisma.payment.findMany as any).mockResolvedValue([]);

      await service.getPayments('user-1');

      expect(prisma.payment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { wallet: { userId: 'user-1' } } }),
      );
    });

    it('scopes to a single wallet, but still requires that wallet belong to the user', async () => {
      (prisma.payment.findMany as any).mockResolvedValue([]);

      await service.getPayments('user-1', 'wallet-9', 10);

      expect(prisma.payment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { walletId: 'wallet-9', wallet: { userId: 'user-1' } },
          take: 10,
        }),
      );
    });

    it('defaults to sorting by receivedAt desc when no sort is given', async () => {
      (prisma.payment.findMany as any).mockResolvedValue([]);

      await service.getPayments('user-1');

      expect(prisma.payment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { receivedAt: 'desc' } }),
      );
    });

    it('sorts by the requested field and order', async () => {
      (prisma.payment.findMany as any).mockResolvedValue([]);

      await service.getPayments('user-1', undefined, 20, { sortBy: 'amount', sortOrder: 'asc' });

      expect(prisma.payment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { amount: 'asc' } }),
      );
    });

    it('filters by asset, still scoped to the user\'s wallets', async () => {
      (prisma.payment.findMany as any).mockResolvedValue([]);

      await service.getPayments('user-1', undefined, 20, { asset: 'USDC' });

      expect(prisma.payment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { wallet: { userId: 'user-1' }, asset: 'USDC' },
        }),
      );
    });

    it('filters by memo with a case-insensitive contains match', async () => {
      (prisma.payment.findMany as any).mockResolvedValue([]);

      await service.getPayments('user-1', undefined, 20, { memo: 'invoice-42' });

      expect(prisma.payment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            wallet: { userId: 'user-1' },
            memo: { contains: 'invoice-42', mode: 'insensitive' },
          },
        }),
      );
    });

    it('filters by a receivedAt date range', async () => {
      (prisma.payment.findMany as any).mockResolvedValue([]);
      const dateFrom = new Date('2026-01-01T00:00:00.000Z');
      const dateTo = new Date('2026-01-31T00:00:00.000Z');

      await service.getPayments('user-1', undefined, 20, { dateFrom, dateTo });

      expect(prisma.payment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            wallet: { userId: 'user-1' },
            receivedAt: { gte: dateFrom, lte: dateTo },
          },
        }),
      );
    });

    it('combines walletId, asset, memo, date range, and sort in one query, still scoped to the user', async () => {
      (prisma.payment.findMany as any).mockResolvedValue([]);
      const dateFrom = new Date('2026-01-01T00:00:00.000Z');

      await service.getPayments('user-1', 'wallet-9', 5, {
        asset: 'XLM',
        memo: 'rent',
        dateFrom,
        sortBy: 'asset',
        sortOrder: 'asc',
      });

      expect(prisma.payment.findMany).toHaveBeenCalledWith({
        where: {
          walletId: 'wallet-9',
          wallet: { userId: 'user-1' },
          asset: 'XLM',
          memo: { contains: 'rent', mode: 'insensitive' },
          receivedAt: { gte: dateFrom },
        },
        orderBy: { asset: 'asc' },
        take: 5,
      });
    });
  });

  describe('getPaymentsSummary', () => {
    it('aggregates across all of the user\'s wallets when walletId is omitted', async () => {
      (prisma.payment.aggregate as any).mockResolvedValue({
        _sum: { amount: 42 },
        _count: { id: 3 },
      });

      const summary = await service.getPaymentsSummary('user-1');

      expect(prisma.payment.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({ where: { wallet: { userId: 'user-1' } } }),
      );
      expect(summary).toEqual({ totalReceived: 42, totalVolumeXLM: 42, paymentCount: 3, totalPayments: 3 });
    });

    it('scopes the aggregate to one wallet owned by the user when walletId is given', async () => {
      (prisma.payment.aggregate as any).mockResolvedValue({ _sum: {}, _count: {} });

      await service.getPaymentsSummary('user-1', 'wallet-9');

      expect(prisma.payment.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({ where: { walletId: 'wallet-9', wallet: { userId: 'user-1' } } }),
      );
    });
  });

  describe('getCrossLedgerAnalytics', () => {
    it('calculates combined daily volume, transaction count, and average payment size across Stellar streams', async () => {
      (prisma.payment.findMany as any).mockResolvedValue([
        {
          amount: '100.5',
          receivedAt: new Date('2026-08-30T10:00:00Z'),
        },
        {
          amount: '50.0',
          receivedAt: new Date('2026-08-30T14:00:00Z'),
        },
      ]);

      ((prisma as any).sorobanContractSubscription.findMany as any).mockResolvedValue([
        { contractId: 'C12345' },
      ]);

      ((prisma as any).sorobanEventSnapshot.findMany as any).mockResolvedValue([
        {
          amount: '200.0',
          createdAt: new Date('2026-08-30T11:00:00Z'),
        },
      ]);

      const result = await service.getCrossLedgerAnalytics('user-1');

      expect(result.summary.totalVolume).toBe(350.5);
      expect(result.summary.totalTransactionCount).toBe(3);
      expect(result.summary.averagePaymentSize).toBe(116.8333);

      expect(result.summary.breakdown.classic.volume).toBe(150.5);
      expect(result.summary.breakdown.classic.count).toBe(2);
      expect(result.summary.breakdown.classic.averageSize).toBe(75.25);

      expect(result.summary.breakdown.soroban.volume).toBe(200);
      expect(result.summary.breakdown.soroban.count).toBe(1);
      expect(result.summary.breakdown.soroban.averageSize).toBe(200);

      expect(result.daily).toHaveLength(1);
      expect(result.daily[0]).toEqual({
        date: '2026-08-30',
        totalVolume: 350.5,
        totalCount: 3,
        averagePaymentSize: 116.8333,
        classicVolume: 150.5,
        classicCount: 2,
        sorobanVolume: 200,
        sorobanCount: 1,
      });
    });
  });
});
