---
tags: [강의, 2026-08, 설계]
type: curriculum
aliases: [커리큘럼 v2, 1인 빌더 5부]
---

# 커리큘럼 v2 — 1인 빌더 5부 (2026-08)

> **이번 티켓 범위: 커리큘럼 문서까지.** 레슨 본문은 쓰지 않았다.
> 구성은 사장님 확정본이다. 뼈대를 바꾸지 않았다.
>
> 화면 실측: [../v3/AUDIT-2026-08.md](../v3/AUDIT-2026-08.md)
> 화면 대응표·배포 경계표: PR #1242 (`docs/lectures/v3/CURRICULUM-DESIGN-2026-08.md`, 미머지·대체됨). **두 표만** 가져왔다. 13레슨 구성은 버린다.
>
> GUI/Playwright/Electron 실행은 하지 않았다. 근거는 소스 줄. 확인 못 한 것은 §11.

---

## 0. 한눈에

| | 구 코스 (`docs/lectures/v3`, 2026-06) | 이 커리큘럼 |
| --- | --- | --- |
| 가르치는 것 | 탭·화면 | 폐루프. 화면은 §2 표 |
| 시작 | 가이드가 첫 화면인 탭투어 | 비기너 셸 · 대화 · 원클릭 |
| 승격 | 없음 → 보드가 없어 막힘 | M2 **마블로 모드로 보기** |
| 프로젝트 | 할일앱 → 날씨 → ReachWave | 샘플 첫 머지 → **비서** → 운세 사이트 → 유튜브 요약 → 서비스답게 |
| 끝 | 랜딩 체크리스트·크론 | 시즌별로 자른다. 시즌1만으로도 비서가 남는다 |
| 레슨 본문 | 36파일 | **아직 없음** (다음 티켓) |

모듈이 앞 모듈의 산출물 위에 선다:

```
M1 연결된 대화
 → M2 보드가 보이는 워크스페이스
  → M3 머지된 티켓 1장
   → 2부 내 위키를 읽는 슬랙 비서 + 아침 브리핑
   → 3부 로컬 앱 → 공개 URL
    → 4부 로그인해서 쓰는 서비스 + 사용량 화면
     → 5부 검색·측정·결제 데모·유입을 아는 상태
```

---

## 1. 안 변하는 것 — 폐루프

지난 자료가 두 달 만에 낡은 이유는 화면을 가르쳤기 때문이다. 탭 이름 하나(퀵레인 → **병렬 작업**)가 바뀌면 본문 전체가 틀린다.

코스가 가르치는 것:

```
요청 → 분해(티켓) → 배정(스폰) → 격리 실행(워크트리) → 관찰 → 검증 → 머지 → 재계획
```

각 모듈은 **루프의 어느 단계인가**를 먼저 적고, 그 단계를 지금 어느 화면에서 하는지는 **§2 표**만 본다. UI가 바뀌면 §2만 고친다.

모듈 제목에 탭 이름을 넣지 않는다. "보드를 배웠습니다"가 아니라 **"티켓이 머지됐습니다" / "슬랙에서 말 거는 비서가 있습니다"**로 끝낸다.

레슨 제목에 탭 이름을 박지 말 것. 집필 티켓도 이 규칙을 따른다.

---

## 2. 변하는 것 — 화면 대응표 (PR #1242에서 가져옴)

이 표만 갱신하면 본문을 다시 안 쓴다. 라벨은 `v3/src/locales/ko` 현재 값. 줄 번호는 이 브랜치에서 다시 읽었다.

### 2-1. 셸

| 모드 | 셸 | 첫 화면 | 근거 |
| --- | --- | --- | --- |
| 신규 설치 | 비기너 `BeginnerShell` | **대화** | `v3/src/App.tsx:547-556`, `v3/src/lib/beginnerTabs.ts:51,69-72`, `v3/src/locales/ko/beginner.ts:21` |
| 승격 후 | `WorkspaceShell` 2페인. 오케는 **왼쪽**, 작업 탭은 오른쪽 | 미완료 온보딩이면 **시작하기**, 그 외 보드 | `v3/src/components/workspace/WorkspaceShell.tsx:59-64,76-78`, `v3/src/stores/splitWorkspaceStore.ts:80-88`, `v3/src/locales/ko/workspace.ts:8` |

승격 CTA: 상단바 **마블로 모드로 보기** (`beginner.ts:12-14`). 되돌리기는 가이드 탭이 말한다 (`v3/src/components/guide/guideContent.tsx` — AUDIT: 비기너/마블로 모드 섹션).

비서 프로젝트(`kind === "assistant"`)로 전환하면 엑스퍼트 기본 우측 탭이 **코드**로 기운다 (`v3/src/lib/projectKind.ts:55-62`). 개발 프로젝트 기본은 보드.

### 2-2. 루프 단계 → 지금 화면

| 루프 단계 | 비기너 (탭 9) | 마블로 모드 (프로덕션 오른쪽 13) | 비고 |
| --- | --- | --- | --- |
| 요청 | **대화** | 왼쪽 오케 PTY | 비기너 칩 3개: README 정리 / 테스트 추가 / 구조 설명 (`beginner.ts:183-185`) |
| 분해 | 라이브 스트립 **일감 흐름** (미니 보드) | **보드** (TODO…DONE) | 비기너에 보드 탭 없음 (`beginnerTabs.ts:14-18,54-62`) |
| 배정 | 스트립 + 탭 **마블로봇** | 왼쪽 에이전트 열 + 오른쪽 **마블로봇** | 탭 id `agents`, 라벨 **마블로봇** (`workspace.ts:22`). 갤러리 1단계 PR #1236 |
| 격리 실행 | **워크트리** | **워크트리** + **병렬 작업** | 병렬 작업 = 떠오른 개선을 독립 워크트리에서. 에이전트 관찰대가 아님 (`v3/src/locales/ko/lanes.ts`) |
| 관찰 | 스트립 + 대화 | 왼쪽 에이전트 PTY + 액티비티 | 구 레슨의 "레인에서 관찰"은 여기로 이동 |
| 검증 | **코드** | **코드** + 보드 REVIEW | |
| 머지 | **워크트리** Rebase/Merge | **워크트리** + **완료 이력** | pill: 머지 가능/뒤처짐/stale/충돌/작업중 (`v3/src/locales/ko/worktree.ts:10-14`) |
| 재계획 | 대화에 이어서 말하기 | 보드 상태 + 왼쪽 오케 | FAILED/BLOCKED/REVIEW 컬럼 (`v3/src/components/board/KanbanColumn.tsx:16-26`) |

