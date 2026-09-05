---
title: Electron 의 절전·스로틀 스위치는 층이 정해져 있고 main 프로세스 타이머를 지켜주지 않는다
tags: [domain/foundations, topic/electron, topic/observability, verdict/adopt, method/source-link]
status: verified
date: 2026-09-05
links: [[control-must-differ-on-the-tested-axis]], [[name-the-actor-not-just-the-resource]], [[architecture]], [[no-live-gui-verify]], [[do-not-retry]]
---

# Electron 의 절전·스로틀 스위치는 층이 정해져 있고 main 프로세스 타이머를 지켜주지 않는다

> **한 줄 판정**: ★채택 — `powerSaveBlocker("prevent-app-suspension")` 은 **시스템 유휴 잠자기** 한 층만 막고(`kIOPMAssertionTypeNoIdleSleep`), `disable-renderer-backgrounding` / `disable-background-timer-throttling` 은 **렌더러 전용**이다. main 프로세스에서 도는 폴러·워치독·타이머를 지켜주는 스위치는 이 셋 중 **없다.** 실측: 세 스위치가 다 걸린 상태에서 main 프로세스 타이머가 **15~17분** 밀렸다.

## 무엇을 물었나

"백그라운드에서도 계속 돌아야 하는 main 프로세스 루프"가 안 돌 때, Electron 이 주는 절전·스로틀 스위치 중 무엇을 켜면 되는가. 그리고 이미 켜져 있다면 그게 무엇을 보장하는가.

## 무엇을 했나

추측하지 않고 소스 체인을 끝까지 따라간 뒤, 같은 기기에서 OS 가 실제로 무엇을 들고 있는지 대조했다. 원본 조사 문서는 복사하지 않았다 — 갈리면 원본이 옳다.

## 결과 (수치)

### 스위치별 실제 적용 층

| 스위치                                             | 실제로 거는 것                                             | 적용 층                | main 프로세스 타이머 |
| -------------------------------------------------- | ---------------------------------------------------------- | ---------------------- | -------------------- |
| `powerSaveBlocker.start("prevent-app-suspension")` | `kIOPMAssertionTypeNoIdleSleep` (IOKit 전원관리 assertion) | **시스템 유휴 잠자기** | ❌ 안 지켜줌         |
| `powerSaveBlocker.start("prevent-display-sleep")`  | `kIOPMAssertionTypeNoDisplaySleep`                         | 디스플레이 잠자기      | ❌                   |
| `--disable-renderer-backgrounding`                 | Chromium 렌더러 우선순위                                   | **렌더러 전용**        | ❌                   |
| `--disable-background-timer-throttling`            | Chromium 렌더러 타이머                                     | **렌더러 전용**        | ❌                   |

### `prevent-app-suspension` 소스 체인 (다시 파지 말 것)

```
electron  shell/browser/api/electron_api_power_save_blocker.cc:32-33
          "prevent-app-suspension" → WakeLockType::kPreventAppSuspension
chromium  services/device/wake_lock/power_save_blocker/power_save_blocker_mac.cc:75-76
          case kPreventAppSuspension: level = kIOPMAssertionTypeNoIdleSleep;
chromium  같은 파일 :88
          IOPMAssertionCreateWithName(level, kIOPMAssertionLevelOn, ...)
```

### 실행 중인지 확인하는 명령 — `pmset -g assertions`

```
pid 82786(Electron): [0x000fa8c200018044] 00:20:59 NoIdleSleepAssertion named: "Electron"
```

소스가 예측한 assertion 종류(`NoIdleSleep`)와 이름(`"Electron"`)이 그대로 찍힌다. **"걸었다고 믿는 것"과 "OS 가 실제로 들고 있는 것"을 가르는 한 줄이 이것이다.** 앱 안에서는 `powerSaveBlocker.isStarted(id)` 가 같은 값을 준다.

측정 환경: Mac15,7 / macOS 26.5.2 (25F84) / AC / 뚜껑 열림. 표본 = 기기 1대의 스냅샷 1회 + 83시간 `pmset -g log` 창.

### 이 스위치들이 다 켜져 있는데도 안 지켜진 것

| 관측                                         | 값                                    |
| -------------------------------------------- | ------------------------------------- |
| `pmset -g log` 83시간 창 Sleep/Wake/DarkWake | **0건** (= assertion 은 제 일을 했다) |
| 그 사이 main 프로세스 `setInterval` 지각     | **90만~100만 ms (15~17분)**           |
| 그동안 `api.telegram.org` TCP 상태           | ESTABLISHED 유지                      |

## 왜

세 스위치가 서로 다른 **층**에 걸리기 때문이다. IOPM assertion 은 커널 전원관리에게 "시스템을 유휴로 재우지 마라"고 말하고, Chromium 스로틀 스위치는 렌더러 프로세스 스케줄러에게 말한다. **main 프로세스의 Node 이벤트루프에게 말하는 스위치는 셋 중 없다.** 그래서 "절전 관련 스위치를 다 켰다"는 사실이 "내 타이머가 제때 돈다"를 함의하지 않는다.

## 한계 / 정직성

