'use client'

// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/(crm)/reviews/page.tsx
// Growth Engine Epic 1 — Review Engine dashboard. No external review API
// exists (Google/Meta review-fetching is out of scope for this phase), so
// reviews are logged manually by an operator who saw them on the actual
// platform. AI reply drafting and review-request tracking are real.
// Same 'use client' + useEffect/fetch page-structure convention as every
// other CRM page (see dashboard/marketing/page.tsx).
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Star, Plus, X, Sparkles, Loader2, Save, RefreshCw, MessageSquareText } from 'lucide-react'

interface Review {
  id: string
  platform: string
  external_id: string | null
  author_name: string | null
  rating: number | null
  content: string | null
  review_date: string | null
  response_draft: string | null
  response_status: 'none' | 'drafted' | 'approved' | 'posted'
  responded_at: string | null
}

interface ReviewRequest {
  id: string
  status: 'requested' | 'reminded' | 'completed' | 'declined'
  requested_at: string
  reminder_count: number
  lead_name: string | null
  lead_phone: string | null
}

interface Analytics {
  totalReviews: number
  avgRating: number | null
  ratingDistribution: Record<string, number>
  byPlatform: Array<{ platform: string; count: number; avgRating: number | null }>
  responseRatePct: number
  requests: { total: number; requested: number; reminded: number; completed: number; declined: number; requestToReviewPct: number }
}

const PLATFORMS = ['google', 'facebook', 'booking', 'other']

