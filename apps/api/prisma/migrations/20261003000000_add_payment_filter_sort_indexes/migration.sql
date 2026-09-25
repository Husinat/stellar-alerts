-- CreateIndex
CREATE INDEX "Payment_walletId_idx" ON "Payment"("walletId");

-- CreateIndex
CREATE INDEX "Payment_asset_idx" ON "Payment"("asset");

-- CreateIndex
CREATE INDEX "Payment_walletId_receivedAt_idx" ON "Payment"("walletId", "receivedAt");
