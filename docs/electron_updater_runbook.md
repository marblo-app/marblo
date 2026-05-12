# Marblo electron-updater Runbook

운영자가 데스크탑 앱 릴리스 / 핫픽스 배포 시 따를 단계별 절차.

마지막 검증: 2026-05-12 (커밋 P0-12).

---

## 0. 사전 점검 (한 번만)

- [ ] `v3/electron-builder.yml`의 `publish.provider: github` 확인
- [ ] GitHub Releases 권한 있는 PAT를 `GH_TOKEN` 환경변수로 설정 (electron-builder 요구)
- [ ] `package.json`의 `repository.url`이 `https://github.com/melocream/marblo` 가리키는지 확인 (electron-updater가 update feed URL 도출)
- [ ] macOS 공증: `scripts/notarize.js`에 Apple Developer 계정 + app-specific password 설정 (P0-7 영역)
- [ ] Windows EV 인증서: `electron-builder.yml`의 `win.certificateFile` + `CSC_KEY_PASSWORD` 환경변수 (P0-7 영역)

## 1. 일반 릴리스 (베타 50인, 즉시 적용 X)

사용자는 "지금 다운로드" / "지금 재시작" 또는 다음 종료 시 자동 적용.

```bash
# 1. version bump
cd v3
npm version patch          # 3.0.0 → 3.0.1 (semver)

# 2. dist 빌드 + 자동 publish
npm run build:mac          # 또는 build:win / build:all
# → dist/Marblo-3.0.1-mac.zip + latest-mac.yml 자동 업로드 (provider: github)

# 3. GitHub Releases 탭에서 release notes 작성
gh release edit v3.0.1 --notes "...changelog..."
# (또는 GitHub 웹에서 직접)

# 4. publish (Draft → Public)
gh release edit v3.0.1 --draft=false
```

50명 사용자 클라이언트:

- 앱 켜져있는 상태: 최대 4시간 후 자동 recheck (`RECHECK_INTERVAL_MS`)
- 또는 다음 launch 시 즉시 감지
- 사용자 UI에 파란 배너 + "지금 다운로드" / "나중에" 노출

## 2. 긴급 핫픽스 (강제 적용)

베타 50인 전부에게 1회 강제 배포. release name 또는 release notes에 `[HOTFIX]` 태그를 포함하면 클라이언트가 자동 다운로드 + 5분 grace 후 자동 재시작.

```bash
# 1. patch 버전 + hotfix tag
npm version patch          # 3.0.1 → 3.0.2
git tag -d v3.0.2 && git tag v3.0.2 -m "[HOTFIX] auth race fix"

# 2. 빌드 + publish
npm run build:mac

# 3. release notes에 [HOTFIX] 명시
gh release edit v3.0.2 \
  --title "v3.0.2 [HOTFIX]" \
  --notes "[HOTFIX] Fix auth token expiry race condition. Auto-installs in 5 min."

gh release edit v3.0.2 --draft=false
```

클라이언트 동작:

1. 최대 4h recheck 또는 다음 launch 시 update-available 이벤트
2. `Updater.isHotfix(info)` true → `autoUpdater.autoDownload`가 false여도 즉시 다운로드 시작
3. 다운로드 완료 → `scheduleHotfixInstall()` → 5분 grace timer + UI에 빨간 배너 (카운트다운)
4. 5분 후 자동 `quitAndInstall()` (사용자가 "지금 재시작" 누르면 즉시 / "연기" 누르면 이번 세션은 skip → 다음 launch에서 재실행)

## 3. 배포 후 검증

- [ ] GitHub Releases 탭에서 release public 상태 확인
- [ ] `latest-mac.yml` / `latest.yml` 자동 생성 + `sha512` 해시 포함 확인
- [ ] 자체 머신에서 이전 버전 앱 띄워두고 4-5분 기다리거나 메뉴에서 수동 check (`updater:check` IPC 또는 dev console에서 호출)
- [ ] UpdateBanner 노출 → "지금 다운로드" 클릭 → 다운로드 진행률 확인 → 다운로드 완료 배너 노출 → "지금 재시작" 클릭 → 새 버전 부팅 확인
- [ ] Sentry / 로그에 update-related 에러 없음 (PII scrubber 통과 후)

## 4. 핫픽스 후 모니터링 (24h)

핫픽스 배포 후 24시간 동안 다음을 모니터링:

- [ ] BigQuery `events` 테이블에서 `agent:crashed` 빈도 (이전 24h 평균 대비)
- [ ] Discord 베타 채널 사용자 보고
- [ ] Sentry 새 에러 수
- [ ] `lifecycle:app-version` 텔레메트리 (앱 시작 시 보내는 버전 이벤트)로 50명 중 N명이 새 버전 받았는지 카운트

50명 중 90% 이상이 24h 내 새 버전 보고하면 acceptance 충족. 그 미만이면:

- (a) 사용자가 앱을 24h 동안 한 번도 안 띄움 → 정상
- (b) 자동 업데이트 실패 → Sentry / 로그 확인 후 수동 재배포 또는 인스톨러 링크 안내

## 5. 롤백 (긴급)

핫픽스가 더 큰 문제 일으켰을 때:

```bash
# 새 핫픽스로 이전 버전 복구
git revert <bad-commit>
npm version patch          # 3.0.2 → 3.0.3
git tag v3.0.3 -m "[HOTFIX] Revert 3.0.2 (regression in X)"
npm run build:mac
gh release edit v3.0.3 --notes "[HOTFIX] Roll back 3.0.2 — caused Y."
gh release edit v3.0.3 --draft=false
```

다운그레이드(3.0.2 → 3.0.1)는 electron-updater가 기본적으로 거부 (semver). 항상 새 버전 번호로 fix.

## 6. 채널 (장기 — 베타/안정)

장기적으로 `alpha` / `beta` / `stable` 채널 분리. 지금은 단일 채널.

```yaml
# electron-builder.yml 채널 명시 (옵션)
publish:
  provider: github
  channel: latest # 또는 beta / hotfix
```

`Updater.isHotfix()`는 `autoUpdater.channel === 'hotfix'`도 핫픽스로 인식. release name `[HOTFIX]` 대신 채널을 hotfix로 set한 release도 강제 배포됨.

## 7. 코드 위치 빠른 참조

| 영역                  | 파일                                                              |
| --------------------- | ----------------------------------------------------------------- |
| 메인 프로세스 updater | `v3/electron/updater.ts`                                          |
| IPC 노출              | `v3/electron/preload.ts` (updater 섹션)                           |
| UI 배너               | `v3/src/components/UpdateBanner.tsx`                              |
| Layout 마운트         | `v3/src/components/Layout.tsx` (Header 직후)                      |
| 빌드 설정             | `v3/electron-builder.yml`                                         |
| 자동 체크 트리거      | `v3/electron/main.ts` createWindow 후 `updater.checkForUpdates()` |

## 변경 이력

| 일자       | 변경                                                                |
| ---------- | ------------------------------------------------------------------- |
| 2026-05-12 | 초안. P0-12 핫픽스 강제 배포 메커니즘 + UpdateBanner 컴포넌트 추가. |
