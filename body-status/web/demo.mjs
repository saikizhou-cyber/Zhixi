import { recordKey } from './core.mjs';

export function demoData(now = Date.now()) {
  const records = [];
  const source = '演示 Apple Watch';
  const add = (type, value, start, end = start, unit = '') => {
    const r = { type, value, start: +start, end: +end, unit, source };
    if (r.end <= now) records.push({ ...r, id: recordKey(r) });
  };
  for (let offset = 29; offset >= 0; offset--) {
    const date = new Date(now);
    date.setDate(date.getDate() - offset);
    date.setHours(8, 10, 0, 0);
    const wave = Math.sin(offset * 0.7);
    for (let hour = 0; hour < 4; hour++) {
      const sample = new Date(date);
      sample.setHours(8 + hour * 3);
      add('hrv', Math.round((46 + wave * 12 + hour * 2) * 10) / 10, sample, sample, 'ms');
      add('heartRate', Math.round(69 - wave * 8 + hour), sample, sample, 'bpm');
    }
    add('restingHeartRate', Math.round(58 - wave * 4), date, date, 'bpm');
    add('respiratoryRate', Math.round((14 + wave) * 10) / 10, date, date, 'breaths/min');
    add('oxygenSaturation', 97 + Math.round(Math.abs(wave)), date, date, '%');
    const activityEnd = new Date(date);
    activityEnd.setHours(20, 0, 0, 0);
    if (offset === 0) activityEnd.setTime(now - 120000);
    const activityStart = new Date(date);
    activityStart.setHours(0, 0, 0, 0);
    if (activityEnd > activityStart) {
      add('steps', Math.round(7200 + wave * 2300), activityStart, activityEnd, 'count');
      add('activeEnergy', Math.round(360 + wave * 100), activityStart, activityEnd, 'kcal');
    }
    const bed = new Date(date);
    bed.setDate(bed.getDate() - 1);
    bed.setHours(23, 12, 0, 0);
    let cursor = +bed;
    const phases = [['core', 70], ['deep', 55], ['core', 60], ['rem', 35], ['awake', 12], ['core', 75], ['deep', 30], ['rem', 45], ['core', 35 + Math.round(wave * 20)]];
    for (const [stage, minutes] of phases) {
      add('sleep', stage, cursor, cursor + minutes * 60000);
      cursor += minutes * 60000;
    }
    if (offset % 3 === 0) {
      const start = new Date(date); start.setHours(17, 0, 0, 0);
      add('workout', 'HKWorkoutActivityTypeWalking', start, +start + 25 * 60000);
    }
  }
  add('hrv', 49.6, now - 6 * 60000, now - 6 * 60000, 'ms');
  add('heartRate', 68, now - 3 * 60000, now - 3 * 60000, 'bpm');
  return { records, journal: [
    { id: 'demo-mood', kind: 'mood', value: 4, note: '午后散步，感觉轻松了一些。', at: now - 3600000 },
    { id: 'demo-water', kind: 'water', value: 300, note: '', at: now - 7200000 },
    { id: 'demo-caffeine', kind: 'caffeine', value: 80, note: '一杯咖啡', at: now - 10800000 },
  ] };
}
