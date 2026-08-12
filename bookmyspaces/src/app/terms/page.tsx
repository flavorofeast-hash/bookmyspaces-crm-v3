// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/terms/page.tsx
// Legal & Compliance module — public Terms of Service (Meta App Review
// requirement, paired with /privacy and /data-deletion). No auth required —
// see src/middleware.ts's PUBLIC_PAGE_PREFIXES.
// ─────────────────────────────────────────────────────────────────────────────

import { LegalLayout } from '@/components/legal/LegalLayout'
import { LegalSection } from '@/components/legal/LegalSection'
import { LEGAL, buildLegalMetadata } from '@/lib/legal'

export const metadata = buildLegalMetadata({
  title: 'Terms of Service',
  description: `The terms and conditions governing your use of ${LEGAL.companyName}'s website, booking services, and connected messaging channels.`,
  path: LEGAL.termsUrl,
})

export default function TermsOfServicePage() {
  return (
    <LegalLayout title="Terms of Service">
      <LegalSection heading="Acceptance">
        <p>
          These Terms of Service (&ldquo;Terms&rdquo;) govern your access to and use of {LEGAL.companyName}&apos;s
          website ({LEGAL.website}), booking and enquiry services, and any communication with us via WhatsApp,
          Facebook, Instagram, Google Business, LinkedIn, or X. By accessing our website, submitting an enquiry, or
          messaging us through any connected channel, you agree to be bound by these Terms. If you do not agree,
          please do not use our services.
        </p>
      </LegalSection>

      <LegalSection heading="User Responsibilities">
        <ul className="list-disc pl-5 space-y-1.5">
          <li>Provide accurate and current information when making an enquiry, booking, or contacting us.</li>
          <li>Keep any account credentials (for staff/admin users of our CRM) confidential and secure.</li>
          <li>Promptly notify us of any suspected unauthorized use of your account or information.</li>
          <li>Comply with all applicable laws when using our services or communicating with us.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="Acceptable Use">
        <p>You agree not to use our website or messaging channels to:</p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>Send spam, unsolicited advertising, or fraudulent communications.</li>
          <li>Attempt to gain unauthorized access to our systems, accounts, or data.</li>
          <li>Upload or transmit malicious code, or interfere with the normal operation of our services.</li>
          <li>Impersonate any person or entity, or misrepresent your affiliation with any person or entity.</li>
          <li>Use our services for any unlawful purpose or in violation of any applicable regulation.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="Intellectual Property">
        <p>
          All content on our website and social media pages — including text, graphics, logos, images, and
          software — is the property of {LEGAL.companyName} or its licensors and is protected by applicable
          intellectual property laws. You may not reproduce, distribute, modify, or create derivative works from
          this content without our prior written consent, except as permitted for normal personal use of our
          website (such as viewing pages or sharing a link).
        </p>
      </LegalSection>

      <LegalSection heading="Limitation of Liability">
        <p>
          Our services are provided on an &ldquo;as is&rdquo; and &ldquo;as available&rdquo; basis. To the fullest
          extent permitted by law, {LEGAL.companyName} shall not be liable for any indirect, incidental, special, or
          consequential damages arising out of or in connection with your use of our website, booking services, or
          communication channels, including but not limited to loss of data, revenue, or business opportunity.
          Nothing in these Terms limits liability that cannot be excluded under applicable law.
        </p>
      </LegalSection>

      <LegalSection heading="Account Termination">
        <p>
          We reserve the right to suspend or terminate access to our services (including messaging channels and, for
          staff/admin users, CRM accounts) at our discretion, without prior notice, in cases of suspected misuse,
          violation of these Terms, or as required by law. You may also request that we stop communicating with you,
          or request deletion of your data, at any time — see our{' '}
          <a href={LEGAL.dataDeletionUrl} className="underline" style={{ color: 'var(--gold-dark)' }}>
            Data Deletion Instructions
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection heading="Contact">
        <p>
          If you have questions about these Terms, contact us at{' '}
          <a href={`mailto:${LEGAL.supportEmail}`} className="underline" style={{ color: 'var(--gold-dark)' }}>
            {LEGAL.supportEmail}
          </a>
          .
        </p>
        <p className="text-xs" style={{ color: 'var(--muted)' }}>Last updated: {LEGAL.lastUpdated}.</p>
      </LegalSection>
    </LegalLayout>
  )
}
