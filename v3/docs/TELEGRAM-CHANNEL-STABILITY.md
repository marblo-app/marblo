# Telegram 채널 안정성 — 정상상태 간헐 끊김 진단·보강

티켓 rDUJouZp. 오케↔텔레그램이 **연결된 상태에서도 중간중간 폴러(MCP)가
끊기는** 정상상태 안정성 이슈를 진단하고, Marblo 통제범위에서 보강한 내역과
Marblo 가 못 고치는 외부 한계를 기록한다. (오케 재기동 관련 #294 토큰·#296
재기동 그룹킬과는 **별개**.)

## 1. 폴러 구조 (누가 무엇을 소유하는가)

```
Electron main ──spawn(node-pty)──▶ 오케 claude 프로세스
                                     └─(--channels plugin:telegram)──▶ bun server.ts  ← 폴러
                                          (MCP stdio 손자, getUpdates long-poll)
```

- 텔레그램 폴러 = `bun server.ts`. 오케의 `claude` 가 `--channels
plugin:telegram@claude-plugins-official` 로 띄우는 **stdio MCP 서버(손자
  프로세스)** 다.
- **폴러의 수명은 100% claude MCP 호스트가 소유한다.** Marblo 는 폴러를 직접
  스폰하지도, 감독하지도 않는다(오케 claude 만 스폰). 따라서 **오케 세션을
  재시작하지 않고 폴러만 재기동할 레버가 Marblo 에는 없다.** 이것이 이 문제의
  근본 제약이다.
- 외부 플러그인 소스: `~/.claude/plugins/marketplaces/claude-plugins-official/external_plugins/telegram/server.ts`
  (Marblo 레포 밖 — **직접 수정 불가**).

## 2. 근본원인 분류 (양쪽 코드 정적 실증)

| 원인                                 | 자가치유?       | 소유     | Marblo 조치            |
| ------------------------------------ | --------------- | -------- | ---------------------- |
| **(a) mac sleep/wake TCP 사망**      | ✅ 지연 후      | 플러그인 | 관측 + 넛지            |
| **(b) long-poll 갭 / 429 backoff**   | ✅              | 플러그인 | 없음(외부)             |
| **(c) 409 / webhook / 중복 폴러**    | ❌ **영구사망** | 혼합     | **자동 치유(webhook)** |
| **(d) MCP stdio / claude idle·exit** | 부분            | claude   | 관측만                 |
| **(e) 플러그인 self-heal 오탐**      | ✅              | 플러그인 | 없음(외부)             |

### (a) mac sleep/wake — 자가치유되나 회복 지연

절전 시 getUpdates long-poll 소켓이 죽는다. 깨어나면 grammy 폴링 루프가
결국 `ETIMEDOUT`/`ECONNRESET` 로 에러 → 플러그인의 재시도 루프
(`server.ts:994-1038`, 최근 fix 로 **409뿐 아니라 모든 에러**를 backoff 재시도)가
≤15s 내 재폴링한다. **즉 폴러는 스스로 회복한다.** 다만 죽은 소켓이 에러로
표면화되기까지의 지연(수 분까지 가능)만큼 인바운드 공백이 생겨 "끊긴 것처럼"
보인다.

### (b) long-poll 갱신 갭 / 429 — 자가치유

플러그인 backoff 가 처리. Marblo 통제 밖이며 스스로 회복.

### (c) 409 / webhook — 자가치유 안 됨(영구사망), Marblo 가 고칠 수 있는 유일한 원인

- **getUpdates 와 webhook 은 Bot API 상 상호배타**다. 봇에 webhook 이 등록돼
  있으면 getUpdates 는 **영구 409 Conflict** 를 받는다.
- 플러그인은 409 를 **8회** 재시도한 뒤 폴 루프를 **`return`(exit)** 한다
  (`server.ts:1023-1029`). 프로세스는 MCP stdin 때문에 살아 있지만 **폴러는
  영원히 deaf** — 아웃바운드 도구(reply)는 되는데 인바운드만 죽는, 정확히 이
  티켓의 "연결됐는데 간헐/영구 끊김" 증상.
- **`deleteWebhook` 이 메커니즘상 정확한 해법**이고 재시작이 필요 없다. Marblo 는
  토큰을 보유하므로 out-of-band 로 고칠 수 있다.
- 중복 폴러(잔존 orphan 이 슬롯 점유): #296 트리킬이 **재기동 핸드오프**는
  커버한다. 정상상태에서 잔존 orphan 이 남아 있으면 신폴러가 8회 후 exit→deaf 가
  되지만, 그건 orphan 을 죽여야 풀리고 그 orphan 역시 claude 소유라 Marblo 가
  직접 못 죽인다(관측만 가능).

### (d) MCP stdio / claude 세션 idle·exit — claude 소유(외부 한계)

