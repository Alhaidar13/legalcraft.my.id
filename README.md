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
  (akun Google tanpa password → "Buat Kata Sandi") dengan indikator kekuatan · **Logout** (dengan konfirmasi).
- **Pesananku**: riwayat pesanan + filter (Semua / Menunggu / Berhasil / Gagal-Batal), status berwarna,
  aksi cepat: Lanjutkan Bayar, Lihat Status, Lihat Struk, Tanya Progres (WA), Pesan Lagi.

## Palet Warna (satu tema, tanpa dark mode)
Mode gelap/terang dan tombol toggle sudah dihapus. Seluruh situs memakai 5 warna:

| Warna | Hex | Peran |
|---|---|---|
| Ink | `#0F0F0F` | teks utama, tombol utama, hero, bagian harga, footer |
| Lime | `#C7FF2E` | aksen: highlight, badge, CTA, ikon, hover, status berhasil |
| Graphite | `#2E2E2E` | gradasi gelap, kartu di bagian gelap |
| White | `#FFFFFF` | latar halaman & kartu |
| Gray | `#808080` | garis, teks sekunder, elemen netral |

Aturan kontras: lime tidak dipakai sebagai teks di atas putih. Lime hanya jadi teks di atas ink/graphite,
atau jadi latar dengan teks ink. Status (sukses/gagal/pending) dibedakan lewat kombinasi palet, bukan warna lain.

File: token di `public/static/style.css` (`:root`) dan lapisan aksen di `public/static/palette.css`
(dimuat terakhir di semua halaman).

Elemen "hidup": pita berjalan (ticker) lime, headline hero dengan sorotan lime, kartu dengan bayangan offset lime
saat hover, ikon yang berputar kecil saat hover, tombol dengan kilau, blob hero yang bergerak, bagian harga gelap
dengan kartu unggulan berwarna lime, CTA berdenyut, footer dengan garis lime.

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
- ✅ Palet 5 warna (#0F0F0F, #C7FF2E, #2E2E2E, #FFFFFF, #808080), dark mode dihapus
- ⏳ Belum: dashboard admin, pembersihan sesi kedaluwarsa terjadwal (bisa pakai `pg_cron` di Supabase:
  `delete from sessions where expires_at < now();`)

**Tech stack**: Hono + Cloudflare Pages + Supabase (REST/PostgREST) · **Last updated**: 2026-11-19
