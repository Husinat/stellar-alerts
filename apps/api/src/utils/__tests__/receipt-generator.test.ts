import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generateTransactionReceiptPdf,
  computeReceiptVerificationHash,
  TransactionReceiptInput,
} from '../receipt-generator';
import { paymentsController } from '../../modules/payments/payments.controller';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    payment: {
      findFirst: vi.fn(),
    },
  },
}));

import { prisma } from '../../lib/prisma';

describe('Issue #262: Downloadable Transaction Receipts', () => {
  const mockXlmReceiptInput: TransactionReceiptInput = {
    paymentId: 'pay_xlm_1001',
    txHash: '0x1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff',
    fromAddress: 'GABC1234567890SENDERACCOUNT000000000000000000000000000',
    toWalletPublicKey: 'GRECEIVER1234567890ACCOUNT00000000000000000000000000',
    walletLabel: 'Main Treasury',
    amount: '500.0000000',
    asset: 'XLM',
    assetIssuer: null,
    memo: 'Invoice #1042 Payment',
    receivedAt: new Date('2026-09-23T12:00:00Z'),
    userEmail: 'freelancer@stellar-alerts.org',
  };

  const mockUsdcReceiptInput: TransactionReceiptInput = {
    paymentId: 'pay_usdc_2002',
    txHash: '0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
    fromAddress: 'GBUYER987654321ACCOUNT0000000000000000000000000000000',
    toWalletPublicKey: 'GSELLER1234567890ACCOUNT00000000000000000000000000000',
    walletLabel: 'USDC Vault',
    amount: '1250.50',
    asset: 'USDC',
    assetIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335WFOPVQOI3M7G73X2D4J80000',
    memo: 'Milestone 2 Completed',
    receivedAt: '2026-09-23T14:30:00Z',
    userEmail: 'freelancer@stellar-alerts.org',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Receipt PDF Generator Engine', () => {
    it('generates a valid, deterministic PDF buffer for XLM native transactions', async () => {
      const result = await generateTransactionReceiptPdf(mockXlmReceiptInput);

      expect(Buffer.isBuffer(result.buffer)).toBe(true);
      expect(result.buffer.length).toBeGreaterThan(500);
      expect(result.buffer.subarray(0, 5).toString('utf-8')).toBe('%PDF-');
      expect(result.stellarExpertUrl).toContain(mockXlmReceiptInput.txHash);
      expect(result.verificationHash).toHaveLength(64); // SHA-256 hex
    });

    it('generates a valid PDF buffer for custom issued assets with issuer address (USDC)', async () => {
      const result = await generateTransactionReceiptPdf(mockUsdcReceiptInput);

      expect(Buffer.isBuffer(result.buffer)).toBe(true);
      expect(result.buffer.subarray(0, 5).toString('utf-8')).toBe('%PDF-');
      expect(result.verificationHash).toHaveLength(64);
    });

    it('computes stable SHA-256 verification hashes', () => {
      const hash1 = computeReceiptVerificationHash(mockXlmReceiptInput);
      const hash2 = computeReceiptVerificationHash(mockXlmReceiptInput);
      expect(hash1).toBe(hash2);
    });
  });

  describe('GET /payments/:txHash/receipt Controller Access Control', () => {
    it('returns 401 Unauthorized if user is unauthenticated', async () => {
      const req: any = { params: { txHash: '0x123' }, user: null };
      const reply: any = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn(),
      };

      await paymentsController.getReceipt(req, reply);

      expect(reply.status).toHaveBeenCalledWith(401);
      expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ error: 'Unauthorized' }));
    });

    it('returns 404 Not Found if transaction does not exist', async () => {
      (prisma.payment.findFirst as any).mockResolvedValue(null);

      const req: any = { params: { txHash: 'nonexistent_tx' }, user: { id: 'usr_1' } };
      const reply: any = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn(),
      };

      await paymentsController.getReceipt(req, reply);

      expect(reply.status).toHaveBeenCalledWith(404);
      expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ error: 'Payment transaction not found' }));
    });

    it('returns 403 Forbidden if requesting user does not own the wallet', async () => {
      (prisma.payment.findFirst as any).mockResolvedValue({
        id: 'pay_123',
        txHash: '0x123',
        wallet: { userId: 'usr_OTHER_OWNER' },
      });

      const req: any = { params: { txHash: '0x123' }, user: { id: 'usr_REQUESTER' } };
      const reply: any = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn(),
      };

      await paymentsController.getReceipt(req, reply);

      expect(reply.status).toHaveBeenCalledWith(403);
      expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ error: 'Forbidden' }));
    });

    it('returns 200 OK with application/pdf header when user owns the wallet', async () => {
      const mockPayment = {
        id: 'pay_123',
        txHash: '0x1234567890abcdef',
        fromAddress: 'GFROM123',
        amount: '100',
        asset: 'XLM',
        assetIssuer: null,
        memo: null,
        receivedAt: new Date(),
        wallet: {
          publicKey: 'GWALLET123',
          label: 'Main',
          userId: 'usr_OWNER',
          user: { email: 'owner@example.com' },
        },
      };

      (prisma.payment.findFirst as any).mockResolvedValue(mockPayment);

      const req: any = { params: { txHash: '0x1234567890abcdef' }, user: { id: 'usr_OWNER' } };
      const reply: any = {
        header: vi.fn().mockReturnThis(),
        send: vi.fn(),
      };

      await paymentsController.getReceipt(req, reply);

      expect(reply.header).toHaveBeenCalledWith('Content-Type', 'application/pdf');
      expect(reply.header).toHaveBeenCalledWith('Content-Disposition', expect.stringContaining('receipt-0x1234567890.pdf'));
      expect(reply.send).toHaveBeenCalledWith(expect.any(Buffer));
    });
  });
});