- ★**그 15~17분 서스펜션이 무엇 때문인지는 규명하지 못했다.** 이 노트가 말하는 것은 "이 세 스위치가 그것을 막아주지 않는다"까지다. 원인 후보와 배제 근거는 원본에 있다.
- ★**2026-09-04 후속 실측 — 같이 딸려오던 "인바운드가 끊긴다" 증상은 서스펜션이 아니었다.** 72 표본 구간에서 `driftMs` 최대 21ms, `possibleSuspendGap` 0건, `suspendRecoveries` 0건이었는데도 인바운드는 끊겨 있었고, 오류는 전부 `http-409`(같은 봇에 소비자 둘) 였다. 즉 **프로세스는 제때 스케줄되고 있었다.** 이 노트의 판정(스위치의 층 매핑)은 그대로 유효하지만, 이 노트의 근거 사건에서 "타이머 지각"과 "인바운드 끊김"은 **같은 원인이 아니다** — 후자는 폴러의 단일 소비자 계약이 깨진 것이었다(원본 §0-A). 전자(야간 15~17분 드리프트)의 기전은 여전히 미규명이다.
- ★**2026-09-05 — 위 "단일 소비자 계약이 깨졌다"의 범인이 확정됐다: 두 번째 소비자는 이 기기 안이 아니라 다른 맥이었다.** 맥북프로와 맥미니의 마블로가 같은 봇으로 동시에 `getUpdates` 를 돌며 서로를 409 로 강탈했다(12초 주기 시소). 이 노트에 이것이 남는 이유는 **층이 또 한 번 갈렸기 때문**이다 — 이 노트의 원래 결론은 "OS 전원 층에는 main 타이머를 지켜주는 스위치가 없다"였는데, 이 사건의 인바운드 끊김은 애초에 전원 층 문제가 아니라 **소유권 층** 문제였다. 맥이 잠드는 것 자체는 이제 해로운 사건이 아니다: 잠들면 폴러 리스가 90초 뒤 만료되고 깨어 있는 기기가 그냥 이어받는다. 즉 전원 층에서 못 막는 것을 소유권 층에서 흡수하게 만든 것이 수정의 형태다([[name-the-actor-not-just-the-resource]] 의 2026-09-05 개정, [telegram-poller-lease.ts](../../../v3/electron/telegram-poller-lease.ts)). 야간 15~17분 드리프트의 기전은 **여전히 미규명**이고, 이 항목이 그것을 설명하지 않는다.
- App Nap 가설은 이 노트가 지지하지 않는다. Apple 문서(Energy Efficiency Guide, "Extend App Nap")는 **IOKit 전원관리 assertion 을 든 앱은 App Nap 후보에서 빠진다**고 명시하므로, assertion 이 걸린 구간에서는 App Nap 으로 설명되지 않는다.
- 소스 줄 번호는 2026-09-04 시점 `chromium/main` · `electron/main` 값이다. 상류가 리팩터링되면 줄은 밀린다 — 종류(`kIOPMAssertionTypeNoIdleSleep`)가 본체고 줄 번호는 안내다.
- 표본은 기기 1대다. 다른 macOS 버전에서 매핑이 같은지 확인하지 않았다.
- **수치가 갈리면 원본이 옳다.**

## 실제 영향

코드 변경 있음 — 다만 이 노트의 판정 때문이 아니라 그 판정이 남긴 공백 때문이다. 스위치로 못 막으니 폴러 쪽에 "재워졌다 깨면 백오프를 건너뛰고 즉시 재폴링" 회복 경로와 실측 저널 필드(`powerSaveBlockerActive`, `lastPollDurationMs`, `suspendRecoveries`, `screenLocked`)를 넣었다. 폴러의 배달 로직·offset 전진 규칙은 무변경.

앞으로 "백그라운드에서 안 돈다"를 만나면 위 세 스위치를 켜는 것으로 끝내지 않고, `pmset -g assertions` 로 무엇이 실제로 걸려 있는지 먼저 읽는다. 그리고 ★**"안 돈다"와 "돌지만 결과가 안 온다"를 먼저 가른다** — 이 노트의 근거 사건에서 둘이 섞여 있었고, 그 혼동이 조사 3회를 잡아먹었다([[name-the-actor-not-just-the-resource]]).

## Evidence

- [v3/docs/telegram-app-nap-investigation.md](../../../v3/docs/telegram-app-nap-investigation.md) — 축 A(소스 체인·assertion 실측), 축 D-4(렌더러 전용 배제), 확정/미확정 분리
- [v3/electron/main.ts](../../../v3/electron/main.ts) — `refreshWorkPowerSaveBlocker()` · `--disable-renderer-backgrounding` · `--disable-background-timer-throttling`
- [v3/electron/telegram-poller.ts](../../../v3/electron/telegram-poller.ts) — `backoffUnlessSuspended()` · `notePowerResume()` · ★`awaitLease()`(리스 재시도 대기도 `sleep()` 을 쓰므로 전원 복귀 nudge 가 이 대기도 앞당긴다)
- ★[v3/electron/telegram-poller-lease.ts](../../../v3/electron/telegram-poller-lease.ts) — 전원 층에서 못 막는 것을 소유권 층에서 흡수한다(잠든 기기의 리스는 만료되고 깨어 있는 기기가 인수)
- [v3/electron/telegram-route-journal.ts](../../../v3/electron/telegram-route-journal.ts) — `powerSaveBlockerActive` · `lastPollDurationMs` · `suspendRecoveries` · `screenLocked`

## Backlinks

- [[control-must-differ-on-the-tested-axis]] — 이 건에서 caffeinate 대조가 왜 무효였는지의 일반 규칙
- [[name-the-actor-not-just-the-resource]] — 같은 사건의 "인바운드 끊김" 쪽이 왜 3회나 안 잡혔는지의 일반 규칙
- [[firestore-lease-actor-and-server-time]] — 기기 간 인수의 인증 주체와 서버시각 경계
- [[architecture]] · [[no-live-gui-verify]] · [[do-not-retry]]
