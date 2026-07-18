# BigQuery 텔레메트리 ML 준비도 감사

> **작성일**: 2026-04-19
> **목적**: 현재 BigQuery 텔레메트리 파이프라인의 ML 활용 준비도를 분석하고, 4가지 ML 목표 달성을 위한 갭과 로드맵을 정리한다.

---

## 1. ML 목표

| # | 목표 | 설명 |
|---|------|------|
| ML-1 | **모델 자동 선택** | 태스크 특성(타입, 난이도, 코드량)을 보고 최적 LLM 모델 자동 배정 |
| ML-2 | **프로세스 최적화** | 에이전트 성공/실패 패턴 학습으로 프롬프트, 재시도 전략, 태스크 분배 자동 조정 |
| ML-3 | **비용 예측** | 태스크 유형별 예상 토큰/비용을 사전에 예측하여 견적 제공 |
| ML-4 | **이상 탐지** | crash 패턴, 비정상 비용 급증, 무한 루프 등 자동 감지 |

---

## 2. 현재 상태 (As-Is)

### 2.1 데이터셋 구조

- **프로젝트**: `marblo-2253d`
- **데이터셋**: `marblo_telemetry`
- **테이블**: 2개 (`events`, `cost_logs`)

### 2.2 events 테이블 스키마

| 컬럼 | 타입 | 설명 |
|------|------|------|
| event | STRING | 이벤트 타입 |
| userId | STRING | Firebase Auth UID |
| appVersion | STRING | 앱 버전 (기본 3.0.0) |
| projectId | STRING | Firestore 프로젝트 ID |
| agentId | STRING | 에이전트 인스턴스 ID |
| taskId | STRING | 태스크 ID |
| flowId | STRING | 플로우 ID |
| model | STRING | LLM 모델명 |
| role | STRING | 에이전트 역할 (backend/frontend 등) |
| status | STRING | 상태 |
| fromStatus | STRING | 이전 상태 |
| toStatus | STRING | 이후 상태 |
| durationMs | INTEGER | 소요 시간 (ms) |
| tokensInput | INTEGER | 입력 토큰 |
| tokensOutput | INTEGER | 출력 토큰 |
| cost | FLOAT | 비용 ($) |
| success | BOOLEAN | 성공 여부 |
| exitCode | INTEGER | 프로세스 종료 코드 |
| nodeType | STRING | 플로우 노드 타입 |
| nodeCount | INTEGER | 플로우 노드 수 |
| metadata | STRING | JSON 문자열 (확장 데이터) |
| timestamp | TIMESTAMP | 기록 시각 |

### 2.3 cost_logs 테이블 스키마

| 컬럼 | 타입 | 설명 |
|------|------|------|
| userId | STRING | Firebase Auth UID |
| projectId | STRING | 프로젝트 ID |
| agentId | STRING | 에이전트 ID |
| model | STRING | 사용 모델 |
| inputTokens | INTEGER | 입력 토큰 |
| outputTokens | INTEGER | 출력 토큰 |
| cacheReadTokens | INTEGER | 캐시 읽기 토큰 |
| cacheWriteTokens | INTEGER | 캐시 쓰기 토큰 |
| totalCost | FLOAT | 총 비용 ($) |
| timestamp | TIMESTAMP | 기록 시각 |

### 2.4 실제 데이터 현황 (2026-04-19 기준)

| 테이블 | 총 건수 | 기간 | 비고 |
|--------|---------|------|------|
| events | 17건 | 2026-04-18 (12분간) | agent 이벤트만 존재 |
| cost_logs | 5건 | 2026-04-18 | claude-opus-4-6만 |

**기록된 이벤트 타입 분포:**

| 이벤트 | 건수 |
|--------|------|
| agent:spawned | 11 |
| agent:restarted | 5 |
| agent:crashed | 1 |
| *(그 외 12종)* | 0 |

---

## 3. 갭 분석

### 3.1 이벤트 연결 상태 (정의 vs 실제 호출)

15종의 이벤트가 `telemetryService.ts`에 정의되어 있지만, 실제 코드에서 호출되는 것은 7종뿐이다.