### 2-3. 탭 목록 (프로덕션)

비기너 9: 대화 · 시작하기 · 가이드 · 코드 · **마블로봇** · 워크트리 · 사용량 · 하네스 · 설정 (`beginnerTabs.ts:54-72`).

마블로 모드가 더 보여주는 5: **보드 · 병렬 작업 · 프로젝트 · 완료 이력 · 스토어**.

플래그 뒤에만 있는 3 — **강의하지 않음**: 미션 · 플로우 (베타) · 배포 (`DEV_ONLY_RIGHT_TABS`, `v3/src/lib/splitWorkspaceLayout.ts:87-89`).

하네스 = 연결 센터. 스킬/MCP 카탈로그 = **스토어** (`v3/src/locales/ko/harness.ts:110-111,180-181`).

### 2-4. 마블로봇 · 트리거 (지금 있는 것만)

| 지금 되는 것 | 근거 |
| --- | --- |
| 프로젝트별 `botDefinitions` 저장. Persona·Mission·Model·Tools·Knowledge | `v3/src/lib/botDefinition.ts:19-32,64-78`, `v3/src/services/botDefinitionService.ts:15`, PR #1236 |
| 시드 실행 가능: **지식 비서**, **풀스택 개발**. 시드에 들어 있지만 연결을 요구: **일일 브리핑**, **메일·일정 팔로업** | `botDefinition.ts:103-171` |
| Knowledge가 켜지면 `wiki_query(root_path)` 가 지시문에 박힌다. root_path 없으면 거부 | `botDefinition.ts:74-76,238-267`, `v3/tests/botDefinition.test.ts` |
| 스케줄·조건 트리거 **화면** | `v3/src/components/agents/AssistantTriggerSettingsPanel.tsx`, `v3/src/components/tabs/AgentsTab.tsx:158-162,243-252`, PR #1243 |
| 트리거 엔진 | `v3/electron/assistant-triggers.ts`. **`kind !== "assistant"` 면 폴링하지 않는다** (`:182-191`) |

| 지금 없는 것 | 근거 |
| --- | --- |
| 모바일 앱 | 소스에 강의할 화면 없음. `botDefinition.ts:179-190` 시드에서 뺀 봇 목록에도 모바일 없음 |
| 유튜브 리서치 시드 / 웹 리서치 시드 | `OMITTED_SEED_BOTS` (`botDefinition.ts:179-190`). "유튜브 전용 커넥터나 검증된 브라우저/검색 MCP가 현재 시드 재료로 확인되지 않음" |
| 배포 탭 GUI, 미션=가이드형 학습, 커스텀 칸반 상태 | AUDIT + `DEV_ONLY_RIGHT_TABS` + `KanbanColumn.tsx:16-26` 고정 리터럴 |

로케일 `agents.marbloBots.triggersBody` ("이 화면은 후속 티켓에서 켭니다", `v3/src/locales/ko/agents.ts:290-292`)는 **컴포넌트에서 쓰이지 않는다**. 위키 노트 `docs/wiki/10-offerings/marblo-bot-messaging.md` 의 "트리거 화면은 없다"는 #1243 이전 문장이다. 강의는 패널을 따른다.

### 2-5. 코치마크는 탭 목록이 아니다

승격 직후 투어가 있다 (`workspace.tour.*`). 제목이 아직 **에이전트**인 카드가 있다 (`workspace.ts:50-52`). 집필 때 탭 라벨은 `workspace.tab.agents` = **마블로봇**을 따른다. 투어가 빠진 탭(병렬 작업·프로젝트·완료 이력·스토어)을 "없는 기능"으로 가르치지 말 것.

---

## 3. 배포 경계표 (PR #1242에서 가져옴)

3부·4부의 공개 URL에 쓴다. 마블로 **배포 탭을 열라고 하지 않는다.**

| 단계 | 누가 | 근거 | 강의에서 |
| --- | --- | --- | --- |
| Dockerfile 작성·리뷰·머지 | 마블로 (에이전트 + 코드 + 워크트리) | 코드 탭, 워크트리 Merge | M5-1, M5-2 |
| 오케에게 배포를 말로 시키기 | 마블로 | `/tf-deploy` 스킬: gcloud 확인 → Cloud Build → Cloud Run (`config/claude/skills/tf-deploy/SKILL.md`, `v3/skills/orchestrator_agent.md:458-461`). 배포 탭 카피도 같은 토큰 (`v3/src/locales/ko/deploy.ts:20-33`) | M5-2. **슬래시 팝업에 `/tf-deploy` 행은 없다** (`v3/src/components/orchestrator/SlashCommandPopup.tsx` 검색 0건). "메뉴에서 /tf-deploy 를 고른다"고 쓰지 말 것 |
| GCP 계정·결제·프로젝트 생성 | **손** (브라우저 콘솔) | 앱 안에 GCP 가입 UI 없음 | 3부 진입 벽. 콘솔 URL을 스크립트에 |
| `gcloud auth login` | **손** (브라우저 승인). 에이전트는 안내만 | 스킬: 미로그인이면 사용자에게 안내, 직접 실행하지 않음 | M5-2 |
| 프로젝트 ID / 리전 / 공개 여부 | **손** (확인). 에이전트는 추측 금지 | 스킬 안전 규칙 | M5-2 |
| `gcloud builds submit` + `gcloud run deploy` | 마블로가 돌릴 수 있음 (왼쪽 터미널 / 에이전트) | 같은 스킬 Phase 1–2 | M5-2 |
| 배포 탭 GUI | **안 가르침** | `DEV_ONLY_RIGHT_TABS` | "곧 정식"으로 포장하지 않음 |
| GitHub Actions 탭 | **없음** | AUDIT `7-3` | 산출물은 URL이지 파이프라인이 아님 |
| 커스텀 도메인·DNS | **손** (선택, 코어 밖) | 앱 화면 없음 | URL만 있으면 완주 |
| git push UI | **확인 못 함 / 렌더러에 없음** | PR #1242: `v3/src` git push UI 0건. 하네스에 **저장소 연결**은 있음 (`harness.ts:183-185`) | 원격 푸시는 에이전트 터미널 또는 손. "마블로 버튼으로 푸시"라고 쓰지 말 것 |
| Cloud Scheduler 등록 | 스킬 Phase 3는 선택 | 3부 운세 사이트에는 불필요 | 코어에서 빼 둔다 |

