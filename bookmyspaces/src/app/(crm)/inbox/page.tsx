'use client'

// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/(crm)/inbox/page.tsx
// V3 Phase 3 — Unified Inbox: every channel, one conversation list.
//
// Left: conversations across WhatsApp / website chat / (future channels),
// newest activity first. Right: full timeline for the selected conversation
// with human reply box, AI pause/resume and status controls.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  MessageSquare, Globe, Mail, Phone, Bot, User, Send, RefreshCw,
  AlertCircle, PauseCircle, PlayCircle, CheckCircle2, Inbox as InboxIcon,
} from 'lucide-react'

interface LeadInfo { id?: string; name: string | null; phone: string | null; email: string | null; status?: string | null }
interface ChannelInfo { channelType: string; identity: string }
interface LastMessage { content: string | null; direction: string; sender_type: string; created_at: string }
interface Conversation {
  id: string
  status: 'open' | 'closed' | 'escalated'
  ai_active: boolean
  last_message_at: string | null
  leads: LeadInfo | LeadInfo[] | null
  channels: ChannelInfo[]
  lastMessage: LastMessage | null
}
interface Message {
  id: string
  created_at: string
  direction: 'inbound' | 'outbound'
  sender_type: 'customer' | 'ai' | 'human'
  content: string | null
  ai_confidence: number | null
}

function leadOf(c: Conversation): LeadInfo | null {
  return Array.isArray(c.leads) ? c.leads[0] ?? null : c.leads
}

function ChannelIcon({ type, className }: { type: string; className?: string }) {
  if (type === 'whatsapp') return <Phone className={className} />
  if (type === 'website_chat') return <Globe className={className} />
  if (type === 'email') return <Mail className={className} />
  return <MessageSquare className={className} />
}

