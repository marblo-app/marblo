# Marblo v3 데스크톱 앱 — 엔지니어링/아키텍처 리뷰

- 일자: 2026-07-12
- 대상: `v3/electron/` (main·PTY·bridge·매니저·워치독·MCP 서버), `v3/src/stores/` (zustand), `v3/src/lib/firebase.ts`
- 방식: **읽기 전용** 코드 정독 + 병렬 심층 리더 4개(IPC/매니저, stores, mcp-server, main 생명주기). 모든 상위 findings 는 리뷰어가 파일:라인 직접 재확인.
- HEAD: `2cad43e` (#374 공유 static server·#369 워치독 W1~W7·#372 구독 게이팅 반영 — 이미 방어된 것은 재지적 안 함)

> ⚠️ electron main 은 HMR 불가 — 아래 수정 검증은 재빌드(`npm run dev`) 필요. `v3/dist-mcp` 번들은 커밋 금지.

---

## 총평

전반적으로 **매우 잘 방어된 코드베이스**다. RCE 노출면(브리지 서버), PTY fd 누수, 재시작/stale-PTY 레이스, Firestore claim 동시성 등 "가장 터지기 쉬운" 경로들은 이미 명시적·주석화된 방어가 들어가 있다. 아래 findings 는 **열린 구멍**이라기보다 **컨테인먼트 비대칭 / 잔여 리스크 / 스케일링 부채**가 대부분이다. **P0/P1 없음.**

즉시 값어치 높은 fix 3개: `fs:writeFile` 컨테인먼트 가드(P2), MCP `update_task_status(force=true)` 상태값 검증(P2, 1줄), static server 경로검증+스트림 에러핸들러(P2).

---

## P2 — 확정 (파일:라인 재확인 완료)

### P2-1. `fs:writeFile` / `fs:readFile` / `fs:readFileBase64` 컨테인먼트 가드 부재 (형제 핸들러 비대칭)

`main.ts:2701` `fs:readFile`, `main.ts:2705` `fs:writeFile`, `main.ts:2820` `fs:readFileBase64`

```ts
ipcMain.handle("fs:writeFile", (_event, { filePath, content }) => {
  fsManager.writeFile(filePath, content); // rootPath 없음, fsGuard 없음
});
```

- **비대칭**: `fs:createFile`(2759)·`rename`(2784)·`remove`(2796)·`copy`(2812)·`importPaths`(2839) 는 전부 `fsGuard(rootPath, ...)` → `isInsideRoot` 로 `..`/절대경로 이탈을 막는다(`fs-manager.ts:324` 프리미티브는 올바름). `writeFile`/`readFile`/`readFileBase64` 만 이 가드를 호출하지 않아 **임의 절대경로 읽기/쓰기**가 가능.
- **시나리오**: 렌더러는 신뢰불가 콘텐츠(에이전트 stdout, repo 파일, git diff, 텔레그램 텍스트)를 대량 표시한다. 그 표면 어디든 DOM 인젝션/XSS 1건이면 이 IPC 로 `~/.zshrc`·`~/.ssh/config` 덮어쓰기 → 로컬 코드실행. `contextIsolation:true`·`nodeIntegration:false`(2272-2273)가 "XSS 선행"을 요구하게 만들어 P1 이 아닌 P2.
- **권고(소규모)**: 세 핸들러에 형제와 동일하게 `rootPath` 인자 + `fsGuard`/`isInsideRoot` 적용. 프리미티브가 이미 있으므로 호출만 추가.

### P2-2. MCP `update_task_status(force=true)` 가 미검증 상태 문자열을 SoT 에 기록 → 보드·projection·미션 롤업 오염

`tools.ts:1321` (`status: z.string()`), `1333` (`as TaskStatus` 캐스팅), `1360` (`validateFrom: force ? undefined : ...`)

- `status` 가 enum 이 아니라 `z.string()`. `force=true` 면 외부 `canTransition` 게이트와 in-txn `validateFrom` 재검사가 **둘 다** 꺼져 `applyProjection` 이 `status:"banana"`(오타/대소문자) 를 `tasks/{id}` + `projection.currentStatus` + 미션 `statusCounts` 에 그대로 쓴다(`projection.ts:257,275`).
- **시나리오**: 에이전트는 완료규약상 `force=true` 를 일상적으로 쓴다. `"Done"`·`"in_progress"` 오타 1건이면 카드·projection·미션 카운트가 조용히 오염되고, `get_available_tasks`/워치독 스캔이 정확 문자열 매칭이라 그 태스크가 모든 피드에서 사라진다.
- **권고(1줄급)**: 핸들러 진입부에서 `status` 를 7-멤버 `TaskStatus` 집합으로 검증(`z.enum` 또는 멤버십 체크) **후** force 분기. force 는 *전이규칙*만 우회해야지 *값 도메인*까지 우회하면 안 됨.

### P2-3. 공유 static server — `req.url` → `path.join` 경로검증 부재 (path traversal)

`main.ts:607-615`

```ts
let filePath = path.join(
  distPath,
  req.url === "/" ? "index.html" : req.url || "index.html"
);
if (!fs.existsSync(filePath)) {
  filePath = path.join(distPath, "index.html");
}
```

- `req.url` 이 컨테인먼트 없이 join 된다. `GET /../../../../Users/<user>/.marblo/bridge-token` 같은 요청은 `path.join` 정규화로 `dist` 밖으로 나가고, 존재하면 200 으로 스트리밍된다.
- **완화(그래서 P0 아님)**: `server.listen(port, "127.0.0.1")`(684) 로 loopback 전용. 원격 공격자는 불가, 포트를 아는 로컬 프로세스/서브리소스 fetch 만 악용 가능. 브라우저 fetch 는 URL 정규화로 `..` 를 제거하므로 실질 벡터는 raw HTTP 클라이언트로 제한.
- **권고(소규모)**: join 후 `path.normalize` → `resolved.startsWith(distPath + path.sep)` 아니면 403; 쿼리스트링 분리/디코드.

### P2-4. 공유 static server — `createReadStream` 에러 핸들러 부재 → 디렉토리 요청/ TOCTOU 시 메인프로세스 크래시

`main.ts:633` `fs.createReadStream(filePath).pipe(res);`

- 스트림에 `.on("error")` 가 없다. (1) `filePath` 가 **디렉토리**로 resolve 되면(`GET /assets`) `existsSync` true·extname 없음·`createReadStream` 이 `EISDIR` 방출 → 미처리 stream error 는 요청 콜백에서 uncaught exception(전 창 화이트스크린/크래시). (2) `existsSync`↔`createReadStream` 사이 파일 삭제(TOCTOU) 동일. 서버 레벨 error 핸들러(669)는 스트림 에러를 안 잡는다.
- **권고**: `stream.on("error", () => { if(!res.headersSent) res.writeHead(404); res.end(); })` 또는 `statSync().isFile()` 가드.

### P2-5. MCP 리스트/검색 툴이 매 호출 컬렉션 전체를 읽음 (`limit` 은 표시만 절단)

`tools.ts:841`(get_all_tasks)·`1998`(search_tasks)·`921`(get_available_tasks)·`1739`(get_task_activities)·`679`(fetchRecentActivityMessages)

- 쿼리에 `.limit()`·`orderBy` 가 없다. `limit` 파라미터는 반환 *텍스트*만 `capLines` 로 자른다. `search_tasks` 는 `projectId` 필터 후 메모리 substring 매칭이라 최악. `get_task_activities`/`fetchRecentActivityMessages` 는 태스크의 _모든_ activity 를 읽고 메모리 정렬·슬라이스 → 장수명 태스크에서 무한 증가.
- **시나리오**: 수천 태스크/activity 보드에서 오케 폴링(빈번)마다 풀-컬렉션 read → 레이턴시·Firestore read 비용 폭증.
- **권고**: `orderBy(createdAt/priority)+limit(n)` 을 쿼리로 내림(activity 는 `orderBy("createdAt","desc").limit(window)`). 복합 인덱스 필요하나 read 를 bound.

### P2-6. `agentStore` 모듈레벨 IPC 리스너 — 멀티창 broadcast 로 Firestore N중 쓰기 + HMR 중복

`agentStore.ts:283-311`(`agent.onSyncStatus`)·`324-343`(`agent.onStatusChange`) — 최상위 모듈 부수효과로 등록, preload `onSyncStatus`(146)/`onStatusChange`(204)는 dedup·제거경로 없는 bare `ipcRenderer.on`.

- **멀티창 증폭(확인)**: `agent:syncStatus` 는 `bridge-server.ts:636-645` 의 `broadcast` 로 **모든** 창에 전달 → 창마다 name-match 후 `agentService.updateAgent(...)` Firestore 쓰기. 팝아웃 N개면 1건 dispatch 상태변화가 N개 동일 쓰기(멱등이라 손상은 아니나 N× 쓰기·쿼터 소모). (`agent:statusChanged` 는 `main.ts:538` 에서 project-scoped 라 양호 — `syncStatus` 만 무조건 broadcast.)
- **HMR(dev)**: `import.meta.hot` 미처리 → 저장마다 `ipcRenderer.on` 스택 누적, 이벤트당 Firestore 쓰기 배수 증가.
- **권고**: 컴포넌트/이펙트에서 등록+`removeAllListeners` cleanup, 또는 재등록 가드 + 단일 "leader" 창만 Firestore 쓰기(어차피 account-global 값).

### P2-7. `ptyMirror` 데드 미러 — 공유 채널 `removeListeners` 가 미러 리스너를 함께 제거하나 `attached` 플래그는 true 유지

`ptyMirrorStore.ts:109`(attach early-return)·`165-185`(detach 가 flag 미클리어, 코드 내 TODO), `terminalStore.ts:107`/`132`(`removeListeners(id)`), `preload.ts:110-112`(`removeAllListeners(pty:data:${id})`)

- `removeListeners` 는 그 채널의 **모든** 리스너(ptyMirror 포함)를 제거하는데, ptyMirror 는 "리스너 등록됐는가"의 단일 진실원인 `attached[id]` 를 의도적으로 안 지운다(주석 173-174 가 `release()` 필요를 TODO 로 명시).
- **시나리오**: 프로젝트 전환 → `detachAllSessions` 가 살아있는 에이전트 PTY 의 `pty:data` 리스너를 제거. ptyMirror 는 여전히 attached 로 믿음 → 복귀해 MiniTerminal 재마운트가 `attach()` 호출해도 109 에서 early-return, 재등록 안 됨 → Fleet 그리드 라이브 프리뷰가 앱 재시작 전까지 영구 stale. (크래시/손상 아님, 복구가능 → P1 아닌 P2. 코드가 이미 인지한 TODO.)
- **권고**: PTY exit/agent delete 시점의 `release(sessionId)`(TODO) — `buffers[id]`·`attached[id]`·해당 세션 리스너 정리. 또는 ptyMirror 에 선택적 제거 가능한 별도 핸들 부여.

### P2-8. `ptyMirror` 버퍼·`pty:data` 리스너 무한 증가 (세션 종료 시 eviction 없음)

`ptyMirrorStore.ts:104`·`165-185`

- `buffers`/`attached` 는 sessionId 키 `Record`, `detach` 가 의도적으로 보존, PTY exit/agent delete 시 `release()` 없음(자체 TODO). 개별 버퍼는 12줄 캡(19·67)이라 데이터 폭주는 아니나 **앱 수명 내 키+클로저 무한 누적**.
- **권고**: P2-7 과 같은 `release(sessionId)` 로 동시 해소.

---

## P3 — 잔여 리스크 / 하드닝 / 문서화

- **P3-1. preload 제네릭 `send`/`on` + `pty:*` 핸들러 owner-scoping 부재.** `preload.ts:63-68` 의 제네릭 `send`/`on` 은 임의 채널 통과(단, raw `ipcMain.on` 은 `pty:write`·`pty:writeAndSubmit` 2개뿐이라 blast radius 작음). `pty:write/writeAndSubmit/kill/resize`(`main.ts:2501+`)는 렌더러 `id` 를 owner 검증 없이 수용 → 한 창이 다른 창 PTY 를 조작 가능. 동일-신뢰 앱이라 저심각. 방어심화 권고.
- **P3-2. `pty:create` 가 렌더러 임의 command/args 스폰**(`main.ts:2490`). 브리지의 `ALLOWED_SPAWN_COMMANDS` 얼로우리스트가 이 경로로 우회됨. 터미널 특성상 얼로우리스트가 비현실적일 수 있으니 "렌더러 신뢰" 의식적 결정으로 문서화 권고.
- **P3-3. 브리지 토큰 = 동일OS유저 시크릿 → YOLO 오케 PTY 인젝션(RCE 위협모델).** `bridge-server.ts:807-830`·`orchestrator-manager.ts:381`(`--dangerously-skip-permissions`)·`inject-message`. 방어(256bit·상수시간·0600·host/command 얼로우리스트·body cap)는 실현가능 최대치. 잔여: 동일유저 프로세스가 토큰파일 읽어 임의 텍스트 주입 가능 → 수용 위협모델로 문서화. **오케 PTY danger-매처가 log 만이 아니라 실제 block 하는지 확인 권고**(`pty-manager.setBlockDangerous`).
- **P3-4. `AgentManager.agents` 맵에 dead 엔트리 무한 누적.** `agent-manager.ts` `stop()`(1086)·PTY-exit 브랜치가 삭제 안 함(주석 889-895 명시), `remove()`(1214)/재시작만 삭제. `cleanup_agents`/`remove` 로 회수되나 slow leak. 주기적 프루닝 또는 `cleanup_agents`→`remove` 신뢰성 확인 권고.
- **P3-5. `acquireResumeLock` 비원자적 read-modify-write(TOCTOU).** `orchestrator-manager.ts:1154-1169`. pid-liveness+TTL 백스톱·크로스워크트리 희소성으로 완화(주석도 "advisory"). 재발 시 `fs.openSync(...,'wx')` lockfile 권고.
- **P3-6. MCP-config 패치 에러 무시(`catch {}`).** `orchestrator-manager.ts:459-491` 가 브리지 토큰 주입 실패를 삼킴 → 오케 MCP 노드의 `spawn_agent`/`dispatch_task` 가 401, 원인 미노출. 최소 `console.warn` 권고.
- **P3-7. static server 하드 bind 실패 시 `resolve(0)` → 로드 불가 빈 창.** `main.ts:663`·`2293-2295` 가 `http://127.0.0.1:0` 로드 → 무진단 블랭크. `dialog.showErrorBox` 또는 번들 에러페이지 권고(희소).
- **P3-8. `telegramHealthTimer` quit 시 미클리어.** `main.ts:4701-4713`. `.unref()` 라 프로세스 유지는 안 하나 macOS `window-all-closed` 후에도 창 없이 4분 폴링 지속. 정리 권고(경미).
- **P3-9. `bindTaskToDispatchedAgent` 폴백이 무가드 `claimedBy` 덮어쓰기(last-writer-wins).** `tools.ts:373-395` — `claim_task` 와 달리 `validateTask: claimedBy==null` 없음. 동시 bind 시 두 번째가 catch 후 bare `updateDoc` 로 `claimedBy` 스톰프. 오케-단일작성자 불변식으로 완화(→P2/P3 경계). `get_available_tasks:939` 의 `!t.claimedBy` 가 status-TODO 잔류 케이스는 보정. 동일 precondition 추가 또는 리스크 명시 권고.
- **P3-10. 두 상태머신 발산 + "sync" 주석 부정확.** `tools.ts:78-91`(MCP, 더 관대) vs `state-machine.ts:3-11`(렌더러, 엄격). 주석은 `src/services/stateMachine.ts`(제3의 경로)와 sync 라 주장. UI 가 막는 전이가 MCP 로는 합법. 개별 전이는 주석상 정당(direct-complete 등)이나 발산이 미문서. 초superset 임을 명시 또는 파일참조 정정 권고.
- **P3-11. 렌더러 `firebase.ts` init-crash 가드/설정부재 폴백 없음.** `src/lib/firebase.ts:99·123·135` — MCP `firebase.ts`(getApps 가드+`fromBundledFile` 폴백)와 달리 (1) `getApps()` 가드 없음(중복 eval 시 "app already exists"), (2) `VITE_FIREBASE_*` 빌드부재 시 `auth/invalid-api-key` 모듈로드 실패. 정상 서명빌드엔 존재하므로 오빌드 한정. 패키징 이력상 `getApps()` 가드+빈설정 assert 권고.
- **P3-12. 다중 equality 태스크쿼리 복합인덱스 리스크(미검증).** `tools.ts:913-919`(status+role+projectId+contextId 4개)·`1768`. 미존재 시 `getDocs` 가 "requires an index" 런타임 throw, `get_available_tasks` 는 try/catch 없어 하드페일. `firestore.indexes.json` 미확인 → 인덱스 커버리지 검증 또는 진단 try/catch 권고.
- **P3-13. 입력검증 소소.** `create_task`/`bulk` 의 `role: z.string()`·`priority: z.number()` enum/range 없음(`tools.ts:991`) → 오타 role 은 영구 미디스패치 foot-gun. `getGroupedByProject`/`getFilteredTasks`/`getWorktreesByProject` 매 호출 새 참조(`worktreeStore.ts:209`·`taskStore.ts:66`) — 현재 셀렉터로 안 쓰여 미발화(latent). `agentSessionMap` localStorage 크로스창 동기화 없음(`agentSessionMap.ts:38`, 공유 origin 이라 단일창 가정 약화, stale-until-reload).

---

## 이미 잘 방어됨 (재지적 금지 — 보존 가치)

- **브리지 서버 RCE 하드닝**: loopback bind, non-loopback Host 거부(`isLoopbackHost`, IPv6 브래킷 언랩), 와일드카드 CORS 미방출(DNS-rebinding), per-boot 256bit bearer + 상수시간 비교(fail-closed), command 얼로우리스트(shell 메타·args 거부), 1MiB body cap(라우팅 전 부착·초과 시 소켓 destroy), `/health` 만 무인증.
- **PTY fd 누수**: `captureOrphanMasterFds`/`releaseOrphanMasterFds` 로 macOS 오펀 /dev/ptmx 마스터를 (fd,rdev) 페어 검증 후 모든 teardown 경로에서 close, `killProcessTree` 가 음수 pgid 로 서브트리만 정확히 종료, reaper 로 dead-but-mapped 스윕. (메모리의 fd누수 P0 완결.)
- **재시작/stale-PTY 레이스**: 전부 **객체 아이덴티티**로 가드 — agent onExit `if(agent!==instance)return`(884), pty onExit `sessions.get(id)===session`(623), orch onExit ptySessionId 비교(655). 재사용 verbatim `agent-<id>` PTY id 정확 처리.
- **타이머/fd 위생**: `agent-manager` heartbeatTimer 를 모든 exit 브랜치 전 clear(주석화), `clearAgentTimers` 전 teardown 호출, orch `stop()` restartTimer clear.
- **디스패치 동시성**: `withTaskLock` per-taskId 직렬화 + `finally` GC(중복 스폰·맵 누수 방지).
- **git 호출 인젝션-세이프**: `runBoardGit`·`runConnectionCheckCommand` 가 `spawn(...,{shell:false})` 고정 argv, `board:worktreeDiff` 경로검증+출력 cap.
- **창 하드닝**: `contextIsolation:true`·`nodeIntegration:false`·전용 preload, `webSecurity` 미해제·`sandbox` 미override(기본 on). 외부링크 `setWindowOpenHandler`+`will-navigate` 로 OS 브라우저 위임, `isInternalNavigationUrl` 이 `github.com` 을 `/login/oauth` 로만 스코프.
- **생명주기 정리**: `before-quit` 가 오케·텔레폴러·브리지·에이전트·pending·**PTY killAll**·fs watcher·워치독·미션엔진 teardown + static server close. per-window `closed` 가 ptyOwners·orch·watcher·windowProjects 정리 + 새 mainWindow 승격.
- **Firestore 동시성 핵심경로**: `claim_task` 가 `runTransaction` 내 `validateFrom(TODO)`+`validateTask(claimedBy==null)` 재검(TOCTOU 아님), `resolveDependentIfReady` 가 in-txn 재검으로 정확히 1회 unblock, status↔projection 단일 txn 원자성.
- **firebase 패키징 hang**: 127.0.0.1 origin heartbeat IndexedDB 무력화(`firebase.ts:72-97`), localStorage-first persistence, loopback 모드 resolver 생략 — 모두 방어 완료.
- **stores 위생 우수**: `ptyMirror.selectLines` 안정 `EMPTY` 센티넬+참조보존+50ms 디바운스, `projectStore.subscribeToProjects` cold-start 스냅샷 레이스 가드, `editorStore.saveFile` await 후 재-read(stale 클로저 회피), `chatStore` 5s loading 타임아웃.
- **크로스창 격리**: 각 BrowserWindow 별도 힙 → zustand 인메모리 상태는 창간 미공유(orch/editor/terminal store 안전). 공유면은 Firestore·localStorage·broadcast IPC 3개뿐(P2-6/7/P3-13 이 여기 집중).

---

## 후속 티켓 제안 (직접 수정 금지 — 리뷰가 목적)

우선순위순:

1. **`fs:writeFile`/`readFile`/`readFileBase64` 컨테인먼트 가드**(P2-1) — 형제 핸들러 패턴 복사, 소규모.
2. **`update_task_status` status enum 검증**(P2-2) — 1줄급, SoT 오염 차단.
3. **static server 경로검증 + 스트림 에러핸들러**(P2-3/4) — loopback 한정이나 크래시/traversal 동시 해소.
4. **MCP 리스트툴 `orderBy+limit` 푸시다운**(P2-5) — 스케일링 부채, 복합인덱스 동반.
5. **ptyMirror `release()` 구현**(P2-7/8) — 코드 내 TODO 해소, 데드미러+누수 동시.
6. **agentStore 리스너 leader-창 게이팅 + cleanup**(P2-6).
