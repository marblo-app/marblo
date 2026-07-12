# 마블로 모바일 컴패니언 화면 구성·UX 설계

> 범위: 설계/기획 문서. 구현 코드 없음.
> 전제: `marblo-web`는 Next 16 기반 PWA로 확장한다.
> 선행 검토: `docs/mobile-companion-feasibility.md`(#394)를 기준으로 한다.

## 1. 설계 전제

### 1.1 확인된 근거

| 항목 | 설계에 반영할 사실 |
| --- | --- |
| 앱 기반 | `marblo-web/package.json` 기준 Next 16.2.2, React 19, Firebase 12, `next-intl`, Tailwind v4, `lucide-react` 사용. |
| 디자인 토큰 | `marblo-web/src/app/globals.css`에 인디고 브랜드 스케일, `rounded-button`, `rounded-card`, `font-sans`, `font-display`, 전역 focus ring 정의. |
| 인증 | `marblo-web/src/lib/firebase.ts`에서 Firebase Auth/Firestore가 이미 초기화되고, 로그인 화면은 Email/Google을 사용한다. |
| i18n | `marblo-web/src/i18n/routing.ts` 기준 `ko/en/ja` locale 라우팅. 신규 컴패니언 문구도 `messages/*.json`로 관리해야 한다. |
| 기존 모바일 상태 | `marblo-web/docs/mobile-audit-2026-07-05/README.md` 기준 페이지 레벨 가로 오버플로와 모바일 메뉴 겹침은 없었지만, 44px 미만 터치 타겟 개선 필요가 확인됨. |
| 보드 데이터 | `tasks` 컬렉션을 projectId로 구독하면 실시간 보드를 만들 수 있다. 상태는 `TODO/CLAIMED/IN_PROGRESS/REVIEW/BLOCKED/FAILED/DONE`. |
| 액티비티 데이터 | `activities`는 태스크별 진행 로그, `audit_logs`는 MCP 툴콜 기반 Activity Stream 소스다. |
| 오케 입력 | 모바일에서 `pendingInstructions`에 쓰면 데스크톱 오케 PTY로 주입되는 경로는 있다. |
| 오케 응답 | 오케가 모바일 앱으로 응답을 되돌리는 채널은 없다. Phase 1의 신규 설계 대상이다. |
| 데스크톱 상태 | heartbeat를 통해 데스크톱 online/offline 상태를 표시할 수 있다. |
| PWA | `marblo-web`에는 현재 manifest/service worker가 없다. PWA화 시 신규 추가가 필요하다. |

### 1.2 출시 게이트

- **보안 선행**: 검토 문서의 결론대로 `tasks`, `activities`, `audit_logs`, `pendingInstructions`의 Firestore rule이 `isProjectMember(projectId)` 수준으로 하드닝되기 전에는 Phase 0 읽기전용도 출시하지 않는다.
- **응답 채널 부재**: Phase 1 대화 화면은 `오케 -> 모바일` 응답 채널이 생기기 전까지 "보낼 수는 있지만 앱 안에서 답을 받을 수 없는" UX가 되므로 출시 범위에서 제외한다.
- **원격 오케 제어 위험**: 모바일발 명령은 `sourceType="mobile"`로 구분하고, 승인/위험 명령은 Phase 2까지 구조화된 게이트를 둔다.
- **데스크톱 의존성**: 오케는 로컬 데스크톱 Electron 안에서만 실행된다. 모바일은 데스크톱을 직접 호출하지 않고 Firestore만 사용한다.

## 2. 제품 방향

모바일 컴패니언은 데스크톱 앱의 축소판이 아니라, 이동 중 상태 확인과 짧은 의사결정을 위한 운영 화면이다.

핵심 원칙:

- 첫 화면은 보드 상태다. 사용자가 가장 자주 확인하는 것은 "무슨 태스크가 어디까지 갔는가"다.
- Phase 0은 읽기전용이다. 카드 이동, 태스크 생성, 상태 변경은 넣지 않는다.
- 대화와 승인은 보안/응답 채널이 준비된 뒤 단계적으로 연다.
- 데스크톱 오프라인 상태를 항상 노출한다. 오케 명령이 즉시 실행될 수 있는지 사용자가 알아야 한다.
- 모바일 감사에서 확인된 터치 타겟 문제를 반복하지 않는다. 주요 탭/버튼/칩은 최소 44px, 권장 48px 높이를 기준으로 한다.

## 3. 네비게이션 구조

### 3.1 권장 구조: 하단 탭 + 상단 프로젝트 칩

하단 탭을 기본으로 한다.

```
┌─────────────────────────┐
│ Project A        Online │  ← 상단 프로젝트 칩 + 데스크톱 상태
├─────────────────────────┤
│                         │
│      current screen      │
│                         │
├─────────────────────────┤
│ Board Activity Oke State │  ← 하단 탭
└─────────────────────────┘
```

탭:

| 탭 | 화면 | Phase | 이유 |
| --- | --- | --- | --- |
| Board | 칸반 모바일뷰 | 0 | 상태 확인의 주 화면. |
| Activity | 액티비티 스트림 | 0 | 실시간 변경/로그 확인. |
| Oke | 오케 대화 | 1 | 응답 채널 생긴 뒤 활성화. Phase 0에서는 disabled 안내. |
| State | 데스크톱 상태 | 0 | 온라인/오프라인, 큐잉, 마지막 heartbeat 확인. |

프로젝트 전환은 하단 탭이 아니라 상단 프로젝트 칩을 누르는 바텀시트로 처리한다. 프로젝트는 모든 화면의 컨텍스트이므로 별도 탭보다 전역 컨텍스트 스위처가 맞다.

### 3.2 드로어는 보조로만 사용

드로어는 기본 네비게이션으로 쓰지 않는다. 모바일에서 주요 작업이 3~4개로 고정되어 있고, 자주 오가는 운영 화면이므로 드로어는 발견성과 전환 속도가 떨어진다.

드로어 또는 계정 메뉴에 넣을 항목:

- 계정/로그아웃
- 언어 전환
- PWA 설치 안내
- 개인정보/약관
- 디버그 정보(베타 내부용)

## 4. 화면 목록과 우선순위

| 화면 | Phase 0 | Phase 1 | Phase 2 |
| --- | --- | --- | --- |
| 칸반 모바일뷰 | 읽기전용 보드, 카드 상세, 역할 필터 | 태스크 앵커에서 오케에게 질문 | 승인 결과/푸시에서 보드 딥링크 |
| 액티비티 스트림 | `audit_logs`/`activities` 읽기, 필터 | 이벤트에서 오케 대화 시작 | 푸시 이벤트 landing 화면 |
| 오케 대화 | disabled/준비중 안내 | 모바일 -> 오케 입력, 오케 -> 모바일 응답 채널 구독 | 승인 카드, 위험 명령 확인 |
| 프로젝트 전환 | 멤버 프로젝트 선택 | 프로젝트별 대화/큐 상태 | 프로젝트별 알림 설정 |
| 데스크톱 상태 | online/offline, queued 안내 | 미전달 명령/TTL 표시 | 푸시 권한/승인 대기 요약 |

## 5. 화면 설계

### 5.1 공통 앱 셸

```
┌─────────────────────────────┐
│ Marblo                      │
│ [Project Alpha        v] ●  │
│ Desktop online              │
├─────────────────────────────┤
│                             │
│          tab content         │
│                             │
├─────────────────────────────┤
│  ▣ Board  ≡ Activity  ◇ Oke │
│  ● State                    │
└─────────────────────────────┘
```

상단:

- 프로젝트 이름은 1줄 ellipsis.
- 상태 배지는 `online`, `idle`, `offline`, `unknown` 네 가지.
- offline이면 상단에 얇은 경고 바를 노출한다.

```
Desktop offline. Read-only data is available; Oke commands will queue.
```

하단 탭:

- 아이콘 + 짧은 라벨.
- 최소 높이 56px, 각 탭 터치 영역 48px 이상.
- Phase 0의 Oke 탭은 열 수 있지만 입력창은 비활성화한다. 탭 자체를 숨기면 Phase 계획이 사용자에게 보이지 않는다.

### 5.2 칸반 모바일뷰

데이터 소스:

- `tasks` where `projectId == currentProject.id`
- 카드 상세의 진행 로그는 필요 시 `activities` where `taskId == selectedTask.id`

컬럼:

- 기본 컬럼: `TODO`, `CLAIMED`, `IN_PROGRESS`, `REVIEW`, `DONE`
- `BLOCKED`, `FAILED`는 데스크톱 보드처럼 `IN_PROGRESS` 맥락에 표시하되, 모바일에서는 별도 필터 칩도 제공한다.

와이어프레임:

```
┌─────────────────────────────┐
│ [Project Alpha v]  ● Online │
├─────────────────────────────┤
│ Roles: All Back Front Test  │
│        DevOps               │
│                             │
│ TODO                    12  │
│ ┌─────────────────────────┐ │
│ │ P3 frontend             │ │
│ │ Mobile board swipe UX   │ │
│ │ FB  PR  unassigned      │ │
│ │ updated 8m ago          │ │
│ └─────────────────────────┘ │
│ ┌─────────────────────────┐ │
│ │ P1 backend              │ │
│ │ Harden Firestore rules  │ │
│ │ claimed: agent-backend  │ │
│ └─────────────────────────┘ │
│                             │
│  TODO ●  CLAIMED  PROGRESS  │  ← 컬럼 페이지 인디케이터
├─────────────────────────────┤
│ Board Activity Oke State    │
└─────────────────────────────┘
```

상호작용:

- 가로 스와이프: 컬럼 단위 `scroll-snap` UX. 한 화면에 한 컬럼을 우선 보여주고, 큰 화면에서는 2컬럼까지 허용한다.
- 컬럼 헤더는 상단 sticky. 상태명, 개수, optional status filter를 포함한다.
- 카드 탭: 하단 시트로 상세 열기.
- 카드 long press: Phase 0에서는 아무 write도 하지 않는다. Phase 1 이후에도 상태 변경 용도로 쓰지 않는다. 모바일에서 실수로 상태 전이를 일으키면 위험하다.
- Pull-to-refresh: Firestore `onSnapshot`이 기본 실시간이므로 실제 fetch 의미보다는 "마지막 동기화/연결 상태 확인"으로 사용한다. offline cache 상태도 함께 보여준다.
- 역할 필터: `All`, `backend`, `frontend`, `test`, `devops` 칩. 칩 높이 36px 이상, 여백 포함 터치 영역 44px 이상.

카드 정보 우선순위:

1. 제목
2. 상태/우선순위/역할
3. `claimedBy`와 presence
4. `hasPmFeedback`, `prUrl`, `dependsOn`, `flowId`
5. 마지막 업데이트 시간

카드 상세 바텀시트:

```
┌─────────────────────────────┐
│ Task detail             [x] │
├─────────────────────────────┤
│ P3 frontend · IN_PROGRESS   │
│ Mobile board swipe UX       │
│                             │
│ Goal                        │
│ ...                         │
│                             │
│ Scope                       │
│ - docs only                 │
│                             │
│ Recent activity             │
│ 08:42 add_activity ...      │
│ 08:39 claim_task ...        │
│                             │
│ [Ask Oke about this task]   │  ← Phase 1
└─────────────────────────────┘
```

Phase 0에서 카드 상세는 읽기전용이다. `Ask Oke` 버튼은 disabled 또는 "Phase 1 준비중"으로 표시한다.

### 5.3 액티비티 스트림

데이터 소스:

- 전체 스트림: `audit_logs` where `projectId == currentProject.id`, `createdAt desc`, limit.
- 태스크 상세 스트림: `activities` where `taskId == selectedTask.id`.

와이어프레임:

```
┌─────────────────────────────┐
│ [Project Alpha v]  ● Online │
├─────────────────────────────┤
│ Activity                    │
│ [All] [Task] [Agent] [PM]   │
│                             │
│ Today                       │
│ ┌─────────────────────────┐ │
│ │ 09:14 submit_for_review │ │
│ │ frontend-agent          │ │
│ │ Task: Mobile design doc │ │
│ │ [Open task]             │ │
│ └─────────────────────────┘ │
│ ┌─────────────────────────┐ │
│ │ 09:02 add_activity      │ │
│ │ 구현 없이 설계 문서 작성 │ │
│ └─────────────────────────┘ │
└─────────────────────────────┘
```

상호작용:

- Pull-to-refresh는 연결 상태 확인과 최신 snapshot 재구독 트리거로만 사용한다.
- 이벤트 탭은 태스크 상세 바텀시트를 연다.
- `Open task`는 Board 탭으로 이동하면서 해당 카드 상세를 연다.
- 필터는 `All`, `Task`, `Agent`, `PM`, `Error`를 기본으로 한다.
- 실패 이벤트는 색상만 의존하지 않고 아이콘/라벨을 함께 표시한다.
- 긴 `params/result` 원문은 기본 접힘. Phase 0에서는 raw JSON 전체 노출보다 요약 우선.

### 5.4 오케 대화

데이터 소스:

- Phase 1 입력: `pendingInstructions`
- Phase 1 응답: 신규 응답 채널 필요. 후보는 `chatMessages` 재사용 또는 `companionMessages` 신규 컬렉션이다.
- 태스크 앵커: `taskId`, `taskTitle` 필드.

Phase 0 와이어프레임:

```
┌─────────────────────────────┐
│ [Project Alpha v]  ● Online │
├─────────────────────────────┤
│ Oke                         │
│                             │
│ In-app Oke replies are not  │
│ available yet.              │
│                             │
│ Phase 1 requires a secure   │
│ Oke -> mobile reply channel.│
│                             │
│ [View Telegram instructions]│
└─────────────────────────────┘
```

Phase 1 와이어프레임:

```
┌─────────────────────────────┐
│ [Project Alpha v]  ● Online │
├─────────────────────────────┤
│ Oke                    +Task│
│                             │
│ You                         │
│ ┌─────────────────────────┐ │
│ │ #394 화면 설계 기준으로  │ │
│ │ Phase0 범위를 요약해줘   │ │
│ │ Queued · delivered       │ │
│ └─────────────────────────┘ │
│                             │
│ Oke                         │
│ ┌─────────────────────────┐ │
│ │ Phase0는 보드/스트림...  │ │
│ └─────────────────────────┘ │
│                             │
│ [Task anchor: optional v]   │
│ ┌───────────────────────┐ ↑ │
│ │ Message Oke           │   │
│ └───────────────────────┘   │
└─────────────────────────────┘
```

대화 입력 규칙:

- 데스크톱 offline일 때도 전송은 가능하지만, 버튼 라벨을 `Queue for Oke`로 바꾼다.
- 전송 전 문구: "Desktop is offline. This will run when desktop returns."를 명확히 보여준다.
- 메시지 상태: `queued`, `delivered`, `reply pending`, `answered`, `expired`.
- TTL이 도입되면 만료 예정 시간을 표시한다.
- `targetAgentId`는 `orch-${projectId}`로 고정한다.
- `sourceType`은 `"mobile"`로 태깅한다.
- `fromUserId == auth.uid` 무결성 rule이 준비되기 전에는 입력을 열지 않는다.

태스크 앵커:

- Board 카드 상세 또는 Activity 이벤트에서 `Ask Oke`를 누르면 해당 `taskId/taskTitle`이 composer 위에 고정된다.
- 사용자는 전송 전 anchor를 제거할 수 있다.
- anchor가 있으면 오케에게 전달되는 메시지에 태스크 ID와 제목을 구조화해서 포함한다.

Phase 2 승인 버튼:

```
┌─────────────────────────────┐
│ Approval required           │
│ Merge PR for task #123?     │
│                             │
│ Scope                       │
│ docs/mobile-... only        │
│                             │
│ [Approve] [Reject] [Limit]  │
└─────────────────────────────┘
```

승인 UX 규칙:

- `Approve`, `Reject`, `Limit scope`는 최소 48px 높이.
- destructive/위험 작업은 2단계 확인을 둔다.
- 승인 카드는 평문 채팅 메시지가 아니라 구조화된 객체로 저장되어야 한다.
- 승인 결과는 `audit_logs`와 대화 스레드 양쪽에서 추적 가능해야 한다.

### 5.5 프로젝트 전환

데이터 소스:

- `projects` where `members array-contains auth.uid`

와이어프레임:

```
┌─────────────────────────────┐
│ Select project          [x] │
├─────────────────────────────┤
│ Search projects             │
│ ┌─────────────────────────┐ │
│ │ Project Alpha        ●  │ │
│ │ /Users/.../alpha        │ │
│ └─────────────────────────┘ │
│ ┌─────────────────────────┐ │
│ │ marblo-web           ○  │ │
│ │ github.com/...          │ │
│ └─────────────────────────┘ │
└─────────────────────────────┘
```

상호작용:

- 상단 프로젝트 칩 탭 -> 바텀시트.
- 프로젝트 선택 즉시 모든 탭의 구독을 새 projectId로 교체한다.
- 현재 프로젝트는 check 표시.
- offline/online 상태를 프로젝트별로 보여준다.
- 프로젝트가 없으면 데스크톱 앱에서 프로젝트를 추가하라는 안내만 표시한다. 모바일에서 새 프로젝트 생성은 Phase 0/1 범위가 아니다.

### 5.6 데스크톱 온/오프라인 상태

데이터 소스:

- 검토 문서에서 언급한 heartbeat 경로.
- 추가로 `agents`의 canonical orchestrator doc(`orchestrator-${projectId}`) 상태를 보조 신호로 사용할 수 있다.

와이어프레임:

```
┌─────────────────────────────┐
│ Desktop state               │
├─────────────────────────────┤
│ ● Online                    │
│ Last heartbeat: 22s ago     │
│ Oke: idle                   │
│                             │
│ Queue                       │
│ 0 pending mobile commands   │
│                             │
│ What this means             │
│ Commands can reach Oke now. │
└─────────────────────────────┘
```

offline 상태:

```
┌─────────────────────────────┐
│ Desktop state               │
├─────────────────────────────┤
│ ○ Offline                   │
│ Last heartbeat: 3h ago      │
│                             │
│ Queue                       │
│ 2 pending mobile commands   │
│                             │
│ Commands will run when the  │
│ desktop app reconnects.     │
│ [Expire queued commands]    │  ← Phase 1+ if TTL/cancel exists
└─────────────────────────────┘
```

상태 정의:

| 상태 | 기준 | UI |
| --- | --- | --- |
| online | 최근 heartbeat가 신선하고 오케 doc이 working/idle | 녹색 점 + "Commands can reach Oke now" |
| idle | heartbeat는 있으나 오케가 stopped/unknown | 노란 점 + "Desktop is open, Oke may need start" |
| offline | heartbeat가 오래됨 | 회색 점 + queue 안내 |
| unknown | heartbeat 데이터 없음 | 회색 점 + "No desktop heartbeat yet" |

## 6. 모바일 인터랙션 상세

### 6.1 칸반 스와이프

- 한 컬럼 단위 snap.
- 좌우 스와이프는 컬럼 이동에만 사용한다.
- 카드 내부 좌우 스와이프 액션은 도입하지 않는다. 컬럼 스와이프와 충돌한다.
- 상태 변경 drag-and-drop은 모바일 Phase 0/1 범위에서 제외한다.
- 컬럼 인디케이터는 상태명과 현재 위치를 보여준다.

### 6.2 터치 타겟

- 하단 탭: 높이 56px 이상.
- 주요 버튼: 높이 48px 이상.
- 보조 칩: 시각 높이 36px 이상, 실제 터치 영역 44px 이상.
- 카드: 전체 카드 탭 가능.
- 닫기/더보기 아이콘 버튼: 44x44px hit area.

### 6.3 Pull-to-refresh

- Firestore 실시간 구독이 주 경로이므로 pull-to-refresh는 "새로고침"보다 "연결 상태 재확인" UX다.
- 완료 시 `Synced just now`, offline이면 `Showing cached data`를 표시한다.
- 에러 시 retry 버튼과 Firestore permission 안내를 분리한다. permission 에러는 보안 하드닝/멤버십 문제일 수 있다.

### 6.4 오케 대화창

- composer는 safe-area를 고려해 하단 탭 위에 고정한다.
- 키보드가 올라오면 하단 탭보다 composer가 우선한다.
- 메시지 전송 버튼은 텍스트가 아니라 아이콘 중심으로 하되, 접근성 label을 둔다.
- task anchor는 composer 위에 한 줄로 표시하고, 긴 제목은 ellipsis.
- 데스크톱 offline 상태에서는 전송 전 확인 바를 보여준다.
- 승인 버튼은 Phase 2에서만 활성화한다.

## 7. 컴포넌트 재사용 원칙

### 7.1 marblo-web 디자인 토큰

사용할 토큰/패턴:

- 색상: `brand-*`, `accent`, `ring`
- radius: `rounded-button`, `rounded-card` 또는 기존 `rounded-lg/rounded-2xl` 패턴과 정합
- 폰트: `font-sans`, 필요 시 제목에만 `font-display`
- focus: 전역 `:focus-visible` ring 유지
- 아이콘: `lucide-react`

주의:

- 운영 화면은 마케팅 랜딩처럼 큰 hero/장식 요소를 쓰지 않는다.
- 카드 안에 카드를 과도하게 중첩하지 않는다. 반복 항목 카드와 바텀시트만 카드화한다.
- 색상만으로 상태를 구분하지 않는다. 라벨/아이콘을 함께 둔다.

### 7.2 i18n

- 신규 namespace 예: `companion.nav`, `companion.board`, `companion.activity`, `companion.oke`, `companion.state`.
- `ko/en/ja` 모두 키를 추가한다.
- 상태값(`TODO`, `IN_PROGRESS`)은 내부 값과 표시명을 분리한다.
- 시간 표시는 locale-aware formatter를 사용한다.

### 7.3 Firebase/Auth 재사용

- `marblo-web/src/lib/firebase.ts`의 `auth`, `db`를 재사용한다.
- 비로그인 사용자는 `/${locale}/auth/login?redirect=/${locale}/companion`로 보낸다.
- 프로젝트 멤버십 확인 전 화면 데이터를 구독하지 않는다.
- API key/secret은 하드코딩하지 않는다. 기존 env 패턴을 따른다.

## 8. PWA 요소

### 8.1 Manifest

필요 항목:

- app name: `Marblo Companion`
- short name: `Marblo`
- display: `standalone`
- start_url: `/{locale}/companion`
- theme/background color: 기존 다크 톤과 정합
- icons: maskable 포함

### 8.2 홈 화면 추가

- Android/Chrome: install prompt를 감지해 State 또는 계정 메뉴에서 노출.
- iOS/Safari: 설치 이벤트 API가 제한적이므로 수동 안내가 필요하다.
- 안내는 Phase 0에서 보조 UI로만 둔다. 첫 사용 흐름을 막는 modal은 금지.

### 8.3 Service Worker

- Phase 0: shell asset cache와 offline fallback 정도로 제한.
- Firestore 데이터는 SDK의 offline cache/재연결 특성을 우선 활용한다.
- stale한 보드 데이터를 최신으로 오해하지 않도록 `last synced`와 연결 상태를 반드시 노출한다.

### 8.4 Push 제약

- Phase 2 전까지 푸시는 설계만 둔다.
- iOS PWA 푸시는 iOS 16.4+ 및 홈 화면 추가가 필요하다는 제약을 명시한다.
- 알림 권한 요청은 앱 진입 직후가 아니라 사용자가 푸시 가치를 본 뒤 요청한다.
- 푸시 이벤트 후보: `REVIEW` 진입, `BLOCKED/FAILED`, PM feedback, approval request.

## 9. Phase별 상세 범위

### Phase 0: 읽기전용 MVP

목표:

- 보드와 스트림만으로 이동 중 상태 확인 가치를 제공한다.

포함:

- 로그인/프로젝트 선택
- 칸반 모바일뷰
- 카드 상세 읽기
- 액티비티 스트림
- 데스크톱 online/offline 상태
- PWA manifest/home-screen 안내

제외:

- 태스크 생성/수정/상태 변경
- 오케 대화 입력
- 승인 버튼
- 푸시

필수 선행:

- Firestore rule 하드닝. 없으면 출시 불가.

### Phase 1: 대화

목표:

- 모바일에서 오케에게 짧은 지시/질문을 보내고, 앱 안에서 응답을 받는다.

포함:

- 모바일 -> 오케 `pendingInstructions` write
- 오케 -> 모바일 응답 채널
- task anchor
- 메시지 상태 표시
- offline queue 안내
- TTL/만료 정책 표시

필수 선행:

- 오케 응답 채널
- `sourceType="mobile"` 태깅
- 작성자 무결성 rule
- 모바일발 명령 감사 로그
- rate limit

### Phase 2: 푸시/승인

목표:

- 사용자가 앱을 열지 않아도 중요한 상태를 받고, 구조화된 승인 결정을 내린다.

포함:

- FCM Web Push
- iOS 제약 안내
- approval request 카드
- approve/reject/limit scope
- 승인 이력 audit
- 프로젝트별 알림 설정

검토:

- iOS PWA 푸시 신뢰성이 부족하다고 실측되면 이 단계에서 네이티브 앱을 재검토한다.

## 10. 미해결 공백

| 공백 | 영향 | 설계상 처리 |
| --- | --- | --- |
| 오케 -> 모바일 응답 채널 없음 | Phase 1 대화 불가 | Phase 0에서는 Oke 탭을 안내 화면으로만 둔다. |
| 보안 rule 하드닝 전 크로스테넌트 위험 | Phase 0도 출시 불가 | 모든 화면 설계에 "보안 선행"을 출시 게이트로 둔다. |
| 데스크톱이 꺼진 뒤 큐 일괄 실행 | 뒤늦은 위험 명령 실행 | offline queue 안내, TTL/만료 UX, Phase 2 승인 게이트 필요. |
| 다중 데스크톱 실행 주체 비결정성 | 어느 머신에서 오케가 실행될지 불명확 | State 화면에서 active desktop identity를 표시할 수 있어야 한다. |
| PWA manifest/SW 없음 | 홈화면 설치/푸시 불가 | PWA 셸은 별도 구현 티켓 필요. |

## 11. 설계 결론

모바일 컴패니언의 첫 릴리스는 `Board + Activity + Desktop State` 읽기전용 PWA가 맞다. 이 조합은 이미 Firestore에 있는 `tasks`, `activities`, `audit_logs`, heartbeat 계열 데이터를 사용하므로 구현 위험은 낮지만, 보안 하드닝 전에는 노출하면 안 된다.

오케 대화는 모바일 입력 경로만으로는 부족하다. 앱 안에서 응답을 받는 채널이 없으므로 Phase 1에서 별도 응답 채널을 만든 뒤 열어야 한다. 승인/푸시는 Phase 2로 미루고, 원격 오케 제어가 RCE에 준하는 민감 작업이라는 전제를 UI에 계속 반영한다.
