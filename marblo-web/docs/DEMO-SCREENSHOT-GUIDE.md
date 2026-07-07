# Demo Screenshot Guide (제품 시연 이미지)

marblo-web 랜딩/강의 페이지에 쓰이는 **제품 시연 스크린샷**을 실제 Marblo 앱의
**클린 데모 캡처**로 교체하기 위한 가이드다.

> ⚠️ **핵심 규칙 — 내부정보 노출 금지**
> 시연 이미지에는 실제 내부 티켓 제목·오케스트레이터 대화·실계정명(예: John
> Kim)·실제 PR 번호·고객/매출 데이터가 **절대** 보이면 안 된다. 아래 "데모
> 스테이징 스펙"의 **가공된(fictional) 데모 데이터만** 사용한다.

현재 리포엔 이 규칙에 맞춰 만든 **임시 플레이스홀더**(`product-demo.webp`,
`orchestration-demo.webp`)가 배선돼 있다. 실제 앱을 아래 스펙대로 연출해
캡처한 뒤 같은 파일명으로 교체하면 된다.

---

## 1. 교체 지점 (Where the images live)

| 자산 (public/images/)         | 크기      | 사용 컴포넌트 / 파일                        | 위치                                              |
| ----------------------------- | --------- | ------------------------------------------- | ------------------------------------------------- |
| **`product-demo.webp`**       | 2560×1440 | `src/components/HeroScreenshot.tsx`         | 히어로 목업(맥 윈도우 프레임) + 라이트박스 확대뷰 |
| ↳ 동일                        |           | `src/app/[locale]/layout.tsx`               | OpenGraph / Twitter 카드 이미지(SNS 공유 썸네일)  |
| **`orchestration-demo.webp`** | 2560×1440 | `src/app/[locale]/page.tsx`                 | 메인 랜딩 "이종 에이전트 오케스트레이션" 섹션     |
| ↳ 동일                        |           | `src/app/[locale]/lectures/[slug]/page.tsx` | 강의 상세 "멀티모델 대시보드" 섹션                |

- 컴포넌트는 모두 `next/image`(`<Image>`)로 렌더링하며 `width={2560} height={1440}`
  (16:9)을 기대한다. **캡처/최종 자산도 16:9(2560×1440 권장)로 맞춘다.**
- next/image가 런타임에 자동으로 webp/avif 리사이즈를 서빙하므로, 소스는 webp
  하나로 충분하다(별도 png 원본 유지 불필요).
- 이 두 파일명만 유지하면 코드 수정 없이 이미지 교체(드롭인)가 끝난다.

### 과거 자산 (제거됨)

`hero-screenshot.png`, `agent-dashboard.png` 는 내부정보가 담긴 실캡처라
이 작업에서 **git rm** 했다. 되살리지 말 것.

---

## 2. 데모 스테이징 스펙 (What to stage before capturing)

실제 Marblo v3 앱을 아래 상태로 연출한 뒤 캡처한다. **모든 텍스트는 가공된
데모 값**이며, 실제 작업/계정/대화가 화면에 남지 않도록 한다.

### 2-A. 데모 계정 / 아이덴티티

- 계정명: **John Kim 금지.** `Alex Rivera`, `Sam Park`, `Demo User` 등 가공명 사용.
- 아바타/이니셜, 이메일, 워크스페이스명에 실명·실이메일·실회사 노출 금지.
- 우상단 프로필/계정 배지가 보이면 데모 계정으로 로그인하거나 가린다.

### 2-B. 태스크 제목 (일반적이면서 그럴듯한 SaaS 백로그)

아래 6개를 보드에 채운다. (실제 마블로 내부 티켓 제목 재사용 금지)

| 제목                                      | 성격              |
| ----------------------------------------- | ----------------- |
| 인증 API 구현 (JWT 리프레시 토큰)         | 백엔드            |
| 결제 연동 (Toss 웹훅)                     | 백엔드/통합       |
| 대시보드 UI 컴포넌트                      | 프론트엔드        |
| 파일 트리 리팩터                          | 리팩터            |
| E2E 테스트 스위트                         | 테스트            |
| 검색 인덱싱 최적화 / 온보딩 튜토리얼 작성 | 기타(TODO 채움용) |

### 2-C. Board 컬럼 채움 (TODO / IN PROGRESS / REVIEW / DONE)

- **TODO(2):** 검색 인덱싱 최적화 · 온보딩 튜토리얼 작성
- **IN PROGRESS(2):** 결제 연동 (Toss 웹훅) — `claude` / 대시보드 UI 컴포넌트 — `codex`
- **REVIEW(1):** 인증 API 구현 (JWT) — `PR #42`
- **DONE(2):** 파일 트리 리팩터 · E2E 테스트 스위트
- 카드의 에이전트 배지는 실제 모델명(`claude`, `codex`, `antigravity`)만 노출 —
  개인 계정/실명은 노출하지 않는다.

### 2-D. 에이전트 터미널 (클린 데모 로그)

`claude` 에이전트가 인증 API를 구현하는 짧고 깔끔한 흐름:

