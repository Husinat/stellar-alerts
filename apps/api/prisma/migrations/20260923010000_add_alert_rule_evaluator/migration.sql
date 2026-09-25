-- CreateTable
CREATE TABLE "AlertRule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "walletId" TEXT,
    "name" TEXT,
    "assets" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "minAmount" DECIMAL(65,30),
    "conditions" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlertRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertRuleDispatchLog" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "matchedRuleIds" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertRuleDispatchLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AlertRule_userId_idx" ON "AlertRule"("userId");

-- CreateIndex
CREATE INDEX "AlertRule_walletId_idx" ON "AlertRule"("walletId");

-- CreateIndex
CREATE UNIQUE INDEX "AlertRuleDispatchLog_paymentId_key" ON "AlertRuleDispatchLog"("paymentId");

-- AddForeignKey
ALTER TABLE "AlertRule" ADD CONSTRAINT "AlertRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertRule" ADD CONSTRAINT "AlertRule_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
