// ============================================================
// STATE & LOGIKA BIMA JADWAL DOSEN & KATALOG
// ============================================================

const dayMeta = {
  'Senin': { icon: '', gradient: 'from-blue-500/20 to-blue-600/10', border: 'border-blue-500/20', accent: 'text-blue-400' },
  'Selasa': { icon: '', gradient: 'from-emerald-500/20 to-emerald-600/10', border: 'border-emerald-500/20', accent: 'text-emerald-400' },
  'Rabu': { icon: '', gradient: 'from-amber-500/20 to-amber-600/10', border: 'border-amber-500/20', accent: 'text-amber-400' },
  'Kamis': { icon: '', gradient: 'from-orange-500/20 to-orange-600/10', border: 'border-orange-500/20', accent: 'text-orange-400' },
  'Jumat': { icon: '', gradient: 'from-red-500/20 to-red-600/10', border: 'border-red-500/20', accent: 'text-red-400' },
  'Sabtu': { icon: '', gradient: 'from-purple-500/20 to-purple-600/10', border: 'border-purple-500/20', accent: 'text-purple-400' },
};

let allLecturers = [];
let allLecturersDetailed = [];
let selectedLecturer = '';
let waPollTimer = null;

function resetDosenKatalog() {
  allLecturers = [];
  allLecturersDetailed = [];
  renderLecturerCheckboxes([]);
  const tbody = document.getElementById('dosenKatalogTableBody');
  if (tbody) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" class="text-center py-8 text-slate-400">
          <div class="flex flex-col items-center justify-center gap-2">
            <span class="text-2xl">🔒</span>
            <span class="font-semibold text-slate-200">Belum Masuk Akun SSO UPN</span>
            <span class="text-xs text-slate-500 max-w-sm">Silakan login dengan akun SSO UPN Anda untuk membaca dan mendeteksi daftar dosen program studi Anda dari BIMA.</span>
            <button type="button" onclick="openAuthModal()" class="mt-2 px-3.5 py-1.5 rounded-xl text-xs font-semibold btn-primary text-white cursor-pointer shadow-sm active:scale-95 transition-all">
              Masuk Akun SSO UPN
            </button>
          </div>
        </td>
      </tr>
    `;
  }
  const countBadge = document.getElementById('totalDosenCountBadge');
  if (countBadge) countBadge.textContent = '0 Dosen';
  const info = document.getElementById('dosenKatalogInfoText');
  if (info) info.textContent = 'Menampilkan 0 dosen';
  const toggleText = document.getElementById('lecturerListToggleText');
  if (toggleText) toggleText.textContent = 'Pilih dari Daftar Dosen (0)';
}

async function loadLecturers() {
  if (!window.currentUser) {
    resetDosenKatalog();
    return;
  }

  try {
    const user = window.currentUser;
    const prodiParam = encodeURIComponent(user.prodi || '');
    const nimParam = encodeURIComponent(user.nim || user.npm || '');
    const res = await authFetch(`/api/lecturers?prodi=${prodiParam}&nim=${nimParam}`);
    const json = await res.json();
    if (json.success && Array.isArray(json.data) && json.data.length > 0) {
      allLecturers = json.data;
      allLecturersDetailed = json.dosenList || json.data.map((n) => ({ nama: n, prodi: user.prodi || 'UPN Veteran Yogyakarta' }));
      renderLecturerCheckboxes(allLecturers);
      renderDosenKatalogTable(allLecturersDetailed);

      const toggleText = document.getElementById('lecturerListToggleText');
      if (toggleText) toggleText.textContent = `Pilih dari Daftar Dosen (${allLecturers.length})`;

      const countBadge = document.getElementById('totalDosenCountBadge');
      if (countBadge) countBadge.textContent = `${allLecturers.length} Dosen (${user.prodi || ''})`;
    } else {
      allLecturers = [];
      allLecturersDetailed = [];
      renderLecturerCheckboxes([]);
      renderDosenKatalogTable([]);
      const toggleText = document.getElementById('lecturerListToggleText');
      if (toggleText) toggleText.textContent = 'Pilih dari Daftar Dosen (0)';
      const countBadge = document.getElementById('totalDosenCountBadge');
      if (countBadge) countBadge.textContent = `0 Dosen (${user.prodi || ''})`;
    }
  } catch (e) {
    console.error('Gagal memuat daftar dosen:', e);
    resetDosenKatalog();
  }
}

function renderDosenKatalogTable(list) {
  const tbody = document.getElementById('dosenKatalogTableBody');
  const info = document.getElementById('dosenKatalogInfoText');
  if (!tbody) return;

  if (!window.currentUser) {
    resetDosenKatalog();
    return;
  }

  if (!list || list.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" class="text-center py-7 text-slate-400">
          <div class="flex flex-col items-center justify-center gap-1.5">
            <span class="text-base font-semibold text-slate-300">Belum Ada Dosen Terdeteksi</span>
            <span class="text-xs text-slate-400">Belum ada dosen yang tersimpan untuk program studi <strong>${escapeHtml(window.currentUser?.prodi || '')}</strong>.</span>
            <span class="text-[11px] text-slate-500">Klik tombol <strong>Sinkronkan Dosen BIMA</strong> di atas untuk membaca daftar dosen dari portal BIMA.</span>
          </div>
        </td>
      </tr>
    `;
    if (info) info.textContent = 'Menampilkan 0 dosen';
    return;
  }

  tbody.innerHTML = list.map((item, idx) => {
    const nama = typeof item === 'string' ? item : (item.nama || '');
    const prodi = (typeof item === 'object' && item.prodi) ? item.prodi : (window.currentUser?.prodi || 'UPN Veteran Yogyakarta');
    const safeName = escapeHtml(nama);

    return `
      <tr class="hover:bg-slate-800/40 transition-colors">
        <td class="py-2.5 px-3 text-center text-slate-500 font-mono text-[11px]">${idx + 1}</td>
        <td class="py-2.5 px-4 font-semibold text-slate-200">
          <span class="hover:text-blue-400 cursor-pointer transition-colors" onclick="selectDosenFromKatalog('${safeName}')">${safeName}</span>
        </td>
        <td class="py-2.5 px-4 text-slate-400 text-xs hidden sm:table-cell">
          ${escapeHtml(prodi)}
        </td>
        <td class="py-2.5 px-4 text-center">
          <button type="button" onclick="selectDosenFromKatalog('${safeName}')"
            class="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-blue-600/20 hover:bg-blue-600 text-blue-300 hover:text-white border border-blue-500/30 transition-all cursor-pointer">
            Cek Jadwal
          </button>
        </td>
      </tr>
    `;
  }).join('');

  if (info) info.textContent = `Menampilkan ${list.length} dosen`;
}

