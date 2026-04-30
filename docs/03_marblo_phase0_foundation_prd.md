# Marblo Phase 0 PRD: 6월 런칭 + Enterprise 토대 In-place 준비

**문서 버전**: v1.0
**작성일**: 2026-04-29
**작성자**: John (Dee)
**선행 문서**: `01_marblo_core_architecture_prd.md`, `02_marblo_enterprise_prd.md`
**우선 순위**: 본 문서가 5월 실행 계획의 single source of truth. Core/Enterprise PRD의 Week/Phase 일정 중 본 문서와 충돌하는 부분은 본 문서를 따른다.

---

## 0. Executive Summary

본 문서는 **6월 런칭 hard deadline을 지키면서** Enterprise 확장을 위한 토대를 미리 깔기 위한 **Phase 0 (2026-05) 실행 계획**이다.

### 핵심 결정

1. **6월 런칭 = hard deadline** (변경 불가)
2. **모노레포 빅뱅 마이그레이션 안 함**: Core PRD의 Week 1-4 모노레포 마이그레이션 계획은 솔로 capacity와 데드라인 동시 충족이 불가하다고 판단. 대신 **v3 디렉토리 안에서 in-place로 인터페이스/훅/이벤트 토대만 추출**.
3. **Enterprise 본 개발은 첫 PoC 계약 이후**: Gateway Agent, Control Plane, OPA, PII Scanner, Helm 등은 요구사항이 정해진 후 시작. 미리 만들면 버려진다.
4. **Phase 0 must-do는 3개 Sprint뿐**: Adapter 인터페이스, Hook 포인트, 이벤트 스키마. 이 3개만 5월에 완료하면 6월 이후 어떤 Enterprise 요구사항이 와도 며칠 안에 swap 가능한 구조 확보.

### 한 줄 요약

> "Enterprise는 5월에 만드는 게 아니라 5월에 **들어갈 자리만** 만든다. 본 개발은 PoC 계약 이후."

---

## 1. PRD v1.0과의 변경 사항

| 항목 | Core PRD v1.0 | Phase 0 PRD (본 문서) |
|---|---|---|
| 5월 작업 방식 | 모노레포 마이그레이션 + Adapter 추출 + 빌드 타겟 분리 | v3 in-place에서 인터페이스/훅/이벤트만 추출 |
| `packages/` 분리 | Week 1에 시작 | **연기** (PoC 직전 또는 6월 런칭 후) |
| 빌드 타겟 분리 (`marblo-pro` vs `marblo-enterprise`) | Week 4 | **연기** (Phase 1 PoC 직전) |
| Hook 구현체 | `hooks-noop`, `hooks-enterprise` 패키지 | v3 안 단일 디렉토리, NoOpPolicyHook만 |
| Enterprise 코드 | 미포함 (Phase 1에서) | **변경 없음** (Phase 1에서) |
| 6월 런칭 일정 | Week 5-6 안정화 | 동일 |

**변경 이유**: 솔로 개발자가 5월 안에 (a) 현재 기능 개선 + (b) 모노레포 마이그레이션 + (c) 결제·라이선스 + (d) 베타 안정화를 동시에 하는 건 불가능. 모노레포는 토대가 아니라 **재배치 작업**일 뿐이고, 인터페이스/훅/이벤트만 있으면 Enterprise swap은 가능하다. 따라서 모노레포는 가장 미루기 쉬운 항목.

---

## 2. Phase 0 범위 (2026-05)

### 2.1 ✅ 반드시 해야 하는 것 (Must-Do, 5월 완료)

| Sprint | 작업 | 목표 | 예상 공수 |
|---|---|---|---|
| **A** | Adapter 인터페이스 추출 (in-place) | LLM/MCP/FS/Terminal 호출을 인터페이스 뒤로 | 3-4일 |
| **B** | Hook 포인트 + NoOpPolicyHook 삽입 | 모든 Adapter 호출이 Hook 경유 | 1-2일 |
| **C** | 이벤트 스키마 + 로컬 JSONL 로깅 | 주요 동작이 구조화 이벤트로 기록 | 2-3일 |

