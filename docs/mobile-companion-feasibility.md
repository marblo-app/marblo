# 마블로 모바일 컴패니언 — 타당성·아키텍처 검토

> **범위**: 검토/설계 문서. 구현 코드 없음. 승인 후 별도 티켓으로 분해.
> **렌즈**: plan-eng-review (아키텍처·데이터플로우·엣지케이스·보안).
> **작성 근거**: 전 항목 실제 코드 `파일:라인` 실측. 공백은 "없음"으로 명시.
> **핵심 검증 결과**: 가설("board/activity는 이미 Firestore에 있고, 오케 대화는 기존 릴레이 재사용 → 저비용 PWA MVP 가능")은 **대부분 참**. 단, ① 오케 응답을 모바일로 되돌리는 채널이 없음(순수 갭), ② 원격 오케 제어 write 경로(`pendingInstructions`)의 Firestore 룰이 크로스테넌트로 열려 있어 **하드닝 전에는 GA 금지**.

---

## TL;DR / 권고

| 축                         | 실측 결론                                                                                                                                                                                                            |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Board/Activity 읽기**    | ✅ 이미 클라우드 Firestore(`tasks`/`activities`/`audit_logs`, 공유 프로젝트 `marblo-2253d`)에 실시간(`onSnapshot`) 동기화됨. 모바일이 Firebase client SDK로 **직접 읽으면 됨. 백엔드 API 불필요.**                   |
| **오케 대화(모바일→오케)** | ⚠️ 재사용 배관 존재 = Firestore `pendingInstructions` 큐(+데스크톱 `onSnapshot` 리스너 → PTY 주입). `targetAgentId="orch-${projectId}"`로 오케 타겟팅까지 이미 배선됨. **데스크톱 오프라인에도 내구성 있게 큐잉**됨. |
| **오케 응답(오케→모바일)** | ❌ **갭**. 오케는 현재 `send_telegram_message`로만 응답. 인앱 채팅으로 되돌릴 채널 없음 → **유일한 순수 신규 구현물**.                                                                                               |
| **인증**                   | ✅ 동일 Firebase 프로젝트(Google/GitHub/Email) 그대로 재사용 가능.                                                                                                                                                   |
| **보안**                   | 🔴 `tasks`/`activities`/`pendingInstructions` 룰이 `isAuthenticated()`만 검사(크로스테넌트 열람+**임의 오케 명령 주입** 가능). 오케는 YOLO 실행. **모바일 노출 전 룰 하드닝 필수(티켓 a7iz1slr).**                   |
| **아키텍처 권고**          | **marblo-web(Next16) 위 PWA**. RN/Flutter 대비 재사용 극대화·저비용.                                                                                                                                                 |
| **MVP**                    | Phase 0 = 읽기전용 뷰(룰 하드닝 선행). Phase 1 = 대화(pendingInstructions write + 응답 채널 신규). Phase 2 = 푸시/승인 UX.                                                                                           |

---

## (a) 현황 실측 맵 — 있는 것 / 없는 것

### 있는 것 ✅

**1. Board(tasks)·Activity가 이미 클라우드 Firestore에 있음 (로컬 SQLite 아님)**

- `tasks` 컬렉션(top-level). 쓰기 경로 2개, 둘 다 **client SDK**(firebase-admin 아님):
  - 에이전트/MCP 경로: `v3/electron/mcp-server/tools.ts:1202` `doc(collection(db,"tasks"))`, 스키마 `:1203-1222`(`title/role/priority/status/dependsOn/claimedBy/scope/projectId/contextId/projection/...`), `setDoc` `:1226`.
  - 렌더러 경로: `v3/src/services/taskService.ts:30` `COLLECTION="tasks"`, `createTask` `:54-73`.
  - 상태전이는 트랜잭션: `v3/electron/mcp-server/projection.ts:252-258`.
