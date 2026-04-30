# Marblo Enterprise PRD

**문서 버전**: v1.0  
**작성일**: 2026-04-19  
**작성자**: John (Dee)  
**목적**: 국내 대기업/금융/공공을 위한 엔터프라이즈 에이전트 거버넌스 솔루션 구축  
**타겟 독자**: Claude Code (개발 실행), 향후 Enterprise PoC 참여 고객 기술팀

---

## 0. Executive Summary

Marblo Enterprise는 Pro/Team의 모든 기능을 포함하며, 추가로 **조직 단위의 보안·거버넌스·감사 요구사항**을 만족하는 엔터프라이즈 에디션이다.

핵심 차별점:

- **이종 에이전트(Claude Code, Gemini CLI, Codex CLI, 사내 LLM)를 통합 오케스트레이션**하되, 
- **모든 외부 LLM 호출과 도구 사용을 중앙 게이트웨이를 통해 통제·감사·마스킹**하고, 
- **망분리 환경에서도 완전히 동작**하는 유일한 국내 솔루션.

### 타겟 고객

1순위: 대기업 IT 자회사 (삼성SDS, 현대오토에버, SK C&C, LG CNS, 포스코DX 등)  
2순위: 금융권 (은행/증권/보험 IT 부문)  
3순위: 공공/국방  
4순위: 망분리 규제 받는 중견기업

### 가격 모델

- **사이트 라이선스**: 연 5천만 ~ 5억 (조직 규모별)
- **도입 컨설팅/구축**: 건당 1.5 ~ 5억
- **연간 기술지원/유지보수**: 라이선스의 20%

---

## 1. 제품 범위

### 1.1 Marblo Pro/Team 대비 추가 기능

| 범주 | 기능 | Pro/Team | Enterprise |
|---|---|---|---|
| **보안 게이트웨이** | 로컬 Gateway Agent | ✗ | ✓ |
| | LLM 호출 프록시 | ✗ | ✓ |
| | PII/DLP 탐지 및 마스킹 | ✗ | ✓ |
| | 외부 LLM 선택적 차단 | ✗ | ✓ |
| **정책 엔진** | 중앙 정책 관리 (OPA) | ✗ | ✓ |
| | 프로젝트별 에이전트 허용 정책 | ✗ | ✓ |
| | 모델 라우팅 정책 | ✗ | ✓ |
| **감사 & 컴플라이언스** | 중앙 감사 로그 (WORM) | ✗ | ✓ |
| | ISMS-P 대응 리포트 | ✗ | ✓ |
| | 전자금융감독규정 로그 5년 보관 | ✗ | ✓ |
| **조직 관리** | SSO (SAML/OIDC/LDAP) | ✗ | ✓ |
| | RBAC (역할 기반 권한) | ✗ | ✓ |
| | 팀/프로젝트/조직 계층 | 단일 팀 | 계층 구조 |
| | 관리자 대시보드 | ✗ | ✓ |
| **한국 특화 통합** | 온프렘 Jira/Confluence/GitLab | ✗ | ✓ |
| | 국내 DB (티베로/알티베이스) | ✗ | ✓ |
| | 그룹웨어 (더존/그루웨어) | ✗ | ✓ |
| | 공공/금융 API | ✗ | ✓ |
| **배포/운영** | 오프라인 설치 패키지 | ✗ | ✓ |
| | 에어갭 모드 | ✗ | ✓ |
| | K8s Helm 차트 | ✗ | ✓ |
| | 고가용성 (HA) 구성 | ✗ | ✓ |
| **지원** | 이메일 지원 | Team만 | ✗ |
| | SLA 기반 기술지원 | ✗ | ✓ |
| | 전담 기술 매니저 | ✗ | ✓ (추가 계약) |

---

## 2. 시스템 아키텍처

### 2.1 전체 구조

