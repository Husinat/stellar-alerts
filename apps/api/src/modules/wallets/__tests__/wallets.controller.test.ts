import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WalletsController } from '../wallets.controller';
import { walletsService } from '../wallets.service';

vi.mock('../wallets.service', () => ({
  walletsService: {
    addWallet: vi.fn(),
    getWallets: vi.fn(),
    removeWallet: vi.fn(),
  },
}));

describe('WalletsController', () => {
  let walletsController: WalletsController;
  let mockRequest: any;
  let mockReply: any;

  beforeEach(() => {
    walletsController = new WalletsController();
    vi.clearAllMocks();

    mockReply = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };
  });

  describe('addWallet', () => {
    it('returns status 201 when wallet is added successfully', async () => {
      mockRequest = {
        user: { id: 'u-1' },
        body: {
          publicKey: 'GBPDX2DPUHABCGNHXQRNK5A6NGV5R7T244HJ5CXAWSWVRTZR4WMADE72',
          label: 'Test Wallet',
        },
      };

      const mockWallet = { id: 'w-1', publicKey: mockRequest.body.publicKey };
      vi.mocked(walletsService.addWallet).mockResolvedValue(mockWallet as any);

      await walletsController.addWallet(mockRequest, mockReply);

      expect(mockReply.status).toHaveBeenCalledWith(201);
      expect(mockReply.send).toHaveBeenCalledWith({ success: true, wallet: mockWallet });
    });

    it('returns status 409 Conflict when duplicate wallet registration occurs', async () => {
      mockRequest = {
        user: { id: 'u-1' },
        body: {
          publicKey: 'GBPDX2DPUHABCGNHXQRNK5A6NGV5R7T244HJ5CXAWSWVRTZR4WMADE72',
        },
      };

      vi.mocked(walletsService.addWallet).mockRejectedValue(new Error('Wallet already exists'));

      await walletsController.addWallet(mockRequest, mockReply);

      expect(mockReply.status).toHaveBeenCalledWith(409);
      expect(mockReply.send).toHaveBeenCalledWith({
        error: 'Conflict',
        message: 'Wallet address is already registered',
      });
    });

    it('returns status 400 Bad Request when payload is invalid', async () => {
      mockRequest = {
        user: { id: 'u-1' },
        body: {
          publicKey: 'INVALID_STELLAR_ADDRESS',
        },
      };

      await walletsController.addWallet(mockRequest, mockReply);

      expect(mockReply.status).toHaveBeenCalledWith(400);
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Invalid payload' })
      );
    });
  });
});
