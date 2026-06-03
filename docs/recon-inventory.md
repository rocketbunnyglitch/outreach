# Engine Reconciliation - Inventory (auto-generated)

Generated from prod DB schema + repo source. Authoritative column list = information_schema.

## A. Database tables + columns (66 tables)


### _outreach_migrations_applied
  - filename: text NOT NULL
  - applied_at: timestamp with time zone NOT NULL [def]
  - checksum: text

### audit_log
  - id: bigint NOT NULL [def]
  - table_name: text NOT NULL
  - record_id: uuid
  - operation: USER-DEFINED NOT NULL
  - changed_by: uuid
  - changed_at: timestamp with time zone NOT NULL [def]
  - old_values: jsonb
  - new_values: jsonb

### call_logs
  - id: uuid NOT NULL [def]
  - provider: text NOT NULL [def]
  - external_id: text
  - direction: USER-DEFINED NOT NULL [def]
  - from_e164: text
  - to_e164: text
  - caller_name: text
  - status: text
  - duration_seconds: integer
  - recording_url: text
  - occurred_at: timestamp with time zone NOT NULL [def]
  - match_type: USER-DEFINED NOT NULL [def]
  - matched_venue_id: uuid
  - matched_staff_id: uuid
  - area_code: text
  - created_at: timestamp with time zone NOT NULL [def]
  - updated_at: timestamp with time zone NOT NULL [def]
  - created_by: uuid
  - updated_by: uuid

### campaign_connected_accounts
  - id: uuid NOT NULL [def]
  - campaign_id: uuid NOT NULL
  - connected_account_id: uuid NOT NULL
  - assigned_by: uuid
  - assigned_at: timestamp with time zone NOT NULL [def]

### campaigns
  - id: uuid NOT NULL [def]
  - slug: text NOT NULL
  - name: text NOT NULL
  - outreach_brand_id: uuid NOT NULL
  - crawl_brand_id: uuid NOT NULL
  - holiday_type: USER-DEFINED NOT NULL
  - status: USER-DEFINED NOT NULL [def]
  - start_date: date
  - end_date: date
  - public_subdomain: text
  - revenue_goal_cents: bigint
  - venue_count_goal: integer
  - archived_at: timestamp with time zone
  - created_at: timestamp with time zone NOT NULL [def]
  - updated_at: timestamp with time zone NOT NULL [def]
  - created_by: uuid
  - updated_by: uuid
  - version: integer NOT NULL [def]
  - target_cities_scheduled: integer
  - max_priority_for_scheduling: integer
  - target_ticket_sales_count: integer

### cities
  - id: uuid NOT NULL [def]
  - country_code: text NOT NULL
  - name: text NOT NULL
  - region: text
  - timezone: text NOT NULL
  - location: USER-DEFINED
  - archived_at: timestamp with time zone
  - created_at: timestamp with time zone NOT NULL [def]
  - updated_at: timestamp with time zone NOT NULL [def]
  - created_by: uuid
  - updated_by: uuid
  - version: integer NOT NULL [def]
  - override_reason: text

### city_campaigns
  - id: uuid NOT NULL [def]
  - city_id: uuid NOT NULL
  - campaign_id: uuid NOT NULL
  - priority: smallint NOT NULL [def]
  - target_venue_count: smallint NOT NULL [def]
  - target_wristband_count: smallint NOT NULL [def]
  - target_final_count: smallint NOT NULL [def]
  - target_middle_count: smallint NOT NULL [def]
  - current_sales_cents: bigint NOT NULL [def]
  - sales_goal_cents: bigint
  - lead_staff_id: uuid
  - status: USER-DEFINED NOT NULL [def]
  - created_at: timestamp with time zone NOT NULL [def]
  - updated_at: timestamp with time zone NOT NULL [def]
  - created_by: uuid
  - updated_by: uuid
  - version: integer NOT NULL [def]
  - dashboard_note: text
  - archived_at: timestamp with time zone

### cold_outreach_entries
  - id: uuid NOT NULL [def]
  - city_campaign_id: uuid NOT NULL
  - venue_id: uuid NOT NULL
  - status: USER-DEFINED NOT NULL [def]
  - assigned_staff_id: uuid
  - remarks: text
  - last_touch_at: timestamp with time zone
  - created_at: timestamp with time zone NOT NULL [def]
  - updated_at: timestamp with time zone NOT NULL [def]
  - created_by: uuid
  - updated_by: uuid
  - archived_at: timestamp with time zone
  - escalated_to_staff_id: uuid
  - escalated_at: timestamp with time zone
  - escalation_notes: text
  - ai_lead_score: smallint
  - ai_lead_score_reason: text
  - ai_lead_score_at: timestamp with time zone
  - is_warm: boolean NOT NULL [def]

### connected_accounts
  - id: uuid NOT NULL [def]
  - owner_user_id: uuid NOT NULL
  - email_address: text NOT NULL
  - gmail_oauth_refresh_token: text
  - gmail_oauth_scopes: ARRAY
  - gmail_last_history_id: text
  - quo_line_e164_override: text
  - status: USER-DEFINED NOT NULL [def]
  - last_synced_at: timestamp with time zone
  - created_at: timestamp with time zone NOT NULL [def]
  - updated_at: timestamp with time zone NOT NULL [def]
  - created_by: uuid
  - updated_by: uuid
  - version: integer NOT NULL [def]
  - gmail_last_polled_at: timestamp with time zone
  - team_id: uuid NOT NULL [def]
  - daily_cold_send_cap: integer NOT NULL [def]
  - signature_html: text

### countries
  - code: text NOT NULL
  - name: text NOT NULL
  - default_currency: text

### crawl_brands
  - id: uuid NOT NULL [def]
  - slug: text NOT NULL
  - display_name: text NOT NULL
  - holiday_type: USER-DEFINED NOT NULL
  - geography: USER-DEFINED NOT NULL
  - public_domain: text
  - logo_url: text
  - primary_color_hex: text
  - accent_color_hex: text
  - tagline: text
  - public_footer_text: text
  - eventbrite_organization_id: text
  - eventbrite_api_token: text
  - status: USER-DEFINED NOT NULL [def]
  - public_assets_enabled: boolean NOT NULL [def]
  - default_outreach_brand_id: uuid
  - template_version: text NOT NULL [def]
  - archived_at: timestamp with time zone
  - created_at: timestamp with time zone NOT NULL [def]
  - updated_at: timestamp with time zone NOT NULL [def]
  - created_by: uuid
  - updated_by: uuid
  - version: integer NOT NULL [def]

### crawl_deliverables
  - id: uuid NOT NULL [def]
  - venue_event_id: uuid NOT NULL
  - deliverable_type: USER-DEFINED NOT NULL
  - status: USER-DEFINED NOT NULL [def]
  - notes: text
  - assigned_staff_id: uuid
  - created_at: timestamp with time zone NOT NULL [def]
  - updated_at: timestamp with time zone NOT NULL [def]
  - created_by: uuid
  - updated_by: uuid

### crawl_hosts
  - id: uuid NOT NULL [def]
  - event_id: uuid NOT NULL
  - host_type: USER-DEFINED NOT NULL
  - internal_host_id: uuid
  - external_host_id: uuid
  - slot: smallint NOT NULL [def]
  - created_at: timestamp with time zone NOT NULL [def]
  - updated_at: timestamp with time zone NOT NULL [def]
  - created_by: uuid
  - updated_by: uuid
  - internal_host_name: text
  - internal_host_hours: numeric
  - internal_host_rate_cents: bigint

### crawl_issues
  - id: uuid NOT NULL [def]
  - city_campaign_id: uuid
  - event_id: uuid
  - venue_id: uuid
  - issue_type: USER-DEFINED NOT NULL
  - severity: USER-DEFINED NOT NULL [def]
  - status: USER-DEFINED NOT NULL [def]
  - caller_contact: text
  - assigned_staff_id: uuid
  - notes: text
  - resolved_at: timestamp with time zone
  - resolved_by: uuid
  - created_at: timestamp with time zone NOT NULL [def]
  - updated_at: timestamp with time zone NOT NULL [def]
  - created_by: uuid
  - updated_by: uuid
  - version: integer NOT NULL [def]

### cron_runs
  - id: uuid NOT NULL [def]
  - cron_name: text NOT NULL
  - status: text NOT NULL [def]
  - started_at: timestamp with time zone NOT NULL [def]
  - finished_at: timestamp with time zone
  - duration_ms: integer
  - error_message: text
  - result_summary: jsonb
  - host: text

### email_attachments
  - id: uuid NOT NULL [def]
  - message_id: uuid NOT NULL
  - filename: text NOT NULL
  - content_type: text
  - size_bytes: bigint
  - gmail_attachment_id: text
  - storage_url: text
  - inline_content_id: text
  - created_at: timestamp with time zone NOT NULL [def]

### email_drafts
  - id: uuid NOT NULL [def]
  - owner_user_id: uuid NOT NULL
  - team_id: uuid NOT NULL
  - connected_account_id: uuid
  - to_addresses: ARRAY NOT NULL [def]
  - cc_addresses: ARRAY NOT NULL [def]
  - bcc_addresses: ARRAY NOT NULL [def]
  - subject: text NOT NULL [def]
  - body_text: text NOT NULL [def]
  - body_html: text
  - venue_id: uuid
  - city_campaign_id: uuid
  - template_id: uuid
  - attachments: jsonb NOT NULL [def]
  - scheduled_for: timestamp with time zone
  - sent_at: timestamp with time zone
  - sent_thread_id: uuid
  - created_at: timestamp with time zone NOT NULL [def]
  - updated_at: timestamp with time zone NOT NULL [def]
  - mode: text
  - reply_to_thread_id: uuid
  - reply_to_message_id: uuid
  - pending_label_ids: ARRAY NOT NULL [def]
  - quoted_html: text

### email_messages
  - id: uuid NOT NULL [def]
  - thread_id: uuid NOT NULL
  - gmail_message_id: text NOT NULL
  - rfc_message_id: text
  - in_reply_to: text
  - kind: USER-DEFINED NOT NULL [def]
  - direction: USER-DEFINED NOT NULL
  - from_address: text NOT NULL
  - from_name: text
  - to_addresses: ARRAY NOT NULL [def]
  - cc_addresses: ARRAY NOT NULL [def]
  - bcc_addresses: ARRAY NOT NULL [def]
  - subject: text NOT NULL
  - body_text: text
  - body_html: text
  - snippet: text
  - gmail_labels: ARRAY NOT NULL [def]
  - raw_payload: jsonb
  - sent_at: timestamp with time zone NOT NULL
  - received_at: timestamp with time zone
  - read_at: timestamp with time zone
  - sent_by_staff_id: uuid
  - staff_outreach_email_id: uuid
  - created_at: timestamp with time zone NOT NULL [def]
  - created_by: uuid
  - search_tsv: tsvector
  - from_email_normalized: text
  - to_emails_normalized: ARRAY NOT NULL [def]
  - cc_emails_normalized: ARRAY NOT NULL [def]
  - bcc_emails_normalized: ARRAY NOT NULL [def]

