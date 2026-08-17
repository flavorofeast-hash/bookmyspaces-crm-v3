import Link from 'next/link'
import { MapPin, Phone, Star, Calendar, Users, ChevronRight } from 'lucide-react'

export default function HomePage() {
  return (
    <main className="min-h-screen" style={{ background: 'var(--warm-white)' }}>
      {/* Hero Section */}
      <section
        className="relative min-h-screen flex flex-col items-center justify-center text-center px-6 py-24"
        style={{
          background: 'linear-gradient(160deg, #0f1923 0%, #1a2840 50%, #0d1f2d 100%)',
        }}
      >
        {/* Decorative overlay */}
        <div
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage:
              'radial-gradient(circle at 20% 50%, #c9a84c 0%, transparent 50%), radial-gradient(circle at 80% 20%, #c9a84c 0%, transparent 40%)',
          }}
        />

        <div className="relative z-10 max-w-4xl mx-auto">
          <p
            className="text-sm tracking-[0.3em] uppercase mb-4"
            style={{ color: 'var(--gold)', fontFamily: 'var(--font-body)' }}
          >
            Kolkata&apos;s Premier Event Destination
          </p>

          <h1
            className="text-5xl md:text-7xl font-light text-white mb-6 leading-tight"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Where Every <em className="italic" style={{ color: 'var(--gold-light)' }}>Celebration</em>
            <br />Becomes a Memory
          </h1>

          <p className="text-lg text-gray-300 mb-10 max-w-2xl mx-auto leading-relaxed">
            Rooftop events · Private dining · Luxury stay · Open-air banquets
            <br />
            <span style={{ color: 'var(--gold-light)' }}>Mukundapur · Near Airport · Kolkata</span>
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a
              href={`https://wa.me/918017035546?text=Hi! I'm interested in booking an event at BookMySpaces`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-8 py-4 text-white font-medium rounded-lg transition-all"
              style={{ background: '#25D366', fontSize: '1rem' }}
            >
              <Phone size={18} />
              WhatsApp Us Now
            </a>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 px-8 py-4 font-medium rounded-lg transition-all border"
              style={{
                color: 'var(--gold-light)',
                borderColor: 'rgba(201,168,76,0.5)',
                background: 'rgba(201,168,76,0.08)',
              }}
            >
              Staff Dashboard
              <ChevronRight size={18} />
            </Link>
          </div>
        </div>

        {/* Bottom scroll hint */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce">
          <div className="w-6 h-10 border-2 border-white/30 rounded-full flex items-start justify-center pt-2">
            <div className="w-1.5 h-3 bg-white/50 rounded-full"></div>
          </div>
        </div>
      </section>

      {/* Packages Section */}
      <section className="py-24 px-6" style={{ background: 'var(--cream)' }}>
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <p
              className="text-sm tracking-widest uppercase mb-3"
              style={{ color: 'var(--gold)', fontFamily: 'var(--font-body)' }}
            >
              Rooftop Event Packages · 2026
            </p>
            <h2
              className="text-4xl md:text-5xl font-light"
              style={{ fontFamily: 'var(--font-display)', color: 'var(--charcoal)' }}
            >
              Celebrate Under the Open Sky
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {/* Silver */}
            <PackageCard
              tier="Silver"
              price="₹42,000"
              guests="Up to 60 Guests"
              hours="4 Hours"
              features={[
                'Rooftop venue',
                'Basic decoration',
                'Buffet dinner (veg + non-veg)',
                'Sound system & music',
                'Basic lighting',
                'Event support staff',
              ]}
              accent="#a8a8a8"
            />

            {/* Gold — Most Popular */}
            <PackageCard
              tier="Gold"
              price="₹50,000"
              guests="Up to 60 Guests"
              hours="4 Hours"
              features={[
                'Rooftop venue',
                'Premium decoration',
                'Buffet dinner (expanded menu)',
                'Sound system + microphone',
                'Party lighting setup',
                'Cake table setup',
                'Event support staff',
              ]}
              accent="#c9a84c"
              popular
            />

            {/* Platinum */}
            <PackageCard
              tier="Platinum"
              price="₹59,500"
              guests="Up to 60 Guests"
              hours="5 Hours"
              features={[
                'Rooftop venue',
                'Premium theme decoration',
                'Full buffet dinner',
                'DJ music setup',
                'Party lighting',
                'Welcome drink',
                'Cake table + stage setup',
                'Event coordination',
              ]}
              accent="#3a3a5c"
            />
          </div>

          <p className="text-center mt-8 text-sm" style={{ color: 'var(--muted)' }}>
            Add-ons: Music ₹6,000 · Photography ₹8,000 · Extra Guest ₹750/person · Theme Decor ₹5,000–₹12,000
          </p>
        </div>
      </section>

      {/* Properties Section */}
      <section className="py-24 px-6" style={{ background: 'var(--warm-white)' }}>
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2
              className="text-4xl md:text-5xl font-light"
              style={{ fontFamily: 'var(--font-display)', color: 'var(--charcoal)' }}
            >
              Our Properties
            </h2>
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            <div
              className="rounded-2xl p-8 border card-hover"
              style={{ background: '#0f1923', borderColor: 'rgba(201,168,76,0.2)' }}
            >
              <div
                className="text-xs tracking-widest uppercase mb-4"
                style={{ color: 'var(--gold)' }}
              >
                Near Kolkata Airport
              </div>
              <h3
                className="text-3xl font-light text-white mb-3"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                Skyline Serenity
              </h3>
              <p className="text-gray-400 mb-6 leading-relaxed">
                Premium AC rooms with attached washroom, smart TV, high-speed WiFi, and in-house
                dining. Couple-friendly · Starting ₹999/night
              </p>
              <div className="flex items-center gap-2 text-gray-400 text-sm">
                <MapPin size={14} style={{ color: 'var(--gold)' }} />
                Near Kolkata Airport
              </div>
              <div className="flex items-center gap-2 text-gray-400 text-sm mt-1">
                <Phone size={14} style={{ color: 'var(--gold)' }} />
                9830509991 / 9123005489
              </div>
            </div>

            <div
              className="rounded-2xl p-8 border card-hover"
              style={{ background: '#0f1923', borderColor: 'rgba(201,168,76,0.2)' }}
            >
              <div
                className="text-xs tracking-widest uppercase mb-4"
                style={{ color: 'var(--gold)' }}
              >
                Mukundapur · Near EM Bypass
              </div>
              <h3
                className="text-3xl font-light text-white mb-3"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                Monurama Homestay
              </h3>
              <p className="text-gray-400 mb-6 leading-relaxed">
                Rooms · Open-Air Café &ldquo;Under the Mango Tree&rdquo; · Rooftop Events · Private
                Dining · Open-Air Banquet. A complete celebration destination.
              </p>
              <div className="flex items-center gap-2 text-gray-400 text-sm">
                <MapPin size={14} style={{ color: 'var(--gold)' }} />
                Mukundapur, Near EM Bypass, Kolkata
              </div>
              <div className="flex items-center gap-2 text-gray-400 text-sm mt-1">
                <Phone size={14} style={{ color: 'var(--gold)' }} />
                8017035546 / 7003853624
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer
        className="py-12 px-6 text-center"
        style={{ background: '#0f1923', borderTop: '1px solid rgba(201,168,76,0.2)' }}
      >
        <p
          className="text-2xl font-light text-white mb-2"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          BookMySpaces
        </p>
        <p className="text-gray-500 text-sm">
          © 2026 BookMySpaces · www.bookmyspaces.in · 8017035546
        </p>
      </footer>
    </main>
  )
}

