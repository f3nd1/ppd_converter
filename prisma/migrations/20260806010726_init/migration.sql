-- CreateTable
CREATE TABLE "AppUser" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "displayName" TEXT,
    "isAuthorised" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "OAuthCredential" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "appUserId" TEXT NOT NULL,
    "refreshTokenEnc" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "scopes" TEXT NOT NULL,
    "expiresAt" DATETIME,
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OAuthCredential_appUserId_fkey" FOREIGN KEY ("appUserId") REFERENCES "AppUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Criterion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "order" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "SubCriterion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "criterionId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deactivatedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SubCriterion_criterionId_fkey" FOREIGN KEY ("criterionId") REFERENCES "Criterion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SourceMapping" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "subCriterionId" TEXT NOT NULL,
    "oldUrl" TEXT,
    "oldResourceId" TEXT,
    "oldResourceType" TEXT,
    "newUrl" TEXT,
    "newResourceId" TEXT,
    "newResourceType" TEXT,
    "validationStatus" TEXT NOT NULL DEFAULT 'not_validated',
    "errorDetail" TEXT,
    "lastValidatedAt" DATETIME,
    "lastScannedAt" DATETIME,
    "sourceDocCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SourceMapping_subCriterionId_fkey" FOREIGN KEY ("subCriterionId") REFERENCES "SubCriterion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SourceDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceMappingId" TEXT NOT NULL,
    "googleFileId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "documentCode" TEXT,
    "mimeType" TEXT NOT NULL,
    "modifiedTime" DATETIME NOT NULL,
    "webViewLink" TEXT,
    "contentHash" TEXT,
    "isDuplicateOf" TEXT,
    "migrationStatus" TEXT NOT NULL DEFAULT 'not_started',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SourceDocument_sourceMappingId_fkey" FOREIGN KEY ("sourceMappingId") REFERENCES "SourceMapping" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TemplateVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "googleDocId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "versionLabel" TEXT NOT NULL,
    "validationResult" TEXT NOT NULL,
    "configSnapshot" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "activatedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AIInstructionVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "versionLabel" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "activatedAt" DATETIME,
    "restoredFromId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "MappingVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "versionLabel" TEXT NOT NULL,
    "approvalStatus" TEXT NOT NULL DEFAULT 'draft',
    "approvedBy" TEXT,
    "approvedAt" DATETIME,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MappingRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mappingVersionId" TEXT NOT NULL,
    "oldSectionName" TEXT NOT NULL,
    "newTargetSection" TEXT NOT NULL,
    "transformationRule" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MappingRule_mappingVersionId_fkey" FOREIGN KEY ("mappingVersionId") REFERENCES "MappingVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MigrationJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceDocumentId" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'queued',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "queuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "errorRef" TEXT,
    "errorMessage" TEXT,
    "correlationId" TEXT NOT NULL,
    "templateVersionId" TEXT,
    "aiInstructionVersionId" TEXT,
    "mappingVersionId" TEXT,
    CONSTRAINT "MigrationJob_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "SourceDocument" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MigrationJob_templateVersionId_fkey" FOREIGN KEY ("templateVersionId") REFERENCES "TemplateVersion" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MigrationJob_aiInstructionVersionId_fkey" FOREIGN KEY ("aiInstructionVersionId") REFERENCES "AIInstructionVersion" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MigrationJob_mappingVersionId_fkey" FOREIGN KEY ("mappingVersionId") REFERENCES "MappingVersion" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MigratedDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "migrationJobId" TEXT NOT NULL,
    "sourceDocumentId" TEXT NOT NULL,
    "targetGoogleDocId" TEXT,
    "targetUrl" TEXT,
    "targetTitle" TEXT NOT NULL,
    "outputVersion" TEXT NOT NULL DEFAULT '2.1',
    "destinationFolderId" TEXT NOT NULL,
    "sourceModifiedTimeAtMigration" DATETIME NOT NULL,
    "templateVersionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'awaiting_review',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MigratedDocument_migrationJobId_fkey" FOREIGN KEY ("migrationJobId") REFERENCES "MigrationJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MigratedDocument_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "SourceDocument" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MigratedDocument_templateVersionId_fkey" FOREIGN KEY ("templateVersionId") REFERENCES "TemplateVersion" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ContentBlock" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceDocumentId" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "textHash" TEXT NOT NULL,
    "level" INTEGER,
    "styleName" TEXT,
    "numbering" TEXT,
    "links" TEXT,
    "tableData" TEXT,
    "imageRef" TEXT,
    "sourceLocation" TEXT,
    "parentBlockId" TEXT,
    "order" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContentBlock_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "SourceDocument" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ContentBlockMapping" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contentBlockId" TEXT NOT NULL,
    "targetSection" TEXT,
    "mappingRuleId" TEXT,
    "status" TEXT NOT NULL,
    "confidence" REAL,
    "note" TEXT,
    "migratedDocumentId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContentBlockMapping_contentBlockId_fkey" FOREIGN KEY ("contentBlockId") REFERENCES "ContentBlock" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ContentBlockMapping_mappingRuleId_fkey" FOREIGN KEY ("mappingRuleId") REFERENCES "MappingRule" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChangeRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "migratedDocumentId" TEXT NOT NULL,
    "changeNumber" INTEGER NOT NULL,
    "changeType" TEXT NOT NULL,
    "sourceSection" TEXT,
    "targetSection" TEXT,
    "sourceBlockId" TEXT,
    "originalExcerpt" TEXT,
    "revisedExcerpt" TEXT,
    "reason" TEXT,
    "confidence" REAL,
    "validationResult" TEXT,
    "reviewStatus" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChangeRecord_migratedDocumentId_fkey" FOREIGN KEY ("migratedDocumentId") REFERENCES "MigratedDocument" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ValidationRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "migratedDocumentId" TEXT NOT NULL,
    "layer" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "summary" TEXT,
    "model" TEXT,
    "providerRequestId" TEXT,
    "usageJson" TEXT,
    CONSTRAINT "ValidationRun_migratedDocumentId_fkey" FOREIGN KEY ("migratedDocumentId") REFERENCES "MigratedDocument" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ValidationItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "validationRunId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "checkPerformed" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "details" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "sourceReference" TEXT,
    "targetReference" TEXT,
    "humanReviewRequired" BOOLEAN NOT NULL DEFAULT false,
    "resolutionStatus" TEXT NOT NULL DEFAULT 'open',
    "resolutionNote" TEXT,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ValidationItem_validationRunId_fkey" FOREIGN KEY ("validationRunId") REFERENCES "ValidationRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReviewDecision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "migratedDocumentId" TEXT NOT NULL,
    "reviewerEmail" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "comment" TEXT,
    "decidedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aiInstructionVersionId" TEXT,
    "mappingVersionId" TEXT,
    "templateVersionId" TEXT,
    "sourceModifiedTime" DATETIME,
    "targetGoogleDocId" TEXT,
    "validationSummary" TEXT,
    CONSTRAINT "ReviewDecision_migratedDocumentId_fkey" FOREIGN KEY ("migratedDocumentId") REFERENCES "MigratedDocument" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "occurredAtUtc" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "result" TEXT NOT NULL DEFAULT 'success',
    "summary" TEXT,
    "errorRef" TEXT,
    "correlationId" TEXT
);

