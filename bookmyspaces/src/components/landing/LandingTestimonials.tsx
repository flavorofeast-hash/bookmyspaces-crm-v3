// Sprint 1 — Campaign Landing Page System. No confirmed real testimonial
// copy exists yet (docs/business/08_STANDARD_RESPONSES.md /
// 06_MARKETING_PLAYBOOK.md — UNKNOWN - FOUNDER INPUT REQUIRED). A `reviews`
// table exists (docs/engineering/MASTER_DATABASE.md, migration 014) but its
// live-apply status is unverified and it holds no confirmed founder-approved
// review copy today — pulling from it here would risk surfacing unmoderated
// or empty content on a public page. Placeholder only, honestly labeled.

export function LandingTestimonials() {
  return (
    <section className="py-16 px-6" style={{ background: 'var(--cream)' }}>
      <div className="max-w-4xl mx-auto text-center">
        <h2
          className="text-3xl md:text-4xl font-light mb-6"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--charcoal)' }}
        >
          What Our Guests Say
        </h2>
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          Guest testimonials are being collected — check back soon, or ask us for references when you chat.
        </p>
      </div>
    </section>
  )
}
