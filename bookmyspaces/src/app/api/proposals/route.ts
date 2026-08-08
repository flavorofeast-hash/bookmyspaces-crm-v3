export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { ensureLeadForProposal } from '@/lib/proposals/proposal-service'
import { v4 as uuidv4 } from 'uuid'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth-guard'
import { generateProposalCoverNote } from '@/lib/scoring'
import { parseEventDate } from '@/lib/ai'
import { enqueueMessage } from '@/lib/queue'
import { WHATSAPP_MESSAGES } from '@/lib/templates'
import { getPackageById, resolvePackagePrice } from '@/lib/packages/package-service'
import { logJourneyEvent, JOURNEY_ACTIONS } from '@/lib/customers/journey'

// ─── Types ────────────────────────────────────────────────────────────────────

interface RoomItem {
  room_type : string
  quantity  : number
  nights    : number
  rate      : number
}

interface AddonItem {
  name  : string
  price : number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function calcRoomsTotal(rooms: RoomItem[]): number {
  return rooms.reduce(
    (sum, r) => sum + (Number(r.quantity) || 0) * (Number(r.rate) || 0) * (Number(r.nights) || 0),
    0
  )
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  const supabaseAdmin = getSupabaseAdmin()
  try {
    const { searchParams } = new URL(req.url)
    const leadId = searchParams.get('lead_id')
    const status = searchParams.get('status')
    const id     = searchParams.get('id')

    if (id) {
      const { data, error } = await supabaseAdmin
        .from('proposals')
        .select('*, leads(name, phone, email)')
        .eq('id', id)
        .single()
      if (error) throw error
      return NextResponse.json({ proposal: data })
    }

    let query = supabaseAdmin
      .from('proposals')
      .select('*, leads(name, phone, email)', { count: 'exact' })
      .order('created_at', { ascending: false })

    if (leadId) query = query.eq('lead_id', leadId)
    if (status) query = query.eq('status', status)

    const { data, error, count } = await query.limit(50)
    if (error) throw error
    return NextResponse.json({ proposals: data, total: count })
  } catch (err) {
    logger.error('proposals', 'GET failed', err)
    return NextResponse.json({ error: 'Failed to fetch proposals' }, { status: 500 })
  }
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  const supabaseAdmin = getSupabaseAdmin()
  try {
    const body = await req.json()

    let {
      lead_id,
      client_name,
      client_phone,
      client_email,
      event_type,
      event_date,
      event_time,
      guest_count,
      venue,
      hall,
      package_name,
      base_price         = 0,
      addons             = [] as AddonItem[],
      addon_service_ids  = [] as string[],
      room_items         = [] as RoomItem[],   // ← NEW: room line items
      discount_amount    = 0,
      discount_reason,
      special_requirements,
      inclusions,
      generate_cover_note = true,
    } = body
    const { package_id = null } = body
    // Business Package Engine — explicit override if the caller sends one;
    // otherwise inherited from the resolved lead below ("every proposal
    // should inherit the Business Package").
    let { business_package_id = null } = body

    // ── Smart Proposal Generator (Direct Event Sales Engine, Section 4) ─────
    // When the operator picked a package (from the AI Event Sales Advisor's
    // recommendation, or manually), auto-fill package_name/base_price/
    // addons/venue/hall/addon_service_ids/inclusions from it — SAFE-FILL
    // only, same convention as auto-qualify.ts: a value the client already
    // sent in the request body is never overwritten, only genuinely-missing
    // fields get the package's defaults. The operator still reviews/edits
    // before saving — this populates the form, it doesn't remove their
    // control over it.
    //
    // base_price additionally runs through resolvePackagePrice() so a
    // seasonal pricing rule (migration 024) that matches the event_date is
    // applied automatically — still just a starting number the operator
    // sees and can override, never a silent charge.
    if (package_id) {
      const pkg = await getPackageById(package_id)
      if (pkg) {
        if (!package_name) package_name = pkg.name
        if (!base_price) base_price = resolvePackagePrice(pkg, event_date ?? null).price
        if (!venue) venue = pkg.venue
        if (!hall) hall = pkg.hall
        if (!guest_count) guest_count = pkg.maxGuests
        if (!inclusions) inclusions = pkg.inclusions.join(', ')
        if (!addons || (Array.isArray(addons) && addons.length === 0)) {
          addons = pkg.addons.map((a) => ({ name: a.name, price: a.price }))
        }
        if (!addon_service_ids || addon_service_ids.length === 0) {
          addon_service_ids = pkg.addonServiceIds
        }
        if (!discount_amount && pkg.standardDiscountPct) {
          discount_amount = Math.round((Number(base_price) || 0) * (pkg.standardDiscountPct / 100))
          if (!discount_reason) discount_reason = `${pkg.name} standard discount (${pkg.standardDiscountPct}%)`
        }
      }
    }

    // ── Validation (fix/customer-proposal-sync) ─────────────────────────────
    // Requires at least one contact method (phone OR email, not both) when
    // no existing lead_id is supplied — without one, ensureLeadForProposal()
    // below can still create a name-only lead, but the proposal would be
    // unreachable by phone or email (the exact "no recipient" bug this fix
    // exists to close). Proposals explicitly linked to an existing lead_id
    // skip this check — that lead already has whatever contact info it has.
    if (!lead_id && !client_phone?.trim() && !client_email?.trim()) {
      return NextResponse.json(
        { error: 'Provide at least one contact method — phone or email — for the customer.' },
        { status: 400 }
      )
    }

    // ── Totals ────────────────────────────────────────────────────────────
    const addons_total  = (addons as AddonItem[])
      .reduce((sum, a) => sum + (Number(a.price) || 0), 0)

    const rooms_total   = calcRoomsTotal(room_items as RoomItem[])

    const total_price   = Math.max(
      0,
      (Number(base_price) || 0) + addons_total + rooms_total - (Number(discount_amount) || 0)
    )

    const advance_required = Math.round(total_price * 0.5)

    // ── Cover note ────────────────────────────────────────────────────────
    const proposalData = {
      client_name, client_phone, client_email,
      event_type, event_date, event_time, guest_count,
      venue, package_name,
      base_price: Number(base_price) || 0,
      addons, room_items,
      discount_amount: Number(discount_amount) || 0,
      discount_reason,
      total_price, advance_required,
      special_requirements, inclusions,
    }

    let ai_cover_note: string | null = null
    if (generate_cover_note) {
      try {
        ai_cover_note = await generateProposalCoverNote(proposalData as any)
      } catch (e) {
        logger.error('proposals', 'Cover note generation failed', e)
      }
    }

    // ── Ensure a customer link (fix/customer-proposal-sync) ──────────────
    // Standalone proposals (no lead_id from the UI) previously inserted
    // lead_id NULL, leaving the customer invisible in the Customers module
    // and email sends without a fallback recipient. Resolve-or-create the
    // lead first; on unexpected failure fall back to the old NULL behavior
    // rather than blocking proposal creation.
    let resolvedLeadId: string | null = lead_id || null
    let leadAutoCreated = false
    if (!resolvedLeadId && client_name) {
      const ensured = await ensureLeadForProposal({
        name : client_name,
        phone: client_phone ?? null,
        email: client_email ?? null,
      })
      if (ensured) {
        resolvedLeadId = ensured.leadId
        leadAutoCreated = ensured.created
      }
    }

    // Business Package Engine — inherit the lead's Business Package onto
    // this proposal when the caller didn't explicitly pick one. Safe-fill
    // only (same convention as the package_id auto-fill block above): never
    // overwrites an explicit business_package_id from the request body.
    if (!business_package_id && resolvedLeadId) {
      const { data: leadRow } = await supabaseAdmin
        .from('leads')
        .select('business_package_id')
        .eq('id', resolvedLeadId)
        .maybeSingle()
      business_package_id = leadRow?.business_package_id ?? null
    }

    // ── Insert ────────────────────────────────────────────────────────────
    const { data: proposal, error } = await supabaseAdmin
      .from('proposals')
      .insert({
        lead_id          : resolvedLeadId,
        client_name,
        client_phone,
        client_email,
        event_type,
        event_date       : parseEventDate(event_date) || null,
        event_time,
        guest_count      : guest_count ? parseInt(String(guest_count)) : null,
        venue,
        hall             : hall || null,
        package_name,
        package_id       : package_id || null,
        business_package_id: business_package_id || null,
        base_price       : Number(base_price) || 0,
        addons,
        addon_service_ids: addon_service_ids || [],
        room_items,                                    // ← stored as JSONB
        discount_amount  : Number(discount_amount) || 0,
        discount_reason  : discount_reason || null,
        total_price,
        advance_required,
        special_requirements : special_requirements || null,
        inclusions       : inclusions || null,
        ai_cover_note,
        status           : 'draft',
        share_token      : uuidv4().replace(/-/g, ''),
      })
      .select('*')
      .single()

    if (error) throw error

    // ── Activity log ──────────────────────────────────────────────────────
    if (resolvedLeadId) {
      await supabaseAdmin
        .from('leads')
        .update({ status: 'proposal_sent', proposal_sent_at: new Date().toISOString() })
        .eq('id', resolvedLeadId)

      await supabaseAdmin.from('activity_logs').insert({
        lead_id     : resolvedLeadId,
        action      : 'proposal_created',
        description : `Proposal ${proposal.proposal_number} created: ${package_name} — ₹${total_price.toLocaleString('en-IN')}${leadAutoCreated ? ' (customer record auto-created from proposal)' : ''}`,
        performed_by: 'admin',
      })

      // Business Package Engine — Customer Timeline requirement.
      if (business_package_id) {
        await logJourneyEvent(
          resolvedLeadId,
          JOURNEY_ACTIONS.BUSINESS_PACKAGE_ASSIGNED,
          'Proposal inherited Business Package',
          { proposalId: proposal.id, businessPackageId: business_package_id }
        )
      }
    }

    return NextResponse.json({ proposal }, { status: 201 })
  } catch (err) {
    logger.error('proposals', 'POST failed', err)
    return NextResponse.json({ error: 'Failed to create proposal' }, { status: 500 })
  }
}

// ─── PATCH ────────────────────────────────────────────────────────────────────

export async function PATCH(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  const supabaseAdmin = getSupabaseAdmin()
  try {
    const body = await req.json()
    const { id, ...updates } = body
    if (!id) return NextResponse.json({ error: 'Proposal ID required' }, { status: 400 })

    const { data: proposal, error } = await supabaseAdmin
      .from('proposals')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single()

    if (error) throw error

    if (updates.status === 'sent' && proposal.lead_id) {
      await supabaseAdmin.from('activity_logs').insert({
        lead_id     : proposal.lead_id,
        action      : 'proposal_sent',
        description : `Proposal ${proposal.proposal_number} sent to client`,
        performed_by: 'admin',
      })
    }

    return NextResponse.json({ proposal })
  } catch (err) {
    logger.error('proposals', 'PATCH failed', err)
    return NextResponse.json({ error: 'Failed to update proposal' }, { status: 500 })
  }
}

// ─── PUT (tracking actions) ───────────────────────────────────────────────────

export async function PUT(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  const supabaseAdmin = getSupabaseAdmin()
  try {
    const body = await req.json()
    const { id, token, action } = body

    if (!id && !token) return NextResponse.json({ error: 'id or token required' }, { status: 400 })

    const { data: proposal, error: fetchErr } = token
      ? await supabaseAdmin
          .from('proposals')
          .select('id, status, share_view_count, lead_id, proposal_number, sent_at, share_token, client_name, client_phone')
          .eq('share_token', token)
          .single()
      : await supabaseAdmin
          .from('proposals')
          .select('id, status, share_view_count, lead_id, proposal_number, sent_at, share_token, client_name, client_phone')
          .eq('id', id)
          .single()

    if (fetchErr || !proposal) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const now = new Date().toISOString()
    const updates: Record<string, unknown> = {}

    if (action === 'view') {
      updates.last_viewed_at  = now
      updates.share_view_count = (proposal.share_view_count || 0) + 1
      if (proposal.status === 'sent') { updates.status = 'viewed'; updates.viewed_at = now }
    }

    // Journey stage 2 (Customer Journey Automation, Priority 3): "Proposal
    // sent -> Reminder". This is the actual moment a proposal goes out —
    // the operator shares the wa.me/email link client-side and calls back
    // here; our own send-message infra was never in that path (confirmed:
    // WHATSAPP_MESSAGES.proposalFollowUp had zero callers repo-wide before
    // this). Only fires on the draft->sent transition, not on repeat
    // shares of an already-sent proposal, so re-clicking "share" doesn't
    // stack up duplicate reminders.
    const isFirstSend = proposal.status === 'draft'

    if (action === 'whatsapp_sent') {
      updates.whatsapp_sent_at = now
      if (isFirstSend) { updates.status = 'sent'; updates.sent_at = now }
      if (proposal.lead_id) {
        await supabaseAdmin.from('activity_logs').insert({
          lead_id     : proposal.lead_id,
          action      : 'proposal_whatsapp_sent',
          description : `Proposal ${proposal.proposal_number} shared via WhatsApp`,
          performed_by: 'admin',
        })
      }
    }

    if (action === 'email_sent') {
      updates.email_sent_at = now
      if (isFirstSend) { updates.status = 'sent'; updates.sent_at = now }
      if (proposal.lead_id) {
        await supabaseAdmin.from('activity_logs').insert({
          lead_id     : proposal.lead_id,
          action      : 'proposal_email_sent',
          description : `Proposal ${proposal.proposal_number} shared via email`,
          performed_by: 'admin',
        })
      }
    }

    if (isFirstSend && (action === 'whatsapp_sent' || action === 'email_sent') && proposal.client_phone) {
      const shareUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://bookmyspaces.in'}/proposals/share/${proposal.share_token}`
      await enqueueMessage({
        phone: proposal.client_phone,
        message: WHATSAPP_MESSAGES.proposalFollowUp(proposal.client_name ?? undefined, proposal.proposal_number, shareUrl),
        type: 'session',
        scheduled_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
        metadata: { journey: 'proposal_reminder', proposal_id: proposal.id, lead_id: proposal.lead_id },
      })
    }

    await supabaseAdmin.from('proposals').update(updates).eq('id', proposal.id)
    return NextResponse.json({ success: true })
  } catch (err) {
    logger.error('proposals', 'Track event failed', err)
    return NextResponse.json({ error: 'Tracking failed' }, { status: 500 })
  }
}
