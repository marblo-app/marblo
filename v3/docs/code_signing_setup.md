# Marblo 데스크톱 앱 코드사이닝 셋업 가이드

> 대상: Marblo Electron 앱(`v3/`)의 macOS / Windows 배포 빌드 서명·공증.
> 작성: 2026-06-20. 빌드 파이프라인 = `.github/workflows/build.yml`(Build & Release), 패키징 = `v3/electron-builder.yml`.

## 0. 왜 필요한가 / 선행 조건

서명이 없으면:

- **macOS**: Gatekeeper가 "확인되지 않은 개발자 / 손상되어 열 수 없음"으로 **기본 차단**. 베타라도 **공증(notarization) 사실상 필수**.
- **Windows**: SmartScreen "알 수 없는 게시자" 경고. 미서명 `.exe`도 "추가 정보 → 실행"으로 설치는 가능하므로 베타 초기엔 미서명으로 갈 수도 있으나, 평판 경고가 전환율을 떨어뜨림. GA 전 서명 권장.

**⚠️ 선행: 빌드 파이프라인 복구가 먼저.** 현재 Build & Release CI가 잡을 못 띄우고 실패 중(별도 티켓에서 수정). Mac/Win 설치 아티팩트가 실제로 산출되는 상태가 된 뒤에 서명을 얹는 순서다. 시크릿은 미리 등록해도 무해하지만, *서명된 빌드 검증*은 CI가 초록불이 된 뒤 가능.

`build.yml`의 서명 배선 현황(이미 존재):

| 환경변수(CI)                                        | 용도                           | electron-builder가 읽는 키 |
| --------------------------------------------------- | ------------------------------ | -------------------------- |
| `CSC_LINK` ← `secrets.MAC_CSC_LINK`                 | macOS 서명 인증서(.p12 base64) | `CSC_LINK`                 |
| `CSC_KEY_PASSWORD` ← `secrets.MAC_CSC_KEY_PASSWORD` | .p12 암호                      | `CSC_KEY_PASSWORD`         |
| `APPLE_ID`                                          | 공증 Apple ID                  | notarize 스크립트          |
| `APPLE_APP_SPECIFIC_PASSWORD`                       | 공증 앱 암호                   | notarize 스크립트          |
| `APPLE_TEAM_ID`                                     | 공증 팀 ID                     | notarize 스크립트          |
| `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD`             | **(파일형 전용)** Windows 서명 | electron-builder           |

> macOS는 위 배선 그대로 동작한다. **Windows는 EV 인증서라 `WIN_CSC_LINK`(파일형) 방식이 불가** → Part B 참고(build.yml 수정 필요).

---

## Part A. macOS — Developer ID 서명 + 공증

> 직접 배포(앱스토어 밖)는 **"Developer ID Application"** 인증서가 필요하다. "Mac App Store"용 인증서나 무료 Apple ID로는 발급되지 않는다.

### A-0. 멤버십 확인 (중요)

