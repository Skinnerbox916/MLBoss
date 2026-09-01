CREATE TABLE "statcast_events" (
	"game_pk" integer NOT NULL,
	"game_date" date NOT NULL,
	"at_bat_number" integer NOT NULL,
	"pitch_number" integer NOT NULL,
	"inning" smallint,
	"inning_topbot" text,
	"batter" integer NOT NULL,
	"pitcher" integer NOT NULL,
	"stand" text,
	"p_throws" text,
	"home_team" text,
	"away_team" text,
	"pitch_type" text,
	"release_speed" real,
	"description" text,
	"events" text,
	"bb_type" text,
	"launch_speed" real,
	"launch_angle" real,
	"launch_speed_angle" smallint,
	"est_ba" real,
	"est_woba" real,
	"est_slg" real,
	"woba_value" real,
	"woba_denom" real,
	"babip_value" real,
	"iso_value" real,
	"balls" smallint,
	"strikes" smallint,
	"outs_when_up" smallint,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "statcast_events_game_pk_at_bat_number_pitch_number_pk" PRIMARY KEY("game_pk","at_bat_number","pitch_number")
);
--> statement-breakpoint
CREATE INDEX "statcast_events_date" ON "statcast_events" USING btree ("game_date");--> statement-breakpoint
CREATE INDEX "statcast_events_batter_date" ON "statcast_events" USING btree ("batter","game_date");--> statement-breakpoint
CREATE INDEX "statcast_events_pitcher_date" ON "statcast_events" USING btree ("pitcher","game_date");