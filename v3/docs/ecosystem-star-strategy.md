# 생태계 리포 스타·강화 전략 — 리빙 문서

> **문서 성격: 리빙 문서(living document).** 한 번 쓰고 덮는 계획서가 아니라, 생태계 리포를 만질 때마다 먼저 열어 보고 결정이 바뀌면 그 자리에서 고치는 상시 참조 문서다.
>
> | 항목             | 값                                                                                                                                 |
> | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
> | **last-updated** | 2026-07-30                                                                                                                         |
> | **상태**         | **ACTIVE** — 전략 축(§1–§10)은 확정, 실행(§11 현황·§12 로드맵)은 진행 중                                                           |
> | **적용 대상**    | 공개 리포 `marblo-app/marblo` (생태계·레지스트리), 그리고 그것을 소비하는 앱 Harness Store                                         |
> | **공개 금지**    | ★ 이 문서는 **private `melocream/marblo` 전용**이다. 내부 전략·경쟁 판단·미공개 갭이 들어 있어 공개 리포에 올리지 않는다.          |
> | **최초 출처**    | 2026-07-29 CEO 리뷰 (`marblo-app/marblo` PR #3 대상, gstack `/plan-ceo-review` HOLD SCOPE + Codex 독립 교차검증) → 판정 **REVISE** |

## 이 문서의 갱신 규율

1. **수치는 실측만.** 스타·트래픽·항목 수는 측정 명령과 측정일을 함께 남긴다. 추정치는 "추정"이라고 쓴다.
2. **미정은 미정으로.** 계측이 없는 지표는 "계측 전 — 난 것으로 치지 않음"으로 표기하고, 빈칸을 낙관으로 채우지 않는다.
3. **틀린 가설은 지우지 않고 정정한다.** 이 문서의 가치는 "무엇을 믿었고 무엇이 틀렸는지"의 기록에 있다(§13 참조).
4. **전략 축이 바뀌면 §1–§10 을 고친다.** 실행 상태만 바뀌면 §11–§12 만 고친다. `last-updated` 는 항상 갱신한다.

---

# 1부 — 전략 축 10

## ① 테제: 폐쇄·유료 오케엔진 vs 개방·포터블 하네스중립 자산

우리는 두 개의 물건을 동시에 운영한다. 이 둘의 경계를 **먼저, 크게, 우리 입으로** 말하는 것이 전략의 출발점이다.

| 폐쇄·유료 (제품)                                                         | 개방·포터블 (생태계)                             |
| ------------------------------------------------------------------------ | ------------------------------------------------ |
| 라이브 오케스트레이션, 보드, 워크트리 격리, 비용 귀속, 세이프 머지, 원장 | 스킬·서브에이전트·워크플로·MCP 매니페스트·지식팩 |
| Marblo 앱 = 제품. 소스 비공개. 유료.                                     | 하네스 중립. Marblo 없이도 돌아간다. 포터블.     |

> **경계 문장(README 에 명문화됨):** 오케스트레이션 엔진은 우리 제품이고 닫혀 있다. 에이전트가 _소비하는_ 것 — 스킬·도구·워크플로·지식 — 은 전부 열려 있고 포터블하며, Marblo 를 설치하든 안 하든 동작한다.

**차별화 축(Orca 와 같은 축에서 싸우지 않는다):**

> Orca 는 더 나은 조종석을 준다. Marblo 는 **관제**를 준다.
> Orca 는 개발자 한 명이 함대를 조종하는 곳이고, Marblo 는 함대가 스스로 굴러가고 팀이 그것을 **증명**할 수 있는 곳이다 — 라이브 오케, 티켓당 워크트리 격리, 에이전트·모델별 비용 귀속, 모든 머지 판단의 append-only 기록.
> IDE 는 그대로 쓰라. Marblo 는 그 위의 레이어다.

개발자는 닫힌 코어를 용서한다. 닫힌 코어를 **열린 생태계인 척** 포장하는 것을 벌한다. 경계를 우리 입으로 말하는 것이 그 둘을 가르는 유일한 차이다.

## ② 스타 3레인 엔진 — 우리는 B다

이 공간의 스타는 하나의 물리가 아니라 **서로 다른 세 개의 엔진**에서 나온다. 어느 엔진에 붙었는지가 천장을 결정한다.

**레인 A — 제품이 곧 리포.** 접근 조건 = 제품 오픈소스화.

| Repo                   | Stars   | Created |
| ---------------------- | ------- | ------- |
| anomalyco/opencode     | 190,637 | 2025-04 |
| anthropics/claude-code | 139,444 | 2025-02 |
| openai/codex           | 102,223 | 2025-04 |
| zed-industries/zed     | 87,670  | 2021-02 |
| **stablyai/orca**      | 32,938  | 2026-03 |

Orca 는 341 MB·TypeScript 81 MB + Swift/Kotlin 모바일 클라이언트를 **전부 MIT** 로 풀어 ~4.5개월에 32k 를 받았다. 우리는 구조적으로 이 비교를 이길 수 없고, **이 비교를 초대하는 것을 그만둔다.**

**레인 B — 하네스 중립 콘텐츠. 제품 설치 0.** ★ 우리 레인.

| Repo                                    | Stars   | Forks  | Created |
| --------------------------------------- | ------- | ------ | ------- |
| anthropics/skills                       | 165,080 | 19,616 | 2025-09 |
| punkpeye/awesome-mcp-servers            | 91,516  | —      | 2024-11 |
| modelcontextprotocol/servers            | 89,005  | —      | 2024-11 |
| hesreallyhim/awesome-claude-code        | 51,278  | 4,461  | 2025-04 |
| wshobson/agents                         | 38,357  | 4,104  | 2025-07 |
| davila7/claude-code-templates           | 29,962  | —      | 2025-07 |
| VoltAgent/awesome-claude-code-subagents | 23,815  | —      | 2025-07 |

전부 1년 안에 24k–165k. 전부 **우리가 이미 고른 바로 그 콘텐츠 타입**(스킬·에이전트·MCP·워크플로·지식팩)을 싣는다. 벤더 앱을 요구하는 곳은 하나도 없다.

**레인 C — 닫힌 제품에 붙은 벤더 스토어.** 파생적이다.

| Repo                         | Stars  | Forks | Age   | 제품 리포                   |
| ---------------------------- | ------ | ----- | ----- | --------------------------- |
| obsidianmd/obsidian-releases | 20,266 | 7,470 | 6 yrs | (다운로드 호스트 겸용)      |
| raycast/extensions           | 7,648  | 6,530 | 5 yrs | —                           |
| warpdotdev/workflows         | 833    | 166   | 4 yrs | **warpdotdev/warp: 63,770** |
| logseq/marketplace           | 355    | 450   | 5 yrs | —                           |
| smithery-ai/registry         | 0      | 4     | 7 mo  | —                           |

Warp 이 가장 정확한 구조적 유사체다 — 스토어 833 vs 제품 63,770, **77배 격차**. Raycast·Logseq 에서 fork > star 인 것은 "기여 리포"의 지문이다(제출하려 fork 할 뿐, 따라가려 star 하지 않는다). 그리고 레인 C 는 제품 설치 기반의 **파생 함수**다 — 우리 스토어가 파생시킬 기반이 아직 없다.

**핵심 오류(2026-07-29 진단):** PR #3 은 **레인 C 를 만들면서 레인 A 를 벤치마크로 인용**했다.
**핵심 해법:** 같은 파일·같은 리포를 레인 B 로 돌린다. 명사(스킬·에이전트·MCP·지식팩)는 이미 맞았고, 동사가 틀렸다 — "Marblo 에 설치하세요"가 아니라 **"지금 쓰는 CLI 로 바로 돌아갑니다"**.

> 스타는 **콘텐츠 품질과 독립 실행성**에서 나온다. 스토어 UI 에서 나오지 않는다.

**측정 출처·일자:** GitHub REST `repos/{owner}/{repo}`.

- **2026-07-30 재측정:** `anthropics/skills`, `wshobson/agents`, `hesreallyhim/awesome-claude-code`, `stablyai/orca`, `warpdotdev/workflows`, `warpdotdev/warp`, `raycast/extensions`, `obsidianmd/obsidian-releases`.
- **2026-07-29 측정값 유지(재측정 안 함):** 그 밖의 모든 행. 포크 수가 `—` 인 것은 당시 수집하지 않았다는 뜻이다.

## ③ 1st-party 플래그십 — 대체 불가 자산

큐레이션만으로는 스타가 안 난다. anthropics/skills(165k)와 20k+ awesome 리스트가 이미 일반 프롬프트를 다 갖고 있다. **일반 코드리뷰 스킬은 2026년에 아무도 스타하지 않는다.**

우리만 가진 것: **이종 에이전트 함대를 실제 프로덕션에서 몇 달 돌린 운영 지식.** 글쓰기 연습이 아니라 운영의 부산물이라 아무도 복제할 수 없다.

**플래그십 2종:**

1. **`knowledge/fleet-operations` — Fleet Operations 지식팩.** (착지: PR #3 이후 편입, `KNOWLEDGE.md` 240줄, tier `official`)
   담는 것: 어떤 벤더 구독이 Anthropic 호환 엔드포인트를 여는가 vs 네이티브 하네스가 필요한가(그리고 "벤더가 자체 CLI 를 낸다"는 것이 **판별기준이 아니라는** 발견), 하네스별 세션·resume 계약과 즉사하는 플래그 조합, 스폰된 에이전트가 영구히 "working"으로 보이는 이유(PTY 바이트 흐름 파생), 하네스 추가 시 비용 귀속이 실제로 깨지는 지점(파서가 아니라 스폰 킥오프 트리거), 티켓당 워크트리 위생·머지 마감 규율·와치독 오탐 지문.
   규율: **측정한 것만(measured, not inferred)**, 틀렸던 가설도 함께, CLI 계약은 버전 스탬프.

2. **Fleet Roles — 조직 역할 서브에이전트 팩.** (진행 중, 티켓 `yAHrR8ROUIowwPSa1fGR`)
   `official` tier, **설치 가능 + 스탠드얼론**. 조직의 역할(리뷰어·아키텍트·QA·보안·DevOps…)을 서브에이전트로 정의해, Marblo 없이도 Claude Code/Codex 에서 바로 돌아가고 Marblo 에서는 원클릭으로 들어온다.
   현재 1st-party `agents/` 는 `reviewer` 1개뿐 — 나머지 6개는 외부 참조(voltagent·wshobson)다. 이 갭을 Fleet Roles 가 메운다.

## ④ README = 스토어프론트

README 는 문서가 아니라 **랜딩 페이지**다. 리포에 도달한 사람이 30초 안에 "이게 뭐고 지금 뭘 할 수 있는지"를 알아야 한다.

착지된 구성: 히어로 이미지 + 플랫폼/다운로드/웹/연락 배지 + 한 문장 포지셔닝("The live orchestrator for AI-native teams") + 라이브 오케 데모 섹션(분해→스폰→와치독→머지 판단→유저 확인) + 탭별 기능 투어 + 매니페스트에서 **자동생성되는 카탈로그 표**(94개, CI 드리프트 가드).

**★ 자동생성 블록의 함정(실제로 물렸던 것):** `prettier-ignore` 펜스가 마커를 **감싸야** 한다. `end` 를 `END` 앞에 두면 그 `end` 가 무시범위 밖으로 나가 빈 줄이 삽입되고, 포매팅 이유로 CI 가 **영구 fail** 한다. 그리고 블록에 타임스탬프를 넣지 않는다(매 생성마다 드리프트). 가드 테스트는 **커밋 기준**으로 — 워킹트리만 고치면 생성기가 되돌려 PASS 로 오판한다.

**첫 화면의 동사:** "지금 쓰는 CLI 에 복붙 30초" 가 먼저, "Marblo 에서는 원클릭" 이 뒤. 게이트가 아니라 업그레이드다.

## ⑤ 큐레이션 컬렉션 — OSI-only, pin, 정직한 caveat

**정책(사장님 확정 2026-07-29): 라이선스는 OSI 승인만.**

- source-available(FSL·BSL·SSPL 등)은 **NC/ND 가 아니어도 제외**한다. 실제로 `sentry`(FSL)를 이 규칙으로 제외했다.
- **AGPL 은 OSI 승인이라 편입 OK.** 현재 1건 있다.
- 코드 벤더링 금지 — 매니페스트 참조 + 불변 ref pin(릴리스 태그 또는 40자 SHA). `main`/`master`/`develop`/`HEAD` 는 스키마가 패턴으로 거부한다.
- 모든 항목에 정직한 caveat: tier 와 permissions 를 과대선언하지 않는다. **permissions 과대선언은 "안전"이 아니라 공시를 무시하도록 훈련시키는 것**이다.

**측정된 라이선스 분포(94개, 2026-07-30):** MIT 64 · Apache-2.0 23 · CC-BY-4.0 2 · MPL-2.0 1 · `MIT AND Apache-2.0` 1 · ISC 1 · CC0-1.0 1 · AGPL-3.0 1. FSL/BSL/SSPL **0건** — 정책과 현재 재고는 일치한다.

> **★ 미해결 갭:** OSI-only 정책이 **리포 문서·CI 에 아직 코드화되지 않았다.** CONTRIBUTING.md 에 OSI/SPDX 문구가 없고, 검증기는 `license` 가 "비어있지 않은 문자열"인지만 본다 — SPDX 식별자 allowlist 도, OSI allowlist 도, 업스트림 실제 라이선스와의 대조도 없다. 지금 정책은 **사람의 규율로만** 지켜지고 있다. → §12 다음 후보 1순위.

## ⑥ Recipes·플레이북 + 블로그·전자책

레지스트리는 "부품 목록"이고, Recipes 는 "그 부품으로 무엇을 만드는가"다. 스타를 끄는 것은 후자다.

- **Recipes & Playbooks** — Marblo 로 가능한 작업의 엔드투엔드 가이드를 `docs/` 에 싣는다. (진행 중, 티켓 `SB6EyT9NJDP61U8JJVGz`)
- **재사용 파이프라인:** 같은 원본을 블로그 → 전자책 → 강의 자료로 재사용한다. Fleet Operations 지식팩과 짝지어 "이종 함대를 실제로 어떻게 운영하는가" 커리큘럼을 만든다. Hacker News 에 올라가는 종류의 아티팩트가 여기서 나온다.
- 현재 `docs/` 구성: `concepts`·`getting-started`·`harness-store`·`orchestration`·`troubleshooting`. Recipes 는 아직 없다.

## ⑦ 벤치마크는 정직하게

**원칙: 방법론 + 도그푸딩 데이터를 공개한다. 우월성은 주장하지 않는다.**

- 우리가 가진 것은 **도그푸딩 데이터**다. 외부 실사용은 실측 ≈ 0 이다(BQ `cost_logs`: 파운더 78,409행 vs 그 외 4행, 전체 유저 2명). 이 상태에서 "Marblo 가 더 빠르다/좋다"는 주장은 데이터가 없다.
- 따라서 공개하는 것은 (a) 벤치 **프레임워크**와 재현 절차, (b) 우리 자신의 함대 실행 데이터, (c) 그 데이터가 무엇을 말하지 **못하는지**.
- 모델 성능 벤치를 인용할 때: **변형(variant) 축을 고정**한다. SWE-bench 는 Verified/Pro 가 다른 시험이다 — 같은 Pro 축에서만 비교하고(교차검증: OpenAI 표의 Fable5 80 / Opus4.8 69.2 = Anthropic 카드와 정확히 일치), 벤더가 보고 벤치를 갈아타므로 기본 축은 **커버리지에서 파생**한다.
- 진행 중: 벤치 프레임워크 + 투명 공개 (티켓 `I0Mx6ldoaWsRVZthZEiF`). ★조작 금지가 이 티켓의 1급 제약이다.

## ⑧ 설치 파이프라인 — community = listing-only

**불변식: 병합이 곧 신뢰 이벤트다.** `github.com/marblo-app/marblo` 안의 항목은 `tier: community` 배지가 붙어 있어도 **Marblo 가 보증한 것으로 읽힌다.** tier 는 YAML 안의 문자열이고, URL 은 브랜드다.

| tier                    | 설치            | 근거                                                                   |
| ----------------------- | --------------- | ---------------------------------------------------------------------- |
| `official` / `verified` | **설치 가능**   | 페이로드까지 메인테이너가 직접 리뷰했다                                |
| `community`             | **목록·공시만** | 핀이 걸린 커밋이라도 **리뷰되지 않은 텍스트 페이로드**는 안전하지 않다 |

**착지 상태 (Phase 1a, private 앱):**

- 스키마 조건부 규칙 5개 착지 — 실행형 타입은 `permissions` 필수 / 비-official 은 `source` 필수 / `install.kind` ↔ `type` 정합 / `install.kind: mcp-server` ⟹ tier ∈ {official, verified} / `bundle` ⟹ `includes`.
- 앱 설치기(`v3/electron/registry-installer.ts`)가 **독립적으로 같은 게이트를 재강제**한다 — community 는 예외를 던져 거부한다. 스키마와 앱, 두 곳에서 막는다.
- `install` 계약을 **`schema_version` 과 무관하게** 읽는다(PR #671). v1 in-repo 스킬은 레포 트리에서 files 설치를 파생하되, 매니페스트가 계약을 선언했다가 거부된 경우에는 파생하지 않는다 — 게시자가 쓴 계약을 무시하고 트리로 조용히 대체하면 안 된다.
- 원장 기반 uninstall — 설치 후 편집된 매니페스트가 삭제를 못 돌린다.
- Store 를 연결/Store 2섹션으로 분리, community 항목은 GitHub 카탈로그로 보낸다(PR #672). 항목 name·description 은 앱 로케일을 따른다(PR #673, i18n 오버레이 + 필드단위 폴백).
- **명시적 `install` 계약 선언은 현재 2건**(`skills/code-review`, `mcp-servers/firecrawl-mcp`). 나머지 스킬은 앱측 트리 파생 경로다.

**아직 없는 것:** CI 가 만드는 서명·불변 인덱스, 앱이 launch 시 읽는 revocation kill switch. `SECURITY-ADVISORIES.md` 는 존재하고 활성 권고 0건이지만, **문서 스스로 "app-side 강제는 Phase 1a" 라고 명시**하고 있다 — 지금은 사람이 읽어야 하는 파일이다. 있지 않은 kill switch 를 있는 척하지 않는다.

## ⑨ 메트릭 — 오늘 읽을 수 있는 신호만

**규율: 계측이 필요한 지표는 "계측 필요"로 명시하고, 계측 전까지 난 것으로 치지 않는다.** 읽을 수 없는 성공 지표는 조용히 스타 카운트로 대체되고, 그게 바로 이 전략 전체가 경계하는 프록시 함정이다.

**오늘 읽히는 신호 (GitHub Insights, 계측 불필요):**

| 신호                     | 읽는 곳                | 의미                                                                      |
| ------------------------ | ---------------------- | ------------------------------------------------------------------------- |
| 순방문자·페이지뷰 (14일) | Insights → Traffic     | 독자가 있는가. **Phase 0 게이트.**                                        |
| 클론 수 (순 cloner)      | Insights → Traffic     | 누가 자산을 가져갔다. 스탠드얼론 설치의 가장 가까운 프록시.               |
| 유입 사이트(referrers)   | Insights → Traffic     | 밖으로 공유되고 있는가.                                                   |
| 비-메인테이너 Issue/PR   | Issues / Pull requests | 스타와 달리 **진짜** 외부 관여.                                           |
| 스타·포크                | 리포 헤더              | 추적하되 **최적화 대상 아님.** fork > star = 기여 표면으로 읽힌다는 신호. |

**계측 전 — 난 것으로 치지 않음:**

| 신호                  | 막혀 있는 것                                                              |
| --------------------- | ------------------------------------------------------------------------- |
| 항목별 스토어 설치 수 | Phase 1a 설치 원장 + 앱측 텔레메트리. **오늘 측정 불가 — 주장하지 않음.** |
| 첫 유용 자산까지 시간 | 클린 머신·앱 없이 수동 워크스루를 타이밍해서 실측해야 한다. 아직 안 함.   |

## ⑩ 보안 불변식

깨뜨리지 않는다. 전략이 바뀌어도 이 5개는 유지한다.

1. **코드 벤더링 금지.** 제3자 코드는 복사하지 않고 매니페스트로 참조한다(`source.repository` + 불변 `ref`). 복사는 라이선스·소유권·유지보수를 우리 쪽으로 끌어온다.
2. **불변 pin.** 움직이는 브랜치 금지 — 릴리스 태그 또는 40자 SHA. 스키마가 패턴으로 강제한다.
3. **스키마 하드닝 = 약속의 강제.** SECURITY.md 가 "permissions 를 공시한다"고 쓰면 스키마가 그걸 **required 로 강제**해야 한다. 문서의 약속이 스키마에 없으면 그것은 약속이 아니라 문구다. (이것이 CEO 리뷰 R1 의 핵심이었고, 착지됐다.)
4. **권한 공시 + 실행 게이트.** 실행형 타입은 permissions 필수(빈 배열 = "아무것도 요구 안 함"이라는 유효한 답). MCP 서버 등록 = 다음 CLI 시작 때 사용자 머신에서 프로세스가 뜨는 일 — 미검수 항목에는 주지 않는다.
5. **철회 경로.** `status: active | deprecated | revoked` + `SECURITY-ADVISORIES.md`(항목 삭제 없음, 영구 기록). npm·Raycast 둘 다 어렵게 배운 것이다. **앱측 강제는 Phase 1a 미착지 — 현재 상태를 그대로 공시하고 있다.**

---

# 2부 — 현황과 로드맵

## §11 현황 대시보드 (실측 2026-07-30)

### 공개 리포 `marblo-app/marblo`

| 항목               | 값                                                |
| ------------------ | ------------------------------------------------- |
| 생성               | 2026-07-26 (4일)                                  |
| 스타 / 포크 / 이슈 | **1 / 0 / 0**                                     |
| 트래픽 (14일)      | 페이지뷰 **4**, 순방문자 **1**, 유입 사이트 **0** |
| 클론 (14일)        | **29회 / 순 cloner 23** ⚠️                        |
| 머지된 PR          | 20개 (#3 → #20)                                   |

> ⚠️ **클론 23 을 독자로 읽지 말 것.** 순방문자가 1인데 순 cloner 가 23인 조합은 **CI 러너**로 설명된다(같은 기간 20개 PR 이 머지되며 `validate.yml`·카탈로그 가드가 매번 체크아웃). 사람의 스탠드얼론 설치 근거로 쓸 수 없다. 정직한 판정: **외부 독자 ≈ 0.**

**측정 명령(재현용):**

```
gh api repos/marblo-app/marblo --jq '{stars:.stargazers_count,forks:.forks_count,issues:.open_issues_count}'
gh api repos/marblo-app/marblo/traffic/views  --jq '{count,uniques}'
gh api repos/marblo-app/marblo/traffic/clones --jq '{count,uniques}'
gh api repos/marblo-app/marblo/traffic/popular/referrers
```

### 레지스트리 재고 — 94개

| 축            | 분포                                                                                                     |
| ------------- | -------------------------------------------------------------------------------------------------------- |
| **tier**      | community **86** · official **6** · verified **2**                                                       |
| **type**      | mcp-server **56** · skill **21** · agent **7** · workflow **7** · knowledge-pack **3**                   |
| **라이선스**  | MIT 64 · Apache-2.0 23 · CC-BY-4.0 2 · MPL-2.0 1 · MIT AND Apache-2.0 1 · ISC 1 · CC0-1.0 1 · AGPL-3.0 1 |
| **설치 가능** | official/verified **8** (그중 명시적 `install` 계약 선언 **2**)                                          |
| **필드 충족** | `permissions` 94/94 · `status` 94/94                                                                     |

수집 경과: 1차 39 → **94**(국내/국외 MCP·스킬·에이전트·워크플로 참조 편입, PR #5–#18).

**측정 명령(재현용):** 공개 리포를 shallow clone 후 —

```
grep -rhE '^\s*tier:'    --include=marblo.yaml . | sed 's/.*tier:[[:space:]]*//'    | sort | uniq -c
grep -rhE '^\s*type:'    --include=marblo.yaml . | sed 's/.*type:[[:space:]]*//'    | sort | uniq -c
grep -rhE '^\s*license:' --include=marblo.yaml . | sed 's/.*license:[[:space:]]*//' | sort | uniq -c
```

### 인프라 착지 상태

| 요소                                      | 상태                                                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `registry/manifest.schema.json`           | ✅ 조건부 규칙 5개 착지                                                                                 |
| `packages/registry-validator` + CI        | ✅ `validate.yml` — 스키마·ID 유일성·permissions·license 비어있음·pin 불변성·GitHub 도달성(best-effort) |
| README 카탈로그 자동생성 + 드리프트 가드  | ✅ PR #20 (`scripts/gen-catalog.mjs`)                                                                   |
| `SECURITY-ADVISORIES.md`                  | ✅ 존재, 활성 권고 0건 / ❌ 앱측 강제 미착지(문서에 명시)                                               |
| 앱 Harness Store (Phase 1a)               | ✅ 레지스트리 소비·설치(skill+mcp-server)·tier 게이트·원장 uninstall·i18n                               |
| SPDX/OSI allowlist 검증                   | ❌ **없음** — `license` 비어있음만 검사(§5 갭)                                                          |
| 서명·불변 인덱스 / revocation kill switch | ❌ Phase 1a 잔여                                                                                        |

## §12 워크스트림

### 진행 중 (IN_PROGRESS / CLAIMED)

| 티켓                   | 내용                                                                          | 축  |
| ---------------------- | ----------------------------------------------------------------------------- | --- |
| `yAHrR8ROUIowwPSa1fGR` | **Fleet Roles** — 조직 역할 서브에이전트 팩(official, 설치가능·스탠드얼론)    | ③   |
| `nnFSjA0p0KRz8DJ3gcye` | **수집 2차** — 외부 서브에이전트·스킬·워크플로 30종 추가(community, OSI-only) | ⑤   |
| `pJSejORCKYasaBJpamU9` | **Marblo 저작 워크플로만 식별·공개**(official, 제3자 gstack 제외)             | ③⑤  |
| `XJD1SA0qxNoezkn43msC` | **README 히어로 개편** — 메인 스토어프론트(데모·탭투어·설치훅)                | ④   |
| `I0Mx6ldoaWsRVZthZEiF` | **벤치 프레임워크 + 도그푸딩 데이터 투명 공개**(조작 금지)                    | ⑦   |
| `SB6EyT9NJDP61U8JJVGz` | **Recipes & Playbooks** — 엔드투엔드 가이드(블로그·전자책 재사용)             | ⑥   |
| `93vDLnyVx7yqXNi2j6b7` | 이 문서 (리빙 도큐멘트)                                                       | —   |

### 리뷰 대기 (REVIEW)

| 티켓                   | 내용                                                                                   |
| ---------------------- | -------------------------------------------------------------------------------------- |
| `qxT2vHdOO4tZb74ymbpk` | 스토어를 Harness 앞 **독립 탭**으로 격상 + community 표시(설치는 official/verified 만) |
| `4wCiFrCEk5Eel6fD57cR` | Orca 스타일 공개 쇼케이스 README(히어로 + 탭별 기능 + 라이브 오케)                     |
| `OlOymhDpfuO1WlXsekLG` | `melocream` 프로필 대문 README (한국어, Marblo·스킬·LLM 프로젝트 쇼케이스)             |

### 다음 후보 로드맵 (우선순위 제안)

| #   | 후보                                                                                              | 근거 축 | 티켓                   |
| --- | ------------------------------------------------------------------------------------------------- | ------- | ---------------------- |
| 1   | **OSI-only 정책 코드화** — CONTRIBUTING 문구 + 검증기 SPDX/OSI allowlist + 업스트림 라이선스 대조 | ⑤⑩      | (미생성)               |
| 2   | **Fleet Roles 착지 + 스탠드얼론 스니펫** — 1st-party `agents/` 를 1개 → 팩으로                    | ③       | `yAHrR8ROUIowwPSa1fGR` |
| 3   | **Recipes 첫 3편 + 블로그 1편** — 콘텐츠 레인 실제 가동                                           | ⑥       | `SB6EyT9NJDP61U8JJVGz` |
| 4   | **공식 GitHub org + 영문 대문** — 브랜드 표면 정리                                                | ④       | `R14aQEMFibQZL5PKeTGP` |
| 5   | **공개 스킬·MCP 레포 표준화**(README/LICENSE/topics 통일) 후 신규 공개                            | ④⑤      | `0hNFsOGuTeHh01qcQPL2` |
| 6   | **revocation kill switch + 서명 인덱스** — Phase 1a 잔여                                          | ⑧⑩      | (미생성)               |
| 7   | **"첫 유용 자산까지 시간" 실측** — 클린 머신 수동 워크스루 타이밍                                 | ⑨       | (미생성)               |
| 8   | LLM/ML 스터디·지식공유 큐레이션 리포 신설                                                         | ⑥       | `b84FtKrZrkqK2CPLAiS4` |
| 9   | 유저가 GitHub 레포 연결로 설치·게시하는 스토어(설계)                                              | ⑧       | `1wN4RQYqfAyNzwFQQ0aA` |

### 명시적으로 보류 (scope 밖)

- **오픈코어**(오케스트레이터 일부 오픈소스화). Codex 가 "Orca 카테고리를 진짜로 다투는 유일한 길"로 제기. **사장님 레벨 결정** — 계획 리뷰 범위 밖이지만, 조용히 기각하지 않고 여기 남긴다.
- **Bundles · `marblo-cli` · `extension-sdk`** (Phase 2). 레인 B 두 레버 하류. 독자 없는 상태에서 SDK 를 만드는 것은 상상된 사용자를 위한 설계다.
- **카테고리별 리포 분할**(Phase 3). 한 카테고리가 수백 파일이 되거나 자체 릴리스 케이던스가 필요해질 때까지.
- **Store UI 디자인 리뷰.** Phase 1a 표면이 생긴 뒤 `/plan-design-review` 로.

---

# 3부 — 출처 기록

## §13 CEO 리뷰(2026-07-29) 반영 대장

판정 **REVISE** — "구조는 머지하고, 무엇을 위한 것인지를 바꾼다." 스캐폴딩(스키마·no-vendoring·pin 규율)은 어느 전략에서도 필요한 옳은 작업이라 버릴 이유가 없었고, 결함은 **목적함수와 community-execute 약속**이었다.

### 리스크 → 현재 상태

| ID  | 리스크                                                                                                                                  | 반영 상태                                                                                         |
| --- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| R1  | **CRITICAL** — `community` tier 의 보안 서사를 스키마가 강제하지 않음 (`permissions` optional, 비-official 에 `source` 미강제, CI 없음) | ✅ **해소** — 조건부 규칙 5개 + 검증기 + CI. 앱 설치기가 독립 재강제. community = listing-only    |
| R2  | **HIGH** — 철회 경로 없음                                                                                                               | 🟡 **부분** — `status` + `SECURITY-ADVISORIES.md` 착지. **앱측 kill switch 미착지**(문서에 명시)  |
| R3  | **HIGH** — 시퀀싱 역순(설치기 없이 기여 흐름 최적화)                                                                                    | ✅ **해소** — Phase 1a 설치기 착지(#670·#671), 재고 39→94                                         |
| R4  | **MEDIUM** — "항목별 설치 수"는 설계상 측정 불가                                                                                        | ✅ **해소** — ROADMAP §7 이 "오늘 읽히는 신호"와 "계측 필요"를 분리 표기                          |
| R5  | **MEDIUM** — 라이선스 메타데이터 미검증                                                                                                 | 🟡 **부분** — 정책은 OSI-only 로 확정, 재고도 일치. **SPDX/OSI allowlist·업스트림 대조 미코드화** |

### 10개 권고 → 현재 상태

| #   | 권고                                                           | 상태                                         |
| --- | -------------------------------------------------------------- | -------------------------------------------- |
| 1   | Orca-parity 를 스타 벤치마크에서 내리고 레인 B 피어셋으로      | ✅ ROADMAP §2                                |
| 2   | 노스스타 재프레이밍(스탠드얼론 우선, Marblo 설치는 업그레이드) | ✅ ROADMAP §1 · README                       |
| 3   | 모든 1st-party 항목에 스탠드얼론 설치 스니펫                   | 🟡 CONTRIBUTING 이 요구, 전 항목 감사 미실시 |
| 4   | README 에 open/closed 경계 명문화                              | ✅ README · ROADMAP §6                       |
| 5   | 실행형 `permissions` 필수 / tier≠official 이면 `source` 필수   | ✅ 스키마                                    |
| 6   | `status` + 권고 파일                                           | ✅ (앱 강제는 잔여)                          |
| 7   | community = 리뷰·권한게이트 착지까지 listing only              | ✅ 스키마 + 앱 이중 게이트                   |
| 8   | 플래그십을 일반 코드리뷰 스킬 → Fleet Operations 지식팩으로    | ✅ 지식팩 착지 / 🟡 Fleet Roles 진행 중      |
| 9   | ROADMAP §7 성공 신호를 관측 가능하게                           | ✅                                           |
| 10  | CI 에서 SPDX 검증 + copyleft 정책 문단                         | ❌ **미착지 — 다음 후보 1순위**              |

### 유지할 것 (재작업 금지)

- `registry/manifest.schema.json` 의 구조 — 재작성 아니라 조건부 규칙 추가가 맞았다.
- **no-vendoring / pinned-manifest 규칙** — 어느 전략에서도 그대로 유지.
- tier 어휘(`official`/`verified`/`community`) — 모델은 맞았고 강제 타이밍이 틀렸을 뿐.
- 거버넌스 스캐폴딩(CODEOWNERS, 이슈·PR 템플릿, SECURITY.md) — 값싸고 옳다.
- `knowledge/curated-llm-resources` 의 12개 링크(전부 200 확인) — 플래그십에서 강등, 삭제는 아님.

## §14 교차모델 체크 (Codex, 독립·read-only)

**일치(높은 신뢰):** 스타 엔진 오인 / Orca 포지셔닝 비정합 / 개발자는 닫힌 코어 위의 얇은 공개 껍데기를 벌한다 / `community` tier 는 공급망 사고 대기 상태 / 시퀀싱 역순 / 해법은 "Marblo 없이도 유용한 리포".

> Codex 원문: _"Orca got stars because the product is the repo. Marblo is proposing to open the packaging around a closed product… That is not a peer strategy. It is a vendor catalog strategy."_ / _"The likely outcome is closer to Warp workflows / Logseq marketplace than Orca."_

**갈린 지점:** Codex 는 "PR 은 시기상조 — 유통·신뢰·수요가 있기 전에 생태계의 **외관**을 만든다"며 STOP 쪽으로 기울었다. 리뷰는 REVISE 로 착지했다. 다만 **`community` 실행형 개방만은 Codex 의 강한 입장이 그대로 이겼다** — 지금 열지 않는다.

## §15 꿈-상태 델타

```
  2026-07-26 (생성)        PR #3 원안 그대로            12개월 이상적
  스타 1, 순방문 1/14d  →  레인 C 벤더 카탈로그   →   레인 B 콘텐츠 리포
  설치기 없음               천장 ~800–7k / 4–5년        이면서 Store 도 먹인다
  일반 seed 콘텐츠          미강제 신뢰 모델            대체불가 fleet-ops 지식
                                                        + 실제 설치
```

2026-07-30 현재: 설치기는 착지했고(Phase 1a), 재고는 94개, 신뢰 모델은 스키마+앱 이중 강제로 바뀌었다. **여전히 안 바뀐 것은 독자 수다** — 순방문자 1. 인프라는 레인 B 로 돌려놨고, 남은 것은 §12 의 콘텐츠 레인(③⑥)을 실제로 가동하는 일이다.

---

_이 문서를 고쳤다면 `last-updated` 를 갱신할 것._
