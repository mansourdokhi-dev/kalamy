-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "User_supervisorUserId_idx" ON "User"("supervisorUserId");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");
