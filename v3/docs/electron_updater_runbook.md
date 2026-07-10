# Marblo electron-updater Runbook

운영자가 데스크탑 앱 릴리스 / 핫픽스 배포 시 따를 절차.

마지막 점검: 2026-07-10 KST. GitHub 릴리스(피드) repo는 `melocream/marblo-releases`로 확정.

---

## 0. 사전 점검

- [ ] 런타임 update feed: `v3/electron/updater.ts` 기본값은 `melocream/marblo-releases`, channel은 `latest` (publish 대상과 일치. private 소스 repo는 익명 Release API가 404라 공개 유저 앱이 영원히 업데이트를 못 받음)
- [ ] override가 필요한 리허설만 `MARBLO_UPDATER_OWNER`, `MARBLO_UPDATER_REPO`, `MARBLO_UPDATER_CHANNEL` 사용
- [ ] `v3/electron-builder.yml`의 `publish.provider: github` 확인
- [ ] GitHub Release 업로드 권한이 있는 PAT를 로컬 `GH_TOKEN`에 설정
- [ ] public 사용자 업데이트에는 private GitHub Release를 쓰지 않는다. private feed 테스트가 필요할 때만 `MARBLO_UPDATER_PRIVATE=true`와 토큰을 로컬에서 사용
- [ ] macOS 공증: `v3/scripts/notarize.js`에 Apple Developer 계정 + app-specific password 설정
- [ ] Windows 서명: `v3/electron-builder.yml`의 `win.certificateFile` 또는 CI signing secret 확인

현재 repo URL 주의:

- worktree origin: `https://github.com/melocream/marblo.git` (실제 소스 코드 repo, private)
- 런타임 updater feed: `melocream/marblo-releases` (PUBLIC. electron-builder.yml `publish` 대상과 동일)
- 소스 repo와 릴리스(피드) repo가 다른 이유: 소스 repo는 private라 익명 사용자에게 Release 자산이 404. electron-updater가 익명 다운로드를 하려면 피드가 PUBLIC repo여야 한다.
- `v3/package.json`의 `repository.url`은 updater feed 결정에 의존하지 않는다. repo 이전 시 `updater.ts` 기본값과 CI Release 대상 repo를 함께 바꾼다.

## 1. GitHub Release 피드 검증

```bash
REPO=melocream/marblo-releases

gh repo view "$REPO" --json nameWithOwner,visibility,defaultBranchRef
gh release list --repo "$REPO" --limit 10
gh release view --repo "$REPO" --json tagName,name,isDraft,isPrerelease,publishedAt,assets

rm -rf /tmp/marblo-updater-feed
mkdir -p /tmp/marblo-updater-feed
gh release download --repo "$REPO" --pattern "latest*.yml" --dir /tmp/marblo-updater-feed
grep -R -E "^(version|path|sha512|url):" /tmp/marblo-updater-feed
```

통과 조건:

- 최신 Release가 `draft=false`, production 대상이면 `prerelease=false`
- macOS는 `latest-mac.yml`과 `.zip` 자산이 함께 존재
- Windows는 `latest.yml`과 `.exe` 자산이 함께 존재
- metadata에 `version`, `files[].url`, `files[].sha512` 또는 동등한 checksum 필드가 존재
- metadata version이 앱의 현재 버전보다 높다

2026-06-30 점검 결과 (feed drift 정정 후):

- 런타임 feed와 `electron-builder.yml` publish 대상이 모두 PUBLIC `melocream/marblo-releases`로 일치 (이전에는 feed가 private 소스 repo를 가리켜 익명 유저 앱이 Release를 404로 못 받았다 — 이 drift가 버그였다).
- private 소스 repo는 익명 사용자에게 `releases/latest`가 404 → 공개 유저 앱의 feed로 절대 쓰지 않는다. 그래서 PUBLIC `marblo-releases`로 일치시킨다.
- 위 §1 검증은 `REPO=melocream/marblo-releases` 기준으로 수행한다.

2026-07-10 점검 결과 (P0-12b `nzDieNhedP5sWnagJY3e`):

