// ============================================================
// MAIN APPLICATION ENTRYPOINT & TAB NAVIGATION
// ============================================================

function switchTab(tab) {
  const bimaBtn = document.getElementById('tabBimaBtn');
  const sadewaBtn = document.getElementById('tabSadewaBtn');
  const bimaContent = document.getElementById('bimaTabContent');
  const sadewaContent = document.getElementById('sadewaTabContent');

  if (tab === 'sadewa') {
    bimaBtn.className = 'tab-btn cursor-pointer';
    sadewaBtn.className = 'tab-btn tab-active cursor-pointer';
    bimaContent.classList.add('hidden');
    sadewaContent.classList.remove('hidden');

    if (window.currentUser && window.currentUser.prefixNim && window.rawSadewaList.length === 0) {
      loadSadewaData(false, window.currentFilterNim);
    }
  } else {
    bimaBtn.className = 'tab-btn tab-active cursor-pointer';
    sadewaBtn.className = 'tab-btn cursor-pointer';
    bimaContent.classList.remove('hidden');
    sadewaContent.classList.add('hidden');
  }
}

// Inisialisasi aplikasi saat halaman dibuka
document.addEventListener('DOMContentLoaded', async () => {
  await checkAuthStatus();
  if (window.currentUser) {
    await loadLecturers();
    if (window.currentUser.prefixNim) {
      loadSadewaData(false, window.currentUser.prefixNim);
    }
  } else {
    resetDosenKatalog();
    window.rawSadewaList = [];
    window.filteredSadewaList = [];
    updateSadewaPrefixUI();
    updateSadewaStats();
    renderSadewaTable();
  }
});

// Expose to window
window.switchTab = switchTab;