- `activities` 컬렉션(per-task `add_activity` 로그): 트랜잭션 쓰기 `v3/electron/mcp-server/projection.ts:189, 260-267` (`{taskId, agentId, message, createdAt}`), 렌더러 미러 `v3/src/services/activityService.ts:26-37`.
- `audit_logs` 컬렉션(우측 "Activity Stream" 패널 소스, 모든 MCP 툴콜 미러): `v3/electron/mcp-server/tools.ts:646-661` `addDoc(collection(db,"audit_logs"), {projectId, agentId, toolName, params, result, duration, success, createdAt})`.

**2. 실시간 리스너(`onSnapshot`) 이미 존재** — 모바일이 그대로 구독하면 라이브 뷰가 공짜:

- 제네릭: `v3/src/services/firestore.ts:117-148`.
- Tasks 라이브: `v3/src/services/taskService.ts:93-105` (`where("projectId","==",projectId)`).
- Activities 라이브: `v3/src/services/activityService.ts:39-48`.
- Activity Stream 라이브: `v3/src/services/activityStreamService.ts:178-205` (`audit_logs`, `orderBy createdAt desc`, `limit`).

**3. 오케 대화용 크로스머신 배관(`pendingInstructions`) 이미 오케까지 배선됨**

- Producer: `add_pending_instruction` MCP 툴 → `addDoc(collection(db,"pendingInstructions"), {projectId, taskId, targetAgentId, message, fromUserId, fromUserName, sourceType, isDelivered:false, createdAt, deliveredAt:null})` `v3/electron/mcp-server/tools.ts:3446-3457`. 오케 대상은 `targetAgentId="orch-${projectId}"`, `task_id` 생략 가능(오케 레벨 명령) `tools.ts:3392-3394`.
- Consumer: 데스크톱 main이 오케 PTY 준비되면 `pendingListener.attach("orch-${projectId}", sid)` `v3/electron/main.ts:4230`. 리스너는 Firestore `onSnapshot(where targetAgentId==agentId AND isDelivered==false)` `v3/electron/pending-instruction-listener.ts:112-155`, 트랜잭션으로 `isDelivered:true` 플립 후 승자만 `ptyManager.writeAndSubmit(ptySessionId, message)` 주입 `:189-224`.
- ⇒ **모바일 → `add_pending_instruction`(Firestore write) → 데스크톱 onSnapshot → 오케 PTY stdin 주입**. 전 구간 이미 존재.

**4. Firebase Auth(멀티 프로바이더) — 모바일 재사용 100% 가능**

- 프로젝트 `marblo-2253d`(v3와 marblo-web 동일: `v3/.firebaserc`, `marblo-web/src/lib/firebase.ts` 둘 다 `marblo-2253d`).
- 사용자 프로바이더: Google/GitHub/Email `v3/src/auth/AuthProvider.tsx:5-36`.
- 서비스 프로세스는 익명 인증: `v3/electron/mcp-server/firebase.ts:87,120` `signInAnonymously`.

**5. marblo-web = 이미 Firebase 로그인·i18n·Next16 완비된 웹앱** (PWA 확장 토대)

- `marblo-web/src/lib/firebase.ts`: `getAuth`/`getFirestore` + 동일 config.
- `signInWithEmailAndPassword`/`GoogleAuthProvider`/`signInWithPopup` 이미 사용 중.
- i18n 라우팅(`src/app/[locale]/...`), 로그인/회원가입/강의/체크아웃/어드민 페이지 존재.
- ⇒ 새 `[locale]/companion` 경로만 추가하면 인증·firebase 배선 재사용.

### 없는 것 ❌ (공백 명시)

