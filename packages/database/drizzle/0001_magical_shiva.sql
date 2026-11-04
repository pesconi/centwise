CREATE TABLE IF NOT EXISTS "import_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"account_id" uuid,
	"amount_in_cents" bigint,
	"currency" text,
	"type" text,
	"occurred_at" timestamp with time zone,
	"description" text,
	"status" text NOT NULL,
	"posting_status" text DEFAULT 'blocked' NOT NULL,
	"validation_issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rejection_reason" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_candidates_amount_positive_check" CHECK ("import_candidates"."amount_in_cents" IS NULL OR "import_candidates"."amount_in_cents" > 0),
	CONSTRAINT "import_candidates_currency_eur_check" CHECK ("import_candidates"."currency" IS NULL OR "import_candidates"."currency" = 'EUR'),
	CONSTRAINT "import_candidates_type_check" CHECK ("import_candidates"."type" IS NULL OR "import_candidates"."type" IN ('income', 'expense')),
	CONSTRAINT "import_candidates_status_check" CHECK ("import_candidates"."status" IN ('pending_review', 'needs_information', 'duplicate', 'approved', 'rejected', 'failed')),
	CONSTRAINT "import_candidates_posting_blocked_check" CHECK ("import_candidates"."posting_status" = 'blocked')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "import_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_event_key" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"parser_version" text,
	"fingerprint" text NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "import_sources_event_key_length_check" CHECK (length("import_sources"."source_event_key") BETWEEN 1 AND 256),
	CONSTRAINT "import_sources_type_check" CHECK ("import_sources"."source_type" IN ('bank_sms', 'bank_notification', 'bank_statement_pdf', 'card_statement_pdf', 'bill_pdf'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "import_candidates" ADD CONSTRAINT "import_candidates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "import_candidates" ADD CONSTRAINT "import_candidates_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "import_candidates" ADD CONSTRAINT "import_candidates_source_id_import_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."import_sources"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "import_sources" ADD CONSTRAINT "import_sources_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "import_candidates_source_id_unique" ON "import_candidates" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "import_candidates_user_status_created_idx" ON "import_candidates" USING btree ("user_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "import_sources_user_type_event_key_unique" ON "import_sources" USING btree ("user_id","source_type","source_event_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "import_sources_user_id_idx" ON "import_sources" USING btree ("user_id");