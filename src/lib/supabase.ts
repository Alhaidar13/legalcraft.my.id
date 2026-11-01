/* =========================================================
   Supabase client super ringan (REST / PostgREST via fetch)
   - Berjalan di Cloudflare Workers tanpa dependency tambahan
   - Memakai SERVICE ROLE KEY (server-side only, jangan di frontend!)
   ========================================================= */
import type { Bindings } from './types'

export class SupabaseError extends Error {
  status: number
  code?: string
  details?: unknown
  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

type Query = Record<string, string | number | undefined>

export class Supabase {
  private base: string
  private key: string

  constructor(env: Bindings) {
    const url = (env.SUPABASE_URL || '').replace(/\/+$/, '')
    this.base = (env.SUPABASE_REST_URL || (url ? url + '/rest/v1' : '')).replace(/\/+$/, '')
    this.key = env.SUPABASE_SERVICE_ROLE_KEY || ''
    if (!this.base || !this.key) {
      throw new SupabaseError('Supabase belum dikonfigurasi (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).', 500, 'config')
    }
  }

  private async request<T>(method: string, path: string, opts: { query?: Query; body?: unknown; prefer?: string; single?: boolean } = {}): Promise<T> {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(opts.query || {})) if (v !== undefined) qs.append(k, String(v))
    const url = `${this.base}/${path}${qs.toString() ? '?' + qs.toString() : ''}`
    const headers: Record<string, string> = {
      apikey: this.key,
      Authorization: `Bearer ${this.key}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    }
    if (opts.prefer) headers.Prefer = opts.prefer
    const res = await fetch(url, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) })
    const text = await res.text()
    let data: any = null
    if (text) { try { data = JSON.parse(text) } catch { data = text } }
    if (!res.ok) {
      const msg = (data && (data.message || data.error)) || `Supabase error ${res.status}`
      throw new SupabaseError(msg, res.status, data && data.code, data)
    }
    return data as T
  }

  /** SELECT ... LIMIT 1 → baris pertama atau null */
  async selectOne<T>(table: string, filters: Query, columns = '*'): Promise<T | null> {
    const rows = await this.request<T[]>('GET', table, { query: { select: columns, ...filters, limit: 1 } })
    return rows && rows.length ? rows[0] : null
  }

  async select<T>(table: string, filters: Query, columns = '*'): Promise<T[]> {
    return this.request<T[]>('GET', table, { query: { select: columns, ...filters } })
  }

  async insert<T>(table: string, row: Record<string, unknown>): Promise<T> {
    const rows = await this.request<T[]>('POST', table, { body: row, prefer: 'return=representation' })
    return rows[0]
  }

  /** UPDATE ... WHERE filters RETURNING * */
  async update<T>(table: string, filters: Query, patch: Record<string, unknown>): Promise<T[]> {
    return this.request<T[]>('PATCH', table, { query: filters, body: patch, prefer: 'return=representation' })
  }

  async remove(table: string, filters: Query): Promise<void> {
    await this.request('DELETE', table, { query: filters, prefer: 'return=minimal' })
  }

  async rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    return this.request<T>('POST', `rpc/${fn}`, { body: args })
  }
}

/** Helper filter PostgREST */
export const eq = (v: string | number) => `eq.${v}`
export const ilikeExact = (v: string) => `ilike.${v.replace(/([%_\\*])/g, '\\$1')}`
