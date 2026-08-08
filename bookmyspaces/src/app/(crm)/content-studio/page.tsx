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
  ShieldCheck, Upload,
} from 'lucide-react'
import { filterConnectedAccountsForPlatform, toAccountIdField } from './social-post-form-helpers'

// Social Connectivity Priority 1 — platforms with a real OAuth flow
// (src/lib/social/oauth/oauth-config.ts's OAUTH_CONFIGS keys). youtube/
// threads have no OAuth config yet, so they keep the manual-token form only.
const OAUTH_CAPABLE_PLATFORMS = new Set(['facebook', 'instagram', 'linkedin', 'google_business', 'x'])

interface SocialPost {
  id: string
  created_at: string
  platform: string
  post_type: string
  content: string | null
  media: { url: string; type: string }[]
  hashtags: string[]
  status: 'draft' | 'approved' | 'scheduled' | 'publishing' | 'published' | 'failed' | 'failed_permanent'
  scheduled_at: string | null
  published_at: string | null
  created_by: string | null
  // Growth Engine Epic 5 — Social Publishing.
  failure_reason: string | null
  publish_attempts: number
  // Sprint 1 (Social Publishing) — backoff-scheduled auto-retry time.
  next_retry_at: string | null
  // Content Operations Priority 5 — approval gate (migration 041). Only
  // meaningful for status='scheduled' (a 'draft' post's approval is the
  // status==='approved' transition itself).
  approved_at: string | null
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
  failed_permanent: 'bg-red-100 text-red-800',
}

// Sprint 2 (AI Content Studio) — length/tone variants + occasion templates.
const CONTENT_VARIANTS = [
  { value: 'standard', label: 'Standard' },
  { value: 'short', label: 'Short' },
  { value: 'long', label: 'Long' },
  { value: 'emoji', label: 'Emoji' },
]
const CONTENT_TEMPLATES = [
  { value: '', label: 'No template' },
  { value: 'wedding', label: 'Wedding' },
  { value: 'birthday', label: 'Birthday' },
  { value: 'corporate', label: 'Corporate' },
  { value: 'rooftop', label: 'Rooftop' },
  { value: 'restaurant', label: 'Restaurant' },
  { value: 'weekend_stay', label: 'Weekend Stay' },
  { value: 'festival', label: 'Festivals' },
  { value: 'offer', label: 'Offers' },
]

const STATUS_FILTERS = ['', 'draft', 'scheduled', 'published', 'failed'] as const

