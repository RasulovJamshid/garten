-- CreateTable
CREATE TABLE "landing_page" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "slug" TEXT NOT NULL DEFAULT 'home',
    "seo" JSONB,
    "published_snapshot" JSONB,
    "published_at" TIMESTAMPTZ(6),
    "published_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "landing_page_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "landing_block" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "page_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "is_visible" BOOLEAN NOT NULL DEFAULT true,
    "content" JSONB NOT NULL,
    "file_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "landing_block_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "landing_page_version" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "page_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "note" TEXT,
    "published_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_by" UUID,

    CONSTRAINT "landing_page_version_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "landing_page_tenant_id_slug_key" ON "landing_page"("tenant_id", "slug");

-- CreateIndex
CREATE INDEX "landing_block_page_id_position_idx" ON "landing_block"("page_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "landing_page_version_page_id_version_key" ON "landing_page_version"("page_id", "version");

-- AddForeignKey
ALTER TABLE "landing_page" ADD CONSTRAINT "landing_page_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "landing_block" ADD CONSTRAINT "landing_block_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "landing_page"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "landing_block" ADD CONSTRAINT "landing_block_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "landing_page_version" ADD CONSTRAINT "landing_page_version_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "landing_page"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "landing_page_version" ADD CONSTRAINT "landing_page_version_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
