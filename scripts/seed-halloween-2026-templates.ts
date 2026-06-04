/**
 * Seed the Halloween 2026 campaign template pack into email_templates.
 *
 * Usage:
 *   npx tsx scripts/seed-halloween-2026-templates.ts
 *   npx tsx scripts/seed-halloween-2026-templates.ts --campaign-slug halloween-2026-intl
 *   npx tsx scripts/seed-halloween-2026-templates.ts --campaign-id <uuid>
 *
 * Idempotent: UPSERT on (campaign_id, template_code). Bodies are verbatim from
 * the Halloween Bar Crawl Outreach Template Pack v2.0, normalized to ASCII
 * punctuation (straight quotes, hyphen for em-dash) for plain-text email; the
 * wording is unchanged. The pack's flat merge fields ({{venue_name}},
 * {{your_name}}, {{turnout_quote}}, ...) are preserved as written; the render
 * engine is extended to support them in the composer/turnout phases.
 *
 * outreach_brand_id is derived from the campaign (NOT NULL). stage is 'custom'
 * since campaign templates are addressed by template_code, not the legacy
 * stage enum. Connects with its own pg Pool from DATABASE_URL.
 */

import "dotenv/config";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { campaigns } from "../db/schema/campaigns";
import { type TriggerContext, emailTemplates } from "../db/schema/templates";

interface SeedTemplate {
  code: string;
  name: string;
  subject: string;
  body: string;
  trigger: TriggerContext;
}

const INSERT_SUBJECT = "(insert block - not sent standalone)";