### email_send_events
  - id: uuid NOT NULL [def]
  - connected_account_id: uuid NOT NULL
  - thread_id: uuid
  - sent_by_user_id: uuid
  - recipient_email: text NOT NULL
  - category: text NOT NULL
  - counted_against_cap: boolean NOT NULL
  - cap_bypassed: boolean NOT NULL [def]
  - sent_at: timestamp with time zone NOT NULL [def]
  - template_id: uuid
  - team_id: uuid
  - send_type: text NOT NULL [def]
  - to_emails_normalized: ARRAY
  - cc_emails_normalized: ARRAY
  - bcc_emails_normalized: ARRAY

### email_soft_bounces
  - id: uuid NOT NULL [def]
  - team_id: uuid NOT NULL
  - email: text NOT NULL
  - consecutive_count: integer NOT NULL [def]
  - last_subject: text
  - last_seen_at: timestamp with time zone NOT NULL [def]
  - first_seen_at: timestamp with time zone NOT NULL [def]

### email_suppression
  - id: uuid NOT NULL [def]
  - team_id: uuid NOT NULL
  - email: text NOT NULL
  - reason: text NOT NULL
  - notes: text
  - source_thread_id: uuid
  - created_by: uuid
  - created_at: timestamp with time zone NOT NULL [def]

### email_templates
  - id: uuid NOT NULL [def]
  - outreach_brand_id: uuid NOT NULL
  - stage: USER-DEFINED NOT NULL
  - name: text NOT NULL
  - subject_template: text NOT NULL
  - body_template_html: text
  - body_template_text: text NOT NULL
  - merge_field_examples: jsonb
  - is_default_for_stage: boolean NOT NULL [def]
  - archived_at: timestamp with time zone
  - created_at: timestamp with time zone NOT NULL [def]
  - updated_at: timestamp with time zone NOT NULL [def]
  - created_by: uuid
  - updated_by: uuid
  - version: integer NOT NULL [def]
  - campaign_id: uuid
  - template_code: text NOT NULL
  - trigger_context: jsonb NOT NULL [def]
  - auto_pick_priority: integer NOT NULL [def]

### email_thread_labels
  - thread_id: uuid NOT NULL
  - team_label_id: uuid
  - applied_by: uuid
  - applied_at: timestamp with time zone NOT NULL [def]
  - applied_via: text NOT NULL [def]
  - id: uuid NOT NULL [def]
  - gmail_label_id: text
  - connected_email_account_id: uuid
  - source: text NOT NULL [def]

### email_thread_mentions
  - id: uuid NOT NULL [def]
  - thread_id: uuid NOT NULL
  - note_id: uuid NOT NULL
  - mentioned_user_id: uuid NOT NULL
  - author_id: uuid NOT NULL
  - created_at: timestamp with time zone NOT NULL [def]
  - acknowledged_at: timestamp with time zone

### email_thread_notes
  - id: uuid NOT NULL [def]
  - thread_id: uuid NOT NULL
  - author_id: uuid NOT NULL
  - body: text NOT NULL
  - created_at: timestamp with time zone NOT NULL [def]
  - updated_at: timestamp with time zone NOT NULL [def]
  - deleted_at: timestamp with time zone

### email_threads
  - id: uuid NOT NULL [def]
  - venue_id: uuid
  - outreach_brand_id: uuid
  - staff_outreach_email_id: uuid NOT NULL
  - gmail_thread_id: text NOT NULL
  - subject: text
  - last_message_at: timestamp with time zone NOT NULL [def]
  - created_at: timestamp with time zone NOT NULL [def]
  - updated_at: timestamp with time zone NOT NULL [def]
  - created_by: uuid
  - updated_by: uuid
  - version: integer NOT NULL [def]
  - archived_at: timestamp with time zone
  - state: USER-DEFINED NOT NULL [def]
  - classification: USER-DEFINED NOT NULL [def]
  - direction: USER-DEFINED NOT NULL [def]
  - last_inbound_at: timestamp with time zone
  - last_outbound_at: timestamp with time zone
  - snippet: text
  - message_count: integer NOT NULL [def]
  - unread_count: integer NOT NULL [def]
  - last_sender_name: text
  - assigned_staff_id: uuid
  - city_campaign_id: uuid
  - event_id: uuid
  - is_stale: boolean NOT NULL [def]
  - stale_since: timestamp with time zone
  - stale_reason: text
  - follow_up_stage: smallint NOT NULL [def]
  - follow_up_next_due_at: timestamp with time zone
  - follow_up_last_advanced_at: timestamp with time zone
  - is_starred: boolean NOT NULL [def]
  - snooze_until: timestamp with time zone
  - deleted_at: timestamp with time zone
  - suggested_classification: USER-DEFINED
  - suggested_classification_confidence: numeric
  - suggested_classification_at: timestamp with time zone
  - ai_summary: jsonb
  - ai_summary_at: timestamp with time zone
  - ai_summary_message_count: integer
  - ai_next_action: jsonb
  - ai_next_action_at: timestamp with time zone
  - ai_next_action_message_count: integer
  - ai_quick_replies: jsonb
  - ai_quick_replies_at: timestamp with time zone
  - ai_quick_replies_message_count: integer
  - match_source: text
  - match_confidence: text

### email_validations
  - id: uuid NOT NULL [def]
  - email: text NOT NULL
  - status: USER-DEFINED NOT NULL
  - raw_response: jsonb
  - validated_at: timestamp with time zone NOT NULL [def]
  - created_at: timestamp with time zone NOT NULL [def]
  - updated_at: timestamp with time zone NOT NULL [def]
  - created_by: uuid
  - updated_by: uuid

### event_submission_sites
  - id: uuid NOT NULL [def]
  - city_id: uuid NOT NULL
  - name: text NOT NULL
  - url: text
  - notes: text
  - submitted: boolean NOT NULL [def]
  - submitted_at: timestamp with time zone
  - created_at: timestamp with time zone NOT NULL [def]
  - updated_at: timestamp with time zone NOT NULL [def]
  - created_by: uuid
  - updated_by: uuid
  - archived_at: timestamp with time zone

### events
  - id: uuid NOT NULL [def]
  - city_campaign_id: uuid NOT NULL
  - event_date: date NOT NULL
  - slot_number: smallint NOT NULL [def]
  - eventbrite_event_id: text
  - required_venue_count_total: smallint NOT NULL [def]
  - required_wristband_count: smallint NOT NULL [def]
  - required_final_count: smallint NOT NULL [def]
  - required_middle_count: smallint NOT NULL [def]
  - status: USER-DEFINED NOT NULL [def]
  - archived_at: timestamp with time zone
  - created_at: timestamp with time zone NOT NULL [def]
  - updated_at: timestamp with time zone NOT NULL [def]
  - created_by: uuid
  - updated_by: uuid
  - version: integer NOT NULL [def]
  - day_part: USER-DEFINED
  - crawl_number: smallint
  - ticket_sales_count: integer NOT NULL [def]
  - starts_at: timestamp with time zone
  - ends_at: timestamp with time zone
  - route_label: text
  - middle_venue_group_id: uuid
  - eventbrite_url: text
  - notes: text
  - crawl_format: USER-DEFINED NOT NULL [def]
  - crawl_name: text
  - override_reason: text

### external_host_shipments
  - id: uuid NOT NULL [def]
  - external_host_id: uuid NOT NULL
  - city_campaign_id: uuid NOT NULL
  - status: USER-DEFINED NOT NULL [def]
  - wristband_count: integer
  - tracking_number: text
  - shipped_at: timestamp with time zone
  - notes: text NOT NULL [def]
  - created_at: timestamp with time zone NOT NULL [def]
  - updated_at: timestamp with time zone NOT NULL [def]
  - created_by: uuid
  - updated_by: uuid

### external_hosts
  - id: uuid NOT NULL [def]
  - full_name: text NOT NULL
  - email: text
  - phone_e164: text
  - pay_rate_cents: bigint NOT NULL [def]
  - currency: text NOT NULL [def]
  - address: text
  - payment_method: USER-DEFINED
  - payment_contact: text
  - notes: text
  - created_at: timestamp with time zone NOT NULL [def]
  - updated_at: timestamp with time zone NOT NULL [def]
  - created_by: uuid
  - updated_by: uuid
  - archived_at: timestamp with time zone

### financial_lines
  - id: uuid NOT NULL [def]
  - outreach_brand_id: uuid
  - crawl_brand_id: uuid
  - campaign_id: uuid
  - city_campaign_id: uuid
  - line_type: USER-DEFINED NOT NULL
  - amount_cents: bigint NOT NULL
  - currency: text NOT NULL
  - occurred_on: date NOT NULL
  - external_ref: text
  - notes: text NOT NULL [def]
  - created_at: timestamp with time zone NOT NULL [def]
  - updated_at: timestamp with time zone NOT NULL [def]
  - created_by: uuid
  - updated_by: uuid
  - version: integer NOT NULL [def]

### geography_columns
  - f_table_catalog: name
  - f_table_schema: name
  - f_table_name: name
  - f_geography_column: name
  - coord_dimension: integer
  - srid: integer
  - type: text

### geometry_columns
  - f_table_catalog: character varying
  - f_table_schema: name
  - f_table_name: name
  - f_geometry_column: name
  - coord_dimension: integer
  - srid: integer
  - type: character varying

### gmail_labels
  - id: uuid NOT NULL [def]
  - connected_account_id: uuid NOT NULL
  - gmail_label_id: text NOT NULL
  - name: text NOT NULL
  - type: text NOT NULL
  - parent_label_id: text
  - background_color: text
  - text_color: text
  - unread_count: integer NOT NULL [def]
  - total_count: integer NOT NULL [def]
  - synced_at: timestamp with time zone NOT NULL [def]
  - created_at: timestamp with time zone NOT NULL [def]
  - updated_at: timestamp with time zone NOT NULL [def]

### goals
  - id: uuid NOT NULL [def]
  - scope: USER-DEFINED NOT NULL
  - scope_id: uuid NOT NULL
  - metric: USER-DEFINED NOT NULL
  - target_value: bigint NOT NULL
  - period_start: date NOT NULL
  - period_end: date NOT NULL
  - set_by_staff_id: uuid NOT NULL
  - created_at: timestamp with time zone NOT NULL [def]
  - updated_at: timestamp with time zone NOT NULL [def]
  - created_by: uuid
  - updated_by: uuid
  - version: integer NOT NULL [def]

### inbox_alert_dispatches
  - id: uuid NOT NULL [def]
  - rule_id: uuid NOT NULL
  - fired_at: timestamp with time zone NOT NULL [def]
  - observed_value: numeric NOT NULL
  - channel: text NOT NULL
  - status: text NOT NULL
  - notes: text

