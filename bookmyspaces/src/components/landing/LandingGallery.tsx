// Sprint 1 — Campaign Landing Page System. No confirmed real photo assets
// exist in this repository for any campaign (per docs/business/06_MARKETING_
// PLAYBOOK.md — UNKNOWN - FOUNDER INPUT REQUIRED). Rendering an honest
// placeholder rather than fabricating stock imagery or fake file paths.

export function LandingGallery() {
  return (
    <section className="py-16 px-6" style={{ background: 'var(--warm-white)' }}>
      <div className="max-w-6xl mx-auto text-center">
        <h2
          className="text-3xl md:text-4xl font-light mb-8"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--charcoal)' }}
        >
          Gallery
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="aspect-square rounded-xl flex items-center justify-center text-sm"
              style={{ background: '#e8e4de', color: 'var(--muted)' }}
            >
              Photos coming soon
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