검증: 배포된 URL을 **수강생이** 브라우저에서 연다. 에이전트는 GUI/Playwright로 앱을 띄워 확인하지 않는다 (저장소 규칙과 동일).

---

## 4. 확정 5부 — 모듈 · 산출물 · 근거

각 행의 **수강생이 갖게 되는 것**이 모듈의 끝이다. 산출물 없는 모듈은 없다.

---

### 1부 · 마블로를 손에 익힌다

**진입 벽: 0.** Claude Pro/Max 또는 ChatGPT Plus/Pro(Codex) **CLI 구독 하나**. Grok 로그인 UI는 있으나 그것만으로는 오케 게이트가 안 열린다 (`beginner.ts:120-123`).

#### M1 설치·연결 → **연결된 대화창**

| | |
| --- | --- |
| 앞 산출물 | 없음 |
| 루프 | 루프 전 셋업 |
| 지금 화면 | 비기너 연결 게이트 → 한 번에 준비하기 → 구독 고르기 → 예제 폴더 자동 연결 → **대화** |
| 수강생이 갖게 되는 것 | Claude 또는 Codex 하나가 인증되고, 폴더가 열린 **대화창** |
| 근거 | `beginner.ts:23-51,88-123,154-161`. 샘플 시드 `v3/electron/sample-project.ts:6-22,40` (`src/format.js` 는 일부러 테스트가 없다) |

구 모듈 2(하네스 스토어 원클릭 → CLI → BYOK → 하단 오케)는 이 한 모듈로 접는다. 제품이 이미 그 순서로 붙어 있다.

#### M2 탭 경험 + 승격 → **보드가 보이는 워크스페이스**

| | |
| --- | --- |
| 앞 산출물 | 연결된 대화 |
| 루프 | 요청·관찰·검증·머지 **자리** 확인 후, 분해 표면을 연다 |
| 지금 화면 | 비기너 9탭을 §2 표로 한 칸씩 연다 → 상단바 **마블로 모드로 보기** → 2페인. 새 5탭: 보드·병렬 작업·프로젝트·완료 이력·스토어 |
| 수강생이 갖게 되는 것 | **보드가 보이는 워크스페이스** |
| 근거 | `beginner.ts:12-14`. 숨겼던 5탭 `beginnerTabs.ts:14-18`. 승격을 빼면 구 모듈 3과 같은 벽(보드 탭 없음) |

★구 코스가 모듈 3에서 막힌 지점이 M2다. 접지 않는다.

#### M3 첫 완주(샘플 티켓 하나) → **머지된 티켓 1장**

| | |
| --- | --- |
| 앞 산출물 | 보드가 보이는 셸 + 샘플(또는 동등한 작은 폴더) |
| 루프 | 요청 → 분해 → 배정 → 격리 → 관찰 → 검증 → 머지 |
| 지금 화면 | 왼쪽 오케(또는 대화) + 보드 + 왼쪽 에이전트 PTY + 코드 diff + 워크트리 Merge. 완료 이력 |
| 수강생이 갖게 되는 것 | **머지된 티켓 1장**. 강사 레퍼런스 = 칩 "테스트가 없는 함수에 테스트를 붙여 줘" (`beginner.ts:184`, `sample-project.ts:21-22`) |
| 근거 | 보드 컬럼 `KanbanColumn.tsx:16-26`. 워크트리 pill `worktree.ts:10-14` |

자연어로 충분하다. `/tf-start` 는 슬래시 팝업에 있으므로 보여 주되, 슬래시 암기가 산출물이 아니다.

**1부 이탈 예상**

| 지점 | 왜 | 강의에서 |
| --- | --- | --- |
| CLI 구독이 없다 | 게이트가 Claude/Codex를 요구 | 설치 전에 "구독 하나"를 말한다. Grok만으로는 안 된다고 숨기지 않는다 |
| 원클릭 로그인 창에서 멈춤 | 브라우저 승인 | 연결 게이트 문구 그대로 (`beginner.ts:35-36`) |
| 승격을 건너뛰고 보드를 찾음 | 비기너에 보드 탭 없음 | M2를 접지 않는다 |
| 샘플이 아닌 빈 폴더 | 첫 지시가 빈 결과 | 제품이 샘플을 심는다. 자기 폴더면 "한 파일짜리 동등 티켓"으로 |

---

### 2부 · 프로젝트 A — 나만의 지식위키 + 개인 비서

★**웹사이트가 아니다. 마블로 안에서 도는 비서다.** 모바일은 없다.

**진입 벽: 0.** 1부와 같이 CLI 구독만 있으면 완주. 슬랙 또는 텔레그램 워크스페이스/봇은 공짜 계정으로 된다. Gmail/Calendar는 브리핑을 두껍게 할 때 추가(Google 연결). 없어도 cron 스케줄 + 열린 할일 브리핑은 엔진이 주입한다 (`formatDailyBriefingPrompt`, `assistant-triggers.ts:308-327`).

★엔진은 `kind === "assistant"` 프로젝트만 폴링한다. **비서 프로젝트를 따로 만들게 해야 한다.** 개발 프로젝트에서 트리거를 켜도 안 돈다.

