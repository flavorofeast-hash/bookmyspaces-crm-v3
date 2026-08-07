// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/api/reviews/route.ts
// Growth Engine Epic 1 — Review Engine.
//
// GET  ?view=analytics  → computeReviewAnalytics() (reviews + review_requests)
// GET  (default)        → list reviews, newest first
// POST                  → manual review entry (no external review API exists —
//                          see src/lib/reviews.ts header) OR action-based:
//                          { action: 'generate_reply', id } drafts an AI reply
// PATCH                 → update a review (approve/edit response_draft, mark
//                          response_status, link review_id back to a
//                          review_requests row)
//
// Same requireAuth() + getSupabaseAdmin() pattern as every other route.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth-guard'
import { generateReviewReplyDraft, computeReviewAnalytics } from '@/lib/reviews'
import { logJourneyEvent, JOURNEY_ACTIONS } from '@/lib/customers/journey'

export async function GET(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  const db = getSupabaseAdmin()
  try {
    const view = req.nextUrl.searchParams.get('view')
    if (view === 'analytics') {
      return NextResponse.json({ analytics: await computeReviewAnalytics() })
    }

    const { data, error } = await db
      .from('reviews')
      .select('*')
      .order('review_date', { ascending: false, nullsFirst: false })
      .limit(200)
    if (error) throw error
    return NextResponse.json({ reviews: data ?? [] })
  } catch (err) {
    logger.error('reviews', 'GET failed', err)
    return NextResponse.json({ error: 'Failed to fetch reviews' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  const db = getSupabaseAdmin()
  try {
    const body = await req.json()
    const { action, id } = body as { action?: string; id?: string }

    if (action === 'generate_reply') {
      if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
      const { data: review, error } = await db.from('reviews').select('rating, content, author_name').eq('id', id).single()
      if (error || !review) return NextResponse.json({ error: 'Review not found' }, { status: 404 })

      const draft = await generateReviewReplyDraft({ rating: review.rating, content: review.content, authorName: review.author_name })
      const { data: updated, error: updateError } = await db
        .from('reviews')
        .update({ response_draft: draft, response_status: 'drafted' })
        .eq('id', id)
        .select('*')
        .single()
      if (updateError) throw updateError
      return NextResponse.json({ review: updated })
    }

    // Manual review entry — see this route's header comment: no external
    // review-fetching API exists yet, so this is the only way `reviews`
    // gets populated. The operator saw the review on Google/Facebook/etc.
    // and is logging it here.
    const { platform, external_id, author_name, rating, content, review_date, customer_id, reservation_id } = body as {
      platform?: string; external_id?: string; author_name?: string; rating?: number
      content?: string; review_date?: string; customer_id?: string; reservation_id?: string
    }
    if (!platform || !['google', 'facebook', 'booking', 'other'].includes(platform)) {
      return NextResponse.json({ error: 'platform must be one of google, facebook, booking, other' }, { status: 400 })
    }

    const { data, error } = await db
      .from('reviews')
      .insert({
        platform,
        external_id: external_id || null,
        author_name: author_name || null,
        rating: typeof rating === 'number' ? rating : null,
        content: content || null,
        review_date: review_date || new Date().toISOString(),
        customer_id: customer_id || null,
        reservation_id: reservation_id || null,
      })
      .select('*')
      .single()
    if (error) throw error

    // Best-effort: if this review is linked to a reservation with an open
    // review_requests row, close the loop automatically.
    if (reservation_id) {
      try {
        await db
          .from('review_requests')
          .update({ status: 'completed', review_id: data.id })
          .eq('reservation_id', reservation_id)
          .in('status', ['requested', 'reminded'])
      } catch {
        // non-fatal
      }
    }
    // Growth Engine Epic 4 — journey event, best-effort.
    if (customer_id) {
      await logJourneyEvent(customer_id, JOURNEY_ACTIONS.REVIEW_COMPLETED, `Review logged (${platform}${typeof rating === 'number' ? `, ${rating}/5` : ''})`, { reviewId: data.id })
    }

    return NextResponse.json({ review: data }, { status: 201 })
  } catch (err) {
    logger.error('reviews', 'POST failed', err)
    return NextResponse.json({ error: 'Failed to save review' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  const db = getSupabaseAdmin()
  try {
    const body = await req.json()
    const { id, ...rawUpdates } = body as { id?: string; [k: string]: unknown }
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    // Allow-list: this route is auth-gated (staff only), but still only
    // accepts the fields the Reviews page actually edits — never platform/
    // external_id/customer_id/reservation_id/created_at, which are set once
    // at creation (POST above) and should not silently change via PATCH.
    const updates: Record<string, unknown> = {}
    if ('response_draft' in rawUpdates) updates.response_draft = rawUpdates.response_draft
    if ('response_status' in rawUpdates) updates.response_status = rawUpdates.response_status
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No updatable fields provided (response_draft, response_status)' }, { status: 400 })
    }
    if (updates.response_status === 'posted') updates.responded_at = new Date().toISOString()

    const { data, error } = await db.from('reviews').update(updates).eq('id', id).select('*').single()
    if (error) throw error
    return NextResponse.json({ review: data })
  } catch (err) {
    logger.error('reviews', 'PATCH failed', err)
    return NextResponse.json({ error: 'Failed to update review' }, { status: 500 })
  }
}
