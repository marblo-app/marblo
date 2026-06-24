# Locales — i18n 경계 가이드

Marblo v3 UI의 한국어/영어 문자열 테이블. **무엇을 번역하고 무엇을 번역하지 않는지**가 이 문서의 핵심이다.

## 구조 (네임스페이스 분리)

```
src/locales/
├── README.md          ← 이 문서
├── ko/
│   ├── header.ts      ← header.* 키
│   ├── settings.ts    ← settings.* 키
│   ├── agents.ts      ← agents.* 키
│   ├── plan.ts        ← plan.* 키
│   └── index.ts       ← 네임스페이스 합성 + `MessageKey` 타입 (단일 진실원)
└── en/
    ├── header.ts      ← ko/header.ts 와 키 1:1 (Record<keyof typeof koHeader, string>)
    ├── settings.ts
    ├── agents.ts
    ├── plan.ts
    └── index.ts       ← Record<MessageKey, string> — 키 누락/잉여 시 컴파일 에러
```

런타임은 `src/lib/i18n.ts` (`useTranslation()` / `t()` / `useLocaleStore`). 디렉터리 인덱스
해석(`moduleResolution: bundler`) 덕분에 `import ... from "../locales/ko"` 가 `ko/index.ts` 로
자동 해석되어 런타임 코드는 무변경.

### 왜 쪼갰나

이전엔 모든 i18n PR(P1~P6)이 단일 `ko.ts`/`en.ts` 를 건드려 머지 충돌이 났다. 네임스페이스를
파일로 분리해 **각 PR이 서로 다른 파일을 만지도록** 해 병렬 작업을 가능하게 한다.

### 키 추가 방법

1. `ko/<ns>.ts` 에 `"<ns>.someKey": "한글"` 추가
2. `en/<ns>.ts` 에 **같은 키** `"<ns>.someKey": "English"` 추가 (누락 시 `tsc` 에러)
3. 컴포넌트에서 `const { t } = useTranslation(); t("<ns>.someKey")`
4. 새 네임스페이스를 만들면 `ko/index.ts`·`en/index.ts` 양쪽 `import` + 스프레드에 추가

플레이스홀더는 `{name}` 형식: `t("agents.dashboard.cleanupConfirm", { count: 5 })`.

## 번역 경계 규칙

### ✓ 번역 대상 — "UI 틀"

앱이 사용자에게 보여주는 **정적 셸 텍스트**. 이것만 locales 에 키로 넣는다.

- 버튼/메뉴/탭 라벨, 헤딩, 폼 라벨·플레이스홀더, 툴팁(`title`/`aria-label`/`alt`)
- 빈 상태·로딩·확인 다이얼로그 메시지, 토스트/알림 문구
- 설정 화면 도움말 텍스트

### ✗ 비번역 대상 — 그대로 둔다 (locales 에 넣지 말 것)

이 값들은 i18n 대상이 **아니다**. 번역하면 깨지거나 의미가 없다.

| 분류                 | 예시                                        | 이유                                            |
| -------------------- | ------------------------------------------- | ----------------------------------------------- |
| **에이전트 생성물**  | 에이전트가 출력한 메시지/코드/요약          | 런타임 LLM 산출물, 정적 테이블 밖               |
| **서버/MCP 응답**    | API·MCP 도구가 돌려준 문자열, 상태 메시지   | 백엔드 소유, 클라가 번역 책임 없음              |
| **사용자 입력**      | 프로젝트명, 태스크 제목, 채팅 내용          | 사용자가 친 값, 보존                            |
| **로그/경로/식별자** | 파일 경로, URL, 콘솔 로그, task_id, agentId | 기계 식별자, 언어 무관                          |
| **enum 내부값**      | `status: "IN_PROGRESS"`, `role: "frontend"` | 코드 식별자 — **영문 유지**. 화면엔 라벨로 매핑 |

### △ 데이터 겸 UI 라벨 — `data.*` 네임스페이스

데이터에서 온 값이지만 **고정 집합이라 라벨로 번역해야 자연스러운** 것 (상태 enum, 플랜 등급,
역할 이름의 표시명 등). 규칙:

- **저장/비교/전송되는 식별자는 영문 유지** (`"IN_PROGRESS"`, `"frontend"`).
- 화면 **표시명만** `data.*` 네임스페이스 키로 번역: 예 `data.taskStatus.IN_PROGRESS → "진행 중"/"In Progress"`.
- enum 내부값 자체를 번역하지 말 것 — 매핑 레이어(라벨)에서만 t() 적용.

> 예: `plan.*` 는 브랜드 명(Free/Pro/Team…)이라 양 로케일 동일 값이지만, 플랜 배지가 t() 로
> 일관되게 해석되도록 테이블에 둔다. 이런 "데이터 겸 라벨"의 표준 패턴이다.

## Lint 가드

`eslint.config.mjs` 가 `src/**/*.{tsx,jsx}` 에서 **새 한글 JSX 리터럴**을 `warn` 으로 잡는다
(JSXText + `title`/`placeholder`/`alt`/`label`/`aria-label` 속성). 마이그레이션 중이라 `error`
가 아닌 `warn` — 기존 한글 리터럴 다수가 있어도 `eslint .` 는 통과(경고는 exit 0)하며, P1~P6
에서 치워야 할 문자열을 가시화한다. 위 ✗/△ 예외에 해당하면 무시해도 된다.
