import { recordKey, relativeLevel, calendarPeriod } from './core.mjs';
import { recordGrade, dailyOverview } from './model.mjs';

const labels = {
  overview: ['知息', '从今日总结开始，了解身体的日常变化。'],
  trends: ['趋势', '按指标、来源和时间范围查看记录。'],
  sleep: ['睡眠观察', '查看睡眠总时长、分期和历史记录。'],
  journal: ['记录', '记录心情、饮水、咖啡因与身体感受。'],
  entry: ['新增记录', '记录此刻的感受。'],
  breathe: ['呼吸片刻', '进行一分钟的呼吸练习。'],
  data: ['我的', '你的健康数据，由你自己保管。'],
  recovery: ['恢复观察', '一起回看身体指标与个人历史。'],
  activity: ['活动与训练', '回顾已记录的活动和体能训练。'],
  review: ['生活回顾', '把感受与身体记录放在一起。'],
};
const english = { overview: 'ZHIXI', trends: 'TRENDS', sleep: 'SLEEP', journal: 'JOURNAL', entry: 'NEW ENTRY', breathe: 'BREATHE', data: 'MY DATA', recovery: 'RECOVERY', activity: 'ACTIVITY', review: 'DAILY REVIEW' };
const metrics = {
  hrv: ['HRV · SDNN', 'ms'], heartRate: ['心率', '次/分'], restingHeartRate: ['静息心率', '次/分'],
  steps: ['步数', '步'], activeEnergy: ['活动能量', 'kcal'], respiratoryRate: ['呼吸频率', '次/分'], oxygenSaturation: ['血氧饱和度', '%'],
};
const paths = {
  back: '<path d="M19 12H5m7-7-7 7 7 7"/>',
  plus: '<path d="M12 4v16M4 12h16"/>',
  profile: '<circle cx="12" cy="7" r="4"/><path d="M4 21v-3a8 8 0 0 1 16 0v3"/>',
  overview: '<rect x="3" y="3" width="7" height="7" rx="0"/><rect x="14" y="3" width="7" height="7" rx="0"/><rect x="3" y="14" width="7" height="7" rx="0"/><rect x="14" y="14" width="7" height="7" rx="0"/>',
  trends: '<path d="M3 19h18M4 14l5-5 5 3 6-8"/><path d="M15 4h5v5"/>',
  sleep: '<path d="M20.5 14.1A9 9 0 0 1 9.9 3.5 9 9 0 1 0 20.5 14.1Z"/>',
  journal: '<rect x="5" y="3" width="15" height="18" rx="0"/><path d="M9 7h7M9 11h7M9 15h4M3 7h4M3 12h4M3 17h4"/>',
  breathe: '<path d="M3 9h12a3 3 0 1 0-3-3M3 13h16a2 2 0 1 1-2 2M3 17h6a2 2 0 1 1-2 2"/>',
  data: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/>',
  download: '<path d="M12 3v13m-5-5 5 5 5-5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/><path d="M4 12h4l2-4 3 8 2-4h5"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  spark: '<path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4Z"/>',
  steps: '<path d="M9 3c-2 0-4 4-4 7 0 2 1 3 3 3s3-2 3-4-1-6-2-6ZM16 10c2 0 4 4 4 7 0 2-1 3-3 3s-3-2-3-4 1-6 2-6Z"/><path d="M6 16v2a2 2 0 0 0 4 0v-2M15 22h4"/>',
  energy: '<path d="m13 2-9 12h7l-1 8 10-13h-7Z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  attention: '<path d="M4 4h16v16H4zM12 8v5m0 3v1"/>',
};
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const icon = (name, extra = '') => `<svg class="icon ${extra}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">${paths[name] || paths.spark}</svg>`;
const number = (value, digits = 0) => Number.isFinite(value) ? value.toLocaleString('zh-CN', { maximumFractionDigits: digits }) : '—';
const date = (at, full = false) => Number.isFinite(at) ? new Intl.DateTimeFormat('zh-CN', full ? { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' } : { month: 'numeric', day: 'numeric' }).format(at) : '尚无记录';
const duration = minutes => Number.isFinite(minutes) ? `${Math.floor(Math.round(minutes) / 60)}<small>小时</small> ${Math.round(minutes) % 60}<small>分</small>` : '—';
const localInputDate = at => { const d = new Date(at); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const button = (action, text, className = 'button primary', extra = '') => `<button class="${className} ef-btn ${className.split(' ').includes('primary') ? 'go' : ''}" data-action="${action}" ${extra}>${text}</button>`;
const sourceTime = record => record ? `<span class="source-name">${esc(record.source)}</span><span>${esc(date(record.end, true))}</span>` : '<span>尚无可用记录</span>';
const dayInput = at => localInputDate(at).slice(0, 10);
const clockTime = at => Number.isFinite(at) ? new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(at) : '—';
function selectedDay(series, at, key = 'value') {
  return series.find(p => p.at === at) || [...series].reverse().find(p => Number.isFinite(p[key])) || series.at(-1);
}
function dateControls(state, scope, selected) {
  const w = state.window || calendarPeriod(state.period, state.periodAnchor, state.now);
  const id = scope === 'trends' ? 'trend' : scope, unit = { day: '日', week: '周', month: '月' }[w.period];
  const caption = w.period === 'day' ? '按小时查看 · 缺失时段留白' : w.period === 'week'
    ? `${date(w.start)} — ${date(w.end - 1)} · 周一至周日` : `${new Date(w.start).getFullYear()} 年 ${new Date(w.start).getMonth() + 1} 月 · 按日查看`;
  return `<div class="period-picker"><div class="date-controls" aria-label="选择日期">${button('period-step', icon('back'), 'icon-button', `id="${id}-previous" data-direction="previous" aria-label="上一${unit}"${w.previous < 0 ? ' disabled' : ''}`)}<label><span class="sr-only">查看日期</span><input type="date" id="${id}-date" aria-label="查看日期" value="${dayInput(selected?.at ?? state.periodAnchor ?? w.through)}" min="1970-01-01" max="${dayInput(state.now)}"></label>${button('period-step', icon('arrow'), 'icon-button', `id="${id}-next" data-direction="next" aria-label="下一${unit}"${w.next === null ? ' disabled' : ''}`)}</div><div class="period-caption"><span>${scope === 'trends' || w.period !== 'day' ? esc(caption) : '所选日期 · 查看完整记录'}${w.isCurrent && w.period !== 'day' ? ' · 更新至今天' : ''}</span>${!w.isCurrent ? button('period-today', `回到本${unit}`, 'text-button') : ''}</div></div>`;
}
function dateStrip(scope, series, selected, key = 'value') {
  return `<div class="date-strip" aria-label="按日查看">${series.map(p => `<button class="day-choice" id="${scope}-day-${p.at}" data-action="day-select" data-scope="${scope}" data-day="${p.at}" aria-pressed="${p.at === selected?.at}" aria-label="${dayInput(p.at)}，${Number.isFinite(p[key]) && (key !== 'count' || p[key] > 0) ? '有记录' : '暂无记录'}"><span>${esc(date(p.at))}</span><i class="${Number.isFinite(p[key]) && (key !== 'count' || p[key] > 0) ? 'has-data' : ''}" aria-hidden="true"></i></button>`).join('')}</div>`;
}
const sectionHead = (eyebrow, title, right = '') => `<div class="section-head"><div><p class="eyebrow">// ${eyebrow}</p><h2>${title}</h2></div>${right}</div>`;
const pill = (text, cls = '') => `<span class="pill ${cls}">${text}</span>`;

const relativeNames = { below: '低于个人范围', usual: '个人常见范围', above: '高于个人范围', noData: '暂无数据', building: '积累基线中', stale: '历史记录', partial: '窗口未结束' };
function relativeGrade(state, type, value, source, { stale = false, partial = false, band } = {}) {
  band ??= state.bands?.get(JSON.stringify([type, source]));
  let key = relativeLevel(value, band, { stale });
  if (partial && Number.isFinite(value) && !stale) key = 'partial';
  const unit = type === 'sleep' ? '分' : metrics[type]?.[1] || '';
  const hint = key === 'partial' ? '当前窗口尚未结束，暂不与完整日作高低比较。'
    : key === 'noData' ? '缺失不补零，有记录后再分级。'
    : key === 'stale' ? '仅代表记录当时，不分为当前高低状态。'
    : key === 'building' ? `同来源历史 ${band?.days ?? 0} / 7 天，积累后再比较。`
    : `当前参考范围 ${number(band.lower, 1)}–${number(band.upper, 1)} ${unit}；近 28 天同来源，不是医学正常范围。`;
  return { type, key, label: relativeNames[key], hint, rank: { below: 0, usual: 1, above: 2 }[key] };
}

function gradeTone(g) {
  if (['noData', 'building', 'stale', 'partial'].includes(g.key)) return { tone: 'unknown', title: { noData: '等一份记录', building: '慢慢了解自己', stale: '等更新后再看', partial: '这段时间还在继续' }[g.key], message: { noData: '没有数据时，我们先留白。', building: '每个有数据的日子，都能让个人比较更有依据。', stale: '有更新的记录后，再了解最近的变化。', partial: '给这段时间留点余地，结束后再完整回看。' }[g.key] };
  if (g.key === 'mood') return g.mood >= 4
    ? { tone: 'positive', title: '留住舒服的这一刻', message: '把让你舒服的小事也记下来，留给以后的自己。' }
    : g.mood <= 2 ? { tone: 'care', title: '今天，温柔一点对自己', message: '可以先停一小会儿，写下此刻需要什么。低落不需要被打分责备。' }
    : { tone: 'neutral', title: '如实记录，就很好', message: '不用强迫自己开心，平常和介于两档之间的感受都可以留下。' };
  if (g.kind === 'water') return { tone: 'neutral', title: '按自己的需要来', message: '记录量不是目标，不用为了更高一档而多喝。' };
  if (g.kind === 'caffeine') return g.key === 'high'
    ? { tone: 'care', title: '留意一下累计记录', message: '可以核对数值和单位；这一档不等于过量，也不代表个人安全上限。' }
    : { tone: 'neutral', title: '让记录帮你了解习惯', message: '这是摄入记录，不是好坏评分；也可以记下时间和感受。' };
  if (g.kind === 'workout') return ['low', 'mid'].includes(g.key)
    ? { tone: 'positive', title: '每一次行动，都有记录', message: '短一点或长一点都可以被看见，按自己的节奏回顾。' }
    : { tone: 'neutral', title: '给节奏留一点余地', message: '时长更长不代表效果更好，回顾时也看看身体感受。' };
  if (g.key === 'usual') return { tone: 'positive', title: '平稳的一刻', message: '这项接近自己的日常范围。也听听此刻身体的感受。' };
  const needsCare = g.key === 'below' && ['hrv', 'sleep', 'oxygenSaturation'].includes(g.type)
    || g.key === 'above' && g.type === 'restingHeartRate'
    || ['below', 'above'].includes(g.key) && ['heartRate', 'respiratoryRate'].includes(g.type);
  if (needsCare) return { tone: 'care', title: g.type === 'sleep' || g.type === 'hrv' ? '给自己多一点关照' : '温和地留意这次变化', message: g.type === 'sleep' ? '记录到的睡眠比平时短。可以核对是否漏记，再回顾昨晚的休息。' : '这次和日常有些不同。先核对测量条件，再结合近期变化与身体感受回看。' };
  return { tone: 'neutral', title: '变化值得回看', message: '高一点或低一点并不直接等于好或坏，先把这次变化记下来。' };
}

function gradeArt(g) {
  const tone = gradeTone(g).tone;
  if (g.key === 'mood') {
    const bend = 37 + (g.mood - 3) * 7;
    return `<svg class="grade-art mood-art" data-tone="${tone}" viewBox="0 0 96 64" aria-hidden="true"><path class="companion-ground" d="M20 58h56"/><rect class="companion-body" x="25" y="12" width="46" height="40"/><path class="companion-face" d="M34 25h5m18 0h5M34 37Q48 ${bend} 62 37"/><path class="companion-arm" d="${tone === 'positive' ? 'M25 35 13 25m58 10 12-10' : tone === 'care' ? 'M25 37h-6v9m52-9h6v9' : 'M25 36H15m56 0h10'}"/>${tone === 'positive' ? '<path class="companion-accent" d="m13 10 2-5 2 5m63 4 2-5 2 5"/>' : ''}</svg>`;
  }
  if (tone === 'unknown') {
    const content = g.key === 'stale' ? '<path class="grade-stroke" d="M24 12h48v40H24zM48 22v13l12 6"/>' : g.key === 'partial' || g.key === 'building' ? '<path class="grade-dashed" d="M16 14h64v36H16z"/><path class="grade-stroke" d="M28 39h10m5 0h10m5 0h10"/>' : '<path class="grade-dashed" d="M22 12h52v40H22z"/><path class="grade-stroke" d="m35 42 26-20"/>';
    return `<svg class="grade-art" data-tone="unknown" viewBox="0 0 96 64" aria-hidden="true">${content}</svg>`;
  }
  const bodyY = tone === 'care' ? 24 : 15;
  const face = tone === 'positive' ? 'M34 27h5m18 0h5M36 38q12 12 24 0' : tone === 'care' ? 'M33 34h8m14 0h8M41 43h14' : 'M34 27h5m18 0h5M40 39h16';
  const arms = tone === 'positive' ? 'M25 34 12 24m59 10 13-10' : tone === 'care' ? 'M25 39h-7v8m53-8h7v8' : 'M25 35H14m57 0h11';
  const bars = g.rank === undefined ? '' : [0, 1, 2].map(i => `<path class="companion-detail ${i === g.rank ? 'chosen' : ''}" d="M${27 + i * 16} 59h10"/>`).join('');
  return `<svg class="grade-art" data-tone="${tone}" viewBox="0 0 96 64" aria-hidden="true"><rect class="companion-body" x="25" y="${bodyY}" width="46" height="${52-bodyY}"/><path class="companion-face" d="${face}"/><path class="companion-arm" d="${arms}"/>${tone === 'positive' ? '<path class="companion-accent" d="m13 10 2-5 2 5m65 0 2-5 2 5"/>' : tone === 'care' ? '<path class="companion-accent" d="M44 11h15m-10 5h8"/>' : ''}${bars}</svg>`;
}

function gradeBadge(g, extra = '') {
  const mark = { below: '↓', usual: '＝', above: '↑', low: '▂', mid: '▅', high: '▇', noData: '—', building: '…', stale: '◷', partial: '…', zero: '0', mood: '○' }[g.key];
  return `<span class="grade-badge ${extra}" data-level="${g.key}" data-tone="${gradeTone(g).tone}" title="${esc(g.hint)}">${g.key === 'mood' ? gradeArt(g) : `<i aria-hidden="true">${mark}</i>`}<b>${esc(g.label)}</b></span>`;
}

function gradePanel(g, caption = '', compact = false) {
  const names = g.key === 'mood' ? ['很低落', '有些低落', '平常', '比较舒畅', '很舒畅']
    : ['low', 'mid', 'high', 'zero'].includes(g.key) ? ['少 / 短', '中', '多 / 长'] : ['偏低', '常见', '偏高'];
  const ranks = g.rank === undefined ? [] : [Math.floor(g.rank), Math.ceil(g.rank)];
  const feeling = gradeTone(g);
  return `<div class="grade-panel${compact ? ' compact' : ''}" data-level="${g.key}" data-tone="${feeling.tone}">${gradeArt(g)}<div class="grade-copy">${caption ? `<span class="grade-caption">${esc(caption)}</span>` : ''}<span class="grade-feeling">${feeling.title}</span><strong>${esc(g.label)}</strong><div class="grade-scale" aria-hidden="true">${names.map((name, i) => `<span class="${ranks.includes(i) ? 'selected' : ''}">${name}</span>`).join('')}</div>${compact ? '' : `<p>${esc(g.hint)}</p><p class="grade-feedback">${feeling.message}</p>`}</div></div>`;
}

function feedbackNotice(message, tone = 'neutral', enter = false) {
  if (!message) return '';
  tone = ['success', 'error', 'neutral'].includes(tone) ? tone : 'neutral';
  const heading = { success: '操作成功', error: '需要处理', neutral: '提示' }[tone];
  return `<div class="notice feedback-notice ${enter ? 'is-new' : ''}" data-tone="${tone}" role="${tone === 'error' ? 'alert' : 'status'}"><span class="feedback-icon" aria-hidden="true">${icon(tone === 'success' ? 'check' : tone === 'error' ? 'attention' : 'clock')}</span><div><strong>${heading}</strong><p>${esc(message)}</p></div></div>`;
}

function gradeGuide() {
  return `<details class="help-details" id="grade-guide"><summary>分级图形怎么看</summary><div class="grade-key">${['below', 'usual', 'above', 'building', 'stale', 'partial'].map(key => gradeBadge({ key, label: relativeNames[key], hint: '' })).join('')}</div><p>箭头与形状表示数值位置；青绿与舒展表情给予积极反馈，暖杏与休息表情提醒温和关照。不能判断方向的变化用中性色。颜色和表情不是医学健康结论，不会把所有高值当好、低值当坏。</p><p>个人范围取今天之前 28 天、至少 7 天同来源记录的 Q25–Q75；历史点也与这套当前参考范围比较。今日步数、活动能量和中午前的睡眠窗口尚未完整，暂不分高低。</p><p>摄入量与训练时长的分档只描述已记录的量，不是摄入建议、目标或训练强度；记录量增加不自动获得更好的评价。</p></details>`;
}

function amountGuide() {
  return `<details class="help-details" id="amount-grade-guide"><summary>记录量与表情如何分档</summary><p>饮水：大于 0 且小于 500 ml / 500 至小于 1,500 ml / 1,500 ml 及以上。咖啡因：0 mg 单列；大于 0 且小于 100 mg / 100 至小于 200 mg / 200 mg 及以上。</p><p>训练时长：小于 20 分钟 / 20 至小于 60 分钟 / 60 分钟及以上。上述是界面记录量分档，不是摄入建议、达标线或运动强度。记录可能不完整，数值越大不代表越好。</p><p>心情 1–5 分对应很低落、有些低落、平常、比较舒畅、很舒畅。中位数落在两档之间时保留小数，表情与文字也显示两档之间的状态。</p></details>`;
}

export function renderEntryGrade(kind, raw) {
  if (kind === 'note') return '<p class="field-help">文字记录保留你的感受，不作数值分级。</p>';
  const value = String(raw).trim() === '' ? null : Number(raw);
  if (value !== null && (!Number.isFinite(value) || (kind === 'mood' && (!Number.isInteger(value) || value < 1 || value > 5)) || (kind === 'water' && (value <= 0 || value > 10000)) || (kind === 'caffeine' && (value < 0 || value > 2000)))) return '<p class="field-help">请按上方说明填写有效数值，再显示分级。</p>';
  const grade = recordGrade(kind, value);
  return `${gradePanel(grade, '本条记录预览', true)}<p class="entry-reassurance" data-tone="${gradeTone(grade).tone}">${esc(gradeTone(grade).message)}</p>`;
}

function nav(view) {
  const tabs = { overview: ['状态', 'STATUS'], trends: ['趋势', 'TRENDS'], journal: ['记录', 'JOURNAL'], data: ['我的', 'MINE'] };
  const active = { sleep: 'overview', breathe: 'overview', recovery: 'overview', activity: 'overview', entry: 'journal', review: 'journal' }[view] || view;
  return `<nav class="mobile-nav" aria-label="主导航"><span class="nav-marker" aria-hidden="true" style="--nav-index:${Object.keys(tabs).indexOf(active)}"></span>${Object.entries(tabs).map(([key, [label, en]]) => `<button data-action="navigate" data-view="${key}" aria-label="${label}" class="nav-item ${active === key ? 'active' : ''}"${active === key ? ' aria-current="page"' : ''}>${icon(key === 'data' ? 'profile' : key)}<span class="nav-copy"><b>${label}</b><small>${en}</small></span></button>`).join('')}</nav>`;
}
function importPanel(state) {
  if (state.importStatus) return `<section class="import-panel" aria-live="polite"><div class="inline-spread"><h2>${icon('upload')} 正在整理健康数据</h2>${button('import-cancel', '取消', 'button small ghost')}</div><p>${esc(state.importStatus.message)}</p><progress max="100" value="${Math.max(0, Math.min(100, Number(state.importStatus.percent) || 0))}"></progress><small>文件在当前设备上解析，不会上传。</small></section>`;
  if (!state.importPreview) return '';
  const { stats, warnings = [], journal = [] } = state.importPreview;
  return `<section class="import-panel" aria-labelledby="import-title"><div class="inline-spread"><h2 id="import-title">${icon('check')} 数据已准备好</h2>${pill('尚未保存', 'amber')}</div><div class="import-numbers"><span><b>${number(stats.accepted)}</b> ${state.native ? '条文件内健康记录（不导入）' : '条健康记录'}</span><span><b>${number(stats.duplicates)}</b> 条文件内重复</span><span><b>${number(stats.skipped)}</b> 条已跳过</span><span><b>${journal.length}</b> 条日常记录</span></div><p class="muted">来源：${esc(stats.sources?.join('、') || '未识别')}。${state.native ? '确认后只合并日常记录；健康指标始终由 Apple 健康读取。' : '确认后与本机记录合并，相同健康记录只保留一份。'}</p>${warnings.length ? `<ul class="warning-list">${warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}<div class="actions">${button('import-confirm', '确认导入')}${button('import-cancel', '取消', 'button secondary')}</div></section>`;
}

function healthReadTime(state) {
  if (state.mode === 'demo') return '演示数据 / 非实时';
  if (state.native) return state.native.isLoading || state.nativeBusy ? '正在读取 Apple 健康…'
    : state.native.lastLoadedAt ? `上次读取 ${date(state.native.lastLoadedAt, true)}` : '尚未读取到健康数据';
  return state.lastImport ? `上次导入 ${date(state.lastImport, true)}` : '尚未导入健康数据';
}

function healthButton(state, action, label, className = 'button primary') {
  const pending = state.nativeBusy || state.native.isLoading;
  return button(action, pending ? '正在读取…' : label, className, `${pending || state.native.available === false ? 'disabled ' : ''}aria-busy="${!!pending}"`);
}

function healthConnection(state) {
  const n = state.native;
  if (state.mode === 'demo') return `<section class="welcome-card"><div class="welcome-copy"><h2>正在体验演示</h2><p>演示数值与 Apple 健康分开。返回个人数据后，可查看健康读取设置。</p>${button('demo-exit', '返回个人数据', 'button secondary')}</div></section>`;
  const title = n.available === false ? '此设备暂不可用' : !n.accessRequested ? '连接 Apple 健康' : state.records.length ? '由 Apple 健康读取' : '还没有读到可用记录';
  const message = n.available === false ? '请在支持 Apple 健康的 iPhone 上使用。'
    : !n.accessRequested ? '选择允许读取的指标，知息将在本机分析你的身体变化。'
    : state.records.length ? '打开 App 时自动更新；有新记录时也会申请后台更新。'
    : '可能尚无记录、手表尚未同步，或未允许读取。可以检查读取范围和健康权限。';
  return `<section class="welcome-card" aria-labelledby="health-connection-title"><div class="welcome-copy"><h2 id="health-connection-title">${title}</h2><p>${message}</p><div class="actions">${healthButton(state, n.accessRequested ? 'health-refresh' : 'health-connect', n.accessRequested ? '刷新健康数据' : '连接 Apple 健康')}${n.accessRequested ? healthButton(state, 'health-connect', '检查读取范围', 'button secondary') : button('demo-start', '先体验演示', 'button secondary')}</div>${n.accessRequested ? `<div class="actions">${button('health-settings', '打开 App 设置', 'text-button')}</div>` : ''}<p class="small">Apple Watch 的记录先同步到 iPhone「健康」，无需另装手表 App。知息尝试读取最近 90 天；实际可读历史取决于你的授权。</p><span class="welcome-note">仅只读 / 本机分析 / 非连续实时监测</span></div></section>`;
}

function emptyState(state) {
  if (state.native) return healthConnection(state);
  return `<section class="welcome-card"><div class="welcome-copy"><h2>开始了解自己的身体</h2><p>导入 Apple 健康文件后，这里会显示你的身体数据。</p><div class="actions">${button('import-open', `${icon('upload')} 导入健康数据`)}${button('demo-start', '先体验演示', 'button secondary')}</div><span class="welcome-note">本地处理 / 无需账号</span></div></section>`;
}

function hrvHistory(state) {
  const source = state.analysis.hrv.source;
  const samples = state.records.filter(r => r.type === 'hrv' && r.source === source && Number.isFinite(r.value) && r.value > 0 && Number.isFinite(r.start) && Number.isFinite(r.end) && r.end >= r.start && r.end <= state.now).sort((a, b) => a.end - b.end || a.start - b.start || (recordKey(a) < recordKey(b) ? -1 : recordKey(a) > recordKey(b) ? 1 : 0)).slice(-24);
  if (!samples.length) return '<div class="hrv-history hrv-empty"><p class="eyebrow">// HRV SAMPLES</p><p>有记录后，这里将展示最近的 HRV 测量。</p></div>';
  const maximum = Math.max(...samples.map(r => r.value));
  const x = i => 8 + i * 264 / Math.max(1, samples.length - 1);
  const y = value => 112 - value / maximum * 100;
  const grades = samples.map(r => relativeGrade(state, 'hrv', r.value, r.source));
  return `<div class="hrv-history"><div class="spark-caption"><span class="eyebrow">// HRV SAMPLES</span><span>${samples.length} 次测量</span></div><svg class="hrv-spark" viewBox="0 0 288 140" role="img" aria-label="最近 ${samples.length} 次 HRV 测量，按采样顺序排列，单位毫秒"><line x1="4" x2="284" y1="112" y2="112" class="chart-grid"/><line x1="4" x2="284" y1="62" y2="62" class="chart-grid"/>${samples.map((r, i) => `<rect class="sample-bar${i === samples.length - 1 ? ' latest' : ''}" data-level="${grades[i].key}" data-tone="${gradeTone(grades[i]).tone}" x="${x(i)}" y="${y(r.value)}" width="6" height="${112-y(r.value)}"><title>${esc(date(r.end, true))} / ${number(r.value, 1)} ms</title></rect>`).join('')}<text x="4" y="135">0 ms</text><text x="284" y="135" text-anchor="end">${number(maximum, 1)} ms</text></svg><div class="spark-meta"><span>${esc(date(samples[0].end))} — ${esc(date(samples.at(-1).end))}</span><span>按采样顺序</span></div>${chartTable(samples.map(r => ({ day: date(r.end, true), value: r.value })), 'ms', '查看测量数值', '相对当前个人范围', 'hrv-values', grades)}</div>`;
}

function signalCard(state) {
  const h = state.analysis.hrv;
  const g = relativeGrade(state, 'hrv', h.current?.value, h.source, { stale: h.level === 'stale' });
  const feeling = gradeTone(g);
  const headline = { noData: '等待第一份数据', building: '正在建立个人基线', stale: '最近记录已过时', below: '低于个人常见范围', usual: '落在个人常见范围', above: '高于个人常见范围' }[g.key];
  return `<section class="signal-card" data-grade="${g.key}"><div class="signal-top"><span class="eyebrow">// HRV · SDNN / 心率变异性</span>${pill(g.key === 'stale' ? '历史样本' : '最近测量')}</div><div class="signal-hero" data-tone="${feeling.tone}"><div><h2>${headline}</h2><div class="signal-reading"><strong>${number(h.current?.value, 1)}</strong><span>ms</span></div></div>${gradeArt(g)}</div><p class="signal-feeling" data-tone="${feeling.tone}">${feeling.title}</p><div class="signal-bottom"><div><span>个人常见范围</span><b>${h.lower !== null && h.upper !== null ? `${number(h.lower, 1)} – ${number(h.upper, 1)} <small>ms</small>` : '积累数据中'}</b></div><div><span>基线覆盖</span><b>${h.days}<small> / 28 天</small></b></div></div><div class="signal-source-small">${sourceTime(h.current)}</div>${g.key === 'below' ? `<p class="small">和日常有些不同，先给自己一点关照。</p>` : g.key === 'stale' ? '<p class="small">超过 30 分钟，仅代表测量当时。有更新记录后再看。</p>' : ''}</section>`;
}

function metricCard(title, value, unit, record, symbol, metric = '', grade) {
  const view = symbol === 'sleep' ? 'sleep' : 'trends';
  return `<button class="metric-card" data-grade="${grade.key}" data-action="navigate" data-view="${view}"${metric ? ` data-metric="${metric}"` : ''} aria-label="查看${esc(title)}详情"><span class="metric-heading"><span>${title}</span>${icon(symbol)}</span><span class="metric-value">${value}<small>${unit}</small></span>${gradeBadge(grade)}<span class="metric-source">${record ? esc(date(record.end, true)) : '尚无可用记录'}</span>${icon('arrow', 'metric-arrow')}</button>`;
}

function seriesGrade(state, metric, item) {
  if (state.view === 'trends' && state.period === 'day' && Number.isFinite(item.value)) return { type: metric, key: 'partial', label: '小时记录', hint: '小时值不与完整日基线比较；切换周或月查看每日分级。' };
  const today = new Date(item.at).toDateString() === new Date(state.now).toDateString();
  const partial = today && (['steps', 'activeEnergy'].includes(metric) || metric === 'sleep' && new Date(state.now).getHours() < 12);
  return relativeGrade(state, metric, metric === 'sleep' ? item.minutes : item.value, item.source, { partial });
}

function chartPoint(g, x, y, label) {
  const attr = `class="chart-point chart-dot" data-level="${g.key}" data-tone="${gradeTone(g).tone}"`;
  const title = `<title>${esc(label)} / ${esc(g.label)}</title>`;
  if (g.key === 'below') return `<path ${attr} d="M${x - 4.5} ${y - 3}h9l-4.5 8z">${title}</path>`;
  if (g.key === 'above') return `<path ${attr} d="M${x - 4.5} ${y + 3}h9l-4.5-8z">${title}</path>`;
  if (g.key === 'usual') return `<rect ${attr} x="${x - 3.5}" y="${y - 3.5}" width="7" height="7">${title}</rect>`;
  return `<circle ${attr} cx="${x}" cy="${y}" r="3.5">${title}</circle>`;
}

function lineChart(series, metric = 'hrv', state) {
  const [title, unit] = metrics[metric] || metrics.hrv;
  const valid = series.filter(p => Number.isFinite(p.value));
  const hourly = state.period === 'day', unitName = hourly ? '小时' : '天';
  if (!valid.length) return `<div class="chart-empty">${icon('trends')}<h3>暂无可用记录</h3><p>这段时间还没有可用的${title}记录。<br>有更多历史数据后，变化会出现在这里。</p></div>`;
  const values = valid.map(p => p.value);
  const sources = new Set(valid.map(p => p.source));
  const band = sources.size === 1 ? state.bands?.get(JSON.stringify([metric, valid[0].source])) : null;
  const showBand = state.period !== 'day' && band?.days >= 7 && Number.isFinite(band.lower) && Number.isFinite(band.upper);
  const bounds = showBand ? [...values, band.lower, band.upper] : values;
  const rawMin = Math.min(...bounds), rawMax = Math.max(...bounds);
  const padding = Math.max((rawMax - rawMin) * .2, rawMax * .05, 1);
  const min = Math.max(0, rawMin - padding), max = rawMax + padding;
  const w = 340, h = 210, left = 38, right = 12, top = 15, bottom = 32;
  const x = i => left + i * (w - left - right) / Math.max(1, series.length - 1);
  const y = v => top + (max - v) / (max - min) * (h - top - bottom);
  const segments = [];
  let points = [];
  series.forEach((p, i) => { if (Number.isFinite(p.value)) points.push(`${x(i)},${y(p.value)}`); else if (points.length) { segments.push(points); points = []; } });
  if (points.length) segments.push(points);
  const tickIndices = [...new Set([0, Math.round((series.length - 1) / 3), Math.round(2 * (series.length - 1) / 3), series.length - 1])];
  const grades = series.map(p => seriesGrade(state, metric, p));
  const chosen = selectedDay(series, state.trendDay), chosenIndex = series.findIndex(p => p.at === chosen?.at);
  return `<div class="chart-wrap"><svg class="line-chart" data-chart-select viewBox="0 0 ${w} ${h}" role="img" aria-label="${title}趋势，${valid.length} ${unitName}有数据，${series.length - valid.length} ${unitName}无数据。缺失时段不连线。点按选择时段，也可使用下方滑块。">${showBand ? `<rect class="chart-range-band" x="${left}" y="${y(band.upper)}" width="${w-left-right}" height="${Math.max(1, y(band.lower)-y(band.upper))}"/>` : ''}${[0, .5, 1].map(t => { const v = min + (max - min) * t; return `<line class="chart-grid" x1="${left}" x2="${w - right}" y1="${y(v)}" y2="${y(v)}"/><text x="${left - 10}" y="${y(v) + 4}" text-anchor="end">${number(v)}</text>`; }).join('')}${segments.map(seg => `<polyline class="chart-line" points="${seg.join(' ')}"/>`).join('')}${chosenIndex >= 0 ? `<line class="chart-cursor" x1="${x(chosenIndex)}" x2="${x(chosenIndex)}" y1="${top}" y2="${h-bottom}"/>` : ''}${series.map((p, i) => Number.isFinite(p.value) ? chartPoint(grades[i], x(i), y(p.value), `${p.day}：${number(p.value, 1)} ${unit}`) : '').join('')}${tickIndices.map(i => `<text x="${x(i)}" y="${h - 6}" text-anchor="${i === 0 ? 'start' : i === series.length - 1 ? 'end' : 'middle'}">${esc(hourly ? series[i].day : date(series[i].at))}</text>`).join('')}</svg></div><label class="chart-inspector">${hourly ? '滑动查看时段' : '滑动查看日期'}<input type="range" id="trend-position" min="0" max="${series.length-1}" step="1" value="${Math.max(0, chosenIndex)}" aria-label="趋势${hourly ? '时段' : '日期'}" aria-valuetext="${chosen ? esc(hourly ? chosen.day : date(chosen.at)) : ''}"></label><p class="footnote chart-grade-legend">${hourly ? '小时值仅展示记录，不套用每日基线。' : '▼ 偏低 / ■ 常见 / ▲ 偏高 / ○ 待比较'}${showBand ? `<br>浅色带：个人常见范围 ${number(band.lower, 1)}–${number(band.upper, 1)} ${unit}` : ''}</p>${chartTable(series, unit, hourly ? '查看每小时数值' : '查看每日数值', hourly ? '按小时汇总，不与每日基线比较' : '含个人范围分级', 'daily-values', grades)}`;
}

function chartTable(series, unit, label = '查看每日数值', hint = '无数据的日期保留为空', id = 'daily-values', grades = null) {
  return `<details class="data-table" id="${esc(id)}"><summary>${esc(label)}<span>${esc(hint)}</span></summary><div class="table-scroll"><table><thead><tr><th scope="col">日期</th><th scope="col">数值 (${unit})</th>${grades ? '<th scope="col">分级</th>' : ''}</tr></thead><tbody>${series.map((p, i) => `<tr><th scope="row">${esc(p.day)}</th><td>${number(p.value, 1)}</td>${grades ? `<td>${gradeBadge(grades[i])}</td>` : ''}</tr>`).join('')}</tbody></table></div></details>`;
}

function rangeButtons(state) {
  return `<div class="segmented" aria-label="时间范围">${Object.entries({ day: '日', week: '周', month: '月' }).map(([period, label]) => `<button data-action="range" data-range="${period}" aria-pressed="${state.period === period}" class="${state.period === period ? 'selected' : ''}">${label}</button>`).join('')}</div>`;
}

function dailySummary(state) {
  const s = dailyOverview(state.recovery, { now: state.now });
  const art = s.tone === 'positive' ? { type: 'hrv', key: 'usual' } : s.tone === 'care' ? { type: 'hrv', key: 'below' }
    : s.tone === 'neutral' ? { type: 'hrv', key: 'above' } : { key: s.available ? 'building' : 'noData' };
  return `<section class="daily-summary" data-tone="${s.tone}" aria-labelledby="daily-summary-title"><div class="daily-summary-top"><span class="eyebrow">// TODAY'S OVERVIEW</span>${pill('今日状态')}</div><div class="daily-summary-hero"><div><h2 id="daily-summary-title">${s.title}</h2><p>${s.message}</p></div>${gradeArt(art)}</div><div class="daily-summary-signals">${s.signals.map(signal => {
    const g = relativeGrade(state, signal.type, signal.current ? signal.value : null, signal.source, { band: signal, partial: signal.key === 'partial' });
    const title = { hrv: 'HRV', restingHeartRate: '静息心率', sleep: '睡眠' }[signal.type];
    return `<button class="daily-summary-signal" data-action="navigate" data-view="${signal.type === 'sleep' ? 'sleep' : 'trends'}"${signal.type !== 'sleep' ? ` data-metric="${signal.type}"` : ''}><span><b>${title}</b><small>${signal.type === 'sleep' ? '最近睡眠窗口' : '今日中位数'}</small></span><strong>${signal.current ? signal.type === 'sleep' ? duration(signal.value) : `${number(signal.value, 1)}<small>${metrics[signal.type][1]}</small>` : '—'}</strong>${gradeBadge(g)}</button>`;
  }).join('')}</div><div class="daily-summary-footer"><span>今日数据 ${s.available} / ${s.total} · 可比较 ${s.comparable} / ${s.total}</span>${button('navigate', `查看依据 ${icon('arrow')}`, 'text-button', 'data-view="recovery"')}</div><p class="small">${s.lastUpdated ? `最近依据 ${esc(date(s.lastUpdated, true))} · ` : ''}按可用记录总结，非实时监测</p></section>`;
}

function overview(state) {
  const a = state.analysis;
  const heartGrade = relativeGrade(state, 'heartRate', a.latest.heartRate?.value, a.latest.heartRate?.source, { stale: state.now - a.latest.heartRate?.end > 30 * 60000 });
  const restGrade = relativeGrade(state, 'restingHeartRate', a.latest.restingHeartRate?.value, a.latest.restingHeartRate?.source, { stale: new Date(a.latest.restingHeartRate?.end).toDateString() !== new Date(state.now).toDateString() });
  const sleepGrade = relativeGrade(state, 'sleep', a.sleep.minutes, a.sleep.source, { partial: new Date(state.now).getHours() < 12 });
  const today = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' }).format(state.now);
  return `<div class="home-status-meta"><div><strong>${esc(today)}</strong><small>${esc(healthReadTime(state))}</small></div>${state.native ? state.mode === 'demo' ? button('demo-exit', '返回个人数据', 'text-button') : healthButton(state, state.native.accessRequested ? 'health-refresh' : 'health-connect', state.native.accessRequested ? '刷新数据' : '连接健康', 'text-button') : button('import-open', '更新数据', 'text-button')}</div>${state.native && !state.records.length ? emptyState(state) : ''}${dailySummary(state)}${!state.native && !state.records.length ? emptyState(state) : ''}<div class="home-actions">${button('navigate', `${icon('spark')} 恢复观察`, 'button secondary', 'data-view="recovery"')}${button('navigate', `${icon('breathe')} 呼吸片刻`, 'button secondary', 'data-view="breathe"')}${button('navigate', `${icon('plus')} 记录此刻`, 'button secondary', 'data-view="entry" data-entry-kind="mood"')}</div>
    <div class="app-section-head"><h2>身体指标</h2>${button('navigate', `全部趋势 ${icon('arrow')}`, 'text-button', 'data-view="trends"')}</div>
    <div class="metrics-grid">${metricCard('最近心率', number(a.latest.heartRate?.value), '次/分', a.latest.heartRate, 'heart', 'heartRate', heartGrade)}${metricCard('静息心率', number(a.latest.restingHeartRate?.value), '次/分', a.latest.restingHeartRate, 'heart', 'restingHeartRate', restGrade)}${metricCard('最近睡眠', duration(a.sleep.minutes), '', a.sleep.recordedEnd ? { end: a.sleep.recordedEnd, source: a.sleep.source } : null, 'sleep', '', sleepGrade)}${metricCard('今日步数', number(a.activity.steps), '步', null, 'steps', 'steps', relativeGrade(state, 'steps', a.activity.steps, null, { partial: true })).replace('尚无可用记录', a.activity.steps !== null ? '今日同来源记录累计' : '今日尚无步数记录')}</div>
    <div class="settings-group observation-links"><button class="settings-row" data-action="navigate" data-view="recovery">${icon('spark')}<span><b>恢复观察</b><small>5 项指标 · 对照自己的历史</small></span>${icon('arrow')}</button><button class="settings-row" data-action="navigate" data-view="activity">${icon('steps')}<span><b>活动与训练</b><small>运动记录 · 时长 · 心率样本</small></span>${icon('arrow')}</button></div>
    <details class="help-details" id="recent-hrv"><summary>最近 HRV 测量<span>查看样本</span></summary>${signalCard(state)}${hrvHistory(state)}</details>${gradeGuide()}<p class="home-footnote">今日总结用于回看个人变化，不是压力或健康诊断。</p>`;
}

function trendProvenance(state, metric) {
  let record = metric === 'hrv' ? state.analysis.hrv.current : state.analysis.latest[metric];
  if (metric === 'steps' || metric === 'activeEnergy') {
    const key = r => JSON.stringify([r.type, r.source, r.start, r.end, r.value, r.unit]);
    record = state.records.reduce((latest, r) => {
      if (r.type !== metric || typeof r.source !== 'string' || !r.source.trim() || typeof r.unit !== 'string'
        || !Number.isFinite(r.value) || r.value < 0 || !Number.isFinite(r.start) || !Number.isFinite(r.end)
        || r.end < r.start || r.end > state.now) return latest;
      return !latest || r.end > latest.end || (r.end === latest.end && r.start > latest.start)
        || (r.end === latest.end && r.start === latest.start && key(r) > key(latest)) ? r : latest;
    }, null);
  }
  return `<div class="trend-provenance">${icon('clock')}<div><strong>全部数据中的最近记录</strong>${sourceTime(record)}</div>${record && state.now - record.end > 30 * 60000 ? pill('历史记录 / 非实时', 'amber') : ''}</div><p class="footnote">所选时段的来源以图表上方标注为准；历史记录可能来自旧设备。</p>`;
}

function trends(state) {
  const selected = metrics[state.metric] ? state.metric : 'hrv';
  const hourly = state.period === 'day';
  const valid = state.series.filter(p => Number.isFinite(p.value));
  const day = selectedDay(state.series, state.trendDay);
  const mean = valid.length ? valid.reduce((sum, p) => sum + p.value, 0) / valid.length : null;
  const values = valid.map(p => p.value);
  const grade = day ? seriesGrade(state, selected, day) : relativeGrade(state, selected, null, null);
  return `<section class="panel trend-panel"><div class="trend-controls"><label class="field compact">观察指标<select id="metric-select">${Object.entries(metrics).map(([key, item]) => `<option value="${key}"${selected === key ? ' selected' : ''}>${item[0]}</option>`).join('')}</select></label>${rangeButtons(state)}</div>${dateControls(state, 'trends', day)}<div class="trend-focus" aria-live="polite"><div><span>${day ? esc(hourly ? day.day : date(day.at)) : ''} · ${['steps', 'activeEnergy'].includes(selected) ? '已记录合计' : hourly ? '小时中位数' : '当日中位数'}</span><strong>${number(day?.value, 1)}<small>${metrics[selected][1]}</small></strong></div>${gradeBadge(grade)}</div><p class="source-line">${esc(day?.source || (hourly ? '该时段暂无记录，不补零' : '当天暂无记录，不补零'))}</p>${lineChart(state.series, selected, state)}${hourly ? '' : gradePanel(grade, '所选日期', true)}<div class="trend-stats"><div><span>${hourly ? '有记录小时的平均值' : '有记录日的平均值'}</span><b>${number(mean, 1)} <small>${metrics[selected][1]}</small></b></div><div><span>记录范围</span><b>${values.length ? `${number(Math.min(...values), 1)}–${number(Math.max(...values), 1)}` : '—'}</b></div><div><span>${hourly ? '有数据的小时' : '有数据的天数'}</span><b>${valid.length} / ${state.series.length}</b></div></div><details class="help-details" id="trend-calculation"><summary>数据来源与统计方法</summary>${trendProvenance(state, selected)}<p class="footnote">${hourly ? (['steps', 'activeEnergy'].includes(selected) ? '仅合计完整落在该小时内的同来源活动样本，跨小时样本不分摊，小时合计可能少于日合计。' : '按单一来源计算每小时中位数，缺失小时不连线，不是连续或实时监测。') : ['steps', 'activeEnergy'].includes(selected) ? '按同一来源合计自然日内的完整样本，跨日样本不计，非完全重复的重叠区间可能高估，不保证等于 Apple 健康显示的总量。' : '按单一来源计算每日中位数，不是连续测量，也不是实时状态。'}缺失值不记为零。图中的参考带只在有效日来源一致且基线足够时显示。</p></details></section><details class="help-details" id="baseline-help"><summary>个人基线与数据来源</summary><section class="panel"><label class="field">HRV 数据来源<select id="source-select"><option value="auto"${state.source === 'auto' ? ' selected' : ''}>自动 / 最近样本的来源</option>${state.sources.map(source => `<option value="${esc(source)}"${state.source === source ? ' selected' : ''}>${esc(source)}</option>`).join('')}</select></label><p class="muted">今天之前 28 个自然日、至少 7 天的每日中位数建立参考，Q25–Q75 不是医学正常范围。</p><div class="baseline-strip"><div><span>基线中位数</span><b>${number(state.analysis.hrv.baseline, 1)} <small>ms</small></b></div><div><span>已有历史</span><b>${state.analysis.hrv.days} <small>天</small></b></div></div><p>单次偏高或偏低无法解释身体的全部变化。结合当下感受和近期记录回看。</p></section></details>${gradeGuide()}`;
}

const stageInfo = { deep: ['深睡', 'stage-deep'], core: ['核心睡眠', 'stage-core'], rem: ['快速眼动', 'stage-rem'], asleep: ['未分期睡眠', 'stage-asleep'], awake: ['清醒', 'stage-awake'] };

function recovery(state) {
  const signals = state.recovery.signals;
  const comparable = signals.filter(s => ['below', 'usual', 'above'].includes(s.level) && !(s.type === 'sleep' && new Date(state.now).getHours() < 12));
  const changed = comparable.filter(s => s.level !== 'usual').length;
  return `<section class="insight-intro"><h2>${comparable.length} 项可与个人历史比较</h2><p>${changed} 项在个人常见范围之外。点开任一项，查看依据和记录时间。</p></section><div class="recovery-list">${signals.map(s => {
    const title = s.type === 'sleep' ? '睡眠时长' : metrics[s.type][0], unit = s.type === 'sleep' ? '分' : metrics[s.type][1];
    const g = relativeGrade(state, s.type, s.value, s.source, { band: s, stale: s.level === 'stale', partial: s.type === 'sleep' && new Date(state.now).getHours() < 12 });
    return `<details class="recovery-item" id="recovery-${s.type}" data-grade="${g.key}"><summary class="recovery-summary"><span class="recovery-name"><b>${title}</b>${gradeBadge(g)}</span><span class="recovery-reading">${s.type === 'sleep' ? duration(s.value) : `${number(s.value, 1)}<small>${unit}</small>`}</span><span class="recovery-mini-art">${gradeArt(g)}</span></summary><div class="recovery-body">${gradePanel(g)}<p class="small">${s.level === 'stale' ? '最近的历史记录' : s.type === 'sleep' ? '最近一个睡眠窗口' : '今日可用样本的中位数'}</p><dl class="comparison-details"><div><dt>个人常见范围</dt><dd>${s.lower === null ? '尚未建立' : `${number(s.lower, 1)} – ${number(s.upper, 1)} ${unit}`}</dd></div><div><dt>有效历史</dt><dd>${s.days} / 28 天</dd></div></dl><p class="source-line">${s.source ? `${esc(s.source)}<br>最后记录 ${esc(date(s.recordedEnd, true))}` : '尚无可用记录'}</p>${button('navigate', `查看${s.type === 'sleep' ? '睡眠' : '趋势'} ${icon('arrow')}`, 'text-button', s.type === 'sleep' ? 'data-view="sleep"' : `data-view="trends" data-metric="${s.type}"`)}</div></details>`;
  }).join('')}</div><details class="help-details" id="recovery-method"><summary>如何理解恢复观察</summary><p>今天之前 28 天、至少 7 天同来源记录的 Q25–Q75 用于个人比较。全天可用样本的中位数不等同于夜间生命体征；睡眠单独比较完整窗口。</p><p>这里没有训练准备度、身体电量或压力综合评分。个人范围不是医学正常范围，范围内也不代表健康。</p><p>HRV 使用 Apple 健康的 SDNN，不能与 StressWatch 的 RMSSD 数值直接比较。缺失不会补零，历史样本不会被标成今天。</p></details><div class="actions">${button('navigate', '记录身体感受', 'button primary', 'data-view="entry" data-entry-kind="mood"')}${button('navigate', '呼吸片刻', 'button secondary', 'data-view="breathe"')}</div>`;
}

const workoutNames = { Walking: '步行', Running: '跑步', Cycling: '骑行', Swimming: '游泳', Hiking: '徒步', Yoga: '瑜伽', Pilates: '普拉提', TraditionalStrengthTraining: '传统力量训练', FunctionalStrengthTraining: '功能性力量训练', HighIntensityIntervalTraining: '高强度间歇训练', Dance: '舞蹈', Elliptical: '椭圆机', Rowing: '划船', Other: '其他训练' };

function activity(state) {
  const w = state.workouts;
  const max = Math.max(1, ...w.daily.map(d => d.minutes ?? 0));
  const average = w.activeDays ? w.minutes / w.activeDays : null;
  const chosen = w.daily.find(day => day.at === state.activityDay);
  const dayEnd = chosen ? new Date(new Date(chosen.at).getFullYear(), new Date(chosen.at).getMonth(), new Date(chosen.at).getDate()+1).getTime() : null;
  const items = chosen ? w.items.filter(item => item.start < dayEnd && item.end > chosen.at) : w.items;
  return `<div class="screen-controls">${rangeButtons(state)}</div>${dateControls(state, 'activity', chosen)}<section class="panel"><p class="eyebrow">// RECORDED WORKOUTS</p><div class="summary-grid"><div><span>训练记录</span><strong>${w.count}<small>条</small></strong></div><div><span>合并后时长</span><strong>${number(w.minutes)}<small>分</small></strong></div><div><span>有记录日</span><strong>${w.activeDays}<small>天</small></strong></div></div>${gradePanel(recordGrade('workout', average), `有训练记录日均 / ${number(average, 1)} 分`, true)}<p class="source-line">${w.source ? esc(w.source) : '这段时间暂无训练记录'}</p><div class="activity-bars" aria-label="点选日期查看训练">${w.daily.map(d => `<button class="activity-bar-slot" tabindex="-1" data-action="day-select" data-scope="activity" data-day="${d.at}" aria-pressed="${d.at === chosen?.at}" data-level="${recordGrade('workout', d.minutes).key}" aria-label="${esc(date(d.at))}：${d.minutes === null ? '无记录' : `${number(d.minutes)} 分钟`}">${d.minutes === null ? '' : `<i style="height:${Math.max(3, d.minutes / max * 100)}%"></i>`}</button>`).join('')}</div><div class="chart-labels"><span>${esc(date(w.daily[0].at))}</span><span>${esc(date(w.daily.at(-1).at))}</span></div>${chartTable(w.daily.map(d => ({ ...d, value: d.minutes })), '分', '查看每日训练时长', '含已记录时长分档', 'workout-days', w.daily.map(d => recordGrade('workout', d.minutes)))}</section>
    <div class="quick-actions">${button('navigate', `${icon('steps')}<span><b>步数趋势</b><small>查看日常活动</small></span>${icon('arrow')}`, 'quick-action', 'data-view="trends" data-metric="steps"')}${button('navigate', `${icon('energy')}<span><b>活动能量</b><small>查看 kcal 记录</small></span>${icon('arrow')}`, 'quick-action', 'data-view="trends" data-metric="activeEnergy"')}</div>
    <div class="app-section-head"><h2>${chosen ? `${esc(date(chosen.at))} 的训练` : '训练明细'}</h2>${button('day-select', '全部日期', 'text-button', `data-scope="activity" data-day="all" aria-pressed="${!chosen}"`)}</div>${dateStrip('activity',w.daily,chosen,'minutes')}${chosen ? `<p class="activity-day-summary">当天记录 ${number(chosen.minutes)} 分钟；跨日训练详情保留完整时长。无记录不等于没有活动。</p>` : ''}${items.length ? items.map(item => {
      const grade = recordGrade('workout', item.duration);
      return `<details class="workout-detail" data-grade="${grade.key}" id="workout-${esc(encodeURIComponent(recordKey(item)))}"><summary><span><b>${esc(workoutNames[item.value.replace(/^HKWorkoutActivityType/, '')] || item.value.replace(/^HKWorkoutActivityType/, ''))}</b><small>${esc(date(item.end, true))}</small>${gradeBadge(grade)}</span><strong>${number(item.duration)}<small> 分</small></strong></summary><div class="workout-body">${gradePanel(grade, '本次训练时长')}<p>${esc(date(item.start, true))} — ${esc(date(item.end, true))}</p><p class="source-line">${esc(item.source)}</p><div class="summary-grid"><div><span>心率样本</span><strong>${item.heartRate.count}<small>条</small></strong></div><div><span>样本中位数</span><strong>${number(item.heartRate.median)}<small>bpm</small></strong></div><div><span>样本范围</span><strong class="compact-value">${item.heartRate.count ? `${number(item.heartRate.min)}–${number(item.heartRate.max)}` : '—'}</strong></div></div><p class="footnote">仅使用同来源、时间完整落在本次训练内的心率样本。采样可能稀疏，不代表连续心率，也不推算心率区间时长。</p></div></details>`;
    }).join('') : '<div class="journal-empty"><h3>训练会出现在这里</h3><p>有可用的体能训练记录后，回顾每一次活动。</p></div>'}${amountGuide()}<details class="help-details" id="workout-method"><summary>训练统计说明</summary><p>选择本时段最新训练的单一来源，只计入在时段内开始且已完成的训练。完全重复记录去重，重叠训练合并计时，跨日训练按本地日期拆分。</p><p>训练条数仍按去重后的记录计数，可能包含重叠记录；未记录不等于没有运动。不计算未经校准的训练负荷、热量或身体年龄。</p></details>`;
}


function review(state) {
  const r = state.journalReport, day = r.daily.find(d => d.at === state.reviewDay) || r.daily.at(-1);
  const waterDays = r.daily.filter(d => d.water !== null).length, caffeineDays = r.daily.filter(d => d.caffeine !== null).length;
  const hrv = state.reviewHrv.find(item => item.at === day?.at) ?? { at: day?.at, value: null, source: null };
  const sleep = state.reviewSleep.find(item => item.at === day?.at) ?? { at: day?.at, minutes: null, source: null };
  const entries = state.journal.filter(row => day && Number.isFinite(row.at) && row.at <= state.now && dayInput(row.at) === dayInput(day.at)).sort((a,b) => b.at-a.at);
  const kindLabels = { mood: '心情', water: '饮水', caffeine: '咖啡因', note: '随手记' };
  return `<div class="screen-controls">${rangeButtons(state)}</div>${dateControls(state, 'review', day)}<section class="insight-intro"><h2>${r.recordedDays} 天留下了生活记录</h2><p>选一天，把身体数据与当天发生的事放在一起回看。</p></section><div class="trend-stats"><div><span>记录覆盖</span><b>${r.recordedDays} / ${r.daily.length} 天</b></div><div><span>饮水记录日均</span><b>${number(waterDays ? r.water/waterDays : null)} ml</b><small>${waterDays} 个记录日</small></div><div><span>咖啡因记录日均</span><b>${number(caffeineDays ? r.caffeine/caffeineDays : null)} mg</b><small>${caffeineDays} 个记录日</small></div></div>${dateStrip('review',r.daily,day,'count')}${day ? `<article class="review-day"><div class="inline-spread"><h2>${esc(date(day.at))}</h2><span class="small">${day.count ? `${day.count} 条生活记录` : '未记录生活感受'}</span></div><dl><div><dt>心情中位数</dt><dd>${number(day.mood,1)} <small>/ 5</small>${gradeBadge(recordGrade('mood',day.mood))}</dd></div><div><dt>饮水记录</dt><dd>${number(day.water)} <small>ml</small>${gradeBadge(recordGrade('water',day.water))}</dd></div><div><dt>咖啡因记录</dt><dd>${number(day.caffeine)} <small>mg</small>${gradeBadge(recordGrade('caffeine',day.caffeine))}</dd></div><div><dt>HRV · SDNN</dt><dd>${number(hrv.value,1)} <small>ms</small>${gradeBadge(seriesGrade(state,'hrv',hrv))}</dd></div><div><dt>睡眠窗口时长</dt><dd>${duration(sleep.minutes)}${gradeBadge(seriesGrade(state,'sleep',sleep))}</dd></div></dl><p class="source-line">HRV：${esc(hrv.source || '暂无记录')} · 睡眠：${esc(sleep.source || '暂无记录')}</p><div class="review-events"><h3>这一天的记录</h3>${entries.length ? entries.map(row => `<div class="review-event"><time>${clockTime(row.at)}</time><div><b>${kindLabels[row.kind]}</b><p>${esc(row.value)}${row.kind === 'water' ? ' ml' : row.kind === 'caffeine' ? ' mg' : row.kind === 'mood' ? ' / 5' : ''}</p>${row.note ? `<p>${esc(row.note)}</p>` : ''}</div></div>`).join('') : '<p class="small">这一天还没有生活记录。留白也可以。</p>'}</div></article>` : ''}<p class="footnote">同时出现不代表因果。未记录显示 —；主动记录的 0 mg 保留为零。</p>${amountGuide()}${gradeGuide()}<details class="help-details" id="review-method"><summary>记录与观察口径</summary><p>饮水、咖啡因只累计知息手动记录，不代表全天实际摄入量。日均仅除以有该项记录的日期数，缺失日不记零；期间心情为每日中位数的中位数，不是心理量表。</p><p>HRV 为同来源每日中位数；睡眠以当天中午命名窗口，每天独立选择单一来源。身体数据缺失不插值，日期按当前浏览器时区划分。</p></details>`;
}
function stageBar(stages, minutes, cls = '') {
  const total = Object.keys(stageInfo).reduce((sum, key) => sum + (stages?.[key] || 0), 0);
  if (minutes === null || !total) return '<div class="sleep-bar empty" aria-label="没有可展示的睡眠区间"></div>';
  return `<div class="sleep-bar ${cls}" role="img" aria-label="${Object.entries(stageInfo).map(([key, [name]]) => `${name} ${number(stages[key] || 0)} 分钟`).join('，')}">${Object.entries(stageInfo).map(([key, [name, color]]) => `<span class="${color}" style="width:${Math.max(0, (stages[key] || 0) / total * 100)}%" title="${name} ${number(stages[key] || 0)} 分钟"></span>`).join('')}</div>`;
}


function sleepTimeline(s) {
  const segments = s.segments || [];
  if (!segments.length) return '<div class="chart-empty"><p>当天暂无可展示的睡眠分期记录。</p></div>';
  const start = segments[0].start, end = segments.at(-1).end, width = 340, left = 64, right = 10;
  const order = ['awake', 'rem', 'core', 'deep', 'asleep'];
  const x = at => left + (at - start) / Math.max(1, end - start) * (width-left-right);
  return `<div class="sleep-timeline"><svg viewBox="0 0 340 164" role="img" aria-label="睡眠分期时间轴，按记录时刻排列，空白表示未记录">${order.map((stage, index) => `<text class="sleep-timeline-label" x="2" y="${20+index*25}">${stageInfo[stage][0]}</text><line class="chart-grid" x1="${left}" x2="330" y1="${16+index*25}" y2="${16+index*25}"/>`).join('')}${segments.map(segment => `<rect class="sleep-segment ${stageInfo[segment.stage][1]}" x="${x(segment.start)}" y="${7+order.indexOf(segment.stage)*25}" width="${Math.max(.5,x(segment.end)-x(segment.start))}" height="18"><title>${stageInfo[segment.stage][0]} ${clockTime(segment.start)}–${clockTime(segment.end)}</title></rect>`).join('')}<text class="sleep-timeline-label" x="${left}" y="155">${clockTime(start)}</text><text class="sleep-timeline-label" x="330" y="155" text-anchor="end">${clockTime(end)}</text></svg><p class="footnote">按记录时刻排列；空白表示没有记录，不推断为清醒。</p></div>`;
}
function sleep(state) {
  const chosen = selectedDay(state.sleeps, state.sleepDay, 'minutes');
  const s = chosen || state.analysis.sleep;
  const g = chosen ? seriesGrade(state, 'sleep', chosen) : relativeGrade(state, 'sleep', s.minutes, s.source, { partial: new Date(state.now).getHours() < 12 });
  return `<div class="screen-controls">${rangeButtons(state)}</div>${dateControls(state, 'sleep', chosen)}<section class="panel sleep-summary" data-grade="${g.key}"><div class="inline-spread"><h2>${chosen ? esc(date(chosen.at)) : '最近一个窗口'} · 睡眠</h2>${gradeBadge(g)}</div><div class="sleep-total">${duration(s.minutes)}</div><div class="sleep-times"><div><span>记录开始</span><b>${clockTime(s.recordedStart)}</b><small>${Number.isFinite(s.recordedStart) ? esc(date(s.recordedStart)) : '暂无记录'}</small></div><div><span>记录结束</span><b>${clockTime(s.recordedEnd)}</b><small>${Number.isFinite(s.recordedEnd) ? esc(date(s.recordedEnd)) : '暂无记录'}</small></div></div>${sleepTimeline(s)}${gradePanel(g, '', true)}<details class="help-details" id="sleep-stages"><summary>各阶段时长与占比</summary>${stageBar(s.stages, s.minutes, 'large')}<div class="stage-legend">${Object.entries(stageInfo).map(([key, [name,color]]) => `<span><i class="${color}"></i>${name}<b>${s.minutes === null ? '—' : number(s.stages[key] || 0)} 分</b></span>`).join('')}</div><p class="footnote">占比条不是时刻时间轴；清醒单独显示，不计入睡眠总时长。</p></details><p class="source-line">${esc(s.source || '此窗口暂无睡眠记录；不代表没有睡眠。')}</p></section><details class="help-details" id="sleep-calculation"><summary>睡眠统计说明</summary><p>统计窗口 ${esc(date(s.window?.start, true))} — ${esc(date(s.window?.end, true))}。以每日中午分界；尚未到中午时只统计到当前时刻。</p><p>“记录开始/结束”来自导入的睡眠或清醒区间，不能确定实际入睡和起床时刻。合并同来源重叠区间，清醒覆盖冲突睡眠；卧床不当作睡眠，空缺不填补。</p><p>未记录的分期不另作推断，也不计算睡眠质量分数。</p></details><section class="panel">${sectionHead('SLEEP HISTORY', '睡眠历史')}<div class="sleep-history">${[...state.sleeps].reverse().map(item => { const grade = seriesGrade(state, 'sleep', item); return `<button class="sleep-row" data-grade="${grade.key}" data-action="day-select" data-scope="sleep" data-day="${item.at}" aria-pressed="${item.at === chosen?.at}"><time>${esc(date(item.at))}</time>${stageBar(item.stages,item.minutes)}<strong>${item.minutes === null ? '暂无记录' : `${Math.floor(Math.round(item.minutes)/60)}时${Math.round(item.minutes)%60}分`}</strong><span class="sleep-grade">${gradeBadge(grade)}</span></button>`; }).join('')}</div><p class="footnote">点选日期查看该日分期；历史行条带表示阶段占比。</p></section>${gradeGuide()}`;
}

function journal(state) {
  const kindLabels = { mood: '心情', water: '饮水', caffeine: '咖啡因', note: '随手记' };
  const valueLabel = row => row.kind === 'mood' ? `${esc(row.value)} / 5` : row.kind === 'water' ? `${esc(row.value)} ml` : row.kind === 'caffeine' ? `${esc(row.value)} mg` : esc(row.value);
  const today = state.journalReport.today;
  return `<section class="panel journal-today"><div class="inline-spread"><h2>今日记录</h2>${button('navigate', `生活回顾 ${icon('arrow')}`, 'text-button', 'data-view="review"')}</div><div class="summary-grid"><div><span>记录饮水</span><strong>${number(today.water)}<small>ml</small></strong>${gradeBadge(recordGrade('water', today.water))}</div><div><span>咖啡因</span><strong>${number(today.caffeine)}<small>mg</small></strong>${gradeBadge(recordGrade('caffeine', today.caffeine))}</div><div><span>心情中位数</span><strong>${number(today.mood, 1)}<small>/5</small></strong>${gradeBadge(recordGrade('mood', today.mood))}</div></div>${gradePanel(recordGrade('mood', today.mood), '今日心情', true)}<p class="footnote">仅汇总手动记录，未记录不代表 0。</p></section>
    <div class="journal-shortcuts">${Object.entries(kindLabels).map(([kind, name]) => button('navigate', name, 'button secondary', `data-view="entry" data-entry-kind="${kind}"`)).join('')}</div><section class="journal-timeline"><div class="app-section-head"><h2>我的记录</h2><span>${state.journal.length} 条</span></div>${state.journal.length ? [...state.journal].sort((a, b) => b.at - a.at).map((row, index) => `<article class="journal-entry" data-entry-id="${esc(row.id)}" data-grade="${recordGrade(row.kind, row.value).key}"><span class="record-index">${String(index + 1).padStart(2, '0')}</span><div class="entry-body"><div class="inline-spread"><span class="entry-kind">${kindLabels[row.kind] || '记录'}</span><time>${esc(date(row.at, true))}</time></div><h3>${valueLabel(row)}</h3>${row.kind === 'note' ? '' : gradeBadge(recordGrade(row.kind, row.value))}${row.note ? `<p>${esc(row.note)}</p>` : ''}</div><div class="journal-entry-actions">${button('journal-edit', '更正', 'text-button', `data-id="${esc(row.id)}" aria-label="更正${esc(kindLabels[row.kind] || '记录')}，${esc(date(row.at, true))}"`)}<button class="icon-button ef-btn danger" data-action="journal-delete" data-id="${esc(row.id)}" aria-label="删除${esc(kindLabels[row.kind] || '记录')}，${esc(date(row.at, true))}">${icon('trash')}</button></div></article>`).join('') : '<div class="journal-empty">'+icon('journal')+'<h3>记下今天的感受</h3><p>心情、饮水与日常感受会按时间保存在这里。</p></div>'}</section>${amountGuide()}<p class="home-footnote">${state.mode === 'demo' ? '演示记录仅用于本次体验。' : '记录保存在本机，可在“我的”导出备份。'}</p>`;
}


export function renderEntryOptions(kind, raw) {
  if (kind === 'mood') return `<div class="entry-options" aria-label="选择心情">${[1, 2, 3, 4, 5].map(value => { const grade = recordGrade('mood', value); return `<button type="button" class="mood-option" data-action="entry-value" data-value="${value}" data-tone="${gradeTone(grade).tone}" aria-pressed="${String(raw) === String(value)}" aria-label="${grade.label}，${value} 分">${gradeArt(grade)}<span>${grade.label}</span></button>`; }).join('')}</div>`;
  if (kind === 'water') return `<div class="amount-options" aria-label="快捷填入饮水量">${[150, 250, 350, 500].map(value => `<button type="button" class="button secondary" data-action="entry-value" data-value="${value}" aria-pressed="${String(raw) === String(value)}">${value} ml</button>`).join('')}</div><p class="field-help">按实际饮用量填写，快捷量可以修改。</p>`;
  return `<p class="field-help">${kind === 'caffeine' ? '按包装或可靠来源填写 mg；不同咖啡的含量差异较大，不用杯数猜测。' : '记录发生了什么，也可以只写一小句话。'}</p>`;
}
function entry(state) {
  const draft = state.entryDraft || {}, kind = ['mood', 'water', 'caffeine', 'note'].includes(draft.kind) ? draft.kind : 'mood';
  const names = { mood: '心情', water: '饮水', caffeine: '咖啡因', note: '随手记' };
  return `<section class="panel journal-editor"><form id="journal-form" class="ef-form"><div class="entry-kinds" aria-label="记录类型">${Object.entries(names).map(([key, label]) => `<button type="button" class="button secondary" data-action="entry-kind" data-kind="${key}" aria-pressed="${key === kind}">${label}</button>`).join('')}</div><label class="sr-only" for="entry-kind">记录类型</label><select class="sr-only" id="entry-kind" name="kind" tabindex="-1">${Object.entries(names).map(([key,label]) => `<option value="${key}"${key === kind ? ' selected' : ''}>${label}</option>`).join('')}</select><div id="entry-options">${renderEntryOptions(kind, draft.value)}</div><label class="field" for="entry-value"><span id="entry-value-label">${names[kind]}</span><input id="entry-value" name="value" type="text" inputmode="${kind === 'note' ? 'text' : 'decimal'}" maxlength="2000" value="${esc(draft.value || '')}" required aria-describedby="journal-help"></label><p id="journal-help" class="field-help">心情 1–5 整数；饮水 ml；咖啡因 mg。</p><div id="entry-grade" aria-live="polite">${renderEntryGrade(kind, draft.value || '')}</div><details class="help-details" id="entry-more"><summary>时间与补充感受<span>可选修改</span></summary><label class="field" for="entry-at">发生时间<input id="entry-at" name="at" type="datetime-local" value="${esc(draft.at || localInputDate(state.now))}" required></label><label class="field" for="entry-note">补充感受 <span class="optional">选填</span><textarea id="entry-note" name="note" rows="2" maxlength="2000" placeholder="今天发生了什么？身体感觉如何？">${esc(draft.note || '')}</textarea></label></details><button class="button primary full-width ef-btn go entry-submit" type="submit"><span class="submit-label">${state.editingId ? '保存更正' : '保存记录'}</span> ${icon('check')}</button></form><p class="footnote">${state.mode === 'demo' ? '演示模式下的记录只用于本次体验，退出后不会保存。' : '草稿在本次页面打开期间保留；刷新后丢弃。保存后可导出备份。'}</p></section>`;
}
function breathe(state) {
  const completed = !state.breathing.running && state.breathing.elapsed >= 60;
  return `<section class="breathing-room"><p class="eyebrow">// BREATHING EXERCISE</p><h2>一分钟呼吸练习</h2><p class="breathing-intro">自然吸气 4 秒，缓缓呼气 6 秒。<br>以舒适为准，无需屏息或刻意深呼吸。</p><div class="breath-stage"><div id="breath-orb" class="breath-orb" data-phase="${completed ? 'complete' : state.breathing.running ? 'inhale' : 'ready'}"><span id="breath-phase">${completed ? '练习完成' : '准备好了吗'}</span><strong id="breath-count">60</strong><small>秒 / ${completed ? '已完成' : '留给自己'}</small></div></div><div class="breath-controls"><progress id="breath-progress" max="60" value="${Math.min(60, Math.max(0, state.breathing.elapsed || 0))}" aria-label="呼吸练习进度"></progress>${state.breathing.running ? button('breathe-stop', '结束本次练习', 'button secondary') : button('breathe-start', `开始 1 分钟 ${icon('arrow')}`, 'button primary large')}<p id="breath-message" class="small muted" aria-live="polite">${state.breathing.running ? '按自己的节奏呼吸，随时可以结束。' : '不记录分数，只给自己一个安静的片刻。'}</p></div>${completed ? `<div class="actions">${button('navigate', '记录现在的感受', 'button secondary', 'data-view="entry" data-entry-kind="mood"')}</div>` : ''}<div class="breath-footnotes"><span>${icon('clock')} 6 次舒缓呼吸</span><span>${icon('data')} 无需健康数据</span></div><p class="footnote">切换页面或离开 App 时练习会停止。如有不适，请恢复自然呼吸。</p></section>`;
}

function data(state) {
  const native = !!state.native;
  const typeCounts = {};
  state.records.forEach(r => { typeCounts[r.type] = (typeCounts[r.type] || 0) + 1; });
  const coverageTypes = [...Object.keys(metrics), 'sleep', 'workout'];
  const latestByType = new Map();
  for (const row of state.records) if (Number.isFinite(row.end) && row.end <= state.now && (!latestByType.has(row.type) || row.end > latestByType.get(row.type).end)) latestByType.set(row.type, row);
  const coverage = `<section class="coverage-panel"><div class="app-section-head"><h2>数据覆盖</h2><span>${coverageTypes.filter(type => typeCounts[type]).length} / ${coverageTypes.length} 类</span></div><p class="small">${state.mode === 'demo' ? '演示数据，仅用于体验。' : native ? esc(healthReadTime(state)) : state.lastImport ? `上次导入 ${esc(date(state.lastImport,true))}` : '尚未导入；不会自动从 Apple Watch 同步。'}${native && state.mode !== 'demo' ? ' · 读取时间不等于测量时间' : ''}</p><div class="coverage-list">${coverageTypes.map(type => { const last = latestByType.get(type); return `<button class="coverage-link" data-action="navigate" data-view="${type === 'sleep' ? 'sleep' : type === 'workout' ? 'activity' : 'trends'}"${metrics[type] ? ` data-metric="${type}"` : ''}><span><b>${metrics[type]?.[0] || (type === 'sleep' ? '睡眠' : '体能训练')}</b><small>${last ? `最近 ${esc(date(last.end,true))}` : '暂无已发生的记录'}</small></span><span>${number(typeCounts[type] || 0)} 条 ${icon('arrow')}</span></button>`; }).join('')}</div><p class="footnote">有记录不等于完整或实时。HRV 同来源基线已覆盖 ${state.analysis.hrv.days} 天；少于 7 天暂不比较。</p></section>`;
  return `<section class="profile-summary"><img src="./icon.svg" width="44" height="44" alt=""><div><h2>我的健康数据</h2><p>${state.mode === 'demo' ? '演示体验 / 非个人数据' : native ? 'Apple 健康只读 / 本机分析' : '本机保存 / 无需账号'}</p></div><div class="profile-counts"><span><b>${number(state.records.length)}</b>健康记录</span><span><b>${state.journal.length}</b>日常记录</span></div></section>
    ${native ? healthConnection(state) : ''}<div class="settings-group"><button class="settings-row" data-action="import-open">${icon('upload')}<span><b>${native ? '导入日常记录备份' : '导入健康数据'}</b><small>${native ? '知息 JSON · 仅合并日常记录' : 'Apple 健康 ZIP / XML / 知息 JSON'}</small></span>${icon('arrow')}</button><button class="settings-row" data-action="export">${icon('download')}<span><b>${native ? '导出当前数据' : '导出完整备份'}</b><small>${native ? '当前健康快照与日常记录' : '健康数据与日常记录'}</small></span>${icon('arrow')}</button><button class="settings-row theme-toggle" data-action="theme-toggle" aria-label="切换深浅主题" aria-pressed="${state.theme === 'dark'}">${icon('sleep')}<span><b>深色外观</b></span><span class="theme-value">${state.theme === 'dark' ? '开启' : '关闭'}</span>${icon('arrow')}</button></div>
    ${coverage}${native ? `<details class="help-details" id="health-help"><summary>健康权限与自动更新</summary><p>你可以按指标选择读取权限，之后可在 iPhone「健康」→ 头像 → App（或 App 与服务）→「知息」中修改或撤回。系统不会向知息告知某项读取是否被拒绝，空白也可能表示暂时没有数据。</p><p>已有授权通常无需每次重新选择，但不能保证永久访问。再次点「检查读取范围」只会请求系统授权，不会自动打开已授权项目的编辑页。</p><p>读取窗口：${state.mode !== 'demo' && state.native.historyStart ? `从 ${esc(date(state.native.historyStart, true))} 起，` : ''}最近 90 天，且只读取你允许的范围。锁屏、手表同步与系统调度都可能延迟更新，知息不持续开启传感器。</p></details><details class="help-details" id="import-help"><summary>从 Web 版迁移日常记录</summary><p>先在 Web 版导出知息 JSON，再在这里导入并确认。只合并心情、饮水、咖啡因和文字记录；备份中的健康记录不导入，身体指标由 Apple 健康读取。</p></details>` : `<details class="help-details" id="import-help"><summary>如何导入 Apple 健康数据</summary><div class="import-guide"><ol class="guide-steps"><li><span>01</span><div>打开 iPhone「健康」<small>点击右上角头像，选择「导出所有健康数据」。</small></div></li><li><span>02</span><div>将导出文件保存到「文件」<small>可直接选择 export.zip，无需自行解压。</small></div></li><li><span>03</span><div>在知息中导入并确认<small>先查看预览，再合并到本机数据。</small></div></li></ol><p class="footnote">Web 版不能直接读取 Apple 健康，也不会自动从 Apple Watch 同步；显示的是最近一次导入的数据。</p></div></details>`}
    <details class="help-details" id="privacy-help"><summary>数据与隐私<span>${state.storageError ? '存储不可用' : state.storageReady ? '本地已就绪' : '准备中'}</span></summary><div class="storage-card"><p>${native ? '健康原始数据只在本次运行的内存中分析，不自动写入网页数据库或上传。日常记录保存在本机。你主动导出时，文件包含当前健康快照。' : '解析、分析和保存都在当前浏览器中完成，没有健康数据上传。'}</p><dl class="storage-details"><div><dt>${native ? '上次读取' : '上次导入'}</dt><dd>${state.mode === 'demo' ? '演示模式' : native ? state.native.lastLoadedAt ? esc(date(state.native.lastLoadedAt, true)) : '尚未读取' : state.lastImport ? esc(date(state.lastImport, true)) : '尚未导入'}</dd></div><div><dt>当前模式</dt><dd>${state.mode === 'demo' ? '演示数据' : '个人数据'}</dd></div></dl><p class="local-warning">${native ? '卸载 App、清除本机数据或更换设备可能丢失日常记录，建议先导出备份。Apple 健康的原始记录不受知息内清除操作影响。' : '浏览器清理、无痕模式或更换设备可能导致本地数据丢失。建议定期导出备份。Safari 与主屏幕 Web App 可能使用独立存储。'}备份包含个人健康信息，请妥善保管。</p></div></details>
    <details class="help-details" id="metrics-help"><summary>指标与统计说明</summary>${Object.keys(typeCounts).length ? `<div class="type-counts">${Object.entries(typeCounts).map(([type, count]) => `<span>${esc(metrics[type]?.[0] || { sleep: '睡眠', workout: '体能训练' }[type] || type)} <b>${number(count)}</b></span>`).join('')}</div>` : '<p>尚无可用的健康记录。</p>'}<p class="footnote">活动统计按同一来源逐条合计，跨日样本不计；除完全重复记录外，重叠区间可能高估，不保证等于 Apple 健康显示的总量。</p><p class="footnote">知息用于日常观察，不作为医疗诊断。</p></details>
    <details class="help-details" id="management-help"><summary>演示与数据管理</summary><div class="management-row"><div><h3>体验演示</h3><p>虚构数据与个人数据分开。</p></div>${state.mode === 'demo' ? button('demo-exit', '退出演示', 'button secondary') : button('demo-start', '进入演示', 'button secondary')}</div><div class="management-row danger-row"><div><h3>${native ? '清除本机日常记录' : '清除本机数据'}</h3><p>${native ? '清除知息保存的日常记录和手动导入内容，请先备份；不会删除 Apple 健康原始记录，健康指标仍会重新读取。' : '请先备份。不会影响 Apple 健康。'}</p></div>${button('clear-data', `${icon('trash')} 清除数据`, 'button danger')}</div></details><p class="home-footnote">ZHIXI / 知息</p>`;
}

export function renderApp(state) {
  const view = labels[state.view] ? state.view : 'overview';
  const views = { overview, trends, sleep, journal, entry, breathe, data, recovery, activity, review };
  const parent = state.backView || { sleep: 'overview', breathe: 'overview', recovery: 'overview', activity: 'overview', entry: 'journal', review: 'journal' }[view];
  const title = view === 'entry' && state.editingId ? '更正记录' : labels[view][0];
  const heading = `<div class="app-title"><small>${english[view]}</small><h1 id="screen-title" tabindex="-1">${title}</h1></div>`;
  return `<div class="app-shell" data-view="${view}"><header class="topbar ef-cmdbar">${parent ? button('back', icon('back'), 'back-button', `data-view="${parent}" aria-label="返回${parent === 'overview' ? '状态' : labels[parent]?.[0] || '上一页'}"`) : ''}${view === 'overview' ? `<div class="app-brand"><img src="./icon.svg" width="30" height="30" alt="">${heading}</div>` : heading}${view === 'journal' ? button('navigate', icon('plus'), 'header-action', 'data-view="entry" data-entry-kind="mood" aria-label="新增记录"') : view === 'overview' ? button('navigate', icon('profile'), 'header-action', 'data-view="data" aria-label="打开我的数据"') : '<span class="header-status">仅存本机</span>'}</header>
    <main id="main" class="main-content" tabindex="-1" aria-labelledby="screen-title">${state.mode === 'demo' ? `<div class="demo-banner"><strong>演示</strong><span>所有数值均为虚构</span>${button('demo-exit', '退出', 'button small ghost', 'aria-label="退出演示"')}</div>` : ''}${feedbackNotice(state.storageError, 'error')}${state.native && state.mode !== 'demo' ? feedbackNotice(state.native.error || state.native.message, 'error') + feedbackNotice(state.native.backgroundMessage) : ''}${feedbackNotice(state.notice, state.noticeTone, state.noticeEnter)}${importPanel(state)}${views[view](state)}</main>${nav(view)}</div>`;
}