- **오케 → 모바일 응답 채널 없음.** 오케 응답은 `send_telegram_message` MCP 툴 → 브릿지 → 텔레그램 `sendMessage`가 유일(`v3/electron/mcp-server/tools.ts:3766-3837`, `telegram-poller.ts:531-607`). 인앱 채팅으로 되돌리는 Firestore 쓰기 경로는 **없음**. → Phase 1의 핵심 신규 구현물.
- **클라우드 오케/PTY 없음.** 오케는 데스크톱 Electron main 안 로컬 `node-pty` 프로세스: `pty.spawn(...)` `v3/electron/pty-manager.ts:190-196`, 런치 `orchestrator-manager.ts:519-526`, per-project 인메모리 Map `main.ts:1335`. YOLO(`--dangerously-skip-permissions`) `orchestrator-manager.ts:378-390`.
- **오케를 원격에서 forward/relay 하는 Cloud Function/서버 없음.** `v3/functions/`는 결제(Paddle/Toss)·쿠폰·강의·파운더베타·텔레메트리 전용. `grep pendingInstruction|orchestrator|pty|node-pty` → 0건. 데스크톱 꺼지면 오케에 닿는 클라우드 컴포넌트 없음.
- **원격 접근 가능한 오케 네트워크 엔드포인트 없음.** 로컬 `bridge-server.ts`는 `127.0.0.1` 바인딩 + 비-loopback Host 헤더 거부 + per-boot 베어러 토큰(`bridge-server.ts:702-711, 823`), 즉 **동일 호스트 전용**. 모바일이 직접 호출 불가.
- **PWA 매니페스트/서비스워커 없음.** `find -name manifest.*` → marblo-web에 없음. PWA화 시 신규 추가 필요.

---

## (b) 텔레그램이 이미 주는 것 vs 전용 모바일의 추가가치

**텔레그램이 이미 주는 것** (재확인): 모바일에서 오케와 텍스트 대화. 인바운드 = `getUpdates` long-poll(25s) → allowlist 게이트 → `resolveOrchestrator` → `orch.injectMessage` → PTY(`telegram-poller.ts:303-400`, `orchestrator-manager.ts:287-299`). 아웃바운드 = `send_telegram_message`. 즉 **"대화"는 이미 모바일에서 됨.**

**그럼에도 전용 모바일 컴패니언의 추가가치**:

| 가치                     | 텔레그램으로 불가/빈약            | 전용 앱이 주는 것                                                 |
| ------------------------ | --------------------------------- | ----------------------------------------------------------------- |
| **시각적 칸반**          | 텍스트만. 보드 상태 열람 불가     | `tasks` onSnapshot 라이브 칸반(컬럼/카드/상태)                    |
| **액티비티 스트림**      | 봇이 push한 요약만                | `audit_logs`/`activities` 실시간 타임라인, 필터·태스크별 드릴다운 |
| **리치 대화 UX**         | 평문. 스레드·태스크 컨텍스트 없음 | 태스크에 앵커된 대화, 마크다운/코드블록, 첨부                     |
| **승인 UX**              | 인라인 버튼 커스텀 한계           | Approve/Reject/Scope 제한 등 구조화된 결재 카드                   |
| **푸시/뱃지**            | 봇 알림(범용)                     | 태스크 완료/리뷰대기/차단 등 이벤트별 세분화 푸시                 |
| **데스크톱 상태 가시성** | 없음(오케 죽어도 사용자 모름)     | heartbeat 기반 "데스크톱 오프라인/온라인" 표시                    |

⇒ **결론**: 텔레그램은 "대화"만 커버. 컴패니언의 킬러 가치는 **읽기(시각적 보드+스트림)와 구조화된 승인/푸시**. 읽기는 거의 공짜(§a-1,2). 대화는 재사용(§a-3)이라 저비용. **읽기전용 뷰만으로도 즉시 가치**가 있음 → MVP 근거.

---

## (c) 아키텍처 옵션 비교: PWA vs 네이티브

### 옵션 1 — marblo-web 확장 PWA ★권고