- 생성 UI: `ProjectKindPicker` — 프로젝트 종류 **개발 | 비서** (`v3/src/components/project/ProjectKindPicker.tsx:14-21`, `v3/src/locales/ko/header.ts:19-23`)
- 엔진 가드: `activeAssistantProjects` (`assistant-triggers.ts:182-191`)
- 화면 경고: "이 프로젝트는 assistant 프로젝트가 아닙니다… 엔진은 assistant 프로젝트에서만 활성화됩니다" (`AssistantTriggerSettingsPanel.tsx:123,182-186,228-235`)
- 기본값 `kind` 없는 구문서는 `dev` (`projectKind.ts:14-16,45-47`)

#### M4-1 위키 구성 (오케에게 요청) → **내 지식위키**

| | |
| --- | --- |
| 앞 산출물 | 머지된 티켓 1장 + 보드가 보이는 셸 |
| 루프 | 요청 (오케 자연어) |
| 지금 화면 | **새 프로젝트 종류 = 비서** 로 폴더를 연다. 대화/왼쪽 오케에 "이 프로젝트에 지식위키를 만들어 줘". 코드 탭에서 `docs/wiki` 가 생긴 것을 본다 |
| 수강생이 갖게 되는 것 | **내 지식위키** (자기 프로젝트 폴더 안의 `docs/wiki`) |
| 근거 | 위키 스킬 `.claude/skills/wiki-init`, `wiki-note`, `wiki-ingest`. MCP `wiki_query` (`v3/electron/mcp-server/tools.ts:8437-8458`). 비서 생성 시 `MEMORY.md` 시드 (`projectKind.ts:17-38`, `useProjectSetup.ts:333-335`). Knowledge 기본 root는 `{project}/docs/wiki` (`botDefinition.ts:192-196`) |

마블로 **이 저장소**의 공유 위키 규칙("형제 프로젝트에 위키를 만들지 마라")은 마블로 클론 안의 에이전트용이다. 수강생 위키는 **수강생 프로젝트 폴더**에 만든다. 마블로 `docs/wiki` 를 고치라고 하지 않는다.

#### M4-2 봇 만들기 (Persona·Mission·Model·Tools·Knowledge) → **내 위키를 읽는 봇**

| | |
| --- | --- |
| 앞 산출물 | 내 지식위키 |
| 루프 | 배정 (저장된 봇 정의 → 기존 dispatch) |
| 지금 화면 | 마블로봇 탭 → **봇 갤러리**. 시드 **지식 비서** 또는 커스텀. Knowledge ON + root_path = 내 `docs/wiki` |
| 수강생이 갖게 되는 것 | **내 위키를 읽는 봇** 1개 (프로젝트 `botDefinitions` 에 저장) |
| 근거 | 5축 `botDefinition.ts:19-32`. 시드 지식 비서 tools=`wiki_query` (`:103-117`). 갤러리 UI `MarbloBotGallery.tsx`, 카피 `agents.ts:262-264`. dispatch 지시 `buildBotDispatchInstruction` (`:228-268`). 저장 컬렉션 `botDefinitionService.ts:15`. PR #1236, Knowledge·트리거 UI PR #1243 |

#### M4-3 슬랙 또는 텔레그램 연결 → **슬랙에서 말 거는 비서**

| | |
| --- | --- |
| 앞 산출물 | 위키를 읽는 봇 + 비서 프로젝트 |
| 루프 | 요청 표면이 채널로 확장 |
| 지금 화면 | 하네스 탭 연결 섹션 — `TelegramChannelPanel` / `SlackChannelPanel` (`HarnessStore.tsx:629-631`, `harness.ts:182-185`) |
| 수강생이 갖게 되는 것 | **슬랙 또는 텔레그램에서 말 거는 비서**. 둘 다 필수가 아니다. 하나면 완주 |
| 근거 | 전송 도구 `send_slack_message` / `send_telegram_message` (시드 tools, `botDefinition.ts:141-145`). 트리거 출력 타입 `"slack" \| "telegram"` (`assistant-triggers.ts:12`). 채널 미연결이면 저장이 거부된다 (`AssistantTriggerSettingsPanel.tsx:48-51`) |

모바일 앱은 없다. "폰에서 마블로 앱을 연다"고 쓰지 말 것. 폰의 슬랙/텔레그램은 채널이지 마블로 클라이언트가 아니다.

#### M4-4 스케줄·조건 트리거 → **자는 동안 오는 아침 브리핑**

| | |
| --- | --- |
| 앞 산출물 | 채널이 연결된 비서 |
| 루프 | 재계획의 자동화 (사람 요청 없이 루프가 한 번 돈다) |
| 지금 화면 | 마블로봇 탭 → **트리거**. cron 예: `0 9 * * 1-5`. 출력 채널 Slack 또는 Telegram. 선택: Calendar/Gmail 조건 |
| 수강생이 갖게 되는 것 | **자는 동안 오는 아침 브리핑** (채널로 푸시) |
| 근거 | 패널 `AssistantTriggerSettingsPanel.tsx:207-211`. 엔진 스케줄 시작 `assistant-triggers.ts:468-515`. 주입 문장 `formatDailyBriefingPrompt` (`:308-327`) — 일반 텍스트만 쓰면 채널로 안 가고 `send_slack_message` / `send_telegram_message` 를 호출해야 한다고 명시. 시드 일일 브리핑 `botDefinition.ts:132-150` |

Calendar/Gmail은 Drive 커넥터 scope (`AssistantTriggerSettingsPanel.tsx:40-41,147-148`). 없어도 cron만으로 브리핑은 돈다. 일정·메일 없는 브리핑이 된다.

**2부 이탈 예상**

