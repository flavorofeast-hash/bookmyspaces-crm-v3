// ─────────────────────────────────────────────────────────────────────────────
// Sprint 1 — Campaign Landing Page System.
// Dynamic route serving the 5 hardcoded campaign landing pages (/wedding,
// /birthday, /corporate, /airport-stay, /staycation) from one shared
// template + config (src/lib/campaigns/campaign-config.ts), per "reuse
// existing architecture, do not duplicate components."
//
// Business Package Engine (migration 043) extension: any slug NOT in the 5
// hardcoded ones now falls back to an ACTIVE business_packages row with a
// matching landing_page_slug, rendered through the exact same components
// via toCampaignConfig() — so operators get a working landing page for a
// newly created package with zero code changes. `dynamicParams` must be
// true for this fallback to ever be reachable (a statically-unknown slug
// would otherwise 404 before this component's body even runs); the 5
// hardcoded slugs are still returned by generateStaticParams so they keep
// being pre-rendered at build time exactly as before — this is additive,
// not a behavior change for any existing campaign.
// ─────────────────────────────────────────────────────────────────────────────

import { notFound } from 'next/navigation'
import { CAMPAIGN_SLUGS, getCampaignConfig, type CampaignConfig } from '@/lib/campaigns/campaign-config'
import { listPackages } from '@/lib/packages/package-service'
import { getActiveBusinessPackageBySlug, toCampaignConfig } from '@/lib/business-packages/business-package-service'
import { CampaignAttribution } from '@/components/landing/CampaignAttribution'
import { LandingHero } from '@/components/landing/LandingHero'
import { LandingPackages } from '@/components/landing/LandingPackages'
import { LandingGallery } from '@/components/landing/LandingGallery'
import { LandingTestimonials } from '@/components/landing/LandingTestimonials'
import { LandingFAQ } from '@/components/landing/LandingFAQ'
import { LandingCTA } from '@/components/landing/LandingCTA'
import { CampaignChatLauncher } from '@/components/landing/CampaignChatLauncher'

export const dynamicParams = true

export function generateStaticParams() {
  return CAMPAIGN_SLUGS.map((campaign) => ({ campaign }))
}

/** Resolves a slug to a CampaignConfig-shaped object from either source, plus the originating business_packages.id (null for the 5 hardcoded campaigns) so the caller can pass it through to attribution. */
async function resolveConfig(slug: string): Promise<{ config: CampaignConfig | NonNullable<ReturnType<typeof toCampaignConfig>>; businessPackageId: string | null } | null> {
  const hardcoded = getCampaignConfig(slug)
  if (hardcoded) return { config: hardcoded, businessPackageId: null }
  const pkg = await getActiveBusinessPackageBySlug(slug)
  if (!pkg) return null
  const config = toCampaignConfig(pkg)
  return config ? { config, businessPackageId: pkg.id } : null
}

export async function generateMetadata({ params }: { params: { campaign: string } }) {
  const resolved = await resolveConfig(params.campaign)
  if (!resolved) return {}
  return {
    title: `${resolved.config.label} — BookMySpaces`,
    description: resolved.config.heroSubheadline,
  }
}

export default async function CampaignLandingPage({
  params,
  searchParams,
}: {
  params: { campaign: string }
  searchParams: { [key: string]: string | string[] | undefined }
}) {
  const resolved = await resolveConfig(params.campaign)
  if (!resolved) notFound()
  const { config, businessPackageId } = resolved

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
      businessPackageId={businessPackageId}
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
