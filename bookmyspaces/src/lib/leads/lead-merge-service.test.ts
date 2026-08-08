import { describe, it, expect, vi, beforeEach } from 'vitest'

interface LeadRow {
  id: string
  name: string | null
  phone: string | null
  email: string | null
  notes: string | null
  merged_into_lead_id: string | null
}

const state = {
  leads: {} as Record<string, LeadRow>,
  // Concurrency-guard test hook — when true, the atomic claim update
  // (leads.update({merged_into_lead_id}).eq('id',dup).is('merged_into_lead_id',
  // null)) simulates "another request already claimed this duplicate" by
  // returning 0 matched rows, regardless of the in-memory row's actual state.
  claimConflict: false,
  reassignCounts: { activity_logs: 2, social_interactions: 1, reviews: 0, proposals: 1 } as Record<string, number>,
  insertedActivity: [] as Record<string, unknown>[],
}

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: (_col: string, val: string) => ({
          maybeSingle: () => {
            if (table !== 'leads') throw new Error(`unexpected select on ${table}`)
            return Promise.resolve({ data: state.leads[val] ?? null, error: null })
          },
        }),
      }),
      update: (patch: Record<string, unknown>) => {
        let matchVal: string | null = null
        let isNullCol: string | null = null
        const chain: Record<string, unknown> = {}
        chain.eq = (_col: string, val: string) => { matchVal = val; return chain }
        chain.is = (col: string) => { isNullCol = col; return chain }
        chain.select = () => {
          const resultObj: Record<string, unknown> = {}
          resultObj.maybeSingle = () => {
            if (table === 'leads' && isNullCol === 'merged_into_lead_id') {
              const row = matchVal ? state.leads[matchVal] : null
              if (!row || row.merged_into_lead_id !== null || state.claimConflict) {
                return Promise.resolve({ data: null, error: null })
              }
              Object.assign(row, patch)
              return Promise.resolve({ data: { id: matchVal }, error: null })
            }
            throw new Error(`unexpected maybeSingle on ${table}`)
          }
          // Directly awaited (no .maybeSingle()) — the reassignment calls:
          // await db.from('activity_logs').update(...).eq(...).select('id')
          resultObj.then = (resolve: (v: { data: { id: string }[]; error: null }) => void) => {
            const count = state.reassignCounts[table] ?? 0
            resolve({ data: Array.from({ length: count }, (_, i) => ({ id: `${table}_${i}` })), error: null })
          }
          return resultObj
        }
        // Directly awaited with no .select() at all — the primary-lead
        // enrichment update: await db.from('leads').update(enrichment).eq('id', primaryLeadId)
        chain.then = (resolve: (v: { error: null }) => void) => {
          if (table === 'leads' && matchVal) {
            const row = state.leads[matchVal]
            if (row) Object.assign(row, patch)
          }
          resolve({ error: null })
        }
        return chain
      },
      insert: (row: Record<string, unknown>) => {
        state.insertedActivity.push(row)
        return Promise.resolve({ error: null })
      },
    }),
  }),
}))

import { mergeLeads } from './lead-merge-service'

function lead(overrides: Partial<LeadRow> & { id: string }): LeadRow {
  return { name: null, phone: null, email: null, notes: null, merged_into_lead_id: null, ...overrides }
}

beforeEach(() => {
  state.leads = {}
  state.claimConflict = false
  state.reassignCounts = { activity_logs: 2, social_interactions: 1, reviews: 0, proposals: 1 }
  state.insertedActivity = []
})

