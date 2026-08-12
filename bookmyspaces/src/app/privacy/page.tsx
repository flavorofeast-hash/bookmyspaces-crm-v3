// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/privacy/page.tsx
// Legal & Compliance module — public Privacy Policy (Meta App Review
// requirement for the Facebook/Instagram/WhatsApp integrations under
// src/lib/social/** and src/lib/whatsapp/**). No auth required — see
// src/middleware.ts's PUBLIC_PAGE_PREFIXES.
// ─────────────────────────────────────────────────────────────────────────────

import { LegalLayout } from '@/components/legal/LegalLayout'
import { LegalSection } from '@/components/legal/LegalSection'
import { LEGAL, buildLegalMetadata } from '@/lib/legal'

export const metadata = buildLegalMetadata({
  title: 'Privacy Policy',
  description: `How ${LEGAL.companyName} collects, uses, stores, and protects your personal information across our website, CRM, and connected messaging/social channels.`,
  path: LEGAL.privacyUrl,
})

export default function PrivacyPolicyPage() {
  return (
    <LegalLayout title="Privacy Policy">
      <LegalSection heading="Introduction">
        <p>
          {LEGAL.companyName} (&ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;our&rdquo;) operates a hospitality booking
          and customer relationship management platform, including the website at {LEGAL.website} and the
          associated WhatsApp, Facebook, Instagram, Google Business, LinkedIn, and X (Twitter) channels we use to
          communicate with customers and manage our business pages.
        </p>
        <p>
          This Privacy Policy explains what information we collect, how we use it, who we share it with, and the
          choices and rights available to you. By using our services or messaging us through any connected channel,
          you agree to the practices described here.
        </p>
      </LegalSection>

      <LegalSection heading="Information Collected">
        <p>We collect information in the following ways:</p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            <span className="font-medium" style={{ color: 'var(--charcoal)' }}>Information you provide directly</span> —
            name, phone number, email address, event or booking details, and any messages you send us via our website
            forms, WhatsApp, or social media (Facebook Messenger, Instagram Direct).
          </li>
          <li>
            <span className="font-medium" style={{ color: 'var(--charcoal)' }}>Information from connected platforms</span> —
            when you interact with our Facebook Page, Instagram account, or Google Business Profile (for example, by
            sending a message, commenting, or leaving a review), the platform shares limited profile information
            (such as your name and profile picture) and the content of your interaction with us.
          </li>
          <li>
            <span className="font-medium" style={{ color: 'var(--charcoal)' }}>Account and usage information</span> —
            for staff and administrators who log into our CRM, we collect login credentials (managed securely via our
            authentication provider), role/permissions, and activity logs needed to operate the system.
          </li>
          <li>
            <span className="font-medium" style={{ color: 'var(--charcoal)' }}>Technical information</span> — standard
            web request data such as IP address, browser type, and device information, collected automatically when
            you visit our website.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="How Data Is Used">
        <p>We use the information we collect to:</p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>Respond to enquiries, quotes, and bookings, and manage the customer relationship end to end.</li>
          <li>Send booking confirmations, reminders, and service updates via WhatsApp, email, or SMS.</li>
          <li>Operate and improve our internal CRM, scheduling, and customer support tools.</li>
          <li>Publish and manage content on our connected social media pages, and respond to comments/messages.</li>
          <li>Maintain the security, integrity, and proper functioning of our systems.</li>
          <li>Comply with legal obligations, such as tax, accounting, and record-keeping requirements.</li>
        </ul>
        <p>We do not sell your personal information to third parties.</p>
      </LegalSection>

      <LegalSection heading="Cookies">
        <p>
          Our website may use essential cookies required for the site to function (such as maintaining a logged-in
          session for staff users) and, where enabled, basic analytics cookies to understand how the site is used so
          we can improve it. You can control or disable cookies through your browser settings; doing so may limit
          some site functionality.
        </p>
      </LegalSection>

      <LegalSection heading="Third-Party Integrations">
        <p>
          To operate our customer communication and marketing channels, we integrate with the following third-party
          platforms. Each platform processes data under its own privacy policy in addition to this one:
        </p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            <span className="font-medium" style={{ color: 'var(--charcoal)' }}>Meta Platforms</span> (Facebook,
            Instagram, and WhatsApp Business Platform) — used to send/receive messages, publish posts, and manage
            comments on our Pages, via Meta&apos;s official Graph API and WhatsApp Business API under an authenticated
            connection we control.
          </li>
          <li>
            <span className="font-medium" style={{ color: 'var(--charcoal)' }}>Google</span> (Google Business Profile) —
            used to publish updates and manage our Business Profile listing.
          </li>
          <li>
            <span className="font-medium" style={{ color: 'var(--charcoal)' }}>LinkedIn</span> and{' '}
            <span className="font-medium" style={{ color: 'var(--charcoal)' }}>X (Twitter)</span> — used to publish
            business updates to our organization pages/accounts.
          </li>
          <li>
            <span className="font-medium" style={{ color: 'var(--charcoal)' }}>Supabase</span> — our database,
            authentication, and file storage infrastructure provider, used to securely store CRM records.
          </li>
        </ul>
        <p>
          We only request the minimum permissions/scopes each integration needs to perform the function described
          above, and access tokens for these connections are stored encrypted, never in plain text.
        </p>
      </LegalSection>

      <LegalSection heading="Security">
        <p>
          We take reasonable technical and organizational measures to protect your information, including encrypting
          stored access tokens and credentials, restricting internal access to authorized staff based on their role,
          and using secure, industry-standard infrastructure providers. No method of transmission or storage is
          100% secure, and we cannot guarantee absolute security, but we work to continuously improve our safeguards.
        </p>
      </LegalSection>

      <LegalSection heading="User Rights">
        <p>You have the right to:</p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>Request access to the personal information we hold about you.</li>
          <li>Request correction of inaccurate or incomplete information.</li>
          <li>
            Request permanent deletion of your personal information — see our{' '}
            <a href={LEGAL.dataDeletionUrl} className="underline" style={{ color: 'var(--gold-dark)' }}>
              Data Deletion Instructions
            </a>{' '}
            for the process.
          </li>
          <li>Withdraw consent to receive marketing messages at any time by replying &ldquo;STOP&rdquo; or contacting us directly.</li>
          <li>Object to or restrict certain uses of your information, subject to applicable law.</li>
        </ul>
        <p>To exercise any of these rights, contact us using the details below.</p>
      </LegalSection>

      <LegalSection heading="Contact">
        <p>
          If you have questions about this Privacy Policy or how your information is handled, contact us at{' '}
          <a href={`mailto:${LEGAL.supportEmail}`} className="underline" style={{ color: 'var(--gold-dark)' }}>
            {LEGAL.supportEmail}
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection heading="Last Updated">
        <p>This Privacy Policy was last updated in {LEGAL.lastUpdated}. We may update this policy from time to time; material changes will be reflected by updating this date.</p>
      </LegalSection>
    </LegalLayout>
  )
}
