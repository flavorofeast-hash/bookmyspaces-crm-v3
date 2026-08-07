import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = {
  conversations: [] as Record<string, unknown>[],
  whatsappMessages: [] as Record<string, unknown>[],
  emailLog: [] as Record<string, unknown>[],
  activityLogs: [] as Record<string, unknown>[],
  proposals: [] as Record<string, unknown>[],
  invoices: [] as Record<string, unknown>[],
  reservations: [] as Record<string, unknown>[],
  reservationsError: null as { message: string } | null,
  aiLog: [] as Record<string, unknown>[],
  aiLogError: null as { message: string } | null,
  reviews: [] as Record<string, unknown>[],
  referralRewards: [] as Record<string, unknown>[],
  loyaltyTransactions: [] as Record<string, unknown>[],
  messageQueue: [] as Record<string, unknown>[],
  followUps: [] as Record<string, unknown>[],
}

function resetState() {
  state.conversations = []
  state.whatsappMessages = []
  state.emailLog = []
  state.activityLogs = []
  state.proposals = []
  state.invoices = []
  state.reservations = []
  state.reservationsError = null
  state.aiLog = []
  state.aiLogError = null
  state.reviews = []
  state.referralRewards = []
  state.loyaltyTransactions = []
  state.messageQueue = []
  state.followUps = []
}

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      const chain = (data: unknown, error: unknown = null) => ({
        select: () => ({
          eq: () => ({
            eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data, error }) }) }), // email_log (2 eqs)
            order: () => ({ limit: () => Promise.resolve({ data, error }) }),
          }),
          in: () => ({ order: () => ({ limit: () => Promise.resolve({ data, error }) }) }),
        }),
      })

      // Phase 2 (Social + WhatsApp Growth) — Phase C additions use varying
      // chain shapes (eq/in/or in different orders), so they get a single
      // flexible chainable stub: every method returns itself, and the
      // terminal .limit() resolves. Simpler than extending `chain()`'s
      // fixed eq->eq/order shape for every new call pattern.
      const flex = (data: unknown, error: unknown = null) => {
        const node: Record<string, unknown> = {}
        node.select = () => node
        node.eq = () => node
        node.in = () => node
        node.or = () => node
        node.order = () => node
        node.limit = () => Promise.resolve({ data, error })
        return node
      }

      switch (table) {
        case 'conversations': return chain(state.conversations)
        case 'whatsapp_messages': return chain(state.whatsappMessages)
        case 'email_log': return chain(state.emailLog)
        case 'activity_logs': return chain(state.activityLogs)
        case 'proposals': return chain(state.proposals)
        case 'invoices': return chain(state.invoices)
        case 'reservations': return chain(state.reservations, state.reservationsError)
        case 'ai_interaction_log': return chain(state.aiLog, state.aiLogError)
        case 'reviews': return flex(state.reviews)
        case 'referral_rewards': return flex(state.referralRewards)
        case 'loyalty_transactions': return flex(state.loyaltyTransactions)
        case 'message_queue': return flex(state.messageQueue)
        case 'follow_ups': return flex(state.followUps)
        default: throw new Error(`unexpected table: ${table}`)
      }
    },
  }),
}))

import { getCustomerTimeline } from './timeline-service'

