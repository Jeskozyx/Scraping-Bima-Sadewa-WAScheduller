// ============================================================
// SHARED UTILITIES & HELPERS
// ============================================================

const PRODI_MAP = {
  '111': 'Teknik Pertambangan',
  '112': 'Teknik Perminyakan',
  '113': 'Teknik Geologi',
  '114': 'Teknik Geofisika',
  '115': 'Teknik Metalurgi',
  '121': 'Teknik Kimia',
  '122': 'Teknik Industri',
  '123': 'Informatika',
  '124': 'Sistem Informasi',
  '125': 'Sains Data',
  '131': 'Agroteknologi',
  '132': 'Agribisnis',
  '133': 'Ilmu Tanah',
  '141': 'Manajemen',
  '142': 'Akuntansi',
  '143': 'Ekonomi Pembangunan',
  '151': 'Hubungan Internasional',
  '152': 'Ilmu Komunikasi',
  '153': 'Administrasi Bisnis',
  '154': 'Hubungan Masyarakat'
};

function parseNimInfo(npm) {
  if (!npm) return { prodi: '', angkatan: '', prefixNim: '' };
  const cleanNpm = String(npm).replace(/\D/g, '');
  if (!cleanNpm) return { prodi: '', angkatan: '', prefixNim: '' };
  const prodiCode = cleanNpm.slice(0, 3);
  const angkatanCode = cleanNpm.slice(3, 5);
  const prefixNim = cleanNpm.slice(0, 5);
  const prodi = PRODI_MAP[prodiCode] || (prodiCode ? `Prodi ${prodiCode}` : '');
  const angkatan = angkatanCode ? `20${angkatanCode}` : '';
  return { prodi, angkatan, prefixNim, prodiCode, angkatanCode };
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function showToast(msg) {
  const toast = document.getElementById('toastNotification');
  const toastMsg = document.getElementById('toastMsg');
  if (!toast || !toastMsg) return;
  toastMsg.textContent = msg;
  toast.classList.remove('translate-y-20', 'opacity-0');
  clearTimeout(window.__toastTimeout);
  window.__toastTimeout = setTimeout(() => {
    toast.classList.add('translate-y-20', 'opacity-0');
  }, 3000);
}

// Expose to window for global access
window.PRODI_MAP = PRODI_MAP;
window.parseNimInfo = parseNimInfo;
window.escapeHtml = escapeHtml;
window.showToast = showToast;