```
$ implement JWT refresh rotation
Reading src/api/auth.ts …
Added refresh-token endpoint
Writing tests/auth.e2e.ts …
✓ 12 passing  (2.4s)
Committing: feat(auth): refresh rotation
→ submit_for_review
```

- 실제 사내 경로·시크릿·API 키·긴 스택트레이스가 스크롤에 남지 않게 한다.

### 2-E. 오케스트레이터 로그 (클린 데모)

```
Assigned: payments-webhook -> codex
Assigned: auth-api        -> claude
claude finished -> moved to REVIEW
Reviewing PR #42 ...
```

- 실제 오케-에이전트 대화(사용자 지시, 내부 논의)를 그대로 두지 말 것.
- **PR 번호는 가공값(#42 등)만.** 실제 마블로 PR 번호(#3xx대) 노출 금지.

### 2-F. Activity Stream

```
codex claimed 결제 연동
claude opened PR #42
E2E 테스트 스위트 → DONE
```

> 위 스펙은 리포의 플레이스홀더(`scripts/gen-demo-placeholder.py`)에 그대로
> 반영돼 있으니, 캡처 전에 플레이스홀더 이미지를 열어 "목표 화면"으로 참고하라.

---

## 3. 캡처 레시피 (How to capture)

electron 앱 실행 + 연출 + 캡처는 수동 단계다. 아래 순서로 진행한다.

### 3-A. `product-demo.webp` (메인 히어로 — 앱 전체 UI)

1. Marblo v3 데스크톱 앱을 **데모 계정**으로 로그인해 실행.
2. 데모 프로젝트를 열고 **§2 스펙대로** 보드/터미널/Activity를 연출.
   - 좌측 **파일 트리** 패널, 중앙 **칸반 보드(4컬럼)**, 우측 **에이전트+오케
     터미널 + Activity** 가 한 화면에 보이도록 레이아웃.
3. 창을 **16:9 비율**로 리사이즈(예: 2560×1440 또는 1920×1080). macOS는
   Retina라 1280×720 논리 크기로도 2560×1440 물리 픽셀이 나온다.
4. 다크 테마 확인, 우상단 실계정 배지/알림 배너 없는지 확인.
5. **창 단위 캡처**: macOS `Shift+Cmd+4` → `Space` → 창 클릭 (그림자 제외하려면
   `Option` 누른 채 클릭). 결과 PNG를 `product-demo-raw.png` 로 저장.

### 3-B. `orchestration-demo.webp` (오케스트레이션 대시보드)

1. 오케스트레이터가 **Claude / GPT·Codex / Antigravity** 3개 에이전트에 태스크를
   분배하는 뷰(플로우/대시보드)를 연다.
2. 각 에이전트 노드에 §2-B 태스크 + 상태(REVIEW·PR #42 / IN PROGRESS / DONE) 표시.
3. 위와 동일하게 16:9로 리사이즈 후 창 캡처 → `orchestration-demo-raw.png`.

### 3-C. 최적화 & 드롭인 (raw PNG → 최종 webp)

캡처한 raw PNG를 `marblo-web/public/images/` 에 두고 리포 루트에서:

```bash
cd marblo-web
# 2560 폭으로 리사이즈 + webp 90% 품질 변환
cwebp -q 90 -resize 2560 0 public/images/product-demo-raw.png \
  -o public/images/product-demo.webp
cwebp -q 90 -resize 2560 0 public/images/orchestration-demo-raw.png \
  -o public/images/orchestration-demo.webp
# raw PNG는 커밋하지 말 것 (내부정보/용량). 변환 후 삭제.
rm public/images/*-raw.png
```

- `cwebp`가 없으면 `brew install webp`.
- 파일명을 그대로 두면 코드 수정 없이 교체 완료. `npm run build` 로 확인.
- 목표 용량: 각 200KB 이하 (플레이스홀더는 ~45–70KB).

---

## 4. 플레이스홀더 재생성 (참고)

현재 배선된 임시 플레이스홀더는 아래로 재생성할 수 있다(실캡처 확보 전 임시용):

```bash
cd marblo-web
OUT_DIR="$(pwd)/public/images" python3 scripts/gen-demo-placeholder.py
```

- PIL(Pillow) 필요. 플레이스홀더에는 "PLACEHOLDER — replace with clean app
  capture" 워터마크가 박혀 있어, 실캡처로 교체되지 않은 채 배포되는 사고를 막는다.
- **실캡처로 교체 시 이 스크립트는 더 이상 실행하지 않는다.**

---

## 5. 교체 체크리스트

- [ ] §2 스펙대로 앱 연출 (데모 계정 · 가공 태스크 · 클린 로그)
- [ ] 실명/실이메일/실 PR번호/내부 대화 화면에 없음 확인
- [ ] `product-demo.webp` (앱 전체) 16:9 캡처 → 변환 → 드롭인
- [ ] `orchestration-demo.webp` (오케 대시보드) 16:9 캡처 → 변환 → 드롭인
- [ ] `*-raw.png` 삭제(커밋 금지)
- [ ] `npm run build` clean, 히어로/랜딩/강의 페이지 육안 확인
- [ ] 워터마크 없는 최종본인지 확인
