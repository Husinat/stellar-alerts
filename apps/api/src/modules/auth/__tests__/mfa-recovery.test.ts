import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MFAService } from '../mfa.service';
import {
  generateRecoveryCode,
  generateRecoveryCodes,
  hashRecoveryCode,
  verifyRecoveryCodeHash,
} from '../../../utils/recovery-codes';

vi.mock('../../../config/env', () => ({
  env: {
    JWT_SECRET: 'test-super-secret-jwt-key-12345',
  },
}));

vi.mock('../../../lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    mfaRecoveryCode: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
    securityAuditLog: {
      create: vi.fn(),
    },
  },
}));

import { prisma } from '../../../lib/prisma';

describe('MFA Recovery Codes (#317)', () => {
  let mfaService: MFAService;

  beforeEach(() => {
    mfaService = new MFAService();
    vi.clearAllMocks();
  });

  describe('recovery-codes utility', () => {
    it('should generate formatted recovery codes (XXXX-XXXX)', () => {
      const code = generateRecoveryCode();
      expect(code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    });

    it('should generate a set of unique recovery codes', () => {
      const codes = generateRecoveryCodes(10);
      expect(codes).toHaveLength(10);
      const unique = new Set(codes);
      expect(unique.size).toBe(10);
    });

    it('should correctly hash and verify recovery codes case-insensitively with formatting', () => {
      const plain = 'ABCD-EFGH';
      const hash = hashRecoveryCode(plain);

      expect(verifyRecoveryCodeHash('ABCD-EFGH', hash)).toBe(true);
      expect(verifyRecoveryCodeHash('abcd-efgh', hash)).toBe(true);
      expect(verifyRecoveryCodeHash('abcdefgh', hash)).toBe(true);
      expect(verifyRecoveryCodeHash(' abcd efgh ', hash)).toBe(true);
      expect(verifyRecoveryCodeHash('WXYZ-1234', hash)).toBe(false);
    });
  });

  describe('generateRecoveryCodes', () => {
    it('should delete existing codes, insert new hashed codes, and log an audit event', async () => {
      const userId = 'usr_test_123';
      (prisma.user.findUnique as any).mockResolvedValue({
        id: userId,
        email: 'user@example.com',
      });
      (prisma.mfaRecoveryCode.deleteMany as any).mockResolvedValue({ count: 5 });
      (prisma.mfaRecoveryCode.createMany as any).mockResolvedValue({ count: 10 });
      (prisma.securityAuditLog.create as any).mockResolvedValue({ id: 'audit_1' });

      const codes = await mfaService.generateRecoveryCodes(userId);

      expect(codes).toHaveLength(10);
      expect(prisma.mfaRecoveryCode.deleteMany).toHaveBeenCalledWith({ where: { userId } });
      expect(prisma.mfaRecoveryCode.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({
            userId,
            codeHash: expect.any(String),
          }),
        ]),
      });
      expect(prisma.securityAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          eventType: 'MFA_RECOVERY_CODES_GENERATED',
          severity: 'MEDIUM',
        }),
      });
    });

    it('should throw if user is not found', async () => {
      (prisma.user.findUnique as any).mockResolvedValue(null);
      await expect(mfaService.generateRecoveryCodes('non_existent')).rejects.toThrow('User not found');
    });
  });

  describe('getRecoveryCodeStatus', () => {
    it('should return total and remaining unused codes', async () => {
      const userId = 'usr_test_123';
      (prisma.mfaRecoveryCode.count as any)
        .mockResolvedValueOnce(10) // total
        .mockResolvedValueOnce(7); // remaining

      const status = await mfaService.getRecoveryCodeStatus(userId);
      expect(status).toEqual({ total: 10, remaining: 7 });
      expect(prisma.mfaRecoveryCode.count).toHaveBeenCalledWith({ where: { userId } });
      expect(prisma.mfaRecoveryCode.count).toHaveBeenCalledWith({ where: { userId, used: false } });
    });
  });

  describe('recoverAccountWithCode', () => {
    const email = 'lostdevice@example.com';
    const plainCode = 'ABCD-1234';
    const codeHash = hashRecoveryCode(plainCode);

    it('should successfully recover account, invalidate the code, reset MFA, and return session token', async () => {
      const mockUser = {
        id: 'user_recovery_1',
        email,
        mfaEnabled: true,
        mfaRecoveryCodes: [
          { id: 'rec_code_1', codeHash, used: false },
          { id: 'rec_code_2', codeHash: hashRecoveryCode('OTHER-CODE'), used: false },
        ],
      };

      (prisma.user.findUnique as any).mockResolvedValue(mockUser);
      (prisma.mfaRecoveryCode.update as any).mockResolvedValue({ id: 'rec_code_1', used: true });
      (prisma.user.update as any).mockResolvedValue({ ...mockUser, mfaEnabled: false, mfaSecret: null });
      (prisma.securityAuditLog.create as any).mockResolvedValue({ id: 'audit_log_success' });

      const result = await mfaService.recoverAccountWithCode(email, plainCode, '192.168.1.100');

      expect(result.user).toEqual({ id: mockUser.id, email: mockUser.email });
      expect(typeof result.token).toBe('string');
      expect(prisma.mfaRecoveryCode.update).toHaveBeenCalledWith({
        where: { id: 'rec_code_1' },
        data: expect.objectContaining({ used: true }),
      });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: mockUser.id },
        data: { mfaEnabled: false, mfaSecret: null },
      });
      expect(prisma.securityAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          eventType: 'MFA_RECOVERY_SUCCESS',
          severity: 'HIGH',
        }),
      });
    });

    it('should fail and create audit log when recovery code is incorrect', async () => {
      const mockUser = {
        id: 'user_recovery_1',
        email: 'fail@example.com',
        mfaEnabled: true,
        mfaRecoveryCodes: [
          { id: 'rec_code_1', codeHash, used: false },
        ],
      };

      (prisma.user.findUnique as any).mockResolvedValue(mockUser);
      (prisma.securityAuditLog.create as any).mockResolvedValue({ id: 'audit_fail' });

      await expect(
        mfaService.recoverAccountWithCode('fail@example.com', 'WRONG-CODE', '127.0.0.1')
      ).rejects.toThrow('Invalid recovery code');

      expect(prisma.securityAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          eventType: 'MFA_RECOVERY_FAILED',
          severity: 'HIGH',
        }),
      });
    });

    it('should enforce rate limits on repeated failed attempts', async () => {
      const testEmail = 'ratelimit@example.com';
      (prisma.user.findUnique as any).mockResolvedValue(null);
      (prisma.securityAuditLog.create as any).mockResolvedValue({});

      // 3 failed attempts allowed
      for (let i = 0; i < 3; i++) {
        await expect(
          mfaService.recoverAccountWithCode(testEmail, 'INVALID-CODE')
        ).rejects.toThrow('Invalid recovery code or account does not have MFA configured');
      }

      // 4th attempt should trigger rate limiter
      await expect(
        mfaService.recoverAccountWithCode(testEmail, 'INVALID-CODE')
      ).rejects.toThrow(/Too many recovery attempts/);
    });
  });
});
