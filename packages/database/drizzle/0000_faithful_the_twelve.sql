CREATE TABLE IF NOT EXISTS "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"opening_balance_cents" bigint NOT NULL,
	"currency" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_currency_eur_check" CHECK ("accounts"."currency" = 'EUR')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "financial_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"safety_reserve_cents" bigint DEFAULT 0 NOT NULL,
	"monthly_investment_cents" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "financial_settings_currency_eur_check" CHECK ("financial_settings"."currency" = 'EUR'),
	CONSTRAINT "financial_settings_safety_reserve_nonnegative_check" CHECK ("financial_settings"."safety_reserve_cents" >= 0),
	CONSTRAINT "financial_settings_monthly_investment_nonnegative_check" CHECK ("financial_settings"."monthly_investment_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "recurring_bills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"amount_in_cents" bigint NOT NULL,
	"due_day_of_month" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_bills_amount_positive_check" CHECK ("recurring_bills"."amount_in_cents" > 0),
	CONSTRAINT "recurring_bills_due_day_check" CHECK ("recurring_bills"."due_day_of_month" BETWEEN 1 AND 31)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "recurring_incomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"amount_in_cents" bigint NOT NULL,
	"expected_day_of_month" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_incomes_amount_positive_check" CHECK ("recurring_incomes"."amount_in_cents" > 0),
	CONSTRAINT "recurring_incomes_expected_day_check" CHECK ("recurring_incomes"."expected_day_of_month" BETWEEN 1 AND 31)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"amount_in_cents" bigint NOT NULL,
	"currency" text NOT NULL,
	"type" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_amount_positive_check" CHECK ("transactions"."amount_in_cents" > 0),
	CONSTRAINT "transactions_currency_eur_check" CHECK ("transactions"."currency" = 'EUR'),
	CONSTRAINT "transactions_type_check" CHECK ("transactions"."type" IN ('income', 'expense'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "financial_settings" ADD CONSTRAINT "financial_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recurring_bills" ADD CONSTRAINT "recurring_bills_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recurring_incomes" ADD CONSTRAINT "recurring_incomes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accounts_user_id_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recurring_bills_user_id_idx" ON "recurring_bills" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recurring_incomes_user_id_idx" ON "recurring_incomes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transactions_user_id_idx" ON "transactions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transactions_account_id_idx" ON "transactions" USING btree ("account_id");