function filterDosenKatalog(query) {
  const clean = (query || '').toLowerCase().trim();
  const filtered = clean
    ? allLecturersDetailed.filter((d) => {
      const nama = (typeof d === 'string' ? d : d.nama || '').toLowerCase();
      const prodi = (typeof d === 'object' && d.prodi ? d.prodi : '').toLowerCase();
      return nama.includes(clean) || prodi.includes(clean);
    })
    : allLecturersDetailed;
  renderDosenKatalogTable(filtered);
}

function selectDosenFromKatalog(nama) {
  const input = document.getElementById('dosenName');
  if (input) {
    input.value = nama;
    selectedLecturer = nama;
    const indicator = document.getElementById('selectedLecturerIndicator');
    if (indicator) {
      indicator.textContent = `✓ ${nama}`;
      indicator.classList.remove('hidden');
    }
    showToast(`Dosen "${nama}" dipilih! Memulai pencarian jadwal...`);
    document.getElementById('scheduleForm')?.scrollIntoView({ behavior: 'smooth' });
    document.getElementById('scheduleForm')?.dispatchEvent(new Event('submit', { cancelable: true }));
  }
}

async function triggerDosenBimaSync() {
  if (!window.currentUser) {
    openAuthModal('Silakan masuk akun UPN Anda terlebih dahulu untuk menyinkronkan daftar dosen BIMA.');
    return;
  }

  const btn = document.getElementById('syncDosenBimaBtn');
  const spinner = document.getElementById('syncDosenSpinner');
  const icon = document.getElementById('syncDosenIcon');
  const text = document.getElementById('syncDosenText');

  if (btn) btn.disabled = true;
  if (spinner) spinner.classList.remove('hidden');
  if (icon) icon.classList.add('hidden');
  if (text) text.textContent = 'Men-scrape BIMA...';

  showToast('🌐 Membuka portal BIMA & membaca daftar dosen akun Anda...');

  try {
    const res = await authFetch('/api/scrape-lecturers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        npm: window.currentUser.npm || window.currentUser.nim,
        nim: window.currentUser.nim || window.currentUser.npm
      })
    });
    const data = await res.json();
    if (!data.success) {
      throw new Error(data.message || 'Gagal sinkronisasi dosen BIMA');
    }

    showToast(`🎉 Berhasil! ${data.total} dosen BIMA tersinkronkan ke Supabase!`);
    await loadLecturers();
  } catch (err) {
    showToast(`❌ Gagal: ${err.message}`);
  } finally {
    if (btn) btn.disabled = false;
    if (spinner) spinner.classList.add('hidden');
    if (icon) icon.classList.remove('hidden');
    if (text) text.textContent = 'Sinkronkan Dosen BIMA';
  }
}