폴러는 stdin EOF(`server.ts:661`)와 orphan-watchdog(ppid 변화 / stdin
destroyed, `server.ts:671`)에서 스스로 shutdown 한다. claude 가 MCP 연결을
재구축(stdio 히컵)하면 폴러가 죽고, claude 가 MCP 를 재init 해야 다시 산다.
**Marblo 통제 밖.** 관측만 가능.

### (e) 플러그인 orphan watchdog 오탐 — 외부

플러그인이 자기 self-heal 로직으로 self-terminate 하는 경우. 외부·미변경.

## 3. ★관측성 갭 (진단을 막는 #1 장애물)

**텔레그램 폴러 로그가 어디에도 캡처되지 않는다.**
`~/Library/Caches/claude-cli-nodejs/*/mcp-logs-*` 에 telegram 항목이 없다.
`--channels` 플러그인의 stderr(409/backoff/shutdown 진단 메시지)를 claude 가
디스크에 persist 하지 않기 때문이다. 그래서 정상상태 끊김이 발생해도 **사후에
(a)~(e) 중 무엇이 발화했는지 특정할 수 없다.** 티켓의 "로깅 켤 방법 확인"이
정확히 이 지점을 가리킨다.

→ Marblo 측 보강(§4)의 **주기 헬스 프로브**가 이 갭을 부분적으로 메운다:
`pending_update_count` 를 폴러 생사 시그널로, webhook 등록 여부를 (c) 신호로
로그에 남긴다.

## 4. Marblo 통제범위 보강 (이 PR)

`electron/telegram-health.ts` + `main.ts` 배선. **원인을 추측하지 않고, 어느
원인이 발화하든 correct-by-construction 인 것만** 넣었다.

1. **wake 시 + 4분 주기**로 활성 채널마다 `getWebhookInfo` 프로브:
   - webhook 이 있으면 `deleteWebhook`(drop_pending_updates=false — 큐잉된
     메시지 보존) → **(c) 영구 409 해소.** 폴러 재시작 불필요.
   - `pending_update_count` 를 읽어 폴러 deaf 여부를 로그/`telegram:health` IPC 로
     표면화 → 사용자가 수동 재연결 판단.
2. `powerMonitor.on("resume")`(기존 `system:wake` 배선)에 프로브를 fire-and-forget
   로 물림. mac 절전이 가장 흔한 정상상태 끊김 트리거이므로.

불변식: 프로브는 **절대 throw 하지 않고**(wedge 된 프로브가 wake 핸들러를
막지 않도록), **봇 토큰을 로그/반환값에 절대 노출하지 않는다**(scrub).

### 왜 "폴러 재기동"을 안 하나

폴러 재기동은 오케 claude MCP 연결 재시작을 의미한다. 티켓이 "큰 재설계(폴러를
오케에서 분리)는 하지 말 것"으로 명시했고, wake마다 오케를 재시작하는 것은
바람직하지 않다. (a)는 플러그인이 이미 자가치유하므로 Marblo 는 관측·webhook
치유만 담당하고 폴러 생명주기는 claude 에 맡긴다.

## 5. Marblo 가 못 고치는 것 (외부 한계 — 명시)

- **폴러 생명주기**: claude MCP 호스트 소유. Marblo 는 오케 재시작 없이 폴러만
  못 되살린다. (d)의 stdio 히컵·(c)의 잔존 orphan 은 관측만 가능.
- **(a) 회복 지연**: grammy long-poll 이 죽은 소켓을 에러로 인지하는 타이밍은
  플러그인/OS TCP 타임아웃에 달렸다. Marblo 가 앞당길 수 없다.
- **플러그인 8회-후-exit 정책**: `server.ts` 내부. 영구 deaf 로 만드는 이 정책은
  업스트림(claude-plugins-official telegram) 이슈로 보고하는 게 정답 —
  예: 409 지속 시 exit 대신 저빈도 무한 재시도로 바꾸면 webhook 이 나중에
  제거될 때 스스로 회복 가능.

### 권고 (운영/업스트림)

- **운영**: 봇 하나를 getUpdates 채널과 webhook 통합에 동시에 쓰지 말 것
  (상호배타 → 영구 409). 인바운드가 조용하면 오케를 재연결.
- **업스트림 이슈 후보**: (1) 폴러 stderr 를 파일로 남길 수 있는 옵션(진단성),
  (2) 409-persist 시 exit 대신 저빈도 재시도.

## 6. 검증

- `tests/unit/telegram-health.test.ts` — 9 케이스: webhook 없음/있음/삭제억제,
  네트워크에러 no-throw, API ok:false, 빈 토큰 no-fetch, 토큰 미노출,
  채널순회(활성 필터·onReport·getWebhookInfo→deleteWebhook 순서).
