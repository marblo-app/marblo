# powerSaveBlocker 가 걸려 있는데 왜 15~17분 프로세스 서스펜션이 나는가

티켓 VCGuLWmNTlhoRvwGAKJA · 선행 6umMHxuDmggv3R8Q1Mw6 (PR #1397) · 조사일 2026-09-04
대상 기기 Mac15,7 / macOS 26.5.2 (25F84) / Wi-Fi / AC / 뚜껑 열림

---

## 0. 결론 — 규명 못 했다. 무엇까지 배제됐는지 적는다

> ★**2026-09-04 후속 실측으로 이 사례는 닫혔다. 먼저 §0-A 를 읽어라.** 아래 §0 은
> 당시 판정 그대로 남긴다(무엇을 어디까지 알고 있었는지가 기록이므로 고치지 않는다).
> 결론만 바뀌었다 — 이 증상은 잠자기·App Nap·화면 잠금이 아니라 **같은 봇에 대한
> getUpdates 소비자 중복(HTTP 409)** 이었다. 티켓 3asM22VKCCXgAlfnNXTJ.

**확정된 것:** `powerSaveBlocker.start("prevent-app-suspension")` 은
`kIOPMAssertionTypeNoIdleSleep` IOKit assertion을 건다(소스 체인 §A-1). 그리고 증상
시각에 **그 assertion 은 실제로 걸려 있었다**(§A-2 pmset 실측). 즉 "걸었다고 믿었는데
안 걸렸다" 가설은 **기각**이다.

**규명 못 한 것:** 그런데도 프로세스가 15~17분씩 안 돌았다. 그 기전을 못 특정했다.
가장 유력했던 App Nap 은 **Apple 문서가 배제한다** — IOKit 전원관리 assertion 을
들고 있는 앱은 App Nap 후보에서 빠진다(§A-3). 즉 assertion 이 걸려 있었다는 §A-2 실측이
App Nap 가설도 같이 약화시킨다.

**새로 찾은 단서(상관까지만):** 이 맥은 화면이 잠기고, 그 잠금 창(14시간 57분)이 증상
창·#1397 야간 오류 구간을 통째로 덮는다. 대조군 두 대는 잠기지 않는 기기다(§D-2).
기전은 모른다.

**배제된 것:** 시스템 잠자기(pmset 83시간 0건), 뚜껑 닫힘 강제절전(같은 근거 + 뚜껑
열림), blocker 미체결, 렌더러 스로틀링 스위치, 전원/열/저전력 설정(§D-1, §D-4, §5).

**넣은 코드는 기전과 무관하게 성립한다** — "무엇이 재웠는지" 를 몰라도 "재워졌다 깨면
즉시 밀린 걸 가져온다" 는 방어는 유효하다(§구현).

## 0-A. ★후속 실측 — 이 사례는 닫혔다 (2026-09-04, 티켓 3asM22VKCCXgAlfnNXTJ)

**아래 §A~§E 의 조사 규칙과 방어 코드는 그대로 유효하다. 바뀐 것은 이 사례의 결론이다.**

§0 이 "규명 못 했다" 로 남겨 둔 증상에 대해, 이 노트가 심어 둔 계측이 마침내 답을
내놨다. 그리고 답은 잠자기 쪽이 아니었다.

### 실측 (`~/.marblo/telegram-route-health.jsonl`, 12:18~15:16 구간 72 표본)

| 관측 | 값 | 이 노트의 가설에 대한 함의 |
|---|---|---|
| `driftMs` | 최대 **21ms** (대부분 0~5ms) | ★샘플러가 제 시각에 깼다. 프로세스는 **정상적으로 스케줄되고 있었다** |
| `possibleSuspendGap` | **0건** | 서스펜션 구간이 아예 없다 |
| `suspendRecoveries` | **0건** | 서스펜션 회복 경로가 한 번도 발동하지 않았다 |
| `pollError` | 계속 **`http-409`** | 그 시간 내내 **다른 소비자가 같은 봇의 getUpdates 를 쥐고 있었다** |

즉 **프로세스는 멀쩡히 돌고 있었는데 인바운드만 끊겼다.** 이건 "재워져서 못 받았다"
와 정반대 모양이다. 서스펜션 가설로는 `driftMs≈0` 과 `409` 를 동시에 설명할 수 없다.

### 이 노트의 판정에 대한 결론

- ★**§D-2 의 화면 잠금 상관은 이 증상의 원인이 아니다.** §확정-6 이 "상관이지 인과가
  아니다" 라고 조심스럽게 남겨 둔 것이 옳았다. `driftMs≈0` 구간에서 증상이 그대로
  재현됐으므로, 잠금이 프로세스를 재워서 인바운드가 끊긴다는 경로는 이 사례에
  해당하지 않는다.
- ★**§미확정-7 의 맥북에어 모순이 (c) 로 풀렸다.** 세 갈래 중 "(c) 잠금 가설이 그냥
  틀렸고 §D-2 는 우연이다" 가 답이다. 맥북에어가 클램셸에서도 멀쩡했던 이유는
  간단하다 — 그 기기는 **다른 봇 토큰**을 쓰므로 애초에 409 경쟁 대상이 아니었다.
  잠금 여부는 처음부터 변수가 아니었다.
- **App Nap 가설도 이 사례에서는 닫힌다.** §A-3 이 문서 근거로 "약하다" 고 했던 것을
  이제 실측이 "이 구간에는 해당 없음" 으로 확정한다.

### 그러면 무엇이었나

`getUpdates` 는 봇당 **단일 소비자**라 두 요청이 겹치면 HTTP 409 가 난다. 폴러의
중복 방지 가드(`loops.has(projectId)`)가 **맵만 지키고 네트워크 소비자는 못 지키는**
상태였다: `stopLoop()` 이 등록을 먼저 지우고 루프 종료를 나중에 기다렸는데, 25초
롱폴에 물린 루프는 등록에서 사라진 뒤에도 소비자 슬롯을 계속 쥐고 있다. 그 창에서
`syncActiveChannels()` 가 돌면 두 번째 루프가 첫 루프의 롱폴 한가운데로 들어간다.

이건 추론이 아니라 재현된다 — `tests/unit/telegram-single-consumer.test.ts` 의 첫
테스트가 옛 동작에서 **동시 getUpdates 2개**를 실제로 관측한다. 수정 후에는 1개다.

### 확정 / 미확정 (이 후속 조사분)

**확정**
1. 증상 구간에 프로세스는 서스펜드되지 않았다(`driftMs≤21ms`, `possibleSuspendGap` 0건).
2. 오류는 전부 `http-409` = 같은 봇에 소비자가 둘 이상 있었다.
3. 이 맥에서 Bot API 에 붙는 프로세스는 Electron 메인 **1개뿐**이다(`lsof` 60초 8회 표집).
   활성 프로젝트 3개의 봇 토큰은 서로 다르다(sha256 앞 8자리 대조).
4. 배달 주체와 저널 주체는 **같은 인스턴스**였다. 15:11 표본이
   `lastDeliveredUpdateId` 를 직접 싣고 있다 — "둘이 다르다" 는 초기 가설은 기각.
5. `stopLoop` 의 등록 선삭제 경로로 **동시 소비자 2개**가 만들어진다(테스트로 재현).
6. 판정 함수가 연속 폴링 오류를 안 봐서 105건 연속 실패를 `idle-ok` 로 불렀다.

**미확정 — 확정한 것처럼 쓰지 않는다**
1. ★**오늘의 3시간짜리 409 연속이 위 경로로 생긴 것인지는 확정하지 못했다.** 경로가
   존재하고 재현된다는 것과, 그 경로가 이번 구간을 실제로 만들었다는 것은 다른
   주장이다. 실행 중인 앱을 건드리지 말라는 제약 때문에 런타임에서 루프 수를 직접
   세지 못했다.
2. 그래서 이번 변경은 **관측을 먼저 심는다** — `loopId` / `concurrentLoops` /
   `loopStarts` / `lastPollLoopId` / `lastDeliveredLoopId` 가 저널 한 줄에 들어간다.
   다음 침묵 때 `concurrentLoops > 1` 이거나 `lastPollLoopId` 가 두 값 사이를
   오가면 그게 답이고, 둘 다 아니면 경쟁자는 이 프로세스 **밖**에 있다.
3. 이 노트의 원래 증상(#1397 야간 15~17분 드리프트)이 오늘 것과 **같은 원인인지는
   모른다.** 오늘 구간에는 드리프트가 없었으므로, 야간 드리프트는 별개 현상일 수
   있다. §A-4 의 세 갈래는 그 사안에 대해서는 여전히 열려 있다.

### 남기는 규칙 (이 사례가 닫혀도 유효하다)

- **"조용하다" 는 진단이 아니다.** 못 받은 것(루프)과 못 넘긴 것(주입 보류)과 보낸
  사람이 없는 것은 사용자에게 똑같이 보인다. 셋을 가르는 필드를 항상 같은 줄에 남겨라.
- **계수기를 프로젝트 하나로만 묶지 마라.** 같은 키에 둘이 겹쳐 쓰면 "하나가 계속
  진다" 와 "둘이 서로를 걷어찬다" 가 구별되지 않는다. 주체를 적어야 관측이 된다.
- ★**판정이 고장난 상태를 정상이라고 부르면 저널은 없느니만 못하다.** 새 실패
  모드를 추가할 때마다 판정 함수가 그것을 볼 수 있는지 같이 확인해라.
- **상관을 인과로 승격하기 전에 반증 사례를 먼저 찾아라.** §미확정-7 의 맥북에어가
  그 역할을 했다. 그 한 줄이 없었다면 이 노트는 잠금 가설로 닫혔을 것이고, 오늘의
  진짜 원인은 더 늦게 발견됐을 것이다.

## A. `prevent-app-suspension` 이 실제로 무엇을 거는가

### A-1. 코드 체인 (1차 소스)

| 단계 | 위치                                                                                    | 내용                                                                              |
| ---- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 1    | `v3/electron/main.ts` `refreshWorkPowerSaveBlocker()`                                   | `powerSaveBlocker.start("prevent-app-suspension")`                                |
| 2    | electron `shell/browser/api/electron_api_power_save_blocker.cc:32-33`                   | `"prevent-app-suspension"` → `device::mojom::WakeLockType::kPreventAppSuspension` |
| 3    | chromium `services/device/wake_lock/power_save_blocker/power_save_blocker_mac.cc:75-76` | `case kPreventAppSuspension: level = kIOPMAssertionTypeNoIdleSleep;`              |
| 4    | 같은 파일 `:88`                                                                         | `IOPMAssertionCreateWithName(level, kIOPMAssertionLevelOn, ...)`                  |

참고로 `prevent-display-sleep` 은 같은 switch 에서 `kIOPMAssertionTypeNoDisplaySleep`
으로 간다(`:78-80`). **두 타입 다 IOKit 전원관리 assertion 이다.** Electron 이 노출하는
선택지 중 App Nap 층을 건드리는 것은 없다.

### A-2. 이 기기 실측 — 소스가 예측한 그대로 찍힌다

```
$ pmset -g assertions          # 2026-09-04 11:49
pid 82786(Electron): [0x000fa8c200018044] 00:20:59 NoIdleSleepAssertion named: "Electron"
```

`NoIdleSleepAssertion` = `kIOPMAssertionTypeNoIdleSleep`. 소스 체인과 일치한다.

### A-3. App Nap 을 막는가 — ★막는다(내 초기 판정이 틀렸다)

`kIOPMAssertionTypeNoIdleSleep` 은 **시스템 유휴 잠자기**를 막는 assertion이다. 여기까지는
맞다. 그래서 처음에 "그러면 프로세스 단위 App Nap 은 못 막겠다" 고 판정했는데,
**Apple 문서를 직접 읽으니 그게 틀렸다.**

> Generally, an app is a candidate for App Nap if:
>
> - It isn't the foreground app
> - It hasn't recently updated content in the visible portion of a window
> - It isn't audible
> - **It hasn't taken any IOKit power management or NSProcessInfo assertions**
> - It isn't using OpenGL
>
> — Energy Efficiency Guide for Mac Apps, "Extend App Nap" → How App Nap Works
> https://developer.apple.com/library/archive/documentation/Performance/Conceptual/power_efficiency_guidelines_osx/AppNap.html

App Nap 후보 조건은 **AND** 로 묶여 있고, 그 중 하나가 "IOKit 전원관리 assertion 을
안 들고 있을 것" 이다. 우리는 들고 있다(§A-2 실측). **따라서 문서대로면 이 앱은 애초에
App Nap 후보가 아니다.**

같은 결론을 PR #1398(d0fa29a1)이 먼저 냈다. 그 지적이 맞다.

### A-4. 그러면 무엇이 프로세스를 재웠는가 — 미해결

문서가 맞다면 App Nap 은 아니고, pmset 이 맞다면 시스템 잠자기도 아니다. 그런데
driftMs 15~17분은 실측이다. 셋 중 하나다:

1. 위 Apple 문서는 **아카이브 문서**(OS X 10.9~10.10 시절 서술)다. macOS 26 의 실제
   동작이 달라졌을 수 있다.
2. `kIOPMAssertionTypeNoIdleSleep` 이 문서가 말하는 "IOKit power management assertion"
   면제 대상에 실제로는 안 들어갈 수 있다(문서는 assertion 종류를 특정하지 않는다).
3. 서스펜션 기전이 App Nap 도 시스템 잠자기도 아닌 제3의 것이다.

**이 셋을 가르지 못했다.** 가르려면 다음 침묵 때의 저널이 필요하다(§구현 3).

### A-5. 그래도 확정인 것 — caffeinate 대조 실험은 무효다

| 기존 관측                                   | 해석                                                                                                                                                                                                        |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| pmset 83시간 창 Sleep/Wake/DarkWake 0건     | assertion 이 **제 일을 했다**. 시스템 잠자기는 실제로 막혔다                                                                                                                                                |
| `caffeinate -dimsu` 로도 재현됨             | caffeinate 도 **같은 IOPM 계열**만 건다(§A-2 pmset 출력의 `PreventUserIdleSystemSleep`). 이미 Electron 이 걸고 있던 것과 같은 층을 한 겹 더 얹은 것 — **새 정보가 없는 실험이었다.** 무엇도 배제하지 못한다 |
| api.telegram.org 커넥션 ESTABLISHED 유지    | 서스펜션은 소켓을 끊지 않는다. 스케줄링만 멈췄다                                                                                                                                                            |
| loop-stalled 10건 전부 driftMs 90만~100만ms | 타이머가 그만큼 연기됨                                                                                                                                                                                      |

★ 그리고 `caffeinate -dimsu` 는 **화면 잠금을 막지 못한다** — 화면이 켜져 있으면서
동시에 잠겨 있을 수 있다. §D-2 의 잠금 가설은 그 실험으로 배제된 적이 없다.

---

## B. blocker 가 정말 살아 있는가

### B-1. 실측 — 살아 있다

§A-2 의 `pmset -g assertions` 가 직접 증거다. 20분 59초째 유지 중이었다.

### B-2. `refreshWorkPowerSaveBlocker` 호출 경로 전수

`main.ts` 에서 호출되는 지점: `1526, 3157, 3490, 3533(telegram onLoopActivityChange),
3589(slack onLoopActivityChange), 4337, 11236, 11547, 11551, 11911`.

끄는 조건은 하나뿐이다 — `collectWorkPowerSaveSources()` 가 빈 배열을 돌려줄 때
(`powerSaveMode === "off"` 포함). 소스는 `orchestrator` / `agent` /
`telegram-poller`(`telegramPoller.hasActiveLoops()`) / `slack-socket`.

**텔레그램 채널이 살아 있으면 `hasActiveLoops()` 가 true 이므로 blocker 는 항상 켜진다.**
`stopLoop`/`startLoop` 양쪽에서 `onLoopActivityChange` 를 부르므로 루프 집합이 바뀔 때마다
재평가된다. 즉 "작업 없음 판정으로 꺼져서 재워졌다" 경로는 **이번 증상의 원인이 아니다.**

### B-3. 그래도 코드를 넣은 이유

위 판정은 이번 한 번의 스냅샷 + 코드 독해다. 다음 침묵 때 **로그만 보고** 갈리게 하려면
표본마다 실측값이 있어야 한다. 그래서 `TelegramRouteHealth.powerSaveBlockerActive` 를
추가하고 main 이 `powerSaveBlocker.isStarted(id)` 를 꽂는다(§구현 3).

`null` = "확인 수단이 안 꽂혔다"이지 "꺼져 있었다"가 **아니다.** 모르는 것을 껐다고
적으면 다음 사람이 잘못된 결론을 내린다.

---

## C. App Nap 차단 수단 — dev 와 패키지 앱을 나눠 판정

⚠ §A-3 을 먼저 읽어라. Apple 문서대로면 **assertion 을 들고 있는 동안 이 앱은 이미
App Nap 면제 대상**이라 아래 수단들은 대부분 **잉여**다. 그래도 정리해 두는 이유는
하나뿐이다 — `powerSaveMode === "off"` 이거나 작업 소스가 하나도 없으면 assertion 이
안 걸리고, **그 구간에는 면제가 사라진다.** 아래는 그 구멍을 메우는 용도다.

로컬 실측 (2026-09-04):

| 수단                                                             | dev(`node_modules/.../Electron.app`, id `com.github.Electron`)                                                                                          | 패키지 앱(id `com.marblo.app`)                 |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `LSAppNapIsDisabled` (Info.plist)                                | ❌ 없음. **넣을 수도 없다** — node_modules 파일이라 `npm install` 이 덮고, 레포에 안 들어간다                                                           | ❌ 없었음 → ✅ **이번에 `extendInfo` 로 추가** |
| `NSAppSleepDisabled` (유저 디폴트)                               | ❌ 전역·앱 도메인 모두 없음. `defaults write com.github.Electron NSAppSleepDisabled -bool YES` 로 넣을 수 있으나 **머신의 모든 Electron dev 앱에 영향** | 동일 수단 가능(도메인 `com.marblo.app`)        |
| `NSSupportsAutomaticTermination` / `NSSupportsSuddenTermination` | ❌ 없음                                                                                                                                                 | 이번에 안 건드림 — §C-3                        |
| `NSProcessInfo beginActivityWithOptions:`                        | 네이티브 코드 필요                                                                                                                                      | 네이티브 코드 필요                             |

### C-1. 판정: dev 에서는 코드로 못 막는다 ★

**사장님이 지금 돌리는 것은 dev 빌드다**(실측: pid 82786 이
`.../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`).
따라서 이번에 넣은 `electron-builder.yml` 의 `LSAppNapIsDisabled` 는 **지금 이 증상에
아무 효과가 없다.** 패키지 앱으로 옮겨간 뒤에나 의미가 있다.

dev 에서 지금 당장 시험해 볼 수 있는 유일한 수단은 유저 디폴트다:

```sh
# 되돌리기: defaults delete com.github.Electron NSAppSleepDisabled
defaults write com.github.Electron NSAppSleepDisabled -bool YES
# 그 다음 Electron 을 재시작해야 먹는다 (Foundation 이 프로세스 시작 시 한 번 읽는다)
```

⚠ 이건 사용자 머신 상태를 바꾸고 앱 재시작이 필요하므로 **이 티켓에서 실행하지 않았다.**
(재시작이 곧 사장님의 원격 통로를 끊는다. 실행 판단은 오케/사장님 몫이다.)

### C-2. `LSAppNapIsDisabled` 신뢰도 — 정직하게

널리 쓰이는 키지만 **Apple 공식 문서에 없다.** 게다가 §A-3 대로 assertion 이 걸린
구간에서는 애초에 잉여다. **이번 증상을 고치는 수단으로 넣은 게 아니다** — assertion 이
없는 구간(powerSave off / 작업 소스 없음)을 메우는 방어일 뿐이다. 효과는 검증 안 됐다. 확인 방법: 패키지 앱을 띄운 뒤

```sh
/usr/libexec/PlistBuddy -c "Print :LSAppNapIsDisabled" /Applications/Marblo.app/Contents/Info.plist
```

가 `true` 를 찍고, 그 상태로 화면을 오래 잠갔을 때 저널의 `possibleSuspendGap` 이
안 뜨는지 본다.

### C-3. 안 넣은 것과 이유

- `NSSupportsAutomaticTermination` / `NSSupportsSuddenTermination`: 이건 **종료** 정책이지
  App Nap 스로틀이 아니다. 증상과 무관하고, 잘못 켜면 종료 시 정리 로직을 건너뛸 수 있다.
- `NSProcessInfo beginActivityWithOptions:(NSActivityBackground|NSActivityLatencyCritical)`:
  **공식 API 이고 원리상 가장 정확한 수단**이지만 Electron 에서 쓰려면 네이티브 애드온
  (node-gyp/objc)이 필요하다. 비용: 빌드 파이프라인·서명·노터라이즈에 네이티브 모듈이
  추가되고 arm64 크로스빌드 이슈가 생긴다. 리스크: 유일한 원격 통로를 쥔 앱의 빌드
  체인을 건드린다. **이번 라운드 범위 밖 — 별도 티켓 권고.**
- 별도 `caffeinate` 프로세스: §A-4 대로 **이미 실패가 실측된 수단**이다. 넣지 않았다.
- 서버측 웹훅 전환: getUpdates 롱폴 자체를 없애므로 원리상 가장 강하지만, 공인 HTTPS
  엔드포인트가 필요하고 이 앱은 로컬 데스크톱이다. 별도 설계 필요.

---

## D. 이 맥만 다른 이유

### D-1. 전원 설정 — 특이점 없음

```
$ pmset -g custom
AC Power:  sleep 0, displaysleep 10, powernap 1, lowpowermode 0, hibernatemode 3, tcpkeepalive 1
$ pmset -g batt
Now drawing from 'AC Power'  (79%, AC attached)
$ pmset -g therm
No thermal warning level has been recorded / No CPU power status has been recorded
```

저전력 모드 꺼짐, 열 스로틀 기록 없음, AC 연결. **여기서는 원인이 안 나온다.**

### D-2. ★화면 잠금 — 여기서 나온다

```
$ log show --last 40h --predicate 'process == "loginwindow"
    AND eventMessage CONTAINS "setScreenIsLocked:]_block_invoke"'
2026-09-02 22:06:41  locked=1
2026-09-03 06:16:55  locked=0     (8시간 10분 잠김)
2026-09-03 19:06:21  locked=1
2026-09-04 10:03:35  locked=0     (14시간 57분 잠김)  ★
2026-09-04 10:14:05  locked=1
2026-09-04 11:28:19  locked=0
```

대조:

- 증상 진술 **"12~15시간씩 끊긴다"** ↔ 09-03 19:06 → 09-04 10:03 = **14시간 57분**.
  자릿수가 아니라 값이 맞는다.
- PR #1397 의 야간 완만 오류축적 구간 **09-03 20:07 → 09-04 05:47** 이 저 잠금 창
  **안에 통째로 들어간다.** 오류 시작이 잠금 1시간 뒤다.
- 티켓 본문에 이미 있던 진술 — "맥북프로는 일정 시간 지나면 로그인해야 켜진다,
  맥북에어·맥미니는 그러지 않다" — 와 방향이 맞는다.

★그러나 **대조군이 안 끊기는 이유가 이것으로 설명된다고 쓰면 안 된다.** 같은 티켓
본문에 **맥북에어는 클램셸을 닫고도 멀쩡하다**는 진술이 같이 있고, 뚜껑을 닫으면
화면은 잠긴다. 잠금이 원인이라면 맥북에어가 제일 먼저 끊겨야 하는데 반대다 —
이 모순은 §"미확정" 7번에 그대로 남겨 두었고, 검정 절차는 §E-1 · §E-2 다.

★ 상관은 강하지만 **기전은 모른다.** §A-3 대로 App Nap 은 문서상 배제되므로,
"잠금 → App Nap → 타이머 연기" 라는 사슬은 지금 **쓸 수 없다.** 남는 가능성은
"잠금이 원인이 아니라 동반 현상" 이거나 "잠금이 App Nap 아닌 다른 경로로 작동한다"
이고, 둘 다 지금 데이터로는 못 가린다.

다만 이건 확정이다: `caffeinate -dimsu` 는 **화면 잠금을 막지 못한다.** 따라서 잠금
가설이 그 실험으로 배제된 적은 없다.

### D-3. 반증 데이터 — 같이 남긴다

```
$ log show --last 12h --predicate 'subsystem == "com.apple.runningboard"'
# 메인 Electron 프로세스, 30분 간격 24개 표본 전부:
role=UserInteractiveNonFocal  coalitionLevel=100  flags=60  guaranteedRunning=NO
```

**12시간 내내 role 이 한 번도 안 바뀌었다** — 잠금 구간을 포함해서다. RunningBoard 가
이 프로세스를 강등한 흔적은 **없다.** 이건 두 가지 중 하나를 뜻한다:

1. 서스펜션이 RunningBoard 경로가 아니라 in-process NSAppSleep 경로였다(레거시 AppKit
   앱의 App Nap 은 RunningBoard role 로 안 나타날 수 있다), 또는
2. §D-2 의 상관이 우연이고 15~17분 갭의 진짜 기전은 아직 안 잡혔다.

**이 갈림길은 아직 안 닫혔다.** 그래서 저널에 `screenLocked` 를 넣었다 — 다음 침묵
한 번이면 (1)과 (2)가 갈린다.

### D-4. 배제한 것

`main.ts:1448-1449` 의 `disable-renderer-backgrounding` /
`disable-background-timer-throttling` 은 이미 걸려 있으나 **둘 다 렌더러 전용**이다.
폴러는 main 프로세스 Node 이벤트루프에서 돈다. **무관 — 배제.**

---

## 구현 (조사 결과와 무관하게 방어로 들어간 것)

### 1. 드리프트 회복 — `telegram-poller.ts`

`notePollCompleted` 가 왕복 실측 소요(`lastDurationMs`)를 기록한다. 이 값은 abort
예산 `(longPollSeconds + 10) * 1000` ms 를 **원리상 넘을 수 없다** — 넘었다면 요청이
느렸던 게 아니라 abort 타이머 자체가 제때 안 돈 것이고, 그건 프로세스가 안 돌고
있었다는 뜻이다.

실패 경로의 백오프를 `backoffUnlessSuspended()` 로 바꿨다. 직전 왕복이
`예산 × suspendGraceFactor`(기본 2 → 70초)를 넘겼으면 **백오프를 통째로 건너뛰고
즉시 재폴링한다.** 실측된 실패 모양이 "깨어남 → 1회 시도 → 즉시 실패 → 백오프
sleep → 그 sleep 중에 다시 재워짐" 의 반복이었으므로, 백오프 창이 곧 다시 재워지는
창이다.

폭주하지 않는다: 스킵 조건이 "직전 왕복이 70초 넘게 걸렸다" 이므로 구조적으로
70초에 한 번 이상 돌 수 없다.

### 2. powerMonitor 훅 — `main.ts`

`resume` / `unlock-screen` / `user-did-become-active` → `telegramPoller.notePowerResume()`.

`resume` 만으로는 부족하다 — 시스템이 안 잤으므로 이번 증상에서 `resume` 은
**한 번도 안 불렸다.** `unlock-screen` 이 이 기기에서 실제로 의미 있는 신호다(§D-2).

`notePowerResume` 이 하는 일은 **대기 중인 백오프 sleep 을 끊는 것뿐이다.** offset 을
움직이지 않고, 배달 순서를 바꾸지 않고, 비행 중인 getUpdates 를 건드리지 않는다.
`user-did-become-active` 는 연발로 오므로 5초 스로틀(`resumeNudgeThrottleMs`)을 뒀다 —
없으면 지속적 오류 상황에서 백오프가 연속으로 취소돼 API 를 때린다.

### 3. blocker/잠금 실측 저널화

- `TelegramRouteHealth`: `powerSaveBlockerActive`, `lastPollDurationMs`,
  `suspendedPollRecoveries` 추가.
- `RouteSample`: 위 3개 + `screenLocked` 추가.
- main 이 `powerSaveBlocker.isStarted(id)` 와 lock/unlock 이벤트로 추적한 상태를 꽂는다.

다음 침묵 때 저널 한 줄로 갈리는 것:
`powerSaveBlockerActive=true` + `possibleSuspendGap=true` + `screenLocked=true`
→ 이 문서의 가설 확정.
`powerSaveBlockerActive=false` → 범인은 App Nap 이 아니라 `refreshWorkPowerSaveBlocker`
의 소스 판정이다(§B-2 가 틀렸다는 뜻).
`screenLocked=false` 인데 갭이 나면 → §D-2 상관은 우연이고 다시 열어야 한다.

### 4. 패키지 빌드 App Nap 차단 — `electron-builder.yml`

`mac.extendInfo.LSAppNapIsDisabled: true`. §C-1 대로 **dev 에는 효과 없음.**

---

## 확정 / 미확정

**확정**

1. `prevent-app-suspension` = `kIOPMAssertionTypeNoIdleSleep` 이다. (1차 소스 체인 §A-1
   - 이 기기 `pmset -g assertions` 실측 §A-2)
2. **blocker 는 실제로 걸려 있었다.** "걸었다고 믿었는데 안 걸렸다" 가설 기각(§A-2, §B).
3. Apple 문서상 **IOKit 전원관리 assertion 을 들고 있는 앱은 App Nap 후보가 아니다**
   (§A-3). 1+2 와 합치면 App Nap 은 이번 증상의 설명으로 **약하다.**
4. 시스템 잠자기 아님(pmset 83시간 0건). 뚜껑 닫힘 강제절전도 아님 — 같은 근거이고
   이 기기는 뚜껑이 열려 있었다. (#1398 의 clamshell 가설은 이 근거로 기각된다)
5. `caffeinate -dimsu` 대조 실험은 **무효**다. Electron 이 이미 걸고 있던 것과 같은
   IOPM 계열을 한 겹 더 얹은 것이라 새 정보가 없었고, 화면 잠금은 막지 못한다(§A-5).
6. 이 기기는 화면이 잠기고, 잠금 창(14시간 57분)이 증상 창·#1397 오류 구간과
   통째로 겹친다(§D-2). ★상관이지 인과가 아니다.
7. `disable-renderer-backgrounding` 계열은 렌더러 전용이라 무관하다(§D-4).
8. dev 빌드에는 `LSAppNapIsDisabled` 를 코드로 넣을 수 없다(§C-1).

**미확정 — 확정한 것처럼 쓰지 않는다**

1. ★**15~17분 서스펜션의 기전을 특정하지 못했다.** App Nap 은 문서상 배제되고,
   시스템 잠자기·뚜껑 닫힘은 실측으로 배제된다. 그런데 드리프트는 실측이다.
   §A-4 의 세 갈래(아카이브 문서가 낡음 / assertion 종류가 면제 대상이 아님 /
   제3의 기전) 중 어느 것인지 못 갈랐다.
2. 화면 잠금이 **원인**인지 **동반 현상**인지 안 갈렸다. 자리를 비우면 잠기고, 자리를
   비우면 사용자 활동도 없다 — 두 변수가 붙어 다녀 이 데이터로는 분리가 안 된다.
3. RunningBoard role 이 12시간 내내 `UserInteractiveNonFocal` 로 안 바뀌었다(§D-3).
   OS 가 이 프로세스를 강등한 흔적이 **없다** — 서스펜션 가설 전반에 불리한 데이터다.
4. `LSAppNapIsDisabled` 의 실제 효과는 검증 안 됨. §C-2 대로 이번 증상용이 아니다.
5. 대조군(맥미니·맥북에어)의 잠금 설정을 **직접 읽지 못했다.** 티켓 본문 진술에
   의존했다. 그 두 대에서 §D-2 의 `log show` 한 줄을 떠 오면 훨씬 단단해진다.
6. 넣은 코드가 증상을 실제로 줄이는지는 **아직 모른다.** 유닛 테스트로 동작만
   증명했고, 라이브 재현으로는 확인 못 했다.
7. ★**잠금 가설과 정면으로 모순되는 사실이 하나 있다 — 맥북에어다.**
   맥북에어는 **클램셸(뚜껑 닫힘)로도 인바운드가 안 끊긴다.** 그런데 뚜껑을 닫으면
   화면은 잠긴다. 즉 "화면 잠금 → 프로세스 서스펜션" 이 참이라면 맥북에어가 제일
   먼저 끊겨야 하는데, 반대로 대조군 중 가장 멀쩡하다.

   이 모순을 넘지 못하면 §D-2 의 상관은 인과로 승격할 수 없다. 넘는 길은 셋뿐이고,
   어느 것도 아직 확인 안 됐다:
   - (a) 맥북에어는 실제로는 잠기지 않는다(뚜껑 닫힘 = 잠금 이라는 전제가 틀렸다 —
     "암호 요구까지의 시간" 설정이 길면 닫아도 한동안 안 잠긴다). §D-2 의
     `log show ... setScreenIsLocked` 를 그 기기에서 떠 보면 바로 갈린다.
   - (b) 잠금 자체가 아니라 **잠금과 같이 오는 다른 조건**(예: 외부 디스플레이·전원
     연결 유무, 앱 창의 occlusion 상태)이 실제 변수다. 그러면 잠금은 대리 변수일 뿐
     이고 맥북에어는 그 조건을 안 만족한다.
   - (c) 잠금 가설이 그냥 틀렸고 §D-2 는 우연이다.

   ★**어느 쪽이든, 이 모순을 적어 두지 않고 잠금 가설을 넘기면 안 된다.** 지금 이
   노트의 상관 하나만 보고 "잠금이 원인" 이라고 결론 내리는 것이 이 티켓에서 가장
   저지르기 쉬운 실수다.

## 다음에 할 것 (권고)

### ★E-1. 잠금 가설을 직접 검정하는 실험 (제일 먼저)

§D-2 는 상관까지만이고, 자리비움과 잠금이 붙어 다녀 관측만으로는 못 가른다. **잠금
하나만 끄면** 두 변수가 분리된다 — 자리는 똑같이 비우되 화면은 안 잠기는 상태를 만드는
것이다. 코드도 재시작도 필요 없다.

**끄는 것 (둘 중 하나, 실행 전 현재값을 적어 둘 것)**

```sh
# 현재값 먼저 기록 — 되돌릴 때 쓴다
defaults -currentHost read com.apple.screensaver idleTime
defaults read com.apple.screensaver askForPasswordDelay
```

- 방법 A (권장) — 시스템 설정 → 잠금 화면에서 **"화면 보호기 시작 후 암호 요구"를
  가장 긴 값(또는 사용 안 함)** 으로, **"디스플레이 끄기 후 잠금"도 최장**으로.
- 방법 B — 화면 보호기 자체를 "안 함"으로.

★`caffeinate` 는 **쓰지 마라.** §A-5 대로 그건 잠금 축을 안 건드린다 — 같은 실수를
반복하게 된다.

**두는 시간**: 최소 **8시간**. 증상 창이 12~15시간이고 #1397 실측에서 잠금 1시간 뒤부터
오류가 붙기 시작했으므로, 8시간이면 잠금 구간이었다면 확실히 갭이 났을 길이다.
가능하면 하룻밤(12시간+)이 가장 깨끗하다.

**그동안 지킬 조건** — 한 번에 한 축만 움직여야 한다:

| 축        | 실험 중 값                   | 왜                           |
| --------- | ---------------------------- | ---------------------------- |
| 화면 잠금 | **끔** ← 이것만 바꾼다       | 검정 대상                    |
| 뚜껑      | 열어 둠 (평소와 동일)        | 강제절전 축을 섞지 않는다    |
| 전원      | AC 연결 (평소와 동일)        | 배터리 절전 축을 섞지 않는다 |
| 앱        | dev 빌드 그대로, 재시작 없음 | 원격 통로를 끊지 않는다      |

**무엇으로 판정하나** — `~/.marblo/telegram-route-health.jsonl` 의 그 구간 표본:

| 저널이 말하는 것                                                          | 판정                                                                                    |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `screenLocked=false` 내내 + `possibleSuspendGap` **0건** + `driftMs` 정상 | ★**잠금이 원인이다.** §D-2 상관이 인과로 승격                                           |
| `screenLocked=false` 인데 `possibleSuspendGap=true` 가 여전히 뜬다        | ★**잠금은 원인이 아니다.** §D-2 는 우연 — 후보에서 빼고 §A-4 세 갈래로 돌아간다         |
| `screenLocked` 가 계속 `null`                                             | 실험 무효 — powerMonitor lock/unlock 이 한 번도 안 왔다는 뜻. 이 빌드가 도는지부터 확인 |
| `powerSaveBlockerActive=false` 가 섞여 있다                               | 별건이 하나 더 있다 — blocker 가 풀리는 경로(§B-2)를 따로 판다                          |

판정의 기준선은 `possibleSuspendGap`(driftMs ≥ 3분) 발생 **건수**다. 대조는 이번 실측
구간이다 — 잠긴 밤에 `loop-stalled` 10건 전부가 driftMs 90만~100만 ms 와 겹쳤다.

**되돌리기**: 위에서 기록해 둔 값으로 설정을 복구한다. 판정이 끝나면 바로 되돌린다 —
잠금을 영구히 끄는 것은 보안 결정이지 이 티켓이 정할 일이 아니다.

★이 실험은 §"미확정" 7번(맥북에어 모순)을 **해결하지 못한다.** 잠금이 원인으로 나와도
맥북에어가 왜 멀쩡한지는 따로 답해야 한다. 그래서 E-2 가 같이 필요하다.

### E-2. 대조군 두 대 실측 (E-1 과 병행 가능)

맥미니·맥북에어에서 §D-2 의 한 줄을 뜬다:

```sh
log show --last 40h --style compact \
  --predicate 'process == "loginwindow" AND eventMessage CONTAINS "setScreenIsLocked:]_block_invoke"'
```

- 맥북에어가 **클램셸인데 잠금 기록이 없다** → 미확정 7-(a). 전제가 틀렸던 것이고
  잠금 가설은 살아남는다.
- 맥북에어가 **잠기는데도 안 끊긴다** → 미확정 7-(b)/(c). 잠금 단독으로는 설명 불가.
  이때는 두 기기의 외부 디스플레이·전원·창 occlusion 차이를 다음 축으로 잡는다.

### E-3. 그 다음

1. 이 PR 이 들어간 빌드로 하루 돌리고 저널의 `screenLocked` / `powerSaveBlockerActive` /
   `suspendRecoveries` 를 읽는다. §구현 3 의 분기표대로 갈린다.
2. dev 에서 `defaults write com.github.Electron NSAppSleepDisabled -bool YES` 를 시험할지
   판단(앱 재시작 필요 = 원격 통로 일시 단절).
3. 위로도 안 잡히면 `NSProcessInfo beginActivity` 네이티브 애드온을 별도 티켓으로.
