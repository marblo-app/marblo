# Marblo Core Architecture PRD

**문서 버전**: v1.0  
**작성일**: 2026-04-19  
**작성자**: John (Dee)  
**목적**: Pro/Team 6월 런칭과 Enterprise 확장을 동시에 지원하는 아키텍처 기반 확립  
**타겟 독자**: Claude Code (개발 실행), 향후 합류할 팀 엔지니어

---

## 0. Executive Summary

Marblo는 이종 AI 에이전트(Claude Code, Gemini CLI, Codex CLI 등)를 가상 터미널로 물리적으로 분할 호출하여, 오케스트레이터(Claude Code)가 칸반 보드와 연동해 컨텍스트를 유지하며 태스크를 운영하는 설치형 데스크탑 애플리케이션이다.

본 문서는 **Pro/Team(B2C/SMB) 버전과 Enterprise(B2B) 버전이 하나의 코드베이스에서 파생**될 수 있도록, 핵심 아키텍처의 인터페이스, Hook 포인트, 빌드 시스템, 이벤트 스키마를 정의한다.

### 핵심 원칙

1. **인터페이스 우선**: 모든 외부 세계 접점(LLM, MCP, FS, Terminal)은 인터페이스로 추상화.
2. **Hook 포인트 심기**: Pro/Team에서는 no-op, Enterprise에서는 정책/감사/DLP 주입.
3. **빌드 타겟 분리**: 라이선스 키 기반 잠금 대신, 빌드 시점에 어댑터 교체.
4. **이벤트 구조화**: 모든 주요 동작을 구조화된 이벤트로 발행, 로컬 파일 또는 중앙 서버로 라우팅.
5. **특허 보호**: 가상 터미널 기반 물리적 분할 호출 + MCP/stdio 사전 주입 메시지는 폐쇄 소스 유지.

---

## 1. 제품 개요

### 1.1 제품 라인업

| 티어 | 가격 | 타겟 | 배포 형태 |
|---|---|---|---|
| Marblo Free | 무료 | 개인 체험 | 설치형, 프로젝트 1개 제한 |
| Marblo Pro | 19,000원/월 | 개인 개발자 (글로벌) | 설치형, 프로젝트 무제한, BYOK |
| Marblo Team | 29,000원/월 | 스타트업/팀 | 설치형, 팀 공유 기능 추가 |
| Marblo Enterprise | 별도 견적 | 대기업/금융/공공 | 온프렘 + Control Plane + Gateway Agent |

### 1.2 특허 보호 대상 기술

- **가상 터미널 기반 물리적 분할 에이전트 호출**: 여러 이종 에이전트를 독립 패널로 동시 실행
- **MCP / stdin·stdout 기반 사전 주입 메시지**: 에이전트 역할 부여 호출

본 기술은 소스 비공개 유지. 특허 출원 중(Patent Pending) 표기.

### 1.3 비사용자 요구사항 (Non-user Requirements)

- **성능**: 오케스트레이터 응답 지연, Gateway 오버헤드 포함 P95 < 5ms (LLM API 호출 외 처리 시간).
- **보안**: Enterprise는 온프렘/에어갭 환경에서 완전 작동.
- **확장성**: 동시 실행 에이전트 수 16개까지 단일 사용자 환경에서 보장.
- **크로스 플랫폼**: macOS, Windows, Linux 지원.

---

## 2. 아키텍처 전체 구조

### 2.1 레이어 다이어그램

