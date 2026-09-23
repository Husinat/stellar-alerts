import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WalletsController } from '../wallets.controller';
import { walletsService } from '../wallets.service';

vi.mock('../wallets.service', () => ({
  walletsService: {
    addWallet: vi.fn(),
    getWallets: vi.fn(),
    getIngestionStatus: vi.fn(),
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

  describe('getIngestionStatus', () => {
    it('returns cursor health for the requested wallet', async () => {
      mockRequest = { user: { id: 'u-1' }, params: { id: 'w-1' } };
      const ingestion = { walletId: 'w-1', status: 'active', consecutiveFailures: 0 };
      vi.mocked(walletsService.getIngestionStatus).mockResolvedValue(ingestion as any);

      await walletsController.getIngestionStatus(mockRequest, mockReply);

      expect(walletsService.getIngestionStatus).toHaveBeenCalledWith('u-1', 'w-1');
      expect(mockReply.send).toHaveBeenCalledWith({ success: true, ingestion });
    });

    it('returns 404 when the wallet does not exist or is not owned by the requester', async () => {
      mockRequest = { user: { id: 'u-1' }, params: { id: 'w-missing' } };
      vi.mocked(walletsService.getIngestionStatus).mockRejectedValue(new Error('Wallet not found'));

      await walletsController.getIngestionStatus(mockRequest, mockReply);

      expect(mockReply.status).toHaveBeenCalledWith(404);
      expect(mockReply.send).toHaveBeenCalledWith({ error: 'Not Found', message: 'Wallet not found' });
    });
  });
});