function PackageCard({
  tier,
  price,
  guests,
  hours,
  features,
  accent,
  popular,
}: {
  tier: string
  price: string
  guests: string
  hours: string
  features: string[]
  accent: string
  popular?: boolean
}) {
  return (
    <div
      className={`relative rounded-2xl p-8 border card-hover ${popular ? 'scale-105' : ''}`}
      style={{
        background: popular ? '#0f1923' : 'white',
        borderColor: popular ? accent : '#e8e4de',
        boxShadow: popular ? `0 0 0 2px ${accent}` : undefined,
      }}
    >
      {popular && (
        <div
          className="absolute -top-3 left-1/2 -translate-x-1/2 text-xs px-4 py-1 rounded-full font-medium tracking-wider"
          style={{ background: accent, color: 'white' }}
        >
          ⭐ MOST POPULAR
        </div>
      )}

      <div className="mb-6">
        <p
          className="text-sm tracking-widest uppercase mb-1"
          style={{ color: accent, fontFamily: 'var(--font-body)' }}
        >
          {tier}
        </p>
        <div
          className="text-4xl font-light"
          style={{
            fontFamily: 'var(--font-display)',
            color: popular ? 'white' : 'var(--charcoal)',
          }}
        >
          {price}
        </div>
        <div
          className="flex items-center gap-3 mt-2 text-sm"
          style={{ color: popular ? '#9ca3af' : 'var(--muted)' }}
        >
          <span className="flex items-center gap-1">
            <Users size={13} />
            {guests}
          </span>
          <span className="flex items-center gap-1">
            <Calendar size={13} />
            {hours}
          </span>
        </div>
      </div>

      <ul className="space-y-2.5">
        {features.map(f => (
          <li
            key={f}
            className="flex items-start gap-2.5 text-sm"
            style={{ color: popular ? '#d1d5db' : 'var(--slate)' }}
          >
            <span style={{ color: accent }} className="mt-0.5 flex-shrink-0">
              ✓
            </span>
            {f}
          </li>
        ))}
      </ul>

      <a
        href={`https://wa.me/918017035546?text=Hi! I'm interested in the ${tier} Package (${price}). Can you share more details?`}
        target="_blank"
        rel="noopener noreferrer"
        className="block mt-8 w-full text-center py-3 rounded-lg font-medium text-sm transition-all"
        style={{
          background: popular ? accent : 'transparent',
          color: popular ? 'white' : accent,
          border: `1.5px solid ${accent}`,
        }}
      >
        Book {tier} Package
      </a>
    </div>
  )
}
