CREATE TABLE "revenuecat_events" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"type" text NOT NULL,
	"event_timestamp_ms" bigint NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "revenuecat_events" ADD CONSTRAINT "revenuecat_events_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "revenuecat_events_household" ON "revenuecat_events" USING btree ("household_id");