```
┌──────────────────────────────────────────────────────────────┐
│  개발자 PC (기업 내부망)                                     │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐     │
│  │  Marblo Enterprise Desktop (Electron)               │     │
│  │   ├─ UI Layer                                       │     │
│  │   ├─ Orchestrator (특허 기술)                       │     │
│  │   ├─ Virtual Terminal Panels                        │     │
│  │   │   ├─ Claude Code                                │     │
│  │   │   ├─ Gemini CLI                                 │     │
│  │   │   └─ Codex CLI                                  │     │
│  │   └─ Gateway Adapter → [gRPC/IPC] → Gateway Agent   │     │
│  └─────────────────────────────────────────────────────┘     │
│                         ↕                                    │
│  ┌─────────────────────────────────────────────────────┐     │
│  │  🔒 Local Gateway Agent (Go, 별도 프로세스)         │     │
│  │   ├─ Policy Engine (OPA, 메모리 캐시)               │     │
│  │   ├─ PII Scanner (Hyperscan)                        │     │
│  │   ├─ Audit Log Buffer (로컬 SQLite fallback)        │     │
│  │   ├─ Model Router                                   │     │
│  │   └─ LLM/MCP Forwarder                              │     │
│  └─────────────────────────────────────────────────────┘     │
│           ↓ 동기 호출              ↓ 비동기 업로드           │
│  ┌──────────────────┐      ┌─────────────────────────┐       │
│  │ 라우팅된 LLM     │      │ Control Plane로 로그    │       │
│  │  ├─ 사내 vLLM    │      │ (HTTPS/gRPC, 배치)      │       │
│  │  ├─ Ollama       │      └─────────────────────────┘       │
│  │  └─ 외부 Claude  │                    ↓                   │
│  │     (허용 시)    │                    ↓                   │
│  └──────────────────┘                    ↓                   │
└──────────────────────────────────────────┼───────────────────┘
                                           ↓
┌──────────────────────────────────────────────────────────────┐
│  🏢 Control Plane (본사 서버실, K8s 배포)                   │
│                                                              │
│  ┌───────────────────┐ ┌──────────────────┐ ┌─────────────┐ │
│  │ Admin Console     │ │ Policy Distributor│ │ SSO Gateway │ │
│  │ (Next.js)         │ │ (Go)              │ │ (SAML/OIDC) │ │
│  └───────────────────┘ └──────────────────┘ └─────────────┘ │
│                                                              │
│  ┌───────────────────┐ ┌──────────────────┐ ┌─────────────┐ │
│  │ Audit Log Store   │ │ Policy Store     │ │ User/Org DB │ │
│  │ (PostgreSQL+WORM) │ │ (OPA bundles)    │ │ (PostgreSQL)│ │
│  └───────────────────┘ └──────────────────┘ └─────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 Local Gateway Agent (핵심)

**역할**: 성능 저하 없이 실시간 정책 결정.

**배포 형태**: Go 바이너리, 개발자 PC에 Marblo 설치 시 함께 설치 + 자동 실행 (systemd/launchd/Windows Service).

**통신 프로토콜**: Electron 앱 ↔ Gateway Agent는 **gRPC over Unix domain socket** (동일 머신, 1ms 미만 오버헤드).

**주요 컴포넌트**:

- **Policy Engine**: OPA in-process. 컴파일된 Rego 정책을 메모리에 로드, 평가 < 0.5ms.
- **PII Scanner**: Hyperscan 기반 정규식 매칭 엔진. 한국어 특화 패턴(주민번호, 계좌, 전화번호) 포함.
- **Model Router**: 정책 기반 LLM 엔드포인트 선택. 예: `{project: secret} → {endpoint: internal-vllm}`.
- **Audit Log Buffer**: 로컬 SQLite에 임시 저장, 백그라운드 워커가 Control Plane으로 배치 업로드.
- **LLM/MCP Forwarder**: 실제 LLM API, MCP 서버로 요청 프록시.

**장애 복원력**:
- Control Plane 연결 끊김 시: 마지막 캐시된 정책으로 계속 동작
- 로컬 SQLite에 감사 로그 지속 저장, 복구 후 일괄 업로드
- 감사 로그 손실 방지: 디스크 fsync + WAL

### 2.3 Control Plane (중앙 관리 서버)

**역할**: 정책 관리, 감사 로그 수집, 관리자 UI, SSO.

**배포**: 고객 사내 K8s 클러스터 또는 VM. Helm 차트로 원클릭 배포.

**주요 컴포넌트**:

- **Admin Console**: Next.js 기반 웹 UI. 정책 편집, 사용자 관리, 로그 조회, 리포트 생성.
- **Policy Distributor**: 정책 변경 시 모든 Gateway Agent에 push (gRPC streaming).
- **SSO Gateway**: SAML 2.0, OIDC, LDAP 연동. 기업 기존 IdP(Active Directory, Okta)와 통합.
- **Audit Log Store**: PostgreSQL 기반. WORM 옵션 (행 단위 UPDATE/DELETE 금지). 규정 요구 시 외부 immutable storage 연동 가능.
- **Policy Store**: OPA Rego 번들 저장소. 버전 관리 + 롤백 지원.
- **User/Org DB**: 조직 계층, 사용자, 역할, 권한 관리.

### 2.4 데이터 흐름 (LLM 호출 시나리오)

```
1. 사용자가 Claude Code에 프롬프트 입력
2. Claude Code → Marblo Orchestrator → GatewayLLMAdapter
3. Adapter → [gRPC] → Local Gateway Agent
4. Agent: 정책 평가 (OPA) — "이 프로젝트는 외부 Claude 허용? 사용자 권한?"
5. Agent: PII 스캔 — 프롬프트에 주민번호 있는지
6. Agent: 정책에 따라 모델 결정 (외부 Claude or 사내 vLLM)
7. Agent: 감사 로그 버퍼에 이벤트 큐잉 (비동기)
8. Agent: 실제 LLM API 호출
9. Agent: 응답 수신, 응답 감사 로그 큐잉
10. Agent → [gRPC] → Adapter → Orchestrator → Claude Code
11. [백그라운드] Agent → Control Plane으로 배치 로그 업로드
```

성능 목표: 1~10단계 중 Gateway 관련 오버헤드 P95 < 5ms (LLM API 호출 시간 제외).

---

## 3. 정책 엔진 (OPA) 상세

### 3.1 정책 카테고리

**3.1.1 모델 라우팅 정책**

```rego
package marblo.routing

