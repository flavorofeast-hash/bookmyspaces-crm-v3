// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/social/token-cipher.ts
// Phase 2 (Social Growth) — encrypt/decrypt helper for
// social_accounts.access_token_encrypted (migration 014).
//
// GAP THIS CLOSES: the column has carried the name "_encrypted" and a header
// comment ("stored encrypted by the application layer") since migration 014,
// but no encryption implementation existed anywhere in the codebase — a
// grep across src/ for encrypt/AES/createCipher returned zero matches.
// Writing a real OAuth token into that column before this file existed
// would have stored it as plaintext under a misleading name.
//
// AES-256-GCM, key from SOCIAL_TOKEN_ENCRYPTION_KEY (32 raw bytes, base64).
// If the key is not configured, encrypt()/decrypt() throw rather than
// silently falling back to plaintext — callers (accounts route) turn that
// into a clear 500 'encryption_not_configured' response, same "fail loud,
// never fabricate/never silently violate an invariant" posture used
// throughout this codebase (e.g. MetaAdapter's notConfigured()).
// ─────────────────────────────────────────────────────────────────────────────

import crypto from 'crypto'

const ALGO = 'aes-256-gcm'

function getKey(): Buffer {
  const raw = process.env.SOCIAL_TOKEN_ENCRYPTION_KEY
  if (!raw) {
    throw new Error('encryption_not_configured: set SOCIAL_TOKEN_ENCRYPTION_KEY (32 bytes, base64) in env')
  }
  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32) {
    throw new Error('encryption_not_configured: SOCIAL_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes')
  }
  return key
}

/** True when SOCIAL_TOKEN_ENCRYPTION_KEY is set and well-formed — callers use this to fail fast with a clear error instead of an unhandled throw. */
export function isTokenCipherConfigured(): boolean {
  try {
    getKey()
    return true
  } catch {
    return false
  }
}

// Output shape: base64(iv) + ':' + base64(authTag) + ':' + base64(ciphertext)
export function encryptToken(plaintext: string): string {
  const key = getKey()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ALGO, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`
}

export function decryptToken(stored: string): string {
  const key = getKey()
  const parts = stored.split(':')
  if (parts.length !== 3) throw new Error('malformed_encrypted_token')
  const [ivB64, tagB64, dataB64] = parts
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()])
  return decrypted.toString('utf8')
}
