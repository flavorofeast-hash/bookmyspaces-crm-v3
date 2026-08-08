import { describe, it, expect, vi, beforeEach } from 'vitest'

interface Row {
  id: string
  [key: string]: unknown
}

const state = {
  rows: [] as Row[],
  nextError: null as { code?: string; message: string } | null,
  nextId: 1,
}

function applyFilters(rows: Row[], filters: [string, unknown][]): Row[] {
  return rows.filter((r) => filters.every(([col, val]) => r[col] === val))
}

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

vi.mock('@/lib/campaigns', () => ({
  buildSegment: vi.fn(() => Promise.resolve([{ id: 'lead_1', name: 'Test Lead' }])),
}))

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table !== 'business_packages') throw new Error(`unexpected table ${table}`)
      return {
        select: () => {
          const filters: [string, unknown][] = []
          const builder: Record<string, unknown> = {}
          builder.eq = (col: string, val: unknown) => { filters.push([col, val]); return builder }
          builder.order = () => builder
          builder.maybeSingle = () => {
            if (state.nextError) return Promise.resolve({ data: null, error: state.nextError })
            return Promise.resolve({ data: applyFilters(state.rows, filters)[0] ?? null, error: null })
          }
          // listBusinessPackages awaits the builder directly (no terminal method).
          builder.then = (resolve: (v: { data: Row[] | null; error: unknown }) => void) => {
            if (state.nextError) return resolve({ data: null, error: state.nextError })
            resolve({ data: applyFilters(state.rows, filters), error: null })
          }
          return builder
        },
        insert: (row: Record<string, unknown>) => ({
          select: () => ({
            single: () => {
              if (state.nextError) return Promise.resolve({ data: null, error: state.nextError })
              const newRow: Row = { id: `pkg_${state.nextId++}`, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', ...row }
              state.rows.push(newRow)
              return Promise.resolve({ data: newRow, error: null })
            },
          }),
        }),
        update: (patch: Record<string, unknown>) => {
          const filters: [string, unknown][] = []
          const builder: Record<string, unknown> = {}
          builder.eq = (col: string, val: unknown) => { filters.push([col, val]); return builder }
          builder.select = () => ({
            maybeSingle: () => {
              if (state.nextError) return Promise.resolve({ data: null, error: state.nextError })
              const found = applyFilters(state.rows, filters)[0]
              if (!found) return Promise.resolve({ data: null, error: null })
              Object.assign(found, patch)
              return Promise.resolve({ data: found, error: null })
            },
          })
          return builder
        },
      }
    },
  }),
}))

import {
  listBusinessPackages,
  getBusinessPackageById,
  getActiveBusinessPackageBySlug,
  createBusinessPackage,
  updateBusinessPackage,
  setBusinessPackageStatus,
  resolveBusinessPackageAudience,
  toCampaignConfig,
  buildContentGenerationInput,
  renderPackageWhatsAppMessage,
  renderPackageEmail,
  type BusinessPackage,
} from './business-package-service'
import { buildSegment } from '@/lib/campaigns'

