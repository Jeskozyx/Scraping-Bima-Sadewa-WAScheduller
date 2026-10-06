// ============================================================
// STATE & LOGIKA SADEWA SKRIPSI
// ============================================================

let rawSadewaList = [];
let filteredSadewaList = [];
let sadewaPage = 1;
let sadewaPageSize = 10;
let sadewaSearchQuery = '';
let sadewaDospemFilterValue = '';
let sadewaStatusFilterValue = '';
let isSadewaScraping = false;
let selectedModalItem = null;

// Load data dari backend (/api/skripsi-data?filterNim=...)
async function loadSadewaData(forceRefresh = false, customPrefix = null) {
  const prefix = customPrefix || window.currentFilterNim;
  if (!prefix) {
    rawSadewaList = [];
    filteredSadewaList = [];
    updateSadewaStats();
    renderSadewaTable();
    const badgeCount = document.getElementById('sadewaBadgeCount');
    if (badgeCount) badgeCount.textContent = '0';
    const subtext = document.getElementById('sadewaSubtext');
    if (subtext) subtext.textContent = 'Silakan masuk akun SSO UPN untuk memuat data skripsi prodi & angkatan Anda.';
    const timeBadge = document.getElementById('sadewaTimeBadge');
    if (timeBadge) timeBadge.textContent = '0 Data';
    return;
  }

  try {
    const user = window.currentUser;
    const nimParam = encodeURIComponent(user?.nim || user?.npm || '');
    const res = await authFetch(`/api/skripsi-data?filterNim=${encodeURIComponent(prefix)}&nim=${nimParam}`);
    const json = await res.json();

    if (json.success && Array.isArray(json.data)) {
      rawSadewaList = json.data;
      window.currentFilterNim = json.filterNim || prefix;
      updateSadewaPrefixUI();

      // Update badge di tab
      const badgeCount = document.getElementById('sadewaBadgeCount');
      if (badgeCount) badgeCount.textContent = rawSadewaList.length;

      // Update info terakhir diperbarui
      const subtext = document.getElementById('sadewaSubtext');
      const timeBadge = document.getElementById('sadewaTimeBadge');
      if (json.lastUpdated && rawSadewaList.length > 0) {
        const dateStr = new Date(json.lastUpdated).toLocaleString('id-ID', {
          dateStyle: 'medium',
          timeStyle: 'short'
        });
        if (subtext) subtext.textContent = `Terakhir diperbarui: ${dateStr}`;
        if (timeBadge) timeBadge.textContent = `${rawSadewaList.length} Baris`;
      } else {
        if (subtext) subtext.textContent = rawSadewaList.length > 0 ? 'Data siap ditampilkan.' : 'Belum ada data skripsi yang discrape.';
        if (timeBadge) timeBadge.textContent = `${rawSadewaList.length} Data`;
      }

      const sbBadge = document.getElementById('supabaseBadge');
      if (sbBadge) {
        if (json.source === 'supabase') {
          sbBadge.textContent = 'Supabase Cloud ✓';
          sbBadge.className = 'text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30';
        } else {
          sbBadge.textContent = 'Lokal JSON';
          sbBadge.className = 'text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700';
        }
      }

      // Hitung statistik
      updateSadewaStats();

      // Isi opsi dropdown filter (Dosen & Status)
      populateSadewaFilterDropdowns();

      // Terapkan filter & render
      applySadewaFilters();

      if (forceRefresh) {
        showToast(`Data diperbarui! (${rawSadewaList.length} judul skripsi)`);
      }
    }
  } catch (err) {
    console.error('Gagal memuat data SADEWA:', err);
    showToast('Gagal memuat data skripsi SADEWA.');
  }
}