function renderLecturerCheckboxes(list) {
  const container = document.getElementById('lecturerCheckboxList');
  if (!container) return;

  if (list.length === 0) {
    container.innerHTML = '<div class="text-center py-4 text-xs text-slate-500">Tidak ada dosen yang cocok dengan filter.</div>';
    return;
  }

  container.innerHTML = list.map((name) => {
    const isChecked = selectedLecturer.toLowerCase() === name.toLowerCase();
    const safeName = name.replace(/"/g, '&quot;');
    return `
      <label class="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs cursor-pointer select-none transition-all ${isChecked
        ? 'bg-blue-600/25 text-blue-200 border border-blue-500/40 font-semibold'
        : 'hover:bg-slate-800/60 text-slate-300 border border-transparent'
      }">
        <input type="checkbox" name="lecturerCheckbox" value="${safeName}" ${isChecked ? 'checked' : ''}
          onchange="handleLecturerCheckboxChange(this)"
          class="checkbox-custom shrink-0 w-4 h-4">
        <span class="truncate">${name}</span>
      </label>
    `;
  }).join('');
}

function handleLecturerCheckboxChange(checkbox) {
  const name = checkbox.value;
  const input = document.getElementById('dosenName');
  const indicator = document.getElementById('selectedLecturerIndicator');

  if (checkbox.checked) {
    document.querySelectorAll('input[name="lecturerCheckbox"]').forEach((cb) => {
      if (cb !== checkbox) cb.checked = false;
    });
    selectedLecturer = name;
    input.value = name;
    if (indicator) {
      indicator.textContent = `✓ ${name}`;
      indicator.classList.remove('hidden');
    }
  } else {
    selectedLecturer = '';
    input.value = '';
    if (indicator) indicator.classList.add('hidden');
  }

  const query = document.getElementById('filterLecturerInput')?.value || '';
  const filtered = query
    ? allLecturers.filter((l) => l.toLowerCase().includes(query.toLowerCase()))
    : allLecturers;
  renderLecturerCheckboxes(filtered);
}

function filterLecturers(query) {
  const clean = (query || '').toLowerCase().trim();
  const filtered = clean
    ? allLecturers.filter((l) => l.toLowerCase().includes(clean))
    : allLecturers;
  renderLecturerCheckboxes(filtered);
}

function toggleLecturerList() {
  const wrapper = document.getElementById('lecturerListWrapper');
  const chevron = document.getElementById('lecturerChevron');
  const isHidden = wrapper.classList.contains('hidden');

  wrapper.classList.toggle('hidden');
  if (chevron) chevron.classList.toggle('rotate-180', isHidden);

  if (isHidden && allLecturers.length === 0) {
    loadLecturers();
  }
}

async function checkWhatsAppStatus() {
  try {
    const res = await fetch('/api/wa-status');
    const data = await res.json();
    if (!data.success) return;

    const { isConnected, qr } = data.data;
    const badge = document.getElementById('waConnectionBadge');
    const qrContainer = document.getElementById('waQrContainer');
    const qrImage = document.getElementById('waQrImage');
    const qrLoading = document.getElementById('waQrLoading');
    const connectedNotice = document.getElementById('waConnectedNotice');

    if (badge) badge.classList.remove('hidden');

    if (isConnected) {
      if (badge) {
        badge.textContent = 'WA Terhubung';
        badge.className = 'text-[11px] px-2.5 py-1 rounded-full font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/30';
      }
      if (qrContainer) qrContainer.classList.add('hidden');
      if (connectedNotice) connectedNotice.classList.remove('hidden');

      if (waPollTimer) {
        clearInterval(waPollTimer);
        waPollTimer = null;
      }
    } else {
      if (badge) {
        badge.textContent = 'WA Belum Scan';
        badge.className = 'text-[11px] px-2.5 py-1 rounded-full font-medium bg-amber-500/15 text-amber-400 border border-amber-500/30';
      }
      if (connectedNotice) connectedNotice.classList.add('hidden');
      if (qrContainer) qrContainer.classList.remove('hidden');

      if (qr) {
        if (qrImage) {
          qrImage.src = qr;
          qrImage.classList.remove('hidden');
        }
        if (qrLoading) qrLoading.classList.add('hidden');
      } else {
        if (qrImage) qrImage.classList.add('hidden');
        if (qrLoading) qrLoading.classList.remove('hidden');
      }
    }
  } catch (err) {
    console.error('Gagal memeriksa status WhatsApp:', err);
  }
}

function toggleWaInput() {
  const cb = document.getElementById('sendWhatsApp');
  const wrapper = document.getElementById('waInputWrapper');
  const checked = cb.checked;
  wrapper.classList.toggle('hidden', !checked);

  if (checked) {
    fetch('/api/wa-init', { method: 'POST' }).catch(() => { });
    checkWhatsAppStatus();
    if (!waPollTimer) {
      waPollTimer = setInterval(checkWhatsAppStatus, 2000);
    }
  } else {
    if (waPollTimer) {
      clearInterval(waPollTimer);
      waPollTimer = null;
    }
  }
}

function setLoading(loading) {
  const btn = document.getElementById('submitBtn');
  const searchIcon = document.getElementById('searchIcon');
  const loadingIcon = document.getElementById('loadingIcon');
  const btnText = document.getElementById('btnText');
  const skeleton = document.getElementById('loadingSkeleton');

  btn.disabled = loading;
  searchIcon.classList.toggle('hidden', loading);
  loadingIcon.classList.toggle('hidden', !loading);
  btnText.textContent = loading ? 'Mencari jadwal...' : 'Cari Jadwal Dosen';
  skeleton.classList.toggle('hidden', !loading);

  if (loading) {
    document.getElementById('results').classList.add('hidden');
    document.getElementById('errorAlert').classList.add('hidden');
  }
}

function showError(message) {
  const alert = document.getElementById('errorAlert');
  document.getElementById('errorText').textContent = message;
  alert.classList.remove('hidden');
}

function renderResults(data) {
  const results = document.getElementById('results');
  const grid = document.getElementById('dayCardsGrid');

  // Header
  document.getElementById('resultDosenName').textContent = `${data.dosenName}`;
  document.getElementById('resultSemester').textContent = `Semester: ${data.semester}`;

  // WA status
  const waBadge = document.getElementById('waStatusBadge');
  if (data.whatsapp && data.whatsapp.sent) {
    waBadge.classList.remove('hidden');
  } else {
    waBadge.classList.add('hidden');
  }

  // Quick action: Salin teks & Buka via wa.me
  const copyBtn = document.getElementById('copyScheduleBtn');
  const copyBtnText = document.getElementById('copyBtnText');
  const waDirectBtn = document.getElementById('waDirectBtn');
  const textPreviewCard = document.getElementById('textPreviewCard');
  const formattedMessageText = document.getElementById('formattedMessageText');
  const copyFromPreviewBtn = document.getElementById('copyFromPreviewBtn');

  if (data.formattedMessage) {
    textPreviewCard.classList.remove('hidden');
    formattedMessageText.value = data.formattedMessage;

    waDirectBtn.onclick = () => {
      const numInput = document.getElementById('waNumber').value.trim().replace(/[^0-9]/g, '');
      let waUrl = 'https://wa.me/?text=' + encodeURIComponent(data.formattedMessage);
      if (numInput) {
        const cleanWa = numInput.startsWith('0') ? '62' + numInput.slice(1) : numInput;
        waUrl = 'https://wa.me/' + cleanWa + '?text=' + encodeURIComponent(data.formattedMessage);
      }
      waDirectBtn.href = waUrl;
    };

    const copyAction = async () => {
      try {
        await navigator.clipboard.writeText(data.formattedMessage);
        copyBtnText.textContent = 'Tersalin! ✓';
        showToast('Teks jadwal berhasil disalin ke clipboard!');
        setTimeout(() => { copyBtnText.textContent = 'Salin Teks'; }, 2500);
      } catch (e) {
        showToast('Gagal menyalin ke clipboard.');
      }
    };

    copyBtn.onclick = copyAction;
    copyFromPreviewBtn.onclick = copyAction;
  } else {
    textPreviewCard.classList.add('hidden');
  }

  // Day rows: garis waktu 07:00-17:00
  grid.innerHTML = '';
  const days = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const toMin = (t) => { const p = String(t).split(/[:.]/).map(Number); return p[0] * 60 + (p[1] || 0); };
  const pct = (t) => Math.min(100, Math.max(0, (toMin(t) - 420) / 6));
  let ticks = '';
  for (let h = 7; h < 17; h++) ticks += `<span class="flex-1">${String(h).padStart(2, '0')}</span>`;
  grid.innerHTML = `<div class="hidden md:grid" style="grid-template-columns:100px 1fr 230px;gap:20px"><span></span><div class="flex font-mono text-xs">${ticks}</div><span class="font-mono text-xs">KOSONG</span></div>`;

  days.forEach((day) => {
    const analysis = data.schedule[day] || {};
    const busy = analysis.busySlots || [];
    const free = analysis.availableSlots || [];
    const bars = busy.map((b) => `<i style="left:${pct(b.startTime)}%;width:${Math.max(1, pct(b.endTime) - pct(b.startTime))}%"></i>`).join('');
    const details = busy.map((b) => `
      <li class="text-xs leading-snug"><span class="font-mono">${b.startTime}–${b.endTime}</span> <span class="font-semibold">${b.subject}</span>${b.room ? `<span class="text-slate-400"> · ${b.room}${b.kelas ? ' · ' + b.kelas : ''}</span>` : ''}</li>`).join('');
    let freeHtml = free.map((f) => `<div class="free-text">${f.start}–${f.end}</div>`).join('');
    if (!freeHtml && busy.length === 0) freeHtml = '<div class="free-text">Seharian kosong (07:00–17:00)</div>';
    if (!freeHtml) freeHtml = '<div class="free-text">-</div>';
    const row = document.createElement('div');
    row.className = 'day-row';
    row.innerHTML = `
      <h3 class="font-extrabold text-base">${day}</h3>
      <div><div class="timeline">${bars}</div><ul class="mt-2 space-y-1">${details}</ul></div>
      <div class="space-y-0.5">${freeHtml}</div>`;
    grid.appendChild(row);
  });

  // Render Tabel Jadwal Mengajar Dosen Lengkap
  const rawRows = data.rawRows || [];
  const tableBody = document.getElementById('tableJadwalDosenBody');
  const totalMatkulBadge = document.getElementById('totalMatkulBadge');
  const totalSksBadge = document.getElementById('totalSksBadge');

  if (tableBody) {
    if (rawRows.length === 0) {
      tableBody.innerHTML = '<tr><td colspan="8" class="text-center py-6 text-slate-500">Dosen tidak memiliki jadwal mengajar pada semester ini.</td></tr>';
      if (totalMatkulBadge) totalMatkulBadge.textContent = '0 Kelas';
      if (totalSksBadge) totalSksBadge.textContent = '0 SKS';
    } else {
      let sumSks = 0;
      tableBody.innerHTML = rawRows.map((row, idx) => {
        const isPrak = /praktikum/i.test(row.matkul || '') || !!row.isPraktikum;
        const sksVal = Number(row.sks) || 0;
        sumSks += sksVal;

        let hari = row.hari || '';
        let jam = (row.jamMulai && row.jamSelesai && row.jamMulai !== '00:00') ? `${row.jamMulai} - ${row.jamSelesai}` : (row.jadwal || '-');
        if (row.jadwal && !hari) {
          const m = row.jadwal.match(/([A-Za-z]+)\s+(.+)/);
          if (m) {
            hari = m[1];
            jam = m[2];
          }
        }

        return `
          <tr class="hover:bg-slate-800/40 transition-colors">
            <td class="py-2.5 px-3 text-center text-slate-500 font-mono text-[11px]">${idx + 1}</td>
            <td class="py-2.5 px-3 font-semibold text-slate-200 whitespace-nowrap">${escapeHtml(hari || '-')}</td>
            <td class="py-2.5 px-3 font-mono text-slate-300 text-[11px] whitespace-nowrap">${escapeHtml(jam)}</td>
            <td class="py-2.5 px-4">
              <div class="font-semibold text-slate-100">${escapeHtml(row.matkul || '-')}</div>
              ${row.kode ? `<div class="text-[10px] text-slate-400 font-mono">${escapeHtml(row.kode)}</div>` : ''}
            </td>
            <td class="py-2.5 px-3 text-center font-mono font-bold text-amber-300">${escapeHtml(row.kelas || '-')}</td>
            <td class="py-2.5 px-3 text-center font-mono text-slate-300">${row.sks || '-'}</td>
            <td class="py-2.5 px-3 text-slate-300">${escapeHtml(row.ruang || '-')}</td>
            <td class="py-2.5 px-3 text-center">
              <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${isPrak
            ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
            : 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
          }">
                ${isPrak ? 'Praktikum' : 'Teori'}
              </span>
            </td>
          </tr>
        `;
      }).join('');

      if (totalMatkulBadge) totalMatkulBadge.textContent = `${rawRows.length} Kelas`;
      if (totalSksBadge) totalSksBadge.textContent = `${sumSks} SKS`;
    }
  }

  results.classList.remove('hidden');
}

async function handleSearch(e) {
  e.preventDefault();

  if (!window.currentUser) {
    openAuthModal('Wajib masuk dengan akun BIMA/SADEWA UPNYK untuk mencari jadwal dosen.', 'search_schedule');
    return;
  }

  setLoading(true);

  const dosenName = document.getElementById('dosenName').value.trim();
  const semester = document.getElementById('semester').value;
  const sendWhatsApp = document.getElementById('sendWhatsApp').checked;
  const waNumber = document.getElementById('waNumber').value.trim();

  if (sendWhatsApp && !waNumber) {
    showError('Masukkan nomor WhatsApp tujuan.');
    setLoading(false);
    return;
  }

  try {
    const response = await authFetch('/api/search-schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dosenName,
        semester,
        sendWhatsApp,
        waNumber,
        nim: window.currentUser?.nim || window.currentUser?.npm
      })
    });

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.message || 'Terjadi kesalahan tidak diketahui.');
    }

    renderResults(result.data);
  } catch (err) {
    showError(err.message || 'Gagal terhubung ke server. Pastikan server berjalan di localhost:3000.');
  } finally {
    setLoading(false);
  }
}

