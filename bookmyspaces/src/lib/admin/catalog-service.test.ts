import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockDb = {
  lastTable: '' as string,
  lastInsert: null as unknown,
  lastUpdate: null as unknown,
  lastEq: null as [string, unknown] | null,
  listRows: [] as unknown[],
  row: { id: 'r1' } as Record<string, unknown>,
  error: null as { message: string } | null,
}

function chain() {
  const c: Record<string, unknown> = {}
  c.select = () => c
  c.order = () => Promise.resolve({ data: mockDb.listRows, error: mockDb.error })
  // list path: .select().order() resolves; filtered list: .select().order().eq() — model eq before order too
  c.eq = (col: string, val: unknown) => {
    mockDb.lastEq = [col, val]
    return c
  }
  c.insert = (v: unknown) => {
    mockDb.lastInsert = v
    return { select: () => ({ single: () => Promise.resolve({ data: mockDb.row, error: mockDb.error }) }) }
  }
  c.update = (v: unknown) => {
    mockDb.lastUpdate = v
    return {
      eq: () => ({ select: () => ({ single: () => Promise.resolve({ data: mockDb.row, error: mockDb.error }) }) }),
    }
  }
  c.then = undefined
  return c
}

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      mockDb.lastTable = table
      return chain()
    },
  }),
}))

import {
  isCatalogEntity,
  createCatalogRow,
  updateCatalogRow,
  deactivateCatalogRow,
} from './catalog-service'

beforeEach(() => {
  mockDb.lastTable = ''
  mockDb.lastInsert = null
  mockDb.lastUpdate = null
  mockDb.lastEq = null
  mockDb.listRows = []
  mockDb.row = { id: 'r1' }
  mockDb.error = null
})

describe('isCatalogEntity', () => {
  it('accepts the five catalog entities and rejects arbitrary strings', () => {
    expect(isCatalogEntity('properties')).toBe(true)
    expect(isCatalogEntity('rate-plans')).toBe(true)
    expect(isCatalogEntity('leads')).toBe(false)
    expect(isCatalogEntity('__proto__')).toBe(false)
  })
})

describe('createCatalogRow', () => {
  it('targets the right table and strips non-allow-listed columns', async () => {
    const res = await createCatalogRow('inventory-items', {
      property_id: 'p1',
      inventory_type: 'room',
      name: 'Deluxe Room',
      id: 'attacker-controlled',
      created_at: '1999-01-01',
    })
    expect(res.ok).toBe(true)
    expect(mockDb.lastTable).toBe('inventory_items')
    expect(mockDb.lastInsert).toEqual({
      property_id: 'p1',
      inventory_type: 'room',
      name: 'Deluxe Room',
    })
  })

  it('surfaces DB errors', async () => {
    mockDb.error = { message: 'duplicate key' }
    const res = await createCatalogRow('properties', { name: 'X', slug: 'x' })
    expect(res.ok).toBe(false)
  })
})

describe('updateCatalogRow', () => {
  it('rejects an update where nothing survives the allow-list', async () => {
    const res = await updateCatalogRow('meal-plans', 'id1', { id: 'nope', created_at: 'nope' })
    expect(res.ok).toBe(false)
  })

  it('passes allow-listed values through', async () => {
    const res = await updateCatalogRow('rate-plans', 'id1', { price: 4500, priority: 2 })
    expect(res.ok).toBe(true)
    expect(mockDb.lastUpdate).toEqual({ price: 4500, priority: 2 })
  })
})

describe('deactivateCatalogRow', () => {
  it('soft-deletes via is_active=false', async () => {
    const res = await deactivateCatalogRow('addon-services', 'id9')
    expect(res.ok).toBe(true)
    expect(mockDb.lastUpdate).toEqual({ is_active: false })
  })
})
