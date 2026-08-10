# Store MCP server candidates (smoke research)

> Grok 스모크테스트 산출물 (`YczhCTwM7EPD8k0H5xzg`).  
> 조사일: 2026-08-10 · 스타 수는 당시 GitHub API 스냅샷.

에이전트/IDE 스토어에 올릴 만한 **오픈소스 MCP 서버** 3개. 인기도(스타), 실무 사용 빈도, **OSI 승인 라이선스** 여부를 기준으로 골랐다.

| # | 서버 | Repo | Stars (approx.) | 한 줄 설명 | License | OSI? |
|---|------|------|-----------------|------------|---------|------|
| 1 | **Context7** | [upstash/context7](https://github.com/upstash/context7) | **~60.5k** | 라이브러리/프레임워크 최신 버전별 문서를 LLM 컨텍스트에 주입 | MIT | Yes |
| 2 | **Playwright MCP** | [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp) | **~36.0k** | 브라우저 자동화·접근성 스냅샷 기반 UI 검증/웹 조작 | Apache-2.0 | Yes |
| 3 | **GitHub MCP** | [github/github-mcp-server](https://github.com/github/github-mcp-server) | **~32.1k** | 이슈/PR/Actions 등 GitHub 플랫폼 조작용 공식 MCP | MIT | Yes |

## 후보 상세

### 1. Context7 (Upstash)

- **URL:** https://github.com/upstash/context7
- **Stars:** ~60,508
- **License:** MIT (OSI approved)
- **Why store:** 코딩 에이전트 기본 스택으로 자주 추천됨. “오래된 트레이닝 데이터” 문제를 줄여 주는 문서 페치 MCP로 설치 가치가 분명함.

### 2. Playwright MCP (Microsoft)

- **URL:** https://github.com/microsoft/playwright-mcp
- **Stars:** ~35,950
- **License:** Apache-2.0 (OSI approved)
- **Why store:** 공식 벤더 유지보수, Chromium/Firefox/WebKit, QA·dogfood·UI 검증에 바로 쓰는 도구 세트.

### 3. GitHub MCP (GitHub Official)

- **URL:** https://github.com/github/github-mcp-server
- **Stars:** ~32,102
- **License:** MIT (OSI approved)
- **Why store:** 레포/PR/이슈/Actions를 대화형으로 다루는 사실상 표준. 원격 HTTP + OAuth 경로가 있어 데스크톱 스토어 온보딩과도 잘 맞음.

## 참고 (제외·대안)

| 후보 | 메모 |
|------|------|
| [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers) (~89k) | 레퍼런스 모노레포(filesystem, fetch 등). 라이선스 메타가 `Other`/`NOASSERTION`이라 스토어 표기 시 SPDX 재확인 필요. |
| [supabase/mcp](https://github.com/supabase/mcp) (~2.9k, Apache-2.0) | DB/백엔드 연동 니치 후보. 스타는 위 3개보다 적지만 스택 매칭 시 유용. |
| [punkpeye/awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers) | 서버가 아니라 큐레이션 리스트 — 스토어 카탈로그 소싱용. |

## 방법

- 웹 검색(베스트 MCP 서버 2026 가이드) + `gh api repos/...` 로 스타·SPDX 라이선스 재확인.
- OSI 여부: MIT·Apache-2.0 모두 OSI-approved 계열로 표기.

## 스모크 메모

이 티켓 목적 중 하나는 Grok 인증/스폰이 **팝업 없이** 끝까지 완주하는지 확인하는 것. 조사·문서·커밋·PR 경로를 끝까지 수행했다.
