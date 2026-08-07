'use client'

// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/components/leads/LeadTimeline.tsx
// Lead Workspace v1 — extraction, not a rewrite. This is the exact Timeline
// block (icon map + rendering) that previously lived inline in
// src/app/(crm)/customers/[id]/page.tsx, moved here unchanged so both the
// Customer Profile page and the new Lead Workspace can render the same
// GET /api/customers/[id]/timeline data without duplicating the JSX.
// Presentational only — the caller fetches the timeline and passes it in,
// exactly matching how customers/[id]/page.tsx already fetched it (no
// change to fetch behavior, only where the render lives).
// ─────────────────────────────────────────────────────────────────────────────

import {
  MessageSquare, Mail, Tag, Calendar, FileText, Wallet, Clock, Bot,
  Share2, Star, Gift, Award, Megaphone, Phone, MapPin,
} from 'lucide-react'
import type { CustomerTimeline, TimelineEntryType } from '@/types/timeline'

function fmtDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}

const TIMELINE_ICON: Record<TimelineEntryType, React.ComponentType<{ className?: string }>> = {
  chat: MessageSquare,
  whatsapp: MessageSquare,
  email: Mail,
  lead_activity: Tag,
  reservation: Calendar,
  proposal: FileText,
  payment: Wallet,
  follow_up: Clock,
  ai_interaction: Bot,
  // Phase 2 (Social + WhatsApp Growth) — Phase C additions.
  social: Share2,
  review: Star,
  referral: Gift,
  loyalty: Award,
  campaign: Megaphone,
  call: Phone,
  visit: MapPin,
}

export function LeadTimeline({ timeline }: { timeline: CustomerTimeline | null }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h2 className="text-sm font-semibold text-gray-700 mb-4">Timeline</h2>
      {!timeline || timeline.entries.length === 0 ? (
        <p className="text-sm text-gray-400">No activity recorded yet.</p>
      ) : (
        <ol className="space-y-4">
          {timeline.entries.map((entry, i) => {
            const Icon = TIMELINE_ICON[entry.type] ?? Tag
            return (
              <li key={i} className="flex gap-3">
                <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center shrink-0 mt-0.5">
                  <Icon className="w-3.5 h-3.5 text-gray-600" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-medium text-gray-800">{entry.title}</span>
                    <span className="text-xs text-gray-400 shrink-0">{fmtDateTime(entry.timestamp)}</span>
                  </div>
                  {entry.description && (
                    <p className="text-sm text-gray-500 mt-0.5 break-words">{entry.description}</p>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
