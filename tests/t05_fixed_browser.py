"""Frozen T05 browser checks. Run: python3 tests/t05_fixed_browser.py"""
from copy import deepcopy
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
import json
import sys

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
CHROMIUM = '/usr/lib/chromium/chromium'
SOURCE_URL = 'https://api.open-meteo.com/v1/forecast?latitude=37.5665&longitude=126.9780&current=temperature_2m&timezone=Asia%2FSeoul&forecast_days=1'
TIMES = {
    '2026-10-16': ('2026-10-16T16:00', '2026-10-16T07:00:00.000Z', '2026-10-16T07:03:07.005Z'),
    '2026-10-17': ('2026-10-17T01:15', '2026-10-16T16:15:00.000Z', '2026-10-16T16:27:48.811Z'),
    '2026-10-18': ('2026-10-18T01:00', '2026-10-17T16:00:00.000Z', '2026-10-17T16:05:00.000Z'),
}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT / 'docs'), **kwargs)

    def log_message(self, *args):
        pass


def reading(day, value, fetched=None):
    _, source_time, default_fetched = TIMES[day]
    return {
        'signal_id': 'seoul-temperature-2m', 'normalized_value': value, 'unit': '°C',
        'source_name': 'Open-Meteo · 서울 2m 기온', 'source_url': SOURCE_URL,
        'source_time': source_time, 'fetched_at': fetched or default_fetched,
        'record_timezone': 'Asia/Seoul', 'record_date': day,
    }


def published(*items):
    rows = [reading(day, value, fetched) for day, value, fetched in items]
    return {
        'schema_version': 't04-public-history-v1', 'source': 'Open-Meteo',
        'readings': rows,
        'raw_by_date': {
            row['record_date']: {
                'timezone': 'Asia/Seoul',
                'current': {'time': TIMES[row['record_date']][0], 'temperature_2m': row['normalized_value']},
                'current_units': {'temperature_2m': '°C'},
            } for row in rows
        },
    }


DAY1 = ('2026-10-16', 21.8, None)
DAY2 = ('2026-10-17', 14.4, None)
DAY3 = ('2026-10-18', 16.0, None)


def screen(page, count, value, delta=None, badge=None):
    expect(page.locator('#live-count')).to_have_text(f'{count}건', timeout=2500)
    expect(page.locator('#live-value')).to_have_text(str(value), timeout=2500)
    if delta is not None:
        expect(page.locator('#live-delta')).to_contain_text(delta, timeout=2500)
    if badge is not None:
        expect(page.locator('#live-badge')).to_have_text(badge, timeout=2500)


def set_public(state, value):
    state['public'] = value


def refresh(page):
    page.reload(wait_until='domcontentloaded')


def f01(page, state):
    screen(page, 2, 14.4, '−7.4 °C')


def f02(page, state):
    screen(page, 1, 21.8)
    set_public(state, published(DAY1, DAY2)); refresh(page)
    screen(page, 2, 14.4)


def f03(page, state):
    screen(page, 1, 21.8)
    updated = ('2026-10-16', 20.2, '2026-10-16T07:30:00.000Z')
    set_public(state, published(updated)); refresh(page)
    screen(page, 1, 20.2)


def f04(page, state):
    screen(page, 1, 23.1)
    set_public(state, published(DAY1)); refresh(page)
    screen(page, 1, 23.1)


def f05(page, state):
    screen(page, 1, 21.8)
    set_public(state, '{broken json'); refresh(page)
    screen(page, 1, 21.8)


def f06(page, state):
    screen(page, 1, 21.8)
    wrong = published(DAY1, DAY2)
    wrong['readings'][1]['record_timezone'] = 'UTC'
    set_public(state, wrong); refresh(page)
    screen(page, 1, 21.8)


def f07(page, state):
    screen(page, 1, 21.8)
    set_public(state, published(DAY1, DAY2)); refresh(page)
    screen(page, 2, 14.4)
    with page.expect_download(timeout=2500) as event:
        page.locator('#live-export').click()
    data = json.loads(Path(event.value.path()).read_text())
    assert [row['record_date'] for row in data['daily_readings']] == ['2026-10-16', '2026-10-17']
    assert data['raw_by_date']['2026-10-17']['current']['temperature_2m'] == 14.4


def f08(page, state):
    screen(page, 1, 21.8)
    set_public(state, published(DAY1, DAY2)); refresh(page)
    screen(page, 2, 14.4)
    set_public(state, None); refresh(page)
    screen(page, 2, 14.4)


def f09(page, state):
    screen(page, 1, 21.8)
    page.route('https://api.open-meteo.com/**', lambda route: route.abort())
    page.locator('#live-refresh').click()
    screen(page, 1, 21.8, badge='오래된 값')
    set_public(state, published(DAY1, DAY2)); refresh(page)
    screen(page, 2, 14.4, badge='최신 조회')


def f10(page, state):
    screen(page, 1, 21.8)
    set_public(state, published(DAY2, DAY3)); refresh(page)
    screen(page, 3, 16.0, '+1.6 °C')


CASES = [f01, f02, f03, f04, f05, f06, f07, f08, f09, f10]
assert len(CASES) == 10

server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
Thread(target=server.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{server.server_port}/'
results = []
try:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=CHROMIUM, headless=True,
            args=['--no-sandbox', '--disable-dev-shm-usage', '--disable-crash-reporter', '--disable-breakpad'])
        for index, case in enumerate(CASES, 1):
            context = browser.new_context(accept_downloads=True)
            page = context.new_page()
            initial = published(DAY1, DAY2) if index == 1 else (
                published(('2026-10-16', 23.1, '2026-10-16T07:40:00.000Z')) if index == 4 else published(DAY1))
            state = {'public': initial}

            def serve_public(route):
                value = state['public']
                if value is None:
                    route.fulfill(status=404, body='')
                else:
                    body = value if isinstance(value, str) else json.dumps(value)
                    route.fulfill(status=200, content_type='application/json', body=body)

            page.route('**/data/live-history.json', serve_public)
            try:
                page.goto(url, wait_until='domcontentloaded')
                case(page, state)
                results.append(True)
                print(f'T05-F{index:02} PASS', flush=True)
            except Exception as error:
                results.append(False)
                message = str(error).splitlines()[0]
                print(f'T05-F{index:02} FAIL: {message}', flush=True)
            finally:
                context.close()
        browser.close()
finally:
    server.shutdown()

print(f'SUMMARY {sum(results)}/10 PASS', flush=True)
sys.exit(0 if all(results) else 1)