export default function ContentStudioPage() {
  // Social Connectivity Priority 1 — the OAuth callback redirects here with
  // ?oauth=success|error (see src/app/api/social/oauth/[platform]/callback/
  // route.ts). Read directly from window.location instead of
  // next/navigation's useSearchParams() so this page doesn't need a
  // Suspense boundary just for a one-time toast-on-mount — this is plain
  // client-side-only logic ('use client' page, runs after mount).
  useEffect(() => {
    const oauthResult = new URLSearchParams(window.location.search).get('oauth')
    if (oauthResult === 'success') toast.success('Account connected.')
    else if (oauthResult === 'error') toast.error('Could not connect that account — see server logs for details.')
  }, [])

  const [posts, setPosts] = useState<SocialPost[]>([])
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  // form state
  const [platform, setPlatform] = useState('facebook')
  // Social OAuth Account Selection fix — which connected social_accounts row
  // (of possibly several for this platform) the post publishes from. Reset
  // whenever platform changes, since the previous selection belongs to a
  // different platform's account list.
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [content, setContent] = useState('')
  const [mediaUrl, setMediaUrl] = useState('')
  const [hashtags, setHashtags] = useState('')
  const [scheduleAt, setScheduleAt] = useState('')

  // Growth Platform Phase 3 — AI Content Studio (Google Business Post
  // Generator + Social Media Content Generator). Drafts only, never posts.
  const [aiGoal, setAiGoal] = useState('')
  const [aiGenerating, setAiGenerating] = useState(false)
  // Sprint 2 (AI Content Studio) — length/tone variant + occasion template,
  // plus the title/CTA fields the generator now returns alongside content.
  const [aiVariant, setAiVariant] = useState('standard')
  const [aiTemplate, setAiTemplate] = useState('')
  const [aiTitle, setAiTitle] = useState('')
  const [aiCta, setAiCta] = useState('')

  // Business Package Engine — picking a package prefills the AI Goal +
  // hashtags from its stored ai_prompt/hashtags (reusing generateSocialPostDraft
  // via the existing /api/social/generate call below, no new generator) and
  // tags the created post with business_package_id for later attribution.
  const [businessPackages, setBusinessPackages] = useState<{ id: string; name: string; aiPrompt: string | null; hashtags: string[]; recommendedMedia: string | null; recommendedPostingTime: string | null }[]>([])
  const [selectedPackageId, setSelectedPackageId] = useState('')

  useEffect(() => {
    fetch('/api/business-packages?status=active')
      .then((res) => res.json())
      .then((data) => setBusinessPackages(Array.isArray(data.packages) ? data.packages.map((p: { id: string; name: string; aiPrompt: string | null; hashtags: string[]; recommendedMedia: string | null; recommendedPostingTime: string | null }) => p) : []))
      .catch(() => setBusinessPackages([]))
  }, [])

  // End-to-End Campaign Attribution — tags the created post with the
  // outbound broadcast_campaigns row it promotes (migration 045), so Revenue
  // by Campaign can roll up the social side too. Reuses the existing GET
  // /api/campaigns list (no new endpoint).
  const [campaigns, setCampaigns] = useState<{ id: string; name: string }[]>([])
  const [selectedCampaignId, setSelectedCampaignId] = useState('')

  useEffect(() => {
    fetch('/api/campaigns')
      .then((res) => res.json())
      .then((data) => setCampaigns(Array.isArray(data.campaigns) ? data.campaigns.map((c: { id: string; name: string }) => ({ id: c.id, name: c.name })) : []))
      .catch(() => setCampaigns([]))
  }, [])

  function handleSelectPackage(id: string) {
    setSelectedPackageId(id)
    const pkg = businessPackages.find((p) => p.id === id)
    if (!pkg) return
    if (pkg.aiPrompt) setAiGoal(pkg.aiPrompt)
    if (pkg.hashtags.length) setHashtags(pkg.hashtags.join(', '))
  }

  async function handleAiGenerate() {
    if (!aiGoal.trim()) return
    setAiGenerating(true)
    try {
      const res = await fetch('/api/social/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform, goal: aiGoal.trim(),
          variant: aiVariant !== 'standard' ? aiVariant : undefined,
          template: aiTemplate || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Failed to generate draft')
        return
      }
      setContent(data.draft.content)
      setHashtags(data.draft.hashtags.join(', '))
      setAiTitle(data.draft.title || '')
      setAiCta(data.draft.cta || '')
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
        // Content Operations Priority 5 — the approval-gate rejection comes
        // back as the raw error code 'approval_required' (publish-
        // service.ts); humanize it here rather than showing that literal
        // string. Every other error code is shown as-is, unchanged.
        toast.error(json.error === 'approval_required' ? 'This post needs approval before it can publish — click Approve first.' : (json.error || `Failed to ${action} post`))
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
    setAiTitle(''); setAiCta(''); setSelectedPackageId(''); setSelectedCampaignId(''); setSelectedAccountId('')
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

  // Content Operations Priority 5 — actual file upload
  // (POST /api/social/media-library/upload, Supabase Storage). Previously
  // this form only accepted a pasted, already-hosted URL — this adds a real
  // upload path alongside it, writing the same media_library row shape so
  // every existing reader (this picker, AI recommendations) is unaffected.
  const [uploadingFile, setUploadingFile] = useState(false)

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingFile(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/social/media-library/upload', { method: 'POST', body: formData })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'Upload failed'); return }
      setMediaUrl(data.media.url)
      setMediaLibrary((p) => [data.media, ...p])
      toast.success('File uploaded.')
    } finally {
      setUploadingFile(false)
      e.target.value = ''
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

  // Account Selection fix — the New Post form's Account selector needs the
  // connected-accounts list even when the "Connected Accounts" panel itself
  // is closed, so this now also loads once on mount (same pattern as
  // businessPackages/campaigns/mediaLibrary above). The accountsOpen-gated
  // load is kept as-is so opening that panel still refreshes it.
  useEffect(() => { loadAccounts() }, [loadAccounts])
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

  // Content Operations Priority 5 — approval-gate toggle
  // (GET/PATCH /api/social/publish-config). Loaded alongside the accounts
  // panel since it lives in the same "publishing workflow settings" area.
  const [requireApproval, setRequireApproval] = useState(false)
  const [approvalLoading, setApprovalLoading] = useState(false)

  const loadPublishConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/social/publish-config')
      if (!res.ok) return
      const data = await res.json()
      setRequireApproval(Boolean(data.config?.requireApproval))
    } catch { /* best-effort — default (false) already matches server default */ }
  }, [])

  useEffect(() => { if (accountsOpen) loadPublishConfig() }, [accountsOpen, loadPublishConfig])

  async function handleToggleRequireApproval() {
    const next = !requireApproval
    setApprovalLoading(true)
    try {
      const res = await fetch('/api/social/publish-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requireApproval: next }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'Failed to update setting'); return }
      setRequireApproval(Boolean(data.config?.requireApproval))
      toast.success(next ? 'Draft posts now require approval before publishing.' : 'Approval requirement turned off — drafts can publish directly again.')
    } finally {
      setApprovalLoading(false)
    }
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
  // Sprint 1 (Social Publishing) — Calendar: monthly/weekly/daily. Monthly
  // keeps its own month-cursor (calendarMonth, below); week/day share a
  // single anchor date they step by 7/1 days.
  const [calendarGranularity, setCalendarGranularity] = useState<'month' | 'week' | 'day'>('month')
  const [calendarAnchor, setCalendarAnchor] = useState(() => new Date())
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
        account_id: toAccountIdField(selectedAccountId),
        ...(mediaUrl.trim() ? { media: [{ url: mediaUrl.trim(), type: 'image' }] } : {}),
        ...(tags.length ? { hashtags: tags } : {}),
        ...(scheduleAt ? { scheduled_at: new Date(scheduleAt).toISOString() } : {}),
        ...(selectedPackageId ? { business_package_id: selectedPackageId } : {}),
        ...(selectedCampaignId ? { campaign_id: selectedCampaignId } : {}),
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

  // Account Selection fix — the New Post form's Account dropdown and the
  // "no connected account" disable/validation both derive from this same
  // filtered list, recomputed whenever `accounts` or `platform` changes.
  const accountsForPlatform = filterConnectedAccountsForPlatform(accounts, platform)

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
              Connect a platform via OAuth (recommended — Facebook/Instagram/LinkedIn/Google Business/X), or register an account manually below with a pasted token. OAuth requires that platform&apos;s app credentials to be set in env first; if they aren&apos;t, the Connect button will show an error explaining what&apos;s missing.
            </p>

            <div className="flex flex-wrap gap-2 mb-5 pb-5 border-b border-gray-100">
              {PLATFORMS.filter((p) => OAUTH_CAPABLE_PLATFORMS.has(p.value)).map((p) => (
                <a
                  key={p.value}
                  href={`/api/social/oauth/${p.value}/start`}
                  className="flex items-center gap-2 px-3 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  <Link2 className="w-4 h-4" /> Connect {p.label}
                </a>
              ))}
            </div>

            <div className="flex items-center justify-between gap-4 mb-5 pb-5 border-b border-gray-100">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-800 flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-gray-400" /> Require approval before publishing</p>
                <p className="text-xs text-gray-500 mt-0.5">When on, a draft post cannot be published (manually or via schedule) until it&apos;s explicitly marked Approved.</p>
              </div>
              <button
                type="button"
                onClick={handleToggleRequireApproval}
                disabled={approvalLoading}
                aria-pressed={requireApproval}
                className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-60 ${requireApproval ? 'bg-blue-600' : 'bg-gray-200'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${requireApproval ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>

            <p className="text-xs text-gray-500 mb-3">Or register manually with a pasted token:</p>
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
                    <div className="shrink-0 flex items-center gap-3">
                      {/* Social Connectivity Priority 1 — connection health.
                          Re-running OAuth for the same platform upserts the
                          same social_accounts row (onConflict platform,
                          external_account_id in the callback route), so this
                          is the same Connect link as above, just surfaced
                          inline on the specific unhealthy account instead of
                          only in the generic per-platform list. */}
                      {(a.status === 'error' || a.status === 'token_expired') && OAUTH_CAPABLE_PLATFORMS.has(a.platform) && (
                        <a
                          href={`/api/social/oauth/${a.platform}/start`}
                          className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                        >
                          Reconnect
                        </a>
                      )}
                      <button
                        onClick={() => handleToggleAccountActive(a.id, a.is_active)}
                        className="text-xs text-gray-500 hover:text-gray-800"
                      >
                        {a.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                    </div>
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

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Platform<span className="text-red-500 ml-0.5">*</span></label>
                <select
                  value={platform}
                  onChange={(e) => { setPlatform(e.target.value); setSelectedAccountId('') }}
                  aria-label="Platform"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {PLATFORMS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Account<span className="text-red-500 ml-0.5">*</span></label>
                <select
                  value={selectedAccountId}
                  onChange={(e) => setSelectedAccountId(e.target.value)}
                  aria-label="Account"
                  disabled={accountsForPlatform.length === 0}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
                >
                  <option value="">Select an account…</option>
                  {accountsForPlatform.map((a) => <option key={a.id} value={a.id}>{a.display_name}</option>)}
                </select>
                {accountsForPlatform.length === 0 && (
                  <p className="text-xs text-red-600 mt-1 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3 shrink-0" /> No connected {PLATFORMS.find((p) => p.value === platform)?.label ?? platform} account.
                  </p>
                )}
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
              {businessPackages.length > 0 && (
                <select
                  value={selectedPackageId}
                  onChange={(e) => handleSelectPackage(e.target.value)}
                  aria-label="Use a Business Package"
                  className="w-full mb-2 px-2 py-1.5 border border-violet-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-violet-400"
                >
                  <option value="">Use a Business Package (optional)…</option>
                  {businessPackages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              )}
              {selectedPackageId && (() => {
                const pkg = businessPackages.find((p) => p.id === selectedPackageId)
                return pkg && (pkg.recommendedMedia || pkg.recommendedPostingTime) ? (
                  <p className="text-xs text-violet-600 mb-2">
                    {pkg.recommendedMedia && <>📷 {pkg.recommendedMedia} </>}
                    {pkg.recommendedPostingTime && <>· ⏰ {pkg.recommendedPostingTime}</>}
                  </p>
                ) : null
              })()}
              {/* End-to-End Campaign Attribution — optional link to an
                  outbound campaign, so Revenue by Campaign includes this
                  post's contribution alongside WhatsApp sends. */}
              {campaigns.length > 0 && (
                <select
                  value={selectedCampaignId}
                  onChange={(e) => setSelectedCampaignId(e.target.value)}
                  aria-label="Attribute to a Campaign"
                  className="w-full mb-2 px-2 py-1.5 border border-violet-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-violet-400"
                >
                  <option value="">Attribute to a Campaign (optional)…</option>
                  {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              )}
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
              <div className="flex gap-2 mt-2">
                <select
                  value={aiVariant}
                  onChange={(e) => setAiVariant(e.target.value)}
                  aria-label="Content variant"
                  className="px-2 py-1.5 border border-violet-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-violet-400"
                >
                  {CONTENT_VARIANTS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
                </select>
                <select
                  value={aiTemplate}
                  onChange={(e) => setAiTemplate(e.target.value)}
                  aria-label="Content template"
                  className="px-2 py-1.5 border border-violet-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-violet-400"
                >
                  {CONTENT_TEMPLATES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <p className="mt-1.5 text-xs text-violet-600">Drafts copy + hashtags for the platform selected above. Review and edit before saving.</p>
              {(aiTitle || aiCta) && (
                <div className="mt-2 text-xs text-violet-700 space-y-0.5">
                  {aiTitle && <p><span className="font-semibold">Suggested title:</span> {aiTitle}</p>}
                  {aiCta && <p><span className="font-semibold">Suggested CTA:</span> {aiCta}</p>}
                </div>
              )}

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
                <label className="flex items-center justify-center gap-2 w-full mb-1.5 px-3 py-2 border border-dashed border-gray-300 rounded-lg text-xs text-gray-600 hover:bg-gray-50 cursor-pointer">
                  {uploadingFile ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                  {uploadingFile ? 'Uploading…' : 'Upload an image or video'}
                  <input type="file" accept="image/*,video/*" onChange={handleFileUpload} disabled={uploadingFile} className="hidden" />
                </label>
                <input
                  type="url"
                  value={mediaUrl}
                  onChange={(e) => setMediaUrl(e.target.value)}
                  placeholder="…or paste an already-hosted URL"
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
                disabled={saving || accountsForPlatform.length === 0}
                title={accountsForPlatform.length === 0 ? `No connected ${PLATFORMS.find((p) => p.value === platform)?.label ?? platform} account.` : undefined}
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

        {/* Content Calendar (Growth Platform Phase 4 + Sprint 1 week/day
            views) — same `posts` data as the list below, grouped by
            scheduled_at instead of flat. */}
        {calendarView ? (
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex gap-1">
                {(['month', 'week', 'day'] as const).map((g) => (
                  <button
                    key={g}
                    onClick={() => setCalendarGranularity(g)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium capitalize ${calendarGranularity === g ? 'bg-violet-600 text-white' : 'bg-gray-50 border border-gray-200 text-gray-500 hover:bg-gray-100'}`}
                  >
                    {g}
                  </button>
                ))}
              </div>
              {calendarGranularity === 'month' ? (
                <div className="flex items-center gap-3">
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
              ) : (
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setCalendarAnchor((d) => { const n = new Date(d); n.setDate(n.getDate() - (calendarGranularity === 'week' ? 7 : 1)); return n })}
                    className="px-2 py-1 text-sm text-gray-500 hover:text-gray-800"
                  >
                    ←
                  </button>
                  <h3 className="text-sm font-semibold text-gray-800">
                    {calendarGranularity === 'day'
                      ? calendarAnchor.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
                      : `Week of ${new Date(calendarAnchor.getFullYear(), calendarAnchor.getMonth(), calendarAnchor.getDate() - calendarAnchor.getDay()).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`}
                  </h3>
                  <button
                    onClick={() => setCalendarAnchor((d) => { const n = new Date(d); n.setDate(n.getDate() + (calendarGranularity === 'week' ? 7 : 1)); return n })}
                    className="px-2 py-1 text-sm text-gray-500 hover:text-gray-800"
                  >
                    →
                  </button>
                </div>
              )}
            </div>
            {calendarGranularity === 'month' && (() => {
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
            {calendarGranularity === 'week' && (() => {
              const weekStart = new Date(calendarAnchor.getFullYear(), calendarAnchor.getMonth(), calendarAnchor.getDate() - calendarAnchor.getDay())
              const days = Array.from({ length: 7 }, (_, i) => {
                const d = new Date(weekStart); d.setDate(d.getDate() + i); return d
              })
              return (
                <div className="grid grid-cols-7 gap-1.5 text-xs">
                  {days.map((d) => {
                    const dayPosts = posts.filter((p) => p.scheduled_at && new Date(p.scheduled_at).toDateString() === d.toDateString())
                    return (
                      <div key={d.toISOString()} className="min-h-[120px] rounded-lg border border-gray-100 p-1.5">
                        <p className="text-gray-400 mb-1">{d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' })}</p>
                        {dayPosts.map((p) => (
                          <p key={p.id} className={`truncate rounded px-1 py-0.5 mb-0.5 ${STATUS_STYLES[p.status]}`} title={p.content ?? ''}>
                            {new Date(p.scheduled_at as string).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} · {PLATFORMS.find((pl) => pl.value === p.platform)?.label ?? p.platform}
                          </p>
                        ))}
                      </div>
                    )
                  })}
                </div>
              )
            })()}
            {calendarGranularity === 'day' && (() => {
              const dayPosts = posts
                .filter((p) => p.scheduled_at && new Date(p.scheduled_at).toDateString() === calendarAnchor.toDateString())
                .sort((a, b) => new Date(a.scheduled_at as string).getTime() - new Date(b.scheduled_at as string).getTime())
              return dayPosts.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">No posts scheduled for this day.</p>
              ) : (
                <ul className="divide-y divide-gray-50">
                  {dayPosts.map((p) => (
                    <li key={p.id} className="py-2.5 flex items-center gap-3">
                      <span className="text-xs text-gray-400 w-14 shrink-0">
                        {new Date(p.scheduled_at as string).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span className="text-xs font-medium text-gray-500 w-24 shrink-0">
                        {PLATFORMS.find((pl) => pl.value === p.platform)?.label ?? p.platform}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_STYLES[p.status]}`}>{p.status}</span>
                      <span className="text-sm text-gray-700 truncate flex-1">{p.content}</span>
                    </li>
                  ))}
                </ul>
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
                      {(post.status === 'draft' || (post.status === 'scheduled' && !post.approved_at)) && (
                        <button
                          onClick={() => handlePostAction(post.id, 'approve')}
                          disabled={actioningId === post.id}
                          className="mt-2 text-xs px-2 py-1 rounded border border-blue-200 text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                        >
                          {actioningId === post.id ? 'Approving…' : 'Approve'}
                        </button>
                      )}
                      {post.status === 'scheduled' && post.approved_at && (
                        <span className="mt-2 inline-block text-xs px-2 py-1 rounded bg-emerald-50 text-emerald-700">
                          Approved — will publish at schedule
                        </span>
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