- `gh repo view melocream/marblo-releases --json nameWithOwner,visibility,defaultBranchRef,url`: `visibility=PUBLIC`, default branch `master`.
- `gh release list --repo melocream/marblo-releases --limit 10`: Latest는 `v3.0.12 (mac arm64) — MCP 패키징 근본수정 2/2`, tag `v3.0.12`, published `2026-07-09T06:26:16Z`.
- `gh release view v3.0.12 --repo melocream/marblo-releases`: `isDraft=false`, `isPrerelease=false`.
- v3.0.12 자산: `latest-mac.yml`, `latest.yml`, `Marblo-3.0.12-arm64-mac.zip`, `Marblo-3.0.12-arm64-mac.zip.blockmap`, `Marblo-3.0.12-arm64.dmg`, `Marblo-3.0.12-arm64.dmg.blockmap`, `Marblo-Setup-3.0.12.exe`, `Marblo-Setup-3.0.12.exe.blockmap`.
- `latest-linux.yml` / Linux 자산은 v3.0.12 릴리스에 없음.
- `latest-mac.yml`: `version=3.0.12`, `path=Marblo-3.0.12-arm64-mac.zip`. 실제 다운로드 자산 대조 결과:
  - `Marblo-3.0.12-arm64-mac.zip`: size `230034563` OK, sha512 `jnCrQDm91jT02XDI4tBFUZDcibTPa9fwfRX52qEj2aIMb0TDdl1Tu6pPAn0PjlVftF4V4wvScD7E8bbofiSGDQ==` OK.
  - `Marblo-3.0.12-arm64.dmg`: size `239697428` OK, sha512 `zjSOGyQ+doV4Z90NLT87u+CYI92tseA9yIJgk5d0pgIRSeZpUkssFTGtEPiSkKPtNkZ8tNGP4o2h0d6yAABIVA==` OK.
- `latest.yml`: `version=3.0.12`, `path=Marblo-Setup-3.0.12.exe`. 실제 다운로드 자산 대조 결과:
  - `Marblo-Setup-3.0.12.exe`: size `197940168` OK, sha512 `1+KQCp++d0rEJNIEQurVoS2D96IAMxFSQaL0P/BNOVLuSWy/aPAJJKs13nENQzG9K0OgzWsVs7CoMAjh56JQjw==` OK.
- mac ZIP 내부 `Marblo.app` 검증:
  - `codesign --verify --deep --strict --verbose=4 /tmp/marblo-updater-zip/Marblo.app`: valid on disk, satisfies Designated Requirement.
  - `codesign -dv --verbose=4 /tmp/marblo-updater-zip/Marblo.app`: `Authority=Developer ID Application: HYPEMARC Inc. (7T8JPRY7AD)`, hardened runtime flag present, `Notarization Ticket=stapled`.
  - `spctl -a -vvv -t execute /tmp/marblo-updater-zip/Marblo.app`: accepted, source `Notarized Developer ID`.
- 참고: DMG 컨테이너 자체는 `spctl -a -vvv -t open --context context:primary-signature Marblo-3.0.12-arm64.dmg`에서 `rejected / source=no usable signature`. 앱 번들은 서명/공증/staple OK이므로 updater 적용 대상인 ZIP 경로는 유효하지만, DMG 컨테이너 서명까지 요구하는 배포 정책이면 별도 보강이 필요하다.
- 구버전 후보: `v3.0.11` 릴리스는 확인되지 않았고, 공개 repo에는 `v3.0.9` 및 `v3.0.8` 릴리스가 존재한다. `v3.0.9`는 mac `latest-mac.yml`, zip, dmg만 있고 blockmap이 없으며, `v3.0.8`은 mac/Windows 자산이 있다.
- 중요: v3.0.12 release name/body에는 `[HOTFIX]` 태그가 없다. 현재 코드의 핫픽스 자동 다운로드/강제 재시작 분기(`Updater.isHotfix`)는 release name 또는 notes의 `[HOTFIX]`, 또는 channel `hotfix`가 필요하다. 따라서 공개 v3.0.12 그대로는 구버전 앱이 업데이트를 감지하더라도 일반 업데이트 경로로 동작하며, "핫픽스 자동수신" 실측에는 `[HOTFIX]`가 포함된 새 공개 릴리스 또는 리허설 전용 feed/channel이 필요하다.

## 2. 일반 릴리스

일반 릴리스는 사용자가 "지금 다운로드" / "지금 재시작"을 선택하거나 다음 종료 시 적용된다.

```bash
cd v3
npm version patch
npm run build:electron
npx electron-builder --mac --publish never

REPO=melocream/marblo-releases
TAG="v$(node -p "require('./package.json').version")"
gh release create "$TAG" dist/*.zip dist/*.dmg dist/latest-mac.yml \
  --repo "$REPO" \
  --draft \
  --title "$TAG" \
  --notes "...changelog..."

gh release edit "$TAG" --repo "$REPO" --draft=false
```