// Hitung dan tampilkan 4 statistik
function updateSadewaStats() {
  const totalSkripsi = rawSadewaList.length;
  document.getElementById('statTotalSkripsi').textContent = totalSkripsi;

  if (totalSkripsi === 0) {
    document.getElementById('statTotalMhs').textContent = '0';
    document.getElementById('statTotalDospem').textContent = '0';
    document.getElementById('statRevisiJudul').textContent = '0';
    const topDospemEl = document.getElementById('statTopDospem');
    if (topDospemEl) {
      topDospemEl.textContent = '-';
      topDospemEl.title = '';
    }
    return;
  }

  // Mahasiswa unik (berdasarkan NIM)
  const uniqueNims = new Set(rawSadewaList.map(item => item.nim).filter(Boolean));
  document.getElementById('statTotalMhs').textContent = uniqueNims.size;

  // Dosen Pembimbing unik & top dospem
  const dospemCounts = {};
  let revisiCount = 0;

  rawSadewaList.forEach(item => {
    if (item.dosenPembimbing) {
      dospemCounts[item.dosenPembimbing] = (dospemCounts[item.dosenPembimbing] || 0) + 1;
    }
    if (item.judulTerbaru && item.judulTerbaru.trim() !== '' && item.judulTerbaru.trim() !== item.judulAwal?.trim()) {
      revisiCount++;
    }
  });

  const uniqueDospems = Object.keys(dospemCounts);
  document.getElementById('statTotalDospem').textContent = uniqueDospems.length;

  // Temukan dospem dengan mahasiswa terbanyak
  let topDospemName = '';
  let maxCount = 0;
  for (const [name, count] of Object.entries(dospemCounts)) {
    if (count > maxCount) {
      maxCount = count;
      topDospemName = name;
    }
  }
  const topDospemEl = document.getElementById('statTopDospem');
  if (topDospemEl) {
    if (topDospemName) {
      topDospemEl.textContent = `Terbanyak: ${topDospemName} (${maxCount})`;
      topDospemEl.title = topDospemName;
    } else {
      topDospemEl.textContent = '-';
    }
  }

  document.getElementById('statRevisiJudul').textContent = revisiCount;
}

