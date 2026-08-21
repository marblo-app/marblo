# 왜 검색에서 안 보이는가 — 실측 진단 (2026-08-21)

티켓: `3TfYjKcE2PBOUXn1PZhq` · 대상: https://marblo.app

선행 문서와의 관계:
`SEO_GEO_AUDIT_2026_07.md`(7/22) → `SEO-GSC-INDEXING-AUDIT.md`(7/27, 8/5 후속) →
`SEO-AUDIT-2026-07-29.md`(7/29) 에서 기술 SEO 는 이미 다 잡혔다.
**이 문서는 기술 SEO 를 다시 다루지 않는다.** 그건 고칠 게 없다.
이 문서가 답하는 질문은 하나다 — 기술이 멀쩡한데 왜 트래픽이 없는가.

---

## 0. 결론 먼저

**"구글에 안 잡힌다" 는 정확한 진술이 아니다. 구글은 우리를 색인하고 있다.**
문제는 색인이 아니라 **도달**이다. 색인은 검색 결과에 나타날 자격일 뿐,
누가 우리를 찾아온다는 뜻이 아니다.

원인을 크기 순으로:

| #   | 원인                                    | 상태      | 고칠 수 있나                                |
| --- | --------------------------------------- | --------- | ------------------------------------------- |
| 1   | 도메인이 **94일**밖에 안 됐다           | 측정 완료 | ❌ 못 고친다. 기다리는 것 말고 방법이 없다  |
| 2   | 외부 링크가 **0개**다                   | 측정 완료 | ✅ 고칠 수 있다. 지금 아무것도 안 하고 있다 |
| 3   | 홈 문구가 사람들이 쓰는 검색어가 아니다 | 측정 완료 | ✅ 고칠 수 있다. 아래 §5 에 안 있음         |
| 4   | 브랜드명이 이미 40년 된 회사 것이다     | 측정 완료 | ⚠️ 우회만 가능. 이길 수는 없다              |

원인이 **아닌** 것: `www`, Search Console 미등록, robots, sitemap, canonical,
hreflang, 서버렌더. 전부 정상 확인했다. §1 · §2 참조.

---

## 1. 사장님 전제 두 개 — 둘 다 원인이 아니다

### 1.1 "www 안 해서 그런가" → 아니다

```
$ curl -o /dev/null -w "%{http_code} -> %{redirect_url}" https://www.marblo.app/
301 -> https://marblo.app/
```