| 지점 | 왜 | 강의에서 |
| --- | --- | --- |
| 개발 프로젝트에서 트리거를 켬 | 엔진이 `kind !== "assistant"` 를 버림 | M4-1 첫 화면에서 **비서**를 고른다. 패널 경고문을 보여 준다 |
| Knowledge ON + root_path 공란 | `knowledge_root_required` 로 저장 거부 | 위키가 먼저, 봇이 나중 |
| 슬랙·텔레그램 둘 다 없음 | 출력 채널 필수 | M4-3에서 하나만 |
| Google 연결을 브리핑 필수로 오해 | 조건 트리거만 Calendar/Gmail | cron만으로도 "아침 브리핑" 산출물은 성립한다고 가른다 |
| 위키를 마블로 클론에 만들려 함 | 이 저장소 스킬 문구가 공유 위키 하나라고 함 | 수강생 **자기 폴더** |

---

### 3부 · 프로젝트 B — 운세 사이트 (간단)

첫 배포를 **벽 없이** 넘긴다는 말은 "외부 API 키 0개"다. **GCP 결제계정(카드 등록)은 있다.** 무료 티어는 있지만 카드는 등록해야 한다.

운세 사이트 **실물은 이 저장소에 없다.** 수강생이 마블로 루프로 새로 짓는다. 참조는 티켓 병렬 + Cloud Run 배선이다.

#### M5-1 티켓으로 쪼개 병렬 실행 → 로컬에서 도는 앱

| | |
| --- | --- |
| 앞 산출물 | 1부의 루프를 한 바퀴 닫아 본 손. 2부 비서와 **다른 개발 프로젝트** (`kind=dev`) |
| 루프 | 요청 → 분해 → 배정 → 격리 → 관찰 → 머지 (로컬 완주) |
| 지금 화면 | 오케 자연어로 쪼개기. 보드 여러 카드 + 왼쪽 에이전트 여러 PTY. 코드 + 터미널로 `npm run dev` 등 |
| 수강생이 갖게 되는 것 | **로컬에서 도는 앱**. 외부 API 키 0. 날짜·이름만으로 운세를 보여 주면 충분 |
| 근거 | 보드 병렬 `KanbanColumn.tsx:16-26`. 워크트리 격리. 프로젝트 종류 **개발** (`header.ts:20-22`) |

강사 레퍼런스 제약 (집필 때 문구만): 페이지 하나, 입력 최소, 컨테이너 하나. 결제·모바일·스케줄러를 이 부에 넣지 않는다.

#### M5-2 Dockerfile → Cloud Run → **공개 URL**

| | |
| --- | --- |
| 앞 산출물 | 로컬에서 도는 그 앱 |
| 루프 | 머지(main) → 요청(배포) → 검증(프로덕션) |
| 지금 화면 | 워크트리 Merge. 오케에 말로 배포. 코드에서 Dockerfile. **배포 탭을 열지 않음**. 브라우저(외부)에서 Cloud Run URL |
| 수강생이 갖게 되는 것 | **다른 사람이 여는 HTTPS URL** |
| 근거 | §3 배포 경계표. `/tf-deploy` 스킬. 우리 운영 배선은 GCP 프로젝트 `marblo-2253d` (텔레메트리 문서 `docs/analytics/*`, `v3/docs/install-attribution-utm-rate.md:9,13`) |

**3부 이탈 예상 — 시즌을 여기서 자를 1순위 벽**

| 지점 | 왜 | 강의에서 |
| --- | --- | --- |
| GCP 결제계정에 카드 등록을 거부 | 무료 티어도 카드 필요. 앱이 대신 못 함 | 3부 입구에서 벽을 말한다. 1·2부만으로 시즌1 완주가 있게 한다 |
| `gcloud auth login` 브라우저 승인 | 손 구간 | §3 표. 에이전트가 로그인 창을 대신 넘지 않는다 |
| 프로젝트 ID/리전을 에이전트가 추측 | 스킬이 추측 금지 | 수강생이 말해 준다 |
| 배포 탭을 찾음 | 플래그 뒤 | 안 가르친다 |

---

### 4부 · 프로젝트 C — 유튜브 요약 서비스 (복잡)

서버에서 도는 서비스라 **CLI 구독을 못 쓴다.** 자막 API·LLM 호출이 서버 키로 나간다.

유튜브 자막→요약 **파이프라인 실물은 이 저장소에 없다.** 시드 "유튜브 리서치"는 커넥터 부재로 뺐다 (`botDefinition.ts:179-184`). 수강생이 새로 짓는다. 가르치는 것은 **우리 서비스가 실제로 쓰는 Auth·Firestore·Functions·BigQuery 배선**이다.

#### M6-1 URL → 자막 → 요약 파이프라인

| | |
| --- | --- |
| 앞 산출물 | 3부의 공개 URL 경험 (컨테이너 하나) |
| 루프 | 요청 → 분해 → 격리 실행 |
| 지금 화면 | 개발 프로젝트. 보드 티켓으로 파이프라인 쪼개기. 서버 런타임(Cloud Run 등) |
| 수강생이 갖게 되는 것 | URL을 넣으면 자막을 가져와 요약이 나오는 **파이프라인**. 로컬 또는 배포된 엔드포인트 |
| 근거 (패턴) | 서버 배포는 §3과 같다. 외부 키는 Secret Manager 절이 스킬에 있다 (`tf-deploy/SKILL.md` Secret Manager). **자막 공급자·LLM 벤더 선택은 확인 못 했다 — 특정 SaaS를 "우리 코드에 있다"고 쓰지 말 것** |

#### M6-2 Firebase Auth + Firestore → **로그인해서 쓰는 서비스**

| | |
| --- | --- |
| 앞 산출물 | 요약 파이프라인 |
| 루프 | 검증 (사람만 쓰게) |
| 지금 화면 | 수강생 Firebase 프로젝트. 웹 로그인 + 문서 저장 |
| 수강생이 갖게 되는 것 | **로그인해서 쓰는 서비스** (내 요약 기록이 계정에 남음) |
| 근거 (우리 실물) | 웹 로그인 `marblo-web/src/app/[locale]/auth/login/page.tsx:7-40` (`signInWithEmailAndPassword`, `signInWithPopup` + Google). 가입 `signup/page.tsx` `createUserWithEmailAndPassword`. Firebase 앱 `marblo-web/src/lib/firebase.ts`. Firestore 규칙 본인 문서만 `v3/firestore.rules` (`lectures_progress` `:847-856` 패턴). 데스크톱도 `v3/src/lib/firebase.ts` |