- **읽기**: 모바일 브라우저에서 Firebase client SDK로 `tasks`/`activities`/`audit_logs` 직접 `onSnapshot`. 서버 왕복 0.
- **대화**: `add_pending_instruction`(오케용 `targetAgentId="orch-${projectId}"`) 쓰기. 응답 채널만 신규.
- **인증**: marblo-web의 기존 Firebase Auth 그대로.

| 장점                                                            | 단점                                                            |
| --------------------------------------------------------------- | --------------------------------------------------------------- |
| 재사용 극대화(인증·firebase·i18n·서비스 레이어). 신규 코드 최소 | iOS PWA 푸시는 iOS16.4+(홈화면 추가 필요), 안드로이드 대비 제약 |
| 단일 코드베이스·단일 배포(웹과 공유). 심사·스토어 없음          | 네이티브 제스처/성능/백그라운드 처리 한계                       |
| Firestore SDK가 오프라인 캐시·재연결 내장                       | 홈화면 설치 유도 UX 필요                                        |
| TS/React 팀 역량 그대로                                         |                                                                 |

**비용/유지보수**: 최저. `marblo-web`에 `[locale]/companion` 경로 + manifest/service worker + 반응형 칸반/스트림 컴포넌트. 백엔드 신규 = 응답 채널 1개 + 룰 하드닝.

### 옵션 2 — 네이티브(React Native / Flutter)

| 장점                                                | 단점                                                           |
| --------------------------------------------------- | -------------------------------------------------------------- |
| 최상의 푸시/백그라운드/제스처, iOS 포함 안정적 알림 | 별도 코드베이스·스토어 심사·서명·배포 파이프라인 신설          |
| 앱스토어 존재감                                     | Firebase SDK 재배선(RN Firebase/FlutterFire), 인증 흐름 재구현 |
|                                                     | 유지보수 2배(웹+앱), 릴리스 주기 분리                          |

**비용/유지보수**: 높음. MVP엔 과투자. 컴패니언 핵심(읽기+가끔 대화)은 네이티브 성능이 병목이 아님.

**판정**: **PWA 권고.** 네이티브는 푸시 신뢰성이 제품 차별화의 핵심이 되는 시점(Phase 2 이후, iOS 푸시가 PWA로 부족하다고 실측될 때)에 재검토. RN이면 웹 컴포넌트 일부 공유 가능하나 그때도 별도 트랙.

---

## (d) 데스크톱 연동 / 오프라인 경로

오케는 **로컬 데스크톱 전용**(§a-없는것). 모바일은 오케에 직접 못 닿음. 전 경로는 Firestore 경유:

```
[모바일 PWA]
   │ 읽기: onSnapshot(tasks/activities/audit_logs)   ← 데스크톱 온라인 무관, 항상 최신 스냅샷
   │ 쓰기: add_pending_instruction(targetAgentId=orch-${projectId})
   ▼
[Firestore  marblo-2253d]  ← 내구성 큐(desktop off 여도 보존)
   ▲ onSnapshot(where targetAgentId==orch-${pid} AND isDelivered==false)
   │
[데스크톱 Electron main]  pending-instruction-listener → ptyManager.writeAndSubmit → [오케 PTY(claude, YOLO)]
   │ 응답: (현재) send_telegram_message → 텔레그램
   │       (Phase1 신규) Firestore 응답 컬렉션 write → 모바일 onSnapshot
```

**오프라인 처리(실측)**:

- **데스크톱 OFF**: `pendingInstructions` 문서는 `isDelivered:false`로 Firestore에 **내구성 보존**. 데스크톱 재기동 → 오케 PTY ready → `attach` 시 `onSnapshot` 초기 스냅샷이 미배달 문서를 `type:"added"`로 재방출하여 전량 배달(`pending-instruction-listener.ts:22-34, 129-141`). **유실 없음.** 추가로 워치독이 미배달분 직접 배달(`main.ts:1275-1327`) — 단, 이 역시 앱 실행 중에만.
- **읽기**는 데스크톱 on/off와 무관(Firestore가 소스). 데스크톱 꺼져 있어도 모바일은 마지막 보드/스트림을 봄.
- **데스크톱 liveness 표시**: `logHeartbeat` Cloud Function(`v3/functions/src/index.ts`) 존재 → heartbeat 문서로 "데스크톱 온라인/오프라인" 배지 + "명령은 큐잉되어 복귀 시 실행됨" 안내를 모바일 UI에 노출 권장.
- **응답 지연**: 데스크톱 온라인이면 onSnapshot push라 초 단위. 오프라인이면 복귀까지 무한 지연 → UI에서 pending 상태와 예상 불가 지연을 명시해야 함(오케가 YOLO로 실제 파일 변경을 하므로, 지연된 명령이 뒤늦게 실행되는 리스크를 사용자가 인지해야 함).

**엣지케이스(plan-eng-review)**:

- 큐 적체 후 일괄 실행: 데스크톱이 오래 꺼졌다 켜지면 밀린 명령이 한꺼번에 오케에 주입됨 → **TTL/만료** 또는 배달 전 사용자 확인 옵션 필요.
- 다중 데스크톱: 같은 projectId를 두 머신이 호스팅하면 `onSnapshot`+트랜잭션 승자만 배달하므로 중복은 막히나(`:189-200`), 어느 머신이 실행할지 비결정적 → 단일 호스트 가정 문서화.
- 순서 보장: 리스너가 oldest-first 정렬(`:130-138`)하나 오프라인 누적분의 인과 순서는 사용자 의도와 다를 수 있음.

---

## (e) 보안 — 원격 오케 제어는 최고 민감도

원격에서 로컬 오케(YOLO, `--dangerously-skip-permissions`)에 명령을 주입한다는 것은 **원격 임의 코드 실행(RCE)에 준함**. 현재 룰 상태를 실측한 결과 **모바일 노출 전 반드시 막아야 할 구멍**이 있다.

### 🔴 실측된 핵심 취약: `pendingInstructions` / `tasks` / `activities` 룰이 크로스테넌트로 열림

```
// v3/firestore.rules
match /tasks/{taskId}            { allow read,create,update,delete: if isAuthenticated(); }   // :89-94
match /activities/{activityId}   { allow read,create: if isAuthenticated(); }                 // :105-108
match /pendingInstructions/{id}  { allow read: if isAuthenticated();                           // :118-120
                                   allow create: if isAuthenticated(); ... }
```

- `isAuthenticated()` = `request.auth != null`(`:7-9`)뿐. **projectId만 알면 로그인한 임의 사용자가**:
  - 타 팀의 모든 `tasks`/`activities`/`audit_logs`를 **열람**(크로스테넌트 유출), 그리고
  - `pendingInstructions`에 `targetAgentId="orch-${projectId}"` 문서를 **생성 → 타 팀 오케 PTY에 임의 명령 주입**.
- 즉 **모바일 컴패니언의 대화 기능이 의존하는 바로 그 write 경로가 현재 무권한 크로스테넌트 RCE 표면**이다. (update는 배달 플립만 허용하도록 이미 필드 불변 검사됨 `:124-131` — 그러나 create가 열려 있어 무의미.)
- 의도적 임시 상태임이 룰 주석에 명시(`:79-88`): MCP/오케가 **익명 인증** client SDK로 쓰기 때문에 `isProjectMember`로 좁히면 에이전트 파이프라인이 PERMISSION_DENIED. custom-token 마이그레이션(렌더러 id token → main/MCP `signInWithCustomToken`) 후 `chatMessages`처럼 일괄 하드닝 예정, **보안 티켓 a7iz1slr**.

### 이미 올바른 패턴이 존재 (따라야 할 모범)

`chatMessages`(`:143-152`)는 이미 하드닝됨: `read/create: isAuthenticated() && isProjectMember(projectId)` + 작성자 무결성(`type=='user' → senderId==auth.uid`). `taskComments`(`:158-166`), `memberRoles`(`:264-279`)도 동일. **동일 패턴을 tasks/activities/pendingInstructions에 적용**하는 것이 하드닝의 정답.