`www` 는 apex 로 301 한다. 정상이다. 7/29 감사에서 이미 고쳐진 항목이고
(`fix(web): www→apex 301`, #668) 지금도 유지되고 있다.

### 1.2 "Search Console 에 등록이 안 된 것 같다" → 이미 등록돼 있다

`/ko` head 에 `google-site-verification` 메타 태그가 없는 건 사실이다.
`naver-site-verification` 만 있다. 하지만 그건 미등록의 증거가 아니었다.
**Search Console 인증은 DNS TXT 로도 된다:**

```
$ dig +short TXT marblo.app
"google-site-verification=F1w4jPWTWISn6uU_8fqoB-kPQpcFb8z4kK2YODjkYHg"
```

인증돼 있다. 그것도 메타 태그(URL-prefix 속성)보다 **상위인 도메인 속성
(Domain property)** 방식이다. 모든 서브도메인 + http/https 를 한 속성으로 덮는다.

> **메타 태그를 추가하지 마라.** 중복이고, 순위에 아무 영향이 없다.
> 이 문서를 읽는 다음 사람이 "메타 태그가 없네" 하고 또 추가하려 할 텐데, 하지 마라.

---

## 2. 색인은 되고 있다 — 숫자를 보자

Google 은 봇 차단(captcha)이라 직접 못 쟀다. Startpage(Google 결과를 그대로
프록시하는 서비스)로 우회해서 쟀다.

```
$ site:marblo.app        (Startpage = Google 소스, 2026-08-21)
/                    /en                 /ko                 /ja
/download            /ko/download        /ja/download
/ko/pricing          /ko/lectures        /ja/lectures        /ja/legal/privacy
```

**최소 10 URL 색인 확인.** 8/5 후속 점검 기록과도 일치한다.

### ⚠️ 여기는 내가 측정 못 한 구간이다 — 사장님이 채워주셔야 한다

- Startpage 1페이지 상한이 10건이고 페이지네이션이 POST 라 2페이지를 못 넘겼다.
  **총 색인 수는 모른다.** sitemap 은 75 URL 을 낸다.
- 1페이지 10건이 전부 마케팅 페이지고 **블로그 글은 한 편도 안 보인다**.
  블로그는 sitemap 에 33편 들어 있다. 이게 "블로그가 색인 안 됐다" 는 뜻인지,
  단순히 `site:` 정렬 순서 문제인지 **이 방법으로는 구분이 안 된다.**

정확한 숫자는 Search Console 에만 있다. 추측으로 채우지 않았다. §4 로.

---

## 3. 실측 3건

### 3.1 도메인 나이 — 94일. 이게 가장 큰 원인이고, 고칠 수 없다

```
$ curl https://rdap.org/domain/marblo.app
registration : 2026-05-19
expiration   : 2028-05-19
registrar    : Cloudflare
```

오늘 2026-08-21 기준 **3개월 2일**.

신규 도메인이 검색에서 자리를 잡는 데 통상 **3~6개월**이 걸린다. 우리는 이제 막
그 구간 하단에 들어섰다. **지금 트래픽이 없는 건 고장이 아니라 정상이다.**

곁가지 — `marblo.net` 에서 넘어온 자산은 0이다:

```
$ dig +short NS marblo.net
(없음 — NXDOMAIN)
```

`marblo.net → marblo.app` 마이그레이션 커밋(`df0bf5d`, 5/11)이 있지만 `marblo.net`
은 지금 DNS 자체가 없다. 물려받을 권위도 없고, 잘못 걸린 301 체인도 없다.
마이그레이션은 원인이 아니지만 **사실상 백지에서 시작한 것**이 맞다.

> 여기서 할 수 있는 일: 없다. 기다리는 게 답이다.
> 이 항목을 "개선 과제" 로 잡으면 안 된다. 시간이 지나야 하는 것이다.

### 3.2 외부 링크 — 0개. 이건 고칠 수 있는데 아무것도 안 하고 있다

```
$ Bing  "marblo.app"   (완전일치)  → marblo 언급 페이지 0건
$ Bing  site:marblo.app            → 0건 (site: 무시되고 무관한 결과로 폴백)
$ WebSearch site:marblo.app        → marblo.app 페이지 0건
```

(Mojeek·Brave·DuckDuckGo·Google 은 403/captcha 로 미측정)

**아무도 우리를 링크하지 않는다.** Bing 은 아예 색인조차 없다.

이게 왜 치명적인가: 검색엔진이 도메인을 신뢰하는 주된 근거가 "다른 데서 이걸
링크한다" 는 사실이다. 링크가 0이면 크롤러가 우리 사이트를 다시 찾아올 이유도,
우리 페이지를 남보다 위에 올릴 이유도 없다. sitemap 제출은 "여기 있어요" 라고
말하는 것이지, "여기가 중요해요" 라고 말하는 게 아니다.

**도메인 나이(§3.1)는 못 고치지만 이건 고칠 수 있다.** 그런데 지금 0이다.

### 3.3 타깃 검색어 — 홈은 빗나갔고, 블로그는 맞다

현재 홈 문구 (라이브 실측):

| 위치         | 현재 문구                                          |
| ------------ | -------------------------------------------------- |
| `title` (ko) | 마블로 — AI 에이전트 군단 워크스페이스             |
| `title` (en) | Marblo - AI Agent Army Workspace                   |
| `h1` (en)    | The Live Orchestration Control Plane for AI Agents |
| `h1` (ko)    | 코딩 에이전트를, 하나의 엔지니어링 팀으로.         |

**"에이전트 군단" · "Agent Army" · "control plane" — 이 세 개를 검색하는 사람은 없다.**
특히 "control plane" 은 인프라·SRE 용어다. 우리 고객(코딩 에이전트를 여러 개
굴리는 개발자)이 쓰는 말이 아니다.

사람들이 실제로 검색하는 말과, 그 말로 **이미 상위에 있는 경쟁자**:

| 언어 | 실제 검색 표현                              | 그 표현으로 이미 잡혀 있는 곳   |
| ---- | ------------------------------------------- | ------------------------------- |
| EN   | run multiple AI coding agents in parallel   | Vibe Kanban, KanBots, Nimbalyst |
| EN   | AI agent orchestration / orchestrator       | CodeAgentSwarm, Cline Kanban    |
| EN   | kanban for AI agents                        | KanBots, Vibe Kanban            |
| EN   | claude code parallel / multiple claude code | Claude Squad, Herdr, OpenKanban |
| KO   | 클로드 코드 병렬                            | brunch, maily                   |
| KO   | 클로드 코드 멀티에이전트                    | wikidocs                        |
| KO   | 클로드 코드 여러개 동시에                   | daleseo.com                     |
| KO   | AI 코딩 에이전트 관리                       | (블로그·뉴스레터 글들)          |

**간극의 핵심:** 우리 `description` 에는 "칸반 보드", "동시에" 가 이미 들어 있다.
그런데 **`title` 과 `h1` 에는 없다.** 검색 결과에서 사람이 클릭 여부를 정할 때
보는 건 `title` 이다. 우리는 검색어를 description 에만 숨겨놨다.

**반대로 블로그는 이미 잘 맞는다.** 예: `Claude Code 서브에이전트 실전 — 병렬로 일 시키는 법`. 이건 정확히 위 표의 검색어를 겨냥한 제목이다.
문제는 홈만 브랜드 시(詩)를 쓰고 있다는 것이다.

### 3.4 (예상 못 한 발견) 브랜드명이 이미 남의 것이다

`marblo.com` = **Marblo, 1979년 창립 실존 기업** (고형표면재·욕실용품, 컬러 3,000종).
유사 브랜드도 붐빈다 — Marblism(AI 풀스택 생성기), marbls.app, marbloid.com.

`marblo` 를 검색하면 40년 된 .com 이 상위를 가져간다. 단기간에 못 이긴다.
한글 "마블로" 는 경쟁이 덜하지만, 그건 **우리를 이미 아는 사람만 치는 검색어**다.

> 결론: **브랜드 검색어는 신규 유입 채널이 될 수 없다.**
> 신규 유입은 §3.3 의 카테고리 검색어로만 온다. 그래서 §3.3 이 중요하다.

---

## 4. 사장님이 하실 일 (Search Console 계정 작업)

인증은 이미 돼 있다. **새로 등록할 것은 없다.** 아래는 "확인" 작업이다.

1. https://search.google.com/search-console 접속
2. 속성 선택 — `marblo.app` **도메인 속성**으로 이미 있을 것이다
   (없으면 그때는 진짜 미등록이니 알려주시라. DNS TXT 는 이미 깔려 있어서
   "확인" 버튼만 누르면 바로 통과된다)
3. **페이지(Pages) 리포트** 열기 → 아래 숫자를 알려주시라:
   - 색인이 생성됨 (Indexed) — 몇 개?
   - 색인이 생성되지 않음 (Not indexed) — 몇 개? **그리고 그 사유별 내역**
     (특히 "크롤링됨 - 현재 색인이 생성되지 않음",
     "검색된 항목 - 현재 색인이 생성되지 않음" 이 몇 개인지)
4. **Sitemaps** 열기 → `sitemap.xml` 이 제출돼 있는지, 상태가 "성공" 인지.
   없으면 `sitemap.xml` 한 줄 입력해서 제출
5. **실적(Performance)** 리포트 → 최근 3개월. 노출수(Impressions)가 0인지 아닌지.
   - 노출이 **0** 이면: 아직 검색 결과에 뜨지도 않는 단계 (도메인 나이 문제)
   - 노출은 있는데 클릭이 0 이면: 뜨긴 뜨는데 아무도 안 누르는 것 (문구 문제 → §5)
     **이 둘은 처방이 완전히 다르다. 이 숫자 없이는 다음 수를 정할 수 없다.**

> §2 에서 내가 못 잰 "총 색인 수" 와 "블로그 색인 여부" 가 3번에서 나온다.
> 그 숫자를 주시면 남은 진단을 마무리하겠다.

---

## 5. 문구 정렬 안 (§3.3 처방) — 제안이지 확정이 아니다

이건 SEO 문제인 동시에 **브랜드 보이스 결정**이라 단독으로 밀지 않았다.
"군단" 은 의도된 표현일 수 있다. 아래는 안이다.

### title (검색 결과에 실제로 보이는 면)

|     | 현재                                   | 제안                                                                               |
| --- | -------------------------------------- | ---------------------------------------------------------------------------------- |
| ko  | 마블로 — AI 에이전트 군단 워크스페이스 | 마블로 — 클로드 코드·Codex 를 칸반에서 병렬로 굴리는 데스크톱                      |
| en  | Marblo - AI Agent Army Workspace       | Marblo — Run Claude Code, Codex & Antigravity Agents in Parallel on a Kanban Board |

의도: `클로드 코드` / `병렬` / `칸반` / `parallel` / `kanban` 을 title 에 넣는다.
전부 §3.3 표에서 실제로 검색되는 말이고, 지금 description 에만 있는 말이다.

### h1 (방문자에게 보이는 면)

`h1` 은 브랜드 목소리다. 바꾸더라도 title 과 다른 판단이 필요하다.
다만 영문 `h1` 의 **"control plane" 은 권한다 — 바꾸시라.** 인프라 용어라
개발자 방문자에게도 뜻이 안 통한다. 한글 `h1`("코딩 에이전트를, 하나의
엔지니어링 팀으로.")은 뜻이 통하고 좋다. 이건 그대로 둬도 된다.

> **이 PR 에는 위 문구 변경이 들어있지 않다.** 사장님 결정을 기다린다.
> 승인하시면 후속 커밋으로 바로 붙인다.

---

## 6. ★남은 것 — "등록했으니 됐다" 가 아니다

Search Console 은 **계기판이지 엔진이 아니다.** 등록해도 순위는 안 오른다.
색인은 출발선이다. 지금 우리는 출발선에 서 있고, 아직 달리지 않았다.

솔직하게: **§4 를 다 해도 순위는 안 오른다.** §4 는 "지금 어디쯤인지 숫자를
보는 일" 이지 "개선하는 일" 이 아니다. 실제로 순위를 움직이는 건 아래다.

| 남은 일                       | 왜 필요한가                       | 누가                | 예상 시간      |
| ----------------------------- | --------------------------------- | ------------------- | -------------- |
| 외부 링크 확보 (§3.2)         | 지금 0개. 크롤러가 올 이유가 없다 | 사장님/마케팅       | 즉시 착수 가능 |
| 홈 문구 검색어 정렬 (§5)      | title 에 검색어가 없다            | 프론트 (승인 대기)  | 반나절         |
| 블로그 색인 여부 확인 (§2·§4) | 33편이 안 보인다. 원인 미상       | 사장님 GSC → 프론트 | 숫자 받는 즉시 |
| 도메인 숙성                   | 94일. 방법 없음                   | —                   | **3~6개월**    |

외부 링크(§3.2)에 대해 구체적으로 — 이건 코드로 안 되고 사람이 해야 한다.
가장 값싼 순서로: 개발자 커뮤니티(GeekNews/hada.io, 커리어리, Reddit r/ClaudeAI),
Product Hunt, 그리고 §3.3 검색어를 이미 다루는 글들(brunch·wikidocs·daleseo 등)에
우리가 언급될 만한 자리 만들기. 어느 것도 프론트엔드 작업이 아니다.

### 사장님께 이렇게 말씀드릴 수 있다 / 없다

> ✅ 말할 수 있는 것
>
> - "www 는 원인이 아닙니다. 확인했습니다."
> - "Search Console 은 이미 등록돼 있습니다. DNS 로 돼 있었습니다."
> - "구글은 우리를 색인하고 있습니다. 안 잡히는 게 아닙니다."
> - "도메인이 3개월이라 지금 트래픽이 없는 건 정상입니다."
> - "외부 링크가 0개입니다. 이건 우리가 안 한 것이고, 고칠 수 있습니다."
>
> ❌ 말할 수 없는 것 — 말하지 마라
>
> - "이거 하면 SEO 됩니다" → **아니다.** 도메인 숙성은 돈이나 코드로 못 산다.
> - "Search Console 등록했으니 곧 올라옵니다" → **아니다.** 이미 등록돼 있었고,
>   그동안에도 안 올라왔다.
> - "블로그 33편이 색인 안 됐습니다" → **모른다.** 아직 확인 못 했다.
> - 총 색인 URL 수 → **모른다.** GSC 없이는 못 잰다.

---

## 부록 — 재현 명령

```bash
# 인증 방식 확인
dig +short TXT marblo.app

# 도메인 나이
curl -sL https://rdap.org/domain/marblo.app -H "Accept: application/rdap+json" \
  | python3 -c "import json,sys;[print(e['eventAction'],e['eventDate']) for e in json.load(sys.stdin)['events']]"

# 리다이렉트 체인
curl -o /dev/null -w "%{http_code} -> %{redirect_url}\n" https://www.marblo.app/
curl -o /dev/null -w "%{http_code} -> %{redirect_url}\n" https://marblo.app/

# 색인 (Google 소스, captcha 우회)
#   https://www.startpage.com/sp/search?query=site%3Amarblo.app

# 백링크
#   https://www.bing.com/search?q=%22marblo.app%22

# 구 도메인
dig +short NS marblo.net
```

## 부록 — 이건 정상이니 다시 만지지 마라

7/22 · 7/27 · 7/29 · 8/5 감사에서 이미 다뤘고, 오늘 다시 확인했다.

| 항목          | 실측                                                                 |
| ------------- | -------------------------------------------------------------------- |
| `robots.txt`  | 200, `Allow: /`, `Disallow: /api/`, sitemap 포인터                   |
| `sitemap.xml` | 200, **75 URL**, ko/en/ja 전부                                       |
| canonical     | 자기참조 정상 (`/ko` → `https://marblo.app/ko`)                      |
| hreflang      | ko·en·ja + `x-default`→`/en`. sitemap 과 일치                        |
| `robots` 메타 | `index, follow` + googlebot `max-image-preview:large`                |
| `www`         | 301 → apex                                                           |
| `llms.txt`    | 200                                                                  |
| 서버렌더      | 블로그 본문 SSR 실림 (`/ko/blog/claude-code-subagents` 본문 9,271자) |
| 내부 링크     | 블로그 인덱스 → 글 14개 링크 정상                                    |
| Naver 인증    | 메타 태그로 돼 있음                                                  |

**기술 SEO 는 고칠 게 없다. 다시 만들지 마라.**