**합계**: 6-9일 작업. 솔로 capacity로 1.5-2주.

### 2.2 ❌ 명시적으로 미루는 것 (Deferred, Phase 1 이후)

다음 항목은 **5월에 절대 손대지 않는다**. 미루는 이유 명시:

| 항목 | 미루는 이유 | 재개 시점 |
|---|---|---|
| 모노레포 마이그레이션 (pnpm + Turborepo) | 데드라인 위협, 토대 작업이 아닌 재배치 작업 | 6월 런칭 후 또는 PoC 직전 |
| `packages/` 디렉토리 분리 | 위와 동일 | 동일 |
| 빌드 타겟 분리 (`marblo-pro` vs `marblo-enterprise`) | 분리할 Enterprise 코드가 아직 없음 | Phase 1 PoC MVP 시점 |
| Gateway Agent (Go) | 첫 PoC 요구사항 모르면 90% 다시 짠다 | 첫 PoC 미팅 후 |
| Control Plane (Go + Next.js) | 동일 | 동일 |
| OPA Rego 정책 엔진 통합 | 동일 | 동일 |
| PII Scanner (Hyperscan) | 동일 | 동일 |
| K8s Helm 차트 | 동일 | 동일 |
| SSO/SAML/OIDC | 동일 | 동일 |
| 한국 특화 MCP 번들 | 동일 | 동일 |
| 오프라인 라이선스, 에어갭 모드 | Phase 2 | Phase 2 |
| 고가용성, ISMS-P 리포트 | Phase 2 | Phase 2 |

원칙: **계약 전에 만든 Enterprise 기능은 거의 모두 폐기된다**. 첫 PoC 고객의 실제 환경(IdP 종류, 망분리 형태, LLM 라우팅 정책)이 구현을 결정한다. 미리 만든다 = 낭비.

---

## 3. Sprint 상세

### 3.1 Sprint A: Adapter 인터페이스 추출 (예상 2-3일, 단축됨)

**현황 노트 (2026-04-29 코드베이스 검증)**:

v3에 이미 부분 추상화가 존재한다. Sprint A는 신규 작성이 아닌 **인터페이스 위치 이동 + `RequestMetadata` 필드 추가 + 기존 클래스 래핑**이 핵심. 따라서 원래 3-4일 → **2-3일로 단축 가능**.

기존 추상화 위치:
- LLM: `v3/electron/flow-engine/types.ts:70` (`LLMProvider` 인터페이스), `v3/electron/flow-engine/llm-provider.ts` (`createLLMProvider()` factory, Anthropic/Gemini/OpenAI 분기)
- LLM (별도): `v3/electron/orchestrator/llm-client.ts` (`LLMClient` 클래스, Anthropic/OpenAI/Google 분기)
- PTY: `v3/electron/pty-manager.ts` (`PtyManager` 클래스, `node-pty` 래핑)
- FS: `v3/electron/fs-manager.ts` (`FsManager` 클래스)
- MCP: `v3/electron/mcp-server/` (별도 디렉토리, tools/index/state-machine 분리)

**범위 결정**:
- ✅ 인터페이스 통일 + `metadata: RequestMetadata` 필드 추가 + 기존 클래스/팩토리 래핑
- ❌ 두 LLM 클라이언트(`orchestrator/llm-client.ts` ↔ `flow-engine/llm-provider.ts`) **통합은 Sprint A 범위 외**. 인터페이스만 동일하게 맞추고 두 구현 유지. 통합은 6월 런칭 후 또는 Sprint B 이후 여유 시.
- ❌ 모노레포 분리 절대 금지 (`packages/`, `pnpm-workspace.yaml` 손대지 않음)