default endpoint := "internal-vllm"

# 공개 프로젝트는 외부 Claude 허용
endpoint := "claude-sonnet-4" {
    input.project.classification == "public"
    input.user.roles[_] == "developer"
}

# 기밀 프로젝트는 반드시 사내 LLM
endpoint := "internal-vllm" {
    input.project.classification == "confidential"
}
```

**3.1.2 MCP 도구 허용 정책**

```rego
package marblo.mcp

default allow := false

# 사내 GitLab MCP는 항상 허용
allow {
    input.server.id == "internal-gitlab"
}

# 외부 GitHub MCP는 공개 프로젝트에서만
allow {
    input.server.id == "github"
    input.project.classification == "public"
}
```

**3.1.3 터미널 명령 차단 정책**

```rego
package marblo.terminal

deny[msg] {
    contains(input.command, "curl")
    contains(input.command, "| sh")
    msg := "파이프 셸 실행 금지 (원격 스크립트 실행 방지)"
}

deny[msg] {
    startswith(input.path, "/etc/")
    input.operation == "write"
    msg := "시스템 디렉토리 쓰기 금지"
}
```

### 3.2 정책 배포 흐름

```
관리자가 Admin Console에서 정책 편집
    ↓
Policy Store에 저장 + 버전 증가
    ↓
Policy Distributor가 변경 감지
    ↓
모든 Gateway Agent에 gRPC streaming으로 push
    ↓
Agent가 새 번들 컴파일, in-memory 교체
    ↓
