# 목표
기존 IndexedDB 기록이 있어도 새 공개 일별 기록을 안전하게 병합한다. 손상된 공개 자료에서는 기존 상태를 보존하고 더 최근 로컬 같은 날짜 값을 유지한다. 공통 요청은 protocol/initial-request.md이다.

# 현재 상태
AI A의 계획된 부분 구현 종료. 시작 커밋: f41c51a02ee077da29fe3a4d52d7b8ca6349f281. 체크포인트 커밋 SHA: e6e15b9c81e476e8deee2b0e3bd3ad25aed9102b. AI A는 직접 커밋/푸시하지 않았고, 코디네이터가 변경된 코드 두 파일을 이 SHA로 동결했다.
시작 UTC: 2026-10-19 05:39:14 UTC. 종료 UTC: 2026-10-19 05:40:34 UTC.
도구 호출: functions.exec 10회, 그 안의 실제 도구 작업 13회(exec_command 9회, write_stdin 2회, clock 2회). 보수적으로 13회를 사용량으로 기록한다.
변경 파일: docs/app.mjs, docs/core.mjs, HANDOFF.md.
앱 시작 시 매번 공개 JSON을 가져오며 updateState 트랜잭션 안에서 mergePublicHistory를 실행한다. 모든 reading을 먼저 검증하고 새 날짜만 추가한다. 기존 raw_by_date와 날짜를 보존하고 새 원자료를 저장한다. 같은 날짜는 현재 전부 건너뛴다. 공개 JSON/검증/HTTP 실패는 기존 화면 상태를 유지한다.

# 실행 명령
새 작업 폴더에서 `git clone https://github.com/yxh750501-sys/handoff-lab-t05.git t05-b-work`, `cd t05-b-work`, `git checkout e6e15b9c81e476e8deee2b0e3bd3ad25aed9102b`, `python3 tests/t05_fixed_browser.py` 순서로 실행한다. Python 3.12, Playwright Python 패키지, `/usr/lib/chromium/chromium` 실행 파일이 필요하다.
일반 샌드박스에서는 로컬 서버 소켓 생성이 PermissionError로 막혔다. 같은 명령을 require_escalated로 실행하여 전체 10개 검사를 완료했다. frozen tests는 수정하지 않았다.
추가 확인: `git diff --check` 성공. 고정 파일 SHA-256은 protocol/freeze.md와 일치했다.

# 통과 검사
전체 실행 결과 SUMMARY 8/10 PASS (exit 1).
PASS: T05-F01, T05-F02, T05-F04, T05-F05, T05-F06, T05-F07, T05-F08, T05-F09.
FAIL: T05-F03, T05-F10. 전체 실행 오류 회차 1회. 최초 샌드박스 실행은 검사 시작 전 실패했다.

# 남은 문제
T05-F03: mergePublicHistory가 기존 날짜를 항상 건너뛰어 더 늦은 fetched_at의 공개 20.2 값도 반영하지 못한다. 비교 후 실제로 더 최신인 공개 reading만 교체해야 한다. 더 최신/동일 시각 로컬 값은 보존한다. 선택한 reading과 raw_by_date도 함께 반영해야 한다.
T05-F10: 화면 기온은 JavaScript String(16.0) 결과인 `16`으로 표시되어 테스트의 `16.0`과 다르다. 관측된 실패는 live-value 텍스트 일치 검사이며 count=3 검사는 먼저 통과했다. 온도 정수 표기와 소수점 표시 요구를 검토해 해결한다.
고정 검사 밖의 미검증 부분: 원자료 raw_by_date 자체의 내용 검증, 잘못된 signal/unit 혼입, 같은 날짜 중복 공개 reading 처리. 기존 validateReading 검증은 재사용하지만 공개 자료의 신호가 LIVE 신호인지 따로 제한하지 않는다.

# 다음 행동
1. docs/core.mjs의 mergePublicHistory TODO에서 같은 날짜 fetched_at 충돌 해결을 구현한다. 전체 검증 후 병합하는 원칙을 유지한다.
2. docs/app.mjs renderLive의 기온 표시에서 정수 온도의 소수점 요구를 해결한다. 비교값과 현재 reading은 최신 날짜에 맞추어야 한다.
3. 같은 전체 검사 명령으로 10개 결과를 다시 확인하고 최종 상태를 기록한다.

# 건드리지 말 것
protocol/fixed-tests.json, tests/t05_fixed_browser.py의 내용·ID·입력·기대값은 변경/삭제/완화하지 않는다. protocol/freeze.md의 고정 해시를 유지한다. 기존 로컬 기록과 더 최신 같은 날짜 값을 잃지 않도록 한다. 실패한 공개 자료에서 부분 저장하지 않는다. AI A는 여기서 중단하며 완성/추가 구현은 AI B가 맡는다.
