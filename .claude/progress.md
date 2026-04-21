# Marblo - Progress

## Completed

### BigQuery 텔레메트리 ML 준비도 Phase 1 (2026-04-19)
ML 기반 자동화(모델 선택, 프로세스 최적화, 비용 예측, 이상 탐지)를 위한 데이터 파이프라인 기반 구축.

1. **BigQuery 스키마 확장**: events에 10개 ML 컬럼 추가, cost_logs에 4개 컬럼 추가, 신규 3개 테이블(agent_heartbeats, task_outcomes, flow_executions) 생성
2. **Cloud Functions 확장**: logTaskOutcome, logHeartbeat, logFlowExecution 3개 함수 추가 + 기존 함수에 신규 컬럼 처리 반영
3. **미연결 이벤트 브릿지**: Flow(started/nodeExecuted/completed), Session(started/ended), token:usage 텔레메트리 연결
4. **Task outcome 집계**: DONE 전환 시 task_outcomes 테이블에 자동 기록
5. **Agent heartbeat**: 30초 주기 heartbeat 전송 → agent_heartbeats 테이블 (hang/무한루프 감지용)

**신규 파일:** `.claude/progress.md`, `docs/bigquery-ml-readiness.md`
**수정 파일:** `v3/functions/src/index.ts`, `v3/src/services/telemetryService.ts`, `v3/src/hooks/useFlowExecution.ts`, `v3/src/App.tsx`, `v3/electron/telemetry.ts`, `v3/electron/main.ts`, `v3/electron/agent-manager.ts`, `v3/src/hooks/useCostWriter.ts`, `v3/src/services/taskService.ts`, `v3/src/vite-env.d.ts`

### BigQuery 텔레메트리 ML 준비도 감사 문서 (2026-04-19)
현재 파이프라인 분석, 4가지 ML 목표별 갭 분석, 스키마 확장안, 4단계 로드맵 문서 작성.

**신규 파일:** `docs/bigquery-ml-readiness.md`

## In Progress
- Phase 2: 데이터 축적 + 기초 분석 (BigQuery ML 대시보드, baseline 수립)

## Remaining / TODO
- Phase 3: ML 모델 학습 + 추론 (모델 추천기, 비용 예측기, 이상 탐지)
- Phase 4: 프로세스 자동화 통합 (추천→자동 배정, 피드백 루프)
- ~~Cloud Functions 배포~~ (2026-04-19 완료, 20개 함수 전체 배포 성공)

## Issues / Tech Debt
- `task_outcomes.taskType`이 아직 null로 기록됨 — 태스크 메타데이터에 taskType 필드 추가 필요
- `task_outcomes.model`이 null — 에이전트 컨텍스트에서 모델 정보를 task 완료 시점에 전달하는 로직 필요
- heartbeat의 `tokensAccumulated`/`costAccumulated`가 0으로 고정 — CostTracker의 누적값을 연동해야 정확한 값 전달 가능
