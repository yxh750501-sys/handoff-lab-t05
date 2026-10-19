export const TIMEZONE = 'Asia/Seoul';
export const SIGNAL_ID = 'seoul-temperature-2m';
export const LIVE_URL = 'https://api.open-meteo.com/v1/forecast?latitude=37.5665&longitude=126.9780&current=temperature_2m&timezone=Asia%2FSeoul&forecast_days=1';
export const ERROR_CODES = ['timeout', 'auth', 'rate_limit', 'offline', 'schema_error'];

export function kstDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) throw Error('날짜가 올바르지 않습니다.');
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const fields = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

export function validateReading(value) {
  const keys = ['signal_id', 'normalized_value', 'unit', 'source_name', 'source_url', 'source_time', 'fetched_at', 'record_timezone', 'record_date'];
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      keys.length !== Object.keys(value).length || keys.some(key => !Object.hasOwn(value, key))) throw Error('읽기 형식이 변경되었습니다.');
  if (typeof value.signal_id !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/.test(value.signal_id) || value.signal_id.length > 100) throw Error('값 식별자가 올바르지 않습니다.');
  if (typeof value.normalized_value !== 'number' || !Number.isFinite(value.normalized_value)) throw Error('숫자 값이 올바르지 않습니다.');
  if (typeof value.unit !== 'string' || !value.unit.trim() || value.unit.length > 24) throw Error('단위가 올바르지 않습니다.');
  if (typeof value.source_name !== 'string' || !value.source_name.trim() || value.source_name.length > 120) throw Error('출처가 올바르지 않습니다.');
  try { if (new URL(value.source_url).protocol !== 'https:') throw Error(); } catch { throw Error('출처 URL이 올바르지 않습니다.'); }
  if (value.source_time !== null && (typeof value.source_time !== 'string' || Number.isNaN(Date.parse(value.source_time)))) throw Error('출처 시각이 올바르지 않습니다.');
  if (typeof value.fetched_at !== 'string' || Number.isNaN(Date.parse(value.fetched_at))) throw Error('조회 시각이 올바르지 않습니다.');
  if (value.record_timezone !== TIMEZONE || value.record_date !== kstDate(value.fetched_at)) throw Error('기준 시간대와 날짜가 맞지 않습니다.');
  return structuredClone(value);
}

export function normalizeLive(raw, fetchedAt = new Date().toISOString()) {
  if (!raw || typeof raw !== 'object' || raw.timezone !== TIMEZONE ||
      typeof raw.current?.temperature_2m !== 'number' || !Number.isFinite(raw.current.temperature_2m) ||
      raw.current_units?.temperature_2m !== '°C' ||
      typeof raw.current?.time !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw.current.time)) {
    throw Error('Open-Meteo 응답 형식이 변경되었습니다.');
  }
  const sourceTime = new Date(`${raw.current.time}+09:00`);
  if (Number.isNaN(sourceTime.getTime())) throw Error('원천 관측 시각을 읽을 수 없습니다.');
  return validateReading({
    signal_id: SIGNAL_ID,
    normalized_value: raw.current.temperature_2m,
    unit: '°C',
    source_name: 'Open-Meteo · 서울 2m 기온',
    source_url: LIVE_URL,
    source_time: sourceTime.toISOString(),
    fetched_at: fetchedAt,
    record_timezone: TIMEZONE,
    record_date: kstDate(fetchedAt)
  });
}

export function emptyState() {
  return { schema_version: 't04-board-v1', daily_readings: [], current_reading: null,
    status: null, last_comparison: { state: 'insufficient', direction: null, magnitude: null, unit: null }, last_run: null };
}

export function comparisonFor(rows, current) {
  const previousDate = new Date(`${current.record_date}T00:00:00.000Z`);
  previousDate.setUTCDate(previousDate.getUTCDate() - 1);
  const yesterday = previousDate.toISOString().slice(0, 10);
  const previous = rows.find(row => row.signal_id === current.signal_id && row.record_date === yesterday);
  if (!previous) return { state: 'insufficient', direction: null, magnitude: null, unit: null };
  if (previous.unit !== current.unit) return { state: 'unit_mismatch', direction: null, magnitude: null, unit: null };
  const difference = current.normalized_value - previous.normalized_value;
  return { state: 'comparable', direction: difference > 0 ? 'increase' : difference < 0 ? 'decrease' : 'unchanged',
    magnitude: Math.abs(Math.round(difference * 1000) / 1000), unit: current.unit };
}

