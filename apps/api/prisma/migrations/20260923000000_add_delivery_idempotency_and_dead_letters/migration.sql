-- Delivery idempotency (#272) and dead-letter inspection/replay (#273).
-- All new tables are additive: no existing column is altered and no data is
-- dropped, so the migration is fully backward compatible.

-- CreateTable NotificationDeliveryAttempt
CREATE TABLE "NotificationDeliveryAttempt" (
    "id" TEXT NOT NULL,
    "deliveryKey" TEXT NOT NULL,
    "paymentId" TEXT,
    "channel" TEXT NOT NULL,
    "destination" TEXT,
    "providerRequestId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "error" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationDeliveryAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable DeadLetter
CREATE TABLE "DeadLetter" (
    "id" TEXT NOT NULL,
    "deliveryKey" TEXT,
    "paymentId" TEXT,
    "userId" TEXT,
    "channel" TEXT NOT NULL,
    "destination" TEXT,
    "payload" JSONB,
    "error" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "failedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeadLetter_pkey" PRIMARY KEY ("id")
);

-- CreateTable DeadLetterAudit
CREATE TABLE "DeadLetterAudit" (
    "id" TEXT NOT NULL,
    "deadLetterId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeadLetterAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex NotificationDeliveryAttempt
CREATE INDEX "NotificationDeliveryAttempt_deliveryKey_idx" ON "NotificationDeliveryAttempt"("deliveryKey");
CREATE INDEX "NotificationDeliveryAttempt_channel_idx" ON "NotificationDeliveryAttempt"("channel");
CREATE INDEX "NotificationDeliveryAttempt_status_idx" ON "NotificationDeliveryAttempt"("status");
CREATE INDEX "NotificationDeliveryAttempt_paymentId_idx" ON "NotificationDeliveryAttempt"("paymentId");
CREATE INDEX "NotificationDeliveryAttempt_createdAt_idx" ON "NotificationDeliveryAttempt"("createdAt");

-- CreateIndex DeadLetter
CREATE INDEX "DeadLetter_deliveryKey_idx" ON "DeadLetter"("deliveryKey");
CREATE INDEX "DeadLetter_channel_idx" ON "DeadLetter"("channel");
CREATE INDEX "DeadLetter_status_idx" ON "DeadLetter"("status");
CREATE INDEX "DeadLetter_userId_idx" ON "DeadLetter"("userId");
CREATE INDEX "DeadLetter_failedAt_idx" ON "DeadLetter"("failedAt");

-- CreateIndex DeadLetterAudit
CREATE INDEX "DeadLetterAudit_deadLetterId_idx" ON "DeadLetterAudit"("deadLetterId");
CREATE INDEX "DeadLetterAudit_createdAt_idx" ON "DeadLetterAudit"("createdAt");

-- AddForeignKey NotificationDeliveryAttempt
ALTER TABLE "NotificationDeliveryAttempt" ADD CONSTRAINT "NotificationDeliveryAttempt_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NotificationDeliveryAttempt" ADD CONSTRAINT "NotificationDeliveryAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey DeadLetter
ALTER TABLE "DeadLetter" ADD CONSTRAINT "DeadLetter_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DeadLetter" ADD CONSTRAINT "DeadLetter_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey DeadLetterAudit
ALTER TABLE "DeadLetterAudit" ADD CONSTRAINT "DeadLetterAudit_deadLetterId_fkey" FOREIGN KEY ("deadLetterId") REFERENCES "DeadLetter"("id") ON DELETE CASCADE ON UPDATE CASCADE;