function row(overrides: Partial<Row> & { id: string }): Row {
  return {
    name: 'Test Package',
    category: 'Wedding',
    description: null,
    target_audience: null,
    highlights: [],
    budget_range: null,
    cta: null,
    landing_page_slug: null,
    pricing_package_id: null,
    proposal_template_notes: null,
    ai_prompt: null,
    hashtags: [],
    recommended_media: null,
    recommended_posting_time: null,
    whatsapp_template: null,
    email_subject_template: null,
    email_template: null,
    follow_up_sequence_id: null,
    marketing_segment: {},
    status: 'active',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

beforeEach(() => {
  state.rows = []
  state.nextError = null
  state.nextId = 1
  vi.clearAllMocks()
})

describe('listBusinessPackages', () => {
  it('returns all packages when no filter is given', async () => {
    state.rows = [row({ id: 'p1' }), row({ id: 'p2', status: 'retired' })]
    const result = await listBusinessPackages()
    expect(result).toHaveLength(2)
  })

  it('filters by status', async () => {
    state.rows = [row({ id: 'p1', status: 'active' }), row({ id: 'p2', status: 'inactive' })]
    const result = await listBusinessPackages({ status: 'active' })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('p1')
  })

  it('filters by category', async () => {
    state.rows = [row({ id: 'p1', category: 'Wedding' }), row({ id: 'p2', category: 'Corporate' })]
    const result = await listBusinessPackages({ category: 'Corporate' })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('p2')
  })

  it('returns an empty array on a query error rather than throwing', async () => {
    state.nextError = { message: 'db down' }
    const result = await listBusinessPackages()
    expect(result).toEqual([])
  })
})

describe('getBusinessPackageById / getActiveBusinessPackageBySlug', () => {
  it('returns the mapped package when found', async () => {
    state.rows = [row({ id: 'p1', name: 'Pre-Wedding Celebration' })]
    const pkg = await getBusinessPackageById('p1')
    expect(pkg?.name).toBe('Pre-Wedding Celebration')
  })

  it('returns null when not found', async () => {
    const pkg = await getBusinessPackageById('missing')
    expect(pkg).toBeNull()
  })

  it('only matches an ACTIVE package by slug', async () => {
    state.rows = [row({ id: 'p1', landing_page_slug: 'rooftop-party', status: 'inactive' })]
    const pkg = await getActiveBusinessPackageBySlug('rooftop-party')
    expect(pkg).toBeNull()
  })

  it('matches an active package by slug', async () => {
    state.rows = [row({ id: 'p1', landing_page_slug: 'rooftop-party', status: 'active' })]
    const pkg = await getActiveBusinessPackageBySlug('rooftop-party')
    expect(pkg?.id).toBe('p1')
  })
})

describe('createBusinessPackage', () => {
  it('creates a package and maps the row back', async () => {
    const result = await createBusinessPackage({ name: 'Rooftop Party', category: 'Private Party' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.name).toBe('Rooftop Party')
      expect(result.value.status).toBe('active')
      expect(result.value.highlights).toEqual([])
    }
  })

  it('maps a unique-violation on landing_page_slug to a friendly error', async () => {
    state.nextError = { code: '23505', message: 'duplicate key value violates unique constraint' }
    const result = await createBusinessPackage({ name: 'Duplicate Slug Package', landing_page_slug: 'rooftop-party' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('landing_page_slug is already in use by another package')
  })
})

describe('updateBusinessPackage / setBusinessPackageStatus', () => {
  it('updates only the provided fields', async () => {
    state.rows = [row({ id: 'p1', name: 'Original', status: 'active' })]
    const result = await updateBusinessPackage('p1', { description: 'New description' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.name).toBe('Original')
      expect(result.value.description).toBe('New description')
    }
  })

  it('returns an error when there are no fields to update', async () => {
    const result = await updateBusinessPackage('p1', {})
    expect(result.ok).toBe(false)
  })

  it('returns an error when the package does not exist', async () => {
    const result = await updateBusinessPackage('missing', { name: 'X' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('Package not found')
  })

  it('setBusinessPackageStatus transitions active -> inactive -> retired', async () => {
    state.rows = [row({ id: 'p1', status: 'active' })]
    const deactivated = await setBusinessPackageStatus('p1', 'inactive')
    expect(deactivated.ok && deactivated.value.status).toBe('inactive')
    const retired = await setBusinessPackageStatus('p1', 'retired')
    expect(retired.ok && retired.value.status).toBe('retired')
  })
})

describe('resolveBusinessPackageAudience', () => {
  it('delegates to the existing buildSegment() with the package\'s stored SegmentFilter', async () => {
    const pkg = { marketingSegment: { event_type: 'wedding' } } as Pick<BusinessPackage, 'marketingSegment'>
    const audience = await resolveBusinessPackageAudience(pkg)
    expect(buildSegment).toHaveBeenCalledWith({ event_type: 'wedding' })
    expect(audience).toEqual([{ id: 'lead_1', name: 'Test Lead' }])
  })

  it('defaults to an empty filter when marketingSegment is missing', async () => {
    await resolveBusinessPackageAudience({ marketingSegment: undefined as unknown as Record<string, unknown> })
    expect(buildSegment).toHaveBeenCalledWith({})
  })
})

describe('toCampaignConfig', () => {
  const basePkg = (overrides: Partial<BusinessPackage> = {}): BusinessPackage => ({
    id: 'p1', createdAt: '', updatedAt: '', name: 'Rooftop Party', category: 'Private Party',
    description: 'An open-air rooftop party.', targetAudience: null, highlights: [], budgetRange: null,
    cta: null, landingPageSlug: 'rooftop-party', pricingPackageId: null, proposalTemplateNotes: null,
    aiPrompt: null, hashtags: [], recommendedMedia: null, recommendedPostingTime: null,
    whatsappTemplate: null, emailSubjectTemplate: null, emailTemplate: null, followUpSequenceId: null,
    marketingSegment: {}, status: 'active', ...overrides,
  })

  it('returns null when the package has no landing page slug', () => {
    expect(toCampaignConfig(basePkg({ landingPageSlug: null }))).toBeNull()
  })

  it('builds a CampaignConfig-shaped object from the package fields', () => {
    const config = toCampaignConfig(basePkg())
    expect(config?.slug).toBe('rooftop-party')
    expect(config?.label).toBe('Rooftop Party')
    expect(config?.heroHeadline).toBe('Rooftop Party')
    expect(config?.heroSubheadline).toBe('An open-air rooftop party.')
    expect(config?.venueValue).toBe('bookmyspaces')
    expect(config?.propertyLabel).toBeNull()
  })

  it('derives FAQs only from real, stored fields — highlights and budget range', () => {
    const config = toCampaignConfig(basePkg({ highlights: ['Skyline views', 'Flexible seating'], budgetRange: '₹20,000 – ₹70,000' }))
    expect(config?.faqs).toHaveLength(2)
    expect(config?.faqs[0].answer).toContain('Skyline views')
    expect(config?.faqs[1].answer).toContain('₹20,000 – ₹70,000')
  })

  it('produces no FAQs when highlights and budget range are both empty', () => {
    const config = toCampaignConfig(basePkg())
    expect(config?.faqs).toEqual([])
  })

  it('falls back to a generated WhatsApp prefill when no CTA is set', () => {
    const config = toCampaignConfig(basePkg({ cta: null }))
    expect(config?.whatsappPrefill).toBe("Hi! I'm interested in Rooftop Party.")
  })

  it('uses the CTA as the WhatsApp prefill when set', () => {
    const config = toCampaignConfig(basePkg({ cta: 'Reserve the rooftop for your party' }))
    expect(config?.whatsappPrefill).toBe('Reserve the rooftop for your party')
  })
})

describe('buildContentGenerationInput', () => {
  const basePkg: BusinessPackage = {
    id: 'p1', createdAt: '', updatedAt: '', name: 'Baby Shower', category: 'Baby Shower',
    description: 'A warm, decorated setting.', targetAudience: 'Families planning a baby shower',
    highlights: ['Themed decor', 'Hall or rooftop seating'], budgetRange: null, cta: 'Enquire now',
    landingPageSlug: null, pricingPackageId: null, proposalTemplateNotes: null,
    aiPrompt: 'Promote our baby shower package', hashtags: [], recommendedMedia: null,
    recommendedPostingTime: null, whatsappTemplate: null, emailSubjectTemplate: null, emailTemplate: null,
    followUpSequenceId: null, marketingSegment: {}, status: 'active',
  }

  it('uses the stored ai_prompt as the goal, and folds real fields into the context', () => {
    const input = buildContentGenerationInput(basePkg)
    expect(input.goal).toBe('Promote our baby shower package')
    expect(input.context).toContain('A warm, decorated setting.')
    expect(input.context).toContain('Families planning a baby shower')
    expect(input.context).toContain('Themed decor, Hall or rooftop seating')
    expect(input.context).toContain('Enquire now')
  })

  it('falls back to a generated goal when ai_prompt is empty', () => {
    const input = buildContentGenerationInput({ ...basePkg, aiPrompt: null })
    expect(input.goal).toBe('Promote our Baby Shower package')
  })
})

describe('renderPackageWhatsAppMessage / renderPackageEmail', () => {
  it('returns null when no template is set', () => {
    expect(renderPackageWhatsAppMessage({ whatsappTemplate: null, name: 'X' }, 'Priya')).toBeNull()
    expect(renderPackageEmail({ emailSubjectTemplate: null, emailTemplate: null }, 'Priya')).toBeNull()
  })

  it('substitutes {{name}} in the WhatsApp template', () => {
    const message = renderPackageWhatsAppMessage({ whatsappTemplate: 'Hi {{name}}! Interested?', name: 'X' }, 'Priya')
    expect(message).toBe('Hi Priya! Interested?')
  })

  it('falls back to "there" when no lead name is known', () => {
    const message = renderPackageWhatsAppMessage({ whatsappTemplate: 'Hi {{name}}!', name: 'X' }, null)
    expect(message).toBe('Hi there!')
  })

  it('renders both subject and body with the same {{name}} convention', () => {
    const email = renderPackageEmail({ emailSubjectTemplate: 'Hi {{name}}', emailTemplate: 'Dear {{name}}, ...' }, 'Priya')
    expect(email).toEqual({ subject: 'Hi Priya', body: 'Dear Priya, ...' })
  })
})
