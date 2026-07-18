# Marblo GTM / 마케팅 실행 전략 — vs Orca

- 작성일: 2026-07-18
- 티켓: `OWy15JSQXQAiXJXORT9u` (리포트온리, 코드 변경 없음)
- 상위 입력:
  - `v3/docs/research/marblo-vs-orca-final-ceo-strategy-review-2026-07-17.md` (CEO 최종 전략 리뷰)
  - `v3/docs/marblo-vs-orca-strategy-review-2026-07-17.md` (CEO/Eng 전략·아키텍처 리뷰)
  - `v3/docs/CONTROL-PLANE.md`, `v3/docs/PRICING-AND-COST-SAFETY-SPEC.md`
- 라이브 리서치(2026-07-18, gstack `/browse`):
  - `github.com/stablyai/orca` — 21.1k stars, 1.5k forks, 838 releases(latest `v1.4.144`), 238 contributors, 6,768 commits, MIT
  - `onorca.dev` 랜딩/제품 페이지, README(6개 언어)
- 범위: CEO 전략 리뷰가 확정한 포지셔닝("auditable merge decisions for agent teams" + 무료/오픈코어 배포)을 **마케팅 실행 전략**으로 구체화. 실행 항목은 후속 티켓화 가능하게 설계.

---

## 0. 한 줄 결론 (승부수)

> **Orca와 배포(distribution) 전쟁을 정면으로 벌이지 않는다. "무료 개인 티어"로 개발자 유입 깔때기만 방어하고, 진짜 마케팅 축은 팀 바이어를 향한 "auditable merge decisions"로 재정렬한다.**

Orca의 GTM은 **bottoms-up 개발자 주도 OSS 배포 엔진**이다. 무료·MIT·매일 배포·BYO-agent 중립성·인플루언서 소셜증거로 21.1k star를 만들었다. 이 엔진을 star 수로 이기려는 시도는 진다(그들은 838 릴리스·238 컨트리뷰터의 선행 자산이 있다). 대신 우리는:

1. **무료 티어를 "제품"이 아니라 "유입 무기"로만 쓴다** — Orca와 같은 링에 서되, 돈은 여기서 벌지 않는다.
2. **마케팅 메시지·콘텐츠·바이럴 훅을 전부 "팀이 AI 코드를 안전하게 merge/audit" 축으로** 통일한다 — Orca가 못 가진(그리고 OSS 구조상 빠르게 못 만드는) 팀 거버넌스/감사 레이어.
3. **바이럴은 Orca를 모방하지 말고 상호운용**한다 — "Orca 안에서도 Marblo control plane을 쓴다" 식으로 그들의 생태계에 얹혀 유입.

---

## 1. Orca GTM 해부 → 우리 대응책

Orca의 GTM을 5개 축으로 분해하고, 각 축에서 우리가 **모방할 것 / 흘려보낼 것 / 되받아칠 것**을 정한다.

### 축 1. GitHub 존재감 (그들의 심장)

**Orca가 하는 것**

- 21.1k stars, 1.5k forks, **838 releases**, 238 contributors, 6,768 commits — 숫자 자체가 소셜증거.
- README 상단 CTA: _"Star this repo to follow along with our daily ships."_ — star를 **뉴스레터 구독처럼** 사용.
- _"we ship daily, the changelog is the real feature list"_ — 릴리스 빈도를 서사로.
- 6개 언어 README(ES/PT/ZH/JA/KO), topic 태그 SEO 스터핑(`ade`, `worktrees`, `parallel-agents`, `yc-backed`, `claude-code`...).
- MIT + 셀프호스트 → 구매 저항 0, 조달 불안 0.

**우리 대응**