| 이벤트 | 정의 | 호출 코드 | 상태 |
|--------|:----:|-----------|:----:|
| `agent:spawned` | O | `agent-manager.ts` → main → IPC → renderer | **연결됨** |
| `agent:stopped` | O | `agent-manager.ts` → main → IPC → renderer | **연결됨** |
| `agent:crashed` | O | `agent-manager.ts` → main → IPC → renderer | **연결됨** |
| `agent:restarted` | O | `agent-manager.ts` → main → IPC → renderer | **연결됨** |
| `task:created` | O | `taskService.ts` | **연결됨** |
| `task:status_changed` | O | `taskService.ts` | **연결됨** |
| `task:completed` | O | `taskService.ts` | **연결됨** |
| `flow:started` | O | — | **미연결** |
| `flow:node_executed` | O | — | **미연결** |
| `flow:completed` | O | — | **미연결** |
| `token:usage` | O | — | **미연결** |
| `session:started` | O | — | **미연결** |
| `session:ended` | O | — | **미연결** |
| `chat:message_sent` | O | `chatService.ts` | **연결됨 (미검증)** |
| `chat:active_users` | O | — | **미연결** |

**핵심 문제**: Flow 엔진(`flow-runner.ts`)이 자체 EventEmitter로 이벤트를 발생시키지만, BigQuery 텔레메트리 서비스와 연결되어 있지 않다. Session 시작/종료, 토큰 사용량도 마찬가지.

### 3.2 ML 목표별 데이터 갭

#### ML-1: 모델 자동 선택

| 필요 데이터 | 현재 상태 | 갭 |
|-------------|-----------|-----|
| 태스크 타입/카테고리 | `role` 필드만 존재 (backend/frontend) | 세분화 부족 (bug-fix, feature, refactor 등) |
| 태스크 난이도/복잡도 | 없음 | **신규 필요**: 파일 수, 코드 라인 변경량, 의존성 깊이 |
| 모델별 태스크 성공률 | `model` + `success` 존재하나 데이터 미축적 | 데이터 양 부족 |
| 태스크 완료 시간 | `durationMs` 정의됨 | 호출 코드에서 실제 계산 미구현 |
| 모델별 토큰 효율 | `cost_logs`에 존재 | task↔cost 연결키(taskId) 없음 |
| 프롬프트 길이/특성 | 없음 | **신규 필요** |

#### ML-2: 프로세스 최적화

| 필요 데이터 | 현재 상태 | 갭 |
|-------------|-----------|-----|
| 에이전트 재시도 패턴 | `agent:restarted` + attempt 메타데이터 | **존재** (양 부족) |
| 실패 원인 분류 | `exitCode`만 존재 | **신규 필요**: 에러 카테고리, 에러 메시지 요약 |
| 태스크 분배 이력 | `task:status_changed`에 agentId 포함 | claim/reassign 이력 추적 가능 |
| 플로우 실행 패턴 | 미연결 | **갭**: flow 텔레메트리 연결 필요 |
| 프롬프트→결과 상관관계 | 없음 | **신규 필요**: 초기 프롬프트 해시/카테고리 |
| 에이전트 간 핸드오프 이력 | 없음 | **신규 필요** |

#### ML-3: 비용 예측

| 필요 데이터 | 현재 상태 | 갭 |
|-------------|-----------|-----|
| 태스크 유형별 평균 비용 | cost_logs에 `model`, `tokens` 존재 | task↔cost 매핑 없음 (`taskId` 누락) |
| 프로젝트별 비용 추이 | `projectId` 존재 | 데이터 양 부족 |
| 캐시 효율 | `cacheReadTokens/cacheWriteTokens` 존재 | **존재** (양 부족) |
| 모델 가격 변동 이력 | 하드코딩 (`cost-tracker.ts`) | **신규 필요**: 가격 테이블 or 메타데이터 |
| 예상 작업량 사전 분석 | 없음 | **신규 필요**: 태스크 생성 시 scope 분석 데이터 |

#### ML-4: 이상 탐지

| 필요 데이터 | 현재 상태 | 갭 |
|-------------|-----------|-----|
| crash 시계열 | `agent:crashed` 이벤트 존재 | **존재** (양 부족) |
| 비용 시계열 | `cost_logs` 타임스탬프 존재 | **존재** (양 부족) |
| 토큰 사용량 급증 패턴 | `cost_logs` | 실시간 모니터링 없음 |
| 무한 루프/hang 감지 | 없음 | **신규 필요**: heartbeat/activity 간격 추적 |
| 메모리/CPU 사용량 | 없음 | **신규 필요**: 시스템 메트릭 |
| 에러율 기준선 (baseline) | 없음 | 데이터 축적 후 자동 계산 가능 |

