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
  FileText, Image as ImageIcon, Hash,
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

  function resetForm() {
    setPlatform('facebook'); setContent(''); setMediaUrl(''); setHashtags(''); setScheduleAt('')
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
              Draft and schedule social posts. Publishing and AI captions arrive in later steps.
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
                  onChange={(e) => setMediaUrl(e.target.value)}
                  placeholder="https://…"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
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