- **모방**: README를 star CTA + 다국어(최소 KO/EN, 이후 JA/ZH) + topic SEO로 재설계. 단, 우리 star CTA 문구는 제품 차별점을 담는다 → _"Star to follow how we make AI merges auditable."_
- **흘려보낼 것**: 릴리스 카운트 경쟁. 우리는 838 릴리스를 따라잡을 수 없고 따라잡을 필요도 없다. 대신 **"weekly audit digest"** 같은 우리만의 리듬 서사를 만든다.
- **되받아칠 것**: Orca의 오픈소스 = 트러스트 무기. 우리는 **오픈코어**로 대응 — 로컬 클라이언트/프로토콜의 비민감 부분을 공개해 "블랙박스 아님"을 증명하되, hosted 팀 control plane은 유료로 유지(§4).
- ★함정: 우리 repo가 지금 프라이빗이면 이 축은 시작 자체가 불가. **무료 개인 티어 + 공개 저장소(오픈코어 경계) 결정이 다른 모든 GTM의 선행조건**이다.

### 축 2. 바이럴 / 소셜 증거 (그들의 확성기)

**Orca가 하는 것**

- `onorca.dev` 랜딩 페이지 하단 전체가 **X(트위터) 후기 벽**: @jasonzhou1993("Truely feeling the 10x"), @midudev(스페인어권 초대형 개발 인플루언서, OpenCode 강의 진행), @eddiejaoude(DevRel/OSS 인플루언서) 등.
- `@orca_build` 공식 계정이 후기에 **직접 답글**("yes! in ~ an hour")로 반응 속도 자체를 마케팅.
- **바이럴 훅 = 모바일**: _"Orchestrating 600 agents from my phone"_ 류의 과장된-그러나-공유되는 스크린샷.
- LATAM/스페인·중국(WeChat 2개 그룹) 등 **영어권 밖 초기 확산**으로 경쟁 적은 시장 선점.

**우리 대응**

- **모방**: 랜딩에 후기 벽을 만든다. 단 우리 후기는 "10x 빨라졌다"가 아니라 **"팀 리드가 AI PR을 안심하고 승인하게 됐다"** 류 — 바이어(리드/CTO) 언어로.
- **바이럴 훅 재설계**: Orca의 훅은 "속도/개수"(개인 도파민). 우리 훅은 **공유 가능한 감사 아티팩트** — "이 PR이 왜 안전한지 한 장으로 증명하는 Marblo audit card"를 이미지로 뽑아 X에 공유되게 설계(제품이 곧 바이럴 콘텐츠 생성기). → 후속 티켓 T-8.
- **되받아칠 것**: 개인 도파민 후기는 우리가 못 이긴다. 대신 **"팀 스토리"**를 만든다 — 파운더 베타 100인(에픽 진행 중) 중 팀 단위로 쓰는 곳의 사례를 케이스스터디화.
- 인플루언서: Orca가 잡은 "속도" 인플루언서 말고, **엔지니어링 리더십/플랫폼팀 오디언스**(예: 개발생산성·플랫폼엔지니어링 뉴스레터, eng manager 커뮤니티)를 겨냥.

### 축 3. 데모 / 제품 시연 (그들의 "aha")

**Orca가 하는 것**

- 랜딩 히어로에 **인터랙티브 제품 목업**(실시간 에이전트 5개, 터미널, diff, Next.js 서버 로그)을 통째로 렌더 — "Click to inspect"로 각 기능을 만지게 함.
- Design Mode(Chromium 클릭 → 프롬프트), Annotate AI Diff 등 **시각적으로 GIF/영상화 쉬운 기능**을 전면.

**우리 대응**

- 우리의 "aha"는 시각적으로 덜 화려하다(감사/거버넌스는 GIF가 안 예쁨). → **"before/after" 서사로 시연**: "GitHub PR + Slack + 터미널 로그 5탭" vs "Marblo 티켓 1개에서 spec→agent trail→diff→test→decision→merge SHA를 한 화면". 이 대비가 우리의 히어로 데모.
- 후속 티켓 T-1(REVIEW Cockpit)이 곧 우리 최고의 데모 자산 → **제품 로드맵과 마케팅이 같은 것**(사장님 지시: 병행). Cockpit이 나오는 순간이 랜딩 리론치 시점.
- 30~60초 데모 영상: "AI가 만든 위험한 변경을 Marblo가 어떻게 잡고, 누가 승인했는지 증명하는가."

### 축 4. 문서 / 온보딩 (그들의 전환 엔진)