이후 요청부터 새 정책 적용 (평균 1초 이내)
```

### 3.3 정책 테스트 프레임워크

- 정책 작성 시 Rego 테스트 필수
- Admin Console에 "정책 시뮬레이터" 제공: 과거 요청 샘플에 새 정책 적용 시 변경 사항 미리보기

---

## 4. PII/DLP 스캐너

### 4.1 한국어 특화 패턴

**주민등록번호**
- 패턴: `\d{6}[-]?[1-4]\d{6}`
- 체크섬 검증 (마지막 자리)
- 마스킹: `000000-0******`

**사업자등록번호**
- 패턴: `\d{3}-?\d{2}-?\d{5}`
- 체크섬 검증

**계좌번호**
- 은행별 패턴 (국민/신한/우리/하나 등)
- 예: `\d{3,6}-?\d{2,6}-?\d{6,10}`

**전화번호**
- 휴대폰: `01[0-9]-?\d{3,4}-?\d{4}`
- 일반: `0\d{1,2}-?\d{3,4}-?\d{4}`

**이메일**: 표준 RFC 패턴

**카드번호**: 16자리, Luhn 체크섬 검증

### 4.2 커스텀 패턴 (기업별)

관리자가 Admin Console에서 추가 가능:
- 사내 시스템 코드명 (예: 프로젝트 코드네임)
- 내부 계정번호 형식
- API 키 형식

### 4.3 마스킹 정책

```
{
  "주민번호": { "action": "deny" | "mask", "mask_format": "preserve_first_6" },
  "계좌번호": { "action": "mask", "mask_format": "last_4_only" },
  "전화번호": { "action": "allow" },  // 공개 연락처는 허용
  ...
}
```

### 4.4 성능 최적화

- **Hyperscan** 라이브러리 사용 (Intel 오픈소스)
- 수백 개 정규식을 병렬 매칭, < 3ms
- 컴파일된 데이터베이스는 메모리에 상주

---

## 5. 감사 로그

### 5.1 이벤트 종류

Core PRD 섹션 6에 정의된 이벤트 + Enterprise 확장:

- `auth.login`, `auth.logout`, `auth.sso_failed`
- `policy.changed`, `policy.deployed`
- `admin.user_created`, `admin.role_assigned`
- `report.generated`
- `export.requested`

### 5.2 저장 요구사항

- **변경 불가능(WORM)**: INSERT만 허용, UPDATE/DELETE 금지 (DB 수준 제약)
- **보관 기간**: 기본 5년 (전자금융감독규정 대응), 정책으로 조정 가능
- **암호화**: 저장 시 AES-256, 전송 시 TLS 1.3
- **서명**: 주기적 해시 체인 서명으로 무결성 증명

### 5.3 조회 및 리포트

**Admin Console 조회 기능**:
- 시간 범위 필터
- 사용자/프로젝트/에이전트 필터
- 정책 위반만 필터
- 전문 검색 (PostgreSQL full-text)

**표준 리포트 템플릿**:
- ISMS-P 연간 감사 리포트
- 월간 사용 현황 (토큰, 비용, 에이전트별)
- 정책 위반 상세 리포트
- 사용자 활동 로그

**Export 형식**: CSV, JSON, PDF

---

## 6. SSO 및 조직 관리

### 6.1 지원 IdP

- **SAML 2.0**: Active Directory Federation Services, Okta, 카카오워크
- **OIDC**: Google Workspace, Azure AD, Auth0
- **LDAP**: 전통적 AD 연동

### 6.2 조직 계층 모델

```
Organization (최상위)
  └─ Department (본부/부서)
      └─ Team (팀)
          └─ Project (프로젝트)
              └─ Members (개발자)