버튼 문구(Google/GitHub/email 몇 개인지)는 AUDIT과 같이 **확인 못 했다.** 키 존재만 근거로 한다.

#### M6-3 BigQuery 사용 로그 + 내 대시보드 → **누가 얼마나 쓰는지 보이는 화면**

| | |
| --- | --- |
| 앞 산출물 | 로그인 서비스 |
| 루프 | 관찰 (프로덕션 사용) |
| 지금 화면 | 수강생 BQ 데이터셋 + 간단한 대시보드 페이지 |
| 수강생이 갖게 되는 것 | **누가 얼마나 쓰는지 보이는 화면** |
| 근거 (우리 실물) | 프로젝트 `marblo-2253d`, 데이터셋 `marblo_telemetry` (`docs/analytics/beta-activity-2026-07.md:13`, `v3/docs/install-attribution-utm-rate.md:13`). Functions analytics 계열 `v3/functions/src/analyticsAdSpend.ts`, `analyticsPurchase.ts`, `adminAnalytics.ts`, `ga4Bridge.ts`. 어드민 화면 `marblo-web/src/app/[locale]/admin/AnalyticsPanel.tsx` |

마블로 앱 **사용량 탭**은 CLI 토큰 비용이다 (`workspace.ts:30`). 수강생 유튜브 서비스의 사용량 화면이 아니다. 섞지 말 것.

**4부 이탈 예상**

| 지점 | 왜 | 강의에서 |
| --- | --- | --- |
| 자막 API 키 / LLM 서버 키 | CLI 구독이 서버에서 안 먹음 | 4부 입구에서 벽을 말한다. 키 발급은 손 |
| Firebase 프로젝트 생성 | 콘솔 손 구간 | 우리 프로젝트 ID를 수강생 계정에 넣지 말 것. 수강생 소유 프로젝트 |
| "마블로가 유튜브 요약을 한다"고 기대 | 시드가 의도적으로 없음 | 수강생이 짓는 서비스다. 마블로는 루프 |
| BQ 리전 | 우리 GA4는 `asia-northeast3`, 텔레메트리는 `US` — 한 쿼리로 조인 불가 | `ga4Bridge.ts:4-10`. 수강생 서비스는 **한 리전으로 시작**하라고 못 박는다 |

---

### 5부 · 서비스를 서비스답게

4부의 그 서비스 위에 선다. 결제는 **테스트키 완주까지**. 실계약은 사업자등록·PG 심사가 필요하고 **강의 밖**이다.

#### M7-1 SEO + GA4 → 검색에 잡히고 측정되는 사이트

| | |
| --- | --- |
| 앞 산출물 | 로그인해서 쓰는 서비스 |
| 루프 | 검증 (검색·측정) |
| 지금 화면 | 수강생 사이트 sitemap/robots/JSON-LD + GA4 측정 ID |
| 수강생이 갖게 되는 것 | **검색에 잡히고 측정되는 사이트** |
| 근거 (우리 실물) | `marblo-web/src/lib/gtag.ts:1-13,40+`, `marblo-web/src/components/GoogleAnalytics.tsx`, `marblo-web/docs/GA4_TAGGING_GUIDE.md`. SEO `marblo-web/src/lib/schema.ts:5`, `marblo-web/src/lib/seo.ts`, `marblo-web/src/app/sitemap.ts`, `robots.ts`. GA4→BQ 브리지 `v3/functions/src/ga4Bridge.ts:1-53` |

스킬 경로 `.claude/skills/seo-geo-full`, `.claude/skills/ga4-full-tagging` 는 **이 저장소 `.claude/skills/` 에는 없다** (wiki/tf 스킬만 있음). 이 작업기 `~/.claude/skills/` 에는 있다. 수강생 마블로 스토어에 같은 패키지가 있는지는 **확인 못 했다.** 강의 근거는 우리 웹 코드와 `marblo-web/docs/GA4_TAGGING_GUIDE.md` 다.

#### M7-2 결제 연동(테스트키) → 결제 화면이 도는 데모

| | |
| --- | --- |
| 앞 산출물 | 측정되는 사이트 |
| 루프 | 검증 (돈 경로 데모) |
| 지금 화면 | 수강생 체크아웃. PG **테스트키**. 실결제 0원 |
| 수강생이 갖게 되는 것 | **결제 화면이 도는 데모** |
| 근거 (우리 실물) | 웹 체크아웃 `marblo-web/src/app/[locale]/checkout/page.tsx`. 기본 공급자 portone (`marblo-web/src/lib/paymentProvider.ts:1-25`). 서버 검증 `v3/functions/src/portone.ts:1-80`. 평가 문서 `docs/payment/portone-eval.md` |

실계약·자동결제·가맹 심사는 강의 밖. 근거:

- 토스 심사 문서: 사업자등록증과 기재가 다르면 카드사 심사 반려 (`docs/toss-review/2026-07-20-full-sweep.md:184,361`)
- 환불 정책 회귀 테스트가 "토스페이 3차 반려 재발 차단"을 명시 (`marblo-web/src/app/[locale]/legal/refundPolicy.test.ts:2`)
- 통신판매업 신고 전 유료 판매 리스크 (`marblo-web/docs/COMPLIANCE-AUDIT.md:85`)

티켓이 말한 "당일 토스페이 자동결제 반려" **원문은 이 저장소에서 확인 못 했다.** 위의 심사·반려 문서가 벽을 설명한다.

#### M7-3 마케팅 — UTM·전환 측정 → **어디서 왔는지 아는 상태**

