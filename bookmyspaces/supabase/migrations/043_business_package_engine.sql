-- ═══════════════════════════════════════════════════════════════════════════
-- BOOKMYSPACES — MIGRATION 043: Business Package Engine
-- File  : 043_business_package_engine.sql
--
-- PURPOSE:
-- Replaces hardcoded campaign templates (src/lib/campaigns/campaign-config.ts's
-- 5-slug CAMPAIGN_CONFIG object) as the ONLY way to define a marketable
-- offer. Introduces `business_packages` — a genuinely new entity, distinct
-- from the existing `packages` table (migration 007/023, a PRICING catalog:
-- venue/hall/tier/base_price/addons, used by the Proposal Engine). A
-- Business Package is a marketing/campaign archetype (name, audience,
-- CTA, landing page, AI prompt, hashtags, WhatsApp/email copy, follow-up
-- sequence, target segment) — no such row existed anywhere before this.
--
-- REUSE OVER DUPLICATE — every "template" field is a pointer/text input
-- into an EXISTING engine, not a new one:
--   - pricing_package_id      -> existing `packages` table (Proposal Engine)
--   - follow_up_sequence_id   -> existing `drip_sequences` table (migration 037)
--   - marketing_segment       -> fed straight into the existing buildSegment()
--                                (src/lib/campaigns.ts) SegmentFilter shape
--   - landing_page_slug       -> rendered by the EXISTING /[campaign] route +
--                                Landing* components + /api/campaigns/track
--                                attribution path (leads.campaign), only
--                                extended (not replaced) to fall back to this
--                                table when a slug isn't one of the 5
--                                hardcoded ones
--   - ai_prompt/hashtags      -> fed straight into the EXISTING
--                                generateSocialPostDraft() (content-generator.ts)
--   - whatsapp_template/email_template -> rendered with the SAME {{name}}
--                                token convention already established in
--                                drip-service.ts's renderTemplate(), sent via
--                                the SAME sendWhatsAppText()/email/provider.ts
--
-- Additive only. No existing table's semantics change; the 5 existing
-- hardcoded campaigns are untouched and keep working exactly as before.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS business_packages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  name TEXT NOT NULL,
  -- Deliberately free TEXT, not a CHECK-constrained enum: constraining this
  -- to exactly today's category list would itself be a form of hardcoding
  -- package identity into the schema, defeating "operators can add packages
  -- without code changes." The CRM UI offers the seeded categories as
  -- suggestions, not a closed list.
  category TEXT,
  description TEXT,
  target_audience TEXT,
  highlights TEXT[] DEFAULT '{}',
  budget_range TEXT,
  cta TEXT,

  -- Rendered by /[campaign]/page.tsx when the slug isn't one of the 5
  -- hardcoded CAMPAIGN_SLUGS. NULL = this package has no dedicated landing
  -- page (e.g. it reuses an existing hardcoded one — see seed data below).
  landing_page_slug TEXT UNIQUE,

  -- Proposal Engine reuse: optional link to an existing pricing package
  -- (proposals.package_id already understands this FK) so accepting this
  -- business package's offer can generate a real, priced proposal without
  -- a second pricing concept.
  pricing_package_id UUID REFERENCES packages(id) ON DELETE SET NULL,
  -- Free-text seed for the proposal's AI cover note / notes — a template in
  -- the literal sense the mission asked for, distinct from the structural
  -- pricing_package_id link above.
  proposal_template_notes TEXT,

  ai_prompt TEXT,
  hashtags TEXT[] DEFAULT '{}',
  recommended_media TEXT,
  recommended_posting_time TEXT,

  -- {{name}}-token templates, same convention as drip_sequence_steps.message_template.
  whatsapp_template TEXT,
  email_subject_template TEXT,
  email_template TEXT,

  -- Follow-up Sequence reuse: optional link to an existing drip sequence
  -- (migration 037) — no second follow-up engine.
  follow_up_sequence_id UUID REFERENCES drip_sequences(id) ON DELETE SET NULL,

  -- SegmentFilter-shaped JSON, passed directly to buildSegment() (campaigns.ts).
  marketing_segment JSONB DEFAULT '{}',

  -- Active/Inactive/Retired — a plain boolean can't express "retired"
  -- (permanently withdrawn, kept for history) distinctly from "temporarily
  -- inactive," and the mission explicitly asks for both.
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'retired')),

  created_by TEXT DEFAULT 'admin'
);

