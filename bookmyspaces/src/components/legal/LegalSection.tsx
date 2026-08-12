// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/components/legal/LegalSection.tsx
// Legal & Compliance module — one consistent heading/body treatment for every
// section (Introduction, Cookies, Acceptable Use, etc.) across all three
// legal pages, so heading size/color/spacing is defined once, not per page.
// ─────────────────────────────────────────────────────────────────────────────

export function LegalSection({
  heading,
  children,
}: {
  heading: string
  children: React.ReactNode
}) {
  return (
    <section className="mb-9">
      <h2
        className="text-xl md:text-2xl font-medium mb-3"
        style={{ fontFamily: 'var(--font-display)', color: 'var(--charcoal)' }}
      >
        {heading}
      </h2>
      <div className="space-y-3 text-sm md:text-base leading-relaxed" style={{ color: 'var(--slate)' }}>
        {children}
      </div>
    </section>
  )
}