**선결 조건 (Sprint A 착수 전)**:
1. 진행 중인 INP/터미널 perf 수정 작업(13개 modified files) 의미 단위 commit 완료 후 main 머지
   - `MM` 상태인 `v3/src/components/terminal/TerminalView.tsx` 정리 필수 (staged + unstaged 동시 존재)
   - 권장 그룹: (a) INP/IPC 최적화 (main.ts, preload.ts, App.tsx), (b) xterm/Canvas 마이그레이션 + cursorBlink (Terminal*.tsx, OrchestratorTerminal.tsx, OrchestratorPanel.tsx, package.json/lock, index.css, main.tsx 등)
2. `feat/adapter-foundation` 브랜치 신규 생성 후 작업
3. main의 INP perf 작업 안정성 확인 (베타 사용자 또는 자체 dogfooding 1-2일)

**충돌 위험**:
- `v3/electron/main.ts` line 217, 233 부근에서 `createLLMProvider()` 호출 중. Sprint A에서 DI 변경 시 이 부분 conflict 가능. 단 INP 수정 영역(GPU flags, IPC handlers)과 line 단위로 분리되어 있어 작은 risk.

**목표**: 외부 세계 접점(LLM/MCP/FS/Terminal)을 TypeScript 인터페이스로 추상화. v3 디렉토리 내부에서, 모노레포 분리 없이.

**작업 단계**:

1. **기존 호출 식별** (✅ 2026-04-29 사전 완료)
   - LLM 호출 진입점 16개 파일 식별 완료 (`agent-manager.ts`, `bridge-server.ts`, `cost-tracker.ts`, `dispatch-scoring.ts`, `flow-engine/*`, `orchestrator/*` 등)
   - PtyManager, FsManager, MCP 서버 진입점 확인 완료
   - 추가 grep 불필요. 바로 단계 2로.

2. **인터페이스 정의** (1일)
   - `v3/src/adapters/interfaces/LLMAdapter.ts`
   - `v3/src/adapters/interfaces/MCPAdapter.ts`
   - `v3/src/adapters/interfaces/FileSystemAdapter.ts`
   - `v3/src/adapters/interfaces/TerminalAdapter.ts`
   - `v3/src/adapters/interfaces/RequestMetadata.ts` (공통)
   - 시그니처는 Core PRD 섹션 3 그대로. optional 필드는 최소화.

3. **Direct 구현체 작성** (1.5일)
   - `v3/src/adapters/standard/DirectLLMAdapter.ts` — 기존 LLM 호출 로직 그대로 옮김
   - `v3/src/adapters/standard/DirectMCPAdapter.ts`
   - `v3/src/adapters/standard/LocalFSAdapter.ts`
   - `v3/src/adapters/standard/PtyTerminalAdapter.ts` — 가상터미널 spawn 로직 (특허 영역, "Patent Pending" 주석 추가)

4. **호출자 리팩토링** (0.5-1일)
   - Orchestrator, UI 등에서 이제 인터페이스만 의존
   - `AdapterRegistry` 또는 단순 DI 방식으로 런타임에 구현체 주입
   - 기존 동작 100% 보존

**완료 기준**:
- [ ] 4개 인터페이스 파일 존재
- [ ] 4개 Direct 구현체 존재
- [ ] 모든 외부 접점 호출이 Adapter 경유
- [ ] v3 기존 기능 수동 smoke test 통과 (오케스트레이터 띄우기, 에이전트 spawn, 칸반 작동, 플로우 실행)
- [ ] 인터페이스 시그니처에 `metadata: RequestMetadata` 필드 포함 (Hook이 쓸 컨텍스트)

**주의**:
- 모노레포 분리 절대 금지. `packages/`, `pnpm-workspace.yaml` 손대지 않음.
- 기존 코드를 Direct 구현체로 "이동"하는 게 아니라 "래핑"하는 형태가 최소 위험. 리팩토링 깊이 들어가지 말 것.
- Patent Pending 주석은 `PtyTerminalAdapter.ts` 상단과 사전 주입 메시지 빌더 위치에 추가.

---

### 3.2 Sprint B: Hook 포인트 + NoOpPolicyHook (1-2일)

