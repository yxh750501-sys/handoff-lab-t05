import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { applySuccess, emptyState, kstDate, normalizeLive, runFixture } from './docs/core.mjs';

const root = new URL('./docs/assets/studio-task-assets/t04-real-information-board/', import.meta.url);
const read = path => readFileSync(new URL(path, root));
const json = path => JSON.parse(read(path));
const manifest = json('asset-manifest.json');
assert.equal(manifest.package_id, 'aleph-t04-real-information-board-public-contract-v2');
for (const file of manifest.files) {
  const bytes = read(file.path);
  assert.equal(bytes.length, file.bytes, file.path);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, file.path);
}
console.log('PASS 공개 package ID와 17개 파일 SHA-256');

const fixture = name => json(`fixtures/${name}.json`);
function runAndCheck(state, name) {
  const item = fixture(name);
  const result = runFixture(state, item);
  assert.equal(result.status.freshness, item.expected.freshness, name);
  assert.equal(result.status.error_code, item.expected.error_code, name);
  assert.equal(result.daily_readings.length, item.expected.row_count, name);
  assert.equal(result.current_reading?.normalized_value ?? null, item.expected.stored_value, name);
  assert.equal(result.last_comparison.magnitude, item.expected.delta, name);
  return result;
}

let state = runAndCheck(emptyState(), 'normal-d1-a');
const firstId = state.daily_readings[0].record_id;
state = runAndCheck(state, 'normal-d1-b');
assert.equal(state.daily_readings[0].record_id, firstId);
state = runAndCheck(state, 'normal-d1-b');
assert.equal(state.daily_readings.length, 1);
state = runAndCheck(state, 'normal-d2');
assert.equal(state.last_comparison.direction, 'increase');
assert.equal(state.last_comparison.magnitude, 15);
console.log('PASS 같은 날짜 3회 한 행, 다음 날짜 새 행, 변화 +15');

for (const name of ['timeout', 'auth-401', 'rate-429', 'offline', 'schema-break']) {
  const baseline = runAndCheck(runAndCheck(emptyState(), 'normal-d1-a'), 'normal-d1-b');
  const failed = runAndCheck(baseline, name);
  assert.deepEqual(failed.daily_readings, baseline.daily_readings);
  assert.deepEqual(failed.current_reading, baseline.current_reading);
  console.log(`PASS ${name}: stale / ${failed.status.error_code} · 마지막 정상값 105 유지`);
}
const baseline = runAndCheck(runAndCheck(emptyState(), 'normal-d1-a'), 'normal-d1-b');
const failed = runAndCheck(baseline, 'timeout');
const recovered = runAndCheck(failed, 'recover-d2');
assert.equal(recovered.status.freshness, 'fresh');
assert.equal(recovered.daily_readings.filter(row => row.record_date === '2026-08-25').length, 1);
assert.equal(recovered.last_comparison.magnitude, 15);
console.log('PASS timeout 뒤 공개 RECOVER-D2 · fresh/none, 다음 날짜 한 건');

assert.equal(kstDate('2026-10-15T14:59:59.000Z'), '2026-10-15');
assert.equal(kstDate('2026-10-15T15:00:00.000Z'), '2026-10-16');
const live = normalizeLive({ timezone: 'Asia/Seoul', current: { time: '2026-10-16T09:00', temperature_2m: 17.4 },
  current_units: { temperature_2m: '°C' } }, '2026-10-16T00:01:00.000Z');
assert.equal(live.normalized_value, 17.4);
assert.equal(live.unit, '°C');
assert.equal(live.source_time, '2026-10-16T00:00:00.000Z');
assert.equal(live.record_date, '2026-10-16');
const stored = applySuccess(emptyState(), live);
assert.equal(stored.daily_readings[0].reading.normalized_value, 17.4);
const gapReading = { ...live, fetched_at: '2026-10-18T00:01:00.000Z', record_date: '2026-10-18' };
assert.equal(applySuccess(stored, gapReading).last_comparison.state, 'insufficient');
console.log('PASS KST 경계와 Open-Meteo 정규화·저장 값 대조');