**Orca가 하는 것**

- `onorca.dev/docs` 기능별 딥링크(worktrees/terminal/ssh/cli/...), 헤드리스 리눅스 서버 가이드까지.
- 설치 마찰 극소화: Homebrew cask, AUR, 전 플랫폼 직접 다운로드, 모바일 companion.
- BYO-subscription: 기존 Claude/Codex 구독 그대로 → **온보딩 결제 장벽 0**.

**우리 대응**

- **설치 마찰을 Orca 수준으로**: 무료 티어 다운로드가 Orca만큼 쉬워야 함(서명/공증은 이미 로컬 빌드 런북 존재). Homebrew cask 제공 검토.
- **온보딩 = 즉시 가치**: 마블로 온보딩(폴더연결→프로젝트자동→오케자동)은 이미 zero-click. 여기에 **"첫 REVIEW를 5분 안에 경험"** 골든패스를 추가 → 감사 가치를 온보딩에서 즉시 체감.
- 문서: "Is Marblo a black box? 코드/프롬프트를 보나요?" 같은 **바이어 불안 해소 문서(Security/Trust Packet)**를 docs 1급으로. Orca의 OSS 트러스트를 문서로 상쇄.

### 축 5. 커뮤니티 (그들의 유지 엔진)

**Orca가 하는 것**

- Discord, `@orca_build`(X), WeChat 2개 그룹, feature request 포털("we ship fast, missing something?").
- 컨트리뷰터 238명 → 커뮤니티가 제품을 밀어줌(OSS 플라이휠).

**우리 대응**

- 초기엔 Discord/커뮤니티 규모전 대신 **파운더 베타 100인을 고밀도 커뮤니티**로(이미 확보 중인 자산). 여기서 케이스스터디·후기·기능요청 루프.
- feature request 포털 동등 채택(공개 로드맵).
- ★우리 강점: **오케스트레이터 자체가 커뮤니티 인터페이스**가 될 수 있음 — 텔레그램 승인/알림(파운더 봇 이미 존재)을 팀 협업 훅으로 확장.

---

## 2. 포지셔닝 메시지 재작성 (랜딩 / 온보딩)

CEO 리뷰 확정 방향을 실제 카피로 내린다. **모든 고객 대면 문구는 영어**(타깃 = 글로벌 GitHub/HN/X 개발자·팀리드).

### 2.1 카테고리 프레임

- Orca: _"The Agent IDE (ADE) — ship 100x."_ → **개인 생산성** 카테고리.
- Marblo: **"The review & merge control plane for agent teams."** → **팀 거버넌스** 카테고리. 다른 링에서 싸운다.

### 2.2 히어로 (랜딩 최상단)

- **H1**: `Turn parallel agent work into auditable merge decisions.`
- **Sub**: `Marblo gives teams one place to review every AI-generated change — with its task spec, agent trail, diff, tests, and decision history — then approve, reject, or merge with a full audit trail.`
- **1차 CTA**: `Start free` (무료 개인 티어 = 유입) · **2차 CTA**: `See a team review` (Cockpit 데모)

### 2.3 세 개의 프루프 라인 (히어로 아래)

1. `Review every AI change with its spec, agent trail, diff, and tests — in one task.`
2. `Route diff feedback back to the agent, then approve, reject, or merge — recorded as an audit event.`
3. `Know which agent changed what, why, who approved it, and where it deployed.`

### 2.4 대비 섹션 ("Why not just GitHub + Slack + a terminal?")

- 좌: `GitHub PR + Slack thread + terminal logs + a fleet of agents` → "누가 왜 승인했는지 아무도 재구성 못 함."
- 우: `One Marblo task` → spec→agent→diff→test→risk summary→decision→merge SHA 한 줄 provenance.

### 2.5 Orca를 적대하지 않는 문장 (중요)

Orca 사용자를 적으로 돌리지 않는다. **상호운용 프레이밍**:

> `Love your agent IDE? Keep it. Marblo is the team layer on top — the place where merge decisions get made and audited.`

