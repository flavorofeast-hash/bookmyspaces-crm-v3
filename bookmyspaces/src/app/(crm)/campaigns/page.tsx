'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Megaphone,
  Plus,
  Send,
  Users,
  Clock,
  CheckCircle,
  XCircle,
  Loader2,
  BarChart3,
  Trash2,
  Eye,
  RefreshCw,
  Brain,
  Calendar,
  Pause,
  Play,
  Ban,
  Repeat,
  Bookmark,
  IndianRupee,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Campaign {
  id: string
  name: string
  type: string
  // Priority 3 (Campaign Scheduler) — 'paused'/'cancelled' added via
  // migration 021, alongside the recurrence fields below.
  status: 'draft' | 'scheduled' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'
  message_template: string
  recipient_count: number
  sent_count: number
  delivered_count: number
  failed_count: number
  reply_count: number
  created_at: string
  scheduled_at?: string
  sent_at?: string
  is_recurring?: boolean
  recurrence_interval?: 'daily' | 'weekly' | 'monthly' | null
  next_run_at?: string | null
}

type CampaignType =
  | 'festival'
  | 'followup'
  | 'reengagement'
  | 'offer'
  | 'review_request'
  | 'birthday'
  | 'anniversary'
  | 'dormant'
  | 'custom'

interface NewCampaign {
  name: string
  type: CampaignType
  message_template: string
  segment: {
    status?: string
    min_score?: number
    source?: string
    // Priority 2 (Marketing Automation) — Birthday / Anniversary / Dormant
    // segment filters. Maps directly to SegmentFilter's matching fields in
    // src/lib/campaigns.ts; the API passes `segment` straight through to
    // buildSegment() unchanged.
    upcoming_birthday_days?: number
    upcoming_anniversary_days?: number
    dormant_since_days?: number
    // Priority 3 (Marketing Intelligence) — Advanced Segmentation. Maps
    // directly to the matching SegmentFilter fields added to
    // src/lib/campaigns.ts's buildSegment() this same pass.
    is_vip?: boolean
    min_clv?: number
    repeat_customer?: boolean
    first_time_customer?: boolean
    proposal_abandoned_days?: number
    has_cancelled_booking?: boolean
    min_stay_nights?: number
    high_value_wedding_min?: number
    is_corporate?: boolean
  }
  scheduled_at: string
  // Priority 3 (Campaign Scheduler) — recurring campaign support.
  is_recurring?: boolean
  recurrence_interval?: 'daily' | 'weekly' | 'monthly'
  // Growth Platform Phase 1 (Campaign ROI / Saved Segments, migration 030).
  budget?: number
  segment_id?: string
}

interface SavedSegment {
  id: string
  name: string
  description: string | null
  filter: NewCampaign['segment']
  use_count: number
}

// Reasonable starting points for the "days" input on each recurring-segment
// campaign type — the operator sees and can change this before counting
// recipients or sending; nothing is sent using a hidden default.
const SEGMENT_DAYS_DEFAULT: Partial<Record<CampaignType, number>> = {
  birthday: 7,
  anniversary: 7,
  dormant: 30,
}

