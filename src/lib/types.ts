export type Bindings = {
  /** URL project Supabase, contoh: https://abcd1234.supabase.co */
  SUPABASE_URL: string
  /** Service role key (Settings → API). RAHASIA — simpan sebagai secret. */
  SUPABASE_SERVICE_ROLE_KEY: string
  /** Opsional: override endpoint REST (default: SUPABASE_URL + /rest/v1) */
  SUPABASE_REST_URL?: string
  /** Opsional: Google OAuth Client ID untuk tombol "Masuk dengan Google" */
  GOOGLE_CLIENT_ID?: string
  /** Secret untuk webhook mutasi rekening /api/webhooks/mutasi */
  WEBHOOK_SECRET?: string
}

export type UserRow = {
  id: string
  name: string
  email: string
  phone: string
  password_hash: string | null
  google_sub: string | null
  avatar: string | null
  created_at: string
}

export type OrderRow = {
  id: string
  user_id: string
  service: string
  service_name: string
  customer_name: string
  phone: string
  method: string
  base_amount: number
  unique_code: number
  amount: number
  status: 'pending' | 'waiting' | 'paid' | 'rejected' | 'expired' | 'cancelled'
  created_at: string
  expires_at: string
  confirmed_at: string | null
  verify_deadline: string | null
  paid_at: string | null
  rejected_at: string | null
  reject_reason: string | null
}

export type PublicUser = {
  id: string
  name: string
  email: string
  phone: string
  avatar: string | null
  hasPassword: boolean
  googleLinked: boolean
  createdAt: string
}

export type AppEnv = { Bindings: Bindings; Variables: { user: PublicUser | null } }