이유: Orca는 BYO-agent 중립 레이어라 팬층이 넓고, 정면 비방은 그 커뮤니티를 적으로 만든다. 우리는 "위에 얹는 층"으로 포지셔닝해 그들의 유저 풀에서 팀 바이어만 뽑아온다.

### 2.6 온보딩 카피 (앱 내)

- 오케 첫인사에 **감사 가치를 심는다**: 기존 tf예시/티켓/스폰 제안에 더해 → _"Want me to prepare this change as a reviewable decision? I'll bundle the diff, tests, and a risk summary."_
- 첫 REVIEW 완료 시 축하 + "이게 Marblo가 GitHub/Slack과 다른 이유" 한 줄.

---

## 3. 바이럴 / 채널 전략

우선순위: **(A) 무료티어+GitHub 오픈코어 → (B) 제품이 곧 콘텐츠(빌드인퍼블릭) → (C) 타깃 인플루언서/커뮤니티 → (D) HN/Reddit/X 런치**. A가 B~D의 선행조건.

### A. GitHub 존재감 — 오픈코어/무료티어 지렛대

- **오픈코어 경계 확정**(→ T-2): 공개 = 로컬 클라이언트/프로토콜/오케 어댑터 등 비민감·트러스트 자산. 비공개/유료 = hosted 팀 그래프, audit retention, org policy, integrations, compliance.
- 공개 저장소 README: star CTA + 다국어 + topic SEO + "auditable merge" 서사.
- **Orca 생태계에 얹기**: Orca가 "any CLI agent"를 받는 것처럼, **Marblo를 Orca/기타 ADE와 상호운용**하는 브릿지(예: Marblo MCP를 Orca 안에서 호출)를 공개 → "Orca 유저가 Marblo control plane을 붙이는" 유입 경로. Orca의 30+ 에이전트 목록에 우리가 얹힐 수 있으면 배포 무임승차.

### B. 개발자 콘텐츠 · 빌딩인퍼블릭 · 데모

- **제품 = 바이럴 아티팩트 생성기**(T-8): Marblo가 만드는 "audit card"(이 변경이 왜 안전한지 한 장)를 공유 가능한 이미지로. 유저가 자기 팀에 자랑 → 오가닉 확산.
- 빌딩인퍼블릭: Orca의 "daily ship"에 맞불 대신 **"weekly: how we made X auditable"** 서사. 릴리스 빈도가 아니라 **인사이트 빈도**로 경쟁.
- 롱폼 콘텐츠(우리 오디언스 = 엔지니어링 리더): "Who approved that AI PR? A postmortem you can't write yet.", "The audit gap in multi-agent development." → HN/eng 뉴스레터 친화.

### C. 커뮤니티 · 인플루언서

- **인플루언서 세그먼트 분리**: Orca가 잡은 "속도" 인플루언서(개인 빌더) 말고, **플랫폼엔지니어링·개발생산성·eng leadership** 오디언스. 이들은 "감사/거버넌스"에 반응.
- 파운더 베타 100인 → 고밀도 케이스스터디·후기 소스.
- 공개 로드맵 + feature request 포털.

### D. HN / Reddit / X 런치

- **Show HN 각도**: "Marblo — turn parallel agent work into auditable merge decisions" (개인 IDE 각도 X, 팀 감사 각도 O). HN은 "또 다른 agent IDE"에 피로 → 차별 각도가 생존 조건.
- Reddit: r/ExperiencedDevs, r/devops, r/engineeringmanagement(거버넌스 각도) > r/programming(레드오션).
- X: `@` 파운더/베타 유저 후기 리트윗 엔진 + audit card 이미지.
- **타이밍**: HN 런치는 REVIEW Cockpit(T-1)이 데모 가능해진 뒤. 지금 런치하면 "Orca lite"로 소비됨.

---

## 4. 전환 퍼널: 무료 → 개인 Pro → 팀

현재 가격(`PRICING-AND-COST-SAFETY-SPEC.md`, 2026-06-08 정렬): Free(0) · Pro(₩19,000/월) · Team(₩29,000/인·월) · Team Plus(₩290,000/팀, 5시트) · Enterprise(문의).