| | |
| --- | --- |
| 앞 산출물 | 결제 데모가 있는 사이트 |
| 루프 | 관찰 (유입) |
| 지금 화면 | 랜딩 URL에 utm 부착. GA4 + (가능하면) 광고비 한 줄 |
| 수강생이 갖게 되는 것 | **어디서 왔는지 아는 상태** (source/medium/campaign이 보이는 기록) |
| 근거 (우리 실물) | 규약 `v3/docs/utm-tagging-convention-2026-08-24.md:9-13,25-29`. 설치 귀속 `v3/docs/install-attribution-utm-rate.md`. GA4 브리지 first-touch `ga4Bridge.ts:21-53`. 어드민 광고비·CAC `v3/functions/src/analyticsAdSpend.ts:2-19,80-122`, UI `AnalyticsPanel.tsx` (광고비 수동 입력) |

**5부 이탈 예상**

| 지점 | 왜 | 강의에서 |
| --- | --- | --- |
| 실결제·자동결제·가맹 심사 | 사업자등록·PG·통신판매 | 테스트키에서 자른다. "라이브 결제"를 완주로 두지 않는다 |
| GA4 측정 ID 없음 | env 없으면 no-op (`gtag.ts:8-13`) | ID를 넣는 손 구간. 없어도 코드는 깨지지 않는다고 말한다 |
| GitHub 릴리즈 직링에 광고 | utm이 안 묻음 | 규약: 광고는 `marblo.app?utm=`. 수강생 사이트도 랜딩을 거친다 |
| 방문 분모로 CAC | 우리 실수는 봇 방문이 CAC를 부풀림 | `analyticsAdSpend.ts:15-19,95-100` — 수강생 대시보드는 **사람/다운로드**부터 |

---

## 5. 진입 벽 · 이탈 — 부별 요약 (시즌을 자르는 표)

| 부 | 벽 | 완주 조건 | 이탈이 몰리는 곳 | 시즌을 여기서 자르면 남는 것 |
| --- | --- | --- | --- | --- |
| 1부 | **0.** CLI 구독 하나 (Claude 또는 Codex) | 머지된 티켓 1장 | 구독 없음, 승격 생략 | 마블로를 한 바퀴 닫아 본 손 |
| 2부 | **0.** 같은 CLI 구독. 슬랙/텔레그램은 무료 계정 | 채널로 말 거는 비서 + 아침 브리핑 | **비서 프로젝트 kind를 안 만듦**, 채널 미연결 | 마블로 안에서 도는 개인 비서 |
| 3부 | **GCP 결제계정 카드 등록** | 공개 URL | 카드 거부, `gcloud auth login` | 첫 배포를 넘긴 사람 |
| 4부 | **외부 API 키** (자막·LLM). 서버라 CLI 구독 불가 | 로그인해서 쓰는 서비스 + 사용량 화면 | 키 발급, Firebase 콘솔 | 복잡한 서비스를 한 번 올린 사람 |
| 5부 | 결제는 **테스트키까지**. 실계약 = 사업자등록·PG 심사 = **강의 밖** | 검색·측정·결제 데모·유입을 아는 상태 | 실결제까지 가려 함 | 서비스답게 다는 사람 |

1·2부는 같은 벽(0)이라 **한 시즌으로 완주 상품이 된다.**

---

## 6. 시즌 분할 제안

촬영 분량이 커진다. 구 코스는 36레슨 ~15.5시간이었고, 이번은 산출물 루프라 라이브가 더 길 수 있다. 레슨 분량은 집필 때 실측한다. 여기서는 **자르는 자리**만 못 박는다.

| 시즌 | 부 | 벽 | 시즌 산출물 | 권장 |
| --- | --- | --- | --- | --- |
| **시즌 1** | 1부 + 2부 | 0 | 머지 1 + 슬랙/텔레그램 비서 + 아침 브리핑 | **1차로 찍고 판다.** 사장님이 시즌을 자른다면 여기 |
| **시즌 2** | 3부 | GCP 카드 | 운세 사이트 공개 URL | 카드 벽을 통과할 사람만. 외부 키 0이라 4부보다 가볍다 |
| **시즌 3** | 4부 + 5부 | 외부 키 + 테스트키 | 로그인 서비스 + 측정·결제 데모 + 유입 | 서버 키를 낼 사람. 5부는 4부 산출물 위에 선다 |

4부와 5부를 더 자를 수 있다 (시즌 3 = 유튜브 요약, 시즌 4 = 서비스답게). 5부만 단독으로 열면 올릴 서비스가 없다.

촬영 순서(설계 수준, 컷 리스트 아님):

1. 시즌1 라이브 한 줄거리 (비서 완주) — 참조 컷
2. M1 → M2 → M3 클린 설치
3. M4-1…M4-4 (비서 kind를 빼먹지 않는 컷)
4. 시즌2: 운세 로컬 → 손 GCP → URL
5. 시즌3: 파이프라인 → Auth → BQ 화면 → SEO/GA4 → 테스트키 결제 → UTM

`docs/lectures/v3/V3_촬영가이드.md` 로 찍지 말 것 (2026-04, 4탭).

---

## 7. 우리 저장소 실물 — 근거 인덱스

남의 튜토리얼이 아니라 **운영 중인 서비스의 실제 배선**을 가르친다. 수강생 프로젝트에 이 파일들을 복사하지 않는다. 패턴을 보여 준다.