-- CreateTable
CREATE TABLE "ExportRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "format" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "filters" TEXT,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "correlationId" TEXT,
    "exportedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "AppUser_email_key" ON "AppUser"("email");

-- CreateIndex
CREATE INDEX "OAuthCredential_appUserId_idx" ON "OAuthCredential"("appUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Criterion_number_key" ON "Criterion"("number");

-- CreateIndex
CREATE INDEX "SubCriterion_criterionId_order_idx" ON "SubCriterion"("criterionId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "SubCriterion_criterionId_code_key" ON "SubCriterion"("criterionId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "SourceMapping_subCriterionId_key" ON "SourceMapping"("subCriterionId");

-- CreateIndex
CREATE INDEX "SourceDocument_migrationStatus_idx" ON "SourceDocument"("migrationStatus");

-- CreateIndex
CREATE UNIQUE INDEX "SourceDocument_sourceMappingId_googleFileId_key" ON "SourceDocument"("sourceMappingId", "googleFileId");

-- CreateIndex
CREATE INDEX "TemplateVersion_isActive_idx" ON "TemplateVersion"("isActive");

-- CreateIndex
CREATE INDEX "AIInstructionVersion_isActive_idx" ON "AIInstructionVersion"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "MappingVersion_versionLabel_key" ON "MappingVersion"("versionLabel");

-- CreateIndex
CREATE INDEX "MappingVersion_isActive_approvalStatus_idx" ON "MappingVersion"("isActive", "approvalStatus");

-- CreateIndex
CREATE INDEX "MappingRule_mappingVersionId_priority_idx" ON "MappingRule"("mappingVersionId", "priority");

-- CreateIndex
CREATE INDEX "MigrationJob_stage_idx" ON "MigrationJob"("stage");

-- CreateIndex
CREATE INDEX "MigrationJob_sourceDocumentId_idx" ON "MigrationJob"("sourceDocumentId");

-- CreateIndex
CREATE UNIQUE INDEX "MigratedDocument_migrationJobId_key" ON "MigratedDocument"("migrationJobId");

-- CreateIndex
CREATE INDEX "MigratedDocument_status_idx" ON "MigratedDocument"("status");

-- CreateIndex
CREATE UNIQUE INDEX "MigratedDocument_destinationFolderId_targetTitle_key" ON "MigratedDocument"("destinationFolderId", "targetTitle");

-- CreateIndex
CREATE INDEX "ContentBlock_sourceDocumentId_order_idx" ON "ContentBlock"("sourceDocumentId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "ContentBlock_sourceDocumentId_blockId_key" ON "ContentBlock"("sourceDocumentId", "blockId");

-- CreateIndex
CREATE INDEX "ContentBlockMapping_contentBlockId_idx" ON "ContentBlockMapping"("contentBlockId");

-- CreateIndex
CREATE INDEX "ContentBlockMapping_migratedDocumentId_idx" ON "ContentBlockMapping"("migratedDocumentId");

-- CreateIndex
CREATE INDEX "ChangeRecord_migratedDocumentId_idx" ON "ChangeRecord"("migratedDocumentId");

-- CreateIndex
CREATE UNIQUE INDEX "ChangeRecord_migratedDocumentId_changeNumber_key" ON "ChangeRecord"("migratedDocumentId", "changeNumber");

-- CreateIndex
CREATE INDEX "ValidationRun_migratedDocumentId_layer_idx" ON "ValidationRun"("migratedDocumentId", "layer");

-- CreateIndex
CREATE INDEX "ValidationItem_validationRunId_result_idx" ON "ValidationItem"("validationRunId", "result");

-- CreateIndex
CREATE INDEX "ReviewDecision_migratedDocumentId_idx" ON "ReviewDecision"("migratedDocumentId");

-- CreateIndex
CREATE INDEX "ActivityLog_occurredAtUtc_idx" ON "ActivityLog"("occurredAtUtc");

-- CreateIndex
CREATE INDEX "ActivityLog_action_idx" ON "ActivityLog"("action");

-- CreateIndex
CREATE INDEX "ActivityLog_entityType_entityId_idx" ON "ActivityLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "ExportRecord_exportedAt_idx" ON "ExportRecord"("exportedAt");
