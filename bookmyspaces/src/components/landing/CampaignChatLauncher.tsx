'use client'

// Sprint 1 — Campaign Landing Page System. Mounts the existing ChatWidget
// (src/components/chatbot/ChatWidget.tsx, reused as-is) once per landing
// page, seeded with the campaign context so it's passed into the AI "before
// the conversation begins" per the sprint requirement — the context is
// attached on every message this widget sends, starting with the first one.

import ChatWidget from '@/components/chatbot/ChatWidget'
import { useCampaignAttribution } from './CampaignAttribution'

export function CampaignChatLauncher() {
  const attribution = useCampaignAttribution()

  return (
    <ChatWidget
      campaignContext={
        attribution
          ? {
              leadId: attribution.leadId,
              campaign: attribution.slug,
              intent: attribution.intent,
              property: attribution.propertyLabel,
              leadEventType: attribution.leadEventType,
              utmSource: attribution.utmSource,
              utmMedium: attribution.utmMedium,
              utmCampaign: attribution.utmCampaign,
              referral: attribution.referral,
              landingPage: attribution.landingPage,
            }
          : undefined
      }
    />
  )
}
