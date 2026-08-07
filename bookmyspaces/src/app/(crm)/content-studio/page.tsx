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
  FileText, Image as ImageIcon, Hash, Sparkles, Loader2, Link2, BarChart3,
} from 'lucide-react'

interface SocialPost {
  id: string
  created_at: string
  platform: string
  post_type: string
  content: string | null
  media: { url: string; type: string }[]
  hashtags: string[]
  status: 'draft' | 'approved' | 'scheduled' | 'publishing' | 'published' | 'failed'
  scheduled_at: string | null
  published_at: string | null
  created_by: string | null
  // Growth Engine Epic 5 — Social Publishing.
  failure_reason: string | null
  publish_attempts: number
}

interface MessageTemplate {
  id: string
  name: string
  channel: 'whatsapp' | 'email'
  category: string | null
  subject: string | null
  body: string
  use_count: number
}

interface MediaItem {
  id: string
  url: string
  media_type: 'image' | 'video'
  label: string | null
  tags: string[]
  use_count: number
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

const STATUS_STYLES: Record<SocialPost['status'], string> = {
  draft: 'bg-gray-100 text-gray-600',
  approved: 'bg-blue-50 text-blue-700',
  scheduled: 'bg-amber-50 text-amber-700',
  publishing: 'bg-purple-50 text-purple-700',
  published: 'bg-green-50 text-green-700',
  failed: 'bg-red-50 text-red-700',
}

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

  // Growth Platform Phase 3 — AI Content Studio (Google Business Post
  // Generator + Social Media Content Generator). Drafts only, never posts.
  const [aiGoal, setAiGoal] = useState('')
  const [aiGenerating, setAiGenerating] = useState(false)