CREATE INDEX IF NOT EXISTS idx_business_packages_status ON business_packages(status);
CREATE INDEX IF NOT EXISTS idx_business_packages_category ON business_packages(category);
CREATE INDEX IF NOT EXISTS idx_business_packages_landing_page_slug ON business_packages(landing_page_slug);

CREATE TRIGGER update_business_packages_updated_at
  BEFORE UPDATE ON business_packages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE business_packages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access" ON business_packages;
CREATE POLICY "Service role full access" ON business_packages
  FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE business_packages IS
  'Configurable marketing/campaign package archetype (Business Package Engine). Replaces hardcoded campaign templates — operators add/edit/activate/deactivate/retire rows here instead of editing code. Every field is either plain content or a pointer into an existing engine (packages, drip_sequences, buildSegment, content-generator, landing pages) — no duplicate business logic.';

-- Revenue Attribution reuse: nullable, additive link so a published social
-- post or an accepted proposal can be attributed back to the business
-- package that drove it, without a new attribution table — existing
-- revenue-intelligence/campaign-ROI logic already groups by leads.campaign
-- (which the DB-driven landing page continues to populate identically to
-- the hardcoded ones); these two columns are for direct package-level
-- rollups in the Content Studio / Proposals UI, not a replacement for that.
ALTER TABLE social_posts
  ADD COLUMN IF NOT EXISTS business_package_id UUID REFERENCES business_packages(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_social_posts_business_package_id ON social_posts(business_package_id);

ALTER TABLE proposals
  ADD COLUMN IF NOT EXISTS business_package_id UUID REFERENCES business_packages(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_proposals_business_package_id ON proposals(business_package_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- SEED: 17 default packages. landing_page_slug reuses the 4 existing
-- hardcoded slugs where a matching campaign already exists (birthday,
-- corporate, airport-stay, staycation) rather than creating a duplicate
-- landing page for the same audience; every other package gets a new slug
-- served by the DB-fallback path in /[campaign]/page.tsx.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO business_packages
  (name, category, description, target_audience, highlights, budget_range, cta, landing_page_slug,
   ai_prompt, hashtags, recommended_media, recommended_posting_time,
   whatsapp_template, email_subject_template, email_template, marketing_segment, status)
VALUES
  ('Pre-Wedding Celebration', 'Wedding',
   'An intimate rooftop setting for pre-wedding shoots, mehendi, or haldi celebrations before the big day.',
   'Engaged couples planning their wedding festivities in Kolkata',
   ARRAY['Rooftop skyline backdrop','Customizable decor themes','Photography-friendly lighting','Catering add-ons available'],
   '₹40,000 – ₹90,000', 'Book a site visit for your pre-wedding celebration',
   'pre-wedding-celebration',
   'Promote BookMySpaces'' rooftop venue for pre-wedding celebrations (mehendi, haldi, pre-wedding shoots) — romantic, celebratory tone, emphasize the skyline backdrop and photography appeal.',
   ARRAY['kolkatawedding','preweddingshoot','rooftopvenue','mehendi'],
   'Golden-hour rooftop photos, decor close-ups, couple portraits', 'Weekday evenings 6–8pm, weekend mornings',
   'Hi {{name}}! 💛 Planning your pre-wedding celebration? Our rooftop venue at Monurama Homestay is perfect for mehendi, haldi, or a pre-wedding shoot. Want to see available dates?',
   'Your Pre-Wedding Celebration, Beautifully Hosted',
   'Hi {{name}},\n\nCongratulations on your upcoming wedding! Our rooftop venue offers the perfect setting for your pre-wedding celebrations — mehendi, haldi, or a romantic pre-wedding shoot with a skyline backdrop.\n\nReply to this email or WhatsApp us to check availability.\n\nTeam BookMySpaces',
   '{"event_type": "wedding"}'::jsonb, 'active'),

  ('Engagement Ceremony', 'Engagement',
   'A celebratory venue for engagement ceremonies and ring ceremonies with rooftop or hall options.',
   'Couples and families planning an engagement ceremony',
   ARRAY['Rooftop or hall seating','Stage/mandap setup available','In-house catering options','Up to 100 guests'],
   '₹50,000 – ₹1,20,000', 'Enquire about engagement ceremony packages',
   'engagement-ceremony',
   'Promote BookMySpaces for engagement ceremonies — warm, celebratory tone, emphasize flexible rooftop/hall setup and capacity for family gatherings.',
   ARRAY['engagementceremony','kolkataevents','ringceremony','rooftopvenue'],
   'Stage/mandap decor shots, ring exchange moments, family group photos', 'Weekend afternoons, weekday evenings',
   'Hi {{name}}! 💍 Congratulations on the engagement! We''d love to host your ceremony at Monurama Homestay — rooftop or hall seating available for up to 100 guests. Shall we share our packages?',
   'Celebrate Your Engagement With Us',
   'Hi {{name}},\n\nCongratulations on your engagement! Monurama Homestay offers rooftop and hall venues perfect for an engagement ceremony, with in-house catering and decor options for up to 100 guests.\n\nLet us know your preferred date and we''ll share full package details.\n\nTeam BookMySpaces',
   '{"event_type": "engagement"}'::jsonb, 'active'),

  ('Anniversary Celebration', 'Anniversary',
   'A romantic rooftop or private dining setup for wedding anniversaries and milestone celebrations.',
   'Couples celebrating a wedding anniversary or milestone',
   ARRAY['Private dining or rooftop setup','Customizable cake/decor add-ons','Intimate to mid-size gatherings'],
   '₹15,000 – ₹60,000', 'Plan your anniversary celebration with us',
   'anniversary-celebration',
   'Promote BookMySpaces for anniversary celebrations — warm, romantic tone, emphasize intimate private dining or rooftop options for couples and families.',
   ARRAY['anniversarycelebration','privatedining','rooftopvenue','kolkata'],
   'Candlelit table setups, rooftop sunset views, couple portraits', 'Weekday evenings',
   'Hi {{name}}! 🥂 Celebrating an anniversary? Let us set the scene — private dining or a rooftop evening at Monurama Homestay. Want to check availability for your date?',
   'Make Your Anniversary Memorable',
   'Hi {{name}},\n\nWishing you a happy anniversary! We''d love to help you celebrate with a private dining setup or a rooftop evening at Monurama Homestay.\n\nReply to this email or WhatsApp us for available dates and packages.\n\nTeam BookMySpaces',
   '{"event_type": "anniversary"}'::jsonb, 'active'),

  ('Birthday Party', 'Birthday',
   'Rooftop and hall birthday celebrations for all ages, from kids'' parties to milestone birthdays.',
   'Families and individuals planning a birthday celebration',
   ARRAY['Rooftop and hall options','Decor and catering add-ons','Up to 100 guests'],
   '₹25,000 – ₹80,000', 'Book your birthday celebration',
   'birthday',
   'Promote BookMySpaces for birthday celebrations — fun, festive tone, mention decoration/cake/party vibes, rooftop and hall options.',
   ARRAY['birthdayparty','kolkataevents','rooftopvenue','celebration'],
   'Balloon/decor setups, cake-cutting moments, rooftop party shots', 'Weekend afternoons, weekday evenings',
   'Hi {{name}}! 🎉 Planning a birthday celebration? Monurama Homestay has rooftop and hall options for parties of all sizes. Want to see our packages?',
   'Celebrate Another Year With Us',
   'Hi {{name}},\n\nPlanning a birthday celebration? Monurama Homestay offers rooftop and hall venues for parties of all ages, with decor and catering add-ons available.\n\nLet us know your date and guest count for a tailored package.\n\nTeam BookMySpaces',
   '{"event_type": "birthday"}'::jsonb, 'active'),

  ('Baby Shower', 'Baby Shower',
   'A warm, decorated setting for baby showers and baby welcome celebrations.',
   'Families planning a baby shower or baby welcome event',
   ARRAY['Themed decor add-ons','Hall or rooftop seating','Catering for mid-size gatherings'],
   '₹20,000 – ₹55,000', 'Enquire about baby shower packages',
   'baby-shower',
   'Promote BookMySpaces for baby showers — warm, joyful tone, emphasize themed decor and comfortable indoor/rooftop seating for family gatherings.',
   ARRAY['babyshower','kolkataevents','familycelebration','rooftopvenue'],
   'Themed decor shots, family group photos, dessert table setups', 'Weekend afternoons',
   'Hi {{name}}! 👶 Congratulations! We''d love to host your baby shower at Monurama Homestay — themed decor and comfortable seating for family and friends. Want package details?',
   'A Beautiful Baby Shower Awaits',
   'Hi {{name}},\n\nCongratulations on your growing family! Monurama Homestay offers a warm, decorated setting for baby showers, with catering and decor add-ons available.\n\nReply or WhatsApp us for available dates.\n\nTeam BookMySpaces',
   '{"event_type": "baby shower"}'::jsonb, 'active'),

  ('Rooftop Party', 'Private Party',
   'Open-air rooftop parties for celebrations of any kind, day or evening.',
   'Anyone planning a casual or themed rooftop party',
   ARRAY['Skyline views','Evening/sunset ambience','Flexible seating and decor'],
   '₹20,000 – ₹70,000', 'Reserve the rooftop for your party',
   'rooftop-party',
   'Promote BookMySpaces'' rooftop venue for general parties — emphasize skyline views, open-air ambience, and evening/sunset appeal for any celebration.',
   ARRAY['rooftopparty','kolkatanightlife','skylineview','celebration'],
   'Sunset skyline shots, string-light decor, party crowd shots', 'Evenings, especially Friday–Sunday',
   'Hi {{name}}! 🌇 Looking for a rooftop party spot? Monurama Homestay''s rooftop has skyline views and flexible setup for any celebration. Want to check dates?',
   'Your Rooftop Party, Sorted',
   'Hi {{name}},\n\nLooking for the perfect rooftop party venue? Monurama Homestay offers skyline views and flexible decor/seating for celebrations of any kind.\n\nLet us know your date to check availability.\n\nTeam BookMySpaces',
   '{}'::jsonb, 'active'),

  ('Private Dining', 'Private Dining',
   'An exclusive private dining experience for special occasions or intimate gatherings.',
   'Guests seeking an intimate, exclusive dining experience',
   ARRAY['Curated menu options','Private, exclusive seating','Personalized service'],
   '₹10,000 – ₹45,000', 'Reserve a private dining experience',
   'private-dining',
   'Promote BookMySpaces for private dining experiences — emphasize cuisine, ambience, exclusivity, and personalized service for intimate occasions.',
   ARRAY['privatedining','kolkatadining','finedining','celebration'],
   'Plated dish close-ups, table ambience shots, chef/service moments', 'Weekday and weekend evenings',
   'Hi {{name}}! 🍽️ Looking for a private dining experience? We offer curated menus and exclusive seating at Monurama Homestay. Want to reserve a date?',
   'An Exclusive Private Dining Experience',
   'Hi {{name}},\n\nLooking for something special? Our private dining experience offers curated menus and exclusive, personalized service.\n\nReply or WhatsApp us to reserve your date.\n\nTeam BookMySpaces',
   '{}'::jsonb, 'active'),

  ('Family Get-Together', 'Private Party',
   'A relaxed venue for family reunions, get-togethers, and casual gatherings.',
   'Families planning a reunion or casual get-together',
   ARRAY['Indoor and outdoor seating','Group catering options','Kid-friendly space'],
   '₹15,000 – ₹50,000', 'Plan your family get-together',
   'family-get-together',
   'Promote BookMySpaces for family get-togethers — warm, relaxed tone, emphasize comfortable indoor/outdoor space for family reunions and casual gatherings.',
   ARRAY['familygettogether','kolkataevents','reunion','rooftopvenue'],
   'Family group photos, casual dining setups, kids playing shots', 'Weekend afternoons',
   'Hi {{name}}! 👨‍👩‍👧‍👦 Planning a family get-together? Monurama Homestay has comfortable indoor and outdoor space for reunions of any size. Want to check dates?',
   'Bring the Family Together',
   'Hi {{name}},\n\nPlanning a family reunion or get-together? Monurama Homestay offers comfortable indoor and outdoor space with group catering options.\n\nLet us know your date and guest count.\n\nTeam BookMySpaces',
   '{}'::jsonb, 'active'),

  ('Corporate Meeting', 'Corporate',
   'Professional meeting and offsite space with AV facilities for business gatherings.',
   'Businesses planning meetings, offsites, or conferences',
   ARRAY['AV/presentation facilities','Hall seating for up to 15–50','Catering options'],
   '₹15,000 – ₹60,000', 'Book a corporate meeting space',
   'corporate',
   'Promote BookMySpaces for corporate meetings — professional tone, emphasize reliability, AV/facilities, and hospitality quality for business guests.',
   ARRAY['corporateevents','kolkatabusiness','offsite','meetingvenue'],
   'Hall/AV setup shots, professional catering spreads, meeting-in-progress shots', 'Weekday business hours',
   'Hi {{name}}, this is BookMySpaces. Planning a corporate meeting or offsite? Our halls come with AV facilities and catering options. Want a quote?',
   'Professional Meeting Space, Ready When You Are',
   'Hi {{name}},\n\nPlanning a corporate meeting, offsite, or conference? Our venue offers AV-ready hall space and catering options for business gatherings.\n\nReply to this email for a tailored quote.\n\nTeam BookMySpaces',
   '{"is_corporate": true}'::jsonb, 'active'),

  ('Team Outing', 'Corporate',
   'A relaxed offsite venue for team outings, offsites, and corporate bonding events.',
   'Companies planning a team outing or offsite',
   ARRAY['Rooftop and hall space','Team activity-friendly layout','Group catering'],
   '₹20,000 – ₹65,000', 'Plan your team outing',
   'team-outing',
   'Promote BookMySpaces for team outings — energetic, team-bonding tone, emphasize flexible rooftop/hall space for group activities and catering.',
   ARRAY['teamouting','corporateevents','kolkatabusiness','offsite'],
   'Group activity shots, rooftop team photos, catering spreads', 'Weekday afternoons, weekends',
   'Hi {{name}}! Planning a team outing? Monurama Homestay''s rooftop and hall spaces are great for team bonding and group activities. Want package details?',
   'A Great Team Outing Starts Here',
   'Hi {{name}},\n\nPlanning a team outing or offsite? Our rooftop and hall spaces are ideal for group activities and team bonding, with catering options available.\n\nReply for a tailored package.\n\nTeam BookMySpaces',
   '{"is_corporate": true}'::jsonb, 'active'),

  ('Weekend Stay', 'Room Stay',
   'A relaxing weekend getaway with comfortable rooms at Skyline Serenity or Monurama Homestay.',
   'Travelers and locals planning a weekend getaway',
   ARRAY['Deluxe & Premium AC rooms','Flexible check-in/out','Two-property choice'],
   '₹3,000 – ₹8,000 per night', 'Book your weekend stay',
   'weekend-stay',
   'Promote BookMySpaces room stays for a weekend getaway — relaxed, escape-the-city tone, emphasize comfort and amenities.',
   ARRAY['weekendgetaway','kolkatastay','staycation','roomstay'],
   'Room interior shots, property exterior, breakfast/amenity shots', 'Thursday–Saturday, targeting weekend planning',
   'Hi {{name}}! 🛏️ Looking for a weekend getaway? We have rooms available at Skyline Serenity and Monurama Homestay. Want to check rates?',
   'Your Weekend Escape Awaits',
   'Hi {{name}},\n\nLooking for a relaxing weekend getaway? We have comfortable rooms available at Skyline Serenity and Monurama Homestay.\n\nReply or WhatsApp us for current rates and availability.\n\nTeam BookMySpaces',
   '{"dormant_since_days": 60}'::jsonb, 'active'),

  ('Airport Transit Stay', 'Room Stay',
   'Comfortable, convenient rooms near Kolkata airport for transit and short stays.',
   'Travelers with early flights, layovers, or short transit needs',
   ARRAY['Near Kolkata airport','Deluxe & Premium AC rooms','Ideal for short stays'],
   '₹2,500 – ₹6,000 per night', 'Book your transit stay',
   'airport-stay',
   'Promote BookMySpaces (Skyline Serenity) for airport transit stays — practical, convenience-focused tone, emphasize proximity to the airport.',
   ARRAY['airportstay','kolkataairport','transitstay','roomstay'],
   'Room interior shots, easy-access exterior shots', 'Anytime — this is a convenience-driven, always-on segment',
   'Hi {{name}}! ✈️ Need a comfortable stay near Kolkata airport? Skyline Serenity is ideal for transit or short stays. Want to check availability?',
   'A Comfortable Stay Near the Airport',
   'Hi {{name}},\n\nNeed a convenient place to stay near Kolkata airport? Skyline Serenity offers comfortable rooms ideal for transit or short stays.\n\nReply for current rates and availability.\n\nTeam BookMySpaces',
   '{}'::jsonb, 'active'),

  ('Business Stay', 'Room Stay',
   'Reliable, comfortable rooms for business travelers visiting Kolkata.',
   'Business travelers visiting Kolkata for work',
   ARRAY['Work-friendly rooms','Flexible billing for companies','Two-property choice'],
   '₹3,000 – ₹7,500 per night', 'Book your business stay',
   'business-stay',
   'Promote BookMySpaces room stays for business travelers — professional, reliable tone, emphasize convenience and comfort for work trips.',
   ARRAY['businesstravel','kolkatastay','corporatetravel','roomstay'],
   'Room interior/workspace shots, property exterior', 'Weekday mornings, targeting business travel planning',
   'Hi {{name}}, this is BookMySpaces. Visiting Kolkata for work? We have comfortable, work-friendly rooms available. Want to check rates?',
   'Comfortable Stays for Business Travel',
   'Hi {{name}},\n\nVisiting Kolkata for work? We offer comfortable, reliable rooms suited for business travelers at Skyline Serenity and Monurama Homestay.\n\nReply for rates and availability.\n\nTeam BookMySpaces',
   '{}'::jsonb, 'active'),

  ('Staycation', 'Room Stay',
   'A relaxed staycation at Skyline Serenity or Monurama Homestay — pick what suits you.',
   'Locals and travelers looking for a short relaxing stay',
   ARRAY['Two-property choice','Flexible booking','Relaxed, no-agenda stay'],
   '₹3,000 – ₹8,000 per night', 'Book your staycation',
   'staycation',
   'Promote BookMySpaces staycations — relaxed, escape tone, emphasize the two-property choice and no-agenda relaxation.',
   ARRAY['staycation','kolkatastay','roomstay','relax'],
   'Room interior shots, lounge/amenity shots, relaxed lifestyle photos', 'Anytime, with a push before long weekends',
   'Hi {{name}}! Looking for a relaxing staycation? Pick Skyline Serenity or Monurama Homestay — we''ll help you choose. Want to check rates?',
   'Your Next Staycation Awaits',
   'Hi {{name}},\n\nLooking for a relaxing staycation? Choose between Skyline Serenity and Monurama Homestay — we''re happy to help you decide.\n\nReply for current rates and availability.\n\nTeam BookMySpaces',
   '{}'::jsonb, 'active'),

  ('Restaurant Promotion', 'Restaurant',
   'A promotional push for BookMySpaces'' dining/restaurant experience.',
   'Diners and locals looking for a dining experience',
   ARRAY['Curated menu highlights','Ambience-focused experience','Group and couple friendly'],
   'À la carte — varies by menu', 'Reserve a table',
   'restaurant-promotion',
   'Promote BookMySpaces'' dining/restaurant experience — emphasize cuisine, ambience, and the dining experience itself.',
   ARRAY['kolkatadining','restaurantpromo','foodie','finedining'],
   'Plated dish close-ups, ambience shots, chef highlights', 'Lunch and dinner hours',
   'Hi {{name}}! 🍴 Craving something special? Reserve a table with us and enjoy our curated menu in a great ambience. Want to book?',
   'A Dining Experience Worth Reserving',
   'Hi {{name}},\n\nCraving something special? Reserve a table and enjoy our curated menu in a wonderful ambience.\n\nReply to reserve your table.\n\nTeam BookMySpaces',
   '{}'::jsonb, 'active'),

  ('Festival Campaign', 'Seasonal',
   'A seasonal/festival-themed promotional package (e.g. Durga Puja, Diwali, Christmas, New Year).',
   'The full active customer base, timed around a specific festival',
   ARRAY['Festival-themed decor/offers','Time-bound urgency','Broad-reach promotion'],
   'Varies by festival offer', 'Celebrate the festival with us',
   'festival-campaign',
   'Promote a festival/seasonal occasion (e.g. Durga Puja, Diwali, Christmas, New Year) — tie the offer/venue to the festive season and its traditions. NOTE: the specific festival, dates, and offer must be filled in by the operator before use — never fabricate a festival date or discount.',
   ARRAY['durgapuja','diwali','festivevibes','kolkatafestival'],
   'Festival decor shots, seasonal menu/offer graphics', 'Lead-up week to the festival, both weekday and weekend',
   'Hi {{name}}! 🎊 [Festival] is here! Celebrate with us at BookMySpaces — reply to hear about our festive offers.',
   '[Festival] Offers at BookMySpaces',
   'Hi {{name}},\n\n[Festival] is around the corner! We''d love to help you celebrate with a special offer.\n\nReply to this email to find out more.\n\nTeam BookMySpaces',
   '{}'::jsonb, 'active'),

  ('Seasonal Offer', 'Seasonal',
   'A limited-time seasonal discount/package deal to drive off-peak bookings.',
   'Price-sensitive leads and past guests during a specific season',
   ARRAY['Limited-time pricing','Applies across rooms/events/dining','Urgency-driven messaging'],
   'Varies by offer', 'Grab this limited-time offer',
   'seasonal-offer',
   'Promote a limited-time offer/discount/package deal — create urgency (without being pushy) and lead with the concrete value/saving. NOTE: the specific discount and validity window must be filled in by the operator before use — never fabricate a discount percentage or expiry date.',
   ARRAY['limitedoffer','kolkatadeals','seasonaloffer','bookmyspaces'],
   'Offer graphic/banner, relevant property/room/event shots', 'Start of the season/promotional window',
   'Hi {{name}}! ⏰ A limited-time offer is live at BookMySpaces — reply to find out more before it ends!',
   'A Limited-Time Offer, Just for You',
   'Hi {{name}},\n\nWe have a limited-time offer available right now.\n\nReply to this email to find out more before it ends.\n\nTeam BookMySpaces',
   '{"dormant_since_days": 90}'::jsonb, 'active')
ON CONFLICT (landing_page_slug) DO NOTHING;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- POST-FLIGHT:
--   SELECT count(*) FROM business_packages; -- expect >= 17
--   SELECT column_name FROM information_schema.columns WHERE table_name = 'social_posts' AND column_name = 'business_package_id';
--   SELECT column_name FROM information_schema.columns WHERE table_name = 'proposals' AND column_name = 'business_package_id';
-- Expect 1 row each.
-- ─────────────────────────────────────────────────────────────────────────────
