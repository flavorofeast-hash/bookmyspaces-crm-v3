'use client'

// Revenue Attribution Priority 2 — WhatsApp + call click tracking on the
// proposal share page (a public, unauthenticated Server Component page —
// see proposals/share/[token]/page.tsx). Extracted into its own client
// component only because click tracking needs an onClick handler, which a
// Server Component cannot attach; the two <a> tags and their hrefs are
// otherwise byte-for-byte what the page already rendered inline. No
// preventDefault() anywhere — this is a non-blocking beacon alongside the
// native wa.me/tel: navigation, not a redirect wrapper.

import { trackClick } from '@/lib/social/click-tracker-client'

export function ProposalActionButtons({
  proposalId,
  whatsappMessage,
}: {
  proposalId: string
  whatsappMessage: string
}) {
  const whatsappHref = `https://wa.me/919051459463?text=${whatsappMessage}`
  const telHref = 'tel:+919051459463'

  return (
    <>
      <a
        href={whatsappHref}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => trackClick({ type: 'whatsapp', target: whatsappHref, leadId: null, campaign: `proposal:${proposalId}` })}
        className="w-full bg-[#25D366] hover:bg-[#1ebe5d] text-white font-semibold py-5 rounded-2xl flex items-center justify-center text-xl transition-all"
      >
        Confirm on WhatsApp
      </a>

      <a
        href={telHref}
        onClick={() => trackClick({ type: 'call', target: telHref, leadId: null, campaign: `proposal:${proposalId}` })}
        className="w-full bg-[#0d1b2a] hover:bg-[#16263a] text-white font-semibold py-5 rounded-2xl flex items-center justify-center text-xl transition-all"
      >
        Call Us: +91 9051459463
      </a>
    </>
  )
}
