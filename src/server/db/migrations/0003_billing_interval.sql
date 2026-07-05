-- Reworked billing model (brief §10): drop the Free/Pro `plan_tier` enum/column and
-- replace it with a nullable `billing_interval` (monthly | annual). Null = billing not
-- started. Pre-production: no real data to migrate, so a drop+add is safe.
ALTER TABLE "subscriptions" DROP COLUMN "tier";-->  statement-break
DROP TYPE "plan_tier";-->  statement-break
CREATE TYPE "billing_interval" AS ENUM('monthly', 'annual');-->  statement-break
ALTER TABLE "subscriptions" ADD COLUMN "billing_interval" "billing_interval";