| 주제 | 우리 실물 | 쓰는 부 |
| --- | --- | --- |
| GCP · BigQuery | `marblo-2253d` / `marblo_telemetry` (`docs/analytics/*`, `v3/docs/install-attribution-utm-rate.md`). Functions `v3/functions/src/adminAnalytics.ts`, `analyticsAdSpend.ts`, `analyticsPurchase.ts`, `ga4Bridge.ts` | 3 · 4 · 5 |
| Firebase Auth · Firestore · Functions | `marblo-web/src/lib/firebase.ts`, `auth/login/page.tsx`, `v3/src/lib/firebase.ts`, `v3/firestore.rules`, `v3/functions/src/*` | 4 |
| SEO · GA4 | `marblo-web/src/lib/schema.ts`, `seo.ts`, `gtag.ts`, `components/GoogleAnalytics.tsx`, `app/sitemap.ts`, `app/robots.ts`, `marblo-web/docs/GA4_TAGGING_GUIDE.md`, `v3/functions/src/ga4Bridge.ts` | 5 |
| 결제 | `v3/functions/src/portone.ts`, `marblo-web/src/app/[locale]/checkout/page.tsx`, `marblo-web/src/lib/paymentProvider.ts` | 5 |
| 마케팅 · CAC | `v3/docs/utm-tagging-convention-2026-08-24.md`, `analyticsAdSpend.ts`, `marblo-web/src/app/[locale]/admin/AnalyticsPanel.tsx` | 5 |
| 위키 · 봇 · 트리거 | `.claude/skills/wiki-*`, `botDefinition.ts`, `MarbloBotGallery.tsx`, `assistant-triggers.ts`, `AssistantTriggerSettingsPanel.tsx` | 2 |
| 배포 | `config/claude/skills/tf-deploy/SKILL.md` | 3 · 4 |

시크릿·`.env`·firebase-config 원문은 강의 자료에 붙이지 않는다. 키 **존재**와 마스킹만.

---

## 8. 명시적으로 안 하는 것

| 항목 | 이유 |
| --- | --- |
| 모바일 앱 | 없음 |
| 13레슨 구성 (PR #1242) | 대체됨. 표 둘만 남김 |
| 구 8×36 순서 | 동결. 화면과 어긋남 |
| 할일앱 · 날씨 · ReachWave | 1인 빌더가 배포해서 쓰는 물건이 아님 |
| 배포 탭 · 미션 탭 · 플로우 탭 | `DEV_ONLY_RIGHT_TABS` |
| 유튜브 자막 파이프라인이 "우리 제품에 있다" | 시드에서 뺐고 코드 검색 0 |
| 실결제 · 자동결제 · 통신판매 신고 | 강의 밖 |
| BYOK 프리셋 암기, dispatch 점수 UI | AUDIT도 점수 UI를 확인 못 함. 산출물 아님 |
| 커스텀 칸반 상태 | UI 없음 (`KanbanColumn.tsx` 고정) |

---

## 9. 구 폴더 · HOME · 촬영가이드

| 파일 | 이 티켓에서 | 이유 |
| --- | --- | --- |
| `docs/lectures/2026-08/*` | **진실원** | 이 문서 |
| `docs/lectures/v3/HOME.md` | 동결 표시 1줄 | 8×36 인덱스. 이 순서로 찍지 말 것 |
| `docs/lectures/v3/AUDIT-2026-08.md` | 동결 표시 1줄. 본문 유지 | 화면 실측. §2와 같이 읽는다 |
| `docs/lectures/v3/V3_촬영가이드.md` | 동결 표시 1줄 | 2026-04. 이 파일로 찍지 말 것 |
| `docs/lectures/v3` 레슨 본문 36 | **손대지 않음** | 집필 티켓이 재작성 |
| `docs/MVP/V3_커리큘럼_v2.md` | 안 고침 | 가격·매출 문서. 레슨 진실원 아님 |

---

## 10. 집필 때 지킬 것 (본문은 다음 티켓)

1. 모듈 머리: 루프 단계 → 산출물 → 지금 화면(§2). 탭 이름을 제목으로 쓰지 않는다.
2. 존재하지 않는 화면 0. 미션·플로우·배포 탭·모바일을 "있다/곧"으로 쓰지 않는다.
3. UI가 바뀌면 §2만 고치고 본문의 루프 문장은 유지.
4. 구 36파일 순서로 찍지 않는다.
5. 2부에서 비서 프로젝트(`kind=assistant`)를 빼먹지 않는다.
6. 5부 결제는 테스트키에서 자른다.
7. 확인 못 한 것을 추측으로 메우지 않는다.

---

## 11. 확인 못 한 것

추측으로 메우지 않았다.

| 항목 | 상태 |
| --- | --- |
| 사용량 탭 기본 기간이 "최근 7일"인지 | AUDIT과 동일, 확인 못 함 |
| dispatch 점수를 숫자로 그리는 UI | AUDIT과 동일, 확인 못 함 |
| 에이전트 탭 **reuse** 한글 라벨 | AUDIT과 동일. cleanup은 **정리** |
| 로그인 화면 버튼 문구 (Google/GitHub/email) | 키 존재만 확인, 버튼 카피 미확인 |
| `/tf-deploy` 가 프로덕션 오케 세션에 슬래시 없이 항상 붙는지 | 스킬·locale·DeployTab 카피는 확인. 슬래시 팝업 행은 없음. **런타임 바인딩은 GUI로 안 봐서 확인 못 함.** 강의는 자연어 요청 |
| git push 전용 버튼 | 렌더러 검색 0건 (PR #1242와 동일). 이 브랜치에서 재검색하지 않은 항목은 그대로 둠 |
| 코치마크가 승격 직후 항상 뜨는지 | 카피 존재 확인. 노출 조건은 이 티켓에서 추적 안 함 |
| Cloud Run 이외 배포(Vercel 등)를 마블로가 돕는지 | `/tf-deploy` 문서는 GCP만 → 가르치지 않음 |
| 유튜브 자막/요약 공급자 | 이 저장소에 실물 없음. 특정 SaaS를 지정하지 않음 |
| `.claude/skills/seo-geo-full` · `ga4-full-tagging` 이 수강생 스토어에 있는지 | 이 저장소 `.claude/skills` 에는 없음. 작업기 홈 스킬 디렉터리에는 있음 |
| "당일 토스페이 자동결제 반려" 원문 | 저장소에서 못 찾음. 심사·3차 반려 문서는 있음 |
| 아침 브리핑이 채널에 실제로 도착하는지 (슬랙/텔레그램 E2E) | 엔진·프롬프트·전송 도구는 소스 확인. **라이브 전달은 GUI 금지라 확인 못 함** |
| 수강생 다수가 이미 쓸 레포를 가지고 오는 비율 | 소스만으로 모름. 샘플(M3) → 새 폴더 또는 기존 레포 둘 다 허용 |
