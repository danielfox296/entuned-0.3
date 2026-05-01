-- AlterEnum
ALTER TYPE "PlaybackEventType" ADD VALUE 'ad_play';

-- AlterTable (add campaign relations to Store — no column changes needed, handled by FK)

-- CreateTable campaigns
CREATE TABLE "campaigns" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "songs_per_ad" INTEGER NOT NULL DEFAULT 3,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable ad_assets
CREATE TABLE "ad_assets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "campaign_id" UUID NOT NULL,
    "r2_url" TEXT NOT NULL,
    "r2_object_key" TEXT NOT NULL,
    "label" TEXT,
    "position" INTEGER NOT NULL,
    "byte_size" BIGINT,
    "content_type" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ad_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable campaign_play_states
CREATE TABLE "campaign_play_states" (
    "store_id" UUID NOT NULL,
    "songs_played_since_ad" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "campaign_play_states_pkey" PRIMARY KEY ("store_id")
);

-- CreateTable campaign_asset_states
CREATE TABLE "campaign_asset_states" (
    "campaign_id" UUID NOT NULL,
    "next_asset_index" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "campaign_asset_states_pkey" PRIMARY KEY ("campaign_id")
);

-- CreateIndex
CREATE INDEX "campaigns_store_id_starts_at_idx" ON "campaigns"("store_id", "starts_at");

-- CreateIndex
CREATE INDEX "ad_assets_campaign_id_position_idx" ON "ad_assets"("campaign_id", "position");

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_assets" ADD CONSTRAINT "ad_assets_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_play_states" ADD CONSTRAINT "campaign_play_states_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_asset_states" ADD CONSTRAINT "campaign_asset_states_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