export function applySuccess(input, reading, meta = {}) {
  const valid = validateReading(reading);
  const state = structuredClone(input);
  const existing = state.daily_readings.find(row => row.signal_id === valid.signal_id && row.record_date === valid.record_date);
  const row = { record_id: existing?.record_id ?? `${valid.signal_id}:${valid.record_date}`, signal_id: valid.signal_id,
    record_date: valid.record_date, normalized_value: valid.normalized_value, unit: valid.unit,
    first_fetched_at: existing?.first_fetched_at ?? valid.fetched_at, last_fetched_at: valid.fetched_at, reading: valid };
  state.daily_readings = state.daily_readings.filter(old => !(old.signal_id === valid.signal_id && old.record_date === valid.record_date));
  state.daily_readings.push(row);
  state.daily_readings.sort((a, b) => a.record_date.localeCompare(b.record_date));
  state.current_reading = valid;
  state.status = { freshness: 'fresh', error_code: 'none' };
  state.last_comparison = comparisonFor(state.daily_readings, row);
  state.last_run = { fixture_id: meta.fixture_id ?? null, outcome: 'success', error_code: 'none', virtual_now: meta.virtual_now ?? null };
  return state;
}

// Merge published dates while preserving a more recently fetched local reading.
export function mergePublicHistory(input, history) {
  if (!history || history.schema_version !== 't04-public-history-v1' ||
      !Array.isArray(history.readings) || history.readings.length > 2) {
    throw Error('공개 기록 형식 오류');
  }
  // Validate the entire response before producing any changes. If a publication
  // contains duplicate dates, only its newest reading for each signal/date wins.
  const validated = history.readings.map(validateReading);
  if (validated.some(reading => reading.signal_id !== SIGNAL_ID || reading.unit !== '°C')) {
    throw Error('공개 기록 신호가 올바르지 않습니다.');
  }
  for (const reading of validated) {
    const raw = history.raw_by_date?.[reading.record_date];
    if (!raw || raw.timezone !== TIMEZONE ||
        typeof raw.current?.time !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw.current.time) ||
        kstDate(`${raw.current.time}:00+09:00`) !== reading.record_date ||
        raw.current.temperature_2m !== reading.normalized_value ||
        raw.current_units?.temperature_2m !== reading.unit) {
      throw Error('공개 원자료가 기록과 일치하지 않습니다.');
    }
  }
  const byDate = new Map();
  for (const reading of validated) {
    const key = `${reading.signal_id}:${reading.record_date}`;
    const previous = byDate.get(key);
    if (!previous || Date.parse(reading.fetched_at) > Date.parse(previous.fetched_at)) byDate.set(key, reading);
  }
  const readings = [...byDate.values()];
  let state = structuredClone(input);
  state.raw_by_date = { ...state.raw_by_date };
  for (const reading of readings.sort((a, b) => a.record_date.localeCompare(b.record_date))) {
    const existing = state.daily_readings.find(row =>
      row.signal_id === reading.signal_id && row.record_date === reading.record_date);
    if (existing && Date.parse(existing.last_fetched_at) >= Date.parse(reading.fetched_at)) continue;
    const previousCurrent = state.current_reading;
    state = applySuccess(state, reading);
    state.raw_by_date[reading.record_date] = structuredClone(history.raw_by_date[reading.record_date]);
    if (previousCurrent && previousCurrent.record_date > reading.record_date) {
      state.current_reading = previousCurrent;
      state.last_comparison = comparisonFor(state.daily_readings, previousCurrent);
    }
  }
  state.last_raw = state.current_reading ? state.raw_by_date[state.current_reading.record_date] ?? null : null;
  return state;
}

export function applyError(input, errorCode, meta = {}) {
  if (!ERROR_CODES.includes(errorCode)) throw Error('알 수 없는 실패 종류입니다.');
  const state = structuredClone(input);
  state.status = { freshness: 'stale', error_code: errorCode };
  state.last_run = { fixture_id: meta.fixture_id ?? null, outcome: 'error', error_code: errorCode,
    virtual_now: meta.virtual_now ?? null, retry_after_seconds: meta.retry_after_seconds ?? null };
  return state;
}

export function runFixture(input, fixture) {
  if (!fixture || typeof fixture !== 'object' || fixture.contract_version !== '1.1.0' || !/^T04-[A-Z0-9-]+$/.test(fixture.fixture_id)) throw Error('고정 자산 형식이 올바르지 않습니다.');
  const meta = { fixture_id: fixture.fixture_id, virtual_now: fixture.virtual_now,
    retry_after_seconds: Number(fixture.transport?.headers?.['retry-after']) || null };
  if (fixture.transport?.mode === 'timeout') return applyError(input, 'timeout', meta);
  if (fixture.transport?.mode === 'offline') return applyError(input, 'offline', meta);
  if ([401, 403].includes(fixture.transport?.status)) return applyError(input, 'auth', meta);
  if (fixture.transport?.status === 429) return applyError(input, 'rate_limit', meta);
  if (fixture.transport?.status >= 200 && fixture.transport?.status < 300) {
    try { return applySuccess(input, fixture.payload, meta); }
    catch { return applyError(input, 'schema_error', meta); }
  }
  return applyError(input, 'schema_error', meta);
}

export function classifyLiveError(error) {
  if (error?.name === 'AbortError') return 'timeout';
  if (error?.status === 401 || error?.status === 403) return 'auth';
  if (error?.status === 429) return 'rate_limit';
  if (error?.name === 'TypeError') return 'offline';
  return 'schema_error';
}
