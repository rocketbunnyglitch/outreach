CREATE TYPE "public"."audit_operation" AS ENUM('INSERT', 'UPDATE', 'DELETE');--> statement-breakpoint
CREATE TYPE "public"."campaign_status" AS ENUM('planning', 'active', 'completed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."city_campaign_status" AS ENUM('planning', 'active', 'confirmed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."crawl_brand_geography" AS ENUM('toronto', 'international');--> statement-breakpoint
CREATE TYPE "public"."crawl_brand_status" AS ENUM('active', 'retired');--> statement-breakpoint
CREATE TYPE "public"."email_template_stage" AS ENUM('cold', 'follow_up_1', 'follow_up_2', 'poster_delivery', 'confirm_2_week', 'confirm_1_week', 'floor_staff_3_day', 'custom');--> statement-breakpoint
CREATE TYPE "public"."email_validation_status" AS ENUM('valid', 'invalid', 'catch_all', 'unknown', 'spamtrap', 'abuse', 'do_not_mail');--> statement-breakpoint
CREATE TYPE "public"."event_status" AS ENUM('planned', 'confirmed', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."financial_line_type" AS ENUM('ticket_revenue', 'platform_fee', 'marketing', 'wristband_cost', 'staff_cost', 'venue_cost', 'other');--> statement-breakpoint
CREATE TYPE "public"."goal_metric" AS ENUM('revenue_cents', 'venue_count', 'emails_sent', 'calls_made', 'confirmations', 'replies_received');--> statement-breakpoint
CREATE TYPE "public"."goal_scope" AS ENUM('campaign', 'outreach_brand', 'crawl_brand', 'city_campaign', 'staff_weekly');--> statement-breakpoint
CREATE TYPE "public"."holiday_type" AS ENUM('stpaddys', 'halloween', 'newyears', 'custom');--> statement-breakpoint
CREATE TYPE "public"."note_target_type" AS ENUM('city_campaign', 'venue', 'campaign');--> statement-breakpoint
CREATE TYPE "public"."outreach_brand_status" AS ENUM('active', 'retired');--> statement-breakpoint
CREATE TYPE "public"."outreach_channel" AS ENUM('email', 'call', 'sms', 'instagram', 'form', 'in_person');--> statement-breakpoint
CREATE TYPE "public"."outreach_outcome" AS ENUM('sent', 'bad_email', 'bounced', 'no_answer', 'voicemail', 'callback_requested', 'declined', 'interested', 'confirmed', 'wrong_number');--> statement-breakpoint
CREATE TYPE "public"."reply_category" AS ENUM('yes', 'no', 'question', 'out_of_office', 'unclear');--> statement-breakpoint
CREATE TYPE "public"."staff_outreach_email_status" AS ENUM('connected', 'needs_reauth', 'disconnected');--> statement-breakpoint
CREATE TYPE "public"."staff_role" AS ENUM('admin', 'lead', 'outreach', 'readonly');--> statement-breakpoint
CREATE TYPE "public"."staff_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."task_source" AS ENUM('auto', 'manual');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('pending', 'in_progress', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."task_target_type" AS ENUM('venue_event', 'venue', 'city_campaign', 'wristband', 'misc');--> statement-breakpoint
CREATE TYPE "public"."venue_event_status" AS ENUM('lead', 'contacted', 'interested', 'negotiating', 'confirmed', 'declined', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."venue_role" AS ENUM('wristband', 'middle', 'final');--> statement-breakpoint
CREATE TYPE "public"."wristband_status" AS ENUM('pending', 'ready_to_ship', 'shipped', 'delivered', 'issue');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "crawl_brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"holiday_type" "holiday_type" NOT NULL,
	"geography" "crawl_brand_geography" NOT NULL,
	"public_domain" text,
	"logo_url" text,
	"primary_color_hex" text,
	"accent_color_hex" text,
	"tagline" text,
	"public_footer_text" text,
	"eventbrite_organization_id" text,
	"eventbrite_api_token" text,
	"status" "crawl_brand_status" DEFAULT 'active' NOT NULL,
	"public_assets_enabled" boolean DEFAULT true NOT NULL,
	"default_outreach_brand_id" uuid,
	"template_version" text DEFAULT 'v1' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "outreach_brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"email_domain" text NOT NULL,
	"postmark_account_id" text,
	"postmark_server_token" text,
	"postmark_sender_signature" text,
	"email_signature_html" text,
	"email_signature_text" text,
	"quo_line_e164" text,
	"status" "outreach_brand_status" DEFAULT 'active' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "staff_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"primary_email" text NOT NULL,
	"role" "staff_role" DEFAULT 'outreach' NOT NULL,
	"status" "staff_status" DEFAULT 'active' NOT NULL,
	"timezone" text DEFAULT 'America/Toronto' NOT NULL,
	"weekly_email_goal" integer DEFAULT 0 NOT NULL,
	"weekly_call_goal" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "staff_outreach_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_member_id" uuid NOT NULL,
	"outreach_brand_id" uuid NOT NULL,
	"email_address" text NOT NULL,
	"gmail_oauth_refresh_token" text,
	"gmail_oauth_scopes" text[],
	"gmail_last_history_id" text,
	"quo_line_e164_override" text,
	"status" "staff_outreach_email_status" DEFAULT 'disconnected' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"country_code" text NOT NULL,
	"name" text NOT NULL,
	"region" text,
	"timezone" text NOT NULL,
	"location" geography(POINT, 4326),
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "countries" (
	"code" text NOT NULL,
	"name" text NOT NULL,
	"default_currency" text,
	CONSTRAINT "countries_code_pk" PRIMARY KEY("code")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"outreach_brand_id" uuid NOT NULL,
	"crawl_brand_id" uuid NOT NULL,
	"holiday_type" "holiday_type" NOT NULL,
	"status" "campaign_status" DEFAULT 'planning' NOT NULL,
	"start_date" date,
	"end_date" date,
	"public_subdomain" text,
	"revenue_goal_cents" bigint,
	"venue_count_goal" integer,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "city_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"city_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"priority" smallint DEFAULT 5 NOT NULL,
	"target_venue_count" smallint DEFAULT 4 NOT NULL,
	"target_wristband_count" smallint DEFAULT 1 NOT NULL,
	"target_final_count" smallint DEFAULT 1 NOT NULL,
	"target_middle_count" smallint DEFAULT 2 NOT NULL,
	"current_sales_cents" bigint DEFAULT 0 NOT NULL,
	"sales_goal_cents" bigint,
	"lead_staff_id" uuid,
	"status" "city_campaign_status" DEFAULT 'planning' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"city_campaign_id" uuid NOT NULL,
	"event_date" date NOT NULL,
	"slot_number" smallint DEFAULT 1 NOT NULL,
	"eventbrite_event_id" text,
	"required_venue_count_total" smallint DEFAULT 4 NOT NULL,
	"required_wristband_count" smallint DEFAULT 1 NOT NULL,
	"required_final_count" smallint DEFAULT 1 NOT NULL,
	"required_middle_count" smallint DEFAULT 2 NOT NULL,
	"status" "event_status" DEFAULT 'planned' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "venues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"city_id" uuid NOT NULL,
	"name" text NOT NULL,
	"google_place_id" text,
	"address" text,
	"location" geography(POINT, 4326),
	"phone_e164" text,
	"email" text,
	"alternate_emails" text[] DEFAULT '{}' NOT NULL,
	"website_url" text,
	"instagram_handle" text,
	"capacity" integer,
	"venue_type" text[] DEFAULT '{}' NOT NULL,
	"serves_alcohol" boolean DEFAULT true NOT NULL,
	"internal_notes" text DEFAULT '' NOT NULL,
	"do_not_contact" boolean DEFAULT false NOT NULL,
	"do_not_contact_reason" text,
	"do_not_contact_expires_at" date,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "venue_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"role" "venue_role" NOT NULL,
	"status" "venue_event_status" DEFAULT 'lead' NOT NULL,
	"slot_start_time" time,
	"slot_end_time" time,
	"agreed_hours_text" text,
	"drink_specials" text,
	"night_of_contact_name" text,
	"night_of_contact_phone_e164" text,
	"our_contact_staff_id" uuid,
	"our_contact_override_phone_e164" text,
	"confirmed_at" timestamp with time zone,
	"two_week_email_sent_at" timestamp with time zone,
	"one_week_email_sent_at" timestamp with time zone,
	"three_day_call_completed_at" timestamp with time zone,
	"floor_staff_call_completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_id" uuid NOT NULL,
	"outreach_brand_id" uuid NOT NULL,
	"staff_outreach_email_id" uuid NOT NULL,
	"gmail_thread_id" text NOT NULL,
	"subject" text,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "outreach_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_id" uuid NOT NULL,
	"venue_event_id" uuid,
	"outreach_brand_id" uuid NOT NULL,
	"staff_member_id" uuid NOT NULL,
	"staff_outreach_email_id" uuid,
	"channel" "outreach_channel" NOT NULL,
	"outcome" "outreach_outcome" NOT NULL,
	"subject" text,
	"body_snippet" text,
	"external_id" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reply_inbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email_thread_id" uuid NOT NULL,
	"venue_id" uuid NOT NULL,
	"assigned_staff_id" uuid,
	"category" "reply_category" DEFAULT 'unclear' NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"responded_at" timestamp with time zone,
	"sla_breached_at" timestamp with time zone,
	"summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wristbands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_event_id" uuid NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"status" "wristband_status" DEFAULT 'pending' NOT NULL,
	"shipping_address" text,
	"carrier" text,
	"tracking_number" text,
	"shipped_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"expected_delivery_date" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"source" "task_source" DEFAULT 'manual' NOT NULL,
	"status" "task_status" DEFAULT 'pending' NOT NULL,
	"target_type" "task_target_type" DEFAULT 'misc' NOT NULL,
	"target_id" uuid,
	"assigned_staff_id" uuid,
	"due_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"sla_threshold_minutes" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_type" "note_target_type" NOT NULL,
	"target_id" uuid NOT NULL,
	"author_staff_id" uuid NOT NULL,
	"body" text NOT NULL,
	"mentions" uuid[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "staff_info_sheets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_event_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"view_count" integer DEFAULT 0 NOT NULL,
	"first_viewed_at" timestamp with time zone,
	"last_viewed_at" timestamp with time zone,
	"custom_body_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outreach_brand_id" uuid NOT NULL,
	"stage" "email_template_stage" NOT NULL,
	"name" text NOT NULL,
	"subject_template" text NOT NULL,
	"body_template_html" text,
	"body_template_text" text NOT NULL,
	"merge_field_examples" jsonb,
	"is_default_for_stage" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "poster_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"crawl_brand_id" uuid NOT NULL,
	"name" text NOT NULL,
	"html_template" text NOT NULL,
	"preview_url" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_validations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"status" "email_validation_status" NOT NULL,
	"raw_response" jsonb,
	"validated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" "goal_scope" NOT NULL,
	"scope_id" uuid NOT NULL,
	"metric" "goal_metric" NOT NULL,
	"target_value" bigint NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"set_by_staff_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "financial_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outreach_brand_id" uuid,
	"crawl_brand_id" uuid,
	"campaign_id" uuid,
	"city_campaign_id" uuid,
	"line_type" "financial_line_type" NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency" text NOT NULL,
	"occurred_on" date NOT NULL,
	"external_ref" text,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "saved_filters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_member_id" uuid NOT NULL,
	"name" text NOT NULL,
	"target_view" text NOT NULL,
	"filter_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_shared" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"table_name" text NOT NULL,
	"record_id" uuid,
	"operation" "audit_operation" NOT NULL,
	"changed_by" uuid,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"old_values" jsonb,
	"new_values" jsonb
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crawl_brands" ADD CONSTRAINT "crawl_brands_default_outreach_brand_id_outreach_brands_id_fk" FOREIGN KEY ("default_outreach_brand_id") REFERENCES "public"."outreach_brands"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "staff_outreach_emails" ADD CONSTRAINT "staff_outreach_emails_staff_member_id_staff_members_id_fk" FOREIGN KEY ("staff_member_id") REFERENCES "public"."staff_members"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "staff_outreach_emails" ADD CONSTRAINT "staff_outreach_emails_outreach_brand_id_outreach_brands_id_fk" FOREIGN KEY ("outreach_brand_id") REFERENCES "public"."outreach_brands"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cities" ADD CONSTRAINT "cities_country_code_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."countries"("code") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_outreach_brand_id_outreach_brands_id_fk" FOREIGN KEY ("outreach_brand_id") REFERENCES "public"."outreach_brands"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_crawl_brand_id_crawl_brands_id_fk" FOREIGN KEY ("crawl_brand_id") REFERENCES "public"."crawl_brands"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "city_campaigns" ADD CONSTRAINT "city_campaigns_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "city_campaigns" ADD CONSTRAINT "city_campaigns_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "city_campaigns" ADD CONSTRAINT "city_campaigns_lead_staff_id_staff_members_id_fk" FOREIGN KEY ("lead_staff_id") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "events" ADD CONSTRAINT "events_city_campaign_id_city_campaigns_id_fk" FOREIGN KEY ("city_campaign_id") REFERENCES "public"."city_campaigns"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "venues" ADD CONSTRAINT "venues_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "venue_events" ADD CONSTRAINT "venue_events_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "venue_events" ADD CONSTRAINT "venue_events_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "venue_events" ADD CONSTRAINT "venue_events_our_contact_staff_id_staff_members_id_fk" FOREIGN KEY ("our_contact_staff_id") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_threads" ADD CONSTRAINT "email_threads_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_threads" ADD CONSTRAINT "email_threads_outreach_brand_id_outreach_brands_id_fk" FOREIGN KEY ("outreach_brand_id") REFERENCES "public"."outreach_brands"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_threads" ADD CONSTRAINT "email_threads_staff_outreach_email_id_staff_outreach_emails_id_fk" FOREIGN KEY ("staff_outreach_email_id") REFERENCES "public"."staff_outreach_emails"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outreach_log" ADD CONSTRAINT "outreach_log_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outreach_log" ADD CONSTRAINT "outreach_log_venue_event_id_venue_events_id_fk" FOREIGN KEY ("venue_event_id") REFERENCES "public"."venue_events"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outreach_log" ADD CONSTRAINT "outreach_log_outreach_brand_id_outreach_brands_id_fk" FOREIGN KEY ("outreach_brand_id") REFERENCES "public"."outreach_brands"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outreach_log" ADD CONSTRAINT "outreach_log_staff_member_id_staff_members_id_fk" FOREIGN KEY ("staff_member_id") REFERENCES "public"."staff_members"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outreach_log" ADD CONSTRAINT "outreach_log_staff_outreach_email_id_staff_outreach_emails_id_fk" FOREIGN KEY ("staff_outreach_email_id") REFERENCES "public"."staff_outreach_emails"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reply_inbox" ADD CONSTRAINT "reply_inbox_email_thread_id_email_threads_id_fk" FOREIGN KEY ("email_thread_id") REFERENCES "public"."email_threads"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reply_inbox" ADD CONSTRAINT "reply_inbox_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reply_inbox" ADD CONSTRAINT "reply_inbox_assigned_staff_id_staff_members_id_fk" FOREIGN KEY ("assigned_staff_id") REFERENCES "public"."staff_members"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "wristbands" ADD CONSTRAINT "wristbands_venue_event_id_venue_events_id_fk" FOREIGN KEY ("venue_event_id") REFERENCES "public"."venue_events"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigned_staff_id_staff_members_id_fk" FOREIGN KEY ("assigned_staff_id") REFERENCES "public"."staff_members"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notes" ADD CONSTRAINT "notes_author_staff_id_staff_members_id_fk" FOREIGN KEY ("author_staff_id") REFERENCES "public"."staff_members"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "staff_info_sheets" ADD CONSTRAINT "staff_info_sheets_venue_event_id_venue_events_id_fk" FOREIGN KEY ("venue_event_id") REFERENCES "public"."venue_events"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_outreach_brand_id_outreach_brands_id_fk" FOREIGN KEY ("outreach_brand_id") REFERENCES "public"."outreach_brands"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "poster_templates" ADD CONSTRAINT "poster_templates_crawl_brand_id_crawl_brands_id_fk" FOREIGN KEY ("crawl_brand_id") REFERENCES "public"."crawl_brands"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "goals" ADD CONSTRAINT "goals_set_by_staff_id_staff_members_id_fk" FOREIGN KEY ("set_by_staff_id") REFERENCES "public"."staff_members"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "financial_lines" ADD CONSTRAINT "financial_lines_outreach_brand_id_outreach_brands_id_fk" FOREIGN KEY ("outreach_brand_id") REFERENCES "public"."outreach_brands"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "financial_lines" ADD CONSTRAINT "financial_lines_crawl_brand_id_crawl_brands_id_fk" FOREIGN KEY ("crawl_brand_id") REFERENCES "public"."crawl_brands"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "financial_lines" ADD CONSTRAINT "financial_lines_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "financial_lines" ADD CONSTRAINT "financial_lines_city_campaign_id_city_campaigns_id_fk" FOREIGN KEY ("city_campaign_id") REFERENCES "public"."city_campaigns"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "saved_filters" ADD CONSTRAINT "saved_filters_staff_member_id_staff_members_id_fk" FOREIGN KEY ("staff_member_id") REFERENCES "public"."staff_members"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "crawl_brands_slug_unique" ON "crawl_brands" USING btree ("slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "crawl_brands_holiday_geography_idx" ON "crawl_brands" USING btree ("holiday_type","geography");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "crawl_brands_status_idx" ON "crawl_brands" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "outreach_brands_slug_unique" ON "outreach_brands" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "outreach_brands_email_domain_unique" ON "outreach_brands" USING btree ("email_domain");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outreach_brands_status_idx" ON "outreach_brands" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "staff_members_primary_email_unique" ON "staff_members" USING btree ("primary_email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "staff_members_status_idx" ON "staff_members" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "staff_members_role_idx" ON "staff_members" USING btree ("role");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "staff_outreach_emails_staff_brand_unique" ON "staff_outreach_emails" USING btree ("staff_member_id","outreach_brand_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "staff_outreach_emails_address_unique" ON "staff_outreach_emails" USING btree ("email_address");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "staff_outreach_emails_status_idx" ON "staff_outreach_emails" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cities_country_region_name_unique" ON "cities" USING btree ("country_code","region","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cities_country_name_idx" ON "cities" USING btree ("country_code","name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "campaigns_slug_unique" ON "campaigns" USING btree ("slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaigns_outreach_brand_idx" ON "campaigns" USING btree ("outreach_brand_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaigns_crawl_brand_idx" ON "campaigns" USING btree ("crawl_brand_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaigns_status_idx" ON "campaigns" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaigns_holiday_idx" ON "campaigns" USING btree ("holiday_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaigns_date_range_idx" ON "campaigns" USING btree ("start_date","end_date");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "city_campaigns_city_campaign_unique" ON "city_campaigns" USING btree ("city_id","campaign_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "city_campaigns_campaign_priority_idx" ON "city_campaigns" USING btree ("campaign_id","priority");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "city_campaigns_lead_staff_idx" ON "city_campaigns" USING btree ("lead_staff_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "city_campaigns_status_idx" ON "city_campaigns" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "events_city_campaign_date_slot_unique" ON "events" USING btree ("city_campaign_id","event_date","slot_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_city_campaign_idx" ON "events" USING btree ("city_campaign_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_event_date_idx" ON "events" USING btree ("event_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_eventbrite_id_idx" ON "events" USING btree ("eventbrite_event_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_status_idx" ON "events" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "venues_google_place_id_unique" ON "venues" USING btree ("google_place_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "venues_city_id_idx" ON "venues" USING btree ("city_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "venues_city_name_idx" ON "venues" USING btree ("city_id","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "venues_do_not_contact_idx" ON "venues" USING btree ("do_not_contact");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "venue_events_venue_event_unique" ON "venue_events" USING btree ("venue_id","event_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "venue_events_event_id_idx" ON "venue_events" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "venue_events_venue_id_idx" ON "venue_events" USING btree ("venue_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "venue_events_status_idx" ON "venue_events" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "venue_events_our_contact_idx" ON "venue_events" USING btree ("our_contact_staff_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "venue_events_role_status_idx" ON "venue_events" USING btree ("role","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "email_threads_thread_staff_unique" ON "email_threads" USING btree ("gmail_thread_id","staff_outreach_email_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_threads_venue_idx" ON "email_threads" USING btree ("venue_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_threads_last_message_idx" ON "email_threads" USING btree ("last_message_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outreach_log_venue_created_idx" ON "outreach_log" USING btree ("venue_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outreach_log_staff_created_idx" ON "outreach_log" USING btree ("staff_member_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outreach_log_venue_event_idx" ON "outreach_log" USING btree ("venue_event_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outreach_log_outreach_brand_idx" ON "outreach_log" USING btree ("outreach_brand_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outreach_log_channel_outcome_idx" ON "outreach_log" USING btree ("channel","outcome");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outreach_log_external_id_idx" ON "outreach_log" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reply_inbox_assigned_staff_idx" ON "reply_inbox" USING btree ("assigned_staff_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reply_inbox_received_at_idx" ON "reply_inbox" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reply_inbox_responded_at_idx" ON "reply_inbox" USING btree ("responded_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reply_inbox_sla_breached_idx" ON "reply_inbox" USING btree ("sla_breached_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reply_inbox_venue_idx" ON "reply_inbox" USING btree ("venue_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "wristbands_venue_event_unique" ON "wristbands" USING btree ("venue_event_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wristbands_status_idx" ON "wristbands" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wristbands_tracking_idx" ON "wristbands" USING btree ("tracking_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_assigned_due_idx" ON "tasks" USING btree ("assigned_staff_id","due_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_status_idx" ON "tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_target_idx" ON "tasks" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_source_idx" ON "tasks" USING btree ("source");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notes_target_idx" ON "notes" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notes_author_idx" ON "notes" USING btree ("author_staff_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notes_created_at_idx" ON "notes" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "staff_info_sheets_slug_unique" ON "staff_info_sheets" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "staff_info_sheets_venue_event_unique" ON "staff_info_sheets" USING btree ("venue_event_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "staff_info_sheets_view_count_idx" ON "staff_info_sheets" USING btree ("view_count");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "email_templates_brand_stage_name_unique" ON "email_templates" USING btree ("outreach_brand_id","stage","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_templates_brand_stage_idx" ON "email_templates" USING btree ("outreach_brand_id","stage");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_templates_default_idx" ON "email_templates" USING btree ("is_default_for_stage");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "poster_templates_brand_name_unique" ON "poster_templates" USING btree ("crawl_brand_id","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "poster_templates_brand_default_idx" ON "poster_templates" USING btree ("crawl_brand_id","is_default");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "email_validations_email_unique" ON "email_validations" USING btree ("email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_validations_status_idx" ON "email_validations" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_validations_validated_at_idx" ON "email_validations" USING btree ("validated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "goals_scope_id_idx" ON "goals" USING btree ("scope","scope_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "goals_period_idx" ON "goals" USING btree ("period_start","period_end");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "goals_metric_idx" ON "goals" USING btree ("metric");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "financial_lines_campaign_idx" ON "financial_lines" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "financial_lines_city_campaign_idx" ON "financial_lines" USING btree ("city_campaign_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "financial_lines_crawl_brand_idx" ON "financial_lines" USING btree ("crawl_brand_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "financial_lines_outreach_brand_idx" ON "financial_lines" USING btree ("outreach_brand_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "financial_lines_occurred_on_idx" ON "financial_lines" USING btree ("occurred_on");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "financial_lines_line_type_idx" ON "financial_lines" USING btree ("line_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "financial_lines_external_ref_idx" ON "financial_lines" USING btree ("external_ref");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "saved_filters_staff_name_unique" ON "saved_filters" USING btree ("staff_member_id","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "saved_filters_target_view_idx" ON "saved_filters" USING btree ("target_view");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "saved_filters_shared_idx" ON "saved_filters" USING btree ("is_shared");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_table_record_idx" ON "audit_log" USING btree ("table_name","record_id","changed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_changed_by_idx" ON "audit_log" USING btree ("changed_by","changed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_changed_at_idx" ON "audit_log" USING btree ("changed_at");