---

## 4. 권장 스키마 확장

### 4.1 events 테이블 — 추가 컬럼

```sql
ALTER TABLE `marblo-2253d.marblo_telemetry.events`
ADD COLUMN IF NOT EXISTS taskType STRING,          -- bug-fix, feature, refactor, docs, test
ADD COLUMN IF NOT EXISTS taskComplexity INTEGER,   -- 1-5 추정 난이도
ADD COLUMN IF NOT EXISTS filesChanged INTEGER,     -- 변경 파일 수
ADD COLUMN IF NOT EXISTS linesChanged INTEGER,     -- 변경 라인 수
ADD COLUMN IF NOT EXISTS errorCategory STRING,     -- timeout, oom, auth, network, logic, unknown
ADD COLUMN IF NOT EXISTS errorMessage STRING,      -- 에러 메시지 요약 (최대 500자)
ADD COLUMN IF NOT EXISTS promptHash STRING,        -- 초기 프롬프트 해시 (동일 프롬프트 그룹핑)
ADD COLUMN IF NOT EXISTS promptLength INTEGER,     -- 프롬프트 길이 (문자 수)
ADD COLUMN IF NOT EXISTS parentAgentId STRING,     -- 핸드오프 시 원래 에이전트 ID
ADD COLUMN IF NOT EXISTS retryOf STRING;           -- 재시도 시 원본 이벤트 참조
```

### 4.2 cost_logs 테이블 — 추가 컬럼

```sql
ALTER TABLE `marblo-2253d.marblo_telemetry.cost_logs`
ADD COLUMN IF NOT EXISTS taskId STRING,            -- 태스크 연결키 (ML-1, ML-3 핵심)
ADD COLUMN IF NOT EXISTS taskType STRING,          -- 태스크 유형
ADD COLUMN IF NOT EXISTS sessionId STRING,         -- 세션 연결
ADD COLUMN IF NOT EXISTS pricingSnapshot STRING;   -- 적용된 가격 정보 JSON
```

### 4.3 신규 테이블: `agent_heartbeats`

무한 루프/hang 감지(ML-4)를 위한 에이전트 활동 펄스.

```sql
CREATE TABLE IF NOT EXISTS `marblo-2253d.marblo_telemetry.agent_heartbeats` (
  userId STRING NOT NULL,
  agentId STRING NOT NULL,
  projectId STRING,
  status STRING,              -- idle, working, waiting
  tokensAccumulated INTEGER,  -- 세션 누적 토큰
  costAccumulated FLOAT,      -- 세션 누적 비용
  lastActivityType STRING,    -- 마지막 활동 유형
  timestamp TIMESTAMP NOT NULL
);
```

### 4.4 신규 테이블: `task_outcomes`

모델 선택(ML-1)과 비용 예측(ML-3)의 핵심 학습 데이터.

```sql
CREATE TABLE IF NOT EXISTS `marblo-2253d.marblo_telemetry.task_outcomes` (
  userId STRING NOT NULL,
  taskId STRING NOT NULL,
  projectId STRING,
  taskType STRING,            -- bug-fix, feature, refactor, docs, test
  taskComplexity INTEGER,     -- 1-5
  role STRING,                -- backend, frontend, devops, test
  model STRING,               -- 사용된 모델
  promptLength INTEGER,       -- 초기 프롬프트 길이
  scopeFileCount INTEGER,     -- 대상 파일 수
  -- 결과
  success BOOLEAN,
  durationMs INTEGER,         -- 총 소요 시간
  totalInputTokens INTEGER,   -- 총 입력 토큰
  totalOutputTokens INTEGER,  -- 총 출력 토큰
  totalCost FLOAT,            -- 총 비용
  retriesCount INTEGER,       -- 재시도 횟수
  errorCategory STRING,       -- 실패 시 에러 카테고리
  -- 메타
  createdAt TIMESTAMP NOT NULL,
  completedAt TIMESTAMP
);
```

### 4.5 신규 테이블: `flow_executions`

