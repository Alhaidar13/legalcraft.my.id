# LegalCraft — Legalitas Usaha, Lebih Mudah

Website pengurusan NPWP, NIB, dan PT Perorangan: login/register (email + Google), price list,
konsultasi WhatsApp, dan pembayaran BSI / GoPay dengan kode unik + verifikasi otomatis.

**Database: Supabase (PostgreSQL)**. Sebelumnya pakai Cloudflare D1, sekarang sudah dipindah semua ke Supabase.

## Cara pasang database di Supabase (3 langkah)

1. **Buat tabel**: buka Supabase Dashboard → **SQL Editor** → New query → paste seluruh isi
   [`supabase/schema.sql`](supabase/schema.sql) → **Run**. (Aman dijalankan berulang kali.)
2. **Ambil key**: buka **Project Settings → API**, lalu salin:
   - `Project URL` → `SUPABASE_URL`
   - `service_role` key (secret) → `SUPABASE_SERVICE_ROLE_KEY`
3. **Isi environment variable**:
   - Lokal: salin `.dev.vars.example` jadi `.dev.vars`, lalu isi nilainya.
   - Produksi (Cloudflare Pages):
     ```bash
     npx wrangler pages secret put SUPABASE_URL --project-name <nama-project>
     npx wrangler pages secret put SUPABASE_SERVICE_ROLE_KEY --project-name <nama-project>
     npx wrangler pages secret put WEBHOOK_SECRET --project-name <nama-project>
     npx wrangler pages secret put PAYMENT_SIMULATOR --project-name <nama-project>   # isi: false
     npx wrangler pages secret put GOOGLE_CLIENT_ID --project-name <nama-project>    # opsional
     ```

> ⚠️ `service_role` key **hanya dipakai di server** (Cloudflare Worker), tidak pernah dikirim ke browser.
> Semua tabel memakai Row Level Security tanpa policy publik, jadi `anon` key tidak bisa membaca data pelanggan.

## Environment variables

| Variabel | Wajib | Keterangan |
|---|---|---|
| `SUPABASE_URL` | ✅ | contoh `https://abcd1234.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | service role key (rahasia) |
| `WEBHOOK_SECRET` | ✅ untuk webhook | string acak panjang untuk `/api/webhooks/mutasi` |
| `PAYMENT_SIMULATOR` | – | `true` = tombol simulasi bayar muncul (testing). **Set `false` di produksi.** |
| `GOOGLE_CLIENT_ID` | – | aktifkan tombol "Masuk dengan Google" |

## Struktur data (Supabase)

| Tabel | Isi |
|---|---|
| `users` | akun pelanggan: nama, email (unik, tidak peka huruf besar/kecil), WhatsApp, `password_hash` (PBKDF2-SHA256), `google_sub`, avatar |
| `sessions` | sesi login (cookie `lc_session`, disimpan sebagai hash SHA-256, berlaku 30 hari) |
| `orders` | tagihan: layanan, metode (bsi/gopay), harga + kode unik, status `pending → waiting → paid / rejected / expired / cancelled` |
| `bank_mutations` | log dana masuk dari webhook, terhubung ke order yang dilunasi |

Fungsi SQL:
- `expire_orders()`: tagihan `pending` yang lewat 10 menit → `expired`; tagihan `waiting` yang lewat 5 menit verifikasi → `rejected` (`not_received`).
- `record_mutation(...)`: catat dana masuk, cocokkan otomatis ke tagihan aktif dengan nominal persis sama, lalu tandai `paid`. Mutasi dengan `id` yang sama tidak diproses dua kali.

## Halaman & API

| Path | Keterangan |
|---|---|
| `/` | splash / onboarding |
| `/beranda` | homepage (price list & konsultasi butuh login) |
| `/login`, `/register` | auth email + Google |
| `/pembayaran?layanan=npwp\|nib\|pt` | halaman pembayaran (wajib login) |
| `GET /api/auth/config` · `GET /api/auth/me` | konfigurasi Google & user aktif |
| `POST /api/auth/register` · `/login` · `/google` · `/logout` | autentikasi |
| `GET /api/payment/config` | info simulator & batas waktu |
| `POST /api/orders` | buat tagihan `{service, name, phone, method}` |
| `GET /api/orders/:id` | status tagihan (dipakai polling) |
| `POST /api/orders/:id/confirm` · `/cancel` | "Saya Sudah Bayar" / batalkan |
| `POST /api/orders/:id/simulate-payment` · `/simulate-reject` | hanya jika `PAYMENT_SIMULATOR=true` |
| `POST /api/webhooks/mutasi` | dana masuk dari penyedia mutasi rekening |

### Webhook mutasi rekening
Header: `Authorization: Bearer <WEBHOOK_SECRET>` (atau `X-Webhook-Secret`, atau `?secret=`).
Body bisa objek tunggal atau array (format Moota didukung; `type: "DB"` diabaikan):
```json
[{ "id": "MUT-123", "type": "CR", "amount": 149088, "bank_type": "bsi", "description": "TRF ..." }]
```

## Development lokal
```bash
cp .dev.vars.example .dev.vars   # isi kredensial Supabase
npm run build
pm2 start ecosystem.config.cjs   # http://localhost:3000
```

## Status
- ✅ Migrasi D1 → Supabase selesai (auth, sesi, order, webhook, kedaluwarsa otomatis)
- ✅ Diuji end-to-end memakai PostgreSQL 17 + PostgREST (stack yang sama dengan Supabase)
- ⏳ Belum: dashboard admin, pembersihan sesi kedaluwarsa terjadwal (bisa pakai `pg_cron` di Supabase:
  `delete from sessions where expires_at < now();`)

**Tech stack**: Hono + Cloudflare Pages + Supabase (REST/PostgREST) · **Last updated**: 2026-11-01
