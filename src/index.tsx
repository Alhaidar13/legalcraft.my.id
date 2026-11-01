/* =========================================================
   LegalCraft — Backend (Hono + Cloudflare Pages + Supabase)
   Database: Supabase PostgreSQL (lihat supabase/schema.sql)
   ========================================================= */
import { Hono } from 'hono'
import type { Context } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { Supabase, SupabaseError, eq, ilikeExact } from './lib/supabase'
import { hashPassword, verifyPassword, randomHex, sha256Hex, safeEqual } from './lib/crypto'
import type { AppEnv, OrderRow, PublicUser, UserRow } from './lib/types'

import indexHtml from './pages/index.html?raw'
import berandaHtml from './pages/beranda.html?raw'
import loginHtml from './pages/login.html?raw'
import registerHtml from './pages/register.html?raw'
import pembayaranHtml from './pages/pembayaran.html?raw'

/* ---------------- Konstanta bisnis ---------------- */
const SERVICES: Record<string, { name: string; price: number }> = {
  npwp: { name: 'Pengurusan NPWP', price: 149000 },
  nib: { name: 'Pengurusan NIB', price: 149000 },
  pt: { name: 'Pendirian PT Perorangan', price: 499000 }
}
const METHODS = ['bsi', 'gopay']
const PAYMENT_WINDOW = 10 * 60 * 1000 // batas bayar
const VERIFY_WINDOW = 5 * 60 * 1000 // batas verifikasi setelah klik "Saya Sudah Bayar"
const SESSION_COOKIE = 'lc_session'
const SESSION_TTL = 30 * 24 * 60 * 60 // 30 hari (detik)

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const PHONE_RE = /^(\+62|62|0)8[0-9]{7,12}$/

const app = new Hono<AppEnv>()

/* ---------------- Helpers ---------------- */
const db = (c: Context<AppEnv>) => new Supabase(c.env)
const ms = (v: string | null) => (v ? new Date(v).getTime() : null)
const iso = (t: number) => new Date(t).toISOString()
const cleanPhone = (p: unknown) => String(p ?? '').trim().replace(/[\s-]/g, '')
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

const toPublicUser = (u: UserRow): PublicUser => ({ id: u.id, name: u.name, email: u.email, phone: u.phone, avatar: u.avatar })

const toOrderJson = (o: OrderRow) => ({
  id: o.id,
  service: o.service,
  serviceName: o.service_name,
  customerName: o.customer_name,
  phone: o.phone,
  method: o.method,
  baseAmount: o.base_amount,
  uniqueCode: o.unique_code,
  amount: o.amount,
  status: o.status,
  createdAt: ms(o.created_at),
  expiresAt: ms(o.expires_at),
  confirmedAt: ms(o.confirmed_at),
  verifyDeadline: ms(o.verify_deadline),
  paidAt: ms(o.paid_at),
  rejectedAt: ms(o.rejected_at),
  rejectReason: o.reject_reason,
  serverTime: Date.now()
})

const simulatorOn = (c: Context<AppEnv>) => String(c.env.PAYMENT_SIMULATOR ?? 'true').toLowerCase() === 'true'

async function readJson(c: Context<AppEnv>): Promise<Record<string, any>> {
  try {
    const b = await c.req.json()
    return b && typeof b === 'object' ? b : {}
  } catch {
    return {}
  }
}

/* ---------------- Session ---------------- */
async function createSession(c: Context<AppEnv>, userId: string) {
  const token = randomHex(32)
  await db(c).insert('sessions', {
    token_hash: await sha256Hex(token),
    user_id: userId,
    expires_at: iso(Date.now() + SESSION_TTL * 1000)
  })
  setCookie(c, SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    secure: new URL(c.req.url).protocol === 'https:',
    maxAge: SESSION_TTL
  })
}

async function currentUser(c: Context<AppEnv>): Promise<PublicUser | null> {
  const token = getCookie(c, SESSION_COOKIE)
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null
  const s = await db(c).selectOne<{ expires_at: string; users: UserRow | null }>(
    'sessions',
    { token_hash: eq(await sha256Hex(token)) },
    'expires_at,users(*)'
  )
  if (!s || !s.users || new Date(s.expires_at).getTime() <= Date.now()) return null
  return toPublicUser(s.users)
}