플로우 실행 패턴 학습(ML-2)을 위한 전용 테이블.

```sql
CREATE TABLE IF NOT EXISTS `marblo-2253d.marblo_telemetry.flow_executions` (
  userId STRING NOT NULL,
  flowId STRING NOT NULL,
  runId STRING NOT NULL,
  projectId STRING,
  nodeCount INTEGER,
  -- 노드별 실행 기록 (REPEATED)
  nodeExecutions ARRAY<STRUCT<
    nodeId STRING,
    nodeType STRING,
    durationMs INTEGER,
    success BOOLEAN,
    errorMessage STRING
  >>,
  -- 전체 결과
  status STRING,              -- completed, failed, cancelled, paused
  totalDurationMs INTEGER,
  success BOOLEAN,
  timestamp TIMESTAMP NOT NULL
);
```

---

## 5. 코드 연결 수정 필요 사항

### 5.1 즉시 수정 (데이터 수집 시작)

| 위치 | 수정 내용 | 영향 이벤트 |
|------|-----------|-------------|
| `src/hooks/useFlowExecution.ts` | FlowRunner 이벤트를 텔레메트리로 브릿지 | `flow:started`, `flow:node_executed`, `flow:completed` |
| `src/App.tsx` 또는 `src/pages/` | 앱 마운트 시 `telemetry.sessionStarted()`, 언마운트 시 `sessionEnded()` 호출 | `session:started`, `session:ended` |
| `electron/cost-tracker.ts` | `onCostDetected` 콜백에서 `token:usage` 이벤트도 전송 | `token:usage` |
| `src/hooks/useCostWriter.ts` | `taskId` 전달 추가 | cost_logs에 task 연결 |

### 5.2 신규 구현

| 구현 | 설명 |
|------|------|
| Heartbeat 전송 | 에이전트 활동 중 30초마다 `agent_heartbeats` 기록 |
| Task outcome 집계 | 태스크 DONE 전환 시 `task_outcomes`에 집계 row 생성 |
| Flow execution 로거 | `flow-runner.ts`의 EventEmitter → `flow_executions` 기록 |
| 에러 분류기 | exitCode + stderr 패턴으로 `errorCategory` 자동 분류 |

---

## 6. ML 도입 로드맵

### Phase 1: 데이터 기반 확보 (2~4주)

- [ ] events 테이블 컬럼 추가 (4.1)
- [ ] cost_logs 테이블 컬럼 추가 (4.2)
- [ ] 미연결 이벤트 8종 코드 연결 (5.1)
- [ ] `task_outcomes` 테이블 생성 + 집계 로직
- [ ] `agent_heartbeats` 테이블 생성 + 전송 로직
- [ ] `flow_executions` 테이블 생성 + 로거
- **목표**: 모든 파이프라인이 안정적으로 데이터를 수집하는 상태

### Phase 2: 데이터 축적 + 기초 분석 (4~8주)

- [ ] 최소 1,000건 이상의 `task_outcomes` 축적
- [ ] BigQuery ML 또는 Vertex AI로 기초 통계 대시보드 구축
- [ ] 모델별/태스크별 성공률, 평균 비용, 평균 소요 시간 리포트
- [ ] 이상 탐지 기준선(baseline) 수립: 평균 비용 ± 2σ, crash 빈도 기준
- **목표**: "현황 파악"이 가능한 상태

### Phase 3: ML 모델 학습 + 추론 (8~12주)

- [ ] **ML-1 모델 자동 선택**: `task_outcomes` 기반 classification 모델
  - Input: taskType, complexity, role, scopeFileCount, promptLength
  - Output: 최적 model 추천 + 예상 성공률
  - 방법: BigQuery ML `CREATE MODEL ... OPTIONS(model_type='LOGISTIC_REG')` 또는 Vertex AI AutoML
- [ ] **ML-3 비용 예측**: `task_outcomes` 기반 regression 모델
  - Input: taskType, complexity, scopeFileCount, model
  - Output: 예상 totalCost, totalTokens, durationMs
- [ ] **ML-4 이상 탐지**: 시계열 기반 anomaly detection
  - `agent_heartbeats` 간격 이상 → hang 감지
  - `cost_logs` 시계열 → 비용 급증 알림
  - 방법: BigQuery ML `CREATE MODEL ... OPTIONS(model_type='ARIMA_PLUS')` 또는 간단한 통계적 임계값
