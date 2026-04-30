# Marblo PRD 사용 가이드

**목적**: Claude Code에서 이 PRD들을 사용해 실제 개발 작업을 진행하는 방법.

---

## 1. 파일 구성

```
marblo_prd/
├── 00_how_to_use_prd.md                    ← 이 문서
├── 01_marblo_core_architecture_prd.md      ← 공유 코어 아키텍처 (먼저)
└── 02_marblo_enterprise_prd.md             ← Enterprise 확장 (Core 이후)
```

---

## 2. Claude Code에서 작업 시작하기

### 2.1 PRD 파일을 프로젝트 루트에 배치

```bash
# Marblo 프로젝트 루트에서
mkdir -p docs/prd
cp 01_marblo_core_architecture_prd.md docs/prd/
cp 02_marblo_enterprise_prd.md docs/prd/
cp 00_how_to_use_prd.md docs/prd/
```

### 2.2 Claude Code 시작 프롬프트 (예시)

**Week 1 작업 시작**:

```
@docs/prd/01_marblo_core_architecture_prd.md 를 참고해서 Week 1 작업을 시작해줘.

오늘 할 일:
1. 현재 Marblo 코드베이스를 pnpm + Turborepo 기반 모노레포 구조로 전환
2. 섹션 5.1의 리포지토리 구조에 맞게 packages/ 디렉토리 생성
3. packages/core/interfaces/ 에 섹션 3의 Adapter 인터페이스 TypeScript 정의 작성
4. packages/hooks-noop/ 와 packages/hooks-enterprise/ 패키지 껍데기 생성

진행 전에 현재 코드 구조 확인하고, 마이그레이션 계획 보여줘.
```

**Week 2 작업**:

```
@docs/prd/01_marblo_core_architecture_prd.md Week 2 작업 진행.

1. 기존 Marblo 코드를 packages/core/ 로 이전 (virtual-terminal, orchestrator, mcp-runtime 분리)
2. 기존 LLM 호출을 DirectLLMAdapter 구현체로 래핑
3. Orchestrator가 LLMAdapter 인터페이스에만 의존하도록 리팩토링
4. 변경 후 기존 기능이 그대로 작동하는지 통합 테스트 실행

특허 기술 영역(virtual-terminal, mcp-runtime)에 주석 "Patent Pending" 추가.
```

**Enterprise Phase 1 착수**:

```
@docs/prd/02_marblo_enterprise_prd.md Phase 1 MVP 개발 시작.

섹션 9.1 Phase 1 범위로 작업:
1. services/gateway-agent/ Go 모듈 스캐폴딩
2. 섹션 2.2의 Local Gateway Agent 컴포넌트 구조대로 패키지 분리
3. OPA 라이브러리 통합 (go-opa)
4. gRPC 서버 기본 (Electron 앱과 통신용)
5. 섹션 3의 기본 정책 3종을 Rego로 작성, 테스트 포함

Core PRD의 인터페이스와 연계되도록 확인하고, 변경 필요시 Core PRD에 제안사항 남겨줘.
```

### 2.3 작업 컨텍스트 유지

각 세션 시작 시 다음을 명시:

- **현재 Phase**: "Core Week 3" / "Enterprise Phase 1 Sprint 2" 등
- **선행 완료 작업**: "Week 1, 2는 완료됨" 
- **이번 세션 목표**: 체크박스 하나 또는 여러 개

---

## 3. PRD 업데이트 원칙

### 3.1 언제 PRD를 업데이트하나

- 새로운 요구사항 발견 시
- 기술 선택 변경 시 (예: PostgreSQL → ClickHouse)
- 일정 변경 시
- 첫 PoC 고객 피드백 반영 시

### 3.2 업데이트 방식

1. 문서 상단 "문서 버전"을 증가 (v1.0 → v1.1)
2. 변경 사항을 Git 커밋 메시지에 명시
3. 주요 변경은 각 섹션 하단에 "Changelog" 추가

### 3.3 Claude Code에게 업데이트 요청

