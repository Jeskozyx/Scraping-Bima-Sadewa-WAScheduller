/**
 * Audio reCAPTCHA v2 Solver & Buster Integration (Gratis)
 * 
 * Modul ini menerapkan:
 * 1. Pemicu otomatis klik checkbox reCAPTCHA
 * 2. Eksekusi solver audio otomatis via ekstensi Buster (Free Audio Solver)
 * 3. Fallback deteksi status centang hijau (aria-checked="true")
 */

/**
 * Mencoba menyelesaikan reCAPTCHA v2 secara otomatis dan gratis
 * @param {import('playwright').Page} page
 * @returns {Promise<{ success: boolean, method: string, message?: string }>}
 */
export async function trySolveCaptchaFree(page) {
  try {
    console.log('[FreeCaptchaSolver] Mencari widget reCAPTCHA...');
    
    // 1. Cari frame anchor (kotak centang "I'm not a robot")
    await page.waitForTimeout(2000);
    const anchorFrame = page.frames().find((f) => f.url().includes('recaptcha/api2/anchor'));
    
    if (!anchorFrame) {
      return { success: false, method: 'none', message: 'Frame reCAPTCHA tidak ditemukan' };
    }

    const anchorCheckbox = anchorFrame.locator('#recaptcha-anchor');
    await anchorCheckbox.waitFor({ timeout: 10000 });

    // Cek apakah sudah tercentang sebelumnya
    const isAlreadyChecked = await anchorCheckbox.getAttribute('aria-checked');
    if (isAlreadyChecked === 'true') {
      console.log('[FreeCaptchaSolver] ✅ reCAPTCHA sudah tercentang otomatis!');
      return { success: true, method: 'auto-checked' };
    }

    // Klik checkbox secara halus
    console.log('[FreeCaptchaSolver] Mengklik checkbox "I\'m not a robot"...');
    await anchorCheckbox.click();
    await page.waitForTimeout(2500);

    // Periksa kembali apakah langsung hijau (sering terjadi jika browser dinilai trusted)
    const checkedAfterClick = await anchorCheckbox.getAttribute('aria-checked');
    if (checkedAfterClick === 'true') {
      console.log('[FreeCaptchaSolver] ✅ Centang hijau langsung didapat!');
      return { success: true, method: 'direct-click' };
    }

    // 2. Jika muncul challenge popup, cari frame bframe
    console.log('[FreeCaptchaSolver] Challenge muncul. Memeriksa Buster solver button...');
    const bframe = page.frames().find((f) => f.url().includes('recaptcha/api2/bframe'));
    
    if (bframe) {
      // Cari tombol Buster (.help-button-holder di light DOM)
      const busterButton = bframe.locator('.help-button-holder');
      const hasBuster = await busterButton.isVisible({ timeout: 5000 }).catch(() => false);

      if (hasBuster) {
        console.log('[FreeCaptchaSolver] 🎧 Menekan tombol Buster Audio Solver...');
        await busterButton.click().catch(() => {});

        // Tunggu Buster memproses audio dan menyelesaikan challenge
        console.log('[FreeCaptchaSolver] Menunggu Buster menyelesaikan CAPTCHA...');
        for (let i = 0; i < 15; i++) {
          await page.waitForTimeout(2000);
          const status = await anchorCheckbox.getAttribute('aria-checked').catch(() => null);
          if (status === 'true') {
            console.log('[FreeCaptchaSolver] ✅ Buster berhasil menyelesaikan CAPTCHA!');
            return { success: true, method: 'buster-audio' };
          }
          
          // Cek apakah Google membatasi audio challenge
          const isBlocked = await bframe.locator('.rc-doscaptcha-header, text=automated queries, text=Try again later').isVisible().catch(() => false);
          if (isBlocked) {
            console.warn('[FreeCaptchaSolver] ⚠️ Google membatasi verifikasi audio (Try again later). Silakan selesaikan tantangan gambar secara manual.');
            return { success: false, method: 'audio-blocked', message: 'Audio challenge dibatasi oleh Google' };
          }
        }
      }
    }

    // Cek status akhir
    const finalStatus = await anchorCheckbox.getAttribute('aria-checked').catch(() => null);
    if (finalStatus === 'true') {
      return { success: true, method: 'verified' };
    }

    return { success: false, method: 'manual-required', message: 'Perlu centang manual' };
  } catch (err) {
    console.warn('[FreeCaptchaSolver] Catatan:', err.message);
    return { success: false, method: 'error', message: err.message };
  }
}