describe('getCustomerTimeline', () => {
  beforeEach(resetState)

  it('returns an empty timeline with no degraded sources when nothing exists', async () => {
    const result = await getCustomerTimeline('lead-1')
    expect(result).toEqual({ leadId: 'lead-1', entries: [], degraded: {} })
  })

  it('merges every live source into one chronologically-sorted (newest first) list', async () => {
    state.conversations = [{ id: 'c1', channel: 'whatsapp', updated_at: '2026-07-10T10:00:00Z', is_active: false }]
    state.whatsappMessages = [{ id: 'w1', direction: 'inbound', message_type: 'text', message_text: 'Hi', message_status: 'received', created_at: '2026-07-12T09:00:00Z' }]
    state.emailLog = [{ id: 'e1', subject: 'Your Proposal', template_type: 'proposal', to_email: 'a@b.com', created_at: '2026-07-11T08:00:00Z' }]
    state.activityLogs = [
      { id: 'a1', action: 'status_changed', description: 'Status updated', created_at: '2026-07-13T07:00:00Z', performed_by: 'admin' },
      { id: 'a2', action: 'followup_sent', description: 'WhatsApp follow-up sent', created_at: '2026-07-09T07:00:00Z', performed_by: 'system' },
    ]
    state.proposals = [{ id: 'p1', proposal_number: 'BMS-1', package_name: 'Gold', total_price: 50000, status: 'sent', created_at: '2026-07-08T06:00:00Z' }]
    state.invoices = [{ id: 'i1', invoice_number: 'INV-1', total_amount: 50000, advance_received: 15000, balance_due: 35000, status: 'partial', paid_at: '2026-07-14T00:00:00Z', created_at: '2026-07-08T06:30:00Z' }]

    const result = await getCustomerTimeline('lead-1')

    expect(result.degraded).toEqual({})
    expect(result.entries).toHaveLength(7)
    // Newest first: invoice paid_at (07-14) should be first
    expect(result.entries[0].type).toBe('payment')
    expect(result.entries[0].timestamp).toBe('2026-07-14T00:00:00Z')
    // Last should be the oldest entry (proposal at 07-08)
    expect(result.entries.at(-1)?.type).toBe('proposal')

    const types = result.entries.map((e) => e.type)
    expect(types).toContain('chat')
    expect(types).toContain('whatsapp')
    expect(types).toContain('email')
    expect(types).toContain('lead_activity')
    expect(types).toContain('proposal')
  })

  it('marks reservation and ai_interaction degraded on error without failing the whole timeline', async () => {
    state.reservationsError = { message: 'relation "reservations" does not exist' }
    state.aiLogError = { message: 'relation "ai_interaction_log" does not exist' }
    state.conversations = [{ id: 'c1', channel: 'website_chat', updated_at: '2026-07-10T10:00:00Z', is_active: true }]

    const result = await getCustomerTimeline('lead-1')

    expect(result.degraded).toEqual({ reservation: true, ai_interaction: true })
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].type).toBe('chat')
  })

  it('does not query invoices when the customer has no proposals', async () => {
    state.proposals = []
    const result = await getCustomerTimeline('lead-1')
    expect(result.entries.filter((e) => e.type === 'payment')).toEqual([])
  })

  // V3 Sprint 4 — Priority 2: pins down the exact ai_interaction_log column
  // contract this service depends on (lead_id, interaction_type, summary,
  // created_at). Migration 012 originally shipped without those three
  // columns — this test exists so that regressing the schema again would
  // fail loudly here instead of silently degrading the timeline once the
  // migration is actually applied to a live database.
  it('surfaces ai_interaction_log rows using the interaction_type/summary column contract', async () => {
    state.aiLog = [
      { id: 'ai1', interaction_type: 'customer_summary', summary: 'Repeat guest, prefers rooftop venues.', created_at: '2026-07-13T12:00:00Z' },
    ]

    const result = await getCustomerTimeline('lead-1')

    const aiEntry = result.entries.find((e) => e.type === 'ai_interaction')
    expect(aiEntry).toBeDefined()
    expect(aiEntry?.title).toBe('AI customer_summary')
    expect(aiEntry?.description).toBe('Repeat guest, prefers rooftop venues.')
  })

  // Phase 2 (Social + WhatsApp Growth) — Phase C: review/referral/loyalty/
  // campaign/call/visit sources.
  it('surfaces review, referral, loyalty, campaign, call and visit entries', async () => {
    state.reviews = [{ id: 'r1', platform: 'google', rating: 4.5, content: 'Great stay!', review_date: '2026-07-01T00:00:00Z', response_status: 'posted', created_at: '2026-07-01T00:00:00Z' }]
    state.referralRewards = [{ id: 'rr1', referrer_lead_id: 'lead-1', referred_lead_id: 'lead-2', status: 'earned', reward_type: 'discount', reward_value: 500, created_at: '2026-07-02T00:00:00Z' }]
    state.loyaltyTransactions = [{ id: 'lt1', points_delta: 100, reason: 'Booking reward', reference_type: 'reservation', created_at: '2026-07-03T00:00:00Z' }]
    state.messageQueue = [
      { id: 'mq1', message: 'Festival offer!', status: 'sent', scheduled_at: '2026-07-04T00:00:00Z', last_attempted_at: '2026-07-04T00:05:00Z', metadata: { campaign_id: 'camp-1', lead_id: 'lead-1' } },
      { id: 'mq2', message: 'Non-campaign send', status: 'sent', scheduled_at: '2026-07-04T00:00:00Z', last_attempted_at: null, metadata: {} },
    ]
    state.followUps = [
      { id: 'f1', type: 'call', status: 'completed', scheduled_at: '2026-07-05T00:00:00Z', completed_at: '2026-07-05T01:00:00Z', notes: 'Discussed package', purpose: null, property: null, created_at: '2026-07-05T00:00:00Z' },
      { id: 'f2', type: 'site_visit', status: 'pending', scheduled_at: '2026-07-06T00:00:00Z', completed_at: null, notes: null, purpose: 'Wedding site visit', property: 'Skyline Serenity', created_at: '2026-07-06T00:00:00Z' },
    ]

    const result = await getCustomerTimeline('lead-1')
    const types = result.entries.map((e) => e.type)

    expect(types).toContain('review')
    expect(types).toContain('referral')
    expect(types).toContain('loyalty')
    expect(types).toContain('call')
    expect(types).toContain('visit')

    // Only the row with a campaign_id in metadata becomes a 'campaign' entry.
    const campaignEntries = result.entries.filter((e) => e.type === 'campaign')
    expect(campaignEntries).toHaveLength(1)
    expect(campaignEntries[0].metadata.campaignId).toBe('camp-1')

    const visitEntry = result.entries.find((e) => e.type === 'visit')
    expect(visitEntry?.description).toBe('Wedding site visit')
  })
})
