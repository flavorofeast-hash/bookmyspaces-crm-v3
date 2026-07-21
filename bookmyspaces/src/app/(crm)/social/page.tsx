'use client'

// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/(crm)/social/page.tsx
// V3 Phase 5 — Social Media Command Center: Unified Social Inbox (v1).
//
// Comments/mentions/reviews from connected platforms, one queue. Reply
// sends through the platform adapter where credentials exist; otherwise
// the reply is saved as a draft (clearly labeled) and can be sent once the
// platform is connected. DMs live in the main Unified Inbox, not here.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from 'react'
import {
  Share2, RefreshCw, AlertCircle, MessageCircle, AtSign, Star,
  Archive, Send, ThumbsUp, ThumbsDown, Minus,
} from 'lucide-react'

interface Interaction {
  id: string
  created_at: string
  platform: string
  interaction_type: string
  author_name: string | null
  content: string | null
  sentiment: 'positive' | 'neutral' | 'negative' | null
  status: 'new' | 'replied' | 'escalated' | 'archived'
  reply_draft: string | null
  leads: { name: string | null; phone: string | null } | { name: string | null; phone: string | null }[] | null
}

const PLATFORM_LABELS: Record<string, string> = {
  facebook: 'Facebook', instagram: 'Instagram', linkedin: 'LinkedIn',
  google_business: 'Google Business', x: 'X', youtube: 'YouTube', threads: 'Threads',
}

function TypeIcon({ type, className }: { type: string; className?: string }) {
  if (type === 'mention') return <AtSign className={className} />
  if (type === 'review') return <Star className={className} />
  return <MessageCircle className={className} />
}

function SentimentIcon({ s }: { s: Interaction['sentiment'] }) {
  if (s === 'positive') return <ThumbsUp className="w-3.5 h-3.5 text-green-500" />
  if (s === 'negative') return <ThumbsDown className="w-3.5 h-3.5 text-red-500" />
  if (s === 'neutral') return <Minus className="w-3.5 h-3.5 text-gray-400" />
  return null
}

export default function SocialPage() {
  const [interactions, setInteractions] = useState<Interaction[]>([])
  const [statusFilter, setStatusFilter] = useState<'new' | 'replied' | 'escalated' | 'archived' | ''>('new')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [replyFor, setReplyFor] = useState<string | null>(null)
  const [replyText, setReplyText] = useState('')
  const [sending, setSending] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch(`/api/social/interactions${statusFilter ? `?status=${statusFilter}` : ''}`)
      if (!res.ok) throw new Error(String(res.status))
      setInteractions((await res.json()).interactions ?? [])
    } catch {
      setError('Failed to load. Migration 014 (social foundation) may not be applied yet.')
    } finally {
      setLoading(false)
    }
  }, [statusFilter])

  useEffect(() => { load() }, [load])

  async function sendReply(id: string) {
    setSending(true)
    setNotice(null)
    try {
      const res = await fetch(`/api/social/interactions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reply', message: replyText.trim() }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || 'reply failed')
      setNotice(json.sent
        ? 'Reply posted to the platform.'
        : `Saved as draft — ${json.detail || 'platform not connected yet'}.`)
      setReplyFor(null)
      setReplyText('')
      await load()
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Failed')
    } finally {
      setSending(false)
    }
  }

  async function setStatus(id: string, status: Interaction['status']) {
    const res = await fetch(`/api/social/interactions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    if (res.ok) await load()
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
              <Share2 className="w-5 h-5" /> Social Inbox
            </h1>
            <p className="text-sm text-gray-500">
              Comments, mentions and reviews across platforms. DMs appear in the main Inbox.
            </p>
          </div>
          <button onClick={load} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800">
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6">
        <div className="flex gap-1 mb-4">
          {([['new', 'New'], ['escalated', 'Escalated'], ['replied', 'Replied'], ['archived', 'Archived'], ['', 'All']] as const).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setStatusFilter(v)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium ${statusFilter === v ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {error && (
          <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4">
            <AlertCircle className="w-4 h-4 shrink-0" /> {error}
          </div>
        )}
        {notice && (
          <div className="flex items-center gap-2 text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 mb-4">
            <AlertCircle className="w-4 h-4 shrink-0" /> {notice}
          </div>
        )}

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-sm text-gray-500">Loading…</div>
          ) : interactions.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-500">
              Nothing here. Once Facebook/Instagram are connected (Meta app credentials), comments and mentions flow in automatically via webhooks.
            </div>
          ) : (
            <ul className="divide-y divide-gray-50">
              {interactions.map((it) => (
                <li key={it.id} className="px-5 py-4 hover:bg-gray-50">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <TypeIcon type={it.interaction_type} className="w-3.5 h-3.5 text-gray-400" />
                        <span className="text-xs font-medium text-gray-500">{PLATFORM_LABELS[it.platform] ?? it.platform}</span>
                        <SentimentIcon s={it.sentiment} />
                        <span className="text-sm font-medium text-gray-900">{it.author_name ?? 'Unknown'}</span>
                        <span className="text-xs text-gray-400">{new Date(it.created_at).toLocaleString()}</span>
                        {it.status !== 'new' && (
                          <span className={`text-xs px-2 py-0.5 rounded-full ${it.status === 'escalated' ? 'bg-red-50 text-red-600' : 'bg-gray-100 text-gray-500'}`}>{it.status}</span>
                        )}
                      </div>
                      <p className="text-sm text-gray-700 mt-1 whitespace-pre-wrap break-words">{it.content}</p>
                      {it.reply_draft && it.status !== 'replied' && (
                        <p className="text-xs text-amber-600 mt-1">Draft saved: “{it.reply_draft.slice(0, 80)}…”</p>
                      )}

                      {replyFor === it.id && (
                        <div className="mt-3 flex items-end gap-2">
                          <textarea
                            value={replyText}
                            onChange={(e) => setReplyText(e.target.value)}
                            rows={2}
                            className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="Write a reply…"
                          />
                          <button
                            onClick={() => sendReply(it.id)}
                            disabled={sending || !replyText.trim()}
                            className="p-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                          >
                            <Send className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="shrink-0 whitespace-nowrap text-sm">
                      {replyFor !== it.id && it.status !== 'archived' && (
                        <button
                          onClick={() => { setReplyFor(it.id); setReplyText(it.reply_draft ?? '') }}
                          className="text-blue-600 hover:text-blue-800 mr-3"
                        >
                          Reply
                        </button>
                      )}
                      {it.status !== 'archived' && (
                        <button onClick={() => setStatus(it.id, 'archived')} className="text-gray-400 hover:text-gray-700">
                          <Archive className="w-4 h-4" />
                        </button>
                      )}
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
