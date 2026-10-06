/**
 * reCAPTCHA v2 Solver Service
 * Mendukung provider API pihak ketiga (2Captcha & CapSolver)
 * Berdasarkan panduan di deepseek_markdown_20261004_2b06b5.md
 */

import dotenv from 'dotenv';
dotenv.config();

/**
 * Menyelesaikan reCAPTCHA v2 menggunakan 2Captcha
 * @param {string} apiKey - 2Captcha API Key
 * @param {string} sitekey - Google reCAPTCHA Sitekey
 * @param {string} pageUrl - URL halaman target
 * @returns {Promise<string>} Token g-recaptcha-response
 */
async function solveWith2Captcha(apiKey, sitekey, pageUrl) {
  console.log('[2Captcha] Mengirim permintaan task reCAPTCHA v2...');
  const inUrl = `https://2captcha.com/in.php?key=${apiKey}&method=userrecaptcha&googlekey=${sitekey}&pageurl=${encodeURIComponent(pageUrl)}&json=1`;
  
  const inRes = await fetch(inUrl);
  const inData = await inRes.json();

  if (inData.status !== 1) {
    throw new Error(`[2Captcha Error] ${inData.request || JSON.stringify(inData)}`);
  }

  const taskId = inData.request;
  console.log(`[2Captcha] Task dibuat dengan ID: ${taskId}. Menunggu penyelesaian solver...`);

  // Polling hingga token siap (maks 150 detik)
  const maxAttempts = 30; // 30 x 5 detik = 150 detik
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    
    const resUrl = `https://2captcha.com/res.php?key=${apiKey}&action=get&id=${taskId}&json=1`;
    const res = await fetch(resUrl);
    const resData = await res.json();

    if (resData.status === 1) {
      console.log(`[2Captcha] ✅ CAPTCHA berhasil diselesaikan dalam ${attempt * 5} detik!`);
      return resData.request;
    }

    if (resData.request !== 'CAPCHA_NOT_READY') {
      throw new Error(`[2Captcha Error] ${resData.request}`);
    }

    process.stdout.write(`[2Captcha] Menunggu hasil... (${attempt * 5}s)\r`);
  }

  throw new Error('[2Captcha Timeout] Waktu penyelesaian CAPTCHA melebihi 150 detik.');
}

/**
 * Menyelesaikan reCAPTCHA v2 menggunakan CapSolver
 * @param {string} apiKey - CapSolver API Key
 * @param {string} sitekey - Google reCAPTCHA Sitekey
 * @param {string} pageUrl - URL halaman target
 * @returns {Promise<string>} Token g-recaptcha-response
 */
async function solveWithCapSolver(apiKey, sitekey, pageUrl) {
  console.log('[CapSolver] Mengirim task ReCaptchaV2TaskProxyLess...');
  const createRes = await fetch('https://api.capsolver.com/createTask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientKey: apiKey,
      task: {
        type: 'ReCaptchaV2TaskProxyLess',
        websiteURL: pageUrl,
        websiteKey: sitekey
      }
    })
  });

  const createData = await createRes.json();
  if (createData.errorId !== 0) {
    throw new Error(`[CapSolver Error] ${createData.errorDescription || createData.errorCode}`);
  }

  const taskId = createData.taskId;
  console.log(`[CapSolver] Task ID: ${taskId}. Menunggu hasil solver...`);

  const maxAttempts = 30;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 4000));

    const pollRes = await fetch('https://api.capsolver.com/getTaskResult', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientKey: apiKey, taskId })
    });

    const pollData = await pollRes.json();
    if (pollData.errorId !== 0) {
      throw new Error(`[CapSolver Error] ${pollData.errorDescription || pollData.errorCode}`);
    }

    if (pollData.status === 'ready') {
      console.log(`[CapSolver] ✅ CAPTCHA berhasil diselesaikan dalam ${attempt * 4} detik!`);
      return pollData.solution.gRecaptchaResponse;
    }

    process.stdout.write(`[CapSolver] Menunggu hasil... (${attempt * 4}s)\r`);
  }

  throw new Error('[CapSolver Timeout] Waktu penyelesaian CAPTCHA melebihi 120 detik.');
}

/**
 * Menemukan provider aktif dan menyelesaikan reCAPTCHA
 * @param {Object} options
 * @param {string} options.sitekey
 * @param {string} options.pageUrl
 * @returns {Promise<{ success: boolean, token?: string, error?: string, provider?: string }>}
 */
export async function solveRecaptcha({ sitekey, pageUrl }) {
  const twoCaptchaKey = process.env.TWO_CAPTCHA_API_KEY || process.env.CAPTCHA_API_KEY;
  const capsolverKey = process.env.CAPSOLVER_API_KEY;

  if (twoCaptchaKey) {
    try {
      const token = await solveWith2Captcha(twoCaptchaKey, sitekey, pageUrl);
      return { success: true, token, provider: '2Captcha' };
    } catch (err) {
      return { success: false, error: err.message, provider: '2Captcha' };
    }
  }

  if (capsolverKey) {
    try {
      const token = await solveWithCapSolver(capsolverKey, sitekey, pageUrl);
      return { success: true, token, provider: 'CapSolver' };
    } catch (err) {
      return { success: false, error: err.message, provider: 'CapSolver' };
    }
  }

  return {
    success: false,
    error: 'API Key untuk 2Captcha atau CapSolver belum dikonfigurasi di file .env'
  };
}

/**
 * Menginjeksi token reCAPTCHA ke DOM halaman web Playwright
 * @param {import('playwright').Page} page
 * @param {string} token
 */
export async function injectRecaptchaToken(page, token) {
  console.log('[CaptchaInjector] Menginjeksi token reCAPTCHA ke halaman form...');
  await page.evaluate((responseToken) => {
    // 1. Set ke elemen textarea atau input g-recaptcha-response
    const elements = document.querySelectorAll('[name="g-recaptcha-response"], #g-recaptcha-response');
    elements.forEach((el) => {
      el.value = responseToken;
      el.innerHTML = responseToken;
      el.style.display = 'block'; // memastikan input visible untuk validasi form
    });

    // 2. Eksekusi callback Google reCAPTCHA jika ada di objek internal
    if (window.___grecaptcha_cfg && window.___grecaptcha_cfg.clients) {
      Object.values(window.___grecaptcha_cfg.clients).forEach((client) => {
        if (!client) return;
        for (const key of Object.keys(client)) {
          const val = client[key];
          if (val && typeof val.callback === 'function') {
            try {
              val.callback(responseToken);
            } catch (e) {
              console.warn('Callback error:', e);
            }
          }
        }
      });
    }
  }, token);
  console.log('[CaptchaInjector] Token berhasil diinjeksi!');
}