대상 클라이언트:

- 앱 실행 중: 최대 4시간 후 자동 recheck
- 다음 launch 시 즉시 감지
- UI에 일반 업데이트 배너와 수동 다운로드/재시작 액션 노출

## 3. 긴급 핫픽스

Release name 또는 release notes에 `[HOTFIX]` 태그를 포함하면 클라이언트가 자동 다운로드 후 5분 grace를 거쳐 재시작한다.

```bash
cd v3
npm version patch
npm run build:electron
npx electron-builder --mac --publish never

REPO=melocream/marblo-releases
TAG="v$(node -p "require('./package.json').version")"
gh release create "$TAG" dist/*.zip dist/*.dmg dist/latest-mac.yml \
  --repo "$REPO" \
  --draft \
  --title "$TAG [HOTFIX]" \
  --notes "[HOTFIX] Fix critical updater-blocking issue. Auto-installs after 5 minutes."

# feed 검증 후 공개
gh release edit "$TAG" --repo "$REPO" --draft=false
```

클라이언트 동작:

1. 최대 4시간 recheck 또는 다음 launch 시 `update-available`
2. `Updater.isHotfix(info)` true
3. `autoUpdater.autoDownload=false`여도 즉시 `downloadUpdate()`
4. 다운로드 완료 후 `forceInstallInMs=300000` 상태 전송
5. 5분 후 `quitAndInstall()` 실행. 사용자가 "지금 재시작"을 누르면 즉시 적용, "연기"를 누르면 이번 세션 timer만 취소

## 4. 구버전 -> 핫픽스 리허설

실제 production repo에 public 핫픽스 Release를 만들기 전, 배포 책임자 승인을 받고 시간대를 고정한다. ad hoc public Release를 무단 생성하지 않는다.

```bash
REPO=melocream/marblo-releases
OLD_VERSION=3.0.0
HOTFIX_VERSION=3.0.1

cd v3
npm run build:electron
npx electron-builder --mac zip --publish never -c.extraMetadata.version="$OLD_VERSION"
open "dist/mac-arm64/Marblo.app"
```

핫픽스 Release 공개 후 구버전 앱에서 확인:

- [ ] `updater:check` 수동 트리거 또는 다음 launch로 check 실행
- [ ] `update-available` 수신
- [ ] Release title 또는 notes의 `[HOTFIX]`로 자동 다운로드 시작
- [ ] `download-progress` 이벤트 수신
- [ ] `update-downloaded`와 `forceInstallInMs` 수신
- [ ] 재시작 후 앱 버전이 `HOTFIX_VERSION`으로 상승

리허설 통과 기록은 티켓 activity에 남긴다:

```text
핫픽스 리허설 통과:
- repo/tag:
- old version:
- hotfix version:
- latest*.yml sha512 확인:
- update-available/downloaded 수신:
- 재시작 후 버전:
```

### 4-1. v3.0.12 기준 수동 QA 절차

2026-07-10 기준 v3.0.12는 public 최신 릴리스이고 feed/checksum/앱 서명/공증은 통과했지만, `[HOTFIX]` 태그가 없어 핫픽스 자동 다운로드 분기를 트리거하지 않는다. 실제 "구버전 -> 핫픽스 자동수신"을 QA하려면 아래 둘 중 하나로 진행한다.

옵션 A: production hotfix 릴리스로 검증

1. 배포 책임자 승인을 받고 `melocream/marblo-releases`에 현재 최신보다 높은 patch 버전을 `[HOTFIX]` title 또는 notes로 공개한다.
2. 테스트 Mac에서 기존 설치본을 백업하고 `/Applications/Marblo.app`를 제거한다.
3. 공개 repo에 존재하는 구버전 DMG를 설치한다. 현재 후보는 `v3.0.9` 또는 `v3.0.8`이며, `v3.0.11`은 공개 repo에서 확인되지 않았다.
4. 앱을 실행하고 개발자 콘솔 또는 앱 로그에서 `updater:check`가 실행되는지 확인한다. 필요하면 UI의 수동 업데이트 체크 액션을 사용한다.
5. 기대 결과:
   - `update-available` 이벤트의 `version`이 hotfix 버전이다.
   - release name 또는 notes의 `[HOTFIX]`로 `downloadUpdate()`가 자동 시작된다.
   - `download-progress` 이벤트가 증가한다.
   - `update-downloaded` 후 renderer로 `forceInstallInMs=300000` 상태가 전달된다.
   - 사용자가 즉시 재시작을 누르거나 5분 grace가 지나면 `quitAndInstall()`이 실행된다.
   - 재실행 후 앱 버전이 hotfix 버전으로 상승한다.
