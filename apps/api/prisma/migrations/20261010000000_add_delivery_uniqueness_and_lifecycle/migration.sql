-- Add database uniqueness and lifecycle rules for notification deliveries (#306)

-- 1. CreateTable NotificationDelivery
CREATE TABLE "NotificationDelivery" (
    "id" TEXT NOT NULL,
    "deliveryKey" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "userId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "currentAttempt" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "lastError" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "terminalAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

-- 2. AlterTable NotificationDeliveryAttempt
ALTER TABLE "NotificationDeliveryAttempt" ADD COLUMN "deliveryId" TEXT;

-- 3. Create Unique Indexes & Constraints for NotificationDelivery
CREATE UNIQUE INDEX "NotificationDelivery_deliveryKey_key" ON "NotificationDelivery"("deliveryKey");
CREATE UNIQUE INDEX "NotificationDelivery_paymentId_channel_destination_key" ON "NotificationDelivery"("paymentId", "channel", "destination");
CREATE INDEX "NotificationDelivery_status_idx" ON "NotificationDelivery"("status");
CREATE INDEX "NotificationDelivery_channel_idx" ON "NotificationDelivery"("channel");
CREATE INDEX "NotificationDelivery_userId_idx" ON "NotificationDelivery"("userId");
CREATE INDEX "NotificationDelivery_createdAt_idx" ON "NotificationDelivery"("createdAt");

-- 4. Create Unique Index across (deliveryKey, attempt) on NotificationDeliveryAttempt
CREATE UNIQUE INDEX "NotificationDeliveryAttempt_deliveryKey_attempt_key" ON "NotificationDeliveryAttempt"("deliveryKey", "attempt");
CREATE INDEX "NotificationDeliveryAttempt_deliveryId_idx" ON "NotificationDeliveryAttempt"("deliveryId");

-- 5. Foreign Key Constraints
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NotificationDeliveryAttempt" ADD CONSTRAINT "NotificationDeliveryAttempt_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "NotificationDelivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;
