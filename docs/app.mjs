import { LIVE_URL, applyError, applySuccess, classifyLiveError, emptyState, mergePublicHistory, normalizeLive, runFixture } from './core.mjs';
import { readState, resetDemo, updateState } from './store.mjs';

const $ = id => document.getElementById(id);
const ASSET_ROOT = './assets/studio-task-assets/t04-real-information-board/fixtures/';
const ERROR_TEXT = {
  timeout: '외부 응답이 늦습니다. 잠시 후 다시 시도하세요.',
  auth: '외부 원천이 요청을 거절했습니다(401/403). 원천 상태를 확인한 뒤 다시 시도하세요.',
  rate_limit: '외부 원천의 호출 제한에 걸렸습니다(429). 잠시 기다린 뒤 다시 시도하세요.',
  offline: '네트워크 연결이 끊겼습니다. 연결을 확인한 뒤 다시 시도하세요.',
  schema_error: '외부 응답 형식이 달라 값을 읽지 못했습니다. 원천을 확인한 뒤 다시 시도하세요.'
};
let live = emptyState();
let demo = emptyState();
let busy = false;

function timeLabel(iso) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(iso)) + ' KST';
}

function setText(id, value) { $(id).textContent = String(value); }

function appendRow(parent, row) {
  const item = document.createElement('div'); item.className = 'record-row';
  const date = document.createElement('span'); date.textContent = row.record_date;
  const value = document.createElement('strong'); value.textContent = `${row.normalized_value} ${row.unit}`;
  const detail = document.createElement('span'); detail.textContent = `${row.reading.source_name} · ${timeLabel(row.reading.source_time)}`;
  item.append(date, value, detail); parent.append(item);
}

function deltaLabel(comparison) {
  if (comparison.state === 'insufficient') return '어제 기록이 있어야 표시됩니다.';
  if (comparison.state === 'unit_mismatch') return '단위가 달라 비교할 수 없습니다.';
  const sign = comparison.direction === 'increase' ? '+' : comparison.direction === 'decrease' ? '−' : '±';
  return `${sign}${comparison.magnitude} ${comparison.unit} · 저장된 전날 기록 대비`;
}

function renderLive() {
  const reading = live.current_reading;
  const stale = live.status?.freshness === 'stale';
  const badge = $('live-badge');
  badge.className = `status-badge ${stale ? 'stale' : reading ? 'fresh' : 'neutral'}`;
  badge.textContent = stale ? reading ? '오래된 값' : '조회 실패' : reading ? '최신 조회' : '조회 전';
  setText('live-value', reading?.normalized_value ?? '—');
  setText('live-unit', reading?.unit ?? '°C');
  setText('live-note', stale ? `${ERROR_TEXT[live.status.error_code]}${reading ? ' 아래 값은 마지막 정상값입니다.' : ''}` :
    reading ? `${reading.record_date} 기준 정상값입니다.` : '공개 원천에서 값을 조회해 주세요.');
  const source = $('live-source');
  source.textContent = reading?.source_name ?? 'Open-Meteo';
  source.href = reading?.source_url ?? 'https://open-meteo.com/';
  setText('live-source-time', timeLabel(reading?.source_time));
  setText('live-fetched-time', timeLabel(reading?.fetched_at));
  setText('live-delta', deltaLabel(live.last_comparison));
  setText('live-count', `${live.daily_readings.length}건`);
  $('live-export').disabled = live.daily_readings.length === 0;
  $('live-rows').replaceChildren();
  if (!live.daily_readings.length) { const p = document.createElement('p'); p.className = 'empty'; p.textContent = '아직 저장된 값이 없습니다.'; $('live-rows').append(p); }
  else for (const row of [...live.daily_readings].reverse()) appendRow($('live-rows'), row);
  setText('raw-data', live.last_raw ? JSON.stringify({ current: live.last_raw.current, current_units: live.last_raw.current_units, timezone: live.last_raw.timezone }, null, 2) : '조회 전');
  setText('stored-data', reading ? JSON.stringify(reading, null, 2) : '조회 전');
  setText('display-data', reading ? `${reading.normalized_value} ${reading.unit}\n출처: ${reading.source_name}\n관측: ${timeLabel(reading.source_time)}\n조회: ${timeLabel(reading.fetched_at)}` : '조회 전');
}