/* ---------------- Google Sign-In ---------------- */
type GoogleProfile = { sub: string; email: string; name: string; avatar: string | null }

async function verifyGoogle(c: Context<AppEnv>, credential: unknown): Promise<GoogleProfile | null> {
  const clientId = c.env.GOOGLE_CLIENT_ID
  if (!clientId || typeof credential !== 'string' || credential.split('.').length !== 3) return null
  try {
    const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential))
    if (!r.ok) return null
    const t: any = await r.json()
    const issOk = t.iss === 'accounts.google.com' || t.iss === 'https://accounts.google.com'
    const verified = t.email_verified === true || t.email_verified === 'true'
    if (t.aud !== clientId || !issOk || !verified || Number(t.exp) * 1000 < Date.now() || !t.email) return null
    return { sub: String(t.sub), email: String(t.email).toLowerCase(), name: String(t.name || t.email.split('@')[0]), avatar: t.picture || null }
  } catch {
    return null
  }
}

const findUserByEmail = (c: Context<AppEnv>, email: string) => db(c).selectOne<UserRow>('users', { email: ilikeExact(email) })

/* ---------------- Error handler ---------------- */
app.onError((err, c) => {
  console.error('[error]', err)
  if (err instanceof SupabaseError && err.code === 'config') return c.json({ error: err.message }, 500)
  return c.json({ error: 'Terjadi kesalahan pada server, coba lagi.' }, 500)
})

/* ---------------- Middleware: user aktif ---------------- */
app.use('*', async (c, next) => {
  c.set('user', null)
  const p = c.req.path
  if (p.startsWith('/static/') || p === '/api/webhooks/mutasi' || p === '/api/auth/config' || p === '/api/payment/config') return next()
  try {
    c.set('user', await currentUser(c))
  } catch (e) {
    // Halaman tetap tampil walau DB bermasalah; endpoint API akan mengembalikan error-nya sendiri
    console.error('[session]', e instanceof Error ? e.message : e)
  }
  return next()
})

app.use('*', async (c, next) => {
  await next()
  if (c.req.path.startsWith('/api/') || c.res.headers.get('content-type')?.includes('text/html')) {
    c.res.headers.set('Cache-Control', 'no-store')
  }
})

/* =========================================================
   AUTH API
   ========================================================= */
app.get('/api/auth/config', (c) => c.json({ googleClientId: c.env.GOOGLE_CLIENT_ID || null }))

app.get('/api/auth/me', (c) => c.json({ user: c.get('user') }))

app.post('/api/auth/register', async (c) => {
  const b = await readJson(c)
  const name = str(b.name)
  const phone = cleanPhone(b.phone)
  if (name.length < 3) return c.json({ error: 'Nama minimal 3 karakter.', field: 'name' }, 400)
  if (name.length > 100) return c.json({ error: 'Nama maksimal 100 karakter.', field: 'name' }, 400)
  if (!PHONE_RE.test(phone)) return c.json({ error: 'Nomor WhatsApp tidak valid.', field: 'phone' }, 400)

  let row: Record<string, unknown>
  if (b.credential) {
    // Daftar via Google
    const g = await verifyGoogle(c, b.credential)
    if (!g) return c.json({ error: 'Sesi Google tidak valid atau kedaluwarsa.' }, 401)
    const existing = await findUserByEmail(c, g.email)
    if (existing) return c.json({ error: 'Email sudah terdaftar.', code: 'exists' }, 409)
    row = { name, phone, email: g.email, google_sub: g.sub, avatar: g.avatar }
  } else {
    const email = str(b.email).toLowerCase()
    const password = typeof b.password === 'string' ? b.password : ''
    if (!EMAIL_RE.test(email)) return c.json({ error: 'Email tidak valid.', field: 'email' }, 400)
    if (password.length < 8) return c.json({ error: 'Password minimal 8 karakter.', field: 'password' }, 400)
    if (password.length > 128) return c.json({ error: 'Password maksimal 128 karakter.', field: 'password' }, 400)
    if (await findUserByEmail(c, email)) return c.json({ error: 'Email sudah terdaftar.', code: 'exists' }, 409)
    row = { name, phone, email, password_hash: await hashPassword(password) }
  }

  let user: UserRow
  try {
    user = await db(c).insert<UserRow>('users', row)
  } catch (e) {
    if (e instanceof SupabaseError && e.code === '23505') return c.json({ error: 'Email sudah terdaftar.', code: 'exists' }, 409)
    throw e
  }
  await createSession(c, user.id)
  return c.json({ ok: true, redirect: '/beranda' })
})