- `tsc --noEmit` green, 기존 `telegram-channels.test.ts` 회귀 없음.
- **한계**: 물리적 장시간 라이브 세션(분~시간) before/after 끊김빈도·실제
  mac wake 자동복구는 이 격리 워크트리 서브에이전트 환경에서 재현 불가.
  본 PR 은 정적 실증 기반 근본원인 분류 + correct-by-construction 최소보강이며,
  머지 후 재빌드된 앱에서 장시간 세션으로 (c) webhook 자동치유와
  `telegram:health` 표면화를 관측 검증할 것.

## 7. 봇 토큰 소유권 규칙 (2026-07-18, 티켓 kYC4pGM7S4k6967qs8uO)

> §1–6 은 폴러가 claude MCP 소유이던 시절 기준이다. #301(e3250ec) 이후 getUpdates
> 폴러는 **electron main(telegram-poller.ts) 단독 소유**이며, 이 섹션이 현행 규칙이다.

### 규칙: 1 봇 = 1 프로젝트

Telegram getUpdates 는 **봇당 단일 소비자**다(두 번째 long-poll 이 첫 번째를
409 로 강탈). 따라서 **같은 봇 토큰을 여러 프로젝트에 연결하는 것은 설정
오류**로 취급한다 — "하나의 봇으로 여러 프로젝트 알림"을 지원하려면 폴 루프
1개가 인바운드를 프로젝트별로 라우팅해야 하는데, chatId 만으로는 대상
프로젝트를 구분할 수 없어 라우팅이 모호해진다. 지원하지 않는다.

강제 지점 (이중 방어):

- **설정 단계 차단**: `telegram-channels.setConfigFromLocalSettings` 가 다른
  활성 프로젝트가 이미 쓰는 토큰이면 `enabled` 를 강등하고
  `preflight.issues`/`canEnable=false` 로 프론트 토글을 잠근다
  (`findTokenConflicts`).
- **런타임 dedup**: `telegram-poller.syncActiveChannels` 가 루프를 projectId 가
  아니라 **토큰 기준으로 dedup** 한다. 레거시/수동편집 데이터로 같은 토큰의
  활성 프로젝트가 2개 이상이어도 결정적 승자(기존 루프 우선 → 사전순) 1개만
  폴링하고, 나머지는 경고와 함께 보류된다. 서로 409 를 주고받는 상태는
  구조적으로 발생하지 않는다.

### 플러그인 config 브릿지 제거 (409 잔존원인의 실체)

과거 빌드는 오케를 `--channels plugin:telegram` 으로 띄우기 위해 봇 토큰을
`~/.claude/channels/telegram/.env` 로 실체화했다. #301 이후 이 브릿지는 용도를
잃었지만 실체화된 토큰이 남아, 이 머신의 **모든** claude 플러그인 호스트
(Cursor 의 MCP 호스트, `--strict-mcp-config` 없는 인터랙티브 claude 세션)가
그 토큰으로 자체 getUpdates 폴러(bun server.ts)를 부팅해 electron main 폴러를
409 로 강탈하고, 받은 메시지를 배달 없이 소비-유실했다 (2026-07-18 실측:
Cursor mcp-process → bun 폴러가 점유, marblo 오프셋 파일 정지).

현행 동작:

- 마블로는 봇 토큰을 `~/.marblo/telegram-channels.json` 밖으로 **절대
  실체화하지 않는다**.
- 저장/삭제/폴러 기동 시 `neutralizePluginConfig` 가 플러그인 .env 의
  `TELEGRAM_BOT_TOKEN` 을 제거(다른 키 보존)하고 access.json 을
  `dmPolicy=disabled` 로 중화한다 — 외부 플러그인 폴러는 부팅 즉시 종료된다.
  단, **이미 떠 있는** 외부 폴러는 재시작 전까지 토큰을 쥐고 있다(수동 종료
  필요 — 사장님 게이트).

### 409 진단 로그

409 가 나면 폴러는 바닥 로그만 찍지 않고 5분 스로틀로 진단 라인을 남긴다
(`maybeDiagnose409`): ① 같은 토큰을 쓰는 다른 마블로 프로젝트, ② 플러그인
상태 디렉토리의 토큰 일치 여부 + `bot.pid` 프로세스 생존 여부(외부 폴러 지목),
③ webhook 케이스(기동 프로브가 자가치유)를 안내한다. 토큰은 항상 SHA-256
해시 앞 8자리로만 표기된다.

### 검증 (이 티켓)

- `tests/unit/telegram-channels.test.ts` — 브릿지 제거(실체화 0·잔존 토큰
  정리·비소유 필드 보존), 토큰 소유권 차단(강등·issues·레거시 이중활성 표시).
- `tests/unit/telegram-poller.test.ts` — 토큰 dedup(결정적 승자·기존 루프
  유지·상이 토큰 공존), 기동 정리 호출, 409 진단(점유자 지목·스로틀·토큰
  비노출).
