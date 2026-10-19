# T05 · 대화가 끊겨도 이어지는 프로젝트

T04 정보판의 작은 개선 하나를 AI A와 B가 차례로 수행합니다. 기존 브라우저의 IndexedDB 기록에 새 공개 날짜가 자동 반영되도록 하는 작업입니다.

작업 시작 전에 `protocol/fixed-tests.json`의 검사 10개와 AI별 공통 상한을 고정했습니다. 두 AI는 `protocol/initial-request.md`의 동일한 요청을 받으며, 두 번째 AI는 첫 대화 전문 없이 저장소와 `HANDOFF.md`만 받습니다.

정적 정보판: `docs/index.html`. 고정 검사: `python3 tests/t05_fixed_browser.py`. T04 원형 출처는 `T04-ORIGIN.md`와 `protocol/freeze.md`에 적었습니다. 공개 비교 보고서는 작업 완료 후 `docs/report/`에 게시합니다. GitHub Pages는 `.github/workflows/pages.yml`이 `docs/`를 배포합니다.
