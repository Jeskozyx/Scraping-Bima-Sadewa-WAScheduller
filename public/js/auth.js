// ============================================================
// STATE & MANAJEMEN SESI PENGGUNA (STATELESS VIA LOCALSTORAGE)
// ============================================================

let currentUser = null;
let currentFilterNim = '';
let pendingAuthAction = null;

function getStoredSession() {
  try {
    const raw = localStorage.getItem('user_session');
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function setStoredSession(user) {
  if (user) {
    localStorage.setItem('user_session', JSON.stringify(user));
  } else {
    localStorage.removeItem('user_session');
  }
}

function removeStoredSession() {
  localStorage.removeItem('user_session');
}

// Wrapper fetch yang otomatis menyertakan identitas sesi perangkat ini
async function authFetch(url, options = {}) {
  const session = currentUser || getStoredSession();
  const headers = new Headers(options.headers || {});

  if (session && (session.nim || session.npm)) {
    const userNim = String(session.nim || session.npm).trim();
    headers.set('X-User-Nim', userNim);
    headers.set('Authorization', `Bearer ${userNim}`);
  }

  return fetch(url, { ...options, headers });
}

async function checkAuthStatus() {
  // 1. Baca sesi pengguna dari localStorage browser perangkat ini
  const stored = getStoredSession();
  if (stored && (stored.nim || stored.npm)) {
    currentUser = stored;
    currentFilterNim = stored.prefixNim || String(stored.nim || stored.npm || '').slice(0, 5);

    // 2. Verifikasi ke backend secara stateless (via ?nim=...)
    try {
      const nimParam = encodeURIComponent(stored.nim || stored.npm);
      const res = await authFetch(`/api/auth/user?nim=${nimParam}`);
      const json = await res.json();
      if (json.success && json.user) {
        currentUser = json.user;
        setStoredSession(currentUser);
        currentFilterNim = currentUser.prefixNim || currentFilterNim;
      }
    } catch (e) {
      console.warn('Verifikasi backend offline/gagal, tetap menggunakan sesi tersimpan:', e);
    }
  } else {
    currentUser = null;
    currentFilterNim = '';
    removeStoredSession();
  }

  renderUserProfile();
  if (typeof updateSadewaPrefixUI === 'function') {
    updateSadewaPrefixUI();
  }
}

function renderUserProfile() {
  const container = document.getElementById('userProfileArea');
  if (!container) return;

  if (currentUser && currentUser.npm) {
    const initials = (currentUser.nama || 'U').split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
    container.innerHTML = `
      <div class="flex items-center gap-2.5 border border-slate-700 bg-slate-900/90 px-3 py-1.5 rounded-xl text-xs shadow-sm">
        <div class="w-7 h-7 rounded-lg bg-orange-600 flex items-center justify-center font-bold text-white text-[11px] shrink-0">
          ${initials}
        </div>
        <div class="min-w-0 text-left">
          <div class="font-semibold text-slate-100 truncate max-w-[130px] sm:max-w-[170px] text-xs" title="${escapeHtml(currentUser.nama)}">${escapeHtml(currentUser.nama)}</div>
          <div class="text-[10px] text-slate-400 font-mono flex items-center gap-1.5 mt-0.5">
            <span class="text-orange-400 font-bold bg-orange-500/10 px-1 rounded border border-orange-500/20">${currentUser.prefixNim}</span>
            <span class="truncate max-w-[110px]">${currentUser.prodi}</span>
          </div>
        </div>
        <button type="button" onclick="handleLogout()" title="Keluar / Ganti Akun" class="text-slate-400 hover:text-red-400 p-1.5 rounded-lg hover:bg-slate-800 cursor-pointer transition-colors ml-1">
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
        </button>
      </div>
    `;
  } else {
    container.innerHTML = `
      <button type="button" onclick="openAuthModal()" class="px-3.5 py-2 rounded-xl text-xs font-semibold btn-primary text-white flex items-center gap-2 cursor-pointer shadow-sm active:scale-95 transition-all">
        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
        <span>Masuk Akun UPN</span>
      </button>
    `;
  }
}

function openAuthModal(customNotice = '', action = null) {
  pendingAuthAction = action;
  const modal = document.getElementById('upnAuthModal');
  const noticeText = document.getElementById('authNoticeText');
  if (noticeText) {
    if (customNotice) {
      noticeText.innerHTML = `⚠️ <strong class="text-orange-400">${escapeHtml(customNotice)}</strong> Masukkan NIM dan password SSO Anda di bawah.`;
    } else {
      noticeText.innerHTML = `Sistem menggunakan <strong>CloakBrowser Stealth</strong> untuk menyelesaikan otentikasi tanpa repot CAPTCHA dan menyimpan sesi Anda dengan aman.`;
    }
  }
  if (modal) modal.classList.remove('hidden');
  const userInput = document.getElementById('authUsername');
  if (userInput) {
    setTimeout(() => userInput.focus(), 100);
  }
}

function closeAuthModal() {
  const modal = document.getElementById('upnAuthModal');
  if (modal) modal.classList.add('hidden');
}

function toggleAuthPasswordVisibility() {
  const pwd = document.getElementById('authPassword');
  const btn = document.getElementById('authTogglePwdText');
  if (!pwd || !btn) return;
  if (pwd.type === 'password') {
    pwd.type = 'text';
    btn.textContent = 'Sembunyikan';
  } else {
    pwd.type = 'password';
    btn.textContent = 'Lihat';
  }
}

async function handleAuthLogin(e) {
  e.preventDefault();
  const username = document.getElementById('authUsername').value.trim();
  const password = document.getElementById('authPassword').value.trim();
  const submitBtn = document.getElementById('authSubmitBtn');
  const spinner = document.getElementById('authSpinner');
  const submitText = document.getElementById('authSubmitText');
  const noticeText = document.getElementById('authNoticeText');

  if (!username || !password) {
    showToast('NIM dan Password wajib diisi.');
    return;
  }

  submitBtn.disabled = true;
  spinner.classList.remove('hidden');
  submitText.textContent = 'Memverifikasi SSO...';
  noticeText.innerHTML = `⏳ <strong>Menghubungkan CloakBrowser Stealth...</strong> Membuka portal SADEWA & memverifikasi kredensial NIM ${username}...`;

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const json = await res.json();

    if (!json.success) {
      throw new Error(json.message || 'Login gagal. Periksa NIM & Password Anda.');
    }

    currentUser = json.user;
    setStoredSession(currentUser);
    currentFilterNim = currentUser.prefixNim;

    showToast(`🎉 Berhasil masuk! Halo, ${currentUser.nama}`);
    closeAuthModal();
    renderUserProfile();
    if (typeof updateSadewaPrefixUI === 'function') updateSadewaPrefixUI();
    if (typeof loadSadewaData === 'function') await loadSadewaData(true, currentFilterNim);
    if (typeof loadLecturers === 'function') await loadLecturers();

    const savedAction = pendingAuthAction;
    pendingAuthAction = null;
    if (savedAction === 'search_schedule') {
      showToast('Akun terhubung! Silakan pilih dosen dan cari jadwal.');
      document.getElementById('dosenName')?.focus();
    } else if (savedAction === 'scrape_sadewa') {
      if (typeof triggerSadewaScraping === 'function') triggerSadewaScraping();
    }
  } catch (err) {
    noticeText.innerHTML = `❌ <strong class="text-red-400">Gagal Masuk:</strong> ${escapeHtml(err.message)}`;
    showToast(`Gagal masuk: ${err.message}`);
  } finally {
    submitBtn.disabled = false;
    spinner.classList.add('hidden');
    submitText.textContent = 'Masuk & Sinkronisasi';
  }
}

async function handleLogout() {
  if (!confirm('Apakah Anda yakin ingin keluar dari akun ini?')) return;
  try {
    await authFetch('/api/auth/logout', { method: 'POST' });
  } catch { }
  removeStoredSession();
  currentUser = null;
  currentFilterNim = '';
  
  if (typeof rawSadewaList !== 'undefined') rawSadewaList = [];
  if (typeof filteredSadewaList !== 'undefined') filteredSadewaList = [];
  if (typeof resetDosenKatalog === 'function') resetDosenKatalog();
  
  renderUserProfile();
  if (typeof updateSadewaPrefixUI === 'function') updateSadewaPrefixUI();
  if (typeof updateSadewaStats === 'function') updateSadewaStats();
  if (typeof renderSadewaTable === 'function') renderSadewaTable();

  // Reset jadwal & hasil pencarian ke kondisi default
  document.getElementById('results')?.classList.add('hidden');
  document.getElementById('jadwalTableCard')?.classList.add('hidden');
  const jadwalTbody = document.getElementById('tableJadwalDosenBody');
  if (jadwalTbody) jadwalTbody.innerHTML = '';
  const dosenInput = document.getElementById('dosenName');
  if (dosenInput) dosenInput.value = '';
  const indicator = document.getElementById('selectedLecturerIndicator');
  if (indicator) indicator.classList.add('hidden');

  showToast('Berhasil keluar. Sesi pada perangkat ini telah dihapus.');
}

// Expose variables and functions to window
window.currentUser = currentUser;
Object.defineProperty(window, 'currentUser', {
  get: () => currentUser,
  set: (val) => { currentUser = val; }
});
Object.defineProperty(window, 'currentFilterNim', {
  get: () => currentFilterNim,
  set: (val) => { currentFilterNim = val; }
});

window.getStoredSession = getStoredSession;
window.setStoredSession = setStoredSession;
window.removeStoredSession = removeStoredSession;
window.authFetch = authFetch;
window.checkAuthStatus = checkAuthStatus;
window.renderUserProfile = renderUserProfile;
window.openAuthModal = openAuthModal;
window.closeAuthModal = closeAuthModal;
window.toggleAuthPasswordVisibility = toggleAuthPasswordVisibility;
window.handleAuthLogin = handleAuthLogin;
window.handleLogout = handleLogout;