app.post('/api/auth/login', async (c) => {
  const b = await readJson(c)
  const email = str(b.email).toLowerCase()
  const password = typeof b.password === 'string' ? b.password : ''
  if (!EMAIL_RE.test(email)) return c.json({ error: 'Email belum terdaftar.', code: 'not_registered' }, 404)
  const user = await findUserByEmail(c, email)
  if (!user) return c.json({ error: 'Email belum terdaftar.', code: 'not_registered' }, 404)
  if (!user.password_hash) {
    return c.json({ error: 'Akun ini terdaftar dengan Google. Silakan klik "Masuk dengan Google".' }, 401)
  }
  if (!(await verifyPassword(password, user.password_hash))) return c.json({ error: 'Email atau password salah.' }, 401)
  await createSession(c, user.id)
  return c.json({ ok: true, redirect: '/beranda' })
})

app.post('/api/auth/google', async (c) => {
  const b = await readJson(c)
  const g = await verifyGoogle(c, b.credential)
  if (!g) return c.json({ error: 'Login Google gagal diverifikasi.' }, 401)

  let user = await db(c).selectOne<UserRow>('users', { google_sub: eq(g.sub) })
  if (!user) {
    user = await findUserByEmail(c, g.email)
    if (user) {
      // Hubungkan akun email yang sudah ada dengan akun Google
      const patch: Record<string, unknown> = { google_sub: g.sub }
      if (!user.avatar && g.avatar) patch.avatar = g.avatar
      await db(c).update('users', { id: eq(user.id) }, patch)
    }
  }
  if (!user) {
    return c.json({ error: 'Akun Google belum terdaftar.', code: 'not_registered', profile: { name: g.name, email: g.email, avatar: g.avatar } }, 404)
  }
  await createSession(c, user.id)
  return c.json({ ok: true, redirect: '/beranda' })
})

app.post('/api/auth/logout', async (c) => {
  const token = getCookie(c, SESSION_COOKIE)
  if (token && /^[a-f0-9]{64}$/.test(token)) {
    try { await db(c).remove('sessions', { token_hash: eq(await sha256Hex(token)) }) } catch (e) { console.error('[logout]', e) }
  }
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
  return c.json({ ok: true })
})

/* =========================================================
   PAYMENT / ORDERS API
   ========================================================= */
app.get('/api/payment/config', (c) =>
  c.json({ simulator: simulatorOn(c), paymentWindow: PAYMENT_WINDOW, verifyWindow: VERIFY_WINDOW })
)

const requireUser = (c: Context<AppEnv>) => {
  const u = c.get('user')
  return u ? u : null
}

/** Ambil order milik user setelah menerapkan kedaluwarsa otomatis */
async function getOwnOrder(c: Context<AppEnv>, id: string, userId: string) {
  if (!/^LC[0-9A-F]{6,20}$/i.test(id)) return null
  await db(c).rpc('expire_orders')
  return db(c).selectOne<OrderRow>('orders', { id: eq(id), user_id: eq(userId) })
}

const notFoundOrder = (c: Context<AppEnv>) => c.json({ error: 'Tagihan tidak ditemukan.' }, 404)
const unauth = (c: Context<AppEnv>) => c.json({ error: 'Silakan login terlebih dahulu.' }, 401)