// Advanced Segmentation audience presets — each maps to one SegmentFilter
// field (or two, for high-value weddings) so the operator picks a plain-
// English audience instead of hand-building a filter object.
const AUDIENCE_PRESETS: Array<{ value: string; label: string; apply: (seg: NewCampaign['segment']) => NewCampaign['segment'] }> = [
  { value: 'none', label: 'All opted-in leads (default)', apply: (s) => s },
  { value: 'vip', label: 'VIP customers', apply: (s) => ({ ...s, is_vip: true }) },
  { value: 'corporate', label: 'Corporate customers', apply: (s) => ({ ...s, is_corporate: true }) },
  { value: 'high_clv', label: 'High CLV (₹1L+)', apply: (s) => ({ ...s, min_clv: 100_000 }) },
  { value: 'repeat', label: 'Repeat customers', apply: (s) => ({ ...s, repeat_customer: true }) },
  { value: 'first_time', label: 'First-time customers', apply: (s) => ({ ...s, first_time_customer: true }) },
  { value: 'abandoned', label: 'Proposal abandoned (7+ days)', apply: (s) => ({ ...s, proposal_abandoned_days: 7 }) },
  { value: 'cancelled', label: 'Had a cancelled booking', apply: (s) => ({ ...s, has_cancelled_booking: true }) },
  { value: 'long_stay', label: 'Long-stay guests (3+ nights)', apply: (s) => ({ ...s, min_stay_nights: 3 }) },
  { value: 'high_value_wedding', label: 'High-value weddings (₹3L+ est.)', apply: (s) => ({ ...s, high_value_wedding_min: 300_000 }) },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  Campaign['status'],
  { label: string; color: string; icon: React.ElementType }
> = {
  draft: { label: 'Draft', color: 'text-gray-600 bg-gray-100', icon: Clock },
  scheduled: { label: 'Scheduled', color: 'text-blue-700 bg-blue-100', icon: Calendar },
  running: { label: 'Running', color: 'text-yellow-700 bg-yellow-100', icon: Loader2 },
  paused: { label: 'Paused', color: 'text-orange-700 bg-orange-100', icon: Pause },
  completed: { label: 'Completed', color: 'text-green-700 bg-green-100', icon: CheckCircle },
  failed: { label: 'Failed', color: 'text-red-700 bg-red-100', icon: XCircle },
  cancelled: { label: 'Cancelled', color: 'text-gray-500 bg-gray-100', icon: Ban },
}

const CAMPAIGN_TYPES: { value: CampaignType; label: string }[] = [
  { value: 'festival', label: 'Festival / Holiday' },
  { value: 'followup', label: 'Follow-Up' },
  { value: 'reengagement', label: 'Re-engagement' },
  { value: 'offer', label: 'Special Offer' },
  { value: 'review_request', label: 'Review Request' },
  { value: 'birthday', label: 'Birthday' },
  { value: 'anniversary', label: 'Anniversary' },
  { value: 'dormant', label: 'Dormant Customers' },
  { value: 'custom', label: 'Custom' },
]

function StatCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string
  value: string | number
  icon: React.ElementType
  color: string
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">{label}</p>
        <div className={`p-1.5 rounded-lg ${color}`}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
    </div>
  )
}

// ─── Campaign Row ─────────────────────────────────────────────────────────────