function timeAgo(iso: string | null): string {
  if (!iso) return ''
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

export default function InboxPage() {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [selected, setSelected] = useState<Conversation | null>(null)
  const [statusFilter, setStatusFilter] = useState<'open' | 'escalated' | 'closed' | ''>('')
  const [loading, setLoading] = useState(true)
  const [threadLoading, setThreadLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)
  const [sendNote, setSendNote] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const loadList = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch(`/api/inbox${statusFilter ? `?status=${statusFilter}` : ''}`)
      if (!res.ok) throw new Error(String(res.status))
      const json = await res.json()
      setConversations(json.conversations ?? [])
    } catch {
      setError('Failed to load inbox. The V3 migration may not be applied yet.')
    } finally {
      setLoading(false)
    }
  }, [statusFilter])

  const loadThread = useCallback(async (id: string) => {
    setThreadLoading(true)
    try {
      const res = await fetch(`/api/inbox/${id}`)
      if (!res.ok) throw new Error(String(res.status))
      const json = await res.json()
      setMessages(json.messages ?? [])
      setSelected((prev) => {
        const fromList = conversations.find((c) => c.id === id) ?? null
        return fromList ? { ...fromList, ...json.conversation, channels: json.channels ?? fromList.channels } : { ...json.conversation, channels: json.channels ?? [] , lastMessage: null }
      })
    } catch {
      setError('Failed to load conversation')
    } finally {
      setThreadLoading(false)
    }
  }, [conversations])

  useEffect(() => { loadList() }, [loadList])
  useEffect(() => {
    const t = setInterval(loadList, 20000)
    return () => clearInterval(t)
  }, [loadList])
  useEffect(() => { if (selectedId) loadThread(selectedId) }, [selectedId, loadThread])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  async function sendReply(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedId || !reply.trim()) return
    setSending(true)
    setSendNote(null)
    try {
      const res = await fetch(`/api/inbox/${selectedId}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: reply.trim() }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || 'send failed')
      setReply('')
      if (json.delivered === false) {
        setSendNote(json.detail || 'Recorded — this channel has no live delivery yet.')
      }
      await loadThread(selectedId)
      await loadList()
    } catch (err) {
      setSendNote(err instanceof Error ? err.message : 'Failed to send')
    } finally {
      setSending(false)
    }
  }

  async function toggleAI(next: boolean) {
    if (!selectedId) return
    const res = await fetch(`/api/inbox/${selectedId}/ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ai_active: next }),
    })
    if (res.ok) { await loadThread(selectedId); await loadList() }
  }

  async function setStatus(status: 'open' | 'closed' | 'escalated') {
    if (!selectedId) return
    const res = await fetch(`/api/inbox/${selectedId}/ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    if (res.ok) { await loadThread(selectedId); await loadList() }
  }

  return (
    <div className="h-[calc(100vh-56px)] flex bg-gray-50">
      {/* Conversation list */}
      <div className="w-96 border-r border-gray-200 bg-white flex flex-col">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <h1 className="text-base font-semibold text-gray-900 flex items-center gap-2">
            <InboxIcon className="w-4 h-4" /> Unified Inbox
          </h1>
          <button onClick={loadList} className="text-gray-400 hover:text-gray-700"><RefreshCw className="w-4 h-4" /></button>
        </div>
        <div className="px-3 py-2 border-b border-gray-100 flex gap-1">
          {([['', 'All'], ['open', 'Open'], ['escalated', 'Escalated'], ['closed', 'Closed']] as const).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setStatusFilter(v)}
              className={`px-3 py-1 rounded-full text-xs font-medium ${statusFilter === v ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-6 text-center text-sm text-gray-400">Loading…</div>
          ) : conversations.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-400">
              No conversations yet. WhatsApp and website-chat messages appear here automatically.
            </div>
          ) : (
            conversations.map((c) => {
              const lead = leadOf(c)
              return (
                <button
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  className={`w-full text-left px-4 py-3 border-b border-gray-50 hover:bg-gray-50 ${selectedId === c.id ? 'bg-blue-50' : ''}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {c.channels.slice(0, 2).map((ch, i) => (
                        <ChannelIcon key={i} type={ch.channelType} className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                      ))}
                      <span className="text-sm font-medium text-gray-900 truncate">
                        {lead?.name || lead?.phone || c.channels[0]?.identity || 'Unknown visitor'}
                      </span>
                    </div>
                    <span className="text-xs text-gray-400 shrink-0">{timeAgo(c.last_message_at)}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    {c.ai_active
                      ? <span className="inline-flex items-center gap-1 text-xs text-blue-600"><Bot className="w-3 h-3" /> AI</span>
                      : <span className="inline-flex items-center gap-1 text-xs text-amber-600"><User className="w-3 h-3" /> Human</span>}
                    {c.status !== 'open' && (
                      <span className={`text-xs ${c.status === 'escalated' ? 'text-red-600' : 'text-gray-400'}`}>{c.status}</span>
                    )}
                    <span className="text-xs text-gray-400 truncate">
                      {c.lastMessage?.content ? c.lastMessage.content.slice(0, 48) : ''}
                    </span>
                  </div>
                </button>
              )
            })
          )}
        </div>
      </div>

      {/* Thread */}
      <div className="flex-1 flex flex-col min-w-0">
        {error && (
          <div className="m-4 flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
            <AlertCircle className="w-4 h-4 shrink-0" /> {error}
          </div>
        )}
        {!selectedId ? (
          <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
            Select a conversation
          </div>
        ) : (
          <>
            {/* Thread header */}
            <div className="px-5 py-3 bg-white border-b border-gray-200 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">
                  {leadOf(selected ?? ({} as Conversation))?.name || selected?.channels?.[0]?.identity || 'Conversation'}
                </p>
                <p className="text-xs text-gray-500 truncate">
                  {selected?.channels?.map((ch) => `${ch.channelType}: ${ch.identity}`).join(' · ')}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {selected?.ai_active ? (
                  <button onClick={() => toggleAI(false)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-50 text-amber-700 hover:bg-amber-100">
                    <PauseCircle className="w-3.5 h-3.5" /> Pause AI
                  </button>
                ) : (
                  <button onClick={() => toggleAI(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-50 text-blue-700 hover:bg-blue-100">
                    <PlayCircle className="w-3.5 h-3.5" /> Resume AI
                  </button>
                )}
                {selected?.status !== 'closed' ? (
                  <button onClick={() => setStatus('closed')} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 text-gray-600 hover:bg-gray-200">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Close
                  </button>
                ) : (
                  <button onClick={() => setStatus('open')} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 text-gray-600 hover:bg-gray-200">
                    Reopen
                  </button>
                )}
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              {threadLoading ? (
                <div className="text-center text-sm text-gray-400 py-8">Loading…</div>
              ) : messages.length === 0 ? (
                <div className="text-center text-sm text-gray-400 py-8">No messages recorded yet.</div>
              ) : (
                messages.map((m) => (
                  <div key={m.id} className={`flex ${m.direction === 'inbound' ? 'justify-start' : 'justify-end'}`}>
                    <div className={`max-w-[70%] rounded-2xl px-4 py-2.5 text-sm ${
                      m.direction === 'inbound'
                        ? 'bg-white border border-gray-200 text-gray-900'
                        : m.sender_type === 'ai'
                          ? 'bg-blue-600 text-white'
                          : 'bg-emerald-600 text-white'
                    }`}>
                      <p className="whitespace-pre-wrap break-words">{m.content}</p>
                      <p className={`text-[10px] mt-1 ${m.direction === 'inbound' ? 'text-gray-400' : 'text-white/70'}`}>
                        {m.sender_type === 'ai' ? 'AI' : m.sender_type === 'human' ? 'Agent' : ''}
                        {m.ai_confidence != null ? ` · conf ${Number(m.ai_confidence).toFixed(2)}` : ''}
                        {' · '}
                        {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                ))
              )}
              <div ref={bottomRef} />
            </div>

            {/* Reply box */}
            <form onSubmit={sendReply} className="px-5 py-3 bg-white border-t border-gray-200">
              {sendNote && (
                <p className="text-xs text-amber-600 mb-2 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> {sendNote}</p>
              )}
              <div className="flex items-end gap-2">
                <textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply(e) } }}
                  rows={2}
                  placeholder="Reply as agent… (sending pauses the AI on this conversation)"
                  className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="submit"
                  disabled={sending || !reply.trim()}
                  className="p-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