**목표**: 모든 Adapter 호출이 Policy Hook을 경유하도록. Pro/Team에서는 no-op.

**작업 단계**:

1. **Hook 인터페이스 정의** (0.5일)
   - `v3/src/adapters/interfaces/PolicyHook.ts`
   - `preRequest`, `postResponse`, `onError` 시그니처 (Core PRD 섹션 4.1)
   - `HookDecision<T>` 타입 (allow/deny/transform)

2. **NoOpPolicyHook 구현** (0.2일)
   - `v3/src/adapters/standard/NoOpPolicyHook.ts`
   - 모든 메서드가 단순 통과

3. **Hook 주입** (0.5-1일)
   - Adapter 호출 직전 `policyHook.preRequest(request, ctx)` 호출
   - Adapter 응답 직후 `policyHook.postResponse(req, res, ctx)` 호출
   - Decision이 `deny`면 throw, `transform`이면 변형된 request 사용
   - Direct 구현체 4개 모두 일관된 패턴으로

**완료 기준**:
- [ ] PolicyHook 인터페이스 존재
- [ ] NoOpPolicyHook 구현 존재
- [ ] 4개 Direct Adapter 모두에서 Hook 경유 확인
- [ ] 성능 회귀 없음 (NoOp 오버헤드 P95 < 1ms — 이건 마이크로벤치 안 해도 자명)

**주의**:
- Hook 호출이 비동기여도 await 누락 금지
- 향후 Enterprise에서 `EnterprisePolicyHook` 만들어 swap만 하면 끝나는 구조
- Hook 안에서 throw하지 말고 `HookDecision`으로만 결정 전달

---

### 3.3 Sprint C: 이벤트 스키마 + JSONL 로깅 (2-3일)

**목표**: 주요 동작을 구조화 이벤트로 발행. 로컬 JSONL 파일 기록. Enterprise 때 Gateway가 이걸 Control Plane으로 forward만 하면 되는 구조.

**작업 단계**:

1. **이벤트 타입 정의** (0.5일)
   - `v3/src/events/types.ts` — `MarbloEvent`, `EventType` (Core PRD 섹션 6 그대로)
   - UUID v7 생성기 (시간 순서 보장, `uuid` 패키지 v9+)

2. **이벤트 emitter 구현** (1일)
   - `v3/src/events/emitter.ts` — append-only JSONL writer
   - 경로: `~/Library/Application Support/Marblo/events/{YYYY-MM-DD}.jsonl` (macOS), 동등 위치 (Win/Linux)
   - 백그라운드 비동기 write, fsync는 1초마다 또는 100건마다

3. **이벤트 발행 지점 삽입** (1-1.5일)
   - `agent.spawned`, `agent.terminated` (오케스트레이터)
   - `llm.request`, `llm.response` (LLMAdapter Hook 통과 후)
   - `mcp.invoked` (MCPAdapter)
   - `terminal.executed` (TerminalAdapter)
   - `task.created`, `task.updated` (칸반 보드)
   - 기타 PRD 섹션 6.1의 `EventType` 전체

**완료 기준**:
- [ ] `~/.../Marblo/events/{date}.jsonl` 파일 자동 생성
- [ ] 에이전트 spawn 1회 시 최소 5건 이벤트 기록 확인
- [ ] 모든 이벤트에 `eventId`, `eventType`, `timestamp`, `version` 필드 존재
- [ ] 스키마 버전 `1` 명시
- [ ] **부수 효과**: 멀티 에이전트 디버깅 즉시 가능 (현재 제품 품질 향상에도 기여)

**주의**:
- 이벤트 발행이 메인 플로우를 블록하지 않도록 (fire-and-forget queue)
- 디스크 쓰기 실패 시 콘솔 로그만 남기고 앱 동작에 영향 주지 않음
- 사용자 데이터 PII는 5월 단계에선 마스킹 안 함 (로컬 파일이므로). Enterprise에서 PII Scanner가 처리.

---

## 4. 6월 런칭까지 일정 (수정판)