### inbox_alert_rules
  - id: uuid NOT NULL [def]
  - connected_account_id: uuid NOT NULL
  - rule_kind: text NOT NULL
  - threshold: numeric NOT NULL
  - enabled: boolean NOT NULL [def]
  - channels: ARRAY NOT NULL [def]
  - created_at: timestamp with time zone NOT NULL [def]
  - updated_at: timestamp with time zone NOT NULL [def]

### inbox_daily_stats
  - id: uuid NOT NULL [def]
  - connected_account_id: uuid NOT NULL
  - stat_date: date NOT NULL
  - cold_sends: integer NOT NULL [def]
  - replies: integer NOT NULL [def]
  - bounces: integer NOT NULL [def]
  - stale_threads_at_eod: integer NOT NULL [def]
  - computed_at: timestamp with time zone NOT NULL [def]

### inbox_saved_searches
  - id: uuid NOT NULL [def]
  - user_id: uuid NOT NULL
  - label: text NOT NULL
  - query_text: text NOT NULL
  - sort_order: integer
  - created_at: timestamp with time zone NOT NULL [def]
  - updated_at: timestamp with time zone NOT NULL [def]

### internal_hosts
  - id: uuid NOT NULL [def]
  - name: text NOT NULL
  - pay_rate_cents: bigint NOT NULL [def]
  - hours_worked: numeric NOT NULL [def]
  - currency: text NOT NULL [def]
  - payment_method: USER-DEFINED
  - payment_details: text
  - notes: text
  - created_at: timestamp with time zone NOT NULL [def]
  - updated_at: timestamp with time zone NOT NULL [def]
  - created_by: uuid
  - updated_by: uuid
  - archived_at: timestamp with time zone

### invite_tokens
  - id: uuid NOT NULL [def]
  - team_id: uuid NOT NULL [def]
  - email: text NOT NULL
  - kind: text NOT NULL [def]
  - role: text
  - target_user_id: uuid
  - token_hash: text NOT NULL
  - created_by: uuid
  - expires_at: timestamp with time zone NOT NULL
  - accepted_at: timestamp with time zone
  - accepted_by_user_id: uuid
  - created_at: timestamp with time zone NOT NULL [def]

### middle_venue_group_members
  - id: uuid NOT NULL [def]
  - middle_venue_group_id: uuid NOT NULL
  - venue_id: uuid NOT NULL
  - status: text NOT NULL [def]
  - slot_start_time: time without time zone
  - slot_end_time: time without time zone
  - agreed_hours_text: text
  - drink_specials: text
  - notes: text
  - confirmed_at: timestamp with time zone
  - created_at: timestamp with time zone NOT NULL [def]
  - updated_at: timestamp with time zone NOT NULL [def]
  - created_by: uuid
  - updated_by: uuid
  - version: integer NOT NULL [def]

### middle_venue_groups
  - id: uuid NOT NULL [def]
  - city_campaign_id: uuid NOT NULL
  - name: text NOT NULL
  - day_part: USER-DEFINED
  - status: text NOT NULL [def]
  - notes: text
  - created_at: timestamp with time zone NOT NULL [def]
  - updated_at: timestamp with time zone NOT NULL [def]
  - created_by: uuid
  - updated_by: uuid
  - archived_at: timestamp with time zone
  - version: integer NOT NULL [def]

### note_action_suggestions
  - id: uuid NOT NULL [def]
  - note_id: uuid NOT NULL
  - note_content_hash: text NOT NULL
  - status: text NOT NULL [def]
  - title: text NOT NULL
  - description: text NOT NULL [def]
  - action_type: text NOT NULL
  - due_at: timestamp with time zone
  - timezone: text NOT NULL
  - venue_id: uuid
  - phone_e164: text
  - confidence: text NOT NULL [def]
  - source_text: text NOT NULL
  - task_id: uuid
  - created_at: timestamp with time zone NOT NULL [def]
  - updated_at: timestamp with time zone NOT NULL [def]
  - created_by: uuid
  - updated_by: uuid
  - archived_at: timestamp with time zone

### notes
  - id: uuid NOT NULL [def]
  - target_type: USER-DEFINED NOT NULL
  - target_id: uuid NOT NULL
  - author_staff_id: uuid NOT NULL
  - body: text NOT NULL
  - mentions: ARRAY NOT NULL [def]
  - created_at: timestamp with time zone NOT NULL [def]
  - updated_at: timestamp with time zone NOT NULL [def]
  - created_by: uuid
  - updated_by: uuid

### notifications
  - id: uuid NOT NULL [def]
  - staff_id: uuid NOT NULL
  - kind: USER-DEFINED NOT NULL
  - title: text NOT NULL
  - body: text
  - link_path: text
  - metadata: jsonb NOT NULL [def]
  - read_at: timestamp with time zone
  - created_at: timestamp with time zone NOT NULL [def]

### outreach_brands
  - id: uuid NOT NULL [def]
  - slug: text NOT NULL
  - display_name: text NOT NULL
  - email_domain: text NOT NULL
  - postmark_account_id: text
  - postmark_server_token: text
  - postmark_sender_signature: text
  - email_signature_html: text
  - email_signature_text: text
  - quo_line_e164: text
  - status: USER-DEFINED NOT NULL [def]
  - archived_at: timestamp with time zone
  - created_at: timestamp with time zone NOT NULL [def]
  - updated_at: timestamp with time zone NOT NULL [def]
  - created_by: uuid
  - updated_by: uuid
  - version: integer NOT NULL [def]
  - outreach_phase: smallint NOT NULL [def]
  - outreach_phase_set_at: timestamp with time zone NOT NULL [def]
  - outreach_phase_set_by: uuid
  - viber_line_e164: text

### outreach_log
  - id: uuid NOT NULL [def]
  - venue_id: uuid NOT NULL
  - venue_event_id: uuid
  - outreach_brand_id: uuid NOT NULL
  - staff_member_id: uuid NOT NULL
  - staff_outreach_email_id: uuid
  - channel: USER-DEFINED NOT NULL
  - outcome: USER-DEFINED NOT NULL
  - subject: text
  - body_snippet: text
  - external_id: text
  - notes: text
  - created_at: timestamp with time zone NOT NULL [def]
  - created_by: uuid

### places_enrichment_cache
  - id: uuid NOT NULL [def]
  - lookup_key: text NOT NULL
  - city_id: uuid NOT NULL
  - query_text: text NOT NULL
  - resolved_place_id: text
  - resolved_name: text
  - resolved_address: text
  - resolved_phone_e164: text
  - resolved_website: text
  - resolved_lat: double precision
  - resolved_lng: double precision
  - resolved_rating: numeric
  - resolved_user_rating_count: integer
  - resolved_types: ARRAY NOT NULL [def]
  - resolved_at: timestamp with time zone NOT NULL [def]
  - confidence: text NOT NULL [def]

### poster_templates
  - id: uuid NOT NULL [def]
  - crawl_brand_id: uuid NOT NULL
  - name: text NOT NULL
  - html_template: text NOT NULL
  - preview_url: text
  - is_default: boolean NOT NULL [def]
  - archived_at: timestamp with time zone
  - created_at: timestamp with time zone NOT NULL [def]
  - updated_at: timestamp with time zone NOT NULL [def]
  - created_by: uuid
  - updated_by: uuid
  - version: integer NOT NULL [def]

### reference_doc_sections
  - id: uuid NOT NULL [def]
  - reference_doc_id: uuid NOT NULL
  - section_code: text NOT NULL
  - section_title: text NOT NULL
  - section_body: text NOT NULL
  - section_level: integer NOT NULL
  - parent_section_code: text
  - section_order: integer NOT NULL
  - tags: ARRAY NOT NULL [def]
  - search_tsv: tsvector

### reference_docs
  - id: uuid NOT NULL [def]
  - doc_slug: text NOT NULL
  - campaign_id: uuid
  - version: integer NOT NULL
  - full_markdown: text NOT NULL
  - loaded_at: timestamp with time zone NOT NULL [def]
  - file_hash: text NOT NULL

### reply_inbox
  - id: uuid NOT NULL [def]
  - email_thread_id: uuid NOT NULL
  - venue_id: uuid NOT NULL
  - assigned_staff_id: uuid
  - category: USER-DEFINED NOT NULL [def]
  - received_at: timestamp with time zone NOT NULL
  - responded_at: timestamp with time zone
  - sla_breached_at: timestamp with time zone
  - summary: text
  - created_at: timestamp with time zone NOT NULL [def]
  - updated_at: timestamp with time zone NOT NULL [def]
  - created_by: uuid
  - updated_by: uuid

### saved_filters
  - id: uuid NOT NULL [def]
  - staff_member_id: uuid NOT NULL
  - name: text NOT NULL
  - target_view: text NOT NULL
  - filter_json: jsonb NOT NULL [def]
  - is_shared: boolean NOT NULL [def]
  - created_at: timestamp with time zone NOT NULL [def]
  - updated_at: timestamp with time zone NOT NULL [def]
  - created_by: uuid
  - updated_by: uuid
  - version: integer NOT NULL [def]

### spatial_ref_sys
  - srid: integer NOT NULL
  - auth_name: character varying
  - auth_srid: integer
  - srtext: character varying
  - proj4text: character varying

### staff_info_sheets
  - id: uuid NOT NULL [def]
  - venue_event_id: uuid NOT NULL
  - slug: text NOT NULL
  - view_count: integer NOT NULL [def]
  - first_viewed_at: timestamp with time zone
  - last_viewed_at: timestamp with time zone
  - custom_body_text: text
  - created_at: timestamp with time zone NOT NULL [def]
  - updated_at: timestamp with time zone NOT NULL [def]
  - created_by: uuid
  - updated_by: uuid
  - version: integer NOT NULL [def]

### staff_views
  - id: uuid NOT NULL [def]
  - staff_id: uuid NOT NULL
  - surface: text NOT NULL
  - context_id: uuid
  - name: text NOT NULL
  - params: jsonb NOT NULL [def]
  - sort_order: integer NOT NULL [def]
  - created_at: timestamp with time zone NOT NULL [def]
  - updated_at: timestamp with time zone NOT NULL [def]

### tasks
  - id: uuid NOT NULL [def]
  - title: text NOT NULL
  - description: text NOT NULL [def]
  - source: USER-DEFINED NOT NULL [def]
  - status: USER-DEFINED NOT NULL [def]
  - target_type: USER-DEFINED NOT NULL [def]
  - target_id: uuid
  - assigned_staff_id: uuid
  - due_at: timestamp with time zone
  - completed_at: timestamp with time zone
  - sla_threshold_minutes: integer
  - created_at: timestamp with time zone NOT NULL [def]
  - updated_at: timestamp with time zone NOT NULL [def]
  - created_by: uuid
  - updated_by: uuid
  - version: integer NOT NULL [def]

### team_label_gmail_links
  - id: uuid NOT NULL [def]
  - team_label_id: uuid NOT NULL
  - connected_account_id: uuid NOT NULL
  - gmail_label_id: text NOT NULL
  - created_at: timestamp with time zone NOT NULL [def]