```

각 계층마다 정책 상속/오버라이드 가능.

### 6.3 RBAC 역할

기본 역할:
- **Org Admin**: 전사 관리자 (정책 편집, 모든 로그 조회)
- **Dept Admin**: 본부 관리자 (본부 범위 내)
- **Team Lead**: 팀 리더 (팀 프로젝트 관리)
- **Developer**: 개발자 (프로젝트 내 Marblo 사용)
- **Auditor**: 감사자 (읽기 전용, 모든 로그 조회)

커스텀 역할 생성 가능.

---

## 7. 한국 특화 MCP 번들

### 7.1 1차 번들 (PoC 시점 필수)

**개발 도구**
- 사내 Jira (Data Center 버전) MCP
- 사내 Confluence MCP
- 사내 GitLab (CE/EE) MCP
- 사내 Bitbucket Server MCP

**DB**
- 티베로 MCP
- 알티베이스 MCP
- 큐브리드 MCP
- Oracle (온프렘) MCP

### 7.2 2차 번들 (첫 PoC 이후 확장)

**그룹웨어**
- 더존 Wehago API MCP
- 그루웨어 MCP
- 이카운트 ERP MCP

**공공 API**
- 나라장터 API MCP
- 국세청 홈택스 API MCP
- 전자세금계산서 MCP

**금융 API**
- 오픈뱅킹 API MCP
- 금결원 API MCP

### 7.3 MCP 개발 표준

각 MCP는 다음 기준 충족:
- Marblo 정책 엔진과 연동 (모든 도구 호출이 정책 평가 통과)
- 감사 로그 자동 발행
- 국내 보안 규제 준수 (네트워크 정책, 인증)
- Go 또는 TypeScript로 작성
- 단위 테스트 커버리지 80% 이상

---

## 8. 배포 및 운영

### 8.1 배포 옵션

**옵션 A: 완전 온프렘**
- 고객 사내 K8s 클러스터에 Control Plane 배포
- 개발자 PC에 Desktop + Gateway Agent 설치
- 외부 네트워크 접속 없음 (에어갭 가능)

**옵션 B: 하이브리드**
- Control Plane은 고객 VPC 내 (AWS/NHN/Naver Cloud)
- Gateway Agent는 개발자 PC
- 외부 LLM(Claude 등)은 허용 정책에 한해 호출

**옵션 C: Marblo 관리형** (향후 옵션)
- 당사 관리 SaaS 형태
- 중견기업 대상, 망분리 규제 없는 고객

### 8.2 설치 패키지

- **Desktop**: macOS(.dmg), Windows(.msi), Linux(.deb, .rpm)
- **Gateway Agent**: Desktop 설치 시 자동 포함
- **Control Plane**: Helm 차트 + Docker 이미지 + 오프라인 tarball

### 8.3 라이선스 관리

- **오프라인 라이선스**: 서명된 라이선스 파일, Control Plane에 업로드
- **라이선스 정책**: 조직 내 동시 사용자 수, 유효 기간, 허용 기능 명시
- **만료 처리**: 만료 30일 전부터 경고, 만료 후 grace period 7일

### 8.4 업데이트 전략

- **보안 패치**: 월 1회 정기 릴리스, 긴급 패치는 비정기
- **기능 업데이트**: 분기 1회
- **업데이트 배포**: Control Plane 내 리포지토리, 오프라인 패키지 다운로드 후 업로드

### 8.5 고가용성

- **Control Plane**: 최소 3노드 K8s, PostgreSQL 레플리카
- **Gateway Agent**: 로컬 프로세스이므로 HA 무관 (장애 시 재시작)
- **감사 로그**: 로컬 SQLite 버퍼로 Control Plane 장애 시에도 무손실

---

## 9. 개발 단계 (Phased Delivery)

### Phase 1: PoC MVP (2026-07 ~ 2026-09)

**목표**: 첫 PoC 고객에게 시연 가능한 수준.

**포함**:
- Local Gateway Agent (Go 기반, 기본 정책 평가 + PII 스캔)
- Control Plane MVP (Admin Console + 감사 로그 수집)
- OPA 기본 정책 3종 (모델 라우팅, MCP 허용, 터미널 차단)
- PII 스캐너 (주민번호, 계좌, 전화번호)
- 1차 MCP 번들 (Jira/Confluence/GitLab)
- SAML SSO

**제외** (Phase 2로 연기):
- 오프라인 라이선스 시스템
- 고가용성 구성
- 2차 MCP 번들
- 세부 리포트 템플릿

### Phase 2: First Paying Customer (2026-10 ~ 2026-12)

**목표**: 첫 유료 Enterprise 계약 체결, 프로덕션 운영.

**포함**:
- Phase 1 모든 기능의 프로덕션 완성도
- 오프라인 라이선스 + 에어갭 모드
- K8s Helm 차트 + 설치 자동화
- 2차 MCP 번들 일부 (그룹웨어 1종)
- ISMS-P 대응 리포트 템플릿
- 정책 시뮬레이터

### Phase 3: Scale (2027 Q1~Q2)

**목표**: 3~5개 고객 동시 운영, 안정화.

**포함**:
- 고가용성 Control Plane
- 2차 MCP 번들 전체
- 금융 API MCP
- SOC 2 준비
- 해외 확장 (일본 MCP 번들 등)

---

## 10. 성공 지표 (KPI)

### 10.1 개발/제품 지표

- **Gateway 오버헤드**: P95 < 5ms (목표 유지)
- **정책 배포 지연**: 변경 후 모든 Agent 반영까지 < 10초
- **감사 로그 유실률**: < 0.01%
- **설치 성공률**: 첫 시도 > 95%

### 10.2 사업 지표

**2026**:
- Enterprise PoC 수주: 3건 이상
- 유료 계약 전환: 1건 이상
- Enterprise 매출: 1억 이상

**2027**:
- Enterprise 고객: 5~8곳
- Enterprise 매출: 10억 이상
- 계열사 확산: 최소 1개 고객에서 2개 이상 계열사

---

## 11. 리스크

| 리스크 | 확률 | 영향 | 대응 |
|---|---|---|---|
| 첫 PoC 고객 확보 실패 | 중 | 치명 | 강의 투어 + 콘텐츠로 리드 다각화, 3월 전부터 관계 구축 |
| 보안 인증(ISMS-P 등) 요구 | 고 | 높음 | Phase 2에서 인증 준비, 파트너사 활용 |
| 대기업 IT 자회사와 경쟁 | 고 | 중 | "솔루션 공급" 포지셔닝 (파트너십 추구) |
| 외산 솔루션 국내 진입 | 중 | 중 | 한국 특화 MCP + 특허 + 국내 레퍼런스로 해자 |
| 혼자서 개발 리소스 부족 | 고 | 높음 | Phase 1은 Go 개발자 1명 계약직, Phase 2부터 정규 채용 |

---

## 12. Claude Code 작업 지침

이 PRD를 기반으로 Claude Code 작업 지시 시:

1. **Core PRD 완료 후 착수**: `01_marblo_core_architecture_prd.md`의 Week 1~6 완료 후.
2. **Phase 1부터 순차 개발**: 섹션 9.1 Phase 1 항목을 스프린트로 분할.
3. **Go 모듈 우선**: Gateway Agent가 첫 작업. Electron 쪽은 GatewayLLMAdapter만 먼저.
4. **OPA 학습**: Rego 문법 숙지 필요. 공식 튜토리얼 참고.
5. **한국어 패턴 테스트 데이터**: PII 스캐너 개발 시 실제 형식의 테스트 데이터셋 구축 (단, 실 개인정보 사용 금지).
6. **특허 관련 주의**: Enterprise 코드에서 Core의 특허 기술 영역을 변경하지 말 것. 인터페이스만 사용.

---

## 13. 영업용 간이 자료 변환 가이드

본 PRD는 개발용이므로, 영업 자료 변환 시 다음 구조로 재정리:

1. **1페이지 요약**: 문제 → 해결 → 차별점 (한국 특화 + 특허)
2. **기술 아키텍처 다이어그램**: 섹션 2.1을 시각화
3. **벤치마크 결과**: 성능 수치 (< 5ms 오버헤드)
4. **컴플라이언스 매트릭스**: ISMS-P, 전자금융감독규정 대응 체크리스트
5. **도입 레퍼런스**: (첫 PoC 완료 후 추가)
6. **가격 및 도입 단계**: PoC → 본 계약 → 확장

---

**관련 문서**:
- `01_marblo_core_architecture_prd.md` — Core 아키텍처 (이 문서의 선행 조건)
- (추후) `03_marblo_gateway_agent_spec.md` — Gateway Agent 기술 스펙
- (추후) `04_marblo_mcp_bundle_spec.md` — 한국 특화 MCP 번들 명세