export const HALLOWEEN_2026_TEMPLATES: SeedTemplate[] = [
  {
    code: "T1",
    name: "T1 - Cold opener, night crawls",
    subject: "Include {{venue_name}} in our {{city}} Halloween bar crawls",
    body: `Hey {{venue_name}},

I'm reaching out on behalf of {{company_name}} to invite {{venue_name}} to join our upcoming {{city}} Halloween bar crawls we're running on:

Thursday, October 29th
Friday, October 30th
Saturday, October 31st

{{venue_name}} is in the area and we thought you'd be a good fit. Typically we run it from 7:30 PM to 2:00 AM and we have different time slots to choose from.

Would you be open to having our guests come through on any of those nights? If so, I can send over the time slots, terms and how it works.

Thanks,
{{your_name}}
{{company_name}}`,
    trigger: { channel: "cold", stage: "first_touch", event_type: "night", ask_size: "big_open" },
  },
  {
    code: "T2",
    name: "T2 - Cold opener, day party",
    subject: "{{city}} Halloween day party bar crawl with {{venue_name}}",
    body: `Hey {{venue_name}},

I'm reaching out on behalf of {{company_name}} to invite {{venue_name}} to be a participating stop at our {{city}} Halloween bar crawl on Saturday, October 31st at 1pm-8pm (day party).

We're scheduling our timeslots now and thought {{venue_name}} would be a great fit. Our crawlers bar-hop through partner venues across the afternoon, so it's basically extra foot traffic and bar sales during the slower daytime hours.

If you're interested in being one of our stops please let me know and I'll send over further details and the time slots.

All the best,
{{your_name}}
{{company_name}}`,
    trigger: { channel: "cold", stage: "first_touch", event_type: "day_party" },
  },
  {
    code: "T3",
    name: "T3 - Warm re-engagement opener (past partners)",
    subject: "Booking Halloween bar crawls with {{venue_name}} for this year",
    body: `Hey {{contact_first_name}},

Hope you guys are doing well! Wanted to reach out because we're booking for our Halloween crawls in {{city}} for this year and wanted to see if {{venue_name}} would be down to join again. Here are the dates we're planning:

Thursday, October 29th (night)
Friday, October 30th (night)
Saturday, October 31st (night)
Saturday, October 31st (day party, afternoon)

It would be the same terms as last time, we keep ticket sales, you keep 100% of bar sales. No line bypass or exclusivity required. We usually bring around {{guest_count}} guests through each venue across the night, so it's a solid lift in foot traffic. If you're interested, here's what's still open:

{{slot_list_detailed}}

Just let us know which slots you want and we'll book you in.

Thanks again,
{{your_name}}
{{company_name}}`,
    trigger: { channel: "warm", stage: "first_touch", prior_relationship: true },
  },
  {
    code: "T4",
    name: "T4 - Slot detail, night, multiple crawls",
    subject: "{{city}} Halloween bar crawls with {{venue_name}} for this year",
    body: `Here are the time slots we have open:

Wristband Venue (7:30 PM to 10:30 PM): Check-in/where guests will pickup their wristbands.
Participating Venue (8:30 PM to 11:30 PM): Middle slot timing shared with 2-3 other venues.
Final Venue (11:30 PM to 2:00 AM): Final slot where everyone meets to end the night off.

As for turnout, we're expecting around {{guest_count}} people for your slot. We're running a few crawls on the busier nights, so you're welcome to take one, or multiple:

Thursday, Oct 29: {{thu_crawls}} running. Open: {{thu_open_slots}}
Friday, Oct 30: {{fri_crawls}} running. Open: {{fri_open_slots}}
Saturday, Oct 31 (night): {{sat_crawls}} running. Open: {{sat_open_slots}}

Couple quick questions just so I can book you in:

1. Which nights would you like to do?
2. Which timeslots? Wristband, participating, or final? You can do multiple on different days if you want.
3. Standard timing ok, or do you need hours at all?

Your venue keeps 100% of bar sales, and we handle all the ticketing, marketing, and promotion.

{{wristband_note}}

Let me know what works and I'll get you confirmed.

Thanks,
{{your_name}}
{{company_name}}`,
    trigger: { stage: "detail", event_type: "night", crawls: "multiple" },
  },
  {
    code: "T5",
    name: "T5 - Slot detail, night, single crawl",
    subject: "{{city}} Halloween bar crawl on {{night}} with {{venue_name}}",
    body: `Hey {{contact_first_name}},

For the crawl on {{night}} here are the timings:

Wristband Pickup/Check-in Venue (7:30 PM to 10:30 PM)
Participating Venue (8:30 PM to 11:30 PM)
Final Venue (11:30 PM to 2:00 AM)

We have {{open_slots}} open, and we're expecting around {{guest_count}} guests. It's a smaller crawl so would just be extra foot traffic for you guys.

Terms are simple: Your venue keeps 100% of bar sales, and we handle all the ticketing, marketing, and promotion. Guests do not need line bypass, or exclusivity.

{{wristband_note}}

Let me know what time you're interested in and I can book you guys in.

Cheers,
{{your_name}}
{{company_name}}`,
    trigger: { stage: "detail", event_type: "night", crawls: "single" },
  },
  {
    code: "T6",
    name: "T6 - Slot detail, day party",
    subject: "{{city}} Halloween day party crawl with {{venue_name}}",
    body: `Hey {{contact_first_name}},

For our day party bar crawls there are only two slots, guests just check in at the wristband venue and bar-hop at participating venues after:

Wristband Venue (1:00 PM to 4:00 PM): the check-in spot where guests pick up wristbands and start off.
Participating Venue (3:00 PM to 8:00 PM): a stop on the crawl, open ended bar-hop window.

We have {{open_slots}} open for the day crawl, and you'd be looking at around {{guest_count}} guests.
The standard participating window is 3 to 8 PM, but if you'd rather run something tighter (say 5 to 7 PM), we can do that too.

You would keep 100% of bar sales, and we handle all the ticketing, marketing, and promotion. We don't need exclusivity and our guests don't need line bypass.

{{wristband_note}}

Let me know what time you're interested in and I can book you guys in.

Cheers,
{{your_name}}
{{company_name}}`,
    trigger: { stage: "detail", event_type: "day_party" },
  },
  {
    code: "T7A",
    name: "T7A - Wristband insert, Prio 1-2",
    subject: INSERT_SUBJECT,
    body: `Since you're the starting/check-in venue we'll schedule one of our hosts to scan people's tickets and hand out wristbands. If we are unable to schedule one of our hosts, we could also have one of your staff members just hand out wristbands to anyone with a ticket (no need to scan), and we'll pay their hourly rate for the time they hand them out.

We'll also send you over a package of wristbands as a backup. We would just need your shipping address, a contact name and phone number to ship it out.`,
    trigger: { stage: "insert_block", priority: [1, 2, 3] },
  },
  {
    code: "T7B",
    name: "T7B - Wristband insert, Prio 3-6",
    subject: INSERT_SUBJECT,
    body: `Since you're the starting/check-in venue we'll send you over a package of wristbands, we just need a shipping address, a contact name and phone number to ship it out.

Aside from that, would it be possible to have one of your staff members hand them to anyone with tickets? (They don't need to be scanned). We will happily cover their hourly labour cost for the hours they do it, and we can even send the payment ahead of time if you like.`,
    trigger: { stage: "insert_block", priority: [4, 5, 6] },
  },
  {
    code: "T8",
    name: "T8 - One-shot specific slot ask",
    subject: "{{city}} Halloween crawl with {{venue_name}} for {{slot_shorthand}}?",
    body: `Hey {{contact_first_name}},

I'm reaching out on behalf of {{company_name}}, we do themed bar crawls and events year round and thought {{venue_name}} would be a good fit for our Halloween crawls.

We're just finishing up booking for Halloween and have some timeslots open:

{{slot_list}}
{{slot_list_2}}

You keep 100% of bar sales and we handle ticketing, marketing, and promotion. We don't require exclusivity, and we don't need line-bypass for our guests.

{{wristband_note}}

Let me know if you're interested and I can book you guys in.

Thanks,
{{your_name}}
{{company_name}}`,
    trigger: { channel: "cold", stage: "first_touch", ask_size: "small_specific" },
  },
  {
    code: "T9-far",
    name: "T9-far - Post-confirm + info-gathering (3+ weeks out)",
    subject: "Confirming {{venue_name}} for the {{city}} Halloween crawl on {{event_date}}",
    body: `Hey {{contact_first_name}},

Thanks for confirming! Booking you in for:

{{slot_summary}}

A few quick things to set up:

1. A contact name and cell number for whoever's working that night, just in case anything comes up.
2. Your venue's capacity, so we can plan crowd flow accurately.
3. Any drink special you'd like featured? Totally optional, we'll just list it on our digital crawl map if you want one.
{{wristband_shipping_note}}

Here's what to expect from us leading up to the event:

About 4 weeks out: a social media graphic you can use to promote.
3 weeks out: a staff info sheet for your team.
2 weeks out: final logistics check-in.
Week of: a quick day-before confirmation.

Let me know if you have any questions.

Thanks,
{{your_name}}
{{company_name}}`,
    trigger: { channel: "post_confirm", stage: "confirmation", min_days_to_event: 21 },
  },
  {
    code: "T9-near",
    name: "T9-near - Post-confirm + bundled info (<3 weeks out)",
    subject: "Confirming {{venue_name}} for the {{city}} Halloween crawl on {{event_date}}",
    body: `Hey {{contact_first_name}},

Thanks for confirming! Since we're getting close to the event, I'm bundling everything you need into this one email.

Booking you in for:

{{slot_summary}}

A few quick things from you:

1. A contact name and cell number for whoever's working that night.
2. Your venue's capacity.
3. Any drink special you'd like featured? Totally optional.
{{wristband_shipping_note}}

Attached:

- Staff info sheet (please share with whoever's working that night)
{{wristband_attachments_note}}

We'll send one more quick check-in the day before the event, but otherwise you should be all set.

Let me know if you have any questions.

Thanks,
{{your_name}}
{{company_name}}`,
    trigger: { channel: "post_confirm", stage: "confirmation", max_days_to_event: 21 },
  },
  {
    code: "T10",
    name: "T10 - Social media graphic delivery",
    subject: "{{city}} Halloween crawl social graphic - for {{venue_name}}",
    body: `Hey {{contact_first_name}},

Attached is the social media graphic for the {{city}} Halloween crawl. Feel free to share it on your venue's Instagram, Facebook, or wherever - the more we both promote, the bigger the turnout.

Let me know if you want it resized or in a different format and I can sort that out.

Thanks,
{{your_name}}
{{company_name}}`,
    trigger: { channel: "lifecycle", stage: "graphic" },
  },
  {
    code: "T11-wristband",
    name: "T11-wristband - Staff + participant sheet + wristband image (3 wks, wristband)",
    subject: "{{city}} Halloween crawl - staff info + wristband details for {{venue_name}}",
    body: `Hey {{contact_first_name}},

We're about 3 weeks out from the {{city}} Halloween crawl on {{event_date}}. Sending over the staff info and wristband details so you're all set.

Attached:

- Staff info sheet (please share with whoever's working that night - covers what guests will look like, how to handle wristband questions, etc.)
- Participant info sheet (this is what your guests will see, so your staff knows what info has gone out to them)
- Wristband image (what the actual wristbands look like, so your team knows what they're handing out)

Wristbands themselves will ship out about 2 weeks before the event. Tracking info will follow once they're in the mail.

Quick reminder: the wristband pickup window is {{wristband_window}}, and your slot is {{slot_summary}}.

{{turnout_quote_current}}

Let me know if anything looks off, or if you have any questions.

Thanks,
{{your_name}}
{{company_name}}`,
    trigger: { channel: "lifecycle", stage: "info_sheets", wristband_only: true },
  },
  {
    code: "T11-other",
    name: "T11-other - Staff sheet only (3 wks, non-wristband)",
    subject: "{{city}} Halloween crawl - staff info for {{venue_name}}",
    body: `Hey {{contact_first_name}},

We're about 3 weeks out from the {{city}} Halloween crawl on {{event_date}}. Sending over the staff info sheet so your team's prepped.

Attached:

- Staff info sheet (please share with whoever's working that night - covers what to expect from guests, how to handle questions, etc.)

Just a reminder, your slot is {{slot_summary}}.

{{turnout_quote_current}}

Let me know if anything's changed on your end or if you have questions.

Thanks,
{{your_name}}
{{company_name}}`,
    trigger: { channel: "lifecycle", stage: "info_sheets", wristband_only: false },
  },
  {
    code: "T13",
    name: "T13 - Pre-event check-in (2 weeks out)",
    subject: "2 weeks out - {{city}} Halloween crawl with {{venue_name}}",
    body: `Hey {{contact_first_name}},

We're about 2 weeks out from the {{city}} Halloween crawl on {{event_date}}. Just a quick update.

{{turnout_quote_current}}

Your slot: {{slot_summary}}

{{wristband_shipping_status}}

A couple things to confirm:

1. Is your staff still good to go for that night?
2. Anything you'd like us to flag to guests (drink special, costume contest, parking, etc.)?

Otherwise everything's on track on our end. We'll do one more check-in the day before the event.

Thanks,
{{your_name}}
{{company_name}}`,
    trigger: {
      channel: "lifecycle",
      stage: "pre_event",
      max_days_to_event: 14,
      min_days_to_event: 7,
    },
  },
  {
    code: "T14",
    name: "T14 - Day-before confirmation",
    subject: "See you tomorrow - {{city}} Halloween crawl",
    body: `Hey {{contact_first_name}},

Quick day-before check-in for tomorrow's crawl ({{event_date}}).

Your slot: {{slot_summary}}

{{turnout_quote_current}}

A couple of last things:

1. Make sure your staff's up to speed on the info sheet we sent earlier (re-attached here just in case).
{{host_info_note}}

If anything comes up tomorrow, just call or text. Otherwise looking forward to a great night!

Thanks,
{{your_name}}
{{company_name}}`,
    trigger: {
      channel: "lifecycle",
      stage: "day_before",
      max_days_to_event: 7,
      min_days_to_event: 1,
    },
  },
  {
    code: "T15",
    name: "T15 - Day-of we're live",
    subject: "Tonight - {{city}} Halloween crawl",
    body: `Hey {{contact_first_name}},

Quick note - we're live tonight! Crawl kicks off at 7:30 PM at {{wristband_venue_name}}.

Your slot: {{slot_summary}}

{{turnout_quote_current}}

If anything comes up tonight, just call or text {{operator_cell}} directly. Otherwise have a great night!

Thanks,
{{your_name}}
{{company_name}}`,
    trigger: { channel: "lifecycle", stage: "day_of", max_days_to_event: 0 },
  },
  {
    code: "T16",
    name: "T16 - Cancellation by PERSE",
    subject: "Update on the {{city}} Halloween crawl with {{venue_name}}",
    body: `Hey {{contact_first_name}},

I wanted to reach out personally - we're not going to be able to run the {{city}} crawl on {{event_date}} after all.

{{cancellation_reason_phrase}}

I know this isn't ideal and I'm really sorry for the disruption. We'd love to keep working with you for future events - we run NYE, St. Patrick's, and our next Halloween, and we'll reach out as those come up.

If you have any questions, just reply or give us a call.

Thanks for being patient with us,
{{your_name}}
{{company_name}}`,
    trigger: { channel: "cancellation" },
  },
  {
    code: "T17",
    name: "T17 - Post-event thank-you + NYE re-engagement",
    subject: "Thanks for the {{city}} Halloween crawl - and one quick question about NYE",
    body: `Hey {{contact_first_name}},

Thanks again for hosting us at {{venue_name}} for the {{city}} Halloween crawl on {{event_date}}. Hope the night went well on your end!

While we're already thinking ahead - New Year's Eve is just around the corner (Thursday, December 31st) and we're starting to lock in the lineup for {{city}} now. Would {{venue_name}} be open to joining us again? Same setup as Halloween, just adjusted timing for the NYE crowd:

Wristband Venue (7:00 PM to 10:00 PM): Check-in / wristband pickup.
Participating Venue (9:00 PM to 11:00 PM): Middle slot, shared with 2-3 other venues.
Final Venue (11:00 PM to 2:00 AM): Where everyone meets to ring in the new year.

Same terms as Halloween - you keep 100% of bar sales, we handle ticketing, marketing, and promotion. No exclusivity, no line bypass required.

Let me know if you're interested in any slot and I'll get you locked in.

Thanks,
{{your_name}}
{{company_name}}`,
    trigger: { channel: "post_event" },
  },
  {
    code: "H0a",
    name: "H0a - External host hiring confirmation",
    subject: "Hired for the {{city}} Halloween crawl ({{event_date}}) - confirming details",
    body: `Hey {{host_name}},

Confirming you're hired for the {{city}} Halloween crawl on {{event_date}}. Shift is approximately {{shift_start_time}} to {{shift_end_time}}.

Pay rate: {{pay_rate}}
Payment will be sent within 3 days after the event via {{payment_method}}.

Your host manager for this night is {{host_manager_name}} - their cell is {{host_manager_phone}}. They'll be your primary contact for anything that comes up, whether it's a scheduling conflict, a question, or an issue. Reach out to them directly.

We'll send over the wristband venue address, the full lineup, and the wristband image about a week before the event. So just hold the date for us!

If anything changes on your end before then, please let us know as soon as possible so we can find a backup.

Thanks for working with us!
{{your_name}}
{{company_name}}`,
    trigger: { channel: "host_brief", stage: "hire_time" },
  },
  {
    code: "H0b",
    name: "H0b - External host operational briefing (week-of)",
    subject: "{{city}} Halloween crawl ({{event_date}}) - briefing",
    body: `Hey {{host_name}},

The {{city}} Halloween crawl is this {{event_day_name}}. Here's everything you need:

WHERE TO GO
{{wristband_venue_name}}
{{wristband_venue_address}}
Arrival time: {{host_arrival_time}}

VENUE CONTACT
{{venue_manager_name}}, {{venue_manager_phone}}
Please say hi when you arrive so they know who you are.

THE LINEUP
{{full_lineup_with_times_and_addresses}}

WHAT YOU'RE DOING

- Scan guest tickets at the door (we'll send login details separately).
- Hand out wristbands to ticketed guests.
- Greet guests, direct them to scan the crawl map QR code.
- About 1 hour before the crawl starts, visit each participating venue to introduce yourself and confirm their door staff knows the crawl is happening tonight.

Attached: wristband image (so you know what you're handing out).

If anything goes wrong, contact your host manager {{host_manager_name}} at {{host_manager_phone}}. They're your direct line for any issues that come up.

Thanks!
{{your_name}}
{{company_name}}`,
    trigger: { channel: "host_brief", stage: "week_of" },
  },
  {
    code: "V1",
    name: "V1 - Internal-host venue confirmation (week-of)",
    subject: "Quick confirm for the {{city}} Halloween crawl this {{event_day_name}}",
    body: `Hey {{contact_first_name}},

Just a quick week-of confirmation - we're set for {{event_date}} at {{venue_name}}, with your team handing out wristbands during the {{wristband_window}} window.

Just need a "yes, staff is ready" back from you so I know we're all set.

Wristbands should have arrived by now - let me know if you haven't received them.

If anything's changed, give me a heads-up so we can sort it out.

Thanks!
{{your_name}}
{{company_name}}`,
    trigger: { channel: "venue_confirm_internal", stage: "week_of" },
  },
];

function argValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const campaignId = argValue(args, "--campaign-id");
  const campaignSlug = argValue(args, "--campaign-slug") ?? "halloween-2026-intl";

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: dbUrl });
  const db = drizzle(pool);

  try {
    const [campaign] = campaignId
      ? await db
          .select({ id: campaigns.id, brandId: campaigns.outreachBrandId })
          .from(campaigns)
          .where(eq(campaigns.id, campaignId))
          .limit(1)
      : await db
          .select({ id: campaigns.id, brandId: campaigns.outreachBrandId })
          .from(campaigns)
          .where(eq(campaigns.slug, campaignSlug))
          .limit(1);

    if (!campaign) {
      console.error(
        `Campaign not found (${campaignId ?? `slug=${campaignSlug}`}). Pass --campaign-id or --campaign-slug.`,
      );
      process.exit(1);
    }

    let upserts = 0;
    for (const t of HALLOWEEN_2026_TEMPLATES) {
      await db
        .insert(emailTemplates)
        .values({
          campaignId: campaign.id,
          outreachBrandId: campaign.brandId,
          templateCode: t.code,
          name: t.name,
          stage: "custom",
          subjectTemplate: t.subject,
          bodyTemplateText: t.body,
          triggerContext: t.trigger,
          autoPickPriority: 100,
        })
        .onConflictDoUpdate({
          target: [emailTemplates.campaignId, emailTemplates.templateCode],
          targetWhere: sql`campaign_id IS NOT NULL`,
          set: {
            outreachBrandId: campaign.brandId,
            name: t.name,
            stage: "custom",
            subjectTemplate: t.subject,
            bodyTemplateText: t.body,
            triggerContext: t.trigger,
            autoPickPriority: 100,
            updatedAt: sql`now()`,
          },
        });
      upserts += 1;
    }

    console.log(
      `[seed] upserted ${upserts} templates for campaign ${campaign.id} (brand ${campaign.brandId})`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
