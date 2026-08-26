// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/google/gbp-crypto.ts
// GBP token encryption -- extracted verbatim from callback/route.ts (no
// behavior change) so gbp-token.ts's refresh logic can decrypt the stored
// refresh token and re-encrypt a fresh access token using the exact same
// scheme, instead of duplicating this logic a second time.
//
// AES-256-GCM, keyed off SOCIAL_TOKEN_ENCRYPTION_KEY. sha256 of the raw env
// value derives a fixed 32-byte key regardless of the secret's own length/
// format. Output: "iv.authTag.ciphertext", all base64. Distinct scheme from
// src/lib/social/token-cipher.ts (different key derivation, different
// output format) -- the two are not interchangeable and were never meant
// to be (see callback/route.ts's original header).
// ─────────────────────────────────────────────────────────────────────────────

import crypto from 'crypto'

const ALGO = 'aes-256-gcm'

function getKey(): Buffer {
  const secret = process.env.SOCIAL_TOKEN_ENCRYPTION_KEY
  if (!secret) throw new Error('SOCIAL_TOKEN_ENCRYPTION_KEY is not set')
  return crypto.createHash('sha256').update(secret).digest()
}

export function encryptGbpToken(plaintext: string): string {
  const key = getKey()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ALGO, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return [iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join('.')
}

export function decryptGbpToken(stored: string): string {
  const key = getKey()
  const parts = stored.split('.')
  if (parts.length !== 3) throw new Error('malformed_encrypted_gbp_token')
  const [ivB64, tagB64, dataB64] = parts
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()])
  return decrypted.toString('utf8')
}
