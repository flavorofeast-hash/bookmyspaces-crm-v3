// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/data-deletion/page.tsx
// Legal & Compliance module — public Data Deletion Instructions. Required by
// Meta App Review as the "Data Deletion Instructions URL" configured in the
// Meta App Dashboard for the Facebook Login / WhatsApp Business integrations.
// No auth required — see src/middleware.ts's PUBLIC_PAGE_PREFIXES.
// ─────────────────────────────────────────────────────────────────────────────

import { LegalLayout } from '@/components/legal/LegalLayout'
import { LegalSection } from '@/components/legal/LegalSection'
import { LEGAL, buildLegalMetadata } from '@/lib/legal'

export const metadata = buildLegalMetadata({
  title: 'Data Deletion Instructions',
  description: `How to request permanent deletion of your account and personal information from ${LEGAL.companyName}.`,
  path: LEGAL.dataDeletionUrl,
})

export default function DataDeletionPage() {
  return (
    <LegalLayout title="Data Deletion Instructions">
      <LegalSection heading="Requesting Data Deletion">
        <p>
          Users may request permanent deletion of their account and associated personal information held by{' '}
          {LEGAL.companyName}, including information collected through our website, CRM, or any connected messaging
          channel (WhatsApp, Facebook, Instagram, Google Business, LinkedIn, or X).
        </p>
      </LegalSection>

      <LegalSection heading="Deletion Process">
        <ol className="list-decimal pl-5 space-y-3">
          <li>
            <span className="font-medium" style={{ color: 'var(--charcoal)' }}>Email us</span> at{' '}
            <a href={`mailto:${LEGAL.supportEmail}`} className="underline" style={{ color: 'var(--gold-dark)' }}>
              {LEGAL.supportEmail}
            </a>{' '}
            with the subject line &ldquo;Data Deletion Request&rdquo;.
          </li>
          <li>
            <span className="font-medium" style={{ color: 'var(--charcoal)' }}>Include the following details</span>{' '}
            in your request so we can locate and verify your record:
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>Full Name</li>
              <li>Registered Email</li>
              <li>Registered Phone Number</li>
            </ul>
          </li>
          <li>
            <span className="font-medium" style={{ color: 'var(--charcoal)' }}>Identity verification</span> — we may
            contact you to confirm your identity before proceeding, to prevent unauthorized deletion of someone
            else&apos;s data.
          </li>
          <li>
            <span className="font-medium" style={{ color: 'var(--charcoal)' }}>Data permanently removed within 30 days</span> —
            once verified, your account and associated personal information will be permanently deleted from our
            systems within 30 days. Some information may be retained for a limited period where required by law
            (for example, financial or tax records), after which it is deleted or anonymized.
          </li>
        </ol>
      </LegalSection>

      <LegalSection heading="Questions?">
        <p>
          Questions?{' '}
          <a href={`mailto:${LEGAL.supportEmail}`} className="underline" style={{ color: 'var(--gold-dark)' }}>
            {LEGAL.supportEmail}
          </a>
        </p>
      </LegalSection>
    </LegalLayout>
  )
}
