import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WalletsService } from '../wallets.service';
import { prisma } from '../../../lib/prisma';

vi.mock('../../../lib/prisma', () => ({
  prisma: {
    wallet: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}));

describe('WalletsService', () => {
  let walletsService: WalletsService;

  beforeEach(() => {
    walletsService = new WalletsService();
    vi.clearAllMocks();
  });

  describe('addWallet', () => {
    it('creates and returns a wallet successfully', async () => {
      const mockWallet = {
        id: 'w-1',
        userId: 'u-1',
        publicKey: 'GBPDX2DPUHABCGNHXQRNK5A6NGV5R7T244HJ5CXAWSWVRTZR4WMADE72',
        label: 'Treasury',
        createdAt: new Date(),
      };
      vi.mocked(prisma.wallet.create).mockResolvedValue(mockWallet as any);

      const result = await walletsService.addWallet('u-1', 'GBPDX2DPUHABCGNHXQRNK5A6NGV5R7T244HJ5CXAWSWVRTZR4WMADE72', 'Treasury');
      expect(result).toEqual(mockWallet);
      expect(prisma.wallet.create).toHaveBeenCalledWith({
        data: {
          userId: 'u-1',
          publicKey: 'GBPDX2DPUHABCGNHXQRNK5A6NGV5R7T244HJ5CXAWSWVRTZR4WMADE72',
          label: 'Treasury',
        },
      });
    });

    it('throws "Wallet already exists" error on Prisma P2002 duplicate key constraint failure', async () => {
      const duplicateError = new Error('Unique constraint failed') as any;
      duplicateError.code = 'P2002';
      vi.mocked(prisma.wallet.create).mockRejectedValue(duplicateError);

      await expect(
        walletsService.addWallet('u-1', 'GBPDX2DPUHABCGNHXQRNK5A6NGV5R7T244HJ5CXAWSWVRTZR4WMADE72')
      ).rejects.toThrow('Wallet already exists');
    });
  });

  describe('getIngestionStatus', () => {
    it('returns cursor health for a wallet owned by the requesting user', async () => {
      vi.mocked(prisma.wallet.findUnique).mockResolvedValue({
        id: 'w-1',
        userId: 'u-1',
        publicKey: 'GBPDX2DPUHABCGNHXQRNK5A6NGV5R7T244HJ5CXAWSWVRTZR4WMADE72',
        cursor: {
          pagingToken: '12345',
          status: 'gap_detected',
          consecutiveFailures: 2,
          lastError: 'All Horizon nodes unreachable',
          lastSuccessAt: new Date('2026-09-20T00:00:00.000Z'),
          lastSyncedAt: new Date('2026-09-23T00:00:00.000Z'),
          gapDetectedAt: new Date('2026-09-23T00:00:00.000Z'),
          lastGapLedgerDelta: 42,
        },
      } as any);

      const result = await walletsService.getIngestionStatus('u-1', 'w-1');

      expect(result).toEqual({
        walletId: 'w-1',
        publicKey: 'GBPDX2DPUHABCGNHXQRNK5A6NGV5R7T244HJ5CXAWSWVRTZR4WMADE72',
        pagingToken: '12345',
        status: 'gap_detected',
        consecutiveFailures: 2,
        lastError: 'All Horizon nodes unreachable',
        lastSuccessAt: new Date('2026-09-20T00:00:00.000Z'),
        lastSyncedAt: new Date('2026-09-23T00:00:00.000Z'),
        gapDetectedAt: new Date('2026-09-23T00:00:00.000Z'),
        lastGapLedgerDelta: 42,
      });
    });

    it('defaults to a healthy status when no cursor has been created yet', async () => {
      vi.mocked(prisma.wallet.findUnique).mockResolvedValue({
        id: 'w-1',
        userId: 'u-1',
        publicKey: 'GBPDX2...',
        cursor: null,
      } as any);

      const result = await walletsService.getIngestionStatus('u-1', 'w-1');

      expect(result).toEqual(
        expect.objectContaining({ status: 'active', consecutiveFailures: 0, pagingToken: null }),
      );
    });

    it('throws "Wallet not found" for a missing wallet', async () => {
      vi.mocked(prisma.wallet.findUnique).mockResolvedValue(null as any);

      await expect(walletsService.getIngestionStatus('u-1', 'w-missing')).rejects.toThrow('Wallet not found');
    });

    it('throws "Wallet not found" when the wallet belongs to a different user', async () => {
      vi.mocked(prisma.wallet.findUnique).mockResolvedValue({ id: 'w-1', userId: 'someone-else', cursor: null } as any);

      await expect(walletsService.getIngestionStatus('u-1', 'w-1')).rejects.toThrow('Wallet not found');
    });
  });

  describe('removeWallet', () => {
    it('removes wallet successfully', async () => {
      vi.mocked(prisma.wallet.delete).mockResolvedValue({} as any);

      const result = await walletsService.removeWallet('w-1');
      expect(result).toEqual({ success: true });
    });

    it('throws "Wallet not found" when Prisma P2025 error occurs', async () => {
      const notFoundError = new Error('Record not found') as any;
      notFoundError.code = 'P2025';
      vi.mocked(prisma.wallet.delete).mockRejectedValue(notFoundError);

      await expect(walletsService.removeWallet('w-invalid')).rejects.toThrow('Wallet not found');
    });
  });
});
