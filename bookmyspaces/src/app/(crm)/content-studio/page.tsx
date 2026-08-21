'use client'

// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/(crm)/content-studio/page.tsx
// Step 2.3 — Content Studio v1: list + create ONLY.
//
// Talks to the Step 2.2 API (/api/social/posts). Deliberate non-scope, per
// task: no editing, no deleting, no publishing, no AI captioning. Posts are
// created as drafts, or as scheduled when a future date is picked — the
// status column shows where each post sits in the (future) pipeline.
// Styling follows the Catalog / AI Knowledge pages.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  PenSquare, Plus, X, Save, RefreshCw, AlertCircle, CalendarClock,
  FileText, Image as ImageIcon, Hash, Link2, Sparkles,
} from 'lucide-react'

interface SocialPost {
  id: string
  created_at: string
  platform: string
  post_type: string
  content: string | null
  media: { url: string; type: string }[]
  hashtags: string[]
  status: 'draft' | 'review' | 'approved' | 'scheduled' | 'publishing' | 'published' | 'failed'
  scheduled_at: string | null
  published_at: string | null
  created_by: string | null
  headline: string | null
}

interface CatalogPackage {
  id: string
  name: string
  venue: string
  is_active: boolean
}

interface MediaAsset {
  id: string
  public_url: string
  original_filename: string | null
  venue_tag: string | null
  asset_type: string
  source: 'human' | 'ai'
}

const VENUE_TAG_LABELS: Record<string, string> = {
  rooftop: 'Rooftop', cafe: 'Café', rooms: 'Rooms', hall: 'Hall',
  private_dining: 'Private Dining', property: 'Property', general: 'General',
}

const PLATFORMS = [
  { value: 'facebook', label: 'Facebook' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'google_business', label: 'Google Business' },
  { value: 'x', label: 'X (Twitter)' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'threads', label: 'Threads' },
]

// Facebook/Instagram connector recovery — platforms with a real OAuth flow
// (src/lib/social/oauth/oauth-config.ts's OAUTH_CONFIGS keys). Everything
// else in PLATFORMS has no OAuth config and shows no Connect button.
const OAUTH_CAPABLE_PLATFORMS = new Set(['facebook', 'instagram'])

const STATUS_STYLES: Record<SocialPost['status'], string> = {
  draft: 'bg-gray-100 text-gray-600',
  review: 'bg-indigo-50 text-indigo-700',
  approved: 'bg-blue-50 text-blue-700',
  scheduled: 'bg-amber-50 text-amber-700',
  publishing: 'bg-purple-50 text-purple-700',
  published: 'bg-green-50 text-green-700',
  failed: 'bg-red-50 text-red-700',
}

// Catalog → AI Content Studio, Phase 2 — only these two platforms have a
// grounded AI generator (src/lib/ai/content-generator.ts mirrors
// OAUTH_CAPABLE_PLATFORMS above, same reason: those are the two platforms
// this app actually has a real integration for).
const AI_CAPABLE_PLATFORMS = new Set(['facebook', 'instagram'])

const STATUS_FILTERS = ['', 'draft', 'scheduled', 'published', 'failed'] as const

