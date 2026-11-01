-- =====================================================================
--  LegalCraft — Schema database Supabase (PostgreSQL)
--  Cara pakai: Supabase Dashboard → SQL Editor → New query →
--              paste seluruh isi file ini → Run.
--  Aman dijalankan berulang kali (idempotent).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. USERS — akun pelanggan (email+password dan/atau Google)
-- ---------------------------------------------------------------------
create table if not exists public.users (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (char_length(name) between 3 and 100),
  email          text not null,
  phone          text not null,
  password_hash  text,                 -- null jika daftar via Google
  google_sub     text,                 -- ID unik akun Google
  avatar         text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index if not exists users_email_key      on public.users (lower(email));
create unique index if not exists users_google_sub_key on public.users (google_sub) where google_sub is not null;

-- ---------------------------------------------------------------------
-- 2. SESSIONS — sesi login (cookie lc_session). Disimpan sebagai hash SHA-256.
-- ---------------------------------------------------------------------
create table if not exists public.sessions (
  token_hash  text primary key,
  user_id     uuid not null references public.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);
create index if not exists sessions_user_id_idx    on public.sessions (user_id);
create index if not exists sessions_expires_at_idx on public.sessions (expires_at);

-- ---------------------------------------------------------------------
-- 3. ORDERS — tagihan / pembayaran layanan (BSI & GoPay + kode unik)
-- ---------------------------------------------------------------------
create table if not exists public.orders (
  id               text primary key,                       -- contoh: LC261101A1B2C3
  user_id          uuid not null references public.users(id) on delete cascade,
  service          text not null check (service in ('npwp', 'nib', 'pt')),
  service_name     text not null,
  customer_name    text not null,
  phone            text not null,
  method           text not null check (method in ('bsi', 'gopay')),
  base_amount      integer not null check (base_amount > 0),
  unique_code      integer not null check (unique_code between 1 and 999),
  amount           integer not null check (amount > 0),
  status           text not null default 'pending'
                   check (status in ('pending', 'waiting', 'paid', 'rejected', 'expired', 'cancelled')),
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null,                   -- batas bayar (10 menit)
  confirmed_at     timestamptz,                            -- user klik "Saya Sudah Bayar"
  verify_deadline  timestamptz,                            -- batas verifikasi dana masuk (5 menit)
  paid_at          timestamptz,
  rejected_at      timestamptz,
  reject_reason    text,                                   -- not_received | expired
  mutation_id      bigint,                                 -- mutasi bank yang melunasi
  updated_at       timestamptz not null default now()
);
create index if not exists orders_user_id_idx on public.orders (user_id, created_at desc);
create index if not exists orders_status_idx  on public.orders (status);
-- Nominal (harga + kode unik) tidak boleh kembar di antara tagihan yang masih aktif,
-- supaya dana masuk bisa dicocokkan ke tepat satu tagihan.
create unique index if not exists orders_active_amount_key
  on public.orders (method, amount) where status in ('pending', 'waiting');

-- ---------------------------------------------------------------------
-- 4. BANK_MUTATIONS — log dana masuk dari webhook mutasi rekening
-- ---------------------------------------------------------------------
create table if not exists public.bank_mutations (
  id           bigint generated always as identity primary key,
  external_id  text,                                       -- ID mutasi dari penyedia (opsional)
  method       text,                                       -- bsi | gopay | null (tidak diketahui)
  amount       integer not null,
  description  text,
  raw          jsonb,
  order_id     text references public.orders(id) on delete set null,
  received_at  timestamptz not null default now()
);
create unique index if not exists bank_mutations_external_id_key
  on public.bank_mutations (external_id) where external_id is not null;
create index if not exists bank_mutations_amount_idx on public.bank_mutations (amount, received_at desc);

-- ---------------------------------------------------------------------
-- 5. Trigger updated_at
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists users_set_updated_at on public.users;
create trigger users_set_updated_at before update on public.users
  for each row execute function public.set_updated_at();

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at before update on public.orders
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 6. Fungsi: terapkan kedaluwarsa otomatis (dipanggil backend sebelum baca)
--    pending  + lewat expires_at      -> expired  (reject_reason = 'expired')
--    waiting  + lewat verify_deadline -> rejected (reject_reason = 'not_received')
-- ---------------------------------------------------------------------
create or replace function public.expire_orders() returns integer
language plpgsql security definer set search_path = public as $$
declare n1 integer; n2 integer;
begin
  update public.orders
     set status = 'expired', rejected_at = now(), reject_reason = 'expired'
   where status = 'pending' and expires_at <= now();
  get diagnostics n1 = row_count;

  update public.orders
     set status = 'rejected', rejected_at = now(), reject_reason = 'not_received'
   where status = 'waiting' and verify_deadline <= now();
  get diagnostics n2 = row_count;

  return n1 + n2;
end $$;

-- ---------------------------------------------------------------------
-- 7. Fungsi: catat dana masuk & cocokkan otomatis ke tagihan aktif
--    Dipanggil oleh endpoint webhook /api/webhooks/mutasi
-- ---------------------------------------------------------------------
create or replace function public.record_mutation(
  p_amount integer,
  p_method text default null,
  p_external_id text default null,
  p_description text default null,
  p_raw jsonb default null
) returns table (mutation_id bigint, order_id text, duplicate boolean)
language plpgsql security definer set search_path = public as $$
declare
  v_mut_id bigint;
  v_order  text;
begin
  -- Mutasi yang sama tidak diproses dua kali
  if p_external_id is not null then
    select m.id, m.order_id into v_mut_id, v_order
      from public.bank_mutations m where m.external_id = p_external_id;
    if found then
      return query select v_mut_id, v_order, true;
      return;
    end if;
  end if;

  perform public.expire_orders();

  insert into public.bank_mutations (external_id, method, amount, description, raw)
  values (p_external_id, p_method, p_amount, p_description, p_raw)
  returning id into v_mut_id;

  -- Cari tagihan aktif dengan nominal persis sama (tertua dulu)
  select o.id into v_order
    from public.orders o
   where o.status in ('pending', 'waiting')
     and o.amount = p_amount
     and (p_method is null or o.method = p_method)
   order by o.created_at
   limit 1
   for update skip locked;

  if v_order is not null then
    update public.orders
       set status = 'paid', paid_at = now(), mutation_id = v_mut_id
     where id = v_order;
    update public.bank_mutations set order_id = v_order where id = v_mut_id;
  end if;

  return query select v_mut_id, v_order, false;
end $$;

-- ---------------------------------------------------------------------
-- 8. Keamanan: Row Level Security
--    Semua akses dilakukan backend (Cloudflare Worker) memakai SERVICE ROLE KEY,
--    yang otomatis melewati RLS. Tanpa policy = anon/authenticated tidak bisa
--    membaca/menulis apa pun (data pelanggan aman walau anon key bocor).
-- ---------------------------------------------------------------------
alter table public.users          enable row level security;
alter table public.sessions       enable row level security;
alter table public.orders         enable row level security;
alter table public.bank_mutations enable row level security;

revoke all on public.users, public.sessions, public.orders, public.bank_mutations from anon, authenticated;
grant all on public.users, public.sessions, public.orders, public.bank_mutations to service_role;
grant usage, select on all sequences in schema public to service_role;

revoke execute on function public.expire_orders() from public, anon, authenticated;
revoke execute on function public.record_mutation(integer, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.expire_orders() to service_role;
grant execute on function public.record_mutation(integer, text, text, text, jsonb) to service_role;

-- Muat ulang cache schema PostgREST agar tabel baru langsung terbaca API
notify pgrst, 'reload schema';
