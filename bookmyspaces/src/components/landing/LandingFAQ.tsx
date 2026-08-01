'use client'

// Sprint 1 — Campaign Landing Page System. FAQ copy comes from
// src/lib/campaigns/campaign-config.ts (per-campaign), which itself sources
// only confirmed facts from docs/business/01_PROPERTY_INTELLIGENCE.md —
// anything not yet confirmed is marked "UNKNOWN - FOUNDER INPUT REQUIRED"
// verbatim, exactly as the Business Knowledge Base recorded it, rather than
// inventing an answer here.

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'

export function LandingFAQ({ faqs }: { faqs: { question: string; answer: string }[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(0)

  return (
    <section className="py-16 px-6" style={{ background: 'var(--warm-white)' }}>
      <div className="max-w-3xl mx-auto">
        <h2
          className="text-3xl md:text-4xl font-light mb-8 text-center"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--charcoal)' }}
        >
          Frequently Asked Questions
        </h2>
        <div className="space-y-3">
          {faqs.map((faq, i) => (
            <div key={faq.question} className="border rounded-xl overflow-hidden" style={{ borderColor: '#e8e4de' }}>
              <button
                onClick={() => setOpenIndex(openIndex === i ? null : i)}
                className="w-full flex items-center justify-between px-5 py-4 text-left bg-white"
                aria-expanded={openIndex === i}
              >
                <span className="font-medium text-sm" style={{ color: 'var(--charcoal)' }}>
                  {faq.question}
                </span>
                <ChevronDown
                  size={18}
                  style={{
                    color: 'var(--muted)',
                    transform: openIndex === i ? 'rotate(180deg)' : undefined,
                    transition: 'transform 0.2s',
                  }}
                />
              </button>
              {openIndex === i && (
                <div className="px-5 pb-4 text-sm bg-white" style={{ color: 'var(--slate)' }}>
                  {faq.answer}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
