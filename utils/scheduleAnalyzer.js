/**
 * Schedule Analyzer — Algoritma Analisis Jam Kosong Dosen
 *
 * Menggunakan interval merging untuk mendeteksi slot waktu luang
 * di antara jadwal mengajar dalam rentang jam kerja kampus.
 */

function timeToMinutes(timeStr) {
  const [h, m] = timeStr.trim().split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(mins) {
  const h = String(Math.floor(mins / 60)).padStart(2, '0');
  const m = String(mins % 60).padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * Menganalisis jadwal satu hari dan menghitung slot waktu kosong.
 *
 * @param {Array<{startTime: string, endTime: string, subject: string, room: string, kelas: string}>} teachingSlots
 * @param {string} workStart - Jam mulai kerja kampus (default: "07:00")
 * @param {string} workEnd   - Jam akhir kerja kampus (default: "17:00")
 * @returns {{ busySlots: Array, availableSlots: Array<{start: string, end: string}> }}
 */
export function analyzeDaySchedule(teachingSlots, workStart = '07:00', workEnd = '17:00') {
  const startLimit = timeToMinutes(workStart);
  const endLimit = timeToMinutes(workEnd);

  // Urutkan jadwal mengajar berdasarkan jam mulai
  const sorted = teachingSlots
    .map((s) => ({
      start: timeToMinutes(s.startTime),
      end: timeToMinutes(s.endTime),
      subject: s.subject,
      room: s.room,
      kelas: s.kelas
    }))
    .sort((a, b) => a.start - b.start);

  // Gabungkan jadwal yang beririsan / bersebelahan (Interval Merging)
  const mergedBusy = [];
  for (const item of sorted) {
    if (!mergedBusy.length) {
      mergedBusy.push({ ...item });
      continue;
    }
    const last = mergedBusy[mergedBusy.length - 1];
    if (item.start <= last.end) {
      last.end = Math.max(last.end, item.end);
      last.subject += ` / ${item.subject}`;
    } else {
      mergedBusy.push({ ...item });
    }
  }

  // Hitung rentang waktu kosong (Free Slots)
  const availableSlots = [];
  let pointer = startLimit;

  for (const busy of mergedBusy) {
    if (busy.start > pointer) {
      availableSlots.push({
        start: minutesToTime(pointer),
        end: minutesToTime(busy.start)
      });
    }
    pointer = Math.max(pointer, busy.end);
  }

  if (pointer < endLimit) {
    availableSlots.push({
      start: minutesToTime(pointer),
      end: minutesToTime(endLimit)
    });
  }

  return {
    busySlots: teachingSlots,
    availableSlots
  };
}

/**
 * Menganalisis seluruh jadwal per hari (Senin–Sabtu).
 *
 * @param {Object<string, Array>} scheduleByDay - { "Senin": [...], "Selasa": [...], ... }
 * @param {string} workStart
 * @param {string} workEnd
 * @returns {Object<string, {busySlots: Array, availableSlots: Array}>}
 */
export function analyzeFullWeek(scheduleByDay, workStart = '07:00', workEnd = '17:00') {
  const days = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const result = {};

  for (const day of days) {
    const slots = scheduleByDay[day] || [];
    result[day] = analyzeDaySchedule(slots, workStart, workEnd);
  }

  return result;
}
