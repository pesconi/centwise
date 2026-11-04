CREATE TABLE IF NOT EXISTS "recurring_occurrences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"recurring_bill_id" uuid,
	"recurring_income_id" uuid,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"amount_in_cents" bigint NOT NULL,
	"occurrence_month" date NOT NULL,
	"scheduled_date" date NOT NULL,
	"rescheduled_date" date,
	"is_cancelled" boolean DEFAULT false NOT NULL,
	"short_settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_occurrences_amount_positive_check" CHECK ("recurring_occurrences"."amount_in_cents" > 0),
	CONSTRAINT "recurring_occurrences_source_check" CHECK (("recurring_occurrences"."type" = 'bill' AND "recurring_occurrences"."recurring_bill_id" IS NOT NULL AND "recurring_occurrences"."recurring_income_id" IS NULL)
                OR ("recurring_occurrences"."type" = 'income' AND "recurring_occurrences"."recurring_income_id" IS NOT NULL AND "recurring_occurrences"."recurring_bill_id" IS NULL)),
	CONSTRAINT "recurring_occurrences_month_start_check" CHECK ("recurring_occurrences"."occurrence_month" = date_trunc('month', "recurring_occurrences"."occurrence_month"::timestamp)::date)
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "recurring_occurrence_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recurring_occurrences" ADD CONSTRAINT "recurring_occurrences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recurring_occurrences" ADD CONSTRAINT "recurring_occurrences_recurring_bill_id_recurring_bills_id_fk" FOREIGN KEY ("recurring_bill_id") REFERENCES "public"."recurring_bills"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recurring_occurrences" ADD CONSTRAINT "recurring_occurrences_recurring_income_id_recurring_incomes_id_fk" FOREIGN KEY ("recurring_income_id") REFERENCES "public"."recurring_incomes"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "recurring_occurrences_bill_month_unique" ON "recurring_occurrences" USING btree ("recurring_bill_id","occurrence_month") WHERE "recurring_occurrences"."recurring_bill_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "recurring_occurrences_income_month_unique" ON "recurring_occurrences" USING btree ("recurring_income_id","occurrence_month") WHERE "recurring_occurrences"."recurring_income_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "recurring_occurrences_user_id_id_unique" ON "recurring_occurrences" USING btree ("user_id","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recurring_occurrences_user_date_idx" ON "recurring_occurrences" USING btree ("user_id","scheduled_date");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_occurrence_fk" FOREIGN KEY ("user_id","recurring_occurrence_id") REFERENCES "public"."recurring_occurrences"("user_id","id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
