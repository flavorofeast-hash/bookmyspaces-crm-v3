'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Sprint 1 — Campaign Landing Page System.
// Fires the one-time attribution capture (POST /api/campaigns/track) on
// mount, then exposes the resulting leadId + campaign context to every
// descendant (LandingCTA, the chat launcher) via context — so the "capture"
// and "automatically create CRM lead" requirements are satisfied once per
// page view, independent of which CTA the visitor eventually clicks.
// ─────────────────────────────────────────────────────────────────────────────

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

export interface CampaignAttributionValue {
  slug: string
  intent: string
  propertyLabel: string | null
  leadEventType: string | null
  utmSource: string | null
  utmMedium: string | null
  utmCampaign: string | null
  referral: string | null
  landingPage: string
  leadId: string | null
}

const CampaignAttributionContext = createContext<CampaignAttributionValue | null>(null)

export function useCampaignAttribution(): CampaignAttributionValue | null {
  return useContext(CampaignAttributionContext)
}

export function CampaignAttribution({
  slug,
  intent,
  propertyLabel,
  leadEventType,
  utmSource,
  utmMedium,
  utmCampaign,
  referral,
  landingPage,
  children,
}: {
  slug: string
  intent: string
  propertyLabel: string | null
  leadEventType: string | null
  utmSource: string | null
  utmMedium: string | null
  utmCampaign: string | null
  referral: string | null
  landingPage: string
  children: ReactNode
}) {
  const [leadId, setLeadId] = useState<string | null>(null)
  const [sessionId] = useState(
    () => `landing_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  )
  const fired = useRef(false)

  useEffect(() => {
    if (fired.current) return
    fired.current = true

    fetch('/api/campaigns/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        campaign: slug,
        intent,
        property: propertyLabel,
        leadEventType,
        utmSource,
        utmMedium,
        utmCampaign,
        referral,
        landingPage,
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data?.leadId) setLeadId(data.leadId)
      })
      .catch(() => {
        // Best-effort — a failed capture must never block the landing page
        // from rendering or the CTAs from working.
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <CampaignAttributionContext.Provider
      value={{
        slug,
        intent,
        propertyLabel,
        leadEventType,
        utmSource,
        utmMedium,
        utmCampaign,
        referral,
        landingPage,
        leadId,
      }}
    >
      {children}
    </CampaignAttributionContext.Provider>
  )
}
