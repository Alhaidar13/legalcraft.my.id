/* =========================================================
   LegalCraft — Halaman Profil
   Tab 1 "Profil Saya": foto, nama, email, WA, edit profil, ubah kata sandi, tema, logout
   Tab 2 "Pesananku" : riwayat pesanan + filter status
   ========================================================= */
(function () {
  'use strict';

  const WA_NUMBER = '6287797890306';
  const SERVICE_ICON = { npwp: 'fa-id-card', nib: 'fa-barcode', pt: 'fa-building' };
  const METHOD = {
    bsi: { name: 'BSI Virtual Account', logo: '/static/img/bsi.png' },
    gopay: { name: 'GoPay', logo: '/static/img/gopay.png' }
  };
  const STATUS = {
    pending: { label: 'Menunggu Pembayaran', group: 'active' },
    waiting: { label: 'Menunggu Konfirmasi', group: 'active' },
    paid: { label: 'Berhasil', group: 'paid' },
    rejected: { label: 'Ditolak', group: 'failed' },
    expired: { label: 'Kedaluwarsa', group: 'failed' },
    cancelled: { label: 'Dibatalkan', group: 'failed' }
  };
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const PHONE_RE = /^(\+62|62|0)8[0-9]{7,12}$/;

  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rp = (n) => 'Rp' + Number(n || 0).toLocaleString('id-ID');
  const fmtDate = (v, withTime = true) => {
    if (!v) return '-';
    const o = { day: '2-digit', month: 'short', year: 'numeric' };
    if (withTime) Object.assign(o, { hour: '2-digit', minute: '2-digit' });
    return new Date(v).toLocaleString('id-ID', o).replace(/\./g, ':');
  };
  const prettyPhone = (p) => {
    const d = String(p || '').replace(/^\+?62/, '0');
    return d.replace(/^(\d{4})(\d{4})(\d+)$/, '$1-$2-$3');
  };

  const state = { user: null, orders: [], filter: 'all', loadingOrders: false };

  /* ---------- Toast ---------- */
  const toast = (msg, type = '') => {
    const t = $('#toast'); t.textContent = msg; t.className = 'toast show ' + type;
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.className = 'toast'; }, 2800);
  };

  /* ---------- API ---------- */
  const api = async (url, opts = {}) => {
    const res = await fetch(url, {
      credentials: 'same-origin',
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { location.href = '/login?next=' + encodeURIComponent('/profil' + location.hash); throw new Error('Sesi berakhir.'); }
    if (!res.ok) { const e = new Error(data.error || 'Terjadi kesalahan, coba lagi.'); e.field = data.field; throw e; }
    return data;
  };

  /* =========================================================
     TABS
     ========================================================= */
  const tabs = $$('.ptab');
  const tabBar = $('#profile-tabs');
  const setTab = (name, focus) => {
    tabs.forEach((t) => {
      const on = t.dataset.tab === name;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      $('#' + t.getAttribute('aria-controls')).hidden = !on;
      if (on && focus) t.focus();
    });
    tabBar.dataset.active = name;
    history.replaceState(null, '', name === 'pesanan' ? '#pesanan' : '#profil');
    if (name === 'pesanan' && !state.orders.length && !state.loadingOrders) loadOrders();
  };
  tabs.forEach((t) => t.addEventListener('click', () => setTab(t.dataset.tab)));
  tabBar.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const i = tabs.findIndex((t) => t.classList.contains('active'));
    const n = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    setTab(tabs[n].dataset.tab, true);
  });
  window.addEventListener('hashchange', () => setTab(location.hash === '#pesanan' ? 'pesanan' : 'profil'));

  /* =========================================================
     PROFIL
     ========================================================= */
  const initial = (u) => esc(((u && u.name) || '?').trim().charAt(0).toUpperCase());
  const avatarHTML = (u) => u && u.avatar
    ? `<img src="${esc(u.avatar)}" alt="Foto profil ${esc(u.name)}" referrerpolicy="no-referrer" data-initial="${initial(u)}" />`
    : initial(u);
  // Foto gagal dimuat → tampilkan inisial nama
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (img && img.tagName === 'IMG' && img.dataset.initial !== undefined) img.replaceWith(document.createTextNode(img.dataset.initial));
  }, true);

  const renderUser = () => {
    const u = state.user; if (!u) return;
    $('#ph-avatar').innerHTML = avatarHTML(u);
    $('#edit-avatar-preview').innerHTML = avatarHTML(u);
    $('#ph-name').textContent = u.name;
    $('#ph-email').textContent = u.email;
    const badges = [];
    badges.push(`<span class="ph-badge ok"><i class="fa-solid fa-circle-check"></i> Akun aktif</span>`);
    if (u.googleLinked) badges.push(`<span class="ph-badge"><i class="fa-brands fa-google"></i> Terhubung Google</span>`);
    badges.push(`<span class="ph-badge"><i class="fa-solid fa-calendar"></i> Sejak ${fmtDate(u.createdAt, false)}</span>`);
    $('#ph-badges').innerHTML = badges.join('');

    $('#v-name').textContent = u.name;
    $('#v-email').textContent = u.email;
    $('#v-phone').innerHTML = `<a href="https://wa.me/${esc(String(u.phone).replace(/^0/, '62').replace(/^\+/, ''))}" target="_blank" rel="noopener">${esc(prettyPhone(u.phone))}</a>`;
    const methods = [];
    if (u.hasPassword) methods.push('Email & kata sandi');
    if (u.googleLinked) methods.push('Google');
    $('#v-method').textContent = methods.join(' + ') || '-';
    $('#v-joined').textContent = fmtDate(u.createdAt, false);
    $('#btn-remove-avatar').hidden = !u.avatar;

    // Kartu kata sandi: akun Google tanpa password → "Buat Kata Sandi"
    const hasPw = !!u.hasPassword;
    $('#pw-title').textContent = hasPw ? 'Ubah Kata Sandi' : 'Buat Kata Sandi';
    $('#pw-desc').textContent = hasPw
      ? 'Gunakan minimal 8 karakter. Kombinasi huruf besar, angka & simbol lebih aman.'
      : 'Akunmu masuk lewat Google. Buat kata sandi agar bisa login juga dengan email.';
    $('#grp-current').hidden = !hasPw;
    $('#btn-toggle-pw span').textContent = $('#pw-form').hidden ? (hasPw ? 'Ubah' : 'Buat') : 'Tutup';
  };

  const loadProfile = async () => {
    try {
      const { user } = await api('/api/me/profile');
      state.user = user; renderUser();
    } catch (err) {
      $('#ph-name').textContent = 'Gagal memuat profil';
      $('#ph-email').textContent = err.message;
      toast(err.message, 'err');
    }
  };

  /* ---------- Error helpers ---------- */
  const setErr = (form, field, msg) => {
    const el = $(`[data-error-for="${field}"]`, form); if (!el) return false;
    el.textContent = msg; el.closest('.form-group').classList.add('has-error'); return true;
  };
  const clearErrs = (form) => {
    $$('.error-msg', form).forEach((el) => { el.textContent = ''; const g = el.closest('.form-group'); if (g) g.classList.remove('has-error'); });
  };
  const busy = (btn, on, label) => {
    if (on) { btn._html = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<span class="spin"></span> ${label}`; }
    else { btn.disabled = false; if (btn._html) btn.innerHTML = btn._html; }
  };

  /* ---------- Edit profil ---------- */
  const editForm = $('#edit-form');
  const openEdit = (open) => {
    editForm.hidden = !open;
    $('#info-view').hidden = open;
    $('#btn-edit').hidden = open;
    clearErrs(editForm); $('#edit-error').hidden = true;
    if (open && state.user) {
      editForm.elements.name.value = state.user.name || '';
      editForm.elements.email.value = state.user.email || '';
      editForm.elements.phone.value = state.user.phone || '';
      editForm.elements.email.disabled = !!state.user.googleLinked;
      $('#email-hint').hidden = !state.user.googleLinked;
      setTimeout(() => editForm.elements.name.focus(), 40);
    }
  };
  $('#btn-edit').addEventListener('click', () => openEdit(true));
  $('#btn-cancel-edit').addEventListener('click', () => openEdit(false));
  $$('input', editForm).forEach((i) => i.addEventListener('input', () => {
    const el = $(`[data-error-for="${i.name}"]`, editForm); if (el) { el.textContent = ''; el.closest('.form-group').classList.remove('has-error'); }
  }));

  editForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrs(editForm); $('#edit-error').hidden = true;
    const d = {
      name: editForm.elements.name.value.trim(),
      email: editForm.elements.email.value.trim(),
      phone: editForm.elements.phone.value.trim().replace(/[\s-]/g, '')
    };
    let ok = true;
    if (d.name.length < 3) { setErr(editForm, 'name', 'Nama lengkap minimal 3 karakter.'); ok = false; }
    if (!editForm.elements.email.disabled && !EMAIL_RE.test(d.email)) { setErr(editForm, 'email', 'Format email tidak valid. Contoh: nama@email.com'); ok = false; }
    if (!PHONE_RE.test(d.phone)) { setErr(editForm, 'phone', 'Nomor WhatsApp tidak valid. Contoh: 081234567890'); ok = false; }
    if (!ok) { const f = $('.has-error input', editForm); if (f) f.focus(); return; }
    if (editForm.elements.email.disabled) delete d.email;

    const btn = $('#btn-save'); busy(btn, true, 'Menyimpan…');
    try {
      const { user } = await api('/api/me/profile', { method: 'PUT', body: d });
      state.user = user; renderUser(); openEdit(false);
      toast('Profil berhasil diperbarui', 'ok');
    } catch (err) {
      if (!(err.field && setErr(editForm, err.field, err.message))) { $('#edit-error').textContent = err.message; $('#edit-error').hidden = false; }
    } finally { busy(btn, false); }
  });

  /* ---------- Foto profil (crop persegi + kompres di browser) ---------- */
  const fileToAvatar = (file) => new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return reject(new Error('Format foto harus PNG, JPG, atau WEBP.'));
    if (file.size > 10 * 1024 * 1024) return reject(new Error('Ukuran foto maksimal 10 MB.'));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const size = 256; const side = Math.min(img.naturalWidth, img.naturalHeight);
      const c = document.createElement('canvas'); c.width = size; c.height = size;
      const ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
      URL.revokeObjectURL(url);
      let q = 0.86; let out = c.toDataURL('image/jpeg', q);
      while (out.length > 250 * 1024 && q > 0.4) { q -= 0.1; out = c.toDataURL('image/jpeg', q); }
      resolve(out);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Foto tidak dapat dibaca.')); };
    img.src = url;
  });

  const saveAvatar = async (avatar) => {
    const wrap = $('.ph-avatar-wrap'); wrap.classList.add('uploading');
    try {
      const { user } = await api('/api/me/profile', { method: 'PUT', body: { avatar } });
      state.user = user; renderUser();
      toast(avatar ? 'Foto profil diperbarui' : 'Foto profil dihapus', 'ok');
    } catch (err) { toast(err.message, 'err'); }
    finally { wrap.classList.remove('uploading'); }
  };

  $('#avatar-input').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0]; e.target.value = '';
    if (!file) return;
    try { await saveAvatar(await fileToAvatar(file)); } catch (err) { toast(err.message, 'err'); }
  });
  $('#btn-remove-avatar').addEventListener('click', () => { if (confirm('Hapus foto profil?')) saveAvatar(null); });

  /* ---------- Ubah kata sandi ---------- */
  const pwForm = $('#pw-form');
  const togglePw = (open) => {
    pwForm.hidden = !open;
    $('#btn-toggle-pw').setAttribute('aria-expanded', String(open));
    $('#btn-toggle-pw span').textContent = open ? 'Tutup' : (state.user && !state.user.hasPassword ? 'Buat' : 'Ubah');
    if (!open) { pwForm.reset(); clearErrs(pwForm); $('#pw-error').hidden = true; scorePw(''); }
    else setTimeout(() => (state.user && state.user.hasPassword ? $('#pw-current') : $('#pw-new')).focus(), 40);
  };
  $('#btn-toggle-pw').addEventListener('click', () => togglePw(pwForm.hidden));
  $('#btn-cancel-pw').addEventListener('click', () => togglePw(false));

  $$('.pw-toggle').forEach((b) => b.addEventListener('click', () => {
    const inp = b.previousElementSibling; const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    b.innerHTML = `<i class="fa-solid ${show ? 'fa-eye-slash' : 'fa-eye'}"></i>`;
    b.setAttribute('aria-label', show ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi');
  }));

  const scorePw = (pw) => {
    let s = 0;
    if (pw.length >= 8) s++;
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
    if (/\d/.test(pw)) s++;
    if (/[^A-Za-z0-9]/.test(pw) || pw.length >= 12) s++;
    if (!pw) s = 0;
    $('#pw-meter').dataset.score = String(s);
    $('#pw-meter-label').textContent = pw ? ['Terlalu pendek', 'Lemah', 'Cukup', 'Kuat', 'Sangat kuat'][pw.length < 8 ? 0 : s] : '';
  };
  $('#pw-new').addEventListener('input', (e) => scorePw(e.target.value));
  $$('input', pwForm).forEach((i) => i.addEventListener('input', () => {
    const el = $(`[data-error-for="${i.name}"]`, pwForm); if (el) { el.textContent = ''; el.closest('.form-group').classList.remove('has-error'); }
  }));

  pwForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrs(pwForm); $('#pw-error').hidden = true;
    const hasPw = !!(state.user && state.user.hasPassword);
    const cur = $('#pw-current').value; const nw = $('#pw-new').value; const cf = $('#pw-confirm').value;
    let ok = true;
    if (hasPw && !cur) { setErr(pwForm, 'currentPassword', 'Masukkan kata sandi saat ini.'); ok = false; }
    if (nw.length < 8) { setErr(pwForm, 'newPassword', 'Kata sandi baru minimal 8 karakter.'); ok = false; }
    else if (hasPw && nw === cur) { setErr(pwForm, 'newPassword', 'Kata sandi baru tidak boleh sama dengan yang lama.'); ok = false; }
    if (cf !== nw) { setErr(pwForm, 'confirmPassword', 'Konfirmasi kata sandi tidak sama.'); ok = false; }
    if (!ok) { const f = $('.has-error input', pwForm); if (f) f.focus(); return; }

    const btn = $('#btn-save-pw'); busy(btn, true, 'Menyimpan…');
    try {
      const r = await api('/api/me/password', { method: 'POST', body: { currentPassword: cur, newPassword: nw } });
      if (state.user) state.user.hasPassword = true;
      togglePw(false); renderUser();
      toast(r.message || 'Kata sandi berhasil diubah', 'ok');
    } catch (err) {
      if (!(err.field && setErr(pwForm, err.field, err.message))) { $('#pw-error').textContent = err.message; $('#pw-error').hidden = false; }
    } finally { busy(btn, false); }
  });

  /* ---------- Switch tema (sinkron dengan tombol navbar) ---------- */
  /* ---------- Logout ---------- */
  const logoutModal = $('#logout-modal');
  const setLogout = (open) => {
    logoutModal.hidden = !open; document.body.classList.toggle('no-scroll', open);
    if (open) setTimeout(() => $('#btn-logout-confirm').focus(), 40);
  };
  $('#btn-logout').addEventListener('click', () => setLogout(true));
  $$('[data-close-logout]').forEach((b) => b.addEventListener('click', () => setLogout(false)));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !logoutModal.hidden) setLogout(false); });
  $('#btn-logout-confirm').addEventListener('click', async () => {
    const btn = $('#btn-logout-confirm'); busy(btn, true, 'Keluar…');
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    try { localStorage.removeItem('legalcraft_active_order'); } catch (_) {}
    location.href = '/login';
  });

  /* =========================================================
     PESANANKU
     ========================================================= */
  const counts = () => {
    const c = { all: state.orders.length, active: 0, paid: 0, failed: 0 };
    state.orders.forEach((o) => { const g = (STATUS[o.status] || {}).group; if (g) c[g]++; });
    return c;
  };

  const orderCard = (o, i) => {
    const st = STATUS[o.status] || { label: o.status };
    const m = METHOD[o.method] || { name: o.method, logo: '' };
    const actions = [];
    if (o.status === 'pending' || o.status === 'waiting') {
      actions.push(`<a class="btn btn-primary" href="/pembayaran?layanan=${esc(o.service)}&order=${encodeURIComponent(o.id)}"><i class="fa-solid ${o.status === 'pending' ? 'fa-credit-card' : 'fa-magnifying-glass-dollar'}"></i> ${o.status === 'pending' ? 'Lanjutkan Bayar' : 'Lihat Status'}</a>`);
    }
    if (o.status === 'paid') {
      const msg = `Halo Admin LegalCraft, saya ingin menanyakan progres pesanan saya.\n\nID Transaksi: ${o.id}\nLayanan: ${o.serviceName}\nTotal: ${rp(o.amount)}\n\nTerima kasih.`;
      actions.push(`<a class="btn btn-outline" href="/pembayaran?layanan=${esc(o.service)}&order=${encodeURIComponent(o.id)}"><i class="fa-solid fa-receipt"></i> Lihat Struk</a>`);
      actions.push(`<a class="btn btn-wa" target="_blank" rel="noopener" href="https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(msg)}"><i class="fa-brands fa-whatsapp"></i> Tanya Progres</a>`);
    }
    if (['rejected', 'expired', 'cancelled'].includes(o.status)) {
      actions.push(`<a class="btn btn-outline" href="/pembayaran?layanan=${esc(o.service)}"><i class="fa-solid fa-rotate-right"></i> Pesan Lagi</a>`);
      if (o.status === 'rejected') {
        const msg = `Halo Admin LegalCraft, pembayaran saya ditolak otomatis padahal saya sudah transfer.\n\nID Transaksi: ${o.id}\nNominal: ${rp(o.amount)}\n\nSaya lampirkan bukti transfer. Terima kasih.`;
        actions.push(`<a class="btn btn-wa" target="_blank" rel="noopener" href="https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(msg)}"><i class="fa-brands fa-whatsapp"></i> Hubungi Admin</a>`);
      }
    }
    const when = o.status === 'paid' && o.paidAt ? `Dibayar ${fmtDate(o.paidAt)}` : `Dibuat ${fmtDate(o.createdAt)}`;
    return `
      <article class="order-card" style="animation-delay:${Math.min(i, 8) * 40}ms" data-status="${esc(o.status)}">
        <div class="order-top">
          <span><i class="fa-solid fa-hashtag"></i> <code>${esc(o.id)}</code></span>
          <span class="status st-${esc(o.status)}">${esc(st.label)}</span>
        </div>
        <div class="order-body">
          <span class="order-icon"><i class="fa-solid ${SERVICE_ICON[o.service] || 'fa-file-contract'}"></i></span>
          <div class="order-info">
            <strong>${esc(o.serviceName)}</strong>
            <small>${m.logo ? `<img src="${m.logo}" alt="" />` : ''}${esc(m.name)} &bull; ${esc(when)}</small>
          </div>
          <div class="order-amount"><small>Total</small><strong>${rp(o.amount)}</strong></div>
        </div>
        ${actions.length ? `<div class="order-actions">${actions.join('')}</div>` : ''}
      </article>`;
  };

  const renderOrders = () => {
    const c = counts();
    $$('[data-count]').forEach((el) => { el.textContent = c[el.dataset.count]; });
    $('#stat-total').textContent = c.all; $('#stat-paid').textContent = c.paid; $('#stat-active').textContent = c.active;
    const tc = $('#tab-count'); tc.textContent = c.all; tc.hidden = !c.all;

    const list = state.filter === 'all' ? state.orders : state.orders.filter((o) => (STATUS[o.status] || {}).group === state.filter);
    $('#orders-list').innerHTML = list.map(orderCard).join('');
    const empty = !list.length;
    $('#orders-empty').hidden = !empty;
    if (empty) {
      const all = !state.orders.length;
      $('#empty-title').textContent = all ? 'Belum ada pesanan' : 'Tidak ada pesanan di kategori ini';
      $('#empty-text').textContent = all
        ? 'Pesanan layanan legalitas yang kamu buat akan muncul di sini.'
        : 'Coba pilih filter lain untuk melihat pesananmu.';
    }
  };

  const loadOrders = async () => {
    state.loadingOrders = true;
    const btn = $('#btn-refresh-orders'); btn.disabled = true;
    try {
      const { orders } = await api('/api/me/orders');
      state.orders = orders || []; renderOrders();
    } catch (err) {
      $('#orders-list').innerHTML = `<p class="form-error"><i class="fa-solid fa-circle-exclamation"></i> ${esc(err.message)}</p>`;
    } finally { state.loadingOrders = false; btn.disabled = false; }
  };

  $$('#order-filters .chip').forEach((b) => b.addEventListener('click', () => {
    state.filter = b.dataset.filter;
    $$('#order-filters .chip').forEach((x) => x.classList.toggle('active', x === b));
    renderOrders();
  }));
  $('#btn-refresh-orders').addEventListener('click', async () => { await loadOrders(); toast('Riwayat pesanan diperbarui'); });

  /* ---------- Init ---------- */
  loadProfile();
  loadOrders(); // untuk statistik & badge jumlah pesanan
  setTab(location.hash === '#pesanan' ? 'pesanan' : 'profil');
})();