```
┌─────────────────────────────────────────────────────┐
│  UI Layer (Electron Renderer)                       │
│  - 칸반 보드                                        │
│  - 가상 터미널 분할 패널                            │
│  - 에이전트 플로우 편집기                           │
└─────────────────────────────────────────────────────┘
                      ↕ IPC (Electron preload)
┌─────────────────────────────────────────────────────┐
│  Orchestrator Core (Electron Main + Worker)         │ ★ 특허
│  - 이종 에이전트 생명주기 관리                      │
│  - 가상 터미널 프로세스 포크/관리                   │
│  - MCP 사전 주입 메시지 빌더                        │
│  - 칸반 ↔ 에이전트 상태 동기화                      │
└─────────────────────────────────────────────────────┘
                      ↕ Adapter Interface
┌─────────────────────────────────────────────────────┐
│  🔒 Policy Hook Layer                               │
│  - 모든 외부 접점 호출의 단일 진입점                │
│  - Pro/Team: no-op passthrough                      │
│  - Enterprise: 정책 평가 + 감사 + 마스킹            │
└─────────────────────────────────────────────────────┘
                      ↕
┌──────────┬──────────┬──────────┬──────────────────┐
│ LLM      │ MCP      │ File     │ Terminal         │
│ Adapter  │ Adapter  │ Adapter  │ Adapter          │
└──────────┴──────────┴──────────┴──────────────────┘
```

### 2.2 프로세스 구조

```
Electron 앱 (메인 프로세스)
 ├─ Renderer Process (UI)
 ├─ Orchestrator Worker (Node.js Worker Thread)
 │   └─ Gateway Hook 호출 (in-process)
 ├─ Virtual Terminal Processes (자식 프로세스 N개)
 │   ├─ Claude Code (pty)
 │   ├─ Gemini CLI (pty)
 │   └─ Codex CLI (pty)
 └─ (Enterprise 전용) Local Gateway Agent (별도 프로세스, gRPC)
```

---

## 3. Adapter 인터페이스 정의

모든 Adapter는 TypeScript 인터페이스로 정의하며, **의존성 주입**으로 런타임에 구현체 결정.

### 3.1 LLMAdapter

```typescript
interface LLMRequest {
  model: string;
  messages: Message[];
  tools?: Tool[];
  stream?: boolean;
  metadata: RequestMetadata;  // ← Hook이 쓸 컨텍스트
}

interface RequestMetadata {
  projectId: string;
  agentRole: 'orchestrator' | 'subagent';
  agentType: 'claude-code' | 'gemini-cli' | 'codex-cli' | string;
  sessionId: string;
  userId: string;
  timestamp: number;
}

interface LLMResponse {
  content: string | AsyncIterable<Chunk>;
  usage: TokenUsage;
  metadata: ResponseMetadata;
}

interface LLMAdapter {
  call(request: LLMRequest): Promise<LLMResponse>;
  listModels(): Promise<ModelInfo[]>;
}
```

**Pro/Team 구현**: `DirectLLMAdapter` — Anthropic/OpenAI/Ollama 직접 호출  
**Enterprise 구현**: `GatewayLLMAdapter` — 로컬 Gateway Agent 경유

### 3.2 MCPAdapter

```typescript
interface MCPInvocation {
  serverId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  metadata: RequestMetadata;
}

interface MCPAdapter {
  listServers(): Promise<MCPServer[]>;
  listTools(serverId: string): Promise<MCPTool[]>;
  invoke(invocation: MCPInvocation): Promise<MCPResult>;
}
```

### 3.3 FileSystemAdapter

```typescript
interface FSOperation {
  operation: 'read' | 'write' | 'delete' | 'list';
  path: string;
  content?: Buffer;
  metadata: RequestMetadata;
}

interface FileSystemAdapter {
  access(op: FSOperation): Promise<FSResult>;
}
```

### 3.4 TerminalAdapter

```typescript
interface CommandExecution {
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
  metadata: RequestMetadata;
}

interface TerminalAdapter {
  execute(cmd: CommandExecution): Promise<ExecutionResult>;
  spawn(cmd: CommandExecution): Promise<PtyHandle>;  // 가상 터미널용
}
```

---

## 4. Hook 포인트 설계

### 4.1 Hook 인터페이스

```typescript
interface PolicyHook {
  // 요청 전 처리 (허용/거부, 변형)
  preRequest<T>(request: T, context: HookContext): Promise<HookDecision<T>>;
  
  // 응답 후 처리 (로깅, 필터링)
  postResponse<T, R>(request: T, response: R, context: HookContext): Promise<R>;
  
  // 에러 처리
  onError<T>(request: T, error: Error, context: HookContext): Promise<void>;
}

type HookDecision<T> = 
  | { action: 'allow'; request: T }
  | { action: 'deny'; reason: string }
  | { action: 'transform'; request: T };  // 예: PII 마스킹
```