### 퍼널 설계 원칙

- **Free = 유입 무기, 수익 아님**. Orca의 배포 우위를 상쇄하는 게 유일한 목적.
- **Pro = 전략적 전장 아님**(CEO 리뷰). 개인 IDE로 Orca와 정면 대결 금지. Pro는 "진지한 솔로 빌더" 대상 modest 티어.
- **Team = 본진**. "AI 코드를 안전하게 팀이 도입" 가치에 과금.
- **경계선 = 공유 감사**: free/Pro는 로컬 개인. Team부터 hosted 공유 provenance·org policy·audit export. 이 경계가 흐리면 free가 팀을 잠식(CEO 리뷰 리스크 5).

### 티어별 경계 (마케팅·패키징 관점)

| 티어                   | 대상        | 핵심 가치(마케팅)                                                                                                                  | 상한/경계                                |
| ---------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| **Free**               | 개인, 평가  | 로컬 오케+칸반+터미널/에디터+로컬 diff/review, BYOK                                                                                | 1 프로젝트, 2 에이전트, hosted 감사 없음 |
| **Pro ₩19k**           | 진지한 솔로 | 무제한 프로젝트/에이전트, 자연어 오케, 개인 히스토리/검색, 우선지원                                                                | 개인 전용, 팀 공유 없음                  |
| **Team ₩29k/seat**     | 팀(본진)    | **hosted control plane, task provenance, REVIEW cockpit, typed decision log, PR/CI/merge 캡처, GitHub/Linear/Slack, audit export** | 팀 관리자                                |
| **Team Plus ₩290k/팀** | 규모 팀     | Team + 조직 정책/보존/승인 에이전트 롤아웃                                                                                         | 5시트 floor                              |
| **Enterprise**         | 대기업      | SSO/SAML, retention, self-host/private deploy, compliance packet, SLA                                                              | 문의                                     |

### 전환 트리거 (제품 내 업그레이드 넛지)

1. **Free→Pro**: 2 에이전트/1 프로젝트 상한 도달 시. (약한 전환, 기대치 낮게)
2. **Free/Pro→Team**: **두 번째 사람을 초대하려는 순간** — "공유 감사 타임라인은 Team부터." 이게 핵심 전환점(개인→팀 경계 = 공유 provenance).
3. **Team→Team Plus/Enterprise**: audit export/org policy/SSO 요구 발생 시(= 조달·보안팀 개입 신호).

### 측정 (퍼널)

- Free 다운로드→첫 오케 실행(activation) 전환율.
- 첫 **REVIEW 완료**까지 시간(가치 실현 = 우리 aha).
- Free→2인 초대 발생률(= Team 전환 선행지표).
- 팀 seat 확장(net seat expansion).

---

## 5. 초기 90일 실행 백로그 + 측정지표

사장님 지시(마케팅과 제품빌딩 병행)에 따라, 백로그는 **제품 티켓과 마케팅 티켓을 인터리브**. 각 항목은 후속 티켓화 가능(§6에 티켓 초안).

### 30-60-90 우선순위

**Days 0–30 — 기반(유입 링에 서기)**

1. 오픈코어 경계 + 무료 티어 결정·공개 저장소 셋업 (선행조건). [T-2]
2. 포지셔닝 리라이트: 랜딩 H1/서브/프루프라인/대비섹션 (Orca 상호운용 프레임 포함). [T-3]
3. 설치 마찰 축소: Homebrew cask + 전 플랫폼 다운로드 페이지. [T-4]
4. Security/Trust Packet 문서(코드/프롬프트 프라이버시, BYOK, telemetry, self-host 계획). [T-5]

- 측정: repo star 증가율, 랜딩 방문→다운로드 전환, 다운로드→activation.

**Days 31–60 — 차별화 데모(aha 만들기)** 5. REVIEW Cockpit Lite 데모화 + 히어로 데모 영상(before/after). [T-1 제품 + 마케팅 연동] 6. Audit card = 공유 아티팩트(바이럴 훅). [T-8] 7. 파운더 베타 팀 케이스스터디 2건 + 후기 벽. [T-6]

