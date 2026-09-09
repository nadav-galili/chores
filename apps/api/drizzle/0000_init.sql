CREATE TYPE "public"."currency" AS ENUM('ILS', 'USD');--> statement-breakpoint
CREATE TYPE "public"."entitlement" AS ENUM('free', 'premium');--> statement-breakpoint
CREATE TABLE "households" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"tz" text NOT NULL,
	"day_boundary_hour" smallint DEFAULT 0 NOT NULL,
	"digest_hour" smallint DEFAULT 20 NOT NULL,
	"currency" "currency" NOT NULL,
	"coins_per_unit" integer DEFAULT 10 NOT NULL,
	"entitlement" "entitlement" DEFAULT 'free' NOT NULL,
	"entitlement_source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