```
@docs/prd/01_marblo_core_architecture_prd.md 섹션 3.1 LLMAdapter 인터페이스에 
streaming 지원을 위한 필드 추가가 필요해. 

RequestMetadata에 `stream: boolean` 필드 추가하고, 
LLMResponse의 content 타입을 AsyncIterable<Chunk> 포함으로 확장해줘.

변경 후 기존 구현체(DirectLLMAdapter)도 업데이트하고, 
문서 버전 v1.0 → v1.1로 올리고 Changelog 섹션 추가해줘.
```

---

## 4. 우선순위 가이드

### 4.1 6월 런칭까지 (Pro/Team)

**절대 양보 불가**:
- Adapter 인터페이스 설계 (Core PRD 섹션 3)
- Hook 포인트 심기 (Core PRD 섹션 4)
- 빌드 타겟 분리 (Core PRD 섹션 5.2)
- 이벤트 스키마 (Core PRD 섹션 6)
- Pro/Team 기본 기능 안정화

**연기 가능**:
- Enterprise Gateway Agent 구현
- Control Plane
- 한국 특화 MCP 번들

### 4.2 6월 런칭 이후 (Enterprise)

**우선순위 1 (첫 PoC 전까지, 7~9월)**:
- Gateway Agent MVP
- Control Plane 최소 기능
- 정책 엔진 기본 3종
- PII 스캐너 한국어 패턴
- 1차 MCP 번들 (Jira/Confluence/GitLab)
- SAML SSO

**우선순위 2 (첫 PoC 완료 후, 10~12월)**:
- 오프라인 라이선스
- 에어갭 배포
- ISMS-P 대응 리포트
- 2차 MCP 번들 시작

---

## 5. 개발 원칙 (PRD에 암묵적으로 깔린 것들)

Claude Code에게 매번 상기시킬 필요는 없지만, 염두에 둘 것:

1. **인터페이스 우선**: 구현 코드보다 인터페이스 정의가 먼저.
2. **테스트 주도**: 주요 로직은 단위 테스트 + 통합 테스트. 특히 Adapter와 Hook.
3. **성능 측정**: 벤치마크를 CI에 포함, 목표 수치 회귀 시 빌드 실패.
4. **보안 기본값**: 기본값은 항상 "거부", 명시적 허용 정책이 있을 때만 통과.
5. **감사 추적**: 모든 중요 동작은 이벤트 발행. 사후 디버깅의 핵심.
6. **특허 기술 보호**: Core 패키지 virtual-terminal, mcp-runtime 파일 상단에 Patent Pending 주석.
7. **한국어 주석/문서**: 개발 과정에서 작성되는 설계 문서, 주석은 한국어 OK. 단, 코드 식별자는 영어.

---

## 6. 외부 참여자에게 공유 시

### 6.1 Enterprise PoC 고객 기술팀에게

PRD 전체를 그대로 공유하지 말고, 다음만 선별 공유:

- Core PRD 섹션 0, 1, 2 (개요, 아키텍처)
- Enterprise PRD 섹션 0, 1, 2, 3, 4, 5, 6, 8 (제품 범위, 아키텍처, 정책, 보안, 컴플라이언스, 배포)

**공유하지 말 것**:
- 일정 (섹션 9 Phase)
- 개발 체크리스트
- 리스크 섹션
- 가격 정책
- 성공 지표

### 6.2 Go 개발자 계약직 채용 시

- Enterprise PRD 섹션 2 (아키텍처)
- Core PRD 섹션 3 (인터페이스)
- 작업 범위: "services/gateway-agent/ 개발"

### 6.3 변리사/법무

- Core PRD 섹션 0.3 (특허 보호 대상)
- 관련 코드 위치 명시: `packages/core/virtual-terminal/`, `packages/core/mcp-runtime/`

---

## 7. 지속적 관리

- **월 1회 PRD 리뷰**: 반영된 변경 사항 정리
- **분기별 전체 재검토**: 전략 변경 여부 확인
- **첫 PoC 완료 후 대규모 업데이트**: 실전 피드백 반영

---

**연락처/책임자**: John (Dee)
