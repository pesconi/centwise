CREATE TABLE IF NOT EXISTS "bank_statement_reads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"request_key" uuid NOT NULL,
	"file_name" text NOT NULL,
	"fingerprint" text NOT NULL,
	"file_size_bytes" integer NOT NULL,
	"status" text NOT NULL,
	"candidate_count" integer DEFAULT 0 NOT NULL,
	"attempt_count" integer DEFAULT 1 NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "bank_statement_reads_file_name_length_check" CHECK (length("bank_statement_reads"."file_name") BETWEEN 1 AND 255),
	CONSTRAINT "bank_statement_reads_file_size_positive_check" CHECK ("bank_statement_reads"."file_size_bytes" > 0),
	CONSTRAINT "bank_statement_reads_status_check" CHECK ("bank_statement_reads"."status" IN ('processing', 'completed', 'failed')),
	CONSTRAINT "bank_statement_reads_candidate_count_check" CHECK ("bank_statement_reads"."candidate_count" >= 0),
	CONSTRAINT "bank_statement_reads_attempt_count_check" CHECK ("bank_statement_reads"."attempt_count" > 0),
	CONSTRAINT "bank_statement_reads_error_code_check" CHECK ("bank_statement_reads"."error_code" IS NULL OR "bank_statement_reads"."error_code" IN ('invalid_pdf', 'provider_unavailable', 'provider_rejected', 'invalid_extraction', 'unsupported_document'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bank_statement_reads" ADD CONSTRAINT "bank_statement_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bank_statement_reads_user_request_key_unique" ON "bank_statement_reads" USING btree ("user_id","request_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bank_statement_reads_user_created_idx" ON "bank_statement_reads" USING btree ("user_id","created_at");