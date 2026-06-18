# Marblo electron-updater Runbook

운영자가 데스크탑 앱 릴리스 / 핫픽스 배포 시 따를 절차.

마지막 점검: 2026-06-18 KST. GitHub 릴리스 repo는 `melocream/marblo`로 확정.

---

## 0. 사전 점검

- [ ] 런타임 update feed: `v3/electron/updater.ts` 기본값은 `melocream/marblo`, channel은 `latest`
- [ ] override가 필요한 리허설만 `MARBLO_UPDATER_OWNER`, `MARBLO_UPDATER_REPO`, `MARBLO_UPDATER_CHANNEL` 사용
- [ ] `v3/electron-builder.yml`의 `publish.provider: github` 확인
- [ ] GitHub Release 업로드 권한이 있는 PAT를 로컬 `GH_TOKEN`에 설정
- [ ] public 사용자 업데이트에는 private GitHub Release를 쓰지 않는다. private feed 테스트가 필요할 때만 `MARBLO_UPDATER_PRIVATE=true`와 토큰을 로컬에서 사용
- [ ] macOS 공증: `v3/scripts/notarize.js`에 Apple Developer 계정 + app-specific password 설정
- [ ] Windows 서명: `v3/electron-builder.yml`의 `win.certificateFile` 또는 CI signing secret 확인

현재 repo URL 주의:

- worktree origin: `https://github.com/melocream/marblo.git`
- 런타임 updater feed: `melocream/marblo`
- `v3/package.json`의 `repository.url`은 updater feed 결정에 의존하지 않는다. repo 이전 시 `updater.ts` 기본값과 CI Release 대상 repo를 함께 바꾼다.

## 1. GitHub Release 피드 검증

```bash
REPO=melocream/marblo

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

2026-06-18 점검 결과:

- `gh release list --repo melocream/marblo --limit 20`: release 없음
- `gh api repos/melocream/marblo/releases/latest`: 404
- `https://github.com/melocream/marblo/releases/latest`: 404

따라서 이 상태에서는 실제 GitHub Release 기반 구버전 -> 핫픽스 수신 리허설을 완료할 수 없다. 실제 수신 리허설은 P0-12b(`nzDieNhedP5sWnagJY3e`)에서 P0-7 완료 후 수행한다.

## 2. 일반 릴리스

일반 릴리스는 사용자가 "지금 다운로드" / "지금 재시작"을 선택하거나 다음 종료 시 적용된다.

```bash
cd v3
npm version patch
npm run build:electron
npx electron-builder --mac --publish never

REPO=melocream/marblo
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

REPO=melocream/marblo
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
REPO=melocream/marblo
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

REPO=melocream/marblo
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

| 일자       | 변경                                                                        |
| ---------- | --------------------------------------------------------------------------- |
| 2026-06-18 | GitHub 릴리스 repo를 `melocream/marblo`로 확정하고 P0-12b 리허설 분리 반영. |
| 2026-06-17 | feed repo drift 방지, 실제 피드 점검 결과, 최신 리허설 절차 반영.           |
| 2026-05-12 | 초안. P0-12 핫픽스 강제 배포 메커니즘 + UpdateBanner 컴포넌트 추가.         |
