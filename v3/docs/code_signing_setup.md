# Marblo 데스크톱 앱 코드사이닝 셋업 가이드

> 대상: Marblo Electron 앱(`v3/`)의 macOS / Windows 배포 빌드 서명·공증.
> 작성: 2026-06-20. 빌드 파이프라인 = `.github/workflows/build.yml`(Build & Release), 패키징 = `v3/electron-builder.yml`.
>
> 👉 **키보드 앞에서 바로 따라치는 실행 절차 + 실제 에러 트러블슈팅**은 [`signing_runbook.md`](./signing_runbook.md)(서명·공증 실전 런북)를 보라. 이 문서는 준비/배경/인증서 종류/Windows EV 옵션 비교 **레퍼런스**다.

## 0. 왜 필요한가 / 선행 조건

서명이 없으면:

- **macOS**: Gatekeeper가 "확인되지 않은 개발자 / 손상되어 열 수 없음"으로 **기본 차단**. 베타라도 **공증(notarization) 사실상 필수**.
- **Windows**: SmartScreen "알 수 없는 게시자" 경고. 미서명 `.exe`도 "추가 정보 → 실행"으로 설치는 가능하므로 베타 초기엔 미서명으로 갈 수도 있으나, 평판 경고가 전환율을 떨어뜨림. GA 전 서명 권장.

**⚠️ 선행: 빌드 파이프라인 복구가 먼저.** 현재 Build & Release CI가 잡을 못 띄우고 실패 중(별도 티켓에서 수정). Mac/Win 설치 아티팩트가 실제로 산출되는 상태가 된 뒤에 서명을 얹는 순서다. 시크릿은 미리 등록해도 무해하지만, *서명된 빌드 검증*은 CI가 초록불이 된 뒤 가능.

`build.yml`의 서명 배선 현황(이미 존재):

| 환경변수(CI)                                        | 용도                                             | electron-builder가 읽는 키 |
| --------------------------------------------------- | ------------------------------------------------ | -------------------------- |
| `CSC_LINK` ← `secrets.MAC_CSC_LINK`                 | macOS 서명 인증서(.p12 base64)                   | `CSC_LINK`                 |
| `CSC_KEY_PASSWORD` ← `secrets.MAC_CSC_KEY_PASSWORD` | .p12 암호                                        | `CSC_KEY_PASSWORD`         |
| `APPLE_ID`                                          | 공증 Apple ID                                    | notarize 스크립트          |
| `APPLE_APP_SPECIFIC_PASSWORD`                       | 공증 앱 암호                                     | notarize 스크립트          |
| `APPLE_TEAM_ID`                                     | 공증 팀 ID                                       | notarize 스크립트          |
| `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD`             | **(미사용)** 파일형 Windows 서명 — A안에선 안 씀 | electron-builder           |

> macOS는 위 배선 그대로 동작한다(시크릿 5종 등록 완료). **Windows는 코리아SSL USB 토큰 + 수동 로컬 서명(A안)이라 `WIN_CSC_LINK`(파일형)·CI 자동서명을 쓰지 않는다** → Part B 참고(build.yml에서 win 서명 단계 제거 필요).

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

## Part B. Windows — 코드사이닝 (코리아SSL USB 토큰 / 수동 서명)

> **확정 방식(2026-06-20): 코리아SSL(한국디지털인증) USB 토큰 + 수동 로컬 서명(A안).**
> 보유 인증서 = 코리아SSL 발급 코드사이닝 인증서, **Thales SafeNet USB 토큰** 형태. 개인키가 토큰 밖으로 나오지 않으므로 `.pfx` 파일 base64(`WIN_CSC_LINK`) 방식·GitHub-hosted 러너 자동 서명은 **불가**. → CI는 **미서명 `.exe`까지만 산출**, 서명은 토큰 꽂은 Windows에서 사람이 `signtool`로 수행한다.

> **참고(원천 CA)**: 코리아SSL은 Sectigo·DigiCert 등을 재판매. 타임스탬프 URL이 CA별로 다르니 SAC에서 인증서 "발급자(Issued by)" 또는 주문확인서 제품명으로 확인할 것.
>
> - Sectigo → `http://timestamp.sectigo.com`
> - DigiCert → `http://timestamp.digicert.com`

### B-1. 준비 (Windows PC, 1회)

