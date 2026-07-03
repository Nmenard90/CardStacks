-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "CardCondition" AS ENUM ('NEAR_MINT', 'LIGHTLY_PLAYED', 'MODERATELY_PLAYED', 'HEAVILY_PLAYED', 'DAMAGED');

-- CreateEnum
CREATE TYPE "PlanCode" AS ENUM ('FREE', 'COLLECTOR_PRO', 'VENDOR_PRO');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'TRIALING', 'CANCELED', 'PAST_DUE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "AccessLevel" AS ENUM ('FREE', 'COLLECTOR_PRO', 'VENDOR_PRO', 'ADMIN_FULL');

-- CreateEnum
CREATE TYPE "SyncRunStatus" AS ENUM ('RUNNING', 'SUCCESS', 'PARTIAL_FAILURE', 'FAILED');

-- CreateEnum
CREATE TYPE "SyncErrorSeverity" AS ENUM ('WARNING', 'ERROR', 'CRITICAL');

-- CreateEnum
CREATE TYPE "BinderVisibility" AS ENUM ('PRIVATE', 'UNLISTED', 'PUBLIC');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'PARTIAL_FAILURE', 'FAILED');

-- CreateEnum
CREATE TYPE "TradeStatus" AS ENUM ('DRAFT', 'SAVED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "TradeSide" AS ENUM ('GIVE', 'RECEIVE');

-- CreateTable
CREATE TABLE "app_users" (
    "id" UUID NOT NULL,
    "auth_provider" TEXT NOT NULL,
    "auth_subject" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" UUID NOT NULL,
    "code" "PlanCode" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "monthly_price_cents" INTEGER NOT NULL DEFAULT 0,
    "yearly_price_cents" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'INACTIVE',
    "provider" TEXT NOT NULL,
    "provider_customer_id" TEXT,
    "provider_subscription_id" TEXT,
    "current_period_start" TIMESTAMP(3),
    "current_period_end" TIMESTAMP(3),
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_overrides" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "granted_by_user_id" UUID NOT NULL,
    "access_level" "AccessLevel" NOT NULL,
    "reason" TEXT NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "access_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sets" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "series" TEXT,
    "printed_total" INTEGER,
    "total" INTEGER,
    "release_date" DATE,
    "source_updated_at" TIMESTAMP(3),
    "ptcgo_code" TEXT,
    "symbol_url" TEXT,
    "logo_url" TEXT,
    "source" TEXT NOT NULL,
    "raw_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cards" (
    "id" TEXT NOT NULL,
    "set_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "number_int" INTEGER,
    "rarity" TEXT,
    "artist" TEXT,
    "supertype" TEXT,
    "subtypes" TEXT[],
    "image_small" TEXT,
    "image_large" TEXT,
    "raw_json" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "card_variants" (
    "id" UUID NOT NULL,
    "card_id" TEXT NOT NULL,
    "variant_key" TEXT NOT NULL,
    "finish" TEXT,
    "edition" TEXT,
    "language" TEXT NOT NULL DEFAULT 'EN',
    "is_master_set_variant" BOOLEAN NOT NULL DEFAULT true,
    "display_name" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "source_product_id" TEXT,
    "source_sku_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "card_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_items" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "card_id" TEXT NOT NULL,
    "variant_id" UUID NOT NULL,
    "condition" "CardCondition" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "storage_location" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "collection_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_lots" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "card_id" TEXT NOT NULL,
    "variant_id" UUID NOT NULL,
    "condition" "CardCondition" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "price_paid_total" DECIMAL(12,2),
    "price_paid_each" DECIMAL(12,2),
    "purchased_at" DATE,
    "seller" TEXT,
    "source" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market_prices_current" (
    "id" UUID NOT NULL,
    "card_id" TEXT NOT NULL,
    "variant_id" UUID NOT NULL,
    "condition" "CardCondition" NOT NULL,
    "source" TEXT NOT NULL,
    "market_price" DECIMAL(12,2),
    "low_price" DECIMAL(12,2),
    "mid_price" DECIMAL(12,2),
    "high_price" DECIMAL(12,2),
    "last_sold_price" DECIMAL(12,2),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "fetched_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "market_prices_current_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market_price_snapshots" (
    "id" UUID NOT NULL,
    "card_id" TEXT NOT NULL,
    "variant_id" UUID NOT NULL,
    "condition" "CardCondition" NOT NULL,
    "source" TEXT NOT NULL,
    "market_price" DECIMAL(12,2),
    "low_price" DECIMAL(12,2),
    "mid_price" DECIMAL(12,2),
    "high_price" DECIMAL(12,2),
    "last_sold_price" DECIMAL(12,2),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "market_price_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_runs" (
    "id" UUID NOT NULL,
    "job_type" TEXT NOT NULL,
    "status" "SyncRunStatus" NOT NULL,
    "source" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "records_seen" INTEGER NOT NULL DEFAULT 0,
    "records_updated" INTEGER NOT NULL DEFAULT 0,
    "records_failed" INTEGER NOT NULL DEFAULT 0,
    "error_summary" TEXT,

    CONSTRAINT "sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_errors" (
    "id" UUID NOT NULL,
    "sync_run_id" UUID NOT NULL,
    "severity" "SyncErrorSeverity" NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "message" TEXT NOT NULL,
    "raw_payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_errors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "binders" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "visibility" "BinderVisibility" NOT NULL DEFAULT 'PRIVATE',
    "share_slug" TEXT,
    "pocket_size" INTEGER NOT NULL DEFAULT 9,
    "cover_card_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "binders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "binder_slots" (
    "id" UUID NOT NULL,
    "binder_id" UUID NOT NULL,
    "page_number" INTEGER NOT NULL,
    "slot_number" INTEGER NOT NULL,
    "card_id" TEXT NOT NULL,
    "variant_id" UUID NOT NULL,
    "condition" "CardCondition",
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "note" TEXT,

    CONSTRAINT "binder_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_jobs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "ImportStatus" NOT NULL,
    "filename" TEXT NOT NULL,
    "rows_total" INTEGER NOT NULL DEFAULT 0,
    "rows_imported" INTEGER NOT NULL DEFAULT 0,
    "rows_failed" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_errors" (
    "id" UUID NOT NULL,
    "import_job_id" UUID NOT NULL,
    "row_number" INTEGER NOT NULL,
    "message" TEXT NOT NULL,
    "raw_row" JSONB NOT NULL,

    CONSTRAINT "import_errors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trade_analyses" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" TEXT,
    "status" "TradeStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trade_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trade_analysis_items" (
    "id" UUID NOT NULL,
    "trade_analysis_id" UUID NOT NULL,
    "side" "TradeSide" NOT NULL,
    "card_id" TEXT NOT NULL,
    "variant_id" UUID NOT NULL,
    "condition" "CardCondition" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "market_price_each" DECIMAL(12,2),
    "manual_price_each" DECIMAL(12,2),

    CONSTRAINT "trade_analysis_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "app_users_auth_subject_key" ON "app_users"("auth_subject");

-- CreateIndex
CREATE UNIQUE INDEX "app_users_email_key" ON "app_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "plans_code_key" ON "plans"("code");

-- CreateIndex
CREATE INDEX "subscriptions_user_id_status_idx" ON "subscriptions"("user_id", "status");

-- CreateIndex
CREATE INDEX "access_overrides_user_id_is_active_starts_at_ends_at_idx" ON "access_overrides"("user_id", "is_active", "starts_at", "ends_at");

-- CreateIndex
CREATE INDEX "sets_name_idx" ON "sets"("name");

-- CreateIndex
CREATE INDEX "sets_release_date_idx" ON "sets"("release_date");

-- CreateIndex
CREATE INDEX "cards_set_id_idx" ON "cards"("set_id");

-- CreateIndex
CREATE INDEX "cards_normalized_name_idx" ON "cards"("normalized_name");

-- CreateIndex
CREATE INDEX "cards_number_idx" ON "cards"("number");

-- CreateIndex
CREATE INDEX "cards_set_id_number_idx" ON "cards"("set_id", "number");

-- CreateIndex
CREATE INDEX "cards_number_int_idx" ON "cards"("number_int");

-- CreateIndex
CREATE INDEX "card_variants_source_source_product_id_source_sku_id_idx" ON "card_variants"("source", "source_product_id", "source_sku_id");

-- CreateIndex
CREATE UNIQUE INDEX "card_variants_card_id_variant_key_language_key" ON "card_variants"("card_id", "variant_key", "language");

-- CreateIndex
CREATE INDEX "collection_items_user_id_idx" ON "collection_items"("user_id");

-- CreateIndex
CREATE INDEX "collection_items_card_id_variant_id_idx" ON "collection_items"("card_id", "variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "collection_items_user_id_card_id_variant_id_condition_stora_key" ON "collection_items"("user_id", "card_id", "variant_id", "condition", "storage_location");

-- CreateIndex
CREATE INDEX "purchase_lots_user_id_purchased_at_idx" ON "purchase_lots"("user_id", "purchased_at");

-- CreateIndex
CREATE INDEX "purchase_lots_card_id_variant_id_idx" ON "purchase_lots"("card_id", "variant_id");

-- CreateIndex
CREATE INDEX "market_prices_current_fetched_at_idx" ON "market_prices_current"("fetched_at");

-- CreateIndex
CREATE UNIQUE INDEX "market_prices_current_card_id_variant_id_condition_source_key" ON "market_prices_current"("card_id", "variant_id", "condition", "source");

-- CreateIndex
CREATE INDEX "market_price_snapshots_card_id_variant_id_condition_capture_idx" ON "market_price_snapshots"("card_id", "variant_id", "condition", "captured_at");

-- CreateIndex
CREATE INDEX "sync_runs_job_type_status_started_at_idx" ON "sync_runs"("job_type", "status", "started_at");

-- CreateIndex
CREATE INDEX "sync_errors_sync_run_id_severity_idx" ON "sync_errors"("sync_run_id", "severity");

-- CreateIndex
CREATE UNIQUE INDEX "binders_share_slug_key" ON "binders"("share_slug");

-- CreateIndex
CREATE INDEX "binders_user_id_idx" ON "binders"("user_id");

-- CreateIndex
CREATE INDEX "binder_slots_binder_id_idx" ON "binder_slots"("binder_id");

-- CreateIndex
CREATE UNIQUE INDEX "binder_slots_binder_id_page_number_slot_number_key" ON "binder_slots"("binder_id", "page_number", "slot_number");

-- CreateIndex
CREATE INDEX "import_jobs_user_id_created_at_idx" ON "import_jobs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "import_errors_import_job_id_idx" ON "import_errors"("import_job_id");

-- CreateIndex
CREATE INDEX "trade_analyses_user_id_created_at_idx" ON "trade_analyses"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "trade_analysis_items_trade_analysis_id_idx" ON "trade_analysis_items"("trade_analysis_id");

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_overrides" ADD CONSTRAINT "access_overrides_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_overrides" ADD CONSTRAINT "access_overrides_granted_by_user_id_fkey" FOREIGN KEY ("granted_by_user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cards" ADD CONSTRAINT "cards_set_id_fkey" FOREIGN KEY ("set_id") REFERENCES "sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_variants" ADD CONSTRAINT "card_variants_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "card_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_lots" ADD CONSTRAINT "purchase_lots_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_lots" ADD CONSTRAINT "purchase_lots_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_lots" ADD CONSTRAINT "purchase_lots_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "card_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_prices_current" ADD CONSTRAINT "market_prices_current_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_prices_current" ADD CONSTRAINT "market_prices_current_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "card_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_price_snapshots" ADD CONSTRAINT "market_price_snapshots_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_price_snapshots" ADD CONSTRAINT "market_price_snapshots_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "card_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_errors" ADD CONSTRAINT "sync_errors_sync_run_id_fkey" FOREIGN KEY ("sync_run_id") REFERENCES "sync_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "binders" ADD CONSTRAINT "binders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "binder_slots" ADD CONSTRAINT "binder_slots_binder_id_fkey" FOREIGN KEY ("binder_id") REFERENCES "binders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "binder_slots" ADD CONSTRAINT "binder_slots_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "binder_slots" ADD CONSTRAINT "binder_slots_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "card_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_errors" ADD CONSTRAINT "import_errors_import_job_id_fkey" FOREIGN KEY ("import_job_id") REFERENCES "import_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_analyses" ADD CONSTRAINT "trade_analyses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_analysis_items" ADD CONSTRAINT "trade_analysis_items_trade_analysis_id_fkey" FOREIGN KEY ("trade_analysis_id") REFERENCES "trade_analyses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_analysis_items" ADD CONSTRAINT "trade_analysis_items_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_analysis_items" ADD CONSTRAINT "trade_analysis_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "card_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