| 주차 | 기간 | 주요 작업 | 출력 |
|---|---|---|---|
| Week 1 | 4/29 ~ 5/4 | 현재 기능 개선 finalize + Sprint A 시작 | 진행 중 v3 작업 머지, Adapter 인터페이스 정의 |
| Week 2 | 5/5 ~ 5/11 | Sprint A 완료 + Sprint B | Direct 구현체 4종 + NoOpPolicyHook |
| Week 3 | 5/12 ~ 5/18 | Sprint C + 결제 인프라 (Stripe + Toss) 시작 | 이벤트 로깅 동작 + 결제 통합 |
| Week 4 | 5/19 ~ 5/25 | 라이선스 발급/검증 + 온보딩 | Free → Pro 업그레이드 동작 |
| Week 5 | 5/26 ~ 6/1 | 베타 배포 + 안정화 + 런칭 콘텐츠 | 베타 사용자 피드백 |
| 런칭 | 6월 | Product Hunt + 유튜브 영상 + B2B 영업 개시 | 첫 결제 |

**Buffer**: Sprint C는 가장 마지막. 데드라인 압박 시 이벤트 종류를 5종 정도로 축소 가능 (`llm.request/response`, `agent.spawned/terminated`, `task.updated`만). 단 스키마와 emitter는 반드시 완성.

**중단 기준**: 5/18까지 Sprint A/B 완료 안 되면 Sprint C 폐기, 결제·라이선스에 모든 자원 투입.

---

## 5. 브랜치 전략

```
main                              ← 현재 기능 개선 계속 (배포 가능 상태 유지)
 ├─ feat/* (현재 작업들)
 ├─ feat/adapter-foundation       ← Sprint A (1-2주 안에 머지)
 │    └─ Direct 구현체 4종, 인터페이스 정의
 ├─ feat/hook-injection           ← Sprint B (Sprint A 머지 후)
 │    └─ PolicyHook, NoOpPolicyHook
 └─ feat/event-schema             ← Sprint C (Sprint B 머지 후 또는 병렬)
      └─ MarbloEvent, JSONL emitter
```

**원칙**:
- 각 브랜치는 작아야 함 (PR 1-2개로 머지 가능 사이즈)
- main은 항상 배포 가능 상태 유지
- 매일 main에서 rebase하여 conflict 즉시 해결 (솔로니 conflict 적지만 14개 modified files 있는 현재 상태에서는 주의)

---

## 6. Phase 0 이후 (참고용 — 6월 런칭 후)

본 문서 범위 밖이지만 일정 인지를 위해 명시.

### 6.1 6-9월 (영업 사이클)
- 6월: Product Hunt 런칭, 유튜브 콘텐츠, 강의 투어, B2B 영업 개시
- 7-8월: 첫 PoC 미팅. 잠재 고객의 실제 요구사항 수집 (IdP, 망분리, LLM 라우팅 등).
- 8-9월: 첫 PoC 계약 임박 시 **모노레포 마이그레이션** + **Gateway Agent 개발 시작**. Go 개발자 계약직 채용 시작 (5월 중 공고가 빠름, 6월 말 공고도 가능).

### 6.2 모노레포 마이그레이션 (PoC 직전 1-2주)
- v3 in-place 구조를 `packages/core`, `packages/adapters-standard`, `packages/hooks-noop` 등으로 분리
- `marblo-pro` 빌드 타겟 분리 (Enterprise 코드 미포함 검증)
- 이때 작업이 가벼운 이유: 인터페이스/훅/이벤트가 이미 깨끗하게 분리되어 있으므로 파일 이동 + import 경로 수정이 대부분

### 6.3 Phase 1 (Enterprise PoC MVP, 7-9월)
- 02_enterprise_prd.md 섹션 9.1 Phase 1 그대로 진행
- 단, Phase 0 토대 위에서 진행하므로 Adapter swap (`DirectLLMAdapter` → `GatewayLLMAdapter`)이 핵심 통합점

---

## 7. 성공 기준 (Phase 0)

