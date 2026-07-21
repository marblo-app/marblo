# 첫 10분 — '최초 시작 가이드' 블로그 초안 + 캡처 경로 재실증

- **작성**: 2026-07-21, frontend 에이전트
- **티켓**: uKBOQL2HFTIP9pIfMKHJ
- **선행**: `docs/first10-test1-cli-install-auth-2026-07-21.md`(FOWqen37),
  `docs/beta-churn-root-cause-analysis-2026-07-21.md`(2MiRAwZU). 사장님 A안(개발자로 좁히기) 확정.
- **규칙 준수**: 격리 워크트리, 라이브 오케 세션 무접촉. 라이브 Electron 앱에 Playwright/Electron
  부착 안 함(Me11Ze8kvI35LvONzU9F). 캡처는 gstack /browse(웹)만. mcp\_\_claude-in-chrome 미사용.
  시크릿 원문 미출력.

---

## 0. 산출물

- **블로그 초안 3개국어**: `marblo-web/content/blog/{ko,en,ja}/getting-started.mdx`
  (category=product, locales=["ko","en","ja"], hreflang 상호 연결). 기존 7카테고리/MDX 포맷 준수.
  세 로케일 모두 로컬 dev 렌더 200 OK, 이미지 8/8 로드, 리터럴 아티팩트 0 검증.
- **캡처 이미지**: 한국어판=`public/images/guide/first-run/` 4장, 영문판=`first-run/en/` 2장
  (사장님 지시 "영어·일본은 영문 버전 캡처" → en/ja 가 영문 캡처 공유). Claude pricing 은 원래 영문이라
  전 로케일 공유. + 기존 공식 가이드 SVG 재사용(언어중립).
- 구조: 사장님이 언어별 영상을 그 위에 얹기 쉽게 각 앱-내 단계에 **🎥 영상 슬롯 A~F** 마커를 배치.

## 1. 블로그가 푸는 것 — test1 이 찾은 무고지 벽 3개를 맨 앞에서 고지

test1(FOWqen37) 결론: 앱 온보딩이 **"Node.js 필요"·"유료 Claude 계정 필요"** 두 전제를 인증
시점에 한 번도 고지 안 함 → 22→6(−73%) 무성 이탈. 현행 `guide` 카피도 auth 스텝에서
"로그인(인증)만 하면 된다"만 말하고 유료/결제 언급이 없음(messages/ko.json guide.auth 확인).

블로그는 이 갭을 **역전**한다:

- **맨 앞 "★시작 전에 — BYOK"** 섹션에서 준비물 2개(유료 Claude 구독/API 키 + Node.js)를 솔직히
  선고지. "마블로 로그인은 무료지만 에이전트 실행 비용은 본인 AI 계정에서 나간다"를 명시.
- 세 벽을 시각화한 인라인 SVG Diagram(다운로드→[벽①Node]→[벽②·③인증·유료]→폴더→완주).
- 각 벽을 Step 으로 분해:
  - **벽① Node.js**: Step 2 에서 nodejs.org 실캡처 + `node -v && npm -v` 확인 명령.
  - **벽② 미인증**: Step 3-2 `claude login`, 본인 Anthropic 계정.
  - **벽③ 무자격 통과 후 크래시**: "로그인만으론 부족, 유료 자격 없으면 첫 스폰 2초 만에 죽음" 경고.
- 말미 **세 벽 트러블슈팅 표**로 증상→벽→해결 매핑.

## 2. ★캡처 경로 재실증 — 실제로 막힌 지점 (블로그·보고서 공통 기재)

"캡처하다 실제로 막히면 그 지점과 우회법을 담아라"는 지시에 따른 실측 결과:

### 막힘 A — 다운로드가 파운더 게이트 (웹, 재현됨)

- `https://marblo.app/ko/download` 를 **비로그인 신규 유저로** 열면 앱 바이너리 대신
  **"로그인이 필요해요 — 마블로 데스크탑은 선정된 파운더에게 제공됩니다"** 화면이 뜬다.
  (캡처: `01-download-login-gate.png`)
- 함의: 첫10분 퍼널의 실제 최상단은 "다운로드 클릭"이 아니라 **"파운더 선정 + 로그인"**이다.
  비선정 유저는 설치 이전에 막힌다. 블로그는 이를 숨기지 않고 **Step 0(파운더 승인→로그인→다운로드)**
  로 정직하게 안내.
