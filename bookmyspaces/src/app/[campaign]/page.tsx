// ─────────────────────────────────────────────────────────────────────────────
// Sprint 1 — Campaign Landing Page System.
// Dynamic route serving the 5 campaign landing pages (/wedding, /birthday,
// /corporate, /airport-stay, /staycation) from one shared template + config
// (src/lib/campaigns/campaign-config.ts), per "reuse existing architecture,
// do not duplicate components." `dynamicParams = false` + generateStaticParams
// restrict this catch-all segment to exactly those 5 slugs — any other path
// 404s instead of silently rendering a blank campaign page.
// ─────────────────────────────────────────────────────────────────────────────

import { notFound } from 'next/navigation'
import { CAMPAIGN_SLUGS, getCampaignConfig } from '@/lib/campaigns/campaign-config'
import { listPackages } from '@/lib/packages/package-service'
import { CampaignAttribution } from '@/components/landing/CampaignAttribution'
import { LandingHero } from '@/components/landing/LandingHero'
import { LandingPackages } from '@/components/landing/LandingPackages'
import { LandingGallery } from '@/components/landing/LandingGallery'
import { LandingTestimonials } from '@/components/landing/LandingTestimonials'
import { LandingFAQ } from '@/components/landing/LandingFAQ'
import { LandingCTA } from '@/components/landing/LandingCTA'
import { CampaignChatLauncher } from '@/components/landing/CampaignChatLauncher'

export const dynamicParams = false

export function generateStaticParams() {
  return CAMPAIGN_SLUGS.map((campaign) => ({ campaign }))
}

export async function generateMetadata({ params }: { params: { campaign: string } }) {
  const config = getCampaignConfig(params.campaign)
  if (!config) return {}
  return {
    title: `${config.label} — BookMySpaces`,
    description: config.heroSubheadline,
  }
}

export default async function CampaignLandingPage({
  params,
  searchParams,
}: {
  params: { campaign: string }
  searchParams: { [key: string]: string | string[] | undefined }
}) {
  const config = getCampaignConfig(params.campaign)
  if (!config) notFound()

  const utmSource = typeof searchParams.utm_source === 'string' ? searchParams.utm_source : null
  const utmMedium = typeof searchParams.utm_medium === 'string' ? searchParams.utm_medium : null
  const utmCampaign = typeof searchParams.utm_campaign === 'string' ? searchParams.utm_campaign : null
  const referral =
    typeof searchParams.ref === 'string'
      ? searchParams.ref
      : typeof searchParams.referral === 'string'
        ? searchParams.referral
        : null

  // Reuses listPackages() (src/lib/packages/package-service.ts) directly —
  // server component, so no new public API route is needed just to read
  // packages. See the sprint report's Known Limitations: this service reads
  // columns (`venue`, `tier`, `base_price`) that RC1 testing found do not
  // match the live `packages` table (confirmed drift, ENG-003/BUG-003), so
  // this may legitimately return an empty list until that drift is resolved
  // — handled as an honest empty state in LandingPackages, not an error.
  const packages = await listPackages({ venue: config.venueValue, activeOnly: true }).catch(() => [])

  return (
    <CampaignAttribution
      slug={config.slug}
      intent={config.intent}
      propertyLabel={config.propertyLabel}
      leadEventType={config.leadEventType}
      utmSource={utmSource}
      utmMedium={utmMedium}
      utmCampaign={utmCampaign}
      referral={referral}
      landingPage={`/${config.slug}`}
    >
      <main className="min-h-screen" style={{ background: 'var(--warm-white)' }}>
        <LandingHero headline={config.heroHeadline} subheadline={config.heroSubheadline} />
        <LandingCTA whatsappNumber={config.whatsappNumber} whatsappPrefill={config.whatsappPrefill} />
        <LandingPackages packages={packages} />
        <LandingGallery />
        <LandingTestimonials />
        <LandingFAQ faqs={config.faqs} />
        <LandingCTA whatsappNumber={config.whatsappNumber} whatsappPrefill={config.whatsappPrefill} />
        <footer
          className="py-10 px-6 text-center"
          style={{ background: '#0f1923', borderTop: '1px solid rgba(201,168,76,0.2)' }}
        >
          <p className="text-gray-500 text-sm">© 2026 BookMySpaces · www.bookmyspaces.in</p>
        </footer>
      </main>
      <CampaignChatLauncher />
    </CampaignAttribution>
  )
}
