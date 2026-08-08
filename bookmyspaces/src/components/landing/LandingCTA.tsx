'use client'

// Sprint 1 — Campaign Landing Page System. Two CTAs per the requirement:
// "Chat with AI" (opens the existing ChatWidget via the bms:open-chat event —
// see ChatWidget.tsx) and "WhatsApp" (wa.me deep link, reusing the exact
// number+prefill-text pattern already used on the homepage, src/app/page.tsx).

import { Phone, MessageCircle } from 'lucide-react'
import { useCampaignAttribution } from './CampaignAttribution'
import { trackClick } from '@/lib/social/click-tracker-client'

export function LandingCTA({
  whatsappNumber,
  whatsappPrefill,
}: {
  whatsappNumber: string
  whatsappPrefill: string
}) {
  const attribution = useCampaignAttribution()

  // Attribution is appended to the WhatsApp prefill text so an operator
  // receiving the message can see campaign source even though a WhatsApp
  // deep link never touches our backend (item 4's "capture" already happened
  // via CampaignAttribution's /api/campaigns/track call on page load,
  // regardless of which CTA is clicked — this just keeps it visible to the
  // human on the other end too).
  const utmSuffix = attribution?.utmCampaign
    ? ` (campaign: ${attribution.utmCampaign})`
    : attribution?.slug
      ? ` (campaign: ${attribution.slug})`
      : ''

  const whatsappHref = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(whatsappPrefill + utmSuffix)}`

  return (
    <div className="flex flex-col sm:flex-row gap-4 justify-center py-10 px-6">
      <button
        onClick={() => window.dispatchEvent(new CustomEvent('bms:open-chat'))}
        className="inline-flex items-center justify-center gap-2 px-8 py-4 text-white font-medium rounded-lg transition-all"
        style={{ background: 'var(--gold, #c9a84c)' }}
      >
        <MessageCircle size={18} />
        Chat with AI
      </button>
      <a
        href={whatsappHref}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => trackClick({ type: 'whatsapp', target: whatsappHref, campaign: attribution?.utmCampaign ?? attribution?.slug ?? null, businessPackageId: attribution?.businessPackageId ?? null })}
        className="inline-flex items-center justify-center gap-2 px-8 py-4 text-white font-medium rounded-lg transition-all"
        style={{ background: '#25D366' }}
      >
        <Phone size={18} />
        WhatsApp Us
      </a>
    </div>
  )
}