- 우회법(가이드 반영): [파운더 신청](/ko/founders) → 선정 메일 → 로그인 상태로 다운로드.

### 막힘 B — 유료 자격 시각 확증 (웹, 재현됨)

- `claude.com/pricing` 실캡처(`wall2b-claude-pricing.png`)에서 **Claude Code 가 Free 플랜에 없고
  Pro/Max 유료 플랜 전용**임을 표로 확인. test1 §3 벽②·③(BYOK 이중장벽)의 시각 증거.

### 막힘 C — 앱-내 화면은 내가 직접 캡처 불가 (규칙상 blocker, 정직 고지)

- 로그인 모달 / 폴더 연결 / **CliSetupGate 인증 오버레이** / 첫 스폰 / 첫 완주(REVIEW→DONE)는
  **라이브 Electron 앱 부착 금지 규칙**(Me11Ze8kvI35LvONzU9F)상 이 에이전트가 스크린샷을 못 뜬다.
  3.0.18 dmg 를 별도 인스턴스로 띄우는 것도 단일-인스턴스 락/공유 userData 로 **라이브 오케 세션을
  건드릴 위험**이 있어 미실행.
- 우회법: (1) 블로그의 해당 단계에 **🎥 영상 슬롯 A~F** 를 배치해 사장님이 실제 앱 화면을 영상으로
  얹도록 구조화. (2) 앱-내 삽화는 기존 공식 가이드 SVG(install-run/install-autocli/project-add/
  project-orchestrator/mission-create)로 임시 채움. → 사장님 촬영 시 실화면으로 교체 권장.

## 3. 실캡처 목록 (gstack /browse, 1280 뷰포트)

| 파일                                      | 내용                                               | 쓰임                    |
| ----------------------------------------- | -------------------------------------------------- | ----------------------- |
| `first-run/00-landing.png`                | marblo.app/ko 랜딩 전체                            | (참고, 블로그 미사용)   |
| `first-run/01-download-login-gate.png`    | 다운로드 파운더 게이트(한국어)                     | ko Step 0               |
| `first-run/wall1-nodejs.png`              | nodejs.org(한국어) "Get Node.js®"                  | ko Step 2 (벽①)         |
| `first-run/wall2b-claude-pricing.png`     | Claude 요금제(=Code 유료, 영문)                    | 전 로케일 BYOK 준비물 1 |
| `first-run/en/01-download-login-gate.png` | 다운로드 파운더 게이트(영문 "Sign in to download") | en·ja Step 0            |
| `first-run/en/wall1-nodejs.png`           | nodejs.org(영문) "Get Node.js®"                    | en·ja Step 2 (벽①)      |

## 4. 검증

- MDX 렌더: 로컬 dev(next 16.2.2, port 3007) `GET /{ko,en,ja}/blog/getting-started` → **셋 다 200**.
  hreflang alternates 도 ko/en/ja + x-default 로 상호 연결 확인.
  (dev 부팅엔 `NEXT_PUBLIC_FIREBASE_API_KEY` 필요 — 격리 워크트리라 부재 → 더미 비밀 아닌 플레이스홀더로
  로컬 렌더만 확인 후 즉시 삭제. firebase client config 는 시크릿 아님; 원문 미출력.)
- 정적 검사(3개국어): JSX 스트레이 중괄호 0, `<svg>`/`<Diagram>` 태그 균형, 이미지 8/8 존재, 프론트매터 유효.
- 브라우저 검사(3개국어): `document.images` 깨진 이미지 0, 리터럴 `{#`/`](#` 아티팩트 0.
  (블로그 MDX 파이프라인에 rehype-slug 미설정 → in-page 앵커 링크는 평문 참조로 전환.)

## 5. 후속 제안 (이 티켓 범위 밖)

- **3개국어 완료**: ko/en/ja 초안 모두 작성(사장님 추가요건 반영). en/ja 는 영문 웹 캡처 공유.
  ~~초안은 ko 만~~ → 해소됨.
- **앱-내 실화면 교체**: 영상 슬롯 A~F 촬영 시 SVG 임시 삽화를 언어별 실 스크린샷/프레임으로 교체.
- **가이드 본문 카피 정합**: 앱 `messages/*.json guide.auth` 에도 BYOK 유료 고지를 넣으면 블로그와
  앱 온보딩이 같은 메시지를 말함(코드 변경 필요, 별도 티켓).