Developer ID 인증서는 **유료 Apple Developer Program($99/년)** 멤버십에서만 발급된다. 현재 "Mac Developer" 등록만 되어 있다면, [developer.apple.com/account](https://developer.apple.com/account) → **Membership details**에서 상태가 _Apple Developer Program_(active)인지 확인. 무료 등록 상태면 유료 가입이 선행되어야 한다.

### A-1. CSR 생성 (Keychain)

1. **키체인 접근(Keychain Access)** 실행
2. 메뉴 → **인증서 지원 → 인증 기관에서 인증서 요청…(Request a Certificate From a Certificate Authority)**
3. 사용자 이메일 입력, **"디스크에 저장"** 선택, _CA 이메일은 비움_ → `CertificateSigningRequest.certSigningRequest` 저장

### A-2. 인증서 발급 (Apple Developer)

1. [developer.apple.com](https://developer.apple.com/account) → **Certificates, IDs & Profiles → Certificates → ＋**
2. **"Developer ID Application"** 선택 (Software 섹션)
3. A-1의 `.certSigningRequest` 업로드 → `.cer` 다운로드
4. 다운받은 `.cer` 더블클릭 → 로그인 키체인에 설치됨

### A-3. .p12 내보내기

1. 키체인 접근 → **로그인 → 내 인증서** 카테고리
2. **"Developer ID Application: (이름/팀)"** 항목 우클릭 → **내보내기…** → 형식 `.p12`
3. **export 암호** 설정(기억해 둘 것 = `MAC_CSC_KEY_PASSWORD`)

### A-4. base64 인코딩

```bash
base64 -i DeveloperID_Application.p12 | pbcopy   # 클립보드에 복사됨 = MAC_CSC_LINK
```

### A-5. App-Specific Password & Team ID

- **앱 암호**: [appleid.apple.com](https://appleid.apple.com) → **로그인 및 보안 → 앱 암호 → 생성** (= `APPLE_APP_SPECIFIC_PASSWORD`). Apple ID 본 비밀번호 아님.
- **Team ID**: developer.apple.com → **Membership details**의 10자리 Team ID (= `APPLE_TEAM_ID`).

### A-6. GitHub 시크릿 등록

repo **Settings → Secrets and variables → Actions → New repository secret** 에 5개 등록:

| 시크릿 이름                   | 값                     |
| ----------------------------- | ---------------------- |
| `MAC_CSC_LINK`                | A-4의 base64 문자열    |
| `MAC_CSC_KEY_PASSWORD`        | A-3의 .p12 export 암호 |
| `APPLE_ID`                    | Apple ID 이메일        |
| `APPLE_APP_SPECIFIC_PASSWORD` | A-5의 앱 암호          |
| `APPLE_TEAM_ID`               | A-5의 Team ID          |

→ CI가 자동으로 서명(`CSC_LINK`) + 공증(`afterSign: scripts/notarize.js`) 수행. 검증: 빌드된 `.dmg`/`.app`에 `spctl -a -vv -t install <앱>` / `codesign -dv --verbose=4 <앱>` 로 `Developer ID` + `notarized` 확인.

---

## Part B. Windows — EV 코드사이닝 (토큰/HSM)

> **EV 인증서는 개인키가 HSM/USB 토큰 밖으로 나오지 않으므로 `.pfx` 파일 base64(`WIN_CSC_LINK`) 방식이 불가능하다.** GitHub-hosted 러너에서 서명하려면 아래 클라우드 서명 경로 중 하나를 택하고 `build.yml`의 win 서명 단계를 그에 맞게 수정해야 한다.

### 옵션 1 — Azure Trusted Signing ★권장

- Microsoft 운영 클라우드 서명. **~$9.99/월**, 토큰 불필요, SmartScreen 평판 즉시 양호.
- **요건**: Azure 구독 + 조직 신원 검증(법인 3년+ 이력 권장; 그 외 추가 검증 경로 있음). Trusted Signing Account + Certificate Profile 생성.
- **CI**: `azure/trusted-signing-action`(또는 electron-builder custom sign hook)으로 서명. 자격증명은 Azure 서비스 주체(`AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET`) + 엔드포인트/계정/프로필.
- **주의**: 기존 보유 EV 토큰 인증서는 사용하지 않고, Azure가 발급·관리하는 인증서로 대체된다.

### 옵션 2 — 발급사 클라우드 HSM 서명 (기존 EV 인증서 유지)

- DigiCert **KeyLocker(Software Trust Manager)**, Sectigo, GlobalSign 등 발급사가 제공하는 클라우드 HSM 서명 서비스. 인증서를 발급사 HSM으로 옮기거나 이미 거기 있으면 API/클라이언트 툴로 서명.
- **CI**: 발급사 CLI/`smctl` + API 키로 `signtool` 서명. 시크릿은 발급사별로 상이(API 키, 키 별칭, 인증 파일 등).
- 기존 EV 인증서를 그대로 살리고 싶을 때 적합. 단 발급사 서비스 비용/설정이 옵션 1보다 번거로울 수 있음.

### 옵션 3 — 셀프호스트 러너 + 물리 토큰 (비권장)

- USB 토큰 꽂힌 Windows 머신을 self-hosted runner로 등록. 서명 시 토큰 PIN 입력이 필요해 자동화가 어렵고 보안/가용성 부담. CI 부적합.

### build.yml 수정 (옵션 확정 후 devops가 진행)

현재 `build.yml`의 win 서명은 `WIN_CSC_LINK`/`WIN_CSC_KEY_PASSWORD`(파일형) 전제다. EV는 이게 안 맞으므로:

- 옵션 확정 → 해당 서명 액션/스텝으로 교체 + 필요한 시크릿 등록 + `electron-builder.yml`의 `win.sign`(커스텀 서명 훅) 또는 액션 기반 서명으로 구성.
- 이 변경은 사용자가 서명 서비스 가입/계정 발급을 마친 뒤 별도 티켓으로 수행한다.

### 검증

빌드 `.exe`에 `signtool verify /pa /v Marblo-Setup.exe` 또는 우클릭 → 속성 → 디지털 서명에서 게시자/타임스탬프 확인.

---

## 순서 요약 (체크리스트)

- [ ] **(진행중)** CI 빌드 파이프라인 복구 → Mac/Win 설치파일 실제 산출
- [ ] **macOS**: 유료 Developer Program 멤버십 확인 → Developer ID Application 인증서 발급 → .p12 export → 시크릿 5종 등록(A-6)
- [ ] **Windows EV**: 클라우드 서명 옵션 결정(Azure Trusted Signing 권장) → 계정/인증서 준비 → build.yml win 서명 단계 수정(devops) + 시크릿 등록
- [ ] 서명/공증 적용 빌드 검증(`spctl`/`signtool`)
- [ ] `v*` 태그 릴리스 + electron-updater 리허설 (→ `v3/docs/electron_updater_runbook.md`)

## 비용/현실 노트

- macOS 공증은 사실상 필수(Gatekeeper 강제). 베타라도 적용 권장.
- Windows는 미서명으로 베타를 먼저 돌리고(GA 전 EV 서명) 가는 선택도 현실적. 단 SmartScreen 경고로 초기 신뢰도/전환 손해를 감수.
