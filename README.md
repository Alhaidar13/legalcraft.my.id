# LegalCraft — Legalitas Usaha, Lebih Mudah

Website pengurusan NPWP, NIB, dan PT Perorangan: login/register (email + Google), price list,
konsultasi WhatsApp, pembayaran BSI / GoPay dengan kode unik + verifikasi otomatis,
**halaman profil user (Profil Saya & Pesananku)**, dan **mode terang / gelap**.

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
| `/profil` (`#profil` / `#pesanan`) | halaman profil user, tab **Profil Saya** & **Pesananku** (wajib login) |
| `GET /api/auth/config` · `GET /api/auth/me` | konfigurasi Google & user aktif |
| `POST /api/auth/register` · `/login` · `/google` · `/logout` | autentikasi |
| `GET /api/payment/config` | info batas waktu pembayaran & verifikasi |
| `POST /api/orders` | buat tagihan `{service, name, phone, method}` |
| `GET /api/orders/:id` | status tagihan (dipakai polling) |
| `POST /api/orders/:id/confirm` · `/cancel` | "Saya Sudah Bayar" / batalkan |
| `GET /api/me/profile` | profil user aktif (nama, email, WA, foto, metode login) |
| `PUT /api/me/profile` | edit `{name, email, phone, avatar}` (avatar = data URL PNG/JPG/WEBP, `null` = hapus) |
| `POST /api/me/password` | ubah kata sandi `{currentPassword, newPassword}`; sesi di perangkat lain otomatis dikeluarkan |
| `GET /api/me/orders` | riwayat pesanan user (terbaru dulu, maks. 100) |
| `POST /api/webhooks/mutasi` | dana masuk dari penyedia mutasi rekening |

### Webhook mutasi rekening
Header: `Authorization: Bearer <WEBHOOK_SECRET>` (atau `X-Webhook-Secret`, atau `?secret=`).
Body bisa objek tunggal atau array (format Moota didukung; `type: "DB"` diabaikan):
```json
[{ "id": "MUT-123", "type": "CR", "amount": 149088, "bank_type": "bsi", "description": "TRF ..." }]
```

## Halaman Profil (`/profil`)
Klik chip foto + nama di navbar beranda (setelah login). Model **Tabbed View**:
- **Profil Saya**: foto profil (upload → otomatis dipotong persegi & dikompres di browser), nama,
  email, No. WhatsApp, metode login, tanggal bergabung · tombol **Edit Profil** · **Ubah Kata Sandi**
  (akun Google tanpa password → "Buat Kata Sandi") dengan indikator kekuatan · pilihan tema · **Logout** (dengan konfirmasi).
- **Pesananku**: riwayat pesanan + filter (Semua / Menunggu / Berhasil / Gagal-Batal), status berwarna,
  aksi cepat: Lanjutkan Bayar, Lihat Status, Lihat Struk, Tanya Progres (WA), Pesan Lagi.

## Light & Dark Mode
Tombol bulan/matahari di navbar setiap halaman (login/register: tombol melayang kanan atas).
Pilihan disimpan di `localStorage` (`lc_theme`); default mengikuti setelan perangkat; tanpa "kedip" saat load.
File: `public/static/theme.css` (palet + override) dan `public/static/theme.js` (toggle).

Tema gelap **"Midnight Slate"** — dibangun dari 2 warna inti `#0B1329` (latar) & `#1E293B` (kartu),
dengan satu aksen sky-blue agar kontras tetap nyaman dan tidak bertabrakan.

| Token | Light (dasar) | Dark |
|---|---|---|
| Primary | `#17517E` | `#60B5EE` (sky) |
| Accent | `#2C83B8` | `#93D0F5` |
| Background | `#F8FAFC` | `#0B1329` (midnight navy) |
| Surface / kartu | `#FFFFFF` | `#1E293B` (slate) |
| Surface 2 / input | `#F8FAFC` | `#131D33` |
| Tint biru | `#F1F7FC` | `#1B3050` |
| Text | `#0F172A` | `#E2E8F0` |
| Muted | `#475569` | `#94A3B8` |
| Border | `#E2E8F0` | `#2B3A52` |
| Hero / CTA | `#17517E → #6FB4DD` | `#0B1329 → #1E293B → #1D5A8A` + glow sky |
| Footer | `#17517E` | `#070D1F` + garis gradasi sky |

Detail kreatif dark mode: cahaya radial lembut di latar, highlight kaca di tepi atas kartu,
glow sky saat hover kartu, kilau pada kartu harga unggulan, scrollbar & seleksi teks senada.

## Development lokal
```bash
cp .dev.vars.example .dev.vars   # isi kredensial Supabase
npm run build
pm2 start ecosystem.config.cjs   # http://localhost:3000
```

## Status
- ✅ Migrasi D1 → Supabase selesai (auth, sesi, order, webhook, kedaluwarsa otomatis)
- ✅ Diuji end-to-end memakai PostgreSQL 17 + PostgREST (stack yang sama dengan Supabase)
- ✅ Tombol "Simulasikan Dana Masuk / Tidak Masuk" di step 3 pembayaran dihapus
- ✅ Halaman profil tabbed (Profil Saya & Pesananku): edit profil, foto, ubah kata sandi, riwayat pesanan, logout
- ✅ Light & dark mode di semua halaman
- ⏳ Belum: dashboard admin, pembersihan sesi kedaluwarsa terjadwal (bisa pakai `pg_cron` di Supabase:
  `delete from sessions where expires_at < now();`)

**Tech stack**: Hono + Cloudflare Pages + Supabase (REST/PostgREST) · **Last updated**: 2026-11-03