- **목표**: 자동 추천/경고가 작동하는 상태

### Phase 4: 프로세스 자동화 통합 (12주~)

- [ ] **ML-2 프로세스 최적화**: 추천을 실제 에이전트 스폰에 반영
  - 태스크 생성 시 → ML 추천 모델로 자동 배정
  - 실패 시 → ML 제안 대안 모델로 자동 재시도
  - 플로우 편집기에서 노드별 최적 모델 제안
- [ ] 피드백 루프: 추천 수락/거부 데이터 → 모델 재학습
- [ ] 비용 예산 설정 + 초과 예측 시 사전 경고
- **목표**: 사람 개입 최소화, 자가 개선 시스템

---

## 7. 최소 데이터 수집 요건 (ML 학습 시작 기준)

| ML 목표 | 최소 데이터량 | 핵심 테이블 |
|---------|-------------|-------------|
| ML-1 모델 자동 선택 | task_outcomes 500건 이상 (모델 3종 × 태스크 5타입 이상) | task_outcomes |
| ML-2 프로세스 최적화 | events 2,000건 + flow_executions 200건 | events, flow_executions |
| ML-3 비용 예측 | task_outcomes 300건 이상 | task_outcomes, cost_logs |
| ML-4 이상 탐지 | agent_heartbeats 7일 연속 + cost_logs 100건 | agent_heartbeats, cost_logs |

---

## 8. 즉시 실행 가능한 BigQuery ML 쿼리 예시

데이터가 충분히 축적되면 바로 실행할 수 있는 쿼리 템플릿:

### 8.1 모델 선택 추천 (ML-1)

```sql
-- 학습
CREATE OR REPLACE MODEL `marblo_telemetry.model_recommender`
OPTIONS(model_type='LOGISTIC_REG', input_label_cols=['best_model']) AS
SELECT
  taskType,
  taskComplexity,
  role,
  scopeFileCount,
  promptLength,
  model AS best_model
FROM `marblo_telemetry.task_outcomes`
WHERE success = TRUE;

-- 추론
SELECT * FROM ML.PREDICT(
  MODEL `marblo_telemetry.model_recommender`,
  (SELECT 'feature' AS taskType, 3 AS taskComplexity, 'backend' AS role,
          5 AS scopeFileCount, 200 AS promptLength)
);
```

### 8.2 비용 예측 (ML-3)

```sql
CREATE OR REPLACE MODEL `marblo_telemetry.cost_predictor`
OPTIONS(model_type='LINEAR_REG', input_label_cols=['totalCost']) AS
SELECT
  taskType, taskComplexity, role, model,
  scopeFileCount, promptLength, totalCost
FROM `marblo_telemetry.task_outcomes`
WHERE totalCost > 0;
```

### 8.3 비용 이상 탐지 (ML-4)

```sql
CREATE OR REPLACE MODEL `marblo_telemetry.cost_anomaly`
OPTIONS(model_type='ARIMA_PLUS', time_series_timestamp_col='timestamp',
        time_series_data_col='totalCost') AS
SELECT timestamp, totalCost
FROM `marblo_telemetry.cost_logs`
ORDER BY timestamp;

-- 이상치 탐지
SELECT * FROM ML.DETECT_ANOMALIES(
  MODEL `marblo_telemetry.cost_anomaly`,
  STRUCT(0.95 AS anomaly_prob_threshold)
);
```

---

## 9. 요약

| 항목 | 현재 | 목표 |
|------|------|------|
| 테이블 수 | 2 | 5 (+agent_heartbeats, task_outcomes, flow_executions) |
| 이벤트 연결률 | 47% (7/15) | 100% |
| 일일 데이터량 | ~20건 | 수백~수천 건 |
| ML 활용 | 없음 | 4가지 ML 모델 운영 |
| 자동화 수준 | 수동 모델 선택 | ML 기반 자동 추천 → 자동 배정 |

**1순위 작업**: Phase 1의 이벤트 연결 + 테이블 생성이 모든 ML 목표의 전제 조건이다. 데이터 없이는 어떤 ML도 불가능하므로, 코드 연결 수정을 최우선으로 진행해야 한다.
