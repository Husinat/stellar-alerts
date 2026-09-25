import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PaymentsController } from '../payments.controller';
import { paymentsService } from '../payments.service';

vi.mock('../payments.service', () => ({
  paymentsService: {
    getPaymentsSummary: vi.fn(),
    getPayments: vi.fn(),
  }
}));

describe('PaymentsController', () => {
  let paymentsController: PaymentsController;
  let mockRequest: any;
  let mockReply: any;

  beforeEach(() => {
    paymentsController = new PaymentsController();
    vi.clearAllMocks();
    
    mockReply = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };
  });

  describe('getPayments', () => {
    it('passes asset, memo, date range, and sort filters through to the service', async () => {
      mockRequest = {
        query: {
          walletId: 'wallet_123',
          asset: 'USDC',
          memo: 'invoice-42',
          dateFrom: '2026-01-01T00:00:00.000Z',
          dateTo: '2026-01-31T00:00:00.000Z',
          sortBy: 'amount',
          sortOrder: 'asc',
        },
        user: { id: 'user-1' },
      };
      vi.mocked(paymentsService.getPayments).mockResolvedValue([]);

      await paymentsController.getPayments(mockRequest, mockReply);

      expect(paymentsService.getPayments).toHaveBeenCalledWith(
        'user-1',
        'wallet_123',
        20,
        {
          asset: 'USDC',
          memo: 'invoice-42',
          dateFrom: new Date('2026-01-01T00:00:00.000Z'),
          dateTo: new Date('2026-01-31T00:00:00.000Z'),
          sortBy: 'amount',
          sortOrder: 'asc',
        },
      );
      expect(mockReply.send).toHaveBeenCalledWith({ success: true, payments: [] });
    });

    it('defaults sortBy/sortOrder when not provided', async () => {
      mockRequest = { query: {}, user: { id: 'user-1' } };
      vi.mocked(paymentsService.getPayments).mockResolvedValue([]);

      await paymentsController.getPayments(mockRequest, mockReply);

      expect(paymentsService.getPayments).toHaveBeenCalledWith(
        'user-1',
        undefined,
        20,
        expect.objectContaining({ sortBy: 'receivedAt', sortOrder: 'desc' }),
      );
    });

    it('rejects an unknown sortBy value', async () => {
      mockRequest = { query: { sortBy: 'fromAddress' }, user: { id: 'user-1' } };

      await paymentsController.getPayments(mockRequest, mockReply);

      expect(mockReply.status).toHaveBeenCalledWith(400);
      expect(paymentsService.getPayments).not.toHaveBeenCalled();
    });

    it('rejects a dateFrom after dateTo', async () => {
      mockRequest = {
        query: { dateFrom: '2026-02-01T00:00:00.000Z', dateTo: '2026-01-01T00:00:00.000Z' },
        user: { id: 'user-1' },
      };

      await paymentsController.getPayments(mockRequest, mockReply);

      expect(mockReply.status).toHaveBeenCalledWith(400);
      expect(paymentsService.getPayments).not.toHaveBeenCalled();
    });
  });

  describe('getPaymentsSummary', () => {
    it('should pass if walletId is missing because it is optional', async () => {
      mockRequest = { query: {}, user: { id: 'user-1' } };
      
      const mockSummary = { volume: 1500, count: 5 };
      vi.mocked(paymentsService.getPaymentsSummary).mockResolvedValue(mockSummary);
      
      await paymentsController.getPaymentsSummary(mockRequest, mockReply);
      
      expect(mockReply.send).toHaveBeenCalledWith({ success: true, summary: mockSummary });
      
    });

    it('should return volume and count for a valid walletId', async () => {
      mockRequest = { query: { walletId: 'wallet_123' }, user: { id: 'user-1' } };
      const mockSummary = { volume: 1500, count: 5 };
      
      vi.mocked(paymentsService.getPaymentsSummary).mockResolvedValue(mockSummary);
      
      await paymentsController.getPaymentsSummary(mockRequest, mockReply);
      
      expect(paymentsService.getPaymentsSummary).toHaveBeenCalledWith('user-1', 'wallet_123', undefined);
      expect(mockReply.send).toHaveBeenCalledWith({ success: true, summary: mockSummary });
    });
  });
});
