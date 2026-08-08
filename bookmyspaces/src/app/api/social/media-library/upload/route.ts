// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/api/social/media-library/upload/route.ts
// Content Operations Priority 5 — actual file upload (not just registering
// an already-hosted URL, which is all POST /api/social/media-library did
// before this). Repo-wide search found no existing Supabase Storage usage
// anywhere in this codebase to reuse — this is new, but it is the standard
// Supabase JS Storage call (service-role client already used everywhere
// else via getSupabaseAdmin()), not a new architecture or third-party
// dependency.
//
// DEPLOYMENT NOTE (disclosed, not silently assumed): the storage bucket
// (`social-media`, public read) must exist before this route works —
// Supabase Storage buckets are created via the Dashboard or Management API,
// not a SQL migration, so there is no migration file for it. See this
// sprint's deployment checklist.
//
// Accepts multipart/form-data with a single `file` field (image or video,
// <= 25MB). Uploads to Storage, then inserts a media_library row with the
// resulting public URL — same row shape POST /api/social/media-library
// already writes for a pasted URL, so every existing reader of
// media_library (Content Studio picker, best-image recommender) works
// unchanged.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth-guard'

const BUCKET = 'social-media'
const MAX_BYTES = 25 * 1024 * 1024
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/quicktime']

export async function POST(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  try {
    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'file is required (multipart/form-data field "file")' }, { status: 400 })
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: `File too large — max ${MAX_BYTES / (1024 * 1024)}MB` }, { status: 400 })
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: `Unsupported file type: ${file.type}` }, { status: 400 })
    }

    const db = getSupabaseAdmin()
    const ext = file.name.includes('.') ? file.name.split('.').pop() : (file.type.split('/')[1] ?? 'bin')
    const path = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${ext}`

    const arrayBuffer = await file.arrayBuffer()
    const { error: uploadError } = await db.storage.from(BUCKET).upload(path, arrayBuffer, {
      contentType: file.type,
      upsert: false,
    })
    if (uploadError) {
      logger.error('media-library/upload', 'storage upload failed', uploadError)
      return NextResponse.json(
        { error: `Upload failed: ${uploadError.message}. If this says the bucket does not exist, create a public bucket named "${BUCKET}" in Supabase Storage first (see deployment checklist).` },
        { status: 500 }
      )
    }

    const { data: publicUrlData } = db.storage.from(BUCKET).getPublicUrl(path)

    const { data: media, error: insertError } = await db
      .from('media_library')
      .insert({
        url: publicUrlData.publicUrl,
        media_type: file.type.startsWith('video') ? 'video' : 'image',
        label: file.name || null,
        tags: [],
      })
      .select('*')
      .single()

    if (insertError) {
      logger.error('media-library/upload', 'media_library insert failed', insertError)
      return NextResponse.json({ error: 'File uploaded but failed to register in media library' }, { status: 500 })
    }

    return NextResponse.json({ media }, { status: 201 })
  } catch (err) {
    logger.error('media-library/upload', 'POST failed', err)
    return NextResponse.json({ error: 'Failed to upload file' }, { status: 500 })
  }
}