export default function ReviewsPage() {
  const [reviews, setReviews] = useState<Review[]>([])
  const [requests, setRequests] = useState<ReviewRequest[]>([])
  const [analytics, setAnalytics] = useState<Analytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [generatingId, setGeneratingId] = useState<string | null>(null)

  const [platform, setPlatform] = useState('google')
  const [authorName, setAuthorName] = useState('')
  const [rating, setRating] = useState('5')
  const [content, setContent] = useState('')
  const [reviewDate, setReviewDate] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [reviewsRes, requestsRes, analyticsRes] = await Promise.all([
        fetch('/api/reviews'),
        fetch('/api/reviews/requests'),
        fetch('/api/reviews?view=analytics'),
      ])
      setReviews((await reviewsRes.json()).reviews ?? [])
      setRequests((await requestsRes.json()).requests ?? [])
      setAnalytics((await analyticsRes.json()).analytics ?? null)
    } catch {
      toast.error('Failed to load reviews')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform, author_name: authorName.trim() || undefined, rating: Number(rating),
          content: content.trim() || undefined, review_date: reviewDate ? new Date(reviewDate).toISOString() : undefined,
        }),
      })
      if (!res.ok) throw new Error()
      toast.success('Review logged.')
      setPlatform('google'); setAuthorName(''); setRating('5'); setContent(''); setReviewDate('')
      setFormOpen(false)
      await load()
    } catch {
      toast.error('Failed to save review')
    } finally {
      setSaving(false)
    }
  }

  async function handleGenerateReply(id: string) {
    setGeneratingId(id)
    try {
      const res = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'generate_reply', id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error()
      setReviews((p) => p.map((r) => (r.id === id ? data.review : r)))
    } catch {
      toast.error('Failed to generate reply')
    } finally {
      setGeneratingId(null)
    }
  }

  async function handleUpdateDraft(id: string, response_draft: string) {
    setReviews((p) => p.map((r) => (r.id === id ? { ...r, response_draft } : r)))
  }

  async function handleMarkPosted(id: string, response_draft: string) {
    const res = await fetch('/api/reviews', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, response_draft, response_status: 'posted' }),
    })
    const data = await res.json()
    if (res.ok) {
      setReviews((p) => p.map((r) => (r.id === id ? data.review : r)))
      toast.success('Marked as posted.')
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900 flex items-center gap-2"><Star className="w-5 h-5" /> Reviews</h1>
            <p className="text-sm text-gray-500">Review requests, reminders, and AI-assisted replies. No external review platform is connected yet — log reviews you&apos;ve seen manually.</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={load} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800"><RefreshCw className="w-3.5 h-3.5" /> Refresh</button>
            <button onClick={() => setFormOpen(true)} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
              <Plus className="w-4 h-4" /> Log Review
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6 space-y-6">
        {analytics && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-xs text-gray-400">Avg. Rating</p>
              <p className="text-xl font-bold text-gray-900 mt-1">{analytics.avgRating ?? '—'}{analytics.avgRating ? ' / 5' : ''}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-xs text-gray-400">Total Reviews</p>
              <p className="text-xl font-bold text-gray-900 mt-1">{analytics.totalReviews}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-xs text-gray-400">Response Rate</p>
              <p className="text-xl font-bold text-gray-900 mt-1">{analytics.responseRatePct}%</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-xs text-gray-400">Request → Review</p>
              <p className="text-xl font-bold text-gray-900 mt-1">{analytics.requests.requestToReviewPct}%</p>
            </div>
          </div>
        )}

        {formOpen && (
          <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-blue-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-gray-900">Log a Review</h2>
              <button type="button" onClick={() => setFormOpen(false)} aria-label="Close" className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
              <select value={platform} onChange={(e) => setPlatform(e.target.value)} aria-label="Platform" className="px-3 py-2 border border-gray-200 rounded-lg text-sm">
                {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <input value={authorName} onChange={(e) => setAuthorName(e.target.value)} placeholder="Reviewer name" aria-label="Reviewer name" className="px-3 py-2 border border-gray-200 rounded-lg text-sm" />
              <select value={rating} onChange={(e) => setRating(e.target.value)} aria-label="Rating" className="px-3 py-2 border border-gray-200 rounded-lg text-sm">
                {[5, 4, 3, 2, 1].map((r) => <option key={r} value={r}>{r} star{r !== 1 ? 's' : ''}</option>)}
              </select>
            </div>
            <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={3} placeholder="Review text" aria-label="Review text" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm mb-3" />
            <input type="date" value={reviewDate} onChange={(e) => setReviewDate(e.target.value)} aria-label="Review date" className="px-3 py-2 border border-gray-200 rounded-lg text-sm mb-3" />
            <button type="submit" disabled={saving} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save Review
            </button>
          </form>
        )}

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100"><h2 className="text-sm font-semibold text-gray-700">Reviews</h2></div>
          {loading ? (
            <p className="text-sm text-gray-400 text-center py-8">Loading…</p>
          ) : reviews.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">No reviews logged yet.</p>
          ) : (
            <ul className="divide-y divide-gray-50">
              {reviews.map((r) => (
                <li key={r.id} className="px-6 py-4">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-sm font-medium text-gray-800">{r.author_name || 'Anonymous'}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 capitalize">{r.platform}</span>
                    {r.rating !== null && <span className="text-xs text-amber-600">{'★'.repeat(Math.round(r.rating))}{'☆'.repeat(5 - Math.round(r.rating))}</span>}
                    <span className="text-xs text-gray-400">{r.review_date ? new Date(r.review_date).toLocaleDateString() : ''}</span>
                  </div>
                  {r.content && <p className="text-sm text-gray-600 mb-2">{r.content}</p>}
                  <div className="bg-gray-50 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-medium text-gray-500 flex items-center gap-1"><MessageSquareText className="w-3.5 h-3.5" /> Reply</span>
                      <button onClick={() => void handleGenerateReply(r.id)} disabled={generatingId === r.id} className="text-xs text-violet-600 hover:text-violet-800 font-medium flex items-center gap-1">
                        {generatingId === r.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />} AI Draft
                      </button>
                    </div>
                    <textarea
                      value={r.response_draft ?? ''}
                      onChange={(e) => handleUpdateDraft(r.id, e.target.value)}
                      rows={2}
                      placeholder="No reply drafted yet"
                      className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm bg-white"
                    />
                    <div className="flex items-center justify-between mt-1.5">
                      <span className="text-xs text-gray-400 capitalize">{r.response_status}</span>
                      {r.response_draft && r.response_status !== 'posted' && (
                        <button onClick={() => handleMarkPosted(r.id, r.response_draft!)} className="text-xs text-blue-600 hover:text-blue-800 font-medium">Mark as posted (posted manually elsewhere)</button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {analytics && (
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Review Requests</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4 text-center">
              <div><p className="text-lg font-bold text-gray-900">{analytics.requests.requested}</p><p className="text-xs text-gray-400">Pending</p></div>
              <div><p className="text-lg font-bold text-gray-900">{analytics.requests.reminded}</p><p className="text-xs text-gray-400">Reminded</p></div>
              <div><p className="text-lg font-bold text-gray-900">{analytics.requests.completed}</p><p className="text-xs text-gray-400">Completed</p></div>
              <div><p className="text-lg font-bold text-gray-900">{analytics.requests.total}</p><p className="text-xs text-gray-400">Total</p></div>
            </div>
            <ul className="divide-y divide-gray-50 max-h-64 overflow-y-auto">
              {requests.slice(0, 20).map((r) => (
                <li key={r.id} className="py-2 flex items-center justify-between text-sm">
                  <span className="text-gray-700">{r.lead_name || r.lead_phone || 'Unknown guest'}</span>
                  <span className="text-xs text-gray-400 capitalize">{r.status} · {new Date(r.requested_at).toLocaleDateString()}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