- 측정: 첫 REVIEW까지 시간, Free→2인 초대율, audit card 공유 수.

**Days 61–90 — 확산(런치)** 8. Show HN + Reddit(eng leadership) + X 런치(Cockpit 준비 후). [T-7] 9. Orca 상호운용 브릿지 공개(생태계 무임승차). [T-9] 10. Team 전환 넛지(2인 초대 트리거) 계측·최적화. [T-10]

- 측정: Team 전환율, seat expansion, 런치 유입·리텐션.

### 핵심 지표 우선순위 (사장님 요청: 별·가입·팀전환·리텐션)

| 우선 | 지표                               | 왜                                   | 목표 성격       |
| ---- | ---------------------------------- | ------------------------------------ | --------------- |
| P0   | **Free→Team 전환율**               | 유일한 수익 축(Pro는 전장 아님)      | 북극성          |
| P0   | **첫 REVIEW까지 시간(activation)** | 우리 aha = 감사 가치 체감            | 선행지표        |
| P1   | **Free→2인 초대 발생률**           | 개인→팀 경계 통과 신호               | Team 전환 선행  |
| P1   | **GitHub star 증가율**             | 유입 깔때기 상단(방어용, 목적 아님)  | 트래픽 대리지표 |
| P1   | **주간/월간 리텐션(팀 seat)**      | 감사 습관화 = 락인                   | 유지            |
| P2   | **가입(신규 계정)**                | 볼륨, 단 activation 없는 가입은 허수 | 볼륨            |
| P2   | **audit card 공유 수**             | 바이럴 오가닉 계수                   | 확산            |

★주의: **star·가입은 대리지표**다. Orca와 star 절대수 경쟁 금지 — activation·Team 전환이 진짜 성적표(어드민 DAU가 도그푸드 옵트인 뿐이었던 전례처럼, 허수 지표 경계).

---

## 6. 후속 티켓 초안 (ticketable)

제품·마케팅 인터리브. `[P]`=제품, `[M]`=마케팅, `[PM]`=둘 다.

