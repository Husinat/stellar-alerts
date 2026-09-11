-- DropIndex
DROP INDEX "Webhook_userId_idx";

-- AlterTable
ALTER TABLE "NotificationPreference" ADD COLUMN     "filterRules" JSONB,
ADD COLUMN     "language" TEXT NOT NULL DEFAULT 'EN';

-- CreateTable
CREATE TABLE "AnchorTransactionWatch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "anchorEndpoint" TEXT NOT NULL,
    "anchorTxId" TEXT NOT NULL,
    "protocol" TEXT NOT NULL,
    "lastKnownStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnchorTransactionWatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DexSwapWatch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "poolContractId" TEXT NOT NULL,
    "minAmountThreshold" TEXT,
    "minSlippagePercent" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DexSwapWatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DexSwapEvent" (
    "id" TEXT NOT NULL,
    "poolContractId" TEXT NOT NULL,
    "ledgerSeq" INTEGER NOT NULL,
    "txHash" TEXT,
    "tokenInAddress" TEXT NOT NULL,
    "tokenOutAddress" TEXT NOT NULL,
    "amountIn" TEXT NOT NULL,
    "amountOut" TEXT NOT NULL,
    "priceImpactPct" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DexSwapEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AnchorTransactionWatch_userId_idx" ON "AnchorTransactionWatch"("userId");

-- CreateIndex
CREATE INDEX "AnchorTransactionWatch_lastKnownStatus_idx" ON "AnchorTransactionWatch"("lastKnownStatus");

-- CreateIndex
CREATE UNIQUE INDEX "AnchorTransactionWatch_anchorEndpoint_anchorTxId_key" ON "AnchorTransactionWatch"("anchorEndpoint", "anchorTxId");

-- CreateIndex
CREATE INDEX "DexSwapWatch_poolContractId_idx" ON "DexSwapWatch"("poolContractId");

-- CreateIndex
CREATE UNIQUE INDEX "DexSwapWatch_userId_poolContractId_key" ON "DexSwapWatch"("userId", "poolContractId");

-- CreateIndex
CREATE INDEX "DexSwapEvent_poolContractId_idx" ON "DexSwapEvent"("poolContractId");

-- CreateIndex
CREATE INDEX "DexSwapEvent_ledgerSeq_idx" ON "DexSwapEvent"("ledgerSeq");

-- CreateIndex
CREATE UNIQUE INDEX "DexSwapEvent_poolContractId_ledgerSeq_tokenInAddress_tokenO_key" ON "DexSwapEvent"("poolContractId", "ledgerSeq", "tokenInAddress", "tokenOutAddress", "amountIn", "amountOut");

-- AddForeignKey
ALTER TABLE "AnchorTransactionWatch" ADD CONSTRAINT "AnchorTransactionWatch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DexSwapWatch" ADD CONSTRAINT "DexSwapWatch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