app.post('/api/orders', async (c) => {
  const user = requireUser(c)
  if (!user) return unauth(c)
  const b = await readJson(c)
  const service = str(b.service)
  const method = str(b.method)
  const name = str(b.name)
  const phone = cleanPhone(b.phone)
  const svc = SERVICES[service]
  if (!svc) return c.json({ error: 'Layanan tidak valid.' }, 400)
  if (!METHODS.includes(method)) return c.json({ error: 'Metode pembayaran tidak valid.' }, 400)
  if (name.length < 3 || name.length > 100) return c.json({ error: 'Nama lengkap minimal 3 karakter.' }, 400)
  if (!PHONE_RE.test(phone)) return c.json({ error: 'Nomor WhatsApp tidak valid.' }, 400)

  await db(c).rpc('expire_orders')

  // Satu user hanya punya satu tagihan "pending" aktif → batalkan yang lama
  await db(c).update('orders', { user_id: eq(user.id), status: 'eq.pending' }, { status: 'cancelled' })

  const now = Date.now()
  const d = new Date(now + 7 * 3600 * 1000) // tanggal WIB untuk ID
  const ymd = String(d.getUTCFullYear()).slice(2) + String(d.getUTCMonth() + 1).padStart(2, '0') + String(d.getUTCDate()).padStart(2, '0')

  for (let attempt = 0; attempt < 8; attempt++) {
    const uniqueCode = 1 + (crypto.getRandomValues(new Uint16Array(1))[0] % 999)
    try {
      const order = await db(c).insert<OrderRow>('orders', {
        id: 'LC' + ymd + randomHex(3).toUpperCase(),
        user_id: user.id,
        service,
        service_name: svc.name,
        customer_name: name,
        phone,
        method,
        base_amount: svc.price,
        unique_code: uniqueCode,
        amount: svc.price + uniqueCode,
        status: 'pending',
        created_at: iso(now),
        expires_at: iso(now + PAYMENT_WINDOW)
      })
      return c.json(toOrderJson(order))
    } catch (e) {
      // 23505 = nominal / id bentrok dengan tagihan aktif lain → coba kode unik lain
      if (e instanceof SupabaseError && e.code === '23505') continue
      throw e
    }
  }
  return c.json({ error: 'Sistem sedang sibuk, silakan coba lagi.' }, 503)
})

app.get('/api/orders/:id', async (c) => {
  const user = requireUser(c)
  if (!user) return unauth(c)
  const o = await getOwnOrder(c, c.req.param('id'), user.id)
  return o ? c.json(toOrderJson(o)) : notFoundOrder(c)
})

// User klik "Saya Sudah Bayar" → status menunggu konfirmasi (verifikasi otomatis)
app.post('/api/orders/:id/confirm', async (c) => {
  const user = requireUser(c)
  if (!user) return unauth(c)
  const o = await getOwnOrder(c, c.req.param('id'), user.id)
  if (!o) return notFoundOrder(c)
  if (o.status !== 'pending') return c.json(toOrderJson(o))
  const now = Date.now()
  const [u] = await db(c).update<OrderRow>(
    'orders',
    { id: eq(o.id), status: 'eq.pending' },
    { status: 'waiting', confirmed_at: iso(now), verify_deadline: iso(now + VERIFY_WINDOW) }
  )
  return c.json(toOrderJson(u || (await getOwnOrder(c, o.id, user.id))!))
})

app.post('/api/orders/:id/cancel', async (c) => {
  const user = requireUser(c)
  if (!user) return unauth(c)
  const o = await getOwnOrder(c, c.req.param('id'), user.id)
  if (!o) return notFoundOrder(c)
  if (!['pending', 'waiting'].includes(o.status)) return c.json(toOrderJson(o))
  const [u] = await db(c).update<OrderRow>('orders', { id: eq(o.id), status: 'in.(pending,waiting)' }, { status: 'cancelled' })
  return c.json(toOrderJson(u || (await getOwnOrder(c, o.id, user.id))!))
})

// ---- Simulator (testing). Matikan di produksi: PAYMENT_SIMULATOR=false ----
app.post('/api/orders/:id/simulate-payment', async (c) => {
  if (!simulatorOn(c)) return c.json({ error: 'Not found' }, 404)
  const user = requireUser(c)
  if (!user) return unauth(c)
  const o = await getOwnOrder(c, c.req.param('id'), user.id)
  if (!o) return notFoundOrder(c)
  if (['pending', 'waiting'].includes(o.status)) {
    await db(c).rpc('record_mutation', {
      p_amount: o.amount,
      p_method: o.method,
      p_external_id: 'SIM-' + o.id,
      p_description: 'Simulasi dana masuk',
      p_raw: { simulated: true }
    })
  }
  return c.json(toOrderJson((await getOwnOrder(c, o.id, user.id))!))
})

