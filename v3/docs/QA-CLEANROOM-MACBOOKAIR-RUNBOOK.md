# 맥북에어 클린룸 최초실행 런북 — "진짜 신규 유저" 재현

여분 맥북에어를 **아무것도 모르는 신규 유저의 맥**으로 만들어 놓고, Marblo 릴리스
DMG 하나만 설치한 뒤 활성화 퍼널(설치 → 인증 → 폴더 연결 → 첫 티켓 → 오케 스폰)을
끝까지 걸어본다.

자동화(`tests/playwright/cleanroom`, #633)가 대체할 수 없는 것 — **실제 npm 설치
시간, 브라우저 OAuth, 오케 실기동, 가입~첫티켓 실측 시간** — 이 여기 대상이다.
자동화 결과와 장벽 목록(F1~F5)은 [QA-CLEANROOM-FIRST-RUN.md](./QA-CLEANROOM-FIRST-RUN.md)
에 있고, 이 문서는 그 §5(수동 체크리스트)를 **맥북에어 실기 전용**으로 확장한 것이다.

> 이 문서의 모든 경로·명령은 2026-07-28 개발 맥(`dongwonkim`, macOS/Apple Silicon)
> 에서 `which`/`ls`/`npm ls -g`/`security`로 **직접 실측**한 값이다. 맥북에어의
> 설치 형태는 다를 수 있으므로, **STEP 1 을 먼저 돌리고 그 출력에 나온 경로만**
> STEP 2 에서 지운다.

---

## 0. ★먼저 확인 — 어떤 빌드를 설치할 것인가 (이거 틀리면 테스트가 무의미)

이번에 검증하려는 것은 **2026-07-27~28 에 머지된 다섯 건**이다.

| 검증 대상                                   | PR   | 머지일 |
| ------------------------------------------- | ---- | ------ |
| F3 — 첫 티켓 `queued` 오표기 차단           | #635 | 07-27  |
| F4 — ②단계 BYOM(벤더 키) 시작 경로          | #636 | 07-27  |
| F2 — 배너 dismiss 영속화 + 제목=사실 일치   | #637 | 07-27  |
| BYOM 스폰 auth 게이트 교정 + grok 오케 편입 | #638 | 07-27  |
| grok 오케 marblo MCP 실기동                 | #639 | 07-28  |

**공개 릴리스 최신본은 `v3.0.18`(2026-07-21 발행)이라 위 다섯 건이 하나도 안 들어
있다.** 그 DMG 로 테스트하면 F2/F3/F4 는 "여전히 깨져 있음"만 재확인하게 된다.

그래서 시작 전에 둘 중 하나를 확정한다.

- **(A) 새 릴리스를 먼저 발행한다** — `main`(#639 포함)에서 빌드해
  `melocream/marblo-releases` 에 `v3.0.19` 이상으로 올린 뒤 그 DMG 를 쓴다.
  맥북에어 입장에서 완전한 신규 유저 경로(다운로드 → 설치)가 그대로 재현된다. **권장.**
- **(B) 이 맥에서 서명·공증한 DMG 를 만들어 맥북에어로 옮긴다** —
  [signing_runbook.md](./signing_runbook.md) / `marblo_local_build_runbook`.
  릴리스 발행 없이 검증만 하고 싶을 때. 단 "다운로드 경로" 자체는 재현되지 않는다.

> 서명·공증 안 된 임시 빌드를 옮기는 것은 하지 말 것. Gatekeeper 우회 절차가
> 신규 유저 경로에 없는 단계를 끼워 넣어 측정을 오염시킨다.

설치 직전에 버전을 확인한다:

```bash
# DMG 파일명에 박힌 버전이 3.0.19 이상(또는 (B)로 만든 로컬 빌드)인지 눈으로 확인
ls -l ~/Downloads/Marblo-*.dmg
```

---

## 1. 사전 준비 (맥북에어에서 5분)

체크할 것:

- [ ] macOS 최신 상태 (Apple Silicon — 우리 DMG 는 `arm64` 전용)
- [ ] 인터넷 연결
- [ ] **테스트에 쓸 계정 3종을 미리 준비** — 어느 경로를 걸을지에 따라 다르다
  - 경로 A(CLI 계정): Anthropic(Claude) 또는 OpenAI(Codex) 로그인 계정
  - 경로 B(BYOM 벤더 키): Z.ai / MiniMax / Moonshot(Kimi) 중 **하나의 구독 키**
  - 공통: Marblo 로그인용 Google 계정 또는 이메일
- [ ] Node.js/npm 이 **있는지 없는지 의도적으로 정한다**
  - 있음 → ①단계 자동설치가 실제로 도는 경로를 본다
  - 없음 → 자동설치 실패 안내(B 시나리오)를 본다. 신규 유저 다수가 여기다
- [ ] 스톱워치(핸드폰) — 각 단계 소요시간을 적는다

---

## 2. STEP 1 — 기존 CLI 설치 여부 확인 (읽기 전용, 아무것도 안 지운다)

맥북에어 터미널에 **통째로 복붙**한다. 지우는 명령이 하나도 없다.

```bash
#!/usr/bin/env bash
# Marblo 클린룸 사전점검 — 읽기 전용. 아무 파일도 지우거나 바꾸지 않습니다.
echo "════ 1) PATH 에 잡히는 바이너리 ════"
for b in claude codex grok agy node npm; do
  p=$(command -v "$b" 2>/dev/null)
  if [ -n "$p" ]; then
    printf "  %-6s → %s\n" "$b" "$p"
    # 심볼릭 링크면 실제 대상까지
    [ -L "$p" ] && printf "  %-6s   ↳ %s\n" "" "$(readlink "$p")"
  else
    printf "  %-6s → (없음)\n" "$b"
  fi
done

echo
echo "════ 2) 같은 이름이 여러 곳에 깔려 있나 (중요) ════"
for b in claude codex grok agy; do
  hits=$(type -a "$b" 2>/dev/null | wc -l | tr -d ' ')
  printf "  %-6s : %s 곳\n" "$b" "$hits"
done

echo
echo "════ 3) 홈 디렉터리 상태·설정 폴더 ════"
for d in "$HOME/.claude" "$HOME/.claude.json" "$HOME/.codex" "$HOME/.grok" \
         "$HOME/.gemini" "$HOME/.antigravity-ide" \
         "$HOME/.local/share/claude" "$HOME/.local/state/claude"; do
  if [ -e "$d" ]; then
    printf "  존재  %-34s %s\n" "$d" "$(du -sh "$d" 2>/dev/null | cut -f1)"
  else
    printf "  없음  %s\n" "$d"
  fi
done

echo
echo "════ 4) 인증 상태 (★값은 출력하지 않습니다 — 존재 여부만) ════"
if security find-generic-password -s "Claude Code-credentials" >/dev/null 2>&1; then
  echo "  claude : 로그인됨 (macOS 키체인 항목 'Claude Code-credentials' 존재)"
else
  echo "  claude : 로그아웃 (키체인 항목 없음)"
fi
[ -f "$HOME/.codex/auth.json" ] \
  && echo "  codex  : 로그인됨 (~/.codex/auth.json 존재)" \
  || echo "  codex  : 로그아웃"
[ -f "$HOME/.grok/auth.json" ] \
  && echo "  grok   : 로그인됨 (~/.grok/auth.json 존재)" \
  || echo "  grok   : 로그아웃"

echo
echo "════ 5) npm 전역 패키지 ════"
npm ls -g --depth=0 2>/dev/null | grep -Ei 'claude-code|codex|grok' || echo "  (해당 없음)"

echo
echo "════ 6) Homebrew ════"
{ brew list --formula 2>/dev/null; brew list --cask 2>/dev/null; } \
  | grep -Ei 'claude|codex|grok' || echo "  (해당 없음)"

echo
echo "════ 7) Marblo 앱 데이터 (이전 설치 흔적) ════"
ls -d "$HOME/Library/Application Support/"*[Mm]arblo* 2>/dev/null || echo "  (없음)"
ls -d "$HOME/Library/Logs/"*[Mm]arblo* 2>/dev/null
ls -d "/Applications/Marblo.app" 2>/dev/null || echo "  /Applications/Marblo.app (없음)"

echo
echo "════ 8) shell rc 의 PATH 개입 줄 ════"
grep -nE '\.local/bin|\.grok/bin|antigravity|npm-global' "$HOME/.zshrc" "$HOME/.zprofile" \
  "$HOME/.bash_profile" 2>/dev/null || echo "  (없음)"

echo
echo "완료 — 위 출력을 그대로 남겨두세요. STEP 2 는 여기 나온 경로만 지웁니다."
```

**판정**

| STEP 1 결과              | 다음 행동                                      |
| ------------------------ | ---------------------------------------------- |
| 1·3·5·6·7 이 전부 "없음" | 이미 클린룸이다. **STEP 2 를 건너뛰고 STEP 3** |
| 하나라도 존재            | STEP 2 로 (또는 §2-A 새 계정 방식)             |

### 참고 — 개발 맥 실측값 (2026-07-28)

맥북에어가 아니라 **이 개발 맥**에서 나온 값이다. 제거 명령이 왜 저 모양인지의 근거.

| 항목        | 실측                                                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| claude (1)  | `~/.local/bin/claude` → `~/.local/share/claude/versions/2.1.220` (네이티브 설치, 733M)                                                     |
| claude (2)  | `/opt/homebrew/bin/claude` → `../lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe` (npm 전역 `@anthropic-ai/claude-code@2.1.177`) |
| codex       | `/opt/homebrew/bin/codex` → `../lib/node_modules/@openai/codex/bin/codex.js` (npm 전역 `@openai/codex@0.145.0`)                            |
| grok        | `~/.local/bin/grok` → `~/.grok/bin/grok` → `~/.grok/downloads/grok-macos-aarch64` (자체 인스톨러)                                          |
| agy         | `~/.local/bin/agy` (실파일 160M, 심볼릭 링크 아님)                                                                                         |
| dot-dir     | `~/.claude` 1.8G · `~/.codex` 149M · `~/.grok` 148M · `~/.gemini` 715M                                                                     |
| 인증 저장소 | claude=**키체인** `Claude Code-credentials` / codex=`~/.codex/auth.json` / grok=`~/.grok/auth.json`                                        |
| PATH 개입   | `~/.zshrc:121` `~/.local/bin` · `:124` `~/.antigravity-ide/...` · `:133` `$HOME/.grok/bin` (+ `~/.zprofile:26`·`~/.bash_profile:27`)       |
| 앱 userData | `~/Library/Application Support/**marblo-v3**` — 패키지 앱 `/Applications/Marblo.app` 기준 실측(`Marblo` 아님)                              |

> ★`claude` 가 **두 군데** 깔려 있었다(네이티브 + npm 전역). 하나만 지우면
> `command -v claude` 가 여전히 잡히고 "CLI 미설치" 상태가 안 만들어진다.
> STEP 1 의 §2("같은 이름이 여러 곳에")를 반드시 확인할 것.

---

## 3. STEP 2 — 제거 가이드 (★비가역)

> # ⚠️ 경고 — 여기부터는 되돌릴 수 없습니다
>
> - `~/.claude` · `~/.codex` · `~/.grok` 에는 **모든 대화 세션·히스토리·스킬·
>   플러그인·설정**이 들어 있다. 지우면 복구 수단이 없다(휴지통 아님, `rm -rf`).
> - 이 맥에서 실측한 크기는 각각 1.8G / 149M / 148M 이었다 — 그만큼의 작업 기록이다.
> - 맥북에어에 **남길 것이 하나라도 있으면 §3-A(새 사용자 계정) 를 쓰라.** 지우지
>   않고도 완벽한 클린룸이 만들어진다.
> - 명령을 통째로 복붙하지 말고 **STEP 1 출력에 실제로 존재한 항목만** 실행한다.
>   존재하지 않는 경로를 지우는 명령은 무해하지만, 실측하지 않은 경로를 추가로
>   지우는 것은 하지 말 것.

### 3-A. ★권장 — 아무것도 안 지우는 방법: 새 macOS 사용자 계정

**이 방법이 가장 정확하고 유일하게 가역적이다.** `~/.claude`·PATH·앱 userData·
키체인이 전부 사용자 계정별로 격리되므로, 새 계정에서 로그인하면 그 자체로
"공장 초기화된 맥"이다. 테스트가 끝나면 계정을 통째로 삭제하면 끝.

1. 시스템 설정 › 사용자 및 그룹 › **사용자 추가** (예: `marblotest`, 관리자 아님이면 더 좋다)
2. 로그아웃 → 새 계정으로 로그인
3. 새 계정 터미널에서 **STEP 1 스크립트를 다시 돌린다** — 전부 "없음" 이어야 한다
   - ⚠️ `/opt/homebrew/bin` 은 **계정 공유**다. 기존 계정이 npm 전역으로 claude/codex 를
     깔아 뒀다면 새 계정에서도 잡힌다. 그때만 §3-B 의 npm 제거를 쓰거나, 이 사실을
     기록하고 진행한다(자동설치 경로만 못 보게 된다)
4. STEP 3 으로

### 3-B. 진짜로 지워야 할 때 — 3단계 (약한 것부터)

#### Level 1 — 인증만 해제 (★가역. 다시 로그인하면 복구됨)

퍼널의 ②단계(인증)만 신규 유저로 만들고 싶을 때. **이것부터 시도하라.**

```bash
claude auth logout     # 키체인 'Claude Code-credentials' 항목 제거
codex logout           # ~/.codex/auth.json 제거
grok logout            # ~/.grok/auth.json 제거
```

세 명령 모두 각 CLI 가 **공식 제공**하는 서브커맨드다(이 맥에서 `--help` 로 실측:
`claude auth logout` / `codex logout` "Remove stored authentication credentials" /
`grok logout` "Sign out and clear cached credentials"). 파일을 직접 지우는 것보다
안전하다.

확인:

```bash
security find-generic-password -s "Claude Code-credentials" >/dev/null 2>&1 \
  && echo "claude 아직 로그인됨" || echo "claude 로그아웃 확인"
ls ~/.codex/auth.json ~/.grok/auth.json 2>&1
```

> 키체인 항목이 남아 있으면 (그리고 `claude auth logout` 이 안 먹으면) 아래로 지운다.
> **★비가역** — 실행 시 키체인 암호 확인 창이 뜰 수 있다.
>
> ```bash
> security delete-generic-password -s "Claude Code-credentials"
> ```

#### Level 2 — 설정·세션 폴더 제거 (★비가역)

"완전 신규 유저의 홈"을 만든다. 세션·히스토리·스킬·MCP 설정이 전부 사라진다.

```bash
# ⚠️ 되돌릴 수 없음. 남길 게 있으면 먼저 백업:
#    tar czf ~/Desktop/cli-backup-$(date +%Y%m%d).tgz -C "$HOME" .claude .codex .grok

rm -rf ~/.claude ~/.claude.json          # Claude Code (설정·세션·스킬·플러그인)
rm -rf ~/.codex                          # Codex (설정·세션·goals/memories sqlite)
rm -rf ~/.grok                           # Grok (설정·세션·trusted_folders·worktrees.db)
```

Marblo 앱 자신의 상태도 함께 지운다(온보딩 dismissed·언어·동의·프로젝트 목록이
여기 산다 — **F2 검증에 필수**):

```bash
# ★STEP 1 §7 이 출력한 경로만 지운다. 이 맥에서 패키지 앱(/Applications/Marblo.app)
#   이 실제로 쓰던 것은 `marblo-v3` 였다(`Marblo` 가 아니다 — 짐작하지 말고 §7 을 볼 것).
rm -rf ~/Library/Application\ Support/marblo-v3
rm -rf ~/Library/Application\ Support/Marblo 2>/dev/null
rm -rf ~/Library/Logs/Marblo ~/Library/Logs/marblo-v3 2>/dev/null
```

> ★맥북에어가 정말 신품/미사용이면 이 경로들은 애초에 없다. 있다면 이전 설치
> 흔적이므로 지워야 "첫 실행" 이 성립한다.

#### Level 3 — 바이너리 제거 (★비가역, 설치 관리자별로 다름)

**STEP 1 §1·§2·§5·§6 출력에서 실제로 나온 형태만** 골라 실행한다.

**claude — 설치 경로가 두 가지다. 둘 다 확인할 것.**

```bash
# (a) 네이티브 설치 (~/.local/bin/claude → ~/.local/share/claude/versions/N)
rm -f  ~/.local/bin/claude
rm -rf ~/.local/share/claude ~/.local/state/claude

# (b) npm 전역 설치 (/opt/homebrew/bin/claude → .../node_modules/@anthropic-ai/claude-code)
npm uninstall -g @anthropic-ai/claude-code
```

> `claude` 에는 `uninstall` 서브커맨드가 **없다**(이 맥에서 `claude --help` 실측 —
> `install`/`update` 만 있다). 위 두 방법이 공식 제거 수단이다.

**codex — npm 전역**

```bash
npm uninstall -g @openai/codex
```

**grok — 자체 인스톨러(npm/brew 아님)**

```bash
rm -f  ~/.local/bin/grok ~/.local/bin/agent   # ★'agent' 도 grok 인스톨러가 만든 링크다
rm -rf ~/.grok                                # 바이너리 실체가 ~/.grok/downloads 안에 있다
```

그리고 인스톨러가 `~/.zshrc` 에 넣은 블록을 손으로 지운다(이 맥의 `~/.zshrc:133~135`):

```bash
# >>> grok installer >>>
export PATH="$HOME/.grok/bin:$PATH"
fpath=(~/.grok/completions/zsh $fpath)
```

**agy(Antigravity) — 지울지 말지 판단 필요**

Marblo 는 agy 도 1st-class 하네스로 취급한다. **퍼널 검증에는 없어도 되고**,
있으면 ②단계가 agy 인증만으로 통과될 수 있어 측정이 흐려진다. 지우려면:

```bash
rm -f  ~/.local/bin/agy       # 실파일 160M (심볼릭 링크 아님)
rm -rf ~/.gemini/antigravity-cli
```

> `~/.gemini` **전체**(이 맥에서 715M)는 Gemini CLI 등 다른 것도 쓰는 폴더다.
> agy 만 빼려면 위처럼 `antigravity-cli` 하위만 지운다.

#### Level 3 이후 검증 — "정말 없어졌나"

```bash
hash -r 2>/dev/null; rehash 2>/dev/null   # 셸 캐시 비우기 (안 하면 유령 히트)
exec $SHELL -l                            # 또는 터미널 새 창
```

그 뒤 **STEP 1 스크립트를 다시 돌려** §1~§6 이 전부 "없음" 인지 확인한다.

> ★한 가지 알려진 함정(F1): Marblo 앱의 CLI 탐지는 셸 PATH 와 **무관하게**
> `/opt/homebrew/bin`·`/usr/local/bin`·`~/.local/bin`·`~/.bun/bin` 등을 하드코딩으로
> 덧붙여 찾는다(`harness-manager.getEnrichedPathForDetection`). 즉 `.zshrc` 에서
> PATH 만 뺀 것으로는 앱이 "미설치"로 보지 않는다 — **파일 자체를 지워야 한다.**

---

## 4. STEP 3 — Marblo 릴리스 DMG 설치 (이것만 설치)

1. 맥북에어 Safari 에서 https://github.com/melocream/marblo-releases/releases/latest
2. `Marblo-<버전>-arm64.dmg` 다운로드 (§0 에서 정한 버전인지 확인)
3. DMG 열고 `Marblo.app` 을 `Applications` 로 드래그
4. DMG 추출(eject) 후 **Applications 에서 실행**

체크:

- [ ] Gatekeeper 경고 없이 열리는가? (서명·공증된 빌드면 "인터넷에서 받은 앱"
      1회 확인 정도만 떠야 한다. **우클릭 › 열기가 필요했다면 그 사실을 기록** —
      신규 유저 이탈 지점이다)
- [ ] 다운로드~첫 화면까지 몇 초/분?

**이 단계에서 CLI 를 미리 깔지 말 것.** ①단계 자동설치가 도는지를 보는 것이 목적이다.

---

## 5. STEP 4 — 활성화 퍼널 체크리스트

각 항목 옆 `[  ]` 에 **경과시간(mm:ss)** 과 결과를 적는다. 스톱워치는 앱 첫 실행에서 시작.

### ① 첫 실행 → 로그인 → 시작하기 착지

| #   | 확인                                                    | 기대                                               | 결과 |
| --- | ------------------------------------------------------- | -------------------------------------------------- | ---- |
| 1-1 | 언어 선택 화면이 뜨는가                                 | 뜬다                                               |      |
| 1-2 | 로그인(Google 또는 이메일) 성공하는가                   | 성공                                               |      |
| 1-3 | 개인정보 동의 모달이 **언어 선택 뒤 몇 초** 만에 뜨는가 | ★**F5**: 4~5초 시차면 재현. 그 사이 클릭 막힘 기록 |      |
| 1-4 | 로그인 후 **"시작하기" 탭**에 착지하는가 (모달 아님)    | 착지                                               |      |
| 1-5 | 4스텝(①설치 ②인증 ③폴더 ④첫티켓)이 전부 "남음" 인가     | 전부 남음                                          |      |

### ② ①단계 — CLI 자동설치

| #   | 확인                                                                     | 기대                             | 결과 |
| --- | ------------------------------------------------------------------------ | -------------------------------- | ---- |
| 2-1 | **클릭 없이** 자동설치가 시작되는가                                      | 시작                             |      |
| 2-2 | (node/npm 있는 계정) 설치 완료까지 몇 분                                 | 실측 기록                        |      |
| 2-3 | (node/npm 없는 계정) 실패 안내 + **수동 명령 + 공식 문서 링크**가 뜨는가 | 뜬다 (시나리오 B)                |      |
| 2-4 | 설치된 CLI 가 뭐라고 표시되는가                                          | claude/codex 필수, grok/agy 권장 |      |

### ③ ②단계 — 인증. **여기서 경로 A / 경로 B 중 하나를 고른다**

두 경로 모두 걸어보는 것이 이상적이다(경로 B → 앱 데이터 초기화 → 경로 A 재실행).

#### 경로 A — CLI 계정 연결 (기존 경로)

| #    | 확인                                                              | 기대        | 결과 |
| ---- | ----------------------------------------------------------------- | ----------- | ---- |
| 3A-1 | "인증 실행" → 브라우저 OAuth 가 열리는가                          | 열림        |      |
| 3A-2 | OAuth 완료 후 **자동 재확인**으로 ✅ 로 바뀌는가 (앱 재시작 없이) | 바뀜        |      |
| 3A-3 | Claude / Codex 중 **하나만** 인증해도 ②가 통과되는가              | 통과 (#579) |      |
| 3A-4 | 총 소요 시간                                                      | 실측        |      |

#### 경로 B — ★BYOM 벤더 키 (#636 신규 — F4 검증)

| #    | 확인                                                                                                                                     | 기대                                                       | 결과 |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ---- |
| 3B-1 | ②단계에 **"계정이 없나요? 벤더 키로 시작하기"** 접힘 섹션이 보이는가                                                                     | ★보인다 = F4 닫힘. 안 보이면 **F4 미해결** 또는 구버전 DMG |      |
| 3B-2 | 펼치면 벤더 카드(GLM/MiniMax/Kimi/Grok …)와 "n/m 준비됨" 배지가 보이는가                                                                 | 보인다                                                     |      |
| 3B-3 | 카드에서 **설정 › 벤더 API 키** 로 딥링크 이동되는가                                                                                     | 이동                                                       |      |
| 3B-4 | 키를 등록한다 (`ZAI_API_KEY` / `MINIMAX_API_KEY` / `KIMI_API_KEY` 중 하나)                                                               | 저장됨. **부분 등록은 차단**돼야 한다(전부-아니면-전무)    |      |
| 3B-5 | "등록 상태 다시 확인" → 카드가 **활성**으로 바뀌는가                                                                                     | 바뀜                                                       |      |
| 3B-6 | 카드 밑 문구가 **정직한가** — 오케까지 되는 벤더는 "✓ 이 벤더로 오케스트레이터까지 띄울 수 있습니다", 워커 전용이면 "작업 에이전트 전용" | ★워커 전용인데 ②를 통과시키면 **버그**(④에서 다시 막힘)    |      |
| 3B-7 | 등록한 벤더로 **실제 에이전트 스폰**이 되는가 (보드에서 dispatch)                                                                        | 스폰됨 (#638 스폰 게이트)                                  |      |

> **오늘의 사실(실측)**: 오케스트레이터 선택 UI(설정 › 오케스트레이터 모델 /
> 오케 패널 드롭다운)에는 **Claude 와 Codex 만** 있다. env-swap 벤더(GLM/MiniMax/
> Kimi)는 설계상 오케 후보가 아니다(오케 선택은 프로젝트별 영구 저장이라 조건부
> 크레덴셜을 얹지 않는다는 확정 결정). 따라서 **경로 B 만으로는 ③④단계를 넘길 수
> 없는 것이 정상**이고, 3B-6 의 문구가 그 사실을 말해주는지가 검증 포인트다.

### ④ ③단계 — 폴더 연결 → 오케스트레이터 기동

| #   | 확인                                                      | 기대      | 결과 |
| --- | --------------------------------------------------------- | --------- | ---- |
| 4-1 | 폴더 연결 → 프로젝트가 자동 등록되는가                    | 등록      |      |
| 4-2 | **오케스트레이터가 실제로 뜨는가** (상태 `running`)       | 뜬다      |      |
| 4-3 | 오케 터미널에 CLI 가 붙고 프롬프트가 보이는가             | 보인다    |      |
| 4-4 | 인증이 덜 됐다면 여기서 막히고 ②로 되돌리는 안내가 있는가 | 안내 있음 |      |

### ⑤ ④단계 — 첫 티켓 (★F3 검증 — 아하 모먼트)

**세 가지 상태를 모두 눌러본다.** 문구가 상태마다 달라야 한다.

| #   | 상황                                                        | 기대 문구 / 동작                                                                                                                                             | 결과 |
| --- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- |
| 5-1 | 폴더 미연결 상태에서 버튼                                   | 버튼 **비활성** + "먼저 폴더를 연결해 주세요(③ 단계)"                                                                                                        |      |
| 5-2 | **오케 running** 상태에서 "이 PRD로 첫 티켓 만들기"         | 🟢 "첫 프롬프트를 전달했어요 — 오케스트레이터가 첫 티켓을 준비합니다." + **오케 터미널에 프롬프트가 실제로 들어감** + 단계 완료 처리                         |      |
| 5-3 | ★**오케를 일부러 끈 뒤** 같은 버튼                          | 🟡 "**아직 전달되지 않았어요** — 대기열에 넣어만 뒀습니다…" + "오케스트레이터를 띄워야 첫 티켓이 실제로 만들어집니다" 3단계 안내 + **단계가 완료로 안 찍힘** |      |
| 5-4 | 5-3 상태에서 마법사/시작하기 탭이 **닫히지 않는가**         | 안 닫힘 (돌아올 길이 남아야 한다)                                                                                                                            |      |
| 5-5 | 5-3 뒤 오케를 켜고 버튼 재클릭 → 5-2 결과가 되는가          | 됨                                                                                                                                                           |      |
| 5-6 | 보드에 티켓이 실제로 생기고 **에이전트 스폰 제안**이 오는가 | 온다                                                                                                                                                         |      |

> **판정**: 5-3 에서 초록색 "전달했어요"가 뜨면 **F3 미해결**(또는 구버전 DMG).
> 노란색 + 오케 기동 안내가 뜨면 **F3 닫힘 확인**.

### ⑥ F2 검증 — 재시작해도 배너가 안 돌아오는가

| #   | 상황                                                                      | 기대                                                                     | 결과 |
| --- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ---- |
| 6-1 | **인증 완료 + 폴더 미연결** 상태에서 배너 제목                            | ★"**작업할 폴더를 연결해 주세요**" (예전의 "CLI 인증이 필요합니다" 아님) |      |
| 6-2 | 배너 ✕ 로 닫는다 → **앱 완전 종료 후 재실행**                             | 배너가 **다시 안 뜬다**                                                  |      |
| 6-3 | 폴더 연결 후 재시작                                                       | 배너 없음 / 제목이 다음 단계(첫 티켓)를 가리킴                           |      |
| 6-4 | (대조) 시작하기 탭 › "앱을 켤 때 이 탭으로 시작하기" 를 켜면 되돌아오는가 | 되돌아옴                                                                 |      |

> 6-2 에서 배너가 다시 뜨면 **F2 미해결**(또는 구버전 DMG).

### ⑦ ★그록(Grok) 오케스트레이터 검증 (#638 · #639)

> **먼저 알아둘 실측 사실**: `grok` 을 오케스트레이터로 **고르는 UI 가 아직 없다.**
> 설정 › 오케스트레이터 모델과 오케 패널 드롭다운은 둘 다 Claude/Codex 만 나열한다
> (`SettingsPage.ORCHESTRATOR_MODELS`, `orchestratorStore.ORCHESTRATOR_MODEL_OPTIONS`).
> 메인 프로세스 쪽 정규화·게이트에는 grok 이 편입됐다
> (`model-selection.ORCHESTRATOR_HARNESS_SETTINGS = [claude, codex, grok, antigravity]`).
> 즉 **현재 유일한 진입로는 env** 다. 이건 신규 유저가 걸을 수 있는 길이 아니므로
> **F6(신규)** 으로 기록하고, 아래는 "기능이 사는지" 확인하는 개발자 검증이다.

준비: `grok` CLI 설치 + `grok login`(브라우저 SuperGrok/X 인증).

```bash
# 앱을 종료한 뒤, 터미널에서 env 를 주고 실행
open -a Marblo --env MARBLO_ORCHESTRATOR_MODEL=grok
# (위가 안 먹으면)
MARBLO_ORCHESTRATOR_MODEL=grok /Applications/Marblo.app/Contents/MacOS/Marblo
```

| #   | 확인                                                                                  | 기대                                                    | 결과 |
| --- | ------------------------------------------------------------------------------------- | ------------------------------------------------------- | ---- |
| 7-1 | 오케 패널 모델 표시가 "기타(env)" 또는 grok 으로 뜨는가                               | 뜬다                                                    |      |
| 7-2 | 오케가 `running` 이 되는가 (`-m` 같은 argv 오류 없이)                                 | 뜬다 (#616/#617 + command 필드 회귀)                    |      |
| 7-3 | ★**marblo MCP 툴이 0개가 아닌가** — 오케에게 "사용 가능한 marblo 툴 목록" 을 물어본다 | `get_all_tasks`/`dispatch_task` 등이 보인다 (#639 핵심) |      |
| 7-4 | 오케가 실제로 **보드 티켓을 만들고** `dispatch_task` 로 에이전트를 스폰하는가         | 스폰됨                                                  |      |
| 7-5 | 폴더 신뢰 실패 증상이 없는가 — 터미널에서 확인                                        | 아래 명령이 `✓`                                         |      |

```bash
# grok 이 marblo MCP 를 실제로 붙였는지 (격리 GROK_HOME 기준)
grok mcp doctor marblo
#   ✗ folder untrusted (repo-local server not started) → #639 회귀
```

### ⑧ 총계

| 항목                                | 목표     | 실측 |
| ----------------------------------- | -------- | ---- |
| 앱 첫 실행 → 로그인 완료            | < 2분    |      |
| 로그인 → ②인증 완료                 | < 10분   |      |
| ②인증 → ③폴더 연결 + 오케 기동      | < 5분    |      |
| **가입 → 첫 티켓 실제 생성 (전체)** | **30분** |      |
| 중간에 "뭘 해야 할지 모르겠다" 순간 | 0회      |      |

---

## 6. 결과 기록 양식 (그대로 복사해서 채우기)

```
■ 환경
  - 맥북에어 macOS:
  - 클린룸 방식: [새 사용자 계정 / Level 1 / Level 2 / Level 3]
  - 설치한 DMG: Marblo-______-arm64.dmg  (§0 게이트 통과: Y/N)
  - node/npm: [있음 / 없음]
  - 걸은 경로: [A(CLI 계정) / B(BYOM 벤더 키) / 둘 다]

■ 장벽 판정
  F2 (배너 재노출)        : [닫힘 / 재현 / 미검증]   근거: 6-2 결과
  F3 (queued 오표기)      : [닫힘 / 재현 / 미검증]   근거: 5-3 문구
  F4 (BYOM 경로 부재)     : [닫힘 / 재현 / 미검증]   근거: 3B-1 존재 여부
  F5 (모달 2겹 시차)      : [재현 / 없음]            근거: 1-3 초
  F6 (grok 오케 UI 부재)  : [재현 / 없음]            근거: ⑦ 서문
  BYOM 스폰 (#638)        : [통과 / 실패]            근거: 3B-7
  grok 오케 MCP (#639)    : [통과 / 실패]            근거: 7-3 / 7-5

■ 실측 시간
  가입 → 첫 티켓: ____분

■ 새로 발견한 이탈 지점 (있는 만큼)
  1. [심각도] 무슨 화면에서 / 뭘 기대했는데 / 뭐가 나왔나 / 스크린샷 파일명
```

스크린샷은 **막힌 화면 그 자체**를 찍는다(⌘⇧4). 특히: 1-3 의 두 모달 사이,
3B-1 의 ②단계 전체, 5-3 의 결과 문구, 6-1 의 배너 제목, 7-3 의 오케 응답.

---

## 7. 테스트 후 — 이 맥/맥북에어 원상복구

새 사용자 계정 방식(§3-A)이면 **계정 삭제로 끝**이다.

Level 2/3 로 지웠다면 재설치:

```bash
# claude (Marblo 자동설치와 같은 경로 = npm 전역)
npm install -g @anthropic-ai/claude-code
claude auth login
#   네이티브 빌드(~/.local/share/claude)로 되돌리려면, 위로 claude 를 살린 뒤:
#     claude install stable

# codex
npm install -g @openai/codex
codex login
codex features enable goals     # Marblo 가 설치 시 자동으로 하는 것과 동일

# grok
curl -fsSL https://x.ai/cli/install.sh | sh
grok login

# agy (Antigravity)
curl -fsSL https://antigravity.google/cli/install.sh | bash
agy                             # 첫 실행 시 OAuth
```

> 설치 URL 은 Marblo 의 `electron/harness-catalog.ts` 가 자동설치에 쓰는 것과 같은
> 소스다. 세션/히스토리(`~/.claude` 등)는 **복구되지 않는다** — Level 2 전에 백업을
> 떴다면 `tar xzf ~/Desktop/cli-backup-*.tgz -C "$HOME"` 로 되돌린다.

---

## 8. 관련 문서

- [QA-CLEANROOM-FIRST-RUN.md](./QA-CLEANROOM-FIRST-RUN.md) — 자동화 E2E(#633)와 장벽 F1~F5 원문
- [signing_runbook.md](./signing_runbook.md) — 로컬 서명·공증 DMG 빌드(§0 (B) 경로)
- [VENDOR-MODEL-USAGE-GUIDE.md](./VENDOR-MODEL-USAGE-GUIDE.md) — BYOM 벤더별 키·모델
- `v3/tests/playwright/cleanroom/` — 격리 하네스(userData/HOME/PATH + main IPC 스텁)
