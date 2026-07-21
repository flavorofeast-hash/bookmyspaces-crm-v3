// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/api/social/webhook/[platform]/route.ts
// V3 Phase 5 — social platform webhook entry point (credential-ready).
//
// GET: Meta's hub.challenge verification handshake (same flow as the
// existing WhatsApp webhook).
// POST: signature-verified via the platform adapter, then every parsed
// comment/mention is idempotently ingested into social_interactions.
//
// PUBLIC ROUTE (documented allowlist entry): webhooks can't authenticate
// with a CRM session — security is the platform HMAC signature, verified
// before the body is trusted, exactly like /api/whatsapp/webhook.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { getSocialAdapter } from '@/lib/social/adapter-registry'
import { ingestInteraction } from '@/lib/social/interaction-service'
import { checkRateLimit, clientIpFrom } from '@/lib/rate-limit'

export async function GET(req: Request, { params }: { params: { platform: string } }) {
  const url = new URL(req.url)
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')

  if (mode === 'subscribe' && token && token === process.env.META_VERIFY_TOKEN && challenge) {
    return new Response(challenge, { status: 200 })
  }
  return NextResponse.json({ error: 'Verification failed' }, { status: 403 })
}

export async function POST(req: Request, { params }: { params: { platform: string } }) {
  const rl = checkRateLimit(`social-webhook:${clientIpFrom(req)}`, { limit: 120, windowMs: 60_000 })
  if (!rl.allowed) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } })
  }

  const adapter = getSocialAdapter(params.platform)
  if (!adapter) {
    return NextResponse.json({ error: `No adapter for platform "${params.platform}"` }, { status: 404 })
  }

  const rawBody = await req.text()

  const verified = await adapter.verifyWebhook(req, rawBody)
  if (!verified) {
    logger.warn('social-webhook', `rejected unverified ${params.platform} webhook`)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  try {
    const payload = JSON.parse(rawBody) as Record<string, unknown>
    const interactions = adapter.parseWebhook(payload)
    let ingested = 0
    for (const interaction of interactions) {
      const result = await ingestInteraction(interaction)
      if (result.ok && !result.duplicate) ingested++
    }
    // Always 200 to the platform — retries are managed by idempotent ingest.
    return NextResponse.json({ received: interactions.length, ingested })
  } catch (err) {
    logger.error('social-webhook', `${params.platform} webhook processing failed`, err)
    return NextResponse.json({ received: 0 }, { status: 200 })
  }
}