export default function ContentStudioPage() {
  const [posts, setPosts] = useState<SocialPost[]>([])
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  // form state
  const [platform, setPlatform] = useState('facebook')
  const [content, setContent] = useState('')
  const [mediaUrl, setMediaUrl] = useState('')
  const [hashtags, setHashtags] = useState('')
  const [scheduleAt, setScheduleAt] = useState('')

  // Catalog → AI Content Studio, Phase 2
  const [packages, setPackages] = useState<CatalogPackage[]>([])
  const [selectedPackageId, setSelectedPackageId] = useState('')
  const [generating, setGenerating] = useState(false)
  const [headline, setHeadline] = useState('')
  const [ctaText, setCtaText] = useState('')
  const [imageConcept, setImageConcept] = useState('')
  const [targetAudience, setTargetAudience] = useState<string[]>([])

  const [mediaAssets, setMediaAssets] = useState<MediaAsset[]>([])
  const [selectedAssetId, setSelectedAssetId] = useState('')

  useEffect(() => {
    fetch('/api/admin/catalog/packages')
      .then((res) => (res.ok ? res.json() : { rows: [] }))
      .then((json) => setPackages((json.rows ?? []).filter((p: CatalogPackage) => p.is_active)))
      .catch(() => setPackages([]))

    fetch('/api/media-assets')
      .then((res) => (res.ok ? res.json() : { assets: [] }))
      .then((json) => setMediaAssets(json.assets ?? []))
      .catch(() => setMediaAssets([]))
  }, [])

  function handlePickAsset(assetId: string) {
    setSelectedAssetId(assetId)
    const asset = mediaAssets.find((a) => a.id === assetId)
    if (asset) setMediaUrl(asset.public_url)
  }

  async function handleGenerate() {
    if (!selectedPackageId) {
      toast.error('Pick a catalog package first.')
      return
    }
    setGenerating(true)
    try {
      const res = await fetch('/api/social/posts/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageId: selectedPackageId, platform }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || `Generation failed (${res.status})`)

      const c = json.content as {
        headline: string; caption: string; ctaText: string
        hashtags: string[]; imageConcept: string; targetAudience: string[]
      }
      setContent(c.caption)
      setHashtags(c.hashtags.join(', '))
      setHeadline(c.headline)
      setCtaText(c.ctaText)
      setImageConcept(c.imageConcept)
      setTargetAudience(c.targetAudience)
      toast.success('Draft generated — review before saving.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to generate content')
    } finally {
      setGenerating(false)
    }
  }

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/social/posts${statusFilter ? `?status=${statusFilter}` : ''}`)
      if (!res.ok) throw new Error(String(res.status))
      setPosts((await res.json()).posts ?? [])
    } catch {
      setError('Failed to load posts.')
    } finally {
      setLoading(false)
    }
  }, [statusFilter])

  useEffect(() => { load() }, [load])

  // Facebook/Instagram connector recovery — the OAuth callback
  // (src/app/api/social/oauth/[platform]/callback) redirects back here
  // with ?oauth=success|error&platform=&detail=. Surface it once, then
  // clean the URL so a page refresh doesn't re-show a stale toast.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const oauthStatus = params.get('oauth')
    if (!oauthStatus) return

    const platformLabel = PLATFORMS.find((p) => p.value === params.get('platform'))?.label ?? params.get('platform') ?? 'account'
    if (oauthStatus === 'success') {
      toast.success(`${platformLabel} connected.`)
    } else {
      toast.error(`Failed to connect ${platformLabel}${params.get('detail') ? `: ${params.get('detail')}` : ''}`)
    }
    window.history.replaceState({}, '', window.location.pathname)
  }, [])

  function resetForm() {
    setPlatform('facebook'); setContent(''); setMediaUrl(''); setHashtags(''); setScheduleAt('')
    setSelectedPackageId(''); setHeadline(''); setCtaText(''); setImageConcept(''); setTargetAudience([]); setSelectedAssetId('')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const tags = hashtags
        .split(/[,\s]+/)
        .map((t) => t.replace(/^#/, '').trim())
        .filter(Boolean)

      const body: Record<string, unknown> = {
        platform,
        post_type: mediaUrl.trim() ? 'image' : 'text',
        content: content.trim() || null,
        ...(mediaUrl.trim() ? { media: [{ url: mediaUrl.trim(), type: 'image' }] } : {}),
        ...(tags.length ? { hashtags: tags } : {}),
        ...(scheduleAt ? { scheduled_at: new Date(scheduleAt).toISOString() } : {}),
        ...(selectedPackageId ? { package_id: selectedPackageId } : {}),
        ...(headline.trim() ? { headline: headline.trim() } : {}),
        ...(ctaText.trim() ? { cta_text: ctaText.trim() } : {}),
        ...(imageConcept.trim() ? { image_concept: imageConcept.trim() } : {}),
        ...(targetAudience.length ? { target_audience: targetAudience } : {}),
      }

      const res = await fetch('/api/social/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        const detail = Array.isArray(json?.issues)
          ? json.issues.map((i: { path: string; message: string }) => `${i.path}: ${i.message}`).join('; ')
          : json?.error
        throw new Error(detail || `Save failed (${res.status})`)
      }

      toast.success(json.post?.status === 'scheduled'
        ? `Post scheduled for ${new Date(json.post.scheduled_at).toLocaleString()}.`
        : 'Draft saved.')
      resetForm()
      setFormOpen(false)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save post')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
              <PenSquare className="w-5 h-5" /> Content Studio
            </h1>
            <p className="text-sm text-gray-500">
              Draft and schedule social posts, or generate one from a real catalog package. Publishing arrives in a later step.
            </p>
          </div>
          <button
            onClick={() => setFormOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
          >
            <Plus className="w-4 h-4" /> New Post
          </button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex gap-1">
            {STATUS_FILTERS.map((v) => (
              <button
                key={v}
                onClick={() => setStatusFilter(v)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium capitalize ${
                  statusFilter === v ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                {v || 'All'}
              </button>
            ))}
          </div>
          <button onClick={load} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>

        {error && (
          <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4">
            <AlertCircle className="w-4 h-4 shrink-0" /> {error}
          </div>
        )}

        {/* Facebook/Instagram connector recovery — OAuth requires that
            platform's app credentials (META_APP_ID/META_APP_SECRET,
            already live for the existing Meta integration) to be set; if
            they aren't, the start route returns a clear error instead of a
            broken redirect. */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="text-xs text-gray-400">Connect:</span>
          {PLATFORMS.filter((p) => OAUTH_CAPABLE_PLATFORMS.has(p.value)).map((p) => (
            <a
              key={p.value}
              href={`/api/social/oauth/${p.value}/start`}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-lg text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              <Link2 className="w-3.5 h-3.5" /> {p.label}
            </a>
          ))}
        </div>

        {/* Create form */}
        {formOpen && (
          <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-blue-200 p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-gray-900">New Post</h2>
              <button type="button" onClick={() => setFormOpen(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Platform<span className="text-red-500 ml-0.5">*</span></label>
                <select
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {PLATFORMS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <span className="inline-flex items-center gap-1"><CalendarClock className="w-3.5 h-3.5" /> Schedule Date</span>
                </label>
                <input
                  type="datetime-local"
                  value={scheduleAt}
                  onChange={(e) => setScheduleAt(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-400 mt-1">Leave empty to save as a draft</p>
              </div>
            </div>

            {AI_CAPABLE_PLATFORMS.has(platform) && (
              <div className="mb-4 flex items-end gap-2 bg-indigo-50 border border-indigo-100 rounded-lg p-3">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Generate from catalog item
                  </label>
                  <select
                    value={selectedPackageId}
                    onChange={(e) => setSelectedPackageId(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select a package…</option>
                    {packages.map((p) => (
                      <option key={p.id} value={p.id}>{p.name} — {p.venue}</option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={generating || !selectedPackageId}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-60 shrink-0"
                >
                  {generating
                    ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    : <Sparkles className="w-4 h-4" />}
                  {generating ? 'Generating…' : 'Generate with AI'}
                </button>
              </div>
            )}

            {headline && (
              <div className="mb-4 text-xs text-indigo-700 bg-indigo-50/60 rounded-lg px-3 py-2">
                <span className="font-medium">Headline:</span> {headline}
                {ctaText && <> · <span className="font-medium">CTA:</span> {ctaText}</>}
                {targetAudience.length > 0 && <> · <span className="font-medium">Audience:</span> {targetAudience.join(', ')}</>}
                {imageConcept && <div className="mt-1"><span className="font-medium">Image idea:</span> {imageConcept}</div>}
              </div>
            )}

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Content</label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={4}
                placeholder="Write the post… (content and/or a media URL is required)"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <span className="inline-flex items-center gap-1"><ImageIcon className="w-3.5 h-3.5" /> Media URL</span>
                </label>
                <input
                  type="url"
                  value={mediaUrl}
                  onChange={(e) => { setMediaUrl(e.target.value); setSelectedAssetId('') }}
                  placeholder="https://…"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {mediaAssets.length > 0 && (
                  <select
                    value={selectedAssetId}
                    onChange={(e) => handlePickAsset(e.target.value)}
                    className="w-full mt-1.5 px-3 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">…or pick from media library ({mediaAssets.length})</option>
                    {mediaAssets.map((a) => (
                      <option key={a.id} value={a.id}>
                        {VENUE_TAG_LABELS[a.venue_tag ?? ''] ?? a.venue_tag} — {a.asset_type} — {a.original_filename} {a.source === 'ai' ? '(AI)' : ''}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <span className="inline-flex items-center gap-1"><Hash className="w-3.5 h-3.5" /> Hashtags</span>
                </label>
                <input
                  value={hashtags}
                  onChange={(e) => setHashtags(e.target.value)}
                  placeholder="wedding, banquet, kolkata"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-400 mt-1">Comma or space separated; # optional</p>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-5">
              <button type="button" onClick={() => setFormOpen(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60"
              >
                {saving
                  ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  : <Save className="w-4 h-4" />}
                {saving ? 'Saving…' : scheduleAt ? 'Schedule Post' : 'Save Draft'}
              </button>
            </div>
          </form>
        )}

        {/* Post list */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-sm text-gray-500">Loading…</div>
          ) : posts.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-500">
              No posts yet. Use “New Post” to draft or schedule your first one.
            </div>
          ) : (
            <ul className="divide-y divide-gray-50">
              {posts.map((post) => (
                <li key={post.id} className="px-5 py-4 hover:bg-gray-50">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-medium text-gray-500">
                          {PLATFORMS.find((p) => p.value === post.platform)?.label ?? post.platform}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${STATUS_STYLES[post.status]}`}>
                          {post.status}
                        </span>
                        {post.post_type !== 'text' && (
                          <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                            <ImageIcon className="w-3 h-3" /> {post.post_type}
                          </span>
                        )}
                        {post.scheduled_at && (
                          <span className="inline-flex items-center gap-1 text-xs text-amber-600">
                            <CalendarClock className="w-3 h-3" /> {new Date(post.scheduled_at).toLocaleString()}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-800 mt-1 whitespace-pre-wrap break-words line-clamp-3">
                        {post.content || <span className="text-gray-400 italic">No text — media-only post</span>}
                      </p>
                      {post.hashtags.length > 0 && (
                        <p className="text-xs text-blue-600 mt-1 truncate">
                          {post.hashtags.map((t) => `#${t}`).join(' ')}
                        </p>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-xs text-gray-400 flex items-center gap-1 justify-end">
                        <FileText className="w-3 h-3" /> {new Date(post.created_at).toLocaleDateString()}
                      </p>
                      {post.created_by && <p className="text-[11px] text-gray-300 mt-0.5">{post.created_by}</p>}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