describe('mergeLeads', () => {
  it('rejects merging a lead into itself', async () => {
    const res = await mergeLeads('lead_a', 'lead_a', 'user_1')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toBe('cannot_merge_lead_into_itself')
  })

  it('returns an error when the primary lead does not exist', async () => {
    state.leads.lead_b = lead({ id: 'lead_b' })
    const res = await mergeLeads('missing', 'lead_b', 'user_1')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toBe('primary_lead_not_found')
  })

  it('returns an error when the duplicate lead does not exist', async () => {
    state.leads.lead_a = lead({ id: 'lead_a' })
    const res = await mergeLeads('lead_a', 'missing', 'user_1')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toBe('duplicate_lead_not_found')
  })

  it('rejects when the duplicate is already merged', async () => {
    state.leads.lead_a = lead({ id: 'lead_a' })
    state.leads.lead_b = lead({ id: 'lead_b', merged_into_lead_id: 'lead_c' })
    const res = await mergeLeads('lead_a', 'lead_b', 'user_1')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toBe('duplicate_lead_already_merged')
  })

  it('rejects when the primary is itself already merged into another lead', async () => {
    state.leads.lead_a = lead({ id: 'lead_a', merged_into_lead_id: 'lead_z' })
    state.leads.lead_b = lead({ id: 'lead_b' })
    const res = await mergeLeads('lead_a', 'lead_b', 'user_1')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toBe('primary_lead_is_itself_already_merged')
  })

  it('rejects a concurrent merge attempt that loses the atomic claim (double-merge race fix)', async () => {
    state.leads.lead_a = lead({ id: 'lead_a' })
    state.leads.lead_b = lead({ id: 'lead_b' })
    state.claimConflict = true
    const res = await mergeLeads('lead_a', 'lead_b', 'user_1')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toBe('duplicate_lead_already_merged')
    // The duplicate must be left untouched — no partial reassignment side effects.
    expect(state.leads.lead_b.merged_into_lead_id).toBeNull()
    expect(state.insertedActivity.length).toBe(0)
  })

  it('merges successfully: claims the duplicate, enriches the primary, reassigns records, and logs an activity entry', async () => {
    state.leads.lead_a = lead({ id: 'lead_a', name: null, phone: '9999999999', email: null, notes: 'Existing note' })
    state.leads.lead_b = lead({ id: 'lead_b', name: 'Jane Doe', phone: '8888888888', email: 'jane@example.com', notes: 'From Instagram DM' })

    const res = await mergeLeads('lead_a', 'lead_b', 'user_1')
    expect(res.ok).toBe(true)
    if (!res.ok) return

    // Duplicate is claimed (merged_into_lead_id set), never deleted.
    expect(state.leads.lead_b.merged_into_lead_id).toBe('lead_a')

    // Enrichment fills gaps only — name (primary had none) and email
    // (primary had none) come from the duplicate; phone is NOT overwritten
    // since the primary already had one.
    expect(state.leads.lead_a.name).toBe('Jane Doe')
    expect(state.leads.lead_a.email).toBe('jane@example.com')
    expect(state.leads.lead_a.phone).toBe('9999999999')
    expect(res.value.enrichedFields.sort()).toEqual(['email', 'name', 'notes'].sort())

    // Reassignment counts flow through from each table's update().select('id').
    expect(res.value.reassigned).toEqual({ activityLogs: 2, socialInteractions: 1, reviews: 0, proposals: 1 })

    // An audit activity entry was logged against the primary.
    expect(state.insertedActivity.length).toBe(1)
    expect(state.insertedActivity[0].lead_id).toBe('lead_a')
    expect(state.insertedActivity[0].action).toBe('lead_merged')
  })

  it('does not overwrite an existing primary field with the duplicate\'s value', async () => {
    state.leads.lead_a = lead({ id: 'lead_a', name: 'Original Name', phone: '111', email: 'orig@example.com', notes: null })
    state.leads.lead_b = lead({ id: 'lead_b', name: 'Duplicate Name', phone: '222', email: 'dup@example.com', notes: null })

    const res = await mergeLeads('lead_a', 'lead_b', 'user_1')
    expect(res.ok).toBe(true)
    expect(state.leads.lead_a.name).toBe('Original Name')
    expect(state.leads.lead_a.phone).toBe('111')
    expect(state.leads.lead_a.email).toBe('orig@example.com')
    if (res.ok) expect(res.value.enrichedFields).toEqual([])
  })
})
