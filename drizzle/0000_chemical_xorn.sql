CREATE TABLE "forecast_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"game_date" date NOT NULL,
	"engine" text NOT NULL,
	"mlb_id" integer NOT NULL,
	"player_name" text DEFAULT '' NOT NULL,
	"league_key" text DEFAULT '' NOT NULL,
	"lead_days" integer DEFAULT 0 NOT NULL,
	"predicted" jsonb NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"model_version" text NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_game_actuals" (
	"game_date" date NOT NULL,
	"mlb_id" integer NOT NULL,
	"status" text NOT NULL,
	"batting" jsonb,
	"pitching" jsonb,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_game_actuals_game_date_mlb_id_pk" PRIMARY KEY("game_date","mlb_id")
);
--> statement-breakpoint
CREATE TABLE "user_prefs" (
	"user_id" text NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_prefs_user_id_key_pk" PRIMARY KEY("user_id","key")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"role" text DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_prefs" ADD CONSTRAINT "user_prefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "forecast_snapshots_identity" ON "forecast_snapshots" USING btree ("game_date","engine","mlb_id","league_key","lead_days");--> statement-breakpoint
CREATE INDEX "forecast_snapshots_date" ON "forecast_snapshots" USING btree ("game_date");