app.post('/api/orders/:id/simulate-reject', async (c) => {
  if (!simulatorOn(c)) return c.json({ error: 'Not found' }, 404)
  const user = requireUser(c)
  if (!user) return unauth(c)
  const o = await getOwnOrder(c, c.req.param('id'), user.id)
  if (!o) return notFoundOrder(c)
  if (!['pending', 'waiting'].includes(o.status)) return c.json(toOrderJson(o))
  const [u] = await db(c).update<OrderRow>(
    'orders',
    { id: eq(o.id), status: 'in.(pending,waiting)' },
    { status: 'rejected', rejected_at: iso(Date.now()), reject_reason: 'not_received' }
  )
  return c.json(toOrderJson(u || (await getOwnOrder(c, o.id, user.id))!))
})

/* =========================================================
   WEBHOOK MUTASI REKENING (dana masuk)
   Auth  : header "Authorization: Bearer <WEBHOOK_SECRET>"
           atau "X-Webhook-Secret: <WEBHOOK_SECRET>" atau ?secret=<WEBHOOK_SECRET>
   Body  : { "amount": 149088, "method": "bsi"|"gopay", "id": "mutasi-123", "description": "..." }
           atau array dari objek di atas (format Moota: type "CR" diproses, "DB" diabaikan)
   ========================================================= */
app.post('/api/webhooks/mutasi', async (c) => {
  const secret = c.env.WEBHOOK_SECRET || ''
  const auth = c.req.header('authorization') || ''
  const given = (auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '') || c.req.header('x-webhook-secret') || c.req.query('secret') || ''
  if (!secret || !given || !safeEqual(given, secret)) return c.json({ error: 'unauthorized' }, 401)

  const body: any = await c.req.json().catch(() => null)
  const items: any[] = Array.isArray(body) ? body : body && Array.isArray(body.data) ? body.data : body ? [body] : []
  const results: unknown[] = []
  for (const it of items) {
    if (it && it.type && String(it.type).toUpperCase() !== 'CR') { results.push({ skipped: 'not_credit' }); continue }
    const amount = Math.round(Number(it && it.amount))
    if (!Number.isFinite(amount) || amount <= 0) { results.push({ skipped: 'invalid_amount' }); continue }
    const rawMethod = String((it && (it.method || it.bank_type || it.bank)) || '').toLowerCase()
    const method = rawMethod.includes('gopay') ? 'gopay' : rawMethod.includes('bsi') || rawMethod.includes('syariah') ? 'bsi' : null
    const externalId = it.id ?? it.mutation_id ?? it.external_id ?? null
    const rows = await db(c).rpc<{ mutation_id: number; order_id: string | null; duplicate: boolean }[]>('record_mutation', {
      p_amount: amount,
      p_method: method,
      p_external_id: externalId === null ? null : String(externalId),
      p_description: it.description ?? it.note ?? null,
      p_raw: it
    })
    results.push(rows && rows[0] ? { amount, ...rows[0] } : { amount })
  }
  return c.json({ ok: true, processed: results.length, results })
})

app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404))

/* =========================================================
   HALAMAN
   ========================================================= */
app.get('/', (c) => c.html(indexHtml))
app.get('/beranda', (c) => c.html(berandaHtml))
app.get('/login', (c) => c.html(loginHtml))
app.get('/register', (c) => c.html(registerHtml))
app.get('/pembayaran', (c) => {
  if (!c.get('user')) {
    const url = new URL(c.req.url)
    return c.redirect('/login?next=' + encodeURIComponent(url.pathname + url.search), 302)
  }
  return c.html(pembayaranHtml)
})
app.get('/dashboard', (c) => c.redirect('/beranda', 301))
app.get('*', (c) => (c.req.path.startsWith('/static/') ? c.text('Not found', 404) : c.redirect('/beranda', 302)))

export default app