### 4.2 Pro/Team 기본 Hook

```typescript
class NoOpPolicyHook implements PolicyHook {
  async preRequest<T>(request: T): Promise<HookDecision<T>> {
    return { action: 'allow', request };
  }
  async postResponse<T, R>(_: T, response: R): Promise<R> {
    return response;
  }
  async onError(): Promise<void> {}
}
```

### 4.3 Enterprise Hook 체인

```typescript
class EnterprisePolicyHook implements PolicyHook {
  constructor(
    private policyEngine: OPAPolicyEngine,
    private piiScanner: PIIScanner,
    private auditLogger: AuditLogger,
  ) {}
  
  async preRequest<T>(request: T, ctx: HookContext): Promise<HookDecision<T>> {
    // 1. 정책 평가 (OPA, < 1ms)
    const decision = await this.policyEngine.evaluate(request, ctx);
    if (decision.allow === false) {
      await this.auditLogger.logDenied(request, decision.reason, ctx);
      return { action: 'deny', reason: decision.reason };
    }
    
    // 2. PII 스캔 + 마스킹 (Hyperscan, < 5ms)
    const scanned = await this.piiScanner.scanAndMask(request);
    if (scanned.violations.length > 0) {
      await this.auditLogger.logPIIDetected(scanned, ctx);
      if (decision.maskPII) {
        return { action: 'transform', request: scanned.masked as T };
      }
      return { action: 'deny', reason: 'PII detected and mask not allowed' };
    }
    
    // 3. 감사 로그 큐잉 (비동기, < 1ms)
    this.auditLogger.enqueue({ type: 'request', request, ctx });
    
    return { action: 'allow', request };
  }
  
  async postResponse<T, R>(req: T, res: R, ctx: HookContext): Promise<R> {
    this.auditLogger.enqueue({ type: 'response', request: req, response: res, ctx });
    return res;
  }
}
```

---

## 5. 빌드 시스템 및 리포지토리 구조

### 5.1 모노레포 구성

```
marblo/
├── packages/
│   ├── core/                     # 🟢 공유 코어 (특허 기술 포함)
│   │   ├── orchestrator/
│   │   ├── virtual-terminal/
│   │   ├── mcp-runtime/
│   │   └── interfaces/           # Adapter 인터페이스
│   │
│   ├── adapters-standard/        # 🟢 Pro/Team 기본 어댑터
│   │   ├── llm-direct/
│   │   ├── mcp-direct/
│   │   ├── fs-local/
│   │   └── terminal-pty/
│   │
│   ├── adapters-gateway/         # 🔴 Enterprise 어댑터
│   │   ├── llm-gateway/
│   │   ├── mcp-gateway/
│   │   ├── fs-policy/
│   │   └── terminal-policy/
│   │
│   ├── hooks-noop/               # 🟢 Pro/Team Hook 구현
│   ├── hooks-enterprise/         # 🔴 Enterprise Hook 구현
│   │
│   ├── ui/                       # 🟢 공유 UI
│   │   ├── kanban/
│   │   ├── terminal-view/
│   │   └── flow-editor/
│   │
│   └── desktop-app/              # 🟢 Electron 쉘
│
├── apps/
│   ├── marblo-pro/               # Free/Pro/Team 빌드 타겟
│   │   └── build.config.ts       # adapters-standard + hooks-noop
│   └── marblo-enterprise/        # Enterprise 빌드 타겟
│       └── build.config.ts       # adapters-gateway + hooks-enterprise
│
├── services/                     # 🔴 Enterprise 전용 서비스
│   ├── gateway-agent/            # 로컬 Gateway Agent (Go)
│   ├── control-plane/            # 중앙 관리 서버 (Go + Next.js)
│   └── audit-store/              # 감사 로그 저장소
│
├── tools/
│   ├── build/                    # 빌드 스크립트
│   └── scripts/
│
├── pnpm-workspace.yaml
├── turbo.json
└── package.json
```

