# Fleet Grid — QA 체크리스트

본 체크리스트는 Marblo 앱을 실행 가능한 환경에서 수동/`/qa` 스킬로 검증한다.
배경 세션에서는 라이브 앱 미확보로 실측 불가 — 본 문서를 가이드 삼아
머지 전 누군가 한 명이 채워서 PR 에 첨부.

## 사전 조건

- Marblo v3 dev 실행: `npm --prefix v3 run dev`
- 동시 활성 에이전트 ≥ 3개 (claude + codex + gemini 권장)
- DevTools 열어 Performance 캡처 준비

## Acceptance

| #   | 시나리오                                                                 | 합격 기준                                               | 결과 |
| --- | ------------------------------------------------------------------------ | ------------------------------------------------------- | ---- |
| 1   | Agents 탭 진입 → 우상단 ▤ List / ▦ Grid 토글 노출                        | 두 버튼 모두 보임, 현재 모드 강조                       |      |
| 2   | Grid 클릭 → 카드가 그리드 셀로 전환                                      | 모든 에이전트 셀로 표시, 미니 터미널 8줄 라이브         |      |
| 3   | 활성 에이전트 한 곳에서 출력 발생                                        | 해당 셀만 갱신, 다른 셀 재렌더 X (Profiler 확인)        |      |
| 4   | 셀 클릭                                                                  | 메인 터미널 패널 활성 + 해당 세션 탭 선택 + 패널 스크롤 |      |
| 5   | 에이전트가 입력 대기 패턴 출력 (`Continue? [y/N]`)                       | "⏸ 입력 대기" 뱃지 노란색으로 표시                      |      |
| 6   | 에이전트 status=error 진입                                               | "⚠ Error" 뱃지 빨간색 + tooltip 에 exit code            |      |
| 7   | 에이전트 restart 1회 이상 발생                                           | "↻ N" 뱃지 주황 표시                                    |      |
| 8   | List ↔ Grid 토글 후 페이지 reload                                        | 마지막 선택 유지 (localStorage)                         |      |
| 9   | 윈도우 폭 640px 이하로 축소                                              | 그리드가 1열로 자동 fallback                            |      |
| 10  | 50개 에이전트 더미 시나리오 (DevTools 스크립트, perf-fleet-grid.md 참고) | ≥ 30fps 유지, 메모리 스파이크 < 50MB                    |      |

## 회귀 체크

- [ ] 기존 List 뷰의 카드 디테일 (cost gauge, restart count, current task) 모두 정상
- [ ] AgentStatusCard 의 Terminal 버튼 세션 picker 동작 (별도 동선)
- [ ] Activity 점프 ("🤖 에이전트 보기") 정상
- [ ] `Cmd+Shift+A` Activity 패널 토글 정상
- [ ] 멀티윈도우 동시 사용 시 매핑 충돌 없음

## 결과 기록

이 PR 의 description 또는 댓글에 위 표를 채워서 첨부.