5월 31일 시점 검증:

- [ ] Sprint A/B/C 모두 main 머지 완료
- [ ] v3 기존 기능 100% 보존 (수동 회귀 테스트)
- [ ] 6월 1일 베타 배포 가능 상태
- [ ] **Enterprise readiness 검증**: `GatewayLLMAdapter`라는 mock 구현체를 한 시간 안에 작성하여 swap 가능함을 입증 (실제로는 만들지 않고 사고 실험으로 확인)
- [ ] 결제·라이선스 시스템 동작
- [ ] 이벤트 JSONL이 디버깅에 실사용되고 있음

---

## 8. 리스크 및 대응

| 리스크 | 확률 | 영향 | 대응 |
|---|---|---|---|
| Sprint A에서 인터페이스가 비대해짐 | 중 | 중 | 최소 시그니처만 정의. optional 필드는 다 빼기. 두 번째 구현체 만들 때 보강. |
| 현재 기능 개선과 Adapter 추출 충돌 | 중 | 중 | 매일 main rebase. 큰 리팩토링은 feat/adapter-foundation 안에서만. |
| 6월 데드라인 미스 | 중 | 치명 | Sprint C 폐기 옵션 보유. 결제·라이선스 우선. |
| Sprint A 도중 가상터미널 코드 손상 | 저 | 치명 (특허 영역) | PtyTerminalAdapter는 기존 코드 직접 import만, 로직 변경 금지. |
| 베타 사용자 피드백 폭발 | 중 | 중 | 5월 마지막 주는 신기능 동결, 버그 수정만. |
| Go 개발자 채용 지연 | 고 | 중 | 5월 중순 공고. 7월 가동 가정. 못 구하면 첫 PoC 시작 한 달 늦어짐. |

---

## 9. Claude Code 작업 지침

본 PRD를 기반으로 Claude Code/에이전트에 작업 지시 시:

1. **Sprint 순서 엄수**: A → B → C. C는 A/B 완료 전 시작 금지.
2. **In-place 원칙**: `packages/`, `apps/` 디렉토리 만들지 말 것. 모든 작업은 `v3/` 안에서.
3. **인터페이스 우선**: 구현 전 반드시 TypeScript 인터페이스 먼저 PR.
4. **기존 동작 보존**: 각 Sprint 완료 시 v3 smoke test 통과 필수.
5. **Patent Pending 주석**: `PtyTerminalAdapter.ts`, MCP/stdio 사전주입 메시지 빌더 파일 상단에 표기.
6. **테스트**: 각 Adapter 구현체에 단위 테스트 1개 이상. 통합 테스트는 v3 기존 시나리오 재사용.
7. **TaskForce MCP**: 각 Sprint 시작 시 태스크 생성, 완료 시 `submit_for_review`.
8. **Deferred 항목 손대지 말 것**: 섹션 2.2 항목은 5월 작업에서 절대 시작 금지. PR에 포함되면 reject.

---

## 10. 변경 이력

- **v1.0 (2026-04-29)**: 초안 작성. Core PRD v1.0의 Week 1-4 모노레포 마이그레이션 계획을 in-place 점진적 준비로 변경. Sprint A/B/C로 must-do 한정.
- **v1.1 (2026-04-29)**: Sprint A 섹션에 코드베이스 검증 결과 반영. 기존 부분 추상화(`LLMProvider`, `PtyManager`, `FsManager`) 활용으로 작업량 3-4일 → 2-3일 단축. 두 LLM 클라이언트 통합은 Sprint A 범위 외로 명시. 선결 조건(INP perf 수정 commit 정리, MM TerminalView 정리, 별도 브랜치) 추가.

---

**관련 문서**:
- `00_how_to_use_prd.md` — PRD 사용 가이드
- `01_marblo_core_architecture_prd.md` — 전체 아키텍처 (참조용, 일정은 본 문서 우선)
- `02_marblo_enterprise_prd.md` — Enterprise 상세 (Phase 1 시작 시 참조)