// Expose variables and functions to window
Object.defineProperty(window, 'allLecturers', {
  get: () => allLecturers,
  set: (val) => { allLecturers = val; }
});
Object.defineProperty(window, 'allLecturersDetailed', {
  get: () => allLecturersDetailed,
  set: (val) => { allLecturersDetailed = val; }
});
Object.defineProperty(window, 'selectedLecturer', {
  get: () => selectedLecturer,
  set: (val) => { selectedLecturer = val; }
});

window.dayMeta = dayMeta;
window.resetDosenKatalog = resetDosenKatalog;
window.loadLecturers = loadLecturers;
window.renderDosenKatalogTable = renderDosenKatalogTable;
window.filterDosenKatalog = filterDosenKatalog;
window.selectDosenFromKatalog = selectDosenFromKatalog;
window.triggerDosenBimaSync = triggerDosenBimaSync;
window.renderLecturerCheckboxes = renderLecturerCheckboxes;
window.handleLecturerCheckboxChange = handleLecturerCheckboxChange;
window.filterLecturers = filterLecturers;
window.toggleLecturerList = toggleLecturerList;
window.checkWhatsAppStatus = checkWhatsAppStatus;
window.toggleWaInput = toggleWaInput;
window.setLoading = setLoading;
window.showError = showError;
window.renderResults = renderResults;
window.handleSearch = handleSearch;
