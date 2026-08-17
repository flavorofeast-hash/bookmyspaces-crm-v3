'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  MessageSquare,
  Search,
  Phone,
  User,
  Clock,
  CheckCheck,
  RefreshCw,
  Send,
  Loader2,
  Filter,
  ChevronRight,
  Bot,
  Flame,
  Thermometer,
  Snowflake,
  XCircle,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ConversationMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  meta?: {
    sent_to_whatsapp?: boolean
    whatsapp_message_id?: string
    generated_for?: string
    pre_qualification?: boolean
    rejection_reason?: string
  }
}

interface Conversation {
  id: string
  session_id: string
  phone: string | null
  name: string | null
  status: string
  channel: string
  messages: ConversationMessage[]
  is_active: boolean
  created_at: string
  updated_at: string
  lead?: {
    id: string
    lead_temperature?: string
    ai_score?: number
    status?: string
    event_type?: string
    guest_count?: number
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function formatMessageTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })
}

function TemperatureBadge({ temp }: { temp?: string }) {
  if (!temp) return null
  const cfg = {
    HOT: { icon: Flame, color: 'text-red-600 bg-red-50', label: 'HOT' },
    WARM: { icon: Thermometer, color: 'text-orange-600 bg-orange-50', label: 'WARM' },
    COLD: { icon: Snowflake, color: 'text-blue-600 bg-blue-50', label: 'COLD' },
  }[temp]
  if (!cfg) return null
  const Icon = cfg.icon
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium ${cfg.color}`}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  )
}

// ─── Conversation List Item ───────────────────────────────────────────────────

function ConvListItem({
  conv,
  selected,
  onSelect,
}: {
  conv: Conversation
  selected: boolean
  onSelect: () => void
}) {
  const lastMsg = conv.messages?.[conv.messages.length - 1]
  const unread = conv.messages?.filter(
    (m) => m.role === 'assistant' && !m.meta?.sent_to_whatsapp
  ).length ?? 0

  return (
    <button
      onClick={onSelect}
      className={`w-full text-left px-4 py-3.5 border-b border-gray-100 hover:bg-gray-50 transition-colors ${
        selected ? 'bg-blue-50 border-l-2 border-l-blue-600' : ''
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center flex-shrink-0">
          <span className="text-white text-sm font-semibold">
            {(conv.name ?? conv.phone ?? '?').charAt(0).toUpperCase()}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-0.5">
            <p className="text-sm font-medium text-gray-900 truncate">
              {conv.name ?? conv.phone ?? 'Unknown'}
            </p>
            <span className="text-xs text-gray-400 flex-shrink-0 ml-2">
              {timeAgo(conv.updated_at)}
            </span>
          </div>
          {conv.lead && (
            <div className="mb-1">
              <TemperatureBadge temp={conv.lead.lead_temperature} />
            </div>
          )}
          {lastMsg && (
            <p className="text-xs text-gray-500 truncate">
              {lastMsg.role === 'assistant' && (
                <Bot className="w-3 h-3 inline mr-1 text-blue-400" />
              )}
              {lastMsg.content}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          {unread > 0 && (
            <span className="w-5 h-5 bg-blue-600 text-white text-xs rounded-full flex items-center justify-center">
              {unread}
            </span>
          )}
          <ChevronRight className="w-4 h-4 text-gray-300" />
        </div>
      </div>
    </button>
  )
}

// ─── Message Bubble ───────────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: ConversationMessage }) {
  const isUser = msg.role === 'user'
  const isPreQual = msg.meta?.pre_qualification === true

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-2`}>
      {!isUser && (
        <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0 mr-2 mt-1">
          <Bot className="w-4 h-4 text-blue-600" />
        </div>
      )}
      <div
        className={`max-w-[75%] px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed ${
          isUser
            ? 'bg-green-100 text-gray-800 rounded-br-sm'
            : isPreQual
            ? 'bg-amber-50 text-amber-900 border border-amber-200 rounded-bl-sm'
            : 'bg-white text-gray-800 border border-gray-100 shadow-sm rounded-bl-sm'
        }`}
      >
        {isPreQual && (
          <p className="text-xs font-medium text-amber-600 mb-1">Capacity Notice</p>
        )}
        <p className="whitespace-pre-wrap">{msg.content}</p>
        <div className="flex items-center justify-end gap-1 mt-1.5">
          <span className="text-xs text-gray-400">{formatMessageTime(msg.timestamp)}</span>
          {!isUser && msg.meta?.sent_to_whatsapp === true && (
            <CheckCheck className="w-3 h-3 text-blue-500" />
          )}
          {!isUser && msg.meta?.sent_to_whatsapp === false && (
            <div title="Not yet sent to WhatsApp">
              <Clock className="w-3 h-3 text-gray-300" />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function WhatsAppPage() {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // FIX 1: Separate loading states.
  // `initialLoading` only shows the spinner on first load.
  // Background polls NEVER show the spinner — they update silently.
  const [initialLoading, setInitialLoading] = useState(true)

  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'hot' | 'active' | 'unread'>('all')
  const [replyText, setReplyText] = useState('')
  const [sending, setSending] = useState(false)

  // FIX 2: Track selected ID as a ref so fetchConversations never needs
  // it in its dependency array. This breaks the dep chain that was causing
  // the interval to reset on every conversation click.
  const selectedIdRef = useRef<string | null>(null)
  selectedIdRef.current = selectedId

  // FIX 3: fetchConversations has NO dependencies.
  // It reads selectedId from the ref (always current) without being
  // recreated when selectedId changes. This means the interval is set up
  // exactly once and never torn down until the component unmounts.
  const fetchConversations = useCallback(async (isBackground = false) => {
    // Background polls: never show loading spinner
    if (!isBackground) setInitialLoading(true)
    try {
      const res = await fetch('/api/conversations')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const list: Conversation[] = Array.isArray(data)
        ? data
        : (data.conversations ?? [])

      setConversations(list)

      // FIX 4: Update selected conversation using the ref value.
      // No dependency on `selected` state — reads current value from ref.
      const currentId = selectedIdRef.current
      if (currentId) {
        const updated = list.find((c) => c.id === currentId)
        // Only update if messages actually changed — prevents unnecessary renders
        if (updated) {
          setConversations((prev) => {
            const idx = prev.findIndex((c) => c.id === currentId)
            if (idx === -1) return prev
            // Shallow compare message count to avoid setState if nothing changed
            if (prev[idx].messages?.length === updated.messages?.length &&
                prev[idx].updated_at === updated.updated_at) {
              return prev
            }
            const next = [...prev]
            next[idx] = updated
            return next
          })
        }
      }
    } catch {
      // On error, keep existing data — don't wipe the UI
    } finally {
      if (!isBackground) setInitialLoading(false)
    }
  }, []) // ← empty deps: this function never changes

  useEffect(() => {
    // Initial load — shows spinner once
    fetchConversations(false)

    // FIX 5: Background poll at 30s — passes isBackground=true so no spinner.
    // Because fetchConversations never changes, this interval is created once
    // and never recreated. No flicker, no loop.
    const interval = setInterval(() => fetchConversations(true), 30_000)
    return () => clearInterval(interval)
  }, [fetchConversations]) // fetchConversations is stable — this runs once

  async function handleSendReply() {
    if (!replyText.trim() || !selected?.phone || sending) return

    setSending(true)
    try {
      await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: selected.phone,
          message: replyText,
          conversationId: selected.id,
        }),
      })
      setReplyText('')
      // After sending, do a silent background refresh
      await fetchConversations(true)
    } finally {
      setSending(false)
    }
  }

  // Derive selected conversation from the list — no separate state for the object
  // This means it always reflects latest data without an extra setState
  const selected = conversations.find((c) => c.id === selectedId) ?? null

  // Filtered list
  const filtered = conversations.filter((c) => {
    const searchLower = search.toLowerCase()
    const matchesSearch =
      !search ||
      c.name?.toLowerCase().includes(searchLower) ||
      c.phone?.includes(search) ||
      c.messages?.some((m) => m.content.toLowerCase().includes(searchLower))

    const matchesFilter =
      filter === 'all' ||
      (filter === 'hot' && c.lead?.lead_temperature === 'HOT') ||
      (filter === 'active' && c.is_active) ||
      (filter === 'unread' &&
        c.messages?.some((m) => m.role === 'assistant' && !m.meta?.sent_to_whatsapp))

    return matchesSearch && matchesFilter
  })

  const messageList = selected?.messages ?? []

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      {/* Sidebar */}
      <div className="w-80 flex-shrink-0 flex flex-col bg-white border-r border-gray-200">
        {/* Header */}
        <div className="px-4 py-4 border-b border-gray-100">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-green-600" />
              <h1 className="text-base font-semibold text-gray-900">WhatsApp</h1>
              <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                {conversations.length}
              </span>
            </div>
            {/* Manual refresh button — uses background mode so no spinner */}
            <button
              onClick={() => fetchConversations(true)}
              className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
              title="Refresh"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>

          {/* Search */}
          <div className="relative mb-2">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search conversations..."
              className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Filters */}
          <div className="flex gap-1">
            {(['all', 'hot', 'active', 'unread'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`flex-1 py-1 text-xs font-medium rounded-lg capitalize transition-colors ${
                  filter === f
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {initialLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 px-4">
              <MessageSquare className="w-8 h-8 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-500">
                {search
                  ? 'No conversations match your search.'
                  : 'No conversations yet.'}
              </p>
            </div>
          ) : (
            filtered.map((c) => (
              <ConvListItem
                key={c.id}
                conv={c}
                selected={selectedId === c.id}
                onSelect={() => setSelectedId(c.id)}
              />
            ))
          )}
        </div>
      </div>

      {/* Chat panel */}
      {selected ? (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Conversation header */}
          <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-gray-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center">
                <span className="text-white text-sm font-semibold">
                  {(selected.name ?? selected.phone ?? '?').charAt(0).toUpperCase()}
                </span>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-gray-900">
                    {selected.name ?? 'Unknown'}
                  </p>
                  <TemperatureBadge temp={selected.lead?.lead_temperature} />
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-400 mt-0.5">
                  {selected.phone && (
                    <span className="flex items-center gap-1">
                      <Phone className="w-3 h-3" />
                      {selected.phone}
                    </span>
                  )}
                  {selected.lead?.event_type && (
                    <span className="capitalize">
                      {selected.lead.event_type.toLowerCase()}
                    </span>
                  )}
                  {selected.lead?.guest_count && (
                    <span className="flex items-center gap-1">
                      <User className="w-3 h-3" />
                      {selected.lead.guest_count} guests
                    </span>
                  )}
                  {selected.lead?.ai_score !== undefined && (
                    <span>Score: {selected.lead.ai_score}</span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
                  selected.is_active
                    ? 'text-green-700 bg-green-100'
                    : 'text-gray-600 bg-gray-100'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    selected.is_active ? 'bg-green-500' : 'bg-gray-400'
                  }`}
                />
                {selected.is_active ? 'Active' : 'Inactive'}
              </span>
              <span className="text-xs text-gray-400">
                {messageList.length} message{messageList.length !== 1 ? 's' : ''}
              </span>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-6 py-4 bg-gray-50">
            {messageList.length === 0 ? (
              <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                No messages in this conversation.
              </div>
            ) : (
              messageList.map((msg, idx) => (
                <MessageBubble key={`${msg.timestamp}-${idx}`} msg={msg} />
              ))
            )}
          </div>

          {/* Reply input */}
          <div className="px-6 py-4 bg-white border-t border-gray-200">
            <div className="flex items-center gap-3">
              <div className="flex-1 relative">
                <textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleSendReply()
                    }
                  }}
                  placeholder="Type a manual reply (Enter to send, Shift+Enter for new line)..."
                  rows={2}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>
              <button
                onClick={handleSendReply}
                disabled={!replyText.trim() || sending}
                className="p-3 bg-green-600 text-white rounded-xl hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0 transition-colors"
                title="Send WhatsApp message"
              >
                {sending ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Send className="w-5 h-5" />
                )}
              </button>
            </div>
            <p className="mt-1.5 text-xs text-gray-400 flex items-center gap-1">
              <Filter className="w-3 h-3" />
              Manual replies bypass AI and send directly via WhatsApp Cloud API.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center bg-gray-50 text-center px-8">
          <div className="w-16 h-16 bg-green-100 rounded-2xl flex items-center justify-center mb-4">
            <MessageSquare className="w-8 h-8 text-green-600" />
          </div>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">
            WhatsApp Conversations
          </h2>
          <p className="text-sm text-gray-500 max-w-xs">
            Select a conversation from the left to view messages and send manual
            replies.
          </p>
          <div className="mt-6 grid grid-cols-3 gap-3 text-center text-xs text-gray-400">
            <div className="bg-white rounded-xl p-3 border border-gray-100">
              <p className="text-lg font-bold text-gray-900">
                {conversations.length}
              </p>
              <p>Total</p>
            </div>
            <div className="bg-white rounded-xl p-3 border border-gray-100">
              <p className="text-lg font-bold text-red-600">
                {conversations.filter((c) => c.lead?.lead_temperature === 'HOT').length}
              </p>
              <p>Hot Leads</p>
            </div>
            <div className="bg-white rounded-xl p-3 border border-gray-100">
              <p className="text-lg font-bold text-green-600">
                {conversations.filter((c) => c.is_active).length}
              </p>
              <p>Active</p>
            </div>
          </div>
        </div>
      )}

      {/* Close selected on mobile */}
      {selected && (
        <button
          onClick={() => setSelectedId(null)}
          className="fixed top-4 left-4 z-10 md:hidden p-2 bg-white rounded-lg shadow border border-gray-200"
        >
          <XCircle className="w-5 h-5 text-gray-600" />
        </button>
      )}
    </div>
  )
}
