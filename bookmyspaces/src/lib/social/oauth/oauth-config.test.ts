import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { isOAuthCapablePlatform, isOAuthConfigured, getRedirectUri, toSocialPlatform, OAUTH_CONFIGS } from './oauth-config'

describe('oauth-config', () => {
  describe('isOAuthCapablePlatform', () => {
    it('accepts the 5 real OAuth-capable platforms', () => {
      for (const p of ['facebook', 'instagram', 'linkedin', 'google_business', 'x']) {
        expect(isOAuthCapablePlatform(p)).toBe(true)
      }
    })

    it('rejects platforms with no OAuth config (youtube/threads) and garbage input', () => {
      expect(isOAuthCapablePlatform('youtube')).toBe(false)
      expect(isOAuthCapablePlatform('threads')).toBe(false)
      expect(isOAuthCapablePlatform('not_a_platform')).toBe(false)
      expect(isOAuthCapablePlatform('')).toBe(false)
    })
  })

  describe('isOAuthConfigured', () => {
    const ORIGINAL_ENV = process.env

    beforeEach(() => {
      process.env = { ...ORIGINAL_ENV }
      delete process.env.LINKEDIN_CLIENT_ID
      delete process.env.LINKEDIN_CLIENT_SECRET
    })

    afterEach(() => {
      process.env = ORIGINAL_ENV
    })

    it('is false when client id/secret env vars are unset', () => {
      expect(isOAuthConfigured('linkedin')).toBe(false)
    })

    it('is false when only one of id/secret is set', () => {
      process.env.LINKEDIN_CLIENT_ID = 'abc'
      expect(isOAuthConfigured('linkedin')).toBe(false)
    })

    it('is true when both id and secret are set', () => {
      process.env.LINKEDIN_CLIENT_ID = 'abc'
      process.env.LINKEDIN_CLIENT_SECRET = 'xyz'
      expect(isOAuthConfigured('linkedin')).toBe(true)
    })
  })

  describe('getRedirectUri', () => {
    it('builds the callback URL and strips a trailing slash from the base', () => {
      expect(getRedirectUri('facebook', 'https://app.example.com/')).toBe('https://app.example.com/api/social/oauth/facebook/callback')
      expect(getRedirectUri('x', 'https://app.example.com')).toBe('https://app.example.com/api/social/oauth/x/callback')
    })
  })

  describe('toSocialPlatform', () => {
    it('is an identity mapping for every OAuth-capable platform', () => {
      for (const p of Object.keys(OAUTH_CONFIGS) as (keyof typeof OAUTH_CONFIGS)[]) {
        expect(toSocialPlatform(p)).toBe(p)
      }
    })
  })

  describe('OAUTH_CONFIGS', () => {
    it('marks Meta platforms (facebook/instagram) as not supporting refresh_token', () => {
      expect(OAUTH_CONFIGS.facebook.supportsRefresh).toBe(false)
      expect(OAUTH_CONFIGS.instagram.supportsRefresh).toBe(false)
    })

    it('marks linkedin/google_business/x as supporting refresh_token', () => {
      expect(OAUTH_CONFIGS.linkedin.supportsRefresh).toBe(true)
      expect(OAUTH_CONFIGS.google_business.supportsRefresh).toBe(true)
      expect(OAUTH_CONFIGS.x.supportsRefresh).toBe(true)
    })

    it('only X uses PKCE', () => {
      for (const [platform, cfg] of Object.entries(OAUTH_CONFIGS)) {
        expect(cfg.usesPkce).toBe(platform === 'x')
      }
    })
  })
})