1. **SafeNet Authentication Client(SAC)** 설치 — 코리아SSL 발급 안내/고객지원에서 받음. (토큰엔 인증서가 이미 들어 있어 별도 설치 없이 드라이버+관리툴만 설치.) 토큰 꽂으면 SAC에 인증서가 보이고 서명 시 **토큰 PIN**을 물음. 토큰은 복제 불가·PIN 다회 오입력 시 잠김 → PIN 보관 주의.
2. **Windows SDK** 설치(= `signtool.exe`). 설치 시 "Windows SDK Signing Tools" 항목만 체크해도 됨. 경로 예: `C:\Program Files (x86)\Windows Kits\10\bin\<버전>\x64\signtool.exe`.

### B-2. 서명 (릴리스마다)

1. CI(GitHub Actions) 빌드 성공 → **Actions → 해당 실행 → Artifacts**에서 미서명 `Marblo-Setup.exe` 다운로드(예: `C:\sign\`).
2. 토큰 꽂은 상태로 PowerShell에서 (Sectigo 기준 예시):
   ```powershell
   signtool sign /fd SHA256 /tr http://timestamp.sectigo.com /td SHA256 /a "C:\sign\Marblo-Setup.exe"
   ```
   - `/a` 토큰 인증서 자동 선택, `/tr` 타임스탬프(만료 후에도 서명 유효 — 필수). DigiCert면 `/tr http://timestamp.digicert.com`.
   - 실행 시 SAC 창에서 **PIN 입력** → 서명 완료. (`/a`로 자동선택 안 되면 `/sha1 <인증서지문>` 지정.)
3. 서명된 `.exe`를 릴리스에 업로드.

### B-3. build.yml 수정 (devops, CI 빌드 복구와 함께)

현재 `build.yml`의 win 서명은 `WIN_CSC_LINK`/`WIN_CSC_KEY_PASSWORD`(파일형) 전제 → A안과 안 맞음.

- win 서명 단계를 **제거**하고, 미서명 설치 파일을 정상 빌드·Artifact 업로드만 하도록 정리. (`WIN_CSC_LINK` 관련 시크릿은 **등록 불필요**.)
- `electron-builder.yml`의 win 설정에서 서명 강제 옵션이 빌드를 깨지 않도록 확인.

### B-4. 검증

서명된 `.exe`에 `signtool verify /pa /v Marblo-Setup.exe` 또는 우클릭 → 속성 → 디지털 서명에서 게시자(하이프마크)/타임스탬프 확인.

### (대안) 완전 자동화가 필요해지면

릴리스가 매우 잦아지면 토큰 대신 **클라우드 HSM 서명**(DigiCert KeyLocker 등 발급사 클라우드 HSM, 또는 Azure Trusted Signing ~$9.99/월)으로 전환 검토. 단 토큰 키를 재발급/이전해야 하고 비용·세팅이 추가됨. 셀프호스트 러너(토큰 상시 꽂힌 Windows를 러너 등록)는 PIN/가용성 부담으로 **비권장**. 데스크톱 앱 릴리스 빈도에선 A안(수동)이 가장 적은 노력.

---

## 순서 요약 (체크리스트)

- [ ] **(진행중)** CI 빌드 파이프라인 복구 → Mac/Win 설치파일 실제 산출
- [x] **macOS**: Developer ID Application 인증서 발급 → .p12 export → 시크릿 5종 등록(A-6) — **완료(2026-06-20)**
- [ ] **Windows(A안)**: 코리아SSL 토큰 꽂을 Windows PC 준비 + SAC/Windows SDK 설치 → build.yml win 서명 단계 제거(devops) → 미서명 `.exe` 다운로드 후 `signtool` 수동 서명
- [ ] 서명/공증 적용 빌드 검증(`spctl`/`signtool`)
- [ ] `v*` 태그 릴리스 + electron-updater 리허설 (→ `v3/docs/electron_updater_runbook.md`)

## 비용/현실 노트

- macOS 공증은 사실상 필수(Gatekeeper 강제). 베타라도 적용 권장.
- Windows는 코리아SSL 토큰 보유 → **수동 로컬 서명(A안)**. 릴리스마다 토큰+`signtool` 한 번이라 인프라 부담 0. 미서명으로 베타 먼저 돌리는 것도 가능(SmartScreen 경고는 OV면 다운로드 누적으로 점차 완화). 완전 자동화가 필요해질 때만 클라우드 HSM 전환 검토.