function renderDemo() {
  const reading = demo.current_reading;
  const stale = demo.status?.freshness === 'stale';
  setText('demo-value', reading?.normalized_value ?? '—');
  setText('demo-unit', reading?.unit ? ` ${reading.unit}` : ' pt');
  setText('demo-status', demo.status ? `${demo.status.freshness} / ${demo.status.error_code}` : '준비 전');
  setText('demo-count', `${demo.daily_readings.length}건`);
  const message = $('demo-message');
  message.classList.toggle('error', stale);
  message.textContent = stale ? `${ERROR_TEXT[demo.status.error_code]} 마지막 정상값 ${reading?.normalized_value ?? '—'} ${reading?.unit ?? ''}을 오래된 값으로 유지했습니다.` :
    reading ? `${demo.last_run?.fixture_id ?? '합성 재생'} · ${reading.record_date} · ${deltaLabel(demo.last_comparison)}` : '기준값을 준비한 뒤 실패를 재생해 보세요.';
  $('demo-retry').hidden = !stale;
  $('demo-rows').textContent = demo.daily_readings.map(row => `${row.record_date}: ${row.normalized_value} ${row.unit} [${row.record_id}]`).join('  ·  ');
}

async function fetchFixture(name) {
  const response = await fetch(`${ASSET_ROOT}${name}.json`, { cache: 'no-store' });
  if (!response.ok) throw Error('공개 고정 자산을 읽을 수 없습니다.');
  const fixture = await response.json();
  if (fixture.fixture_id !== `T04-${name.toUpperCase()}`) throw Error('고정 자산 ID가 맞지 않습니다.');
  return fixture;
}

async function runDemo(name) {
  if (busy) return;
  busy = true;
  try {
    const fixture = await fetchFixture(name);
    demo = await updateState('demo', state => runFixture(state, fixture));
    renderDemo();
  } catch (error) { $('demo-message').textContent = `시험 재생 실패: ${error.message}`; }
  finally { busy = false; }
}

async function prepareDemo() {
  if (busy) return;
  busy = true;
  try {
    const a = await fetchFixture('normal-d1-a');
    const b = await fetchFixture('normal-d1-b');
    demo = await updateState('demo', state => runFixture(runFixture(emptyState(), a), b));
    renderDemo();
  } catch (error) { $('demo-message').textContent = `기준값 준비 실패: ${error.message}`; }
  finally { busy = false; }
}

async function fetchLive() {
  if (busy) return;
  busy = true;
  $('live-refresh').disabled = true;
  $('live-refresh').textContent = '조회 중…';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    if (!navigator.onLine) { const error = new TypeError('offline'); throw error; }
    const response = await fetch(LIVE_URL, { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) { const error = Error(`HTTP ${response.status}`); error.status = response.status; throw error; }
    const raw = await response.json();
    const reading = normalizeLive(raw, new Date().toISOString());
    live = await updateState('live', state => { const next = applySuccess(state, reading); next.last_raw = raw;
      next.raw_by_date = { ...state.raw_by_date, [reading.record_date]: raw }; return next; });
  } catch (error) {
    const code = classifyLiveError(error);
    live = await updateState('live', state => applyError(state, code));
  } finally {
    clearTimeout(timer);
    busy = false;
    $('live-refresh').disabled = false;
    $('live-refresh').textContent = live.status?.freshness === 'stale' ? '다시 시도하기 ↗' : '지금 조회하기 ↗';
    renderLive();
  }
}

$('live-refresh').addEventListener('click', fetchLive);
$('live-export').addEventListener('click', () => {
  const content = JSON.stringify({ schema_version: 't04-live-export-v1', exported_at: new Date().toISOString(),
    signal_id: 'seoul-temperature-2m', daily_readings: live.daily_readings, raw_by_date: live.raw_by_date ?? {} }, null, 2);
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 't04-live-readings.json';
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
});
$('demo-reset').addEventListener('click', async () => { if (busy) return; demo = await resetDemo(); renderDemo(); });
$('demo-baseline').addEventListener('click', prepareDemo);
$('demo-next').addEventListener('click', () => runDemo('normal-d2'));
for (const button of document.querySelectorAll('[data-fixture]')) button.addEventListener('click', () => runDemo(button.dataset.fixture));
$('demo-retry').addEventListener('click', () => runDemo('recover-d2'));

try {
  [live, demo] = await Promise.all([readState('live'), readState('demo')]);
  try {
    const response = await fetch('./data/live-history.json', { cache: 'no-store' });
    if (response.ok) {
      const publicHistory = await response.json();
      live = await updateState('live', state => mergePublicHistory(state, publicHistory));
    }
  } catch { /* 공개 자료가 없거나 검증에 실패하면 브라우저의 기존 값을 유지합니다. */ }
  renderLive(); renderDemo();
}
catch (error) { $('live-note').textContent = `브라우저 저장소를 열 수 없습니다: ${error.message}`; }