### team_labels
  - id: uuid NOT NULL [def]
  - team_id: uuid NOT NULL
  - name: text NOT NULL
  - color: text
  - created_by: uuid
  - created_at: timestamp with time zone NOT NULL [def]
  - updated_at: timestamp with time zone NOT NULL [def]
  - updated_by: uuid

### teams
  - id: uuid NOT NULL [def]
  - name: text NOT NULL
  - slug: text NOT NULL
  - created_at: timestamp with time zone NOT NULL [def]
  - updated_at: timestamp with time zone NOT NULL [def]

### user_preferences
  - user_id: uuid NOT NULL
  - inbox_density: text
  - inbox_reading_pane: text
  - updated_at: timestamp with time zone NOT NULL [def]
  - created_at: timestamp with time zone NOT NULL [def]
  - inbox_account_filters: jsonb NOT NULL [def]
  - daily_digest_enabled: boolean [def]

### users
  - id: uuid NOT NULL [def]
  - display_name: text NOT NULL
  - primary_email: text NOT NULL
  - role: USER-DEFINED NOT NULL [def]
  - status: USER-DEFINED NOT NULL [def]
  - timezone: text NOT NULL [def]
  - weekly_email_goal: integer NOT NULL [def]
  - weekly_call_goal: integer NOT NULL [def]
  - archived_at: timestamp with time zone
  - created_at: timestamp with time zone NOT NULL [def]
  - updated_at: timestamp with time zone NOT NULL [def]
  - created_by: uuid
  - updated_by: uuid
  - version: integer NOT NULL [def]
  - phone_e164: text
  - title: text
  - manager_id: uuid
  - team_id: uuid NOT NULL [def]
  - password_hash: text
  - password_set_at: timestamp with time zone
  - password_must_change: boolean NOT NULL [def]
  - digest_sent_at: timestamp with time zone

### venue_domain_aliases
  - id: uuid NOT NULL [def]
  - venue_id: uuid NOT NULL
  - domain: text NOT NULL
  - notes: text
  - created_at: timestamp with time zone NOT NULL [def]
  - created_by: uuid

### venue_events
  - id: uuid NOT NULL [def]
  - venue_id: uuid NOT NULL
  - event_id: uuid NOT NULL
  - role: USER-DEFINED NOT NULL
  - status: USER-DEFINED NOT NULL [def]
  - slot_start_time: time without time zone
  - slot_end_time: time without time zone
  - agreed_hours_text: text
  - drink_specials: text
  - night_of_contact_name: text
  - night_of_contact_phone_e164: text
  - our_contact_staff_id: uuid
  - our_contact_override_phone_e164: text
  - confirmed_at: timestamp with time zone
  - two_week_email_sent_at: timestamp with time zone
  - one_week_email_sent_at: timestamp with time zone
  - three_day_call_completed_at: timestamp with time zone
  - floor_staff_call_completed_at: timestamp with time zone
  - created_at: timestamp with time zone NOT NULL [def]
  - updated_at: timestamp with time zone NOT NULL [def]
  - created_by: uuid
  - updated_by: uuid
  - version: integer NOT NULL [def]
  - slot_position: smallint

### venues
  - id: uuid NOT NULL [def]
  - city_id: uuid NOT NULL
  - name: text NOT NULL
  - google_place_id: text
  - address: text
  - location: USER-DEFINED
  - phone_e164: text
  - email: text
  - alternate_emails: ARRAY NOT NULL [def]
  - website_url: text
  - instagram_handle: text
  - capacity: integer
  - venue_type: ARRAY NOT NULL [def]
  - serves_alcohol: boolean NOT NULL [def]
  - internal_notes: text NOT NULL [def]
  - do_not_contact: boolean NOT NULL [def]
  - do_not_contact_reason: text
  - do_not_contact_expires_at: date
  - archived_at: timestamp with time zone
  - created_at: timestamp with time zone NOT NULL [def]
  - updated_at: timestamp with time zone NOT NULL [def]
  - created_by: uuid
  - updated_by: uuid
  - version: integer NOT NULL [def]
  - hours: text
  - ai_venue_type_at: timestamp with time zone
  - contact_name: text
  - verified_from_google_at: timestamp with time zone

### wristbands
  - id: uuid NOT NULL [def]
  - venue_event_id: uuid NOT NULL
  - quantity: integer NOT NULL [def]
  - status: USER-DEFINED NOT NULL [def]
  - shipping_address: text
  - carrier: text
  - tracking_number: text
  - shipped_at: timestamp with time zone
  - delivered_at: timestamp with time zone
  - expected_delivery_date: date
  - notes: text
  - created_at: timestamp with time zone NOT NULL [def]
  - updated_at: timestamp with time zone NOT NULL [def]
  - created_by: uuid
  - updated_by: uuid
  - version: integer NOT NULL [def]
  - recipient_name: text
  - recipient_phone: text

## B. lib/ helpers (exports per file)

### lib/account-filter.ts
  17:export function parseAccountIds(raw: string | undefined): string[] | undefined 