### 5.2 빌드 타겟 분리 원칙

- **Pro/Team 빌드**: `marblo-pro` 앱은 `adapters-standard` + `hooks-noop`만 번들. Enterprise 코드는 **바이너리에 포함되지 않음**.
- **Enterprise 빌드**: `marblo-enterprise` 앱은 `adapters-gateway` + `hooks-enterprise` 번들. 별도 Gateway Agent 프로세스 함께 패키징.

라이선스 키 기반 기능 잠금은 **사용하지 않음** (리버스 엔지니어링 위험, 고객 불신).

### 5.3 도구 선택

- **패키지 매니저**: pnpm (모노레포 효율)
- **빌드**: Turborepo (캐시, 병렬 빌드)
- **언어**: TypeScript (코어, UI, 어댑터), Go (Gateway Agent, Control Plane)
- **프레임워크**: Electron (데스크탑), React + Tailwind (UI)

---

## 6. 이벤트 스키마

모든 주요 동작은 구조화된 이벤트로 발행. Pro/Team은 로컬 파일(JSONL), Enterprise는 Gateway 경유 중앙 저장소로 전송.

### 6.1 기본 이벤트 구조

```typescript
interface MarbloEvent {
  eventId: string;              // UUID v7 (시간 순서 보장)
  eventType: EventType;
  timestamp: number;            // epoch ms
  version: string;              // 스키마 버전
  
  // 컨텍스트
  userId: string;
  projectId: string;
  sessionId: string;
  
  // 페이로드 (타입별 상이)
  payload: unknown;
  
  // Enterprise 전용 (옵셔널)
  tenantId?: string;
  policyDecision?: PolicyDecision;
}

type EventType = 
  | 'agent.spawned'
  | 'agent.terminated'
  | 'llm.request'
  | 'llm.response'
  | 'llm.denied'
  | 'mcp.invoked'
  | 'mcp.denied'
  | 'fs.accessed'
  | 'terminal.executed'
  | 'pii.detected'
  | 'policy.violated'
  | 'task.created'
  | 'task.updated';
```

### 6.2 스키마 버전 관리

- 모든 이벤트는 `version` 필드 필수.
- 하위 호환성을 유지하며 확장 (필드 추가만, 제거/변경 금지).
- 파괴적 변경 시 `version` 메이저 버전 증가.

---

## 7. 6월 런칭 전 반드시 해야 할 것

### 7.1 필수 작업 (4월 하순 ~ 5월 말)

**Week 1 (4/21 ~ 4/27)**
- [ ] 모노레포 구조 확정, pnpm + Turborepo 세팅
- [ ] Adapter 인터페이스 TypeScript 정의 (LLM/MCP/FS/Terminal)
- [ ] `hooks-noop`, `hooks-enterprise` 패키지 껍데기 생성

**Week 2 (4/28 ~ 5/4)**
- [ ] 기존 Marblo 코드를 `core` 패키지로 이전
- [ ] 기존 LLM 호출을 `DirectLLMAdapter`로 리팩토링
- [ ] Orchestrator가 Adapter 인터페이스에만 의존하도록 리팩토링

**Week 3 (5/5 ~ 5/11)**
- [ ] MCP, FS, Terminal 어댑터 리팩토링
- [ ] Hook 포인트 삽입 (모든 Adapter 호출이 Hook 경유)
- [ ] 이벤트 스키마 정의 및 로컬 JSONL 기록

**Week 4 (5/12 ~ 5/18)**
- [ ] Pro/Team 빌드 타겟 `marblo-pro` 완성
- [ ] 빌드 검증: Enterprise 코드가 `marblo-pro` 번들에 포함되지 않는지 확인
- [ ] 기본 벤치마크 (Hook 오버헤드 측정, no-op 상태)

