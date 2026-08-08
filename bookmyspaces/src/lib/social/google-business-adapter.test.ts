import { describe, it, expect, vi, afterEach } from 'vitest'
import { GoogleBusinessAdapter } from './adapters/google-business-adapter'

// Social OAuth -> Publishing credential fix, Google Business follow-up —
// publishPost() must prefer the OAuth-resolved credentials.externalAccountId
// (the stored Location, discovered once at connect time) over the static
// GOOGLE_BUSINESS_LOCATION_ID env var, and must still fall back to the env
// var for a post with no selected account (backward compatibility).

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 400, json: async () => body } as Response
}

const adapter = new GoogleBusinessAdapter()
const originalEnv = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnv }
  vi.restoreAllMocks()
})

describe('GoogleBusinessAdapter.publishPost — stored location vs legacy env fallback', () => {
  it('publishes to the OAuth-resolved (stored) location, ignoring an unrelated env var', async () => {
    delete process.env.GOOGLE_BUSINESS_LOCATION_ID
    delete process.env.GOOGLE_BUSINESS_ACCESS_TOKEN
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({ name: 'accounts/111/locations/222/localPosts/1' }))

    const result = await adapter.publishPost(
      { postType: 'text', content: 'Monsoon offer', media: [] },
      { accessToken: 'oauth-token', externalAccountId: 'accounts/111/locations/222' }
    )

    expect(result.ok).toBe(true)
    const url = String(fetchSpy.mock.calls[0][0])
    expect(url).toContain('accounts/111/locations/222/localPosts')
    const options = fetchSpy.mock.calls[0][1] as RequestInit
    expect((options.headers as Record<string, string>).Authorization).toBe('Bearer oauth-token')
  })

  it('prefers the stored location even when GOOGLE_BUSINESS_LOCATION_ID is also set to something else', async () => {
    process.env.GOOGLE_BUSINESS_LOCATION_ID = 'accounts/999/locations/WRONG'
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({ name: 'ok' }))

    await adapter.publishPost(
      { postType: 'text', content: 'hi', media: [] },
      { accessToken: 'oauth-token', externalAccountId: 'accounts/111/locations/222' }
    )

    const url = String(fetchSpy.mock.calls[0][0])
    expect(url).toContain('accounts/111/locations/222')
    expect(url).not.toContain('WRONG')
  })

  it('legacy fallback: uses GOOGLE_BUSINESS_LOCATION_ID / GOOGLE_BUSINESS_ACCESS_TOKEN when no account was selected for the post', async () => {
    process.env.GOOGLE_BUSINESS_LOCATION_ID = 'accounts/legacy/locations/legacy'
    process.env.GOOGLE_BUSINESS_ACCESS_TOKEN = 'legacy-token'
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({ name: 'ok' }))

    const result = await adapter.publishPost({ postType: 'text', content: 'hi', media: [] })

    expect(result.ok).toBe(true)
    const url = String(fetchSpy.mock.calls[0][0])
    expect(url).toContain('accounts/legacy/locations/legacy')
    const options = fetchSpy.mock.calls[0][1] as RequestInit
    expect((options.headers as Record<string, string>).Authorization).toBe('Bearer legacy-token')
  })

  it('fails cleanly when neither a stored location nor the legacy env var is available', async () => {
    delete process.env.GOOGLE_BUSINESS_LOCATION_ID
    const result = await adapter.publishPost(
      { postType: 'text', content: 'hi', media: [] },
      { accessToken: 'oauth-token', externalAccountId: null }
    )
    expect(result.ok).toBe(false)
    expect(result.error).toContain('GOOGLE_BUSINESS_LOCATION_ID')
  })

  it('fails cleanly when there is no access token at all (neither OAuth nor env)', async () => {
    delete process.env.GOOGLE_BUSINESS_ACCESS_TOKEN
    const result = await adapter.publishPost({ postType: 'text', content: 'hi', media: [] })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('google_business_not_configured')
  })
})
