import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WalletsService } from '../wallets.service';
import { prisma } from '../../../lib/prisma';

vi.mock('../../../lib/prisma', () => ({
  prisma: {
    wallet: {
      create: vi.fn(),
      findMany: vi.fn(),
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
