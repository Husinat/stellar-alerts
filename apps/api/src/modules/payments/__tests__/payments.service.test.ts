import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../lib/prisma', () => ({
  prisma: {
    payment: {
      findMany: vi.fn(),
      aggregate: vi.fn(),
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
});
