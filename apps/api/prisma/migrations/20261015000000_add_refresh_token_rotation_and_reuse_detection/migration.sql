-- CreateTable
CREATE TABLE "RefreshSession" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "currentJti" TEXT NOT NULL,
    "rotationCounter" INTEGER NOT NULL DEFAULT 1,
    "isRevoked" BOOLEAN NOT NULL DEFAULT false,
    "revocationReason" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RefreshSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshTokenHistory" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "jti" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rotationCounter" INTEGER NOT NULL,
    "isConsumed" BOOLEAN NOT NULL DEFAULT false,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshTokenHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RefreshSession_familyId_key" ON "RefreshSession"("familyId");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshSession_currentJti_key" ON "RefreshSession"("currentJti");

-- CreateIndex
CREATE INDEX "RefreshSession_userId_idx" ON "RefreshSession"("userId");

-- CreateIndex
CREATE INDEX "RefreshSession_currentJti_idx" ON "RefreshSession"("currentJti");

-- CreateIndex
CREATE INDEX "RefreshSession_isRevoked_idx" ON "RefreshSession"("isRevoked");

-- CreateIndex
CREATE INDEX "RefreshSession_expiresAt_idx" ON "RefreshSession"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshTokenHistory_jti_key" ON "RefreshTokenHistory"("jti");

-- CreateIndex
CREATE INDEX "RefreshTokenHistory_familyId_idx" ON "RefreshTokenHistory"("familyId");

-- CreateIndex
CREATE INDEX "RefreshTokenHistory_jti_idx" ON "RefreshTokenHistory"("jti");

-- CreateIndex
CREATE INDEX "RefreshTokenHistory_userId_idx" ON "RefreshTokenHistory"("userId");

-- AddForeignKey
ALTER TABLE "RefreshSession" ADD CONSTRAINT "RefreshSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshTokenHistory" ADD CONSTRAINT "RefreshTokenHistory_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "RefreshSession"("familyId") ON DELETE CASCADE ON UPDATE CASCADE;
