/**
 * Browser Launcher Utility (CloakBrowser Stealth Integration)
 * 
 * Menggunakan CloakBrowser (Stealth Chromium dengan C++ fingerprint patch level)
 * https://github.com/CloakHQ/CloakBrowser
 * 
 * Keunggulan:
 * 1. 87 source-level patches (menghilangkan navigator.webdriver, CDP automation flags, canvas/audio/WebGL mismatch)
 * 2. Skor reCAPTCHA v3/v2 naik drastis (~0.9 = manusia) sehingga checkbox mudah tercentang hijau
 * 3. Humanize movements: simulasi pergerakan mouse kurva Bézier yang natural
 * 4. Fallback otomatis ke Playwright Chromium standar jika terjadi kendala
 */

import { launch as cloakLaunch, launchPersistentContext as cloakLaunchPersistent } from 'cloakbrowser';
import { chromium } from 'playwright';

/**
 * Meluncurkan browser konteks persisten dengan CloakBrowser stealth
 * @param {string} userDataDir 
 * @param {object} options 
 * @returns {Promise<import('playwright').BrowserContext>}
 */
export async function launchStealthPersistentContext(userDataDir, options = {}) {
  const {
    headless = false,
    slowMo = 50,
    viewport = { width: 1280, height: 720 },
    args = [],
    extensionPaths = [],
    humanize = true,
    ...rest
  } = options;

  try {
    console.log('🛡️ [CloakBrowser] Meluncurkan Stealth Chromium (87 C++ patches + Humanize)...');
    const context = await cloakLaunchPersistent({
      userDataDir,
      headless,
      humanize,
      args,
      extensionPaths: extensionPaths.length > 0 ? extensionPaths : undefined,
      viewport,
      launchOptions: {
        slowMo,
        ...rest
      }
    });
    return context;
  } catch (err) {
    console.warn('⚠️ [CloakBrowser] Gagal meluncurkan CloakBrowser, beralih ke Playwright default:', err.message);
    return await chromium.launchPersistentContext(userDataDir, {
      headless,
      slowMo,
      viewport,
      args,
      ...rest
    });
  }
}

/**
 * Meluncurkan browser standar dengan CloakBrowser stealth
 * @param {object} options 
 * @returns {Promise<import('playwright').Browser>}
 */
export async function launchStealthBrowser(options = {}) {
  const {
    headless = false,
    slowMo = 50,
    args = [],
    humanize = true,
    ...rest
  } = options;

  try {
    console.log('🛡️ [CloakBrowser] Meluncurkan Stealth Browser...');
    const browser = await cloakLaunch({
      headless,
      humanize,
      args,
      launchOptions: {
        slowMo,
        ...rest
      }
    });
    return browser;
  } catch (err) {
    console.warn('⚠️ [CloakBrowser] Gagal meluncurkan CloakBrowser, beralih ke Playwright default:', err.message);
    return await chromium.launch({
      headless,
      slowMo,
      args,
      ...rest
    });
  }
}