  async function handleAiGenerate() {
    if (!aiGoal.trim()) return
    setAiGenerating(true)
    try {
      const res = await fetch('/api/social/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, goal: aiGoal.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Failed to generate draft')
        return
      }
      setContent(data.draft.content)
      setHashtags(data.draft.hashtags.join(', '))
    } catch {
      toast.error('Failed to generate draft')
    } finally {
      setAiGenerating(false)
    }
  }

  // Phase 2 (Social Growth) — standalone AI Hashtag Generator + AI Image
  // Prompt Generator, alongside the combined draft generator above.
  const [aiHashtagGenerating, setAiHashtagGenerating] = useState(false)
  const [aiImageGenerating, setAiImageGenerating] = useState(false)
  const [aiImagePrompt, setAiImagePrompt] = useState('')

  async function handleGenerateHashtags() {
    const topic = aiGoal.trim() || content.trim()
    if (!topic) return
    setAiHashtagGenerating(true)
    try {
      const res = await fetch('/api/social/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, goal: topic, type: 'hashtags' }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'Failed to generate hashtags'); return }
      setHashtags((Array.isArray(data.hashtags) ? data.hashtags : []).join(', '))
    } catch {
      toast.error('Failed to generate hashtags')
    } finally {
      setAiHashtagGenerating(false)
    }
  }

  async function handleGenerateImagePrompt() {
    if (!aiGoal.trim()) return
    setAiImageGenerating(true)
    try {
      const res = await fetch('/api/social/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, goal: aiGoal.trim(), type: 'image_prompt' }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'Failed to generate image prompt'); return }
      setAiImagePrompt(data.imagePrompt || '')
    } catch {
      toast.error('Failed to generate image prompt')
    } finally {
      setAiImageGenerating(false)
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

  // Growth Engine Epic 5 — Social Publishing. 'publish' also covers retry:
  // calling it again on a 'failed' post is the retry, not a separate action.
  const [actioningId, setActioningId] = useState<string | null>(null)

  async function handlePostAction(postId: string, action: 'approve' | 'publish') {
    setActioningId(postId)
    try {
      const res = await fetch('/api/social/posts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: postId, action }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error || `Failed to ${action} post`)
        await load() // refresh — a failed publish attempt still updates status/failure_reason
        return
      }
      toast.success(action === 'publish' ? 'Post published.' : 'Post approved.')
      await load()
    } catch {
      toast.error(`Failed to ${action} post`)
    } finally {
      setActioningId(null)
    }
  }

  function resetForm() {
    setPlatform('facebook'); setContent(''); setMediaUrl(''); setHashtags(''); setScheduleAt('')
  }

  // Growth Platform Phase 3 — Message Templates (WhatsApp + Email). Content-
  // only for email (no send path exists yet); WhatsApp templates are also
  // loadable from the Campaigns page.
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [templates, setTemplates] = useState<MessageTemplate[]>([])
  const [templatesLoading, setTemplatesLoading] = useState(false)
  const [tplName, setTplName] = useState('')
  const [tplChannel, setTplChannel] = useState<'whatsapp' | 'email'>('whatsapp')
  const [tplSubject, setTplSubject] = useState('')
  const [tplBody, setTplBody] = useState('')
  const [tplSaving, setTplSaving] = useState(false)

  const loadTemplates = useCallback(async () => {
    setTemplatesLoading(true)
    try {
      const res = await fetch('/api/marketing/templates')
      const data = await res.json()
      setTemplates(Array.isArray(data.templates) ? data.templates : [])
    } catch {
      setTemplates([])
    } finally {
      setTemplatesLoading(false)
    }
  }, [])

  useEffect(() => { if (templatesOpen) loadTemplates() }, [templatesOpen, loadTemplates])

  async function handleSaveTemplate(e: React.FormEvent) {
    e.preventDefault()
    if (!tplName.trim() || !tplBody.trim()) return
    setTplSaving(true)
    try {
      const res = await fetch('/api/marketing/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: tplName.trim(), channel: tplChannel, subject: tplChannel === 'email' ? tplSubject.trim() : undefined, body: tplBody.trim() }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'Failed to save template'); return }
      toast.success('Template saved.')
      setTplName(''); setTplSubject(''); setTplBody('')
      await loadTemplates()
    } finally {
      setTplSaving(false)
    }
  }

  async function handleDeleteTemplate(id: string) {
    if (!window.confirm('Delete this template?')) return
    await fetch(`/api/marketing/templates?id=${id}`, { method: 'DELETE' })
    setTemplates((p) => p.filter((t) => t.id !== id))
  }

  // Growth Platform Phase 4 — Media Library. Reference-only (no file
  // upload/storage integration) — see migration 032's header comment.
  const [mediaLibrary, setMediaLibrary] = useState<MediaItem[]>([])
  const [selectedMediaId, setSelectedMediaId] = useState('')

  useEffect(() => {
    fetch('/api/social/media-library')
      .then((res) => res.json())
      .then((data) => setMediaLibrary(Array.isArray(data.media) ? data.media : []))
      .catch(() => setMediaLibrary([]))
  }, [])

  function handlePickMedia(id: string) {
    setSelectedMediaId(id)
    const item = mediaLibrary.find((m) => m.id === id)
    if (!item) return
    setMediaUrl(item.url)
    fetch('/api/social/media-library', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action: 'mark_used' }),
    }).catch(() => {})
  }

  async function handleSaveToLibrary() {
    if (!mediaUrl.trim()) return
    const label = window.prompt('Label this media (optional):') || undefined
    const res = await fetch('/api/social/media-library', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: mediaUrl.trim(), label }),
    })
    const data = await res.json()
    if (data.media) {
      setMediaLibrary((p) => [data.media, ...p])
      toast.success('Saved to media library.')
    }
  }

  // Phase 2 (Social Growth) — Multi-account management (social_accounts,
  // migration 014). Credential entry only — connecting a real OAuth flow
  // per platform is a future step; this lets an operator register an
  // account + paste in a token once one exists.
  interface SocialAccount {
    id: string
    platform: string
    display_name: string
    external_account_id: string | null
    status: 'disconnected' | 'connected' | 'token_expired' | 'error'
    is_active: boolean
  }
  const [accountsOpen, setAccountsOpen] = useState(false)
  const [accounts, setAccounts] = useState<SocialAccount[]>([])
  const [accountsLoading, setAccountsLoading] = useState(false)
  const [acctPlatform, setAcctPlatform] = useState('facebook')
  const [acctDisplayName, setAcctDisplayName] = useState('')
  const [acctExternalId, setAcctExternalId] = useState('')
  const [acctToken, setAcctToken] = useState('')
  const [acctSaving, setAcctSaving] = useState(false)

  const loadAccounts = useCallback(async () => {
    setAccountsLoading(true)
    try {
      const res = await fetch('/api/social/accounts')
      const data = await res.json()
      setAccounts(Array.isArray(data.accounts) ? data.accounts : [])
    } catch {
      setAccounts([])
    } finally {
      setAccountsLoading(false)
    }
  }, [])

  useEffect(() => { if (accountsOpen) loadAccounts() }, [accountsOpen, loadAccounts])

  async function handleSaveAccount(e: React.FormEvent) {
    e.preventDefault()
    if (!acctDisplayName.trim()) return
    setAcctSaving(true)
    try {
      const res = await fetch('/api/social/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: acctPlatform,
          display_name: acctDisplayName.trim(),
          ...(acctExternalId.trim() ? { external_account_id: acctExternalId.trim() } : {}),
          ...(acctToken.trim() ? { access_token: acctToken.trim() } : {}),
        }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'Failed to save account'); return }
      toast.success('Account saved.')
      setAcctDisplayName(''); setAcctExternalId(''); setAcctToken('')
      await loadAccounts()
    } finally {
      setAcctSaving(false)
    }
  }

  async function handleToggleAccountActive(id: string, isActive: boolean) {
    const res = await fetch('/api/social/accounts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, is_active: !isActive }),
    })
    if (res.ok) await loadAccounts()
    else toast.error('Failed to update account')
  }

  // Phase 2 (Social Growth) — Engagement Analytics, fetched lazily per post
  // (not bundled into the posts list response, to keep that endpoint cheap
  // for the common case where nobody is looking at metrics right now).
  interface PostMetricsView {
    reach: number | null; impressions: number | null; clicks: number | null
    likes: number | null; comments: number | null; shares: number | null; saves: number | null
  }
  const [metricsByPost, setMetricsByPost] = useState<Record<string, PostMetricsView | null>>({})
  const [metricsLoadingId, setMetricsLoadingId] = useState<string | null>(null)

  async function handleViewMetrics(postId: string) {
    setMetricsLoadingId(postId)
    try {
      const res = await fetch(`/api/social/metrics?post_id=${postId}`)
      const data = await res.json()
      setMetricsByPost((p) => ({ ...p, [postId]: data.metrics ?? null }))
    } finally {
      setMetricsLoadingId(null)
    }
  }

  async function handleSyncMetrics(postId: string) {
    setMetricsLoadingId(postId)
    try {
      const res = await fetch('/api/social/metrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId, action: 'sync' }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Sync failed — no adapter configured for this platform yet')
        return
      }
      setMetricsByPost((p) => ({ ...p, [postId]: data.metrics }))
      toast.success('Metrics synced.')
    } finally {
      setMetricsLoadingId(null)
    }
  }

  // Growth Platform Phase 4 — Content Calendar. Pure view over the same
  // `posts` array already fetched by load() above — no new API, no new
  // data, just a second rendering mode grouped by scheduled date instead
  // of a flat list.
  const [calendarView, setCalendarView] = useState(false)
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const d = new Date()
    return { year: d.getFullYear(), month: d.getMonth() }
  })

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
              Draft and schedule social posts, with AI-generated captions. Publishing arrives in a later step.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCalendarView((v) => !v)}
              className="flex items-center gap-2 px-4 py-2 border border-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50"
            >
              <CalendarClock className="w-4 h-4" /> {calendarView ? 'List View' : 'Calendar View'}
            </button>
            <button
              onClick={() => setTemplatesOpen((v) => !v)}
              className="flex items-center gap-2 px-4 py-2 border border-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50"
            >
              <FileText className="w-4 h-4" /> {templatesOpen ? 'Hide' : 'Message'} Templates
            </button>
            <button
              onClick={() => setAccountsOpen((v) => !v)}
              className="flex items-center gap-2 px-4 py-2 border border-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50"
            >
              <Link2 className="w-4 h-4" /> {accountsOpen ? 'Hide' : ''} Accounts
            </button>
            <button
              onClick={() => setFormOpen(true)}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
            >
              <Plus className="w-4 h-4" /> New Post
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6">
        {templatesOpen && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
            <h2 className="text-base font-semibold text-gray-900 mb-1">Message Templates</h2>
            <p className="text-xs text-gray-500 mb-4">Reusable WhatsApp campaign messages and email content (email templates are content-only — no email send channel is built yet). WhatsApp templates saved here are also loadable from the Campaigns page.</p>

            <form onSubmit={handleSaveTemplate} className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5 pb-5 border-b border-gray-100">
              <input
                value={tplName}
                onChange={(e) => setTplName(e.target.value)}
                placeholder="Template name"
                aria-label="Template name"
                required
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <select
                value={tplChannel}
                onChange={(e) => setTplChannel(e.target.value as 'whatsapp' | 'email')}
                aria-label="Template channel"
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="whatsapp">WhatsApp</option>
                <option value="email">Email (content only)</option>
              </select>
              {tplChannel === 'email' && (
                <input
                  value={tplSubject}
                  onChange={(e) => setTplSubject(e.target.value)}
                  placeholder="Email subject"
                  className="md:col-span-2 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              )}
              <textarea
                value={tplBody}
                onChange={(e) => setTplBody(e.target.value)}
                placeholder="Message body — use {{name}} as a placeholder for the customer name"
                rows={3}
                required
                className="md:col-span-2 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
              <button
                type="submit"
                disabled={tplSaving}
                className="md:col-span-2 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60 w-fit"
              >
                {tplSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save Template
              </button>
            </form>

            {templatesLoading ? (
              <p className="text-sm text-gray-400 text-center py-4">Loading…</p>
            ) : templates.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">No templates saved yet.</p>
            ) : (
              <ul className="divide-y divide-gray-50">
                {templates.map((t) => (
                  <li key={t.id} className="py-3 flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-gray-800">{t.name}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${t.channel === 'email' ? 'bg-purple-50 text-purple-700' : 'bg-green-50 text-green-700'}`}>{t.channel}</span>
                        <span className="text-xs text-gray-400">used {t.use_count}x</span>
                      </div>
                      {t.subject && <p className="text-xs text-gray-500 mt-0.5">Subject: {t.subject}</p>}
                      <p className="text-sm text-gray-600 mt-1 line-clamp-2 whitespace-pre-wrap break-words">{t.body}</p>
                    </div>
                    <button
                      onClick={() => handleDeleteTemplate(t.id)}
                      className="shrink-0 text-xs text-red-500 hover:text-red-700"
                    >
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {accountsOpen && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
            <h2 className="text-base font-semibold text-gray-900 mb-1">Connected Accounts</h2>
            <p className="text-xs text-gray-500 mb-4">
              Register an account per platform. Facebook/Instagram publish live once META_PAGE_ACCESS_TOKEN is set in env; LinkedIn/X/Google Business are credential-ready — connecting an account here + the matching env vars enables real publishing and analytics for that platform.
            </p>

            <form onSubmit={handleSaveAccount} className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5 pb-5 border-b border-gray-100">
              <select
                value={acctPlatform}
                onChange={(e) => setAcctPlatform(e.target.value)}
                aria-label="Account platform"
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {PLATFORMS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
              <input
                value={acctDisplayName}
                onChange={(e) => setAcctDisplayName(e.target.value)}
                placeholder="Display name (e.g. BookMySpaces Page)"
                aria-label="Account display name"
                required
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                value={acctExternalId}
                onChange={(e) => setAcctExternalId(e.target.value)}
                placeholder="External account/page ID (optional)"
                aria-label="External account ID"
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                value={acctToken}
                onChange={(e) => setAcctToken(e.target.value)}
                placeholder="Access token (optional — stored encrypted)"
                aria-label="Access token"
                type="password"
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="submit"
                disabled={acctSaving}
                className="md:col-span-2 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60 w-fit"
              >
                {acctSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save Account
              </button>
            </form>

            {accountsLoading ? (
              <p className="text-sm text-gray-400 text-center py-4">Loading…</p>
            ) : accounts.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">No accounts connected yet.</p>
            ) : (
              <ul className="divide-y divide-gray-50">
                {accounts.map((a) => (
                  <li key={a.id} className="py-3 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-gray-800">{a.display_name}</span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 capitalize">
                          {PLATFORMS.find((p) => p.value === a.platform)?.label ?? a.platform}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${a.status === 'connected' ? 'bg-green-50 text-green-700' : a.status === 'error' || a.status === 'token_expired' ? 'bg-red-50 text-red-700' : 'bg-gray-100 text-gray-500'}`}>
                          {a.status.replace('_', ' ')}
                        </span>
                        {!a.is_active && <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-50 text-yellow-700">inactive</span>}
                      </div>
                      {a.external_account_id && <p className="text-xs text-gray-400 mt-0.5">ID: {a.external_account_id}</p>}
                    </div>
                    <button
                      onClick={() => handleToggleAccountActive(a.id, a.is_active)}
                      className="shrink-0 text-xs text-gray-500 hover:text-gray-800"
                    >
                      {a.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

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

        {/* Create form */}
        {formOpen && (
          <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-blue-200 p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-gray-900">New Post</h2>
              <button type="button" onClick={() => setFormOpen(false)} aria-label="Close" className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Platform<span className="text-red-500 ml-0.5">*</span></label>
                <select
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value)}
                  aria-label="Platform"
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

            {/* AI Content Generator (Growth Platform Phase 3) — drafts only,
                platform-aware (covers Google Business posts and every other
                social platform). Never posts anything itself. */}
            <div className="rounded-lg border border-violet-100 bg-violet-50 p-3 mb-4">
              <label className="block text-xs font-semibold text-violet-700 mb-1.5 flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5" /> AI Content Generator — describe the post
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={aiGoal}
                  onChange={(e) => setAiGoal(e.target.value)}
                  placeholder="e.g. Promote our Durga Puja banquet package"
                  className="flex-1 px-3 py-2 border border-violet-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
                />
                <button
                  type="button"
                  onClick={() => void handleAiGenerate()}
                  disabled={aiGenerating || !aiGoal.trim()}
                  className="px-3 py-2 bg-violet-600 text-white rounded-lg text-xs font-medium hover:bg-violet-700 disabled:opacity-50 flex items-center gap-1.5"
                >
                  {aiGenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Draft'}
                </button>
              </div>
              <p className="mt-1.5 text-xs text-violet-600">Drafts copy + hashtags for the platform selected above. Review and edit before saving.</p>

              <div className="flex flex-wrap gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => void handleGenerateHashtags()}
                  disabled={aiHashtagGenerating || (!aiGoal.trim() && !content.trim())}
                  className="px-2.5 py-1.5 bg-white border border-violet-200 text-violet-700 rounded-lg text-xs font-medium hover:bg-violet-100 disabled:opacity-50 flex items-center gap-1.5"
                >
                  {aiHashtagGenerating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Hash className="w-3 h-3" />} Regenerate Hashtags
                </button>
                <button
                  type="button"
                  onClick={() => void handleGenerateImagePrompt()}
                  disabled={aiImageGenerating || !aiGoal.trim()}
                  className="px-2.5 py-1.5 bg-white border border-violet-200 text-violet-700 rounded-lg text-xs font-medium hover:bg-violet-100 disabled:opacity-50 flex items-center gap-1.5"
                >
                  {aiImageGenerating ? <Loader2 className="w-3 h-3 animate-spin" /> : <ImageIcon className="w-3 h-3" />} AI Image Prompt
                </button>
              </div>
              {aiImagePrompt && (
                <div className="mt-2 rounded-lg bg-white border border-violet-200 p-2">
                  <p className="text-xs text-gray-500 mb-1">Paste this into your image tool (Midjourney/DALL-E/Canva AI/etc.) — no image is generated automatically:</p>
                  <p className="text-xs text-gray-800 whitespace-pre-wrap">{aiImagePrompt}</p>
                </div>
              )}
            </div>

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
                {mediaLibrary.length > 0 && (
                  <select
                    value={selectedMediaId}
                    onChange={(e) => handlePickMedia(e.target.value)}
                    aria-label="Pick from media library"
                    className="w-full mb-1.5 px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-400"
                  >
                    <option value="">Pick from media library…</option>
                    {mediaLibrary.map((m) => (
                      <option key={m.id} value={m.id}>{m.label || m.url.slice(0, 40)} (used {m.use_count}x)</option>
                    ))}
                  </select>
                )}
                <input
                  type="url"
                  value={mediaUrl}
                  onChange={(e) => setMediaUrl(e.target.value)}
                  placeholder="https://…"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {mediaUrl.trim() && (
                  <button type="button" onClick={() => void handleSaveToLibrary()} className="mt-1 text-xs text-blue-600 hover:text-blue-800 font-medium">
                    Save to media library
                  </button>
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

        {/* Content Calendar (Growth Platform Phase 4) — same `posts` data as
            the list below, grouped by scheduled_at day instead of flat. */}
        {calendarView ? (
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-4">
              <button
                onClick={() => setCalendarMonth((p) => p.month === 0 ? { year: p.year - 1, month: 11 } : { year: p.year, month: p.month - 1 })}
                className="px-2 py-1 text-sm text-gray-500 hover:text-gray-800"
              >
                ←
              </button>
              <h3 className="text-sm font-semibold text-gray-800">
                {new Date(calendarMonth.year, calendarMonth.month, 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' })}
              </h3>
              <button
                onClick={() => setCalendarMonth((p) => p.month === 11 ? { year: p.year + 1, month: 0 } : { year: p.year, month: p.month + 1 })}
                className="px-2 py-1 text-sm text-gray-500 hover:text-gray-800"
              >
                →
              </button>
            </div>
            {(() => {
              const { year, month } = calendarMonth
              const firstDay = new Date(year, month, 1).getDay()
              const daysInMonth = new Date(year, month + 1, 0).getDate()
              const postsByDay = new Map<number, SocialPost[]>()
              for (const p of posts) {
                if (!p.scheduled_at) continue
                const d = new Date(p.scheduled_at)
                if (d.getFullYear() === year && d.getMonth() === month) {
                  const day = d.getDate()
                  if (!postsByDay.has(day)) postsByDay.set(day, [])
                  postsByDay.get(day)!.push(p)
                }
              }
              const cells: (number | null)[] = [...Array(firstDay).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]
              return (
                <div className="grid grid-cols-7 gap-1.5 text-xs">
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                    <div key={d} className="text-center font-medium text-gray-400 pb-1">{d}</div>
                  ))}
                  {cells.map((day, i) => (
                    <div key={i} className={`min-h-[70px] rounded-lg border p-1.5 ${day ? 'border-gray-100' : 'border-transparent'}`}>
                      {day && (
                        <>
                          <p className="text-gray-400 mb-1">{day}</p>
                          {(postsByDay.get(day) ?? []).map((p) => (
                            <p key={p.id} className={`truncate rounded px-1 py-0.5 mb-0.5 ${STATUS_STYLES[p.status]}`} title={p.content ?? ''}>
                              {PLATFORMS.find((pl) => pl.value === p.platform)?.label ?? p.platform}
                            </p>
                          ))}
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )
            })()}
          </div>
        ) : (
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
                      {post.status === 'failed' && post.failure_reason && (
                        <p className="text-xs text-red-600 mt-1 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3 shrink-0" />
                          {post.failure_reason}
                          {post.publish_attempts > 0 && <span className="text-red-400">({post.publish_attempts} attempt{post.publish_attempts === 1 ? '' : 's'})</span>}
                        </p>
                      )}
                      {post.status === 'published' && metricsByPost[post.id] !== undefined && (
                        metricsByPost[post.id] ? (
                          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-xs text-gray-500">
                            {([
                              ['reach', 'Reach'], ['impressions', 'Impr.'], ['clicks', 'Clicks'],
                              ['likes', 'Likes'], ['comments', 'Comments'], ['shares', 'Shares'], ['saves', 'Saves'],
                            ] as const).map(([key, label]) => {
                              const v = metricsByPost[post.id]?.[key]
                              return v == null ? null : <span key={key}>{label}: <span className="font-medium text-gray-700">{v}</span></span>
                            })}
                          </div>
                        ) : (
                          <p className="text-xs text-gray-400 mt-1.5 italic">No metrics yet — sync to fetch.</p>
                        )
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-xs text-gray-400 flex items-center gap-1 justify-end">
                        <FileText className="w-3 h-3" /> {new Date(post.created_at).toLocaleDateString()}
                      </p>
                      {post.created_by && <p className="text-[11px] text-gray-300 mt-0.5">{post.created_by}</p>}
                      {(post.status === 'draft' || post.status === 'scheduled') && (
                        <button
                          onClick={() => handlePostAction(post.id, 'approve')}
                          disabled={actioningId === post.id}
                          className="mt-2 text-xs px-2 py-1 rounded border border-blue-200 text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                        >
                          {actioningId === post.id ? 'Approving…' : 'Approve'}
                        </button>
                      )}
                      {(post.status === 'draft' || post.status === 'approved' || post.status === 'scheduled' || post.status === 'failed') && (
                        <button
                          onClick={() => handlePostAction(post.id, 'publish')}
                          disabled={actioningId === post.id}
                          className="mt-2 ml-2 text-xs px-2 py-1 rounded border border-green-200 text-green-700 hover:bg-green-50 disabled:opacity-50"
                        >
                          {actioningId === post.id ? 'Publishing…' : post.status === 'failed' ? 'Retry' : 'Publish now'}
                        </button>
                      )}
                      {post.status === 'published' && (
                        <>
                          {metricsByPost[post.id] === undefined && (
                            <button
                              onClick={() => handleViewMetrics(post.id)}
                              disabled={metricsLoadingId === post.id}
                              className="mt-2 text-xs px-2 py-1 rounded border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50 inline-flex items-center gap-1"
                            >
                              <BarChart3 className="w-3 h-3" /> {metricsLoadingId === post.id ? 'Loading…' : 'View metrics'}
                            </button>
                          )}
                          <button
                            onClick={() => handleSyncMetrics(post.id)}
                            disabled={metricsLoadingId === post.id}
                            className="mt-2 ml-2 text-xs px-2 py-1 rounded border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                          >
                            {metricsLoadingId === post.id ? 'Syncing…' : 'Sync metrics'}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        )}
      </div>
    </div>
  )
}
