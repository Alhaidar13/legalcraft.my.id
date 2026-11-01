/* Web Crypto helpers (kompatibel Cloudflare Workers) */
const enc = new TextEncoder()

const toHex = (buf: ArrayBuffer | Uint8Array) =>
  Array.from(buf instanceof Uint8Array ? buf : new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
const fromHex = (hex: string) => new Uint8Array((hex.match(/.{2}/g) || []).map((h) => parseInt(h, 16)))

export const randomHex = (bytes: number) => toHex(crypto.getRandomValues(new Uint8Array(bytes)))

export const sha256Hex = async (s: string) => toHex(await crypto.subtle.digest('SHA-256', enc.encode(s)))

const PBKDF2_ITER = 100000

async function pbkdf2(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256)
}

/** Format: pbkdf2$<iter>$<saltHex>$<hashHex> */
export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const bits = await pbkdf2(password, salt, PBKDF2_ITER)
  return `pbkdf2$${PBKDF2_ITER}$${toHex(salt)}$${toHex(bits)}`
}

export async function verifyPassword(password: string, stored: string | null) {
  if (!stored) return false
  const [algo, iter, saltHex, hashHex] = stored.split('$')
  if (algo !== 'pbkdf2' || !iter || !saltHex || !hashHex) return false
  const bits = toHex(await pbkdf2(password, fromHex(saltHex), Number(iter)))
  // perbandingan waktu-konstan
  if (bits.length !== hashHex.length) return false
  let diff = 0
  for (let i = 0; i < bits.length; i++) diff |= bits.charCodeAt(i) ^ hashHex.charCodeAt(i)
  return diff === 0
}

export function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
