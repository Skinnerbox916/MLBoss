ALTER TABLE "statcast_events" ADD COLUMN "delta_run_exp" real;--> statement-breakpoint
ALTER TABLE "statcast_events" ADD COLUMN "n_thruorder_pitcher" smallint;--> statement-breakpoint
ALTER TABLE "statcast_events" ADD COLUMN "pitcher_days_since_prev_game" smallint;--> statement-breakpoint
ALTER TABLE "statcast_events" ADD COLUMN "batter_days_since_prev_game" smallint;