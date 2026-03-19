/* ═══════════════════════════════════════════════
   PAMPER – Shared client-side JavaScript
   api.js — loaded on every protected page
═══════════════════════════════════════════════ */

// ── API Helper ──────────────────────────────────
const api = {
  async request(method, url, body = null) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include'
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  },
  get:    (url)       => api.request('GET', url),
  post:   (url, body) => api.request('POST', url, body),
  patch:  (url, body) => api.request('PATCH', url, body),
  delete: (url)       => api.request('DELETE', url),
};

// ── Auth Guard ──────────────────────────────────
let currentUser = null;

async function initAuth(allowedRoles = null) {
  try {
    const res = await api.get('/api/auth/me');
    currentUser = res.user;

    if (allowedRoles && !allowedRoles.includes(currentUser.role)) {
      window.location.href = '/dashboard';
      return;
    }

    // Populate sidebar user chip
    const nameEl = document.getElementById('sb-user-name');
    const roleEl = document.getElementById('sb-user-role');
    const avEl   = document.getElementById('sb-user-av');
    if (nameEl) nameEl.textContent = currentUser.name;
    if (roleEl) roleEl.textContent = capitalise(currentUser.role);
    if (avEl)   avEl.textContent   = initials(currentUser.name);

    return currentUser;
  } catch {
    window.location.href = '/login';
  }
}

async function logout() {
  await api.post('/api/auth/logout');
  window.location.href = '/login';
}

// ── Toast ───────────────────────────────────────
function toast(message, sub = '', type = 'ok') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  const icons = {
    ok:   `<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
    err:  `<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
    warn: `<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`
  };

  const el = document.createElement('div');
  el.className = `toast t-${type}`;
  el.innerHTML = `${icons[type] || icons.ok}<div class="toast-body"><div>${message}</div>${sub ? `<p>${sub}</p>` : ''}</div>`;
  container.appendChild(el);

  requestAnimationFrame(() => { el.classList.add('show'); });
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 400);
  }, 3800);
}

// ── Modal helpers ───────────────────────────────
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// Click-outside to close
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-bg')) {
    e.target.classList.remove('open');
  }
});

// ── QR Code renderer (using qrcode.js CDN) ─────
function renderQR(containerId, value, size = 180) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = '';
  // Uses qrcode.js (loaded via CDN in pages that need it)
  if (typeof QRCode !== 'undefined') {
    new QRCode(el, { text: value, width: size, height: size, correctLevel: QRCode.CorrectLevel.M });
  } else {
    el.textContent = value;
  }
}

// ── Utilities ───────────────────────────────────
function initials(name = '') {
  return name.trim().split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function capitalise(str = '') {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function formatTime(isoString) {
  if (!isoString) return '—';
  return new Date(isoString).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(isoString) {
  if (!isoString) return '—';
  return new Date(isoString + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function today() {
  return new Date().toISOString().split('T')[0];
}

function setLoading(btn, loading) {
  if (!btn) return;
  if (loading) {
    btn._origText = btn.innerHTML;
    btn.innerHTML = `<svg class="spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" opacity=".25"/><path d="M21 12a9 9 0 00-9-9"/></svg> Loading…`;
    btn.disabled = true;
  } else {
    btn.innerHTML = btn._origText || 'Submit';
    btn.disabled = false;
  }
}

// Shared sidebar HTML (injected by each page)
function getSidebarHTML(activePage) {
  const links = [
    { href: '/dashboard',  icon: `<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>`, label: 'Dashboard',   page:'dashboard',  group:'Main' },
    { href: '/scanner',    icon: `<path d="M3 7V5a2 2 0 012-2h2M17 3h2a2 2 0 012 2v2M21 17v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2"/><rect x="7" y="7" width="10" height="10" rx="1"/>`, label: 'Scan Attendance', page:'scanner', group:'Main' },
    { href: '/students',   icon: `<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>`, label: 'Students', page:'students', group:'Main' },
    { href: '/attendance', icon: `<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>`, label: 'Records', page:'attendance', group:'Records' },
    { href: '/reports',    icon: `<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>`, label: 'Reports', page:'reports', group:'Records' },
    { href: '/geofence',   icon: `<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>`, label: 'Campus Geofence', page:'geofence', group:'Settings' },
  ];

  let nav = '';
  let lastGroup = '';
  links.forEach(l => {
    if (l.group !== lastGroup) {
      nav += `<div class="sb-label">${l.group}</div>`;
      lastGroup = l.group;
    }
    nav += `<a class="nav-a${l.page === activePage ? ' on' : ''}" href="${l.href}">
      <svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${l.icon}</svg>
      ${l.label}
    </a>`;
  });

  nav += `<div class="sb-label">System</div>
    <a class="nav-a" href="/profile">
      <svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
      My Profile
    </a>
    <a class="nav-a" href="#" onclick="logout();return false;">
      <svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
      Sign Out
    </a>`;

  return `
    <aside class="sidebar">
      <div class="sb-beta">PAMPER · BETA v0.4</div>
      <div class="sb-brand">
        <div class="sb-mark"><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span></div>
        <div><div class="sb-name">PAMPER</div><div class="sb-ver">Attendance System</div></div>
      </div>
      <nav class="sb-nav">${nav}</nav>
      <div class="sb-user">
        <div class="user-chip">
          <div class="u-av" id="sb-user-av">?</div>
          <div><div class="u-name" id="sb-user-name">Loading…</div><div class="u-role" id="sb-user-role"></div></div>
        </div>
      </div>
    </aside>`;
}

// Inject sidebar into page
function injectSidebar(activePage) {
  const el = document.getElementById('sidebar-root');
  if (el) el.innerHTML = getSidebarHTML(activePage);
}