- **T-1 [PM] REVIEW Cockpit Lite** — task-level read-only 리뷰 표면(spec/agent/diff/test/risk/decision). 완료기준: REVIEW 티켓 1개를 앱 밖 PR 없이 판단 가능 + 히어로 데모 촬영 가능. (CEO 리뷰 후속 #1와 동일)
- **T-2 [PM] 오픈코어 경계 + 무료 티어 공개** — 무엇이 free/공개 vs 유료/hosted인지 확정, 공개 저장소 셋업. 완료기준: 무료 다운로드 경로 + 오픈코어 라인 문서화. (다른 GTM의 **선행조건**)
- **T-3 [M] 포지셔닝 리라이트** — 랜딩 H1/서브/프루프라인/대비섹션/Orca 상호운용 프레임. 완료기준: `marblo-web` 카피 교체, "auditable merge decisions" 일관.
- **T-4 [PM] 설치 마찰 축소** — Homebrew cask + 통합 다운로드 페이지. 완료기준: `brew install` 1줄 + 전 플랫폼 링크.
- **T-5 [M] Security/Trust Packet** — 코드/프롬프트 프라이버시·BYOK·telemetry·self-host 문서. 완료기준: 바이어가 "Marblo가 우리 코드를 보나?"에 콜 없이 답 얻음.
- **T-6 [M] 파운더 팀 케이스스터디 + 후기 벽** — 베타 100인 중 팀 사례 2건. 완료기준: 랜딩 후기 섹션(팀리드 언어).
- **T-7 [M] 런치 캠페인(HN/Reddit/X)** — Cockpit 준비 후 실행. 완료기준: Show HN + 타깃 서브레딧 + X 후기 엔진 가동.
- **T-8 [P] Audit Card = 공유 아티팩트** — "이 변경이 왜 안전한가" 한 장 이미지 생성. 완료기준: REVIEW에서 공유용 카드 export.
- **T-9 [P] Orca/ADE 상호운용 브릿지** — Marblo control plane을 외부 ADE에서 호출(MCP 등). 완료기준: Orca 안에서 Marblo 티켓/리뷰 접근.
- **T-10 [PM] Team 전환 넛지 + 계측** — 2인 초대 트리거 업그레이드 프롬프트 + 퍼널 이벤트. 완료기준: Free→2인 초대→Team 전환 이벤트 텔레메트리.
- **T-11 [M] README GTM 재설계** — star CTA + 다국어(KO/EN 우선) + topic SEO. 완료기준: repo 상단 전환 최적화.

### 티켓화 의존성

```
T-2(오픈코어/무료·선행) ─┬─> T-4(설치) ─> T-11(README) ─┐
                          ├─> T-3(포지셔닝) ──────────────┤
T-1(Cockpit) ─┬─> T-8(audit card) ─> (바이럴)             ├─> T-7(런치)
              └─> T-6(케이스스터디) ────────────────────────┘
T-5(트러스트) ─(병렬, 상시)
T-9(상호운용) ─(T-2 이후 병렬)
T-10(전환넛지) ─(T-3 이후)
```

---

## 7. 리스크

1. **선행조건 미해결 리스크**: 무료 티어/오픈코어(T-2)가 안 서면 GitHub·배포 축 전체가 죽는다 → 최우선.
2. **Orca-lite 인식 리스크**: Cockpit(차별점) 없이 런치하면 "또 다른 agent IDE"로 소비. **런치는 T-1 이후로 게이팅**.
3. **메시지 혼선 리스크**: 개인 IDE 카피와 팀 감사 카피가 섞이면 바이어가 안 온다. 전 채널 "auditable merge" 단일 서사.
4. **Free 잠식 리스크**: free에 공유 감사가 새어나가면 Team 전환이 죽는다. 경계 = 공유 provenance·org policy·export.
5. **Orca 상방 이동 리스크**: Orca가 hosted 팀 대시보드를 우리보다 먼저 낼 수 있음(238 컨트리뷰터 속도). → 우리 방어선은 "결정/감사 구조" 깊이(typed decision log·safe-merge gate)이지 대시보드 UI가 아님.
6. **바이어 도달 리스크**: 개발자는 Orca를 고르고, 예산은 팀리드가 쥔다. free로 개발자 유입 → 2인 초대 트리거로 팀리드 도달, 이 다리가 끊기면 수익 없음.

---

## 8. 최종 요약

- **Q. Orca(무료·OSS·21.1k star)를 유료로 이기는 마케팅이 가능한가?**
  가능하다. 단 **배포 전쟁을 정면으로 벌이지 않을 때만**. 무료 개인 티어로 유입 깔때기만 방어하고, 마케팅의 무게중심은 Orca가 구조적으로 약한 **팀 감사/거버넌스**로 옮긴다.
- **승부수**: 제품(REVIEW Cockpit·audit card)과 마케팅(포지셔닝·런치)을 **같은 것**으로 병행. Cockpit이 나오는 순간이 랜딩 리론치·HN 런치 시점.
- **선행조건**: 무료 티어 + 오픈코어 경계(T-2). 이것 없이는 어떤 GTM도 시작 못 함.
- **북극성**: Free→Team 전환율 + 첫 REVIEW까지 시간. star·가입은 대리지표일 뿐, 여기에 속지 않는다.

---

## 9. 출처

- Orca GitHub: https://github.com/stablyai/orca (21.1k stars, 838 releases, 238 contributors, MIT — 2026-07-18 확인)
- Orca 제품/랜딩: https://www.onorca.dev/ , https://www.onorca.dev/docs
- Orca README(다국어, 커뮤니티 채널 Discord/`@orca_build`/WeChat): github.com/stablyai/orca/blob/main/README.md
- Marblo 로컬: `v3/docs/CONTROL-PLANE.md`, `v3/docs/PRICING-AND-COST-SAFETY-SPEC.md`
- 상위 전략: `v3/docs/research/marblo-vs-orca-final-ceo-strategy-review-2026-07-17.md`, `v3/docs/marblo-vs-orca-strategy-review-2026-07-17.md`