### lib/activity-history.ts
  22:export interface ActivityEntry 
  78:export async function loadRowActivity(params: 
  139:export interface ActivitySummary 
  144:export async function loadActivitySummary(params: 

### lib/ai-auto-status.ts
  104:export interface AutoStatusContext 
  115:export async function syncColdStatusFromClassificationAsync(
  128:export async function syncColdStatusFromClassification(input: AutoStatusContext): Promise<void> 

### lib/ai-classify.ts
  134:export async function classifyInboundMessageAsync(input: ClassifyInput): Promise<void> 
  149:export async function classifyInboundMessage(

### lib/ai-csv-mapping.ts
  93:export interface CsvColumnMapping 
  110:export async function suggestCsvMapping(input: 
  277:export function applyMappingToCsv(opts: 

### lib/ai-eb-polish.ts
  81:export async function polishEbDescription(input: PolishInput): Promise<PolishResult> 

### lib/ai-extract-promises.ts
  160:export async function extractPromisesAsync(input: ExtractInput): Promise<void> 
  171:export async function extractPromisesAndCreateTasks(

### lib/ai-guardrails.ts
  59:export function isAiFeatureEnabled(feature: string): boolean 
  102:export function checkAiRateLimit(opts: 
  139:export function sweepStaleBuckets(): void 
  163:export function truncateForAi(text: string, maxChars: number): string 
  177:export function approxTokenCount(text: string): number 

### lib/ai-lead-score.ts
  120:export interface LeadScoreInput 
  135:export interface LeadScoreResult 
  153:export async function scoreLeadBatch(opts: ScoreBatchOpts): Promise<
  282:export interface BackfillResult 
  302:export async function backfillLeadScores(opts: 

### lib/ai-next-action.ts
  101:export interface EnrichedAction 
  117:export async function enrichNextActionAsync(input: EnrichInput): Promise<void> 
  129:export async function enrichNextAction(input: EnrichInput): Promise<EnrichedAction | null> 

### lib/ai-quick-replies.ts
  112:export interface QuickRepliesContext 
  122:export async function generateQuickRepliesAsync(input: QuickRepliesContext): Promise<void> 
  136:export async function generateQuickReplies(input: QuickRepliesContext): Promise<void> 
  319:export function hasCachedQuickReplies(thread: 
  342:export function isEligibleForQuickReplies(thread: 

### lib/ai-reply.ts
  34:export type DraftReplyResult
  42:export interface ReplyPromptContext 
  59:export async function buildReplyPromptContext(opts: 
  212:export async function draftReply(opts: 

### lib/ai-subject-suggest.ts
  80:export interface SubjectSuggestion 
  108:export async function suggestSubjectLines(input: SuggestInput): Promise<SuggestResult> 

### lib/ai-summarize.ts
  42:export const SUMMARY_MIN_MESSAGES
  82:export interface ThreadSummary 
  94:export async function summarizeThreadAsync(input: SummaryInput): Promise<void> 
  107:export async function summarizeThread(input: SummaryInput): Promise<SummaryResult | null> 

### lib/ai.ts
  38:export type AiReason
  60:export type AiResult
  73:export function isAiConfigured(): boolean 
  161:export async function generateCompletion(opts: 
  249:export type StreamChunk
  254:export async function* streamCompletion(opts: 
  309:export async function draftOutreachEmail(input: 
  557:export interface RankedCandidate 
  566:export async function rankVenueCandidates(input: 

### lib/ai-venue-type-tag.ts
  112:export interface VenueTypeTagInput 
  119:export interface VenueTypeTagResult 
  132:export async function tagVenueBatch(opts: TagBatchOpts): Promise<
  244:export interface BackfillResult 
  262:export async function backfillVenueTypes(opts: 

### lib/all-crawls-data.ts
  22:export type CrawlStatusPill
  24:export interface AllCrawlsRow 
  50:export async function loadAllCrawlsForCampaign(campaignId: string): Promise<AllCrawlsRow[]> 

### lib/attachment-storage.ts
  93:export function isAttachmentStorageEnabled(): boolean 
  97:export interface SignedUploadInput 
  106:export interface SignedUploadResult 
  118:export type SignedUploadOutput
  125:export async function createSignedUpload(input: SignedUploadInput): Promise<SignedUploadOutput> 
  164:export async function fetchAttachmentBytes(storageKey: string): Promise<Buffer | null> 
  190:export async function deleteAttachment(storageKey: string): Promise<void> 
  205:export function isValidStorageKey(key: string, teamId: string): boolean 

### lib/auth.ts
  28:export interface AuthContext 
  38:export async function getCurrentStaff(): Promise<AuthContext | null> 
  72:export async function requireStaff(): Promise<AuthContext> 
  95:export async function requireAdmin(): Promise<AuthContext> 
  112:export async function getAdminOrNull(): Promise<AuthContext | null> 
  141:export type StaffRole
  163:export function hasMinimumRole(staff: 
  184:export async function requireMinimumRole(minRole: StaffRole): Promise<AuthContext> 
  199:export async function getMinimumRoleOrNull(minRole: StaffRole): Promise<AuthContext | null> 
  223:export async function getSuperUserOrNull(): Promise<AuthContext | null> 
  230:export async function requireSuperUser(): Promise<AuthContext> 

### lib/brand-context.ts
  29:export interface BrandPair 
  43:export async function listOutreachBrands(opts: ListOptions
  52:export async function getOutreachBrand(idOrSlug: string): Promise<OutreachBrand | null> 
  65:export async function listCrawlBrands(opts: ListOptions
  74:export async function getCrawlBrand(idOrSlug: string): Promise<CrawlBrand | null> 
  92:export async function getCampaignBrands(campaignId: string): Promise<BrandPair | null> 
  111:export async function requireCampaignBrands(campaignId: string): Promise<BrandPair> 
  132:export function checkCrawlBrandGeographyCompatibility(
  145:export type 

### lib/cadence-engine-core.ts
  19:export const COLD_TOUCH_2_OFFSET_DAYS
  20:export const COLD_TOUCH_3_OFFSET_DAYS
  22:export const WARM_NUDGE_1_OFFSET_DAYS
  23:export const WARM_NUDGE_2_OFFSET_DAYS
  24:export const WARM_NUDGE_3_OFFSET_DAYS
  26:export const CROSS_DOMAIN_FLOOR_DAYS
  28:export const DEFAULT_HARD_CAP
  32:export function addDays(d: Date, days: number): Date 
  36:export interface CadencePlanCore 
  55:export function planFromState(state: CadenceState, lastTouchAt: Date): CadencePlanCore | null 
  114:export function terminalStateFor(state: CadenceState): CadenceState | null 
  120:export interface FloorCheckCoreArgs 
  129:export interface FloorCheckCoreResult 
  144:export function checkFloors(args: FloorCheckCoreArgs): FloorCheckCoreResult 

### lib/cadence-engine.ts
  30:export interface NextTouchPlan 
  40:export interface CadenceFloorCheckArgs 
  47:export interface CadenceFloorCheckResult 
  135:export async function planNextTouch(
  190:export async function checkCadenceFloors(
  232:export async function recordTouch(args: 

### lib/calendar.ts
  37:export type CalendarItemType
  50:export interface CalendarItem 
  104:export async function loadCalendarItems(opts: LoadOpts): Promise<CalendarItem[]> 
  364:export async function loadCalendarItemsForTarget(opts: 

### lib/call-matching.ts
  19:export interface CallMatch 
  27:export function extractAreaCode(e164: string | null | undefined): string | null 
  35:export async function matchCaller(e164: string | null | undefined): Promise<CallMatch> 

### lib/campaign-info-data.ts
  20:export interface CampaignInboxRow 
  35:export interface TeamMemberOption 
  41:export interface BrandOption 
  46:export interface CampaignInfoData 
  53:export async function loadCampaignInfo(opts: 

### lib/campaign-matcher.ts
  39:export interface CampaignSuggestion 
  78:export async function suggestCampaignsForThread(opts: 

### lib/chunk-reload.ts
  57:export function looksLikeChunkError(value: unknown): boolean 
  61:export function looksLikeHydrationError(value: unknown): boolean 
  65:export function looksLikeStaleServerAction(value: unknown): boolean 
  75:export function maybeReloadForChunkError(value: unknown): boolean 

### lib/city-name-match.ts
  39:export interface CityCandidate 
  45:export type MatchConfidence
  47:export interface MatchResult 
  65:export function normalizeCityName(s: string): string 
  140:export function matchCity(rawInput: string, cities: CityCandidate[]): MatchResult 
  279:export function parseBulkCityCsv(input: string): Array<

### lib/city-progress-shared.ts
  8:export type SlotState
  10:export interface CitySlot 
  22:export interface CityCrawl 
  37:export interface CityProgressRow 
  67:export type CityRisk
  70:export type PipelineHealth
  72:export function pipelineHealthFor(row: CityProgressRow): PipelineHealth 

### lib/city-progress.ts
  117:export async function loadCityCampaignProgress(campaignId: string): Promise<CityProgressRow[]> 

### lib/city-sheet-data.ts
  54:export async function loadCitySheet(cityCampaignId: string): Promise<CitySheetData | null> 

### lib/city-sheet-shared.ts
  8:export type SlotRole
  17:export const SLOT_ROLE_ORDER: Record<SlotRole, number>
  24:export interface SlotRow 
  52:export interface SlotReuseRef 
  59:export interface GroupMemberRow 
  70:export interface CrawlHostRef 
  86:export interface CrawlCard 
  160:export interface CitySheetData 

### lib/city-venues-data.ts
  47:export interface CityVenueRow 
  76:export interface SlotHistoryEntry 
  106:export async function loadCityVenues(opts: 

### lib/client-diag.ts
  24:export const CLIENT_DIAG_SCRIPT

### lib/client-error.ts
  73:export function newClientErrorCode(): string 
  101:export function captureClientError(err: unknown, opts: CaughtFromAwaitOpts): CaughtResult 

### lib/cluster-builder.ts
  21:export async function fetchClusterableVenues(cityId: string): Promise<VenueForClustering[]> 
  65:export async function countVenuesWithoutCoordinates(cityId: string): Promise<number> 
  77:export async function buildClustersForCity(cityId: string, radiusMeters

### lib/clustering.ts
  29:export interface VenueForClustering 
  43:export interface VenueCluster 
  59:export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number 
  78:export function clusterVenuesByWalkingDistance(
  148:export function formatDistance(meters: number): string 

### lib/cn.ts
  13:export function cn(...inputs: ClassValue[]): string 

### lib/compose-send-impl.ts
  44:export async function composeAndSendImpl(

### lib/confirmation-cascade.ts
  38:export async function generateConfirmationCascade(
  154:export function isConfirmationTransition(

### lib/crawl-management-data.ts
  28:export interface DeliverableState 
  37:export interface CrawlMgmtVenueRow 
  57:export interface CrawlMgmtCrawlRow 
  67:export interface CrawlMgmtCity 
  85:export async function loadCrawlManagement(opts: 

### lib/crawl-matrix.ts
  55:export type CrawlStatus
  64:export interface CrawlMatrixRow 
  101:export async function buildCrawlMatrix(opts: 
  373:export interface HostShipmentRow 
  387:export async function loadExternalHostShipments(
  419:export interface VenueWristbandRow 
  434:export async function loadVenueWristbandShipments(

### lib/crawl-support.ts
  53:export type 
  82:export async function loadCrawlSupport(opts?: 
  299:export async function loadCrawlIssues(opts?: 
  354:export interface SupportStaffOption 
  360:export async function loadSupportStaff(): Promise<SupportStaffOption[]> 
  377:export async function loadRecentCalls(opts?: 

### lib/crawl-support-types.ts
  7:export type CrawlSupportStatus
  16:export type SupportBucket
  18:export interface SupportCrawl 
  67:export type ReadinessLevel
  69:export interface ReadinessReason 
  86:export interface Readiness 
  91:export const READINESS_LABEL: Record<ReadinessLevel, string>
  97:export const READINESS_TONE: Record<ReadinessLevel, string>
  118:export function computeReadiness(c: 
  195:export type SupportRisk
  197:export const RISK_LABEL: Record<SupportRisk, string>
  203:export const RISK_TONE: Record<SupportRisk, string>
  214:export function computeSupportRisk(c: 
  238:export interface CrawlSupportData 
  249:export const STARTS_SOON_LEAD
  250:export const CHECK_IN_WINDOW
  251:export const FINAL_VENUE_REMAINING
  252:export const ENDING_SOON_REMAINING
  253:export const COMPLETED_LOOKBACK
  281:export function inActivationWindow(now: Date, eventDate: string, timeZone: string): boolean 
  289:export function computeCrawlStatus(
  311:export function bucketFor(
  330:export const STATUS_LABEL: Record<CrawlSupportStatus, string>
  340:export const STATUS_TONE: Record<CrawlSupportStatus, string>
  354:export type CrawlIssueType
  367:export type CrawlIssueSeverity
  368:export type CrawlIssueStatus
  370:export interface SupportIssue 
  386:export const ISSUE_TYPE_LABEL: Record<CrawlIssueType, string>
  400:export const ISSUE_TYPE_ORDER: CrawlIssueType[]
  414:export const SEVERITY_LABEL: Record<CrawlIssueSeverity, string>
  421:export const SEVERITY_TONE: Record<CrawlIssueSeverity, string>
  432:export type CallMatchType
  433:export type CallDirection
  435:export interface SupportCall 
  453:export function isUnmatchedCall(c: 
  457:export const MATCH_LABEL: Record<CallMatchType, string>
  469:export interface ReverseSearchResults 

### lib/cron-runs.ts
  73:export type CronName
  94:export async function recordCronRun(

### lib/crypto.ts
  41:export function encrypt(plaintext: string | null | undefined): string | null 
  57:export function decrypt(ciphertext: string | null | undefined): string | null 
  80:export function isEncryptionAvailable(): boolean 

### lib/current-campaign.ts
  27:export interface CurrentCampaignContext 
  41:export async function getCurrentCampaign(): Promise<CurrentCampaignContext | null> 
  81:export async function setCurrentCampaignCookie(campaignId: string): Promise<void> 
  112:export async function clearCurrentCampaignCookie(): Promise<void> 

### lib/daily-digest.ts
  34:export interface DigestRow 
  50:export interface DigestRunResult 
  64:export async function generateDailyDigests(): Promise<DigestRow[]> 
  185:export function renderDigestBody(row: DigestRow): string 

### lib/dashboard-queries.ts
  37:export interface UpcomingTaskRow 
  46:export interface RecentNoteRow 
  57:export interface DashboardData 
  95:export interface LoadDashboardOptions 
  113:export async function loadDashboardData(

### lib/db.ts
  43:export const db: Database
  62:export async function withAuditContext<T>(
  97:export async function pingDb(): Promise<boolean> 
  117:export async function closeDb(): Promise<void> 

### lib/detect-remark-followup.ts
  22:export interface RemarkFollowUp 
  39:export function detectRemarkFollowUp(

### lib/digest-unsub-token.ts
  73:export function signUnsubToken(userId: string): string 
  89:export function verifyUnsubToken(token: string): 

### lib/email-address.ts
  51:export interface ParsedAddress 
  84:export function parseEmailHeader(input: string | null | undefined): ParsedAddress 
  136:export function parseEmailList(input: string | null | undefined): string[] 
  181:export function extractEmailAddress(input: string | null | undefined): string | null 

### lib/email-health.ts
  32:export type AccountHealthStatus
  34:export interface AccountHealthRow 
  56:export interface EmailHealthDashboard 
  73:export async function loadEmailHealthDashboard(teamId: string): Promise<EmailHealthDashboard> 

### lib/email-sanitize.ts
  119:export function sanitizeEmailHtml(input: string | null | undefined): string | null 

### lib/empty-body-backfill.ts
  59:export interface EmptyBodyBackfillResult 
  91:export async function backfillEmptyBodies(opts: 

### lib/env.ts
  110:export const env
  119:export function requireEnv<K extends keyof typeof env>(

### lib/escalations-data.ts
  33:export interface PendingEscalation 
  60:export async function loadPendingEscalationsForStaff(

### lib/eventbrite-sync.ts
  51:export interface EventbriteSyncRow 
  63:export interface EventbriteSyncSummary 
  78:export async function syncAllEventbriteTicketCounts(): Promise<EventbriteSyncSummary> 
  129:export async function syncOneEventbriteTicketCount(eventId: string): Promise<EventbriteSyncRow> 

### lib/eventbrite.ts
  35:export interface EventbriteEvent 
  50:export interface EventbriteSalesSummary 
  59:export function isEventbriteConfigured(): boolean 
  76:export async function fetchEventbriteEvent(eventId: string): Promise<EventbriteEvent | null> 
  140:export async function fetchEventbriteSales(
  214:export async function updateEventbriteDescription(

### lib/follow-up-cadence.ts
  44:export interface CadenceRunResult 
  62:export async function runFollowUpCadence(): Promise<CadenceRunResult> 
  286:export async function clearCadenceOnAction(threadId: string): Promise<void> 

### lib/form-utils.ts
  17:export function formToObject(form: FormData): Record<string, unknown> 
  35:export type ActionResult<T

### lib/gmail-label-mirror.ts
  45:export interface MirrorThreadLabelOptions 
  92:export async function mirrorThreadLabel(
  143:export async function mirrorThreadLabelsBatch(

### lib/gmail-label-sync.ts
  37:export interface SyncResult 
  50:export async function syncGmailLabelsForAccount(connectedAccountId: string): Promise<SyncResult> 
  167:export async function syncGmailLabelsForTeam(teamId: string): Promise<

### lib/gmail-poll-worker.ts
  90:export async function drainGmailPolls(): Promise<DrainSummary> 
  224:export async function pollOneInbox(

### lib/gmail-thread-labels.ts
  100:export async function applyGmailLabelToThread(opts: 
  136:export async function removeGmailLabelFromThread(opts: 
  171:export async function listGmailLabelsForThread(threadId: string): Promise<
  206:export async function loadAppliedGmailLabelsForThread(threadId: string): Promise<
  269:export async function createGmailLabelForAccount(opts: 

### lib/gmail.ts
  26:export const GMAIL_OAUTH_SCOPES
  41:export interface GmailOAuthConfig 
  51:export function getGmailOAuthConfig(): GmailOAuthConfig 
  59:export function isGmailOAuthConfigured(): boolean 
  97:export function buildGmailAuthUrl(opts: 
  141:export async function exchangeCodeForTokens(code: string): Promise<TokenResponse> 
  165:export async function refreshAccessToken(encryptedRefreshToken: string): Promise<string> 
  194:export async function fetchUserEmail(accessToken: string): Promise<string> 
  218:export interface GmailAttachment 
  253:export async function sendGmailMessage(opts: 
  404:export interface GmailLabel 
  415:export async function listGmailLabels(encryptedRefreshToken: string): Promise<GmailLabel[]> 
  456:export const GMAIL_LABEL_COLOR_PAIRS: ReadonlyArray<
  486:export function isValidGmailLabelColor(opts: 
  499:export async function createGmailLabel(opts: 
  557:export async function modifyGmailThreadLabels(opts: 
  598:export interface GmailContactSuggestion 
  604:export async function searchGmailContacts(opts: 

### lib/goal-progress.ts
  32:export interface GoalRow 
  48:export interface GoalProgress 
  57:export async function computeGoalProgress(goal: GoalRow): Promise<GoalProgress> 

### lib/google-places-enrich.ts
  50:export type EnrichConfidence
  52:export interface EnrichedVenue 
  130:export async function enrichVenueByNameAndCity(input: EnrichInput): Promise<EnrichedVenue | null> 
  383:export interface BulkEnrichInput extends EnrichInput 
  389:export interface BulkEnrichResult extends EnrichedVenue 
  405:export async function enrichVenuesBulk(input: BulkEnrichInput[]): Promise<BulkEnrichResult[]> 

### lib/google-places.ts
  21:export interface PlaceSearchInput 
  34:export interface DiscoveredPlace 
  46:export interface PlaceSearchResult 
  54:export async function searchNearbyPlaces(input: PlaceSearchInput): Promise<PlaceSearchResult> 
  197:export interface PlaceDetails 
  212:export function isGoogleMapsConfigured(): boolean 
  265:export function parseGoogleMapsUrl(rawUrl: string):
  391:export async function resolveShortMapsUrl(
  439:export async function fetchPlaceDetails(placeId: string): Promise<PlaceDetails | null> 
  510:export type ResolveMapsUrlResult
  567:export async function resolveMapsUrlToPlace(rawUrl: string): Promise<ResolveMapsUrlResult> 
  641:export async function nearbyVenueSearch(opts: 
  694:export interface TextSearchPlace 
  703:export async function textSearchPlaces(opts: 
  777:export function weightedCenter(

### lib/halloween-import/halloween-2025-import.ts
  19:export type 
  28:export async function runHalloween2025Import(opts: ImportOpts): Promise<ImportReport> 
  37:export const CONFIG: CampaignImportConfig

### lib/impersonation-cookie.ts
  55:export function issueImpersonationGrant(opts: 
  78:export async function verifyImpersonationGrant(): Promise<Payload | null> 
  123:export const IMPERSONATION_COOKIE_NAME

### lib/import/campaigns.ts
  49:export const SPD_2026_CONFIG: CampaignImportConfig
  79:export const NYE_2026_CONFIG: CampaignImportConfig
  113:export const SPD_2025_CONFIG: CampaignImportConfig
  139:export const NYE_2025_CONFIG: CampaignImportConfig
  161:export const HALLOWEEN_2024_CONFIG: CampaignImportConfig
  180:export const CAMPAIGN_REGISTRY: CampaignImportConfig[]
  190:export function getCampaignConfig(slug: string): CampaignImportConfig | null 

### lib/import/city-matcher.ts
  27:export interface CityMatchResult 
  53:export async function matchCity(sheetName: string): Promise<CityMatchResult | null> 

### lib/import/generic-campaign-import.ts
  68:export interface CampaignImportConfig 
  124:export const HALLOWEEN_2025_CONFIG: CampaignImportConfig
  209:export interface CampaignClusterConfig 
  289:export interface ImportDecisionRow 
  313:export interface ImportReport 
  347:export async function runCampaignImport(

### lib/import/resolver-overrides.ts
  74:export interface ResolverOverrides 
  115:export async function loadResolverOverrides(relativePath: string): Promise<ResolverOverrides> 

### lib/import/review-queue.ts
  30:export interface ReviewQueueItem 
  53:export interface ReviewQueue 
  61:export function buildReviewQueue(
  135:export function renderReviewQueueMarkdown(queue: ReviewQueue): string 

### lib/import/venue-resolver.ts
  36:export type ResolveDecision
  38:export interface ResolveInput 
  60:export interface ResolveResult 
  82:export async function resolveVenue(input: ResolveInput): Promise<ResolveResult> 

### lib/inbox-alerts.ts
  32:export interface EvaluatorResult 
  66:export async function runAlertEvaluator(): Promise<EvaluatorResult> 

### lib/inbox-analytics.ts
  39:export interface InboxAnalytics 
  63:export async function loadInboxAnalytics(
  213:export type HealthTier
  215:export function classifyHealth(opts: 

### lib/inbox-daily-stats.ts
  32:export interface AggregateDailyStatsResult 
  43:export async function runDailyInboxStats(
  135:export interface DailyStatPoint 
  143:export async function loadInboxDailyStats(

### lib/inbox-data.ts
  65:export const FOLDER_TO_STATES: Record<EngineSmartFolder, readonly ThreadStateValue[]>
  78:export const GMAIL_MAILBOX_FOLDERS
  95:export const ENGINE_SMART_FOLDERS
  97:export type GmailMailboxFolder
  98:export type EngineSmartFolder
  100:export const INBOX_FOLDERS
  101:export type InboxFolder
  103:export type ThreadStateValue
  112:export const FOLDER_LABELS: Record<InboxFolder, string>
  130:export function isInboxFolder(value: string | undefined | null): value is InboxFolder 
  134:export function isGmailMailbox(value: InboxFolder): value is GmailMailboxFolder 
  138:export function isEngineSmartFolder(value: InboxFolder): value is EngineSmartFolder 
  147:export const INBOX_SLA_HOURS
  153:export interface ThreadListFilter 
  254:export interface InboxThreadRow 
  324:export async function fetchInboxThreads(filter: ThreadListFilter): Promise<InboxThreadRow[]> 
  764:export async function fetchFolderCounts(opts: 
  941:export interface InboxThreadDetail 
  1035:export async function fetchThreadDetail(
  1145:export interface VenueOutreachHistoryEntry 
  1160:export async function fetchVenueOutreachHistory(
  1193:export async function fetchVenueCurrentBookings(venueId: string) 
  1233:export interface InboxAliasOption 
  1239:export async function fetchInboxAliases(opts: 
  1273:export interface InboxFilterFacet 
  1280:export interface InboxFilterFacets 
  1305:export async function fetchInboxFilterFacets(opts: 
  1401:export interface DraftListRow 
  1424:export async function fetchDraftList(opts: 
  1505:export interface TeamGmailLabel 
  1526:export async function fetchTeamGmailLabels(opts: 
  1613:export interface ThreadTaskRow 
  1628:export async function fetchThreadTasks(threadId: string): Promise<ThreadTaskRow[]> 

### lib/inbox-saved-searches.ts
  22:export interface SavedSearch 
  31:export async function loadSavedSearches(userId: string): Promise<SavedSearch[]> 
  57:export async function createSavedSearch(input: 
  86:export async function renameSavedSearch(input: 
  109:export async function deleteSavedSearch(input: 

### lib/inbox-search.ts
  41:export interface ParsedSearchQuery 
  88:export function parseSearchQuery(raw: string | null | undefined): ParsedSearchQuery 

### lib/inbox-widget-data.ts
  20:export interface InboxWidgetThread 
  33:export interface InboxWidgetUsage 
  42:export interface InboxWidgetData 
  52:export async function loadInboxWidget(opts: 

### lib/invite-tokens.ts
  26:export function generateToken(): 
  33:export function hashToken(raw: string): string 
  38:export function inviteExpiresAt(): Date 
  43:export function resetExpiresAt(): Date 

### lib/logger.ts
  18:export const logger: Logger
  56:export function childLogger(bindings: Record<string, unknown>): Logger 
  77:export async function captureException(

### lib/mentions-feed.ts
  27:export interface MentionFeedItem 
  40:export async function loadMentionsFeed(

### lib/next-best-actions.ts
  45:export type ActionCategory
  52:export interface NextBestAction 
  67:export async function loadNextBestActions(campaignId: string | null): Promise<NextBestAction[]> 

### lib/notes.ts
  13:export interface NoteRow 
  27:export async function listNotes(

### lib/note-timezone.ts
  22:export async function resolveNoteTimezone(opts: 

### lib/op-error.ts
  90:export function newErrorCode(): string 
  109:export interface OpError 
  123:export function newOpError(tag: string): OpError 
  151:export function formatErrorWithCode(message: string, code?: string | null): string 

### lib/outreach-phase.ts
  33:export type OutreachPhase
  35:export const PHASE_LABELS: Record<OutreachPhase, string>
  42:export const PHASE_DESCRIPTIONS: Record<OutreachPhase, string>
  53:export const phaseCapability
  74:export function phaseGateMessage(required: OutreachPhase, current: OutreachPhase): string 

### lib/parse-venue-hours.ts
  37:export type DayHours
  39:export interface ParsedVenueHours 
  98:export function parseVenueHours(input: string | null | undefined): ParsedVenueHours | null 
  247:export interface CallWindowSuggestion 
  278:export function suggestCallWindow(

### lib/passwords.ts
  19:export const MIN_PASSWORD_LENGTH
  21:export interface PasswordValidationError 
  26:export interface PasswordValidationOk 
  30:export function validatePassword(pw: string): PasswordValidationOk | PasswordValidationError 
  41:export function hashPassword(pw: string): Promise<string> 
  45:export function verifyPassword(pw: string, hashed: string): Promise<boolean> 

### lib/presence.ts
  36:export interface PresenceEntry 
  61:export async function recordHeartbeat(
  107:export async function listViewers(route: string): Promise<PresenceEntry[]> 
  151:export async function dropPresence(route: string, staffId: string): Promise<void> 
  160:export interface PresenceLocation extends PresenceEntry 
  170:export async function listAllPresence(): Promise<PresenceLocation[]> 

### lib/print-city-sheet.ts
  21:export interface PrintVenueRow 
  41:export interface PrintCrawl 
  50:export interface PrintCitySheet 
  68:export async function loadPrintCitySheet(cityCampaignId: string): Promise<PrintCitySheet | null> 

### lib/qrcode.ts
  11:export interface QrOptions 
  18:export async function generateQrSvg(data: string, opts: QrOptions

### lib/quo.ts
  32:export function isQuoConfigured(): boolean 
  47:export interface QuoPhoneNumber 
  53:export interface QuoMessageResult 
  60:export interface QuoCall 
  75:export async function listQuoPhoneNumbers(): Promise<QuoPhoneNumber[]> 
  111:export async function sendQuoSms(opts: 
  156:export async function fetchQuoCall(callId: string): Promise<QuoCall | null> 
  206:export async function verifyQuoWebhookSignature(opts: 
  259:export function mapQuoCallStatusToOutcome(

### lib/realtime-publish.ts
  33:export interface RealtimeEvent 
  55:export function publishRealtime(event: Omit<RealtimeEvent, "at">): void 
  86:export async function subscribeRealtime(

### lib/redis.ts
  18:export function getRedis(): Redis 
  35:export async function pingRedis(): Promise<boolean> 
  51:export async function closeRedis(): Promise<void> 

### lib/reference-retrieval-format.ts
  8:export interface RetrievedSection 
  23:export function formatAsSystemPrompt(sections: RetrievedSection[]): string 

### lib/reference-retrieval-task-map.ts
  13:export type ReferenceTask
  26:export const TASK_TO_SECTIONS: Record<ReferenceTask, string[]>

### lib/reference-retrieval.ts
  22:export type 
  28:export interface RetrieveArgs 
  50:export async function retrieveRelevantSections(args: RetrieveArgs): Promise<RetrievedSection[]> 

### lib/scheduled-send-runner.ts
  35:export interface ScheduledSendResult 
  41:export async function runScheduledSends(): Promise<ScheduledSendResult> 

### lib/send-cap.ts
  39:export function startOfLocalDay(userTimezone: string | null | undefined): Date 
  92:export interface SendUsage 
  112:export async function loadSendUsage(connectedAccountId: string): Promise<SendUsage> 
  176:export async function classifySend(opts: 
  188:export type PreflightResult
  201:export async function preflightSend(opts: 
  222:export async function recordSendEvent(opts: 

### lib/send-safety.ts
  44:export function normaliseEmail(raw: string): string 
  48:export interface SuppressionBlock 
  55:export interface DncBlock 
  63:export interface DuplicateWarning 
  88:export interface RecentDeclineWarning 
  118:export interface CrossStaffOwnershipWarning 
  149:export interface DomainAliasSuggestionWarning 
  161:export type SafetyWarning
  167:export type SafetyResult
  177:export type MultiSafetyResult
  194:export async function runSendSafety(opts: 
  358:export async function runSendSafetyForRecipients(opts: 
  598:export function describeBlock(block: SuppressionBlock | DncBlock): string 

### lib/smart-notes-actions.ts
  69:export async function scanNoteAndPersistSuggestions(opts: ScanOpts): Promise<
  147:export async function acceptSuggestion(
  231:export async function dismissSuggestion(

### lib/smart-notes-queries.ts
  7:export type PendingSuggestion
  13:export async function loadPendingSuggestionsForNotes(

### lib/smart-notes.ts
  27:export type ActionType
  38:export interface ExtractedAction 
  117:export function extractActionsFromNote(input: ExtractInput): ExtractedAction[] 
  252:export function hashNoteContent(body: string): string 

### lib/stale-tagger.ts
  83:export interface StaleTaggerResult 
  95:export async function runStaleTagger(): Promise<StaleTaggerResult> 
  334:export async function clearStaleOnAction(threadId: string): Promise<void> 

### lib/suggested-next-action.ts
  24:export type ThreadState
  34:export type SuggestedActionKind
  42:export interface SuggestedAction 
  69:export function suggestNextAction(opts: 

### lib/support-hours.ts
  27:export const SUPPORT_ZONES
  32:export type SupportZoneKey
  35:export type SupportCrawlStatus
  37:export interface SupportCrawlRow 
  63:export interface SupportZoneTotal 
  81:export interface SupportPeakOverlap 
  89:export interface SupportNextCrawl 
  102:export interface SupportHoursData 
  145:export async function loadSupportHours(opts?: 

### lib/team-activity.ts
  19:export interface TeamActivityEntry 
  43:export interface TeamActivitySummary 
  64:export async function loadTeamActivity(windowHours

### lib/team-analytics.ts
  27:export interface StaffActivityRow 
  43:export interface TeamAnalyticsTotals 
  52:export interface TeamAnalytics 
  60:export async function loadTeamAnalytics(
  248:export interface StaffDailyDetail 
  257:export async function loadStaffDailyDetail(opts: 
  353:export interface StaffProfile 
  361:export interface TopVenueRow 
  373:export interface ActivityFeedRow 
  384:export interface StaffActivityProfile 
  402:export async function loadStaffActivityProfile(opts: 

### lib/team-labels.ts
  44:export interface TeamLabelSummary 
  95:export interface ThreadLabelRow extends TeamLabelSummary 
  101:export async function listTeamLabels(teamId: string): Promise<TeamLabelSummary[]> 
  111:export async function listThreadLabels(threadId: string): Promise<ThreadLabelRow[]> 
  136:export async function createTeamLabel(opts: 
  217:export async function renameTeamLabel(opts: 
  233:export async function deleteTeamLabel(id: string): Promise<void> 
  244:export async function ensureGmailLinkForAccount(opts: 
  316:export async function applyLabelToThread(opts: 
  343:export async function removeLabelFromThread(opts: 
  369:export async function reconcileGmailLabelsForThread(opts: 
  425:export async function unreconcileGmailLabelsForThread(opts: 

### lib/template-analytics.ts
  46:export interface TemplatePerformanceRow 
  68:export interface TemplateAnalyticsOpts 
  79:export async function loadTemplatePerformance(
  208:export interface SendTimeBucket 
  225:export async function loadBestSendTime(opts: 
  303:export interface ConversionFunnel 
  325:export async function loadConversionFunnel(opts: 

### lib/template-merge-context.ts
  58:export interface MergeContextInput 
  77:export const MERGE_FIELD_KEYS
  122:export type MergeFields
  231:export async function buildFlatMergeContext(input: MergeContextInput): Promise<MergeFields> 
  610:export function mergeOverrides(base: MergeFields, overrides: Partial<MergeFields>): MergeFields 

### lib/template-merge-format.ts
  12:export type VenueRole
  13:export type DayPart
  23:export const STANDARD_SLOT_TIME: Record<"wristband" | "middle" | "final", string>
  30:export function roleLabel(role: VenueRole): string 
  37:export function formatEventDate(iso: string): string 
  47:export function eventDayName(iso: string): string 
  55:export function shortDateLabel(iso: string): string 
  65:export function dayPartLabel(dp: DayPart): string 
  85:export function crawlsCountLabel(n: number): string 
  90:export function joinAnd(items: string[]): string 
  99:export function canonicalRoleLabels(roles: VenueRole[]): string[] 
  113:export function openSlotsLabel(openRoles: VenueRole[]): string 
  127:export function guestCount(raw: string): string 
  136:export function payRateLabel(cents: number, currency: string): string 

### lib/template-picker-score.ts
  17:export interface PickContext 
  39:export interface ScorableTemplate 
  46:export interface Alternative 
  51:export interface ScoredPick<T extends ScorableTemplate> 
  84:export interface ScoreResult 
  89:export function scoreTemplate(tc: TriggerContext, ctx: PickContext): ScoreResult 
  156:export function pickBest<T extends ScorableTemplate>(

### lib/template-picker.ts
  14:export type 
  16:export interface PickedTemplate 
  31:export async function pickTemplate(ctx: PickContext): Promise<PickedTemplate | null> 

### lib/template-render.ts
  24:export interface RenderContext 
  73:export interface RenderResult 
  78:export function renderTemplate(
  104:export function extractMergeFields(template: string): string[] 
  127:export const KNOWN_MERGE_FIELDS: 

### lib/theme-init.ts
  22:export const THEME_INIT_SCRIPT

### lib/thread-notes.ts
  31:export interface ThreadNoteRow 
  42:export async function loadThreadNotes(threadId: string): Promise<ThreadNoteRow[]> 
  100:export interface MentionedThreadRow 
  110:export async function loadUnacknowledgedMentions(userId: string): Promise<MentionedThreadRow[]> 
  131:export async function countUnacknowledgedMentions(userId: string): Promise<number> 
  163:export async function createThreadNote(input: 
  248:export async function deleteThreadNote(input: 
  271:export async function acknowledgeThreadMentions(input: 

### lib/toast-helpers.ts
  45:export function showActionError(toast: ToastApi, result: ActionFailure, opts: Opts

### lib/today-data.ts
  28:export interface UrgentCrawl 
  40:export interface StaleFollowUp 
  51:export interface RecentWin 
  61:export interface TodayDigest 
  73:export async function loadTodayDigest(campaignId: string | null): Promise<TodayDigest> 

### lib/tracker-data.ts
  21:export async function loadTrackerData(opts: 

### lib/tracker-status.ts
  58:export type 
  82:export async function computeCityNeeds(

### lib/tracker-status-types.ts
  16:export type CityStatusPill
  25:export type SlotKind
  27:export interface CityNeedSummary 
  36:export interface CrawlNeed 
  99:export const STATUS_PILL_TONE: Record<CityStatusPill, string>
  128:export const STATUS_PILL_LABEL: Record<CityStatusPill, string>
  142:export const SLOT_PILL_TONE: Record<SlotKind, string>
  155:export const SLOT_PILL_LABEL_LONG: Record<SlotKind, string>
  171:export const SLOT_PILL_LABEL: Record<SlotKind, string>
  184:export type DayPart
  196:export const DAY_PART_LABEL_FULL: Record<DayPart, string>
  209:export const DAY_PART_LABEL_DAY: Record<DayPart, string>
  223:export const DAY_PART_LABEL_SHORT: Record<DayPart, string>
  238:export function formatDayPart(
  286:export function formatCountryAbbrev(code: string | null | undefined): string 

### lib/triage-classifier.ts
  38:export type Classification
  40:export interface ClassificationResult 
  189:export function classifyInboundEmail(opts: 

### lib/turnout-quote.ts
  22:export type Priority
  23:export type SlotType
  24:export type SlotContext
  26:export interface InitialPitchArgs 
  32:export interface SalesUpdateArgs 
  53:export function waveQualifier(slotContext: SlotContext): string 
  84:export function initialPitchQuote(args: InitialPitchArgs): string 
  93:export function initialPitchNumber(priority: Priority, slotType: SlotType): string 
  128:export function salesUpdateQuote(args: SalesUpdateArgs): 
  142:export function turnoutMergeFields(args: 

### lib/use-draft.ts
  76:export function useDraft(

### lib/user-preferences.ts
  21:export type InboxDensity
  22:export type ReadingPanePosition
  24:export interface UserPrefs 
  40:export async function getUserPreferences(userId: string): Promise<UserPrefs | null> 
  69:export async function setUserPreference(userId: string, patch: Partial<UserPrefs>): Promise<void> 
  135:export async function setInboxAccountFilterForCampaign(

### lib/validation/brands.ts
  73:export const outreachBrandCreateSchema
  87:export const outreachBrandUpdateSchema
  89:export type OutreachBrandCreateInput
  90:export type OutreachBrandUpdateInput
  96:export const crawlBrandCreateSchema
  114:export const crawlBrandUpdateSchema
  116:export type CrawlBrandCreateInput
  117:export type CrawlBrandUpdateInput

### lib/validation/campaigns.ts
  49:export const campaignCreateSchema
  80:export type CampaignCreateInput
  83:export const campaignUpdateSchema
  100:export type CampaignUpdateInput

### lib/validation/cities.ts
  46:export const cityCreateSchema
  50:export type CityCreateInput
  52:export const cityUpdateSchema
  56:export type CityUpdateInput

### lib/validation/city-campaigns.ts
  27:export const cityCampaignCreateSchema
  46:export const cityCampaignUpdateSchema
  47:export type CityCampaignCreateInput
  48:export type CityCampaignUpdateInput

### lib/validation/csv-import.ts
  80:export const venueCsvRowSchema
  103:export type VenueCsvRow
  108:export interface VenueImportRowResult 
  115:export interface VenueImportSummary 

### lib/validation/email-templates.ts
  56:export const emailTemplateCreateSchema
  79:export const emailTemplateUpdateSchema
  84:export type EmailTemplateCreateInput
  85:export type EmailTemplateUpdateInput
  87:export const STAGE_LABELS: Record<z.infer<typeof stageEnum>, string>

### lib/validation/events.ts
  70:export const eventCreateSchema
  96:export const eventUpdateSchema
  102:export type EventCreateInput
  103:export type EventUpdateInput

### lib/validation/goals.ts
  20:export const goalScopeEnum
  28:export const goalMetricEnum
  39:export const goalCreateSchema
  54:export type GoalCreateInput
  56:export const goalUpdateSchema
  69:export type GoalUpdateInput
  71:export const goalDeleteSchema
  74:export type GoalDeleteInput
  82:export function toStorageValue(metric: GoalCreateInput["metric"], display: number): bigint 
  90:export function fromStorageValue(
  100:export function metricLabel(metric: GoalCreateInput["metric"]): string 
  118:export function scopeLabel(scope: GoalCreateInput["scope"]): string 

### lib/validation/middle-venue-groups.ts
  32:export const middleVenueGroupCreateSchema
  53:export type MiddleVenueGroupCreateInput
  55:export const middleVenueGroupUpdateSchema
  63:export type MiddleVenueGroupUpdateInput
  65:export const middleVenueGroupMemberAddSchema
  70:export const middleVenueGroupMemberRemoveSchema

### lib/validation/notes.ts
  19:export const noteTargetTypeEnum
  21:export const noteCreateSchema
  26:export type NoteCreateInput
  28:export const noteDeleteSchema
  31:export type NoteDeleteInput
  43:export function extractMentions(body: string): string[] 

### lib/validation/outreach-log.ts
  17:export const outreachChannelSchema
  26:export const outreachOutcomeSchema
  39:export const outreachLogCreateSchema
  48:export type OutreachLogCreateInput

### lib/validation/tasks.ts
  36:export const taskCreateSchema
  58:export type TaskCreateInput
  60:export const taskUpdateSchema
  81:export type TaskUpdateInput
  83:export const taskCompleteSchema
  87:export type TaskCompleteInput

### lib/validation/venue-events.ts
  59:export const venueEventCreateSchema
  60:export const venueEventUpdateSchema
  65:export type VenueEventCreateInput
  66:export type VenueEventUpdateInput

### lib/validation/venues.ts
  87:export const venueCreateSchema
  91:export type VenueCreateInput
  93:export const venueUpdateSchema
  97:export type VenueUpdateInput

### lib/venue-auto-create.ts
  114:export async function autoTagOrCreateVenue(opts: 

### lib/venue-communication.ts
  52:export type VenueCommunicationSource
  95:export interface VenueCommunicationThread 
  121:export interface VenueCommunicationSummary 
  132:export interface VenueCommunication 
  146:export async function loadVenueCommunication(

### lib/venue-domain-match.ts
  30:export function normalizeDomain(raw: string): string 
  49:export async function findVenuesByDomainAlias(fromEmailNormalized: string): Promise<string[]> 

### lib/venue-duplicates.ts
  21:export interface VenueDuplicate 
  46:export async function findVenueDuplicates(opts: 

### lib/version.ts
  19:export interface VersionInfo 
  28:export function getVersion(): VersionInfo 
  40:export function getVersionLine(): string 

### lib/viber.ts
  17:export interface ViberLinkOpts 
  30:export function buildViberChatLink(opts: ViberLinkOpts): string | null 
  43:export function buildViberCallLink(opts: ViberLinkOpts): string | null 

### lib/visible-accounts.ts
  45:export type AccountHealth
  47:export interface VisibleAccount 
  88:export async function loadVisibleAccounts(opts: Opts): Promise<VisibleAccount[]> 

### lib/warm-leads.ts
  19:export interface WarmLeadRow 
  45:export async function findWarmLeads(opts: 

### lib/zerobounce.ts
  33:export type EmailValidationStatus
  56:export async function validateEmail(
  229:export function validateEmailInBackground(
  241:export function isZeroBounceConfigured(): boolean 
  246:export async function getCachedValidation(rawEmail: string): Promise<EmailValidationStatus | null> 
  263:export async function validateEmailsBatch(

## C. app/api routes
- admin/analytics/export.csv/route.ts [GET]
- admin/analytics/[staffId]/export.csv/route.ts [GET]
- admin/suppression/export.csv/route.ts [GET]
- admin/venues/[id]/route.ts [PATCH]
- auth/google/callback/route.ts [GET]
- auth/google/debug/route.ts [GET]
- auth/google/start/route.ts [GET]
- auth/[...nextauth]/route.ts []
- client-diag/route.ts [POST]
- cron/daily-digest/route.ts [POST]
- cron/eventbrite-sync/route.ts [POST]
- cron/follow-up-cadence/route.ts [POST]
- cron/gmail-poll/route.ts [POST]
- cron/inbox-alerts/route.ts [POST]
- cron/inbox-daily-stats/route.ts [POST]
- cron/scheduled-sends/route.ts [POST]
- cron/stale-tagger/route.ts [POST]
- digest/unsub/route.ts [GET]
- health/route.ts [GET]
- inbox/ai-draft-stream/route.ts [POST]
- presence/all/route.ts [GET]
- presence/cursor/route.ts [POST]
- presence/drop/route.ts [POST]
- presence/heartbeat/route.ts [POST]
- realtime/stream/route.ts [GET]
- reference/search/route.ts [GET]
- session/clear/route.ts [GET]
- webhooks/quo/route.ts [POST]

## D. server-action files (app/**/_actions*.ts)
- app/(admin)/_actions/ai-actions.ts
- app/(admin)/_actions-cities-goal.ts
- app/(admin)/_actions/compose-and-send.ts
- app/(admin)/_actions/email-drafts.ts
- app/(admin)/_actions/engine-pick.ts
- app/(admin)/_actions/notifications.ts
- app/(admin)/_actions/palette-search.ts
- app/(admin)/_actions/quo-actions.ts
- app/(admin)/_actions/saved-views.ts
- app/(admin)/_actions-tracker.ts
- app/(admin)/_actions.ts
- app/(admin)/_actions/user-preferences.ts
- app/(admin)/_actions/venue-suggestion-actions.ts
- app/(admin)/admin/_actions-campaign-import.ts
- app/(admin)/admin/_actions-classifier.ts
- app/(admin)/admin/_actions-empty-body-backfill.ts
- app/(admin)/admin/_actions-halloween-import.ts
- app/(admin)/admin/_actions-import.ts
- app/(admin)/admin/_actions-sheets-backup.ts
- app/(admin)/admin/_actions-venue-tag.ts
- app/(admin)/admin/alerts/_actions.ts
- app/(admin)/admin/goals/_actions.ts
- app/(admin)/admin/labels/_actions.ts
- app/(admin)/admin/suppression/_actions.ts
- app/(admin)/admin/users/_actions.ts
- app/(admin)/all-crawls/_actions.ts
- app/(admin)/brands/_actions.ts
- app/(admin)/calendar/_actions.ts
- app/(admin)/campaign-info/_actions.ts
- app/(admin)/campaigns/_actions.ts
- app/(admin)/cities/_actions.ts
- app/(admin)/city-campaigns/_actions/city-map-actions.ts
- app/(admin)/city-campaigns/_actions/escalation-actions.ts
- app/(admin)/city-campaigns/_actions.ts
- app/(admin)/crawl-management/_actions.ts
- app/(admin)/crawl-matrix/_actions.ts
- app/(admin)/crawl-support/_actions.ts
- app/(admin)/events/_actions.ts
- app/(admin)/event-submission/_actions.ts
- app/(admin)/external-hosts/_actions.ts
- app/(admin)/goals/_actions.ts
- app/(admin)/import/_actions.ts
- app/(admin)/inbox/_actions-notes.ts
- app/(admin)/inbox/_actions-saved-searches.ts
- app/(admin)/inbox/_actions.ts
- app/(admin)/inbox/mentions/_actions.ts
- app/(admin)/internal-hosts/_actions.ts
- app/(admin)/maps/_actions.ts
- app/(admin)/settings/inboxes/_actions.ts
- app/(admin)/tasks/_actions.ts
- app/(admin)/templates/_actions.ts
- app/(admin)/venues/_actions.ts
- app/(admin)/wristbands/_actions.ts
- app/login/_actions.ts
- app/set-password/[token]/_actions.ts
