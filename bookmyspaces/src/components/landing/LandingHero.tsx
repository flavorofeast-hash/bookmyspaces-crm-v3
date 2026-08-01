// Sprint 1 — Campaign Landing Page System. Shared Hero section, styled to
// match the existing homepage hero (src/app/page.tsx) rather than inventing a
// new visual language — same gradient/gold palette via existing CSS vars.

export function LandingHero({
  headline,
  subheadline,
}: {
  headline: string
  subheadline: string
}) {
  return (
    <section
      className="relative flex flex-col items-center justify-center text-center px-6 py-24"
      style={{
        background: 'linear-gradient(160deg, #0f1923 0%, #1a2840 50%, #0d1f2d 100%)',
      }}
    >
      <div
        className="absolute inset-0 opacity-10"
        style={{
          backgroundImage:
            'radial-gradient(circle at 20% 50%, #c9a84c 0%, transparent 50%), radial-gradient(circle at 80% 20%, #c9a84c 0%, transparent 40%)',
        }}
      />
      <div className="relative z-10 max-w-3xl mx-auto">
        <p
          className="text-sm tracking-[0.3em] uppercase mb-4"
          style={{ color: 'var(--gold)', fontFamily: 'var(--font-body)' }}
        >
          BookMySpaces
        </p>
        <h1
          className="text-4xl md:text-6xl font-light text-white mb-6 leading-tight"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {headline}
        </h1>
        <p className="text-lg text-gray-300 max-w-2xl mx-auto leading-relaxed">
          {subheadline}
        </p>
      </div>
    </section>
  )
}