### 모바일 GA 전 보안 필수조건 (게이트)

1. **[블로커]** a7iz1slr 하드닝: custom-token 마이그레이션 완료 후 `tasks`/`activities`/`audit_logs`/`pendingInstructions` 룰을 `isProjectMember` 기반으로 좁힘. **이것 없이는 읽기전용 MVP조차 크로스테넌트 유출.**
2. **명령 범위 제한(command scoping)**: 모바일발 `pendingInstructions.sourceType`을 별도 값(예: `"mobile"`)으로 태깅하고, 데스크톱 리스너/오케 프롬프트에서 모바일 발 명령의 권한을 제한(읽기 질의·상태 코멘트 위주, 위험 명령은 승인 요구). YOLO 오케에 무제한 원격 주입은 금물.
3. **작성자 무결성**: `fromUserId == request.auth.uid` 룰 강제(현재 producer가 채워 넣지만 룰 미검증).
4. **감사**: 모바일발 주입은 `audit_logs`에 출처 태깅하여 추적.
5. **레이트리밋/승인 게이트**: 원격 명령에 rate limit + 위험도 높은 명령은 데스크톱/텔레그램 2차 승인(파운더베타의 텔레그램 인라인 승인 패턴 재사용 가능).

---

## (f) MVP 범위 + 단계별 계획 + 후속 티켓 분해

### 설계 원칙

- 읽기(저비용·즉가치)를 먼저, 쓰기(고위험)는 하드닝 뒤에.
- 순수 신규 구현은 **응답 채널 1개**뿐 — 나머지는 재사용.

### Phase 0 — 읽기전용 컴패니언 (MVP) 🟢

- **선행 필수**: 보안 게이트 #1(a7iz1slr 하드닝) — 크로스테넌트 유출 차단. **이게 안 되면 Phase 0도 출시 불가.**
- marblo-web에 `[locale]/companion` 경로 + PWA(manifest/service worker).
- Firebase Auth 로그인(기존) → 내 멤버 프로젝트 선택 → `tasks` onSnapshot 칸반 + `audit_logs`/`activities` onSnapshot 스트림.
- 데스크톱 online/offline 배지(heartbeat).
- **신규 백엔드 = 0**(룰 하드닝 제외). 위험 = 낮음.

### Phase 1 — 대화 (읽기 + 쓰기) 🟡

- 모바일 → `add_pending_instruction(targetAgentId="orch-${projectId}", sourceType="mobile")` 쓰기(재사용).
- **[신규 핵심]** 오케 → 모바일 **응답 채널**: 오케가 응답을 Firestore에 쓰도록 신규 MCP 툴(예: `send_companion_reply`) 또는 `chatMessages` 재사용, 모바일이 onSnapshot 구독. (텔레그램 아웃바운드와 병행 or 대체.)
- 보안 게이트 #2~#5(명령 스코프·작성자 무결성·감사·레이트리밋·승인) 적용.
- 오프라인 UX: pending/큐잉/지연 명시 + TTL.

### Phase 2 — 푸시 / 승인 UX 🟠

- 이벤트별 푸시(태스크 완료/리뷰대기/차단): FCM Web Push(iOS16.4+ 홈화면). 데스크톱측 이벤트 → FCM.
- 구조화된 승인 카드(Approve/Reject/Scope).
- iOS 푸시가 PWA로 부족하다고 실측되면 **여기서 네이티브(RN) 재검토**.

### 후속 티켓 분해(제안)

