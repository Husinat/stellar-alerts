import { prisma, prismaRead } from '../../lib/prisma';

export class WalletsService {
  async addWallet(userId: string, publicKey: string, label?: string, zkProof?: any, publicSignals?: string[]) {
    console.log(`[WalletsService] Adding wallet ${publicKey} for user ${userId}`);

    let targetUserId = userId;

    if (zkProof && publicSignals) {
      const isValid = await verifyZkProof(zkProof, publicSignals);
      if (!isValid) {
        throw new Error('Invalid ZK proof');
      }

      // Valid ZK proof allows alert subscription without storing plaintext user email linkage
      const secretHash = publicSignals[0];
      const anonymousEmail = `${secretHash}@zkp.local`;

      let anonUser = await prisma.user.findUnique({ where: { email: anonymousEmail } });
      if (!anonUser) {
        anonUser = await prisma.user.create({
          data: { email: anonymousEmail }
        });
      }
      targetUserId = anonUser.id;
    }

    try {
      const wallet = await prisma.wallet.create({
        data: {
          userId: targetUserId,
          publicKey,
          label,
        },
      });
      return wallet;
    } catch (error: any) {
      if (error.code === 'P2002') {
        throw new Error('Wallet already exists');
      }
      throw error;
    }
  }

  async getWallets(userId: string) {
    return prismaRead.wallet.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' }
    });
  }

  /**
   * Operator-visible ingestion health for a wallet's Horizon/Soroban cursor
   * (see lib/cursor-recovery.ts): current paging token, health status
   * (active / gap_detected), consecutive provider failures, and the most
   * recent error and gap, if any.
   */
  async getIngestionStatus(userId: string, walletId: string) {
    const wallet = await prisma.wallet.findUnique({
      where: { id: walletId },
      include: { cursor: true },
    });

    if (!wallet || wallet.userId !== userId) {
      throw new Error('Wallet not found');
    }

    const cursor = wallet.cursor;
    return {
      walletId: wallet.id,
      publicKey: wallet.publicKey,
      pagingToken: cursor?.pagingToken ?? null,
      status: cursor?.status ?? 'active',
      consecutiveFailures: cursor?.consecutiveFailures ?? 0,
      lastError: cursor?.lastError ?? null,
      lastSuccessAt: cursor?.lastSuccessAt ?? null,
      lastSyncedAt: cursor?.lastSyncedAt ?? null,
      gapDetectedAt: cursor?.gapDetectedAt ?? null,
      lastGapLedgerDelta: cursor?.lastGapLedgerDelta ?? null,
    };
  }

  async removeWallet(id: string) {
    console.log(`[WalletsService] Removing wallet ${id}`);
    try {
      await prisma.wallet.delete({
        where: { id },
      });
      return { success: true };
    } catch (error: any) {
      if (error.code === 'P2025') {
        throw new Error('Wallet not found');
      }
      throw error;
    }
  }
}

export const walletsService = new WalletsService();
