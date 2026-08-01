// Sprint 1 — Campaign Landing Page System. Renders real packages from
// src/lib/packages/package-service.ts's listPackages() (reused as-is, not
// duplicated) — filtered server-side by property in the page. Renders a
// plain, honest empty state rather than inventing package data when none is
// returned; see the sprint report's Known Limitations for why this may be
// empty even when packages exist (confirmed schema drift, ENG-003/BUG-003).

import type { EventPackage } from '@/lib/packages/package-service'

export function LandingPackages({ packages }: { packages: EventPackage[] }) {
  return (
    <section className="py-20 px-6" style={{ background: 'var(--cream)' }}>
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-12">
          <h2
            className="text-3xl md:text-4xl font-light"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--charcoal)' }}
          >
            Packages
          </h2>
        </div>

        {packages.length === 0 ? (
          <p className="text-center text-sm" style={{ color: 'var(--muted)' }}>
            Package details are being finalized — chat with us or WhatsApp for current pricing and availability.
          </p>
        ) : (
          <div className="grid md:grid-cols-3 gap-6">
            {packages.map((pkg) => (
              <div
                key={pkg.id}
                className="rounded-2xl p-6 border card-hover bg-white"
                style={{ borderColor: '#e8e4de' }}
              >
                {pkg.isPopular && (
                  <div
                    className="text-xs px-3 py-1 rounded-full font-medium inline-block mb-3"
                    style={{ background: 'var(--gold)', color: 'white' }}
                  >
                    Most Popular
                  </div>
                )}
                <h3
                  className="text-xl font-medium mb-2"
                  style={{ fontFamily: 'var(--font-display)', color: 'var(--charcoal)' }}
                >
                  {pkg.name}
                </h3>
                <p className="text-2xl font-light mb-2" style={{ color: 'var(--gold)' }}>
                  ₹{pkg.basePrice.toLocaleString('en-IN')}
                </p>
                <p className="text-sm mb-4" style={{ color: 'var(--muted)' }}>
                  Up to {pkg.maxGuests} guests · {pkg.durationHours} hours
                </p>
                {pkg.inclusions.length > 0 && (
                  <ul className="space-y-1.5 text-sm" style={{ color: 'var(--slate)' }}>
                    {pkg.inclusions.map((inc) => (
                      <li key={inc}>✓ {inc}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