| #   | 티켓                                                                                                                         | Phase   | 의존   |
| --- | ---------------------------------------------------------------------------------------------------------------------------- | ------- | ------ |
| T1  | **[보안]** a7iz1slr: custom-token 마이그레이션 + tasks/activities/audit_logs/pendingInstructions 룰 `isProjectMember` 하드닝 | 0(선행) | —      |
| T2  | marblo-web PWA 셸(manifest/SW/`[locale]/companion` 라우트/설치 유도)                                                         | 0       | —      |
| T3  | 반응형 칸반 뷰(`tasks` onSnapshot, 컬럼/카드/상태)                                                                           | 0       | T1,T2  |
| T4  | 액티비티 스트림 뷰(`audit_logs`/`activities` onSnapshot, 필터·드릴다운)                                                      | 0       | T1,T2  |
| T5  | 데스크톱 online/offline 배지(heartbeat 소스)                                                                                 | 0       | T2     |
| T6  | **[신규]** 오케→모바일 응답 채널(MCP 툴 + Firestore 컬렉션 + 모바일 구독)                                                    | 1       | T1     |
| T7  | 모바일→오케 대화 입력(`add_pending_instruction` write + `sourceType="mobile"`)                                               | 1       | T1,T6  |
| T8  | **[보안]** 모바일 명령 스코프·작성자 무결성·레이트리밋·감사·(옵션)2차 승인                                                   | 1       | T7     |
| T9  | 오프라인 큐 UX(pending 표시·TTL/만료·일괄실행 경고)                                                                          | 1       | T7     |
| T10 | FCM Web Push + 이벤트 트리거                                                                                                 | 2       | T3,T4  |
| T11 | 구조화 승인 카드 UX                                                                                                          | 2       | T7,T10 |

---

## 부록 — 핵심 파일:라인 인덱스

- **Tasks write**: `v3/electron/mcp-server/tools.ts:1202,1203-1222,1226`; `v3/src/services/taskService.ts:30,54-73`; 트랜잭션 `v3/electron/mcp-server/projection.ts:252-258`
- **Activities write**: `v3/electron/mcp-server/projection.ts:189,260-267`; `v3/src/services/activityService.ts:26-37`
- **Audit-log/stream**: `v3/electron/mcp-server/tools.ts:646-661`; `v3/src/services/activityStreamService.ts:178-205`
- **Live listeners**: `v3/src/services/firestore.ts:117-148`; `taskService.ts:93-105`; `activityService.ts:39-48`; `activityStreamService.ts:178-205`
- **pendingInstructions**: producer `v3/electron/mcp-server/tools.ts:3385-3460`; consumer `v3/electron/pending-instruction-listener.ts:112-224`; 오케 attach `v3/electron/main.ts:4230`; 워치독 `main.ts:1275-1327`
- **Telegram relay**: 인바운드 `v3/electron/telegram-poller.ts:303-400`; `injectMessage` `orchestrator-manager.ts:287-299`; 아웃바운드 `tools.ts:3766-3837`, `telegram-poller.ts:531-607`
- **Orchestrator 로컬 spawn**: `v3/electron/pty-manager.ts:190-196`; `orchestrator-manager.ts:519-526`; per-project map `main.ts:1335`
- **Bridge(로컬 전용)**: `v3/electron/bridge-server.ts:702-711,823`
- **Rules**: tasks `v3/firestore.rules:89-94`; activities `:105-108`; pendingInstructions `:118-132`; chatMessages(모범) `:143-152`; 하드닝 주석/티켓 `:79-88`(a7iz1slr)
- **Auth**: `v3/src/auth/AuthProvider.tsx:5-36`; `v3/src/lib/firebase.ts:141-154`; 익명 `v3/electron/mcp-server/firebase.ts:87,120`
- **Cloud Functions(오케 무관)**: `v3/functions/src/index.ts`(결제/쿠폰/파운더/텔레메트리·`logHeartbeat`); grep pendingInstruction/orchestrator/pty → 0건
- **marblo-web(PWA 토대)**: `marblo-web/src/lib/firebase.ts`(동일 `marblo-2253d`); `src/app/[locale]/...`; PWA manifest → **없음**