**Week 5 (5/19 ~ 5/25)**
- [ ] 결제 인프라 (Stripe + Toss)
- [ ] 라이선스 키 발급/검증 시스템
- [ ] Free → Pro 업그레이드 UX
- [ ] 온보딩 문서 + 튜토리얼 영상

**Week 6 (5/26 ~ 6/1)**
- [ ] 베타 배포, 피드백 수집
- [ ] 버그 수정, 안정화
- [ ] 런칭 콘텐츠 준비

### 7.2 6월 런칭 (목표)

- Product Hunt 런칭
- 유튜브 "Marblo 탄생기" 영상
- 사전 등록자 얼리버드 배포
- B2B 영업 개시 (강의 투어, 대기업 IT 자회사 컨택)

### 7.3 연기 가능 (6월 이후)

- Enterprise Gateway Agent 실제 구현 (7월부터 첫 PoC와 함께)
- Control Plane 관리 콘솔
- 한국 특화 MCP 번들
- SSO/SAML 통합

**연기해도 되는 이유**: 6월 런칭 후 영업 사이클로 첫 PoC 고객 확보까지 보통 2~3개월. 그 사이에 Enterprise 구현.

---

## 8. 성능 목표

| 지표 | 목표 | 측정 방법 |
|---|---|---|
| Adapter Hook 오버헤드 (Pro/Team) | P95 < 1ms | 마이크로벤치마크 |
| Hook 오버헤드 (Enterprise, 로컬 Gateway) | P95 < 5ms | 통합 테스트 |
| 정책 평가 시간 (OPA 메모리) | P95 < 0.5ms | OPA 프로파일러 |
| PII 스캔 시간 (Hyperscan) | P95 < 3ms | 벤치마크 suite |
| 동시 에이전트 16개 throughput | 초당 100 LLM 호출 | 스트레스 테스트 |

---

## 9. 보안 및 컴플라이언스 기반

Enterprise 확장 시 대응해야 할 표준 리스트. Pro/Team은 해당 없음, 하지만 **아키텍처가 이를 차단하면 안 됨**.

- **ISMS-P** (국내 정보보호 인증): 감사 로그, 접근 통제, 암호화 요구
- **전자금융감독규정** (금융권): 망분리 환경 운영, 로그 5년 보관
- **공공기관 보안 요구사항**: 에어갭, 국내 데이터 보관, CC 인증 준비
- **SOC 2** (글로벌 대응): 중장기 목표

본 아키텍처는 위 표준을 **직접 만족시키지 않지만**, Enterprise 모듈 추가 시 만족 가능한 구조를 보장한다.

---

## 10. 리스크 및 대응

| 리스크 | 영향 | 대응 |
|---|---|---|
| Adapter 인터페이스 잘못 설계 | Enterprise 확장 시 대규모 리팩토링 | 6월 런칭 전 Gateway PoC로 검증 |
| Hook 오버헤드 체감 | 사용자 이탈 | 벤치마크 지속 측정, no-op 경로 최적화 |
| 모노레포 복잡도 | 개발 속도 저하 | Turborepo 캐시, 명확한 패키지 경계 |
| 6월 런칭 지연 | 예산 편성 시즌 놓침 | Enterprise 기능은 연기 가능 영역으로 분리 |

---

## 11. Claude Code 작업 지침 (개발자 전달용)

이 PRD를 기반으로 Claude Code에 작업 지시 시:

1. **Week 1 작업부터 순차 진행**: 섹션 7.1의 체크박스 순서대로.
2. **인터페이스 우선**: 구현 전 반드시 TypeScript 인터페이스 먼저 정의.
3. **테스트 주도**: 각 Adapter에 단위 테스트 + 계약 테스트(contract test) 작성.
4. **특허 기술 영역 주의**: `packages/core/virtual-terminal/`, `packages/core/mcp-runtime/`는 특허 관련 코드. 주석으로 "Patent Pending" 표시.
5. **빌드 검증 자동화**: CI에 "Enterprise 코드가 Pro 빌드에 포함 안 됨" 검증 스크립트 포함.

---

**다음 문서**: `02_marblo_enterprise_prd.md` — Enterprise 전용 기능 상세 설계