function CampaignRow({
  campaign,
  onDelete,
  onAction,
  actionPending,
  roi,
}: {
  campaign: Campaign
  onDelete: (id: string) => void
  onAction: (id: string, action: 'send' | 'pause' | 'resume' | 'cancel') => void
  actionPending: boolean
  roi?: CampaignROIRow
}) {
  const cfg = STATUS_CONFIG[campaign.status]
  const Icon = cfg.icon
  const deliveryRate =
    campaign.sent_count > 0
      ? Math.round((campaign.delivered_count / campaign.sent_count) * 100)
      : 0

  return (
    <tr className="hover:bg-gray-50 transition-colors">
      <td className="px-4 py-3">
        <p className="text-sm font-medium text-gray-900">{campaign.name}</p>
        <p className="text-xs text-gray-500 capitalize flex items-center gap-1">
          {campaign.type.replace('_', ' ')}
          {campaign.is_recurring && (
            <span className="inline-flex items-center gap-0.5 text-violet-600" title={`Recurring: ${campaign.recurrence_interval}`}>
              <Repeat className="w-3 h-3" /> {campaign.recurrence_interval}
            </span>
          )}
        </p>
      </td>
      <td className="px-4 py-3">
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${cfg.color}`}>
          <Icon className="w-3 h-3" />
          {cfg.label}
        </span>
      </td>
      <td className="px-4 py-3 text-sm text-gray-700 text-right">
        {campaign.recipient_count.toLocaleString()}
      </td>
      <td className="px-4 py-3 text-sm text-gray-700 text-right">
        {campaign.sent_count.toLocaleString()}
      </td>
      <td className="px-4 py-3 text-right">
        <span className={`text-sm font-medium ${deliveryRate >= 90 ? 'text-green-600' : deliveryRate >= 70 ? 'text-yellow-600' : 'text-red-600'}`}>
          {campaign.sent_count > 0 ? `${deliveryRate}%` : '—'}
        </span>
      </td>
      <td className="px-4 py-3 text-sm text-gray-500 text-right">
        {campaign.reply_count}
      </td>
      <td className="px-4 py-3 text-right" title="Same Revenue Attribution figure shown on the Marketing Dashboard's Campaign Performance section">
        {roi ? (
          <>
            <span className="text-sm font-medium text-gray-700">{roi.bookings}</span>
            <span className="block text-xs text-gray-400">₹{roi.revenue.toLocaleString('en-IN')}{roi.roiAvailable ? ` · ${roi.roi}x ROI` : ''}</span>
          </>
        ) : (
          <span className="text-sm text-gray-300">—</span>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-1">
          {campaign.status === 'draft' && (
            <button
              onClick={() => onAction(campaign.id, 'send')}
              disabled={actionPending}
              className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors disabled:opacity-50"
              title="Send campaign (queues messages)"
            >
              <Send className="w-4 h-4" />
            </button>
          )}
          {(campaign.status === 'running' || campaign.status === 'scheduled') && (
            <button
              onClick={() => onAction(campaign.id, 'pause')}
              disabled={actionPending}
              className="p-1.5 text-gray-400 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition-colors disabled:opacity-50"
              title="Pause campaign"
            >
              <Pause className="w-4 h-4" />
            </button>
          )}
          {campaign.status === 'paused' && (
            <button
              onClick={() => onAction(campaign.id, 'resume')}
              disabled={actionPending}
              className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors disabled:opacity-50"
              title="Resume campaign"
            >
              <Play className="w-4 h-4" />
            </button>
          )}
          {(campaign.status === 'running' || campaign.status === 'scheduled' || campaign.status === 'paused') && (
            <button
              onClick={() => onAction(campaign.id, 'cancel')}
              disabled={actionPending}
              className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
              title="Cancel campaign"
            >
              <Ban className="w-4 h-4" />
            </button>
          )}
          <button
            className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
            title="View details"
          >
            <Eye className="w-4 h-4" />
          </button>
          <button
            onClick={() => onDelete(campaign.id)}
            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            title="Delete campaign"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </td>
    </tr>
  )
}

// ─── Create Campaign Modal ────────────────────────────────────────────────────

function CreateModal({
  onClose,
  onCreate,
}: {
  onClose: () => void
  onCreate: (data: NewCampaign) => Promise<void>
}) {
  const [form, setForm] = useState<NewCampaign>({
    name: '',
    type: 'followup',
    message_template: '',
    segment: {},
    scheduled_at: '',
    is_recurring: false,
    recurrence_interval: 'weekly',
  })
  const [dryRun, setDryRun] = useState(false)
  const [dryRunCount, setDryRunCount] = useState<number | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [counting, setCounting] = useState(false)
  const [audiencePreset, setAudiencePreset] = useState('none')
  const [aiGoal, setAiGoal] = useState('')
  const [aiDrafting, setAiDrafting] = useState(false)
  const [aiBrief, setAiBrief] = useState<{ suggestedAudience: string; bestSendTime: string; cta: string; emailSubject: string; emailBody: string } | null>(null)

  // Growth Platform Phase 1 — Saved Segments.
  const [segments, setSegments] = useState<SavedSegment[]>([])
  const [selectedSegmentId, setSelectedSegmentId] = useState('')
  const [savingSegment, setSavingSegment] = useState(false)
  const [newSegmentName, setNewSegmentName] = useState('')
  const [showSaveSegment, setShowSaveSegment] = useState(false)

  useEffect(() => {
    fetch('/api/marketing/segments')
      .then((res) => res.json())
      .then((data) => setSegments(Array.isArray(data.segments) ? data.segments : []))
      .catch(() => setSegments([]))
  }, [])

  // Growth Platform Phase 3 — Message Templates. Only WhatsApp templates are
  // offered here since that's the only channel this campaign form actually
  // sends through; email templates are managed from Content Studio.
  const [templates, setTemplates] = useState<{ id: string; name: string; body: string; use_count: number }[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState('')

  useEffect(() => {
    fetch('/api/marketing/templates?channel=whatsapp')
      .then((res) => res.json())
      .then((data) => setTemplates(Array.isArray(data.templates) ? data.templates : []))
      .catch(() => setTemplates([]))
  }, [])

  function handleLoadTemplate(id: string) {
    setSelectedTemplateId(id)
    const tpl = templates.find((t) => t.id === id)
    if (!tpl) return
    setForm((p) => ({ ...p, message_template: tpl.body }))
    fetch('/api/marketing/templates', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action: 'mark_used' }),
    }).catch(() => {})
  }

  async function handleSaveSegment() {
    if (!newSegmentName.trim()) return
    setSavingSegment(true)
    try {
      const res = await fetch('/api/marketing/segments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newSegmentName.trim(), filter: form.segment }),
      })
      const data = await res.json()
      if (data.segment) {
        setSegments((p) => [data.segment, ...p])
        setSelectedSegmentId(data.segment.id)
        setForm((p) => ({ ...p, segment_id: data.segment.id }))
        setNewSegmentName('')
        setShowSaveSegment(false)
      }
    } finally {
      setSavingSegment(false)
    }
  }

  async function handleAiDraft() {
    if (!aiGoal.trim()) return
    setAiDrafting(true)
    setAiBrief(null)
    try {
      const res = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'generate_brief', goal: aiGoal.trim() }),
      })
      const data = await res.json()
      if (data.brief) {
        setForm((p) => ({ ...p, name: data.brief.title, message_template: data.brief.whatsappMessage }))
        setAiBrief({
          suggestedAudience: data.brief.suggestedAudience,
          bestSendTime: data.brief.bestSendTime,
          cta: data.brief.cta,
          emailSubject: data.brief.emailSubject,
          emailBody: data.brief.emailBody,
        })
      }
    } finally {
      setAiDrafting(false)
    }
  }

  async function handleDryRun() {
    setCounting(true)
    try {
      const res = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, dry_run: true }),
      })
      const data = await res.json()
      setDryRunCount(data.count ?? 0)
    } catch {
      setDryRunCount(null)
    } finally {
      setCounting(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    try {
      await onCreate(form)
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">New Campaign</h2>
          <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-700">
            <XCircle className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">

          {/* AI Campaign Builder (Priority 3) — drafts, never sends. */}
          <div className="rounded-lg border border-violet-100 bg-violet-50 p-3">
            <label className="block text-xs font-semibold text-violet-700 mb-1.5 flex items-center gap-1">
              <Brain className="w-3.5 h-3.5" /> AI Campaign Builder — describe your goal
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={aiGoal}
                onChange={(e) => setAiGoal(e.target.value)}
                placeholder="e.g. Win back customers who haven't booked in 3 months"
                className="flex-1 px-3 py-2 border border-violet-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
              />
              <button
                type="button"
                onClick={() => void handleAiDraft()}
                disabled={aiDrafting || !aiGoal.trim()}
                className="px-3 py-2 bg-violet-600 text-white rounded-lg text-xs font-medium hover:bg-violet-700 disabled:opacity-50 flex items-center gap-1.5"
              >
                {aiDrafting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Draft'}
              </button>
            </div>
            {aiBrief && (
              <div className="mt-2 text-xs text-violet-800 space-y-1">
                <p><span className="font-semibold">Suggested audience:</span> {aiBrief.suggestedAudience}</p>
                <p><span className="font-semibold">Best send time:</span> {aiBrief.bestSendTime}</p>
                <p><span className="font-semibold">CTA:</span> {aiBrief.cta}</p>
                <p className="text-violet-600">Name and WhatsApp message below were filled in — review and edit before sending. Email draft: <span className="font-semibold">{aiBrief.emailSubject}</span> — {aiBrief.emailBody}</p>
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Campaign Name</label>
            <input
              type="text"
              required
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Durga Puja Special Offer"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Campaign Type</label>
            <select
              value={form.type}
              onChange={(e) => {
                const nextType = e.target.value as CampaignType
                setForm((p) => {
                  // Switching away from a recurring-segment type clears its
                  // day-window field so it doesn't linger in the payload;
                  // switching into one seeds the suggested default.
                  const { upcoming_birthday_days, upcoming_anniversary_days, dormant_since_days, ...rest } = p.segment
                  const seeded =
                    nextType === 'birthday' ? { upcoming_birthday_days: SEGMENT_DAYS_DEFAULT.birthday } :
                    nextType === 'anniversary' ? { upcoming_anniversary_days: SEGMENT_DAYS_DEFAULT.anniversary } :
                    nextType === 'dormant' ? { dormant_since_days: SEGMENT_DAYS_DEFAULT.dormant } :
                    {}
                  return { ...p, type: nextType, segment: { ...rest, ...seeded } }
                })
              }}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {CAMPAIGN_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          {form.type === 'birthday' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Birthday within next (days)</label>
              <input
                type="number"
                min={1}
                max={90}
                value={form.segment.upcoming_birthday_days ?? SEGMENT_DAYS_DEFAULT.birthday}
                onChange={(e) => setForm((p) => ({ ...p, segment: { ...p.segment, upcoming_birthday_days: Number(e.target.value) || 1 } }))}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="mt-1 text-xs text-gray-400">Matches leads with a birthday on file (from Customer Bulk Import) in this window.</p>
            </div>
          )}
          {form.type === 'anniversary' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Anniversary within next (days)</label>
              <input
                type="number"
                min={1}
                max={90}
                value={form.segment.upcoming_anniversary_days ?? SEGMENT_DAYS_DEFAULT.anniversary}
                onChange={(e) => setForm((p) => ({ ...p, segment: { ...p.segment, upcoming_anniversary_days: Number(e.target.value) || 1 } }))}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="mt-1 text-xs text-gray-400">Matches leads with an anniversary on file in this window.</p>
            </div>
          )}
          {form.type === 'dormant' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">No contact in at least (days)</label>
              <input
                type="number"
                min={7}
                max={365}
                value={form.segment.dormant_since_days ?? SEGMENT_DAYS_DEFAULT.dormant}
                onChange={(e) => setForm((p) => ({ ...p, segment: { ...p.segment, dormant_since_days: Number(e.target.value) || 7 } }))}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="mt-1 text-xs text-gray-400">Matches leads never contacted, or not contacted in this many days.</p>
            </div>
          )}

          {/* Saved Segments (Growth Platform Phase 1) — load a previously
              named audience, or save the currently-built filter for reuse
              across future campaigns. Loading a segment replaces the
              current segment filter outright; it does not merge. */}
          <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-3 space-y-2">
            <label className="block text-xs font-semibold text-emerald-700 flex items-center gap-1">
              <Bookmark className="w-3.5 h-3.5" /> Saved Segments
            </label>
            <div className="flex gap-2">
              <select
                value={selectedSegmentId}
                onChange={(e) => {
                  const id = e.target.value
                  setSelectedSegmentId(id)
                  const seg = segments.find((s) => s.id === id)
                  if (seg) {
                    setAudiencePreset('none')
                    setForm((p) => ({ ...p, segment: seg.filter, segment_id: seg.id }))
                  } else {
                    setForm((p) => ({ ...p, segment_id: undefined }))
                  }
                }}
                className="flex-1 px-3 py-2 border border-emerald-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-400"
              >
                <option value="">Don&apos;t load a saved segment</option>
                {segments.map((s) => (
                  <option key={s.id} value={s.id}>{s.name} (used {s.use_count}x)</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setShowSaveSegment((v) => !v)}
                className="px-3 py-2 bg-emerald-600 text-white rounded-lg text-xs font-medium hover:bg-emerald-700"
              >
                Save Current
              </button>
            </div>
            {showSaveSegment && (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newSegmentName}
                  onChange={(e) => setNewSegmentName(e.target.value)}
                  placeholder="Segment name, e.g. VIP Wedding Leads"
                  className="flex-1 px-3 py-2 border border-emerald-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                />
                <button
                  type="button"
                  onClick={() => void handleSaveSegment()}
                  disabled={savingSegment || !newSegmentName.trim()}
                  className="px-3 py-2 bg-emerald-600 text-white rounded-lg text-xs font-medium hover:bg-emerald-700 disabled:opacity-50"
                >
                  {savingSegment ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Save'}
                </button>
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Audience (optional refinement)</label>
            <select
              value={audiencePreset}
              onChange={(e) => {
                const preset = AUDIENCE_PRESETS.find((p) => p.value === e.target.value)
                setAudiencePreset(e.target.value)
                if (!preset) return
                setForm((p) => {
                  // Strip any previously-applied preset fields, keep the
                  // campaign type's own segment fields (birthday/anniversary/
                  // dormant days), then layer the newly-picked preset on top.
                  const {
                    is_vip, min_clv, repeat_customer, first_time_customer,
                    proposal_abandoned_days, has_cancelled_booking, min_stay_nights,
                    high_value_wedding_min, is_corporate, ...rest
                  } = p.segment
                  void is_vip; void min_clv; void repeat_customer; void first_time_customer
                  void proposal_abandoned_days; void has_cancelled_booking; void min_stay_nights
                  void high_value_wedding_min; void is_corporate
                  return { ...p, segment: preset.apply(rest) }
                })
              }}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {AUDIENCE_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
            <p className="mt-1 text-xs text-gray-400">Narrows the recipient list beyond the campaign type&apos;s own segment. Use Count Recipients below to check size before sending.</p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-gray-700">Message Template</label>
              {templates.length > 0 && (
                <select
                  value={selectedTemplateId}
                  onChange={(e) => handleLoadTemplate(e.target.value)}
                  className="text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-400"
                >
                  <option value="">Load a saved WhatsApp template…</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>{t.name} (used {t.use_count}x)</option>
                  ))}
                </select>
              )}
            </div>
            <textarea
              required
              rows={4}
              value={form.message_template}
              onChange={(e) => setForm((p) => ({ ...p, message_template: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              placeholder="Hi {{name}}, BookMySpaces has a special offer for you this festive season..."
            />
            <div className="flex items-center justify-between mt-1">
              <p className="text-xs text-gray-400">
                Use {'{{name}}'} as a placeholder for the customer name.
              </p>
              <button
                type="button"
                onClick={async () => {
                  const name = window.prompt('Save this message as a template named:')
                  if (!name?.trim() || !form.message_template.trim()) return
                  const res = await fetch('/api/marketing/templates', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: name.trim(), channel: 'whatsapp', body: form.message_template }),
                  })
                  const data = await res.json()
                  if (data.template) setTemplates((p) => [data.template, ...p])
                }}
                className="text-xs text-blue-600 hover:text-blue-800 font-medium"
              >
                Save as template
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1">
              <IndianRupee className="w-3.5 h-3.5" /> Budget (optional)
            </label>
            <input
              type="number"
              min={0}
              value={form.budget ?? ''}
              onChange={(e) => setForm((p) => ({ ...p, budget: e.target.value ? Number(e.target.value) : undefined }))}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g. 5000"
            />
            <p className="mt-1 text-xs text-gray-400">Enables Campaign ROI tracking on the Marketing Dashboard (revenue attributed to this campaign ÷ budget).</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Schedule Date &amp; Time (optional)
            </label>
            <input
              type="datetime-local"
              value={form.scheduled_at}
              onChange={(e) => setForm((p) => ({ ...p, scheduled_at: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Recurring campaign (Priority 3: Campaign Scheduler) — segment
              is rebuilt fresh each run, so e.g. a "dormant 30+ days" or
              "upcoming birthday" campaign stays accurate over time instead
              of re-sending to the same fixed list. */}
          <div className="flex items-center gap-3 p-3 bg-violet-50 rounded-lg">
            <input
              type="checkbox"
              id="recurring"
              checked={!!form.is_recurring}
              onChange={(e) => setForm((p) => ({ ...p, is_recurring: e.target.checked }))}
              className="rounded border-gray-300 text-violet-600"
            />
            <label htmlFor="recurring" className="text-sm text-gray-700 flex-1 flex items-center gap-1.5">
              <Repeat className="w-3.5 h-3.5 text-violet-600" /> Repeat this campaign automatically
            </label>
            {form.is_recurring && (
              <select
                value={form.recurrence_interval ?? 'weekly'}
                onChange={(e) => setForm((p) => ({ ...p, recurrence_interval: e.target.value as 'daily' | 'weekly' | 'monthly' }))}
                className="px-2 py-1.5 border border-violet-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-violet-400"
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            )}
          </div>

          {/* Dry run section */}
          <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
            <input
              type="checkbox"
              id="dry-run"
              checked={dryRun}
              onChange={(e) => setDryRun(e.target.checked)}
              className="rounded border-gray-300 text-blue-600"
            />
            <label htmlFor="dry-run" className="text-sm text-gray-700 flex-1">
              Dry run (count only, do not send)
            </label>
            {dryRun && (
              <button
                type="button"
                onClick={handleDryRun}
                disabled={counting}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 disabled:opacity-60"
              >
                {counting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Users className="w-3 h-3" />}
                Count Recipients
              </button>
            )}
          </div>

          {dryRunCount !== null && (
            <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 px-3 py-2 rounded-lg">
              <CheckCircle className="w-4 h-4" />
              {dryRunCount} recipient{dryRunCount !== 1 ? 's' : ''} would receive this message.
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 border border-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || dryRun}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60"
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              {submitting ? 'Creating...' : 'Create Campaign'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

// Revenue Intelligence (Priority 2) — Marketing Analytics. Mirrors
// src/lib/campaigns.ts's MarketingPerformance exactly.
interface CampaignROIRow {
  campaignId: string
  campaignName: string
  budget: number | null
  revenue: number
  leadsReached: number
  bookings: number
  roi: number | null
  roiAvailable: boolean
}

interface MarketingPerformance {
  byType: Array<{ type: string; campaigns: number; sent: number; delivered: number; failed: number; replies: number; replyRatePct: number }>
  bySource: Array<{ source: string; count: number; confirmedCount: number; conversionPct: number }>
  whatsappConversionPct: number
  acquisitionByMonth: Array<{ month: string; count: number }>
  // Per-campaign conversion (bookings/revenue/ROI) — same computeCampaignROI()
  // result the Marketing Dashboard's Campaign Performance section shows.
  campaignROI: { rows: CampaignROIRow[]; degraded: boolean; note: string }
  conversionTrackingAvailable: boolean
  conversionTrackingNote: string
}

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [summaryResult, setSummaryResult] = useState<string | null>(null)
  const [performance, setPerformance] = useState<MarketingPerformance | null>(null)

  const fetchPerformance = useCallback(async () => {
    try {
      const res = await fetch('/api/campaigns?view=performance')
      const data = await res.json()
      setPerformance(data.performance ?? null)
    } catch {
      setPerformance(null)
    }
  }, [])

  const fetchCampaigns = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/campaigns')
      const data = await res.json()
      setCampaigns(Array.isArray(data) ? data : data.campaigns ?? [])
    } catch {
      setCampaigns([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchCampaigns()
    fetchPerformance()
  }, [fetchCampaigns, fetchPerformance])

  async function handleCreate(form: NewCampaign) {
    // NOTE: fixed a latent bug found while wiring up the scheduler UI —
    // this call was missing `action: 'create'`, so every "Create Campaign"
    // submission was hitting the POST route's fallthrough
    // { error: 'Invalid action' } branch instead of actually creating a
    // campaign.
    const res = await fetch('/api/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, action: 'create' }),
    })
    if (res.ok) {
      await fetchCampaigns()
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this campaign?')) return
    await fetch(`/api/campaigns?id=${id}`, { method: 'DELETE' })
    setCampaigns((prev) => prev.filter((c) => c.id !== id))
  }

  const [actioningId, setActioningId] = useState<string | null>(null)

  // Campaign Scheduler (Priority 3): send/pause/resume/cancel all route
  // through the same POST action-dispatch pattern already used for
  // create/preview/generate_brief above.
  async function handleAction(id: string, action: 'send' | 'pause' | 'resume' | 'cancel') {
    if (action === 'send' && !confirm('Send this campaign now? Messages will be queued for delivery.')) return
    if (action === 'cancel' && !confirm('Cancel this campaign? Any not-yet-sent messages will be skipped.')) return
    setActioningId(id)
    try {
      const res = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, campaign_id: id, dry_run: false }),
      })
      if (res.ok) await fetchCampaigns()
    } finally {
      setActioningId(null)
    }
  }

  async function handleGenerateSummary() {
    setGenerating(true)
    setSummaryResult(null)
    try {
      const res = await fetch('/api/ai-summary', { method: 'POST' })
      const data = await res.json()
      setSummaryResult(data.summary ?? data.message ?? 'Summary generated successfully.')
    } catch {
      setSummaryResult('Failed to generate summary. Please try again.')
    } finally {
      setGenerating(false)
    }
  }

  // Aggregate stats
  const totalSent = campaigns.reduce((s, c) => s + c.sent_count, 0)
  const totalDelivered = campaigns.reduce((s, c) => s + c.delivered_count, 0)
  const totalReplies = campaigns.reduce((s, c) => s + c.reply_count, 0)
  const activeCampaigns = campaigns.filter((c) => c.status === 'running' || c.status === 'scheduled').length
  // Per-campaign conversion (bookings/revenue/ROI) — same computeCampaignROI()
  // rows the Marketing Dashboard shows, keyed for the table below.
  const campaignROIById = new Map((performance?.campaignROI?.rows ?? []).map((r) => [r.campaignId, r]))

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Megaphone className="w-6 h-6 text-gray-700" />
            <div>
              <h1 className="text-xl font-semibold text-gray-900">Campaigns</h1>
              <p className="text-sm text-gray-500">WhatsApp broadcast campaigns</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={fetchCampaigns}
              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
              title="Refresh"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              onClick={handleGenerateSummary}
              disabled={generating}
              className="flex items-center gap-2 px-3 py-2 border border-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-60"
            >
              {generating ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Brain className="w-4 h-4" />
              )}
              Generate Today&apos;s Summary
            </button>
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
            >
              <Plus className="w-4 h-4" />
              New Campaign
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-6 space-y-6">
        {/* AI Summary Result */}
        {summaryResult && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
            <div className="flex items-start gap-2">
              <Brain className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-blue-800">{summaryResult}</p>
            </div>
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Total Campaigns" value={campaigns.length} icon={Megaphone} color="bg-purple-50 text-purple-600" />
          <StatCard label="Active" value={activeCampaigns} icon={Clock} color="bg-blue-50 text-blue-600" />
          <StatCard label="Messages Sent" value={totalSent.toLocaleString()} icon={Send} color="bg-green-50 text-green-600" />
          <StatCard label="Total Replies" value={totalReplies.toLocaleString()} icon={BarChart3} color="bg-yellow-50 text-yellow-600" />
        </div>

        {/* Marketing Analytics (Revenue Intelligence, Priority 2) */}
        {performance && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h2 className="text-sm font-semibold text-gray-900 mb-1">Lead Source Performance</h2>
              <p className="text-xs text-gray-400 mb-3">Conversion = reached CONFIRMED stage</p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-400 uppercase">
                    <th className="text-left font-medium pb-2">Source</th>
                    <th className="text-right font-medium pb-2">Leads</th>
                    <th className="text-right font-medium pb-2">Conversion</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {performance.bySource.map((s) => (
                    <tr key={s.source}>
                      <td className="py-1.5 text-gray-700 capitalize">{s.source}</td>
                      <td className="py-1.5 text-right text-gray-600">{s.count}</td>
                      <td className="py-1.5 text-right font-medium text-emerald-700">{s.conversionPct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-xs text-gray-400">WhatsApp conversion: <span className="font-medium text-gray-600">{performance.whatsappConversionPct}%</span></p>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h2 className="text-sm font-semibold text-gray-900 mb-1">Campaign Performance by Type</h2>
              <p className="text-xs text-gray-400 mb-3">{performance.conversionTrackingNote}</p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-400 uppercase">
                    <th className="text-left font-medium pb-2">Type</th>
                    <th className="text-right font-medium pb-2">Sent</th>
                    <th className="text-right font-medium pb-2">Reply Rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {performance.byType.map((t) => (
                    <tr key={t.type}>
                      <td className="py-1.5 text-gray-700 capitalize">{t.type.replace('_', ' ')}</td>
                      <td className="py-1.5 text-right text-gray-600">{t.sent}</td>
                      <td className="py-1.5 text-right font-medium text-emerald-700">{t.replyRatePct}%</td>
                    </tr>
                  ))}
                  {performance.byType.length === 0 && (
                    <tr><td colSpan={3} className="py-4 text-center text-gray-400">No campaigns sent yet</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-900">All Campaigns</h2>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
            </div>
          ) : campaigns.length === 0 ? (
            <div className="text-center py-16">
              <Megaphone className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-sm text-gray-500">No campaigns yet.</p>
              <button
                onClick={() => setShowCreate(true)}
                className="mt-3 text-sm text-blue-600 hover:underline"
              >
                Create your first campaign
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Campaign</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Status</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wide">Recipients</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wide">Sent</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wide">Delivery</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wide">Replies</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wide">Conversions</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wide">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {campaigns.map((c) => (
                    <CampaignRow
                      key={c.id}
                      campaign={c}
                      onDelete={handleDelete}
                      onAction={handleAction}
                      actionPending={actioningId === c.id}
                      roi={campaignROIById.get(c.id)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!loading && campaigns.length > 0 && (
            <div className="px-4 py-2 border-t border-gray-100 bg-gray-50 text-right">
              <span className="text-xs text-gray-400">
                {campaigns.length} campaign{campaigns.length !== 1 ? 's' : ''} — {totalDelivered.toLocaleString()} total deliveries
              </span>
            </div>
          )}
        </div>
      </div>

      {showCreate && (
        <CreateModal onClose={() => setShowCreate(false)} onCreate={handleCreate} />
      )}
    </div>
  )
}