6. 실패 시 확인 순서:
   - `latest-mac.yml`의 `version`, `path`, `sha512`, `size`가 실제 ZIP과 일치하는지 재검증.
   - release title/body에 `[HOTFIX]`가 정확히 포함됐는지 확인.
   - runtime feed가 `melocream/marblo-releases`인지 확인. local override 환경 변수(`MARBLO_UPDATER_OWNER`, `MARBLO_UPDATER_REPO`, `MARBLO_UPDATER_CHANNEL`)가 남아 있으면 제거한다.
   - 앱 번들이 Developer ID로 서명되고 notarization ticket이 stapled인지 `codesign -dv --verbose=4`와 `spctl -a -vvv -t execute`로 확인한다.

옵션 B: 리허설 전용 feed/channel로 검증

1. production 최신 릴리스에 영향을 주지 않도록 별도 public repo 또는 `hotfix` channel feed를 준비한다.
2. 구버전 앱 실행 환경에만 `MARBLO_UPDATER_REPO` 또는 `MARBLO_UPDATER_CHANNEL=hotfix` override를 설정한다.
3. `latest-mac.yml`과 자산은 production과 같은 방식으로 올리고, release title/body 또는 channel 중 하나가 핫픽스 조건을 만족하게 한다.
4. 옵션 A의 4~6번과 동일하게 이벤트, 자동 다운로드, `forceInstallInMs`, 재시작 후 버전 상승을 확인한다.

## 5. 배포 후 모니터링

핫픽스 배포 후 24시간 동안 다음을 확인한다.

- [ ] Sentry update-related error
- [ ] Discord / support 채널 사용자 보고
- [ ] `lifecycle:app-version` 텔레메트리
- [ ] crash/event 빈도 이전 24h 대비 변화

대상 cohort의 90% 이상이 24시간 내 새 버전을 보고하면 수신 기준 통과. 미달이면 사용자가 앱을 실행하지 않은 비율과 자동업데이트 실패를 분리해 확인한다.

## 6. 롤백

electron-updater는 기본적으로 downgrade를 거부한다. 문제 핫픽스는 이전 버전으로 내리지 말고 새 patch 버전으로 되돌린다.

```bash
git revert <bad-commit>
cd v3
npm version patch
npm run build:electron
npx electron-builder --mac --publish never

REPO=melocream/marblo-releases
TAG="v$(node -p "require('./package.json').version")"
gh release create "$TAG" dist/*.zip dist/*.dmg dist/latest-mac.yml \
  --repo "$REPO" \
  --draft \
  --title "$TAG [HOTFIX]" \
  --notes "[HOTFIX] Roll back previous release because of regression."
gh release edit "$TAG" --repo "$REPO" --draft=false
```

## 7. 코드 위치

| 영역                  | 파일                                 |
| --------------------- | ------------------------------------ |
| 메인 프로세스 updater | `v3/electron/updater.ts`             |
| IPC 노출              | `v3/electron/preload.ts`             |
| UI 배너               | `v3/src/components/UpdateBanner.tsx` |
| Layout 마운트         | `v3/src/components/Layout.tsx`       |
| 빌드 설정             | `v3/electron-builder.yml`            |
| 자동 체크 트리거      | `v3/electron/main.ts`                |

## 변경 이력

| 일자       | 변경                                                                                                                  |
| ---------- | --------------------------------------------------------------------------------------------------------------------- |
| 2026-06-30 | 릴리스(피드) repo 표기를 `melocream/marblo-releases`로 일괄 정정 (publish 대상과 일치, private 소스 repo는 익명 404). |
| 2026-06-18 | GitHub 릴리스 repo를 `melocream/marblo-releases`로 확정하고 P0-12b 리허설 분리 반영.                                  |
| 2026-06-17 | feed repo drift 방지, 실제 피드 점검 결과, 최신 리허설 절차 반영.                                                     |
| 2026-05-12 | 초안. P0-12 핫픽스 강제 배포 메커니즘 + UpdateBanner 컴포넌트 추가.                                                   |
