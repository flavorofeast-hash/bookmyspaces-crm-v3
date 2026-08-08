import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = { insertedRow: null as Record<string, unknown> | null, nextError: null as { message: string } | null }

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table !== 'social_posts') throw new Error(`unexpected table ${table}`)
      return {
        insert: (row: Record<string, unknown>) => ({
          select: () => ({
            single: () => {
              if (state.nextError) return Promise.resolve({ data: null, error: state.nextError })
              state.insertedRow = row
              return Promise.resolve({ data: { id: 'post_1', ...row }, error: null })
            },
          }),
        }),
      }
    },
  }),
}))

import { createSocialPost } from './post-service'

beforeEach(() => {
  state.insertedRow = null
  state.nextError = null
})

describe('createSocialPost', () => {
  it('carries platform, business_package_id, and campaign_id through to the insert (End-to-End Campaign Attribution)', async () => {
    const result = await createSocialPost({
      platform: 'facebook',
      post_type: 'text',
      content: 'Promo',
      created_by: 'admin@bookmyspaces.in',
      business_package_id: 'pkg1',
      campaign_id: 'camp1',
    })
    expect(result.ok).toBe(true)
    expect(state.insertedRow).toMatchObject({ platform: 'facebook', business_package_id: 'pkg1', campaign_id: 'camp1' })
    if (result.ok) {
      expect(result.value.business_package_id).toBe('pkg1')
      expect(result.value.campaign_id).toBe('camp1')
    }
  })

  it('defaults business_package_id and campaign_id to null when omitted', async () => {
    await createSocialPost({ platform: 'instagram', post_type: 'text', content: 'Hi', created_by: 'admin' })
    expect(state.insertedRow).toMatchObject({ business_package_id: null, campaign_id: null })
  })

  it('returns an error (never throws) when the insert fails', async () => {
    state.nextError = { message: 'insert denied' }
    const result = await createSocialPost({ platform: 'facebook', post_type: 'text', content: 'X', created_by: 'admin' })
    expect(result.ok).toBe(false)
  })
})