// Populasi dropdown filter
function populateSadewaFilterDropdowns() {
  const dospemSelect = document.getElementById('sadewaDospemFilter');
  const statusSelect = document.getElementById('sadewaStatusFilter');

  // Ambil list unik
  const uniqueDospems = [...new Set(rawSadewaList.map(item => item.dosenPembimbing).filter(Boolean))].sort();
  const uniqueStatuses = [...new Set(rawSadewaList.map(item => item.status).filter(Boolean))].sort();

  const currentDospem = dospemSelect.value;
  dospemSelect.innerHTML = '<option value="">Semua Dosen</option>' +
    uniqueDospems.map(d => `<option value="${escapeHtml(d)}" ${d === currentDospem ? 'selected' : ''}>${escapeHtml(d)}</option>`).join('');

  const currentStatus = statusSelect.value;
  statusSelect.innerHTML = '<option value="">Semua Status</option>' +
    uniqueStatuses.map(s => `<option value="${escapeHtml(s)}" ${s === currentStatus ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('');
}

// Trigger proses scraping dari UI
async function triggerSadewaScraping() {
  if (isSadewaScraping) return;

  // Wajib login akun BIMA & SADEWA
  if (!window.currentUser) {
    openAuthModal('Wajib masuk dengan akun BIMA/SADEWA UPNYK untuk scraping skripsi SADEWA.', 'scrape_sadewa');
    return;
  }

  const btn = document.getElementById('startScrapeBtn');
  const rocketIcon = document.getElementById('scrapeRocketIcon');
  const spinnerIcon = document.getElementById('scrapeSpinnerIcon');
  const btnText = document.getElementById('scrapeBtnText');
  const noticeBanner = document.getElementById('scrapeNoticeBanner');
  const statusDot = document.getElementById('sadewaStatusDot');
  const statusText = document.getElementById('sadewaStatusText');

  isSadewaScraping = true;
  btn.disabled = true;
  rocketIcon.classList.add('hidden');
  spinnerIcon.classList.remove('hidden');
  btnText.textContent = `Scraping Prefix ${window.currentFilterNim}...`;
  noticeBanner.classList.remove('hidden');
  statusDot.className = 'w-3 h-3 rounded-full bg-amber-400 animate-ping';
  statusText.textContent = `Sedang Scraping SADEWA (${window.currentFilterNim})...`;

  showToast(`Memulai scraper SADEWA untuk NIM prefix ${window.currentFilterNim}! Jendela browser dibuka...`);

  // Polling status secara berkala
  const pollInterval = setInterval(async () => {
    try {
      const res = await fetch('/api/scrape-sadewa/status');
      const json = await res.json();
      if (!json.isScraping) {
        clearInterval(pollInterval);
      }
    } catch { }
  }, 3000);

  try {
    const user = window.currentUser;
    const response = await authFetch('/api/scrape-sadewa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filterNim: window.currentFilterNim,
        nim: user?.nim || user?.npm
      })
    });

    const result = await response.json();
    clearInterval(pollInterval);

    if (!result.success) {
      throw new Error(result.message || 'Scraping gagal.');
    }

    showToast(`Sukses! ${result.total || result.data?.length || 0} judul skripsi berhasil diambil untuk ${window.currentFilterNim}!`);
    await loadSadewaData(true, window.currentFilterNim);
  } catch (err) {
    clearInterval(pollInterval);
    console.error('Error saat scraping:', err);
    showToast(`Error: ${err.message}`);
  } finally {
    isSadewaScraping = false;
    btn.disabled = false;
    rocketIcon.classList.remove('hidden');
    spinnerIcon.classList.add('hidden');
    btnText.innerHTML = `Mulai Scraping (<span id="scrapeBtnPrefixText">${escapeHtml(window.currentFilterNim)}</span>)`;
    noticeBanner.classList.add('hidden');
    statusDot.className = 'w-3 h-3 rounded-full bg-emerald-500 animate-pulse';
    statusText.textContent = 'Data Siap Ditampilkan';
  }
}

// Filter logic
function applySadewaFilters() {
  const q = sadewaSearchQuery.toLowerCase().trim();
  const dospem = sadewaDospemFilterValue.toLowerCase();
  const status = sadewaStatusFilterValue.toLowerCase();

  filteredSadewaList = rawSadewaList.filter(item => {
    const matchQuery = !q ||
      (item.nim && item.nim.toLowerCase().includes(q)) ||
      (item.nama && item.nama.toLowerCase().includes(q)) ||
      (item.judulAwal && item.judulAwal.toLowerCase().includes(q)) ||
      (item.judulTerbaru && item.judulTerbaru.toLowerCase().includes(q)) ||
      (item.dosenPembimbing && item.dosenPembimbing.toLowerCase().includes(q));

    const matchDospem = !dospem || (item.dosenPembimbing && item.dosenPembimbing.toLowerCase() === dospem);
    const matchStatus = !status || (item.status && item.status.toLowerCase() === status);

    return matchQuery && matchDospem && matchStatus;
  });

  sadewaPage = 1;
  renderSadewaTable();
}

function handleSadewaSearch(val) {
  sadewaSearchQuery = val;
  applySadewaFilters();
}

function handleSadewaDospemFilter(val) {
  sadewaDospemFilterValue = val;
  applySadewaFilters();
}

function handleSadewaStatusFilter(val) {
  sadewaStatusFilterValue = val;
  applySadewaFilters();
}

function handleSadewaPageSizeChange(val) {
  sadewaPageSize = val === 'all' ? 999999 : parseInt(val, 10);
  sadewaPage = 1;
  renderSadewaTable();
}

// Render tabel dan pagination
function renderSadewaTable() {
  const tbody = document.getElementById('sadewaTableBody');
  const emptyState = document.getElementById('sadewaEmptyState');
  const totalFiltered = filteredSadewaList.length;

  document.getElementById('sadewaTotalFiltered').textContent = totalFiltered;

  if (totalFiltered === 0) {
    tbody.innerHTML = '';
    emptyState.classList.remove('hidden');
    document.getElementById('sadewaShowingStart').textContent = '0';
    document.getElementById('sadewaShowingEnd').textContent = '0';
    document.getElementById('sadewaPaginationButtons').innerHTML = '';

    const emptyIcon = document.getElementById('sadewaEmptyIcon');
    const emptyTitle = document.getElementById('sadewaEmptyTitle');
    const emptyDesc = document.getElementById('sadewaEmptyDesc');
    const emptyActionBtn = document.getElementById('sadewaEmptyActionBtn');

    if (!window.currentUser) {
      if (emptyIcon) emptyIcon.textContent = '🔒';
      if (emptyTitle) emptyTitle.textContent = 'Silakan Masuk Akun UPN';
      if (emptyDesc) emptyDesc.textContent = 'Masuk dengan akun SSO UPN (BIMA & SADEWA) untuk memuat data skripsi prodi & angkatan Anda secara otomatis.';
      if (emptyActionBtn) {
        emptyActionBtn.classList.remove('hidden');
        emptyActionBtn.innerHTML = `
          <button type="button" onclick="openAuthModal()" class="px-4 py-2 rounded-xl text-xs font-semibold btn-primary text-white inline-flex items-center gap-1.5 shadow-md active:scale-95 transition-all cursor-pointer">
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1"/></svg>
            <span>Masuk Akun SSO UPN</span>
          </button>
        `;
      }
    } else if (rawSadewaList.length === 0) {
      const meta = parseNimInfo(window.currentFilterNim);
      if (emptyIcon) emptyIcon.textContent = '📋';
      if (emptyTitle) emptyTitle.textContent = `Belum Ada Data Skripsi (${meta.prodi || 'Prodi'} ${meta.angkatan || ''})`;
      if (emptyDesc) emptyDesc.textContent = `Data skripsi untuk NIM prefix ${window.currentFilterNim} belum discrape. Klik tombol di bawah untuk mengambil data dari portal SADEWA.`;
      if (emptyActionBtn) {
        emptyActionBtn.classList.remove('hidden');
        emptyActionBtn.innerHTML = `
          <button type="button" onclick="triggerSadewaScraping()" class="px-4 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white inline-flex items-center gap-1.5 shadow-md active:scale-95 transition-all cursor-pointer">
            <span>Mulai Scraping SADEWA (${escapeHtml(window.currentFilterNim)})</span>
          </button>
        `;
      }
    } else {
      if (emptyIcon) emptyIcon.textContent = '🔍';
      if (emptyTitle) emptyTitle.textContent = 'Tidak Ada Data Ditemukan';
      if (emptyDesc) emptyDesc.textContent = 'Coba ubah kata kunci pencarian atau sesuaikan filter dosen dan status.';
      if (emptyActionBtn) emptyActionBtn.classList.add('hidden');
    }
    return;
  }

  emptyState.classList.add('hidden');

  const startIdx = (sadewaPage - 1) * sadewaPageSize;
  const endIdx = Math.min(startIdx + sadewaPageSize, totalFiltered);
  const pageItems = filteredSadewaList.slice(startIdx, endIdx);

  document.getElementById('sadewaShowingStart').textContent = startIdx + 1;
  document.getElementById('sadewaShowingEnd').textContent = endIdx;

  const avatarGradients = [
    'from-blue-500 to-indigo-600',
    'from-emerald-500 to-teal-600',
    'from-purple-500 to-pink-600',
    'from-amber-500 to-orange-600',
    'from-cyan-500 to-blue-600',
    'from-rose-500 to-red-600'
  ];

  tbody.innerHTML = pageItems.map((item, idx) => {
    const globalIndex = startIdx + idx + 1;
    const initial = (item.nama || 'M').split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
    const grad = avatarGradients[(globalIndex) % avatarGradients.length];

    const hasDifferentNewTitle = item.judulTerbaru &&
      item.judulTerbaru.trim() !== '' &&
      item.judulTerbaru.trim() !== item.judulAwal?.trim();

    const activeTitle = (item.judulTerbaru && item.judulTerbaru.trim()) ? item.judulTerbaru : item.judulAwal;

    const safeNama = escapeHtml(item.nama || '-');
    const safeNim = escapeHtml(item.nim || '-');
    const safeDospem = escapeHtml(item.dosenPembimbing || '-');
    const safeStatus = escapeHtml(item.status || 'Bimbingan TA');

    return `
      <tr class="hover:bg-slate-800/40 transition-colors group">
        <td class="py-3.5 px-4 text-center font-mono text-slate-400 font-medium">${globalIndex}</td>
        <td class="py-3.5 px-4">
          <div class="flex items-center gap-2.5">
            <div class="w-8 h-8 rounded-lg bg-gradient-to-br ${grad} flex items-center justify-center text-slate-100 font-bold text-xs shrink-0 shadow-sm">
              ${initial}
            </div>
            <div class="min-w-0">
              <div class="font-semibold text-slate-100 truncate max-w-[170px]" title="${safeNama}">
                ${safeNama}
              </div>
              <div class="flex items-center gap-1.5 mt-0.5">
                <span class="font-mono text-[11px] text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded border border-blue-500/20">${safeNim}</span>
                <button type="button" onclick="copyNim('${safeNim}')" title="Salin NIM"
                  class="text-slate-500 hover:text-slate-300 transition-colors p-0.5 rounded hover:bg-slate-700/50 cursor-pointer">
                  <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </td>
        <td class="py-3.5 px-4">
          <div class="space-y-1">
            ${hasDifferentNewTitle ? `
              <div class="text-[10px] uppercase font-bold tracking-wider text-amber-400 inline-flex items-center gap-1 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                <span>Judul Revisi</span>
              </div>
              <div class="font-medium text-slate-100 text-xs line-clamp-2 leading-relaxed" title="${escapeHtml(item.judulTerbaru)}">
                ${escapeHtml(item.judulTerbaru)}
              </div>
              <div class="text-[11px] text-slate-400/80 line-clamp-1 italic" title="Judul Awal: ${escapeHtml(item.judulAwal)}">
                <span class="not-italic text-[10px] text-slate-500">Awal:</span> ${escapeHtml(item.judulAwal)}
              </div>
            ` : `
              <div class="font-medium text-slate-200 text-xs line-clamp-2 leading-relaxed" title="${escapeHtml(activeTitle || '-')}">
                ${escapeHtml(activeTitle || '-')}
              </div>
            `}
          </div>
        </td>
        <td class="py-3.5 px-4">
          <div class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-900/80 border border-slate-700/80 text-slate-300 text-[11px]">
            <span class="text-xs"></span>
            <span class="font-medium truncate max-w-[150px]" title="${safeDospem}">${safeDospem}</span>
          </div>
        </td>
        <td class="py-3.5 px-4 text-center">
          <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
            <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
            <span>${safeStatus}</span>
          </span>
        </td>
        <td class="py-3.5 px-3 text-center">
          <button type="button" onclick="openSkripsiModal(${globalIndex - 1})"
            class="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 bg-slate-800/80 hover:bg-slate-700 border border-slate-700 transition-all cursor-pointer"
            title="Lihat Detail Lengkap">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          </button>
        </td>
      </tr>
    `;
  }).join('');

  renderSadewaPagination(totalFiltered);
}

// Tombol Pagination
function renderSadewaPagination(totalItems) {
  const container = document.getElementById('sadewaPaginationButtons');
  const totalPages = Math.ceil(totalItems / sadewaPageSize);

  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  let html = '';

  // Prev Button
  html += `
    <button type="button" onclick="changeSadewaPage(${sadewaPage - 1})" ${sadewaPage === 1 ? 'disabled' : ''}
      class="px-2.5 py-1 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed transition-all text-xs cursor-pointer">
      &larr; Prev
    </button>
  `;

  // Page numbers
  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || (p >= sadewaPage - 1 && p <= sadewaPage + 1)) {
      const isActive = p === sadewaPage;
      html += `
        <button type="button" onclick="changeSadewaPage(${p})"
          class="w-7 h-7 rounded-lg text-xs font-semibold transition-all cursor-pointer ${isActive
          ? 'bg-slate-100 text-[#fff]'
          : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700'
        }">
          ${p}
        </button>
      `;
    } else if (p === sadewaPage - 2 || p === sadewaPage + 2) {
      html += `<span class="px-1 text-slate-500">...</span>`;
    }
  }

  // Next Button
  html += `
    <button type="button" onclick="changeSadewaPage(${sadewaPage + 1})" ${sadewaPage === totalPages ? 'disabled' : ''}
      class="px-2.5 py-1 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed transition-all text-xs cursor-pointer">
      Next &rarr;
    </button>
  `;

  container.innerHTML = html;
}

function changeSadewaPage(newPage) {
  const totalPages = Math.ceil(filteredSadewaList.length / sadewaPageSize);
  if (newPage < 1 || newPage > totalPages) return;
  sadewaPage = newPage;
  renderSadewaTable();
}

// Modal Detail Handler
function openSkripsiModal(index) {
  const item = filteredSadewaList[index] || rawSadewaList[index];
  if (!item) return;

  selectedModalItem = item;

  document.getElementById('modalNama').textContent = item.nama || '-';
  document.getElementById('modalNim').textContent = item.nim || '-';
  document.getElementById('modalStatus').textContent = item.status || 'Bimbingan TA';
  document.getElementById('modalDospem').textContent = item.dosenPembimbing || '-';

  const initial = (item.nama || 'M').split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
  document.getElementById('modalAvatar').textContent = initial;

  document.getElementById('modalJudulAwal').textContent = item.judulAwal || '-';

  const terbaruContainer = document.getElementById('modalJudulTerbaruContainer');
  const terbaruEl = document.getElementById('modalJudulTerbaru');

  if (item.judulTerbaru && item.judulTerbaru.trim() !== '' && item.judulTerbaru.trim() !== item.judulAwal?.trim()) {
    terbaruContainer.classList.remove('hidden');
    terbaruEl.textContent = item.judulTerbaru;
  } else {
    terbaruContainer.classList.add('hidden');
  }

  document.getElementById('skripsiDetailModal').classList.remove('hidden');
}

function closeSkripsiModal() {
  document.getElementById('skripsiDetailModal').classList.add('hidden');
  selectedModalItem = null;
}

function copyModalJudul() {
  if (!selectedModalItem) return;
  const textToCopy = (selectedModalItem.judulTerbaru && selectedModalItem.judulTerbaru.trim())
    ? selectedModalItem.judulTerbaru
    : selectedModalItem.judulAwal;

  navigator.clipboard.writeText(textToCopy).then(() => {
    showToast('Judul skripsi berhasil disalin!');
  });
}

function copyNim(nim) {
  navigator.clipboard.writeText(nim).then(() => {
    showToast(`NIM ${nim} berhasil disalin!`);
  });
}

// Unduh JSON
function downloadSadewaJson() {
  if (rawSadewaList.length === 0) {
    showToast('Tidak ada data skripsi untuk diunduh.');
    return;
  }
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(rawSadewaList, null, 2));
  const downloadAnchor = document.createElement('a');
  downloadAnchor.setAttribute("href", dataStr);
  const fileName = `skripsi_${window.currentFilterNim || 'data'}.json`;
  downloadAnchor.setAttribute("download", fileName);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
  showToast(`File ${fileName} berhasil diekspor!`);
}

function updateSadewaPrefixUI() {
  const prefixInput = document.getElementById('customPrefixNimInput');
  if (prefixInput) {
    prefixInput.value = window.currentFilterNim || '';
  }

  const meta = parseNimInfo(window.currentFilterNim);
  const prefixBadge = document.getElementById('sadewaPrefixBadge');
  const prodiBadge = document.getElementById('sadewaProdiBadge');
  const prodiAngkatan = document.getElementById('sadewaProdiAngkatan');
  const statProdiSubtitle = document.getElementById('statProdiSubtitle');
  const statNimSubtitle = document.getElementById('statNimSubtitle');
  const scrapeBtnText = document.getElementById('scrapeBtnText');
  const subtext = document.getElementById('sadewaSubtext');
  const timeBadge = document.getElementById('sadewaTimeBadge');
  const badgeCount = document.getElementById('sadewaBadgeCount');

  if (window.currentFilterNim && meta.prodi) {
    const prodiTitle = `${meta.prodi} ${meta.angkatan}`.trim();
    if (prefixBadge) prefixBadge.textContent = window.currentFilterNim;
    if (prodiBadge) prodiBadge.textContent = prodiTitle;
    if (prodiAngkatan) prodiAngkatan.textContent = prodiTitle;
    if (statProdiSubtitle) statProdiSubtitle.textContent = prodiTitle;
    if (statNimSubtitle) statNimSubtitle.textContent = `NIM Prefix ${window.currentFilterNim}`;
    if (scrapeBtnText) scrapeBtnText.innerHTML = `Mulai Scraping (<span id="scrapeBtnPrefixText">${escapeHtml(window.currentFilterNim)}</span>)`;
  } else {
    if (prefixBadge) prefixBadge.textContent = '-';
    if (prodiBadge) prodiBadge.textContent = 'Belum Masuk Akun';
    if (prodiAngkatan) prodiAngkatan.textContent = 'SADEWA';
    if (statProdiSubtitle) statProdiSubtitle.textContent = '-';
    if (statNimSubtitle) statNimSubtitle.textContent = '-';
    if (scrapeBtnText) scrapeBtnText.innerHTML = 'Mulai Scraping SADEWA';
    if (subtext && (!rawSadewaList || rawSadewaList.length === 0)) {
      subtext.textContent = 'Silakan masuk akun SSO UPN untuk memuat data skripsi prodi & angkatan Anda.';
    }
    if (timeBadge && (!rawSadewaList || rawSadewaList.length === 0)) {
      timeBadge.textContent = '0 Data';
    }
    if (badgeCount && (!rawSadewaList || rawSadewaList.length === 0)) {
      badgeCount.textContent = '0';
    }
  }
}

function applyCustomPrefixFilter() {
  const input = document.getElementById('customPrefixNimInput');
  const val = (input?.value || '').trim();
  if (!val) {
    window.currentFilterNim = window.currentUser?.prefixNim || '';
    updateSadewaPrefixUI();
    loadSadewaData(true, window.currentFilterNim);
    return;
  }
  if (val.length < 3) {
    showToast('Masukkan minimal 3 digit NIM (kode prodi).');
    return;
  }
  window.currentFilterNim = val;
  updateSadewaPrefixUI();
  loadSadewaData(true, window.currentFilterNim);
}

// Expose variables and functions to window
Object.defineProperty(window, 'rawSadewaList', {
  get: () => rawSadewaList,
  set: (val) => { rawSadewaList = val; }
});
Object.defineProperty(window, 'filteredSadewaList', {
  get: () => filteredSadewaList,
  set: (val) => { filteredSadewaList = val; }
});

window.loadSadewaData = loadSadewaData;
window.updateSadewaStats = updateSadewaStats;
window.populateSadewaFilterDropdowns = populateSadewaFilterDropdowns;
window.triggerSadewaScraping = triggerSadewaScraping;
window.applySadewaFilters = applySadewaFilters;
window.handleSadewaSearch = handleSadewaSearch;
window.handleSadewaDospemFilter = handleSadewaDospemFilter;
window.handleSadewaStatusFilter = handleSadewaStatusFilter;
window.handleSadewaPageSizeChange = handleSadewaPageSizeChange;
window.renderSadewaTable = renderSadewaTable;
window.renderSadewaPagination = renderSadewaPagination;
window.changeSadewaPage = changeSadewaPage;
window.openSkripsiModal = openSkripsiModal;
window.closeSkripsiModal = closeSkripsiModal;
window.copyModalJudul = copyModalJudul;
window.copyNim = copyNim;
window.downloadSadewaJson = downloadSadewaJson;
window.updateSadewaPrefixUI = updateSadewaPrefixUI;
window.applyCustomPrefixFilter = applyCustomPrefixFilter;
