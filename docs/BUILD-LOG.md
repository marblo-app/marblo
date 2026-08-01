# Marblo 빌드 로그

배포된 데스크톱 빌드의 **빌드·검증·발행 기록**. 릴리스 호스트: [`melocream/marblo-releases`](https://github.com/melocream/marblo-releases/releases) (public). 자동업데이트 피드: `latest-mac.yml`(macOS) · `latest.yml`(Windows).

> 신규 릴리스마다 이 문서 최상단에 항목을 추가한다. 각 항목은 **무엇이 바뀌었나 / 산출물 / 검증 실측**을 담는다.

---

## v3.0.22 — 2026-08-01 (macOS Apple Silicon · Windows x64)

**한 줄:** 사람+오케 완전체 감사 로그 · Mission Replay Phase 1(비공개) · 라우팅 잔여량·다양성.

### 무엇이 바뀌었나

**🤝 협업 · 감사**

- **프로젝트 감사 로그에 오케(에이전트) 행위 병합** — 오케가 _어느 사람의 프로젝트에서, 무슨 모델로, 무슨 티켓을_ 처리했는지까지 사람 행위와 한 타임라인에. 각 행에 사람/🤖 뱃지, owner/admin 전용, 구성원별 필터. 순수 읽기병합(새 write·룰 변경 없음) — 원장(`audit_logs`)이 이미 `actorUid`(발주자)·`projectId`·`model`·`tier`·`taskId`까지 귀속 기록 중이던 것을 뷰가 합쳐 읽는다.
- **프로젝트 탭** — 프로젝트 단위 멤버 초대·권한 부여·작업량 뷰 + 협업 감사 패널.
- 멤버 목록 오너 상단 고정 · 멤버 이름 표시 · 확인한 채팅 메시지 재알림 수정.

**🎬 Mission Replay Phase 1 (비공개 인앱뷰)**

- 완료 미션을 타임라인·요약·통계로 조립하는 인앱 뷰. **공유/내보내기 표면 0개**(테스트로 강제) — 비공개 우선. 공개는 Phase 2(편집·마스킹) 이후.
- 오케가 라벨링한 ad-hoc 보드 작업도 implicit 미션으로 그룹화되어 리플레이 대상에 포함.

**🧭 스폰 라우팅**

- 잔여 쿼터를 스폰 주요 팩터로 반영(무태그 dispatch가 budget을 통째로 버리던 결함 수정).
- 모델 다양성 개선(opus5 편중 완화) — grok을 후보 프리셋에 편입.

**🐛 도그푸딩 픽스**

- 로컬 폴더 열기(숨김파일 토글·붙여넣기·폴더 생성) · 파일트리 워크트리 이름 overflow 2층 처리 · 완료이력 기간필터 · Sentry 노이즈 드롭 · 프로젝트 스위처 정리.

### 산출물 (에셋 8개)

| 플랫폼  | 파일                                          | 크기 |
| ------- | --------------------------------------------- | ---- |
| macOS   | `Marblo-3.0.22-arm64.dmg` (+ `.blockmap`)     | 264M |
| macOS   | `Marblo-3.0.22-arm64-mac.zip` (+ `.blockmap`) | 254M |
| macOS   | `latest-mac.yml`                              | —    |
| Windows | `Marblo-Setup-3.0.22.exe` (+ `.blockmap`)     | 229M |
| Windows | `latest.yml`                                  | —    |

### 검증 실측

- **renderer tsc** 클린 · 감사병합 단위테스트 98/98 · **전체 스위트 4323/4323 green**.
- **macOS Gatekeeper**: `spctl -a -vvv -t install` → `accepted · source=Notarized Developer ID`.
- **서명**: Developer ID Application: HYPEMARC Inc. (7T8JPRY7AD), 전체 체인·타임스탬프. afterSign 단독 공증(이중공증 없음).
- **Windows sha512**: `latest.yml` 선언값 ↔ 실제 `.exe` SHA-512(base64) **완전 일치**, 크기·url·버전 정합.
- **Firestore**: `audit_logs` 복합 인덱스 3개 배포(`--only firestore:indexes`). rules/functions/hosting/storage 미변경.

### 발행

- `melocream/marblo-releases` — draft 생성 → macOS 업로드 → Windows sha512 대조 → **public 발행(v3.0.22 = Latest)**.
- `marblo.app/download` — 버전 고정 다운로드 URL 상수를 v3.0.22로 갱신(Vercel 자동배포). 이전엔 신규 방문자에게 3.0.20 자산을 배포하던 것을 수정.

---

## 히스토리 (요약)

| 버전    | 날짜       | 요지                                                                  |
| ------- | ---------- | --------------------------------------------------------------------- |
| v3.0.22 | 2026-08-01 | 사람+오케 완전체 감사 로그 · Mission Replay P1 · 라우팅 잔여량·다양성 |
| v3.0.20 | 2026-08-01 | 안정화 라운드                                                         |
| v3.0.19 | 2026-07-29 | 그록 터미널 한글 자간 · 라우팅 다양화 · 구독 비용 재모델링            |
| v3.0.18 | 2026-07-21 | 각종 에러 수정 라운드                                                 |
| v3.0.16 | —          | 오케 전환 패키지 Firebase config 수정                                 |
| v3.0.14 | —          | 오케 중심 온보딩 재설계 · 오케전환/Flow/Usage 픽스                    |
| v3.0.13 | —          | 새 창 로그인 픽스 · 구독 게이팅·온보딩·워치독                         |
| v3.0.12 | —          | MCP 패키징 근본수정                                                   |
| v3.0.8  | —          | macOS · Windows 동시 배포 시작                                        |
| v3.0.0  | —          | macOS(Apple Silicon) 베타 시작                                        |

> 폐기: v3.0.15 · v3.0.21은 draft 상태로 남겨진 폐기본(후속 버전이 대체).
