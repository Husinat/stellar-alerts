-- CreateTable
CREATE TABLE "WhatsAppDeliveryLog" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "toNumber" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "messageSid" TEXT,
    "status" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppDeliveryLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WhatsAppDeliveryLog_paymentId_idx" ON "WhatsAppDeliveryLog"("paymentId");
