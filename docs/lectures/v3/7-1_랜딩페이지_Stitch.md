---
tags: [강의, v3, 모듈7]
type: lecture
aliases: [SaaS 랜딩페이지 디자인]
---

# SaaS 랜딩페이지 디자인 — Stitch MCP

> 모듈 7 · 섹션 7-1 · 약 40분
> 관련: [[6-4_CICD_파이프라인]] | [[7-2_런칭_체크리스트]]

---

## 도입 (5분)

여러분, 지금까지 정말 대단한 여정을 해왔습니다. 모듈 4에서 AI YouTube Insight SaaS의 백엔드와 프론트엔드를 만들었고, 모듈 5에서 멀티모델로 효율을 극대화했고, 모듈 6에서 GCP에 배포까지 했죠?

화면: 슬라이드 — "코드는 완성. 그런데... 사용자는?"

그런데 중요한 게 하나 빠져 있습니다. **랜딩페이지**입니다. 아무리 기능이 뛰어나도, 사용자가 처음 접속했을 때 "이게 뭔데? 왜 써야 하는데?"라는 질문에 3초 안에 답하지 못하면 이탈합니다. SaaS 랜딩페이지의 평균 이탈률이 70% 이상이에요. 즉 10명 중 7명은 첫 화면만 보고 떠납니다.

그래서 이번 섹션에서는 **Stitch MCP**라는 도구를 활용해서, 디자인에서 코드까지 AI 에이전트가 자동으로 만들어주는 랜딩페이지 빌드 과정을 다뤄보겠습니다.

### Stitch MCP란?

화면: Stitch 로고 + 개념 다이어그램

**Stitch**는 Figma 디자인을 코드로 변환하는 MCP 서버입니다. 기존에도 Figma-to-code 도구들이 있었지만, Stitch의 차별점은:

1. **MCP 프로토콜 기반**: Claude Code에서 직접 호출 가능
2. **컴포넌트 단위 변환**: 전체 페이지가 아니라 Hero, Pricing, CTA 등 개별 섹션 단위로 변환
3. **Next.js / Tailwind 네이티브**: 우리 프로젝트와 바로 호환
4. **반응형 자동 적용**: 데스크톱, 태블릿, 모바일 세 가지 뷰를 자동 생성

즉, 디자이너가 Figma에서 그린 것을 Stitch MCP가 읽어서, 마블로 에이전트가 Next.js 컴포넌트로 바로 변환하는 겁니다.

---

## 본문 1: Stitch MCP 설정 (5분)

화면: 터미널 — MCP 설정 파일

**(실습)** 먼저 Stitch MCP를 우리 프로젝트에 연결합시다.

### 1-a: Stitch MCP 설치

```bash
# Stitch MCP 서버 설치
npm install -g @stitch-mcp/server

# 설치 확인
stitch-mcp --version
```

### 1-b: Claude Code에 MCP 서버 등록

Claude Code의 MCP 설정 파일에 Stitch를 추가합니다:

```json
// ~/.claude/mcp_servers.json (또는 프로젝트 루트의 .mcp.json)
{
  "mcpServers": {
    "marblo": {
      "command": "node",
      "args": ["/path/to/marblo/mcp-server/dist/index.js"]
    },
    "stitch": {
      "command": "stitch-mcp",
      "args": ["--figma-token", "YOUR_FIGMA_ACCESS_TOKEN"]
    }
  }
}
```

화면: 설정 파일 편집 화면

**Figma Access Token 발급 방법:**

1. Figma 로그인 → Settings → Account
2. "Personal access tokens" 섹션
3. "Create a new personal access token"
4. 토큰 이름: `stitch-mcp`
5. 생성된 토큰 복사

```bash
# 환경변수로 설정해도 됩니다
export FIGMA_ACCESS_TOKEN="figd_xxxxxxxxxxxx"
```

### 1-c: 연결 확인

Claude Code를 재시작하고 MCP 연결을 확인합니다:

```bash
claude
# Claude Code 시작 후
/mcp
# 출력:
# - marblo: connected
# - stitch: connected
```

두 MCP 서버 모두 connected 상태면 준비 완료입니다.

---

## 본문 2: 랜딩페이지 구조 설계 (7분)

화면: 슬라이드 — SaaS 랜딩페이지 레이아웃

자, 코드를 짜기 전에 랜딩페이지의 구조부터 잡아봅시다. SaaS 랜딩페이지에는 검증된 패턴이 있어요.

### 핵심 섹션 구성

```
┌──────────────────────────────────┐
│         Navigation Bar            │  ← 로고 + 메뉴 + CTA 버튼
├──────────────────────────────────┤
│                                  │
│          Hero Section             │  ← 핵심 가치 제안 (3초 설명)
│   "AI가 유튜브를 분석합니다"        │
│       [무료로 시작하기]             │
│                                  │
├──────────────────────────────────┤
│        Features Section           │  ← 주요 기능 3~4개
│   🔍 분석  📊 리포트  ⏰ 자동화    │
├──────────────────────────────────┤
│       How It Works                │  ← 3단계 사용법
│    1 → 2 → 3 간단 플로우           │
├──────────────────────────────────┤
│        Pricing Section            │  ← 가격표 (Free / Pro / Enterprise)
├──────────────────────────────────┤
│      Testimonials                 │  ← 사용 후기
├──────────────────────────────────┤
│        CTA Section                │  ← 최종 행동 유도
│    "지금 시작하세요" 버튼            │
├──────────────────────────────────┤
│          Footer                   │  ← 링크, 소셜미디어, 법적 고지
└──────────────────────────────────┘
```

화면: 실제 성공한 SaaS 랜딩페이지 예시 (Vercel, Linear 등)

### 각 섹션의 역할

| 섹션 | 목적 | 전환율 기여 |
|------|------|------------|
| Hero | 3초 안에 가치 전달 | 가장 중요 — 여기서 70% 이탈 결정 |
| Features | "이게 뭘 해주는데?" | 관심 유지 |
| How It Works | "어떻게 쓰는 거야?" | 사용 장벽 낮춤 |
| Pricing | "얼마야?" | 구매 의사 결정 |
| CTA | "지금 하자!" | 최종 전환 |

이 구조를 그대로 따라갈 겁니다.

---

## 본문 3: 마블로 에이전트로 랜딩페이지 빌드 (15분)

화면: 마블로 앱 — 오케스트레이터 터미널

자, 이제 본격적으로 만들어봅시다. **(실습)** 시작합니다.

### 3-a: 오케스트레이터에 요구사항 전달

마블로 오케스트레이터에 다음을 입력합니다:

```
/tf-analyze 우리 AI SaaS의 랜딩페이지.
Hero 섹션 + 기능 소개 + 가격표 + CTA 버튼.
Stitch MCP로 디자인 → Next.js 컴포넌트.
```

화면: 오케스트레이터가 태스크를 분해하는 과정

오케스트레이터가 이 요구사항을 분석해서 다음과 같은 태스크들을 생성합니다:

```
칸반 보드:
├── TASK-001: Hero 섹션 컴포넌트 생성          [frontend]
├── TASK-002: Features 섹션 컴포넌트 생성       [frontend]
├── TASK-003: Pricing 테이블 컴포넌트 생성      [frontend]
├── TASK-004: CTA + Footer 컴포넌트 생성       [frontend]
├── TASK-005: 전체 페이지 조합 + 라우팅 설정     [frontend]
└── TASK-006: SEO 메타태그 + OG 이미지 설정     [frontend]
```

화면: 칸반 보드에 태스크가 생성된 모습

### 3-b: Stitch MCP 호출 과정

에이전트가 Stitch MCP를 호출하는 과정을 관찰해봅시다. 터미널에서 이런 흐름이 보입니다:

```
[Agent: Claude-Frontend]
→ MCP Call: stitch.get_design_tokens
  - file_key: "abc123xyz"
  - node_id: "hero-section"
→ Response: { colors, typography, spacing, layout }

→ MCP Call: stitch.generate_component
  - design_tokens: {...}
  - framework: "nextjs"
  - styling: "tailwind"
→ Response: { component_code, styles }
```

화면: 에이전트 터미널에서 MCP 호출 로그가 스크롤

Stitch MCP가 Figma 디자인 토큰(색상, 타이포그래피, 간격)을 읽어서, 그걸 기반으로 Next.js 컴포넌트 코드를 자동 생성하는 겁니다.

### 3-c: 생성되는 코드 살펴보기

에이전트가 만든 Hero 섹션을 보겠습니다:

화면: VS Code — HeroSection.tsx 파일

```tsx
// src/components/landing/HeroSection.tsx
"use client";

import { Button } from "@/components/ui/button";
import { ArrowRight, Play } from "lucide-react";
import { motion } from "framer-motion";

export default function HeroSection() {
  return (
    <section className="relative min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      {/* 배경 그라데이션 + 패턴 */}
      <div className="absolute inset-0 bg-grid-white/[0.02]" />

      <div className="container mx-auto px-6 text-center relative z-10">
        {/* 배지 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="inline-flex items-center gap-2 bg-purple-500/10 border border-purple-500/20 rounded-full px-4 py-2 mb-8"
        >
          <span className="text-purple-400 text-sm font-medium">
            New: AI 멀티모델 분석 지원
          </span>
          <ArrowRight className="w-4 h-4 text-purple-400" />
        </motion.div>

        {/* 메인 헤드라인 */}
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="text-5xl md:text-7xl font-bold text-white mb-6 leading-tight"
        >
          AI가 유튜브를 분석합니다.
          <br />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400">
            인사이트는 당신의 것.
          </span>
        </motion.h1>

        {/* 서브 헤드라인 */}
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="text-xl text-gray-300 mb-10 max-w-2xl mx-auto"
        >
          유튜브 영상 URL 하나면 충분합니다. AI가 핵심 내용을 요약하고,
          트렌드를 분석하고, 인사이트 리포트를 자동 생성합니다.
        </motion.p>

        {/* CTA 버튼 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="flex flex-col sm:flex-row gap-4 justify-center"
        >
          <Button size="lg" className="bg-purple-600 hover:bg-purple-700 text-lg px-8 py-6">
            무료로 시작하기
            <ArrowRight className="ml-2 w-5 h-5" />
          </Button>
          <Button size="lg" variant="outline" className="text-lg px-8 py-6 border-gray-600 text-gray-300 hover:bg-gray-800">
            <Play className="mr-2 w-5 h-5" />
            데모 보기
          </Button>
        </motion.div>
      </div>
    </section>
  );
}
```

보세요. Stitch MCP가 Figma 디자인을 기반으로 Tailwind CSS 클래스, Framer Motion 애니메이션, 반응형 레이아웃까지 자동으로 생성했습니다.

### 3-d: Pricing 컴포넌트

화면: VS Code — PricingSection.tsx

가격표도 봅시다:

```tsx
// src/components/landing/PricingSection.tsx
const plans = [
  {
    name: "Free",
    price: "0",
    description: "시작해보세요",
    features: [
      "월 10건 분석",
      "기본 요약 리포트",
      "1개 채널 트래킹",
    ],
    cta: "무료로 시작",
    highlighted: false,
  },
  {
    name: "Pro",
    price: "29,000",
    description: "본격적인 분석을 위해",
    features: [
      "무제한 분석",
      "AI 인사이트 리포트",
      "트렌드 분석 대시보드",
      "10개 채널 트래킹",
      "이메일 알림",
    ],
    cta: "Pro 시작하기",
    highlighted: true,
  },
  {
    name: "Enterprise",
    price: "문의",
    description: "팀과 함께",
    features: [
      "Pro의 모든 기능",
      "팀 워크스페이스",
      "API 접근",
      "전담 지원",
      "커스텀 리포트",
    ],
    cta: "문의하기",
    highlighted: false,
  },
];
```

### 3-e: 전체 페이지 조합

마지막으로 랜딩 페이지를 조합합니다:

화면: VS Code — page.tsx

```tsx
// src/app/page.tsx (또는 src/app/landing/page.tsx)
import HeroSection from "@/components/landing/HeroSection";
import FeaturesSection from "@/components/landing/FeaturesSection";
import HowItWorks from "@/components/landing/HowItWorks";
import PricingSection from "@/components/landing/PricingSection";
import CTASection from "@/components/landing/CTASection";
import Footer from "@/components/landing/Footer";

export default function LandingPage() {
  return (
    <main>
      <HeroSection />
      <FeaturesSection />
      <HowItWorks />
      <PricingSection />
      <CTASection />
      <Footer />
    </main>
  );
}
```

화면: 브라우저 — 완성된 랜딩페이지 미리보기

---

## 본문 4: 반응형 + SEO 처리 (8분)

화면: 브라우저 DevTools — 모바일 뷰

### 반응형 디자인

Tailwind CSS의 반응형 클래스를 Stitch가 자동으로 적용하지만, 몇 가지는 직접 확인해야 합니다.

**(실습)** 브라우저 DevTools에서 확인합시다:

```
F12 → Toggle Device Toolbar (Ctrl+Shift+M)
→ iPhone 14 Pro 선택
→ iPad 선택
→ Desktop 1920px 선택
```

**체크포인트:**

- [ ] Hero 텍스트가 모바일에서 줄바꿈이 자연스러운가?
- [ ] Pricing 카드가 모바일에서 세로로 쌓이는가?
- [ ] CTA 버튼이 모바일에서 터치 영역 충분한가? (최소 44x44px)
- [ ] 이미지가 모바일에서 잘리지 않는가?

문제가 있다면 에이전트에게 수정을 요청합니다:

```
Pricing 카드가 모바일에서 겹쳐요. 768px 미만에서 세로 스택으로 변경해주세요.
```

### SEO 메타태그

화면: VS Code — layout.tsx

검색 엔진 최적화도 중요합니다:

```tsx
// src/app/layout.tsx
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "YouTube Insight AI — 유튜브 영상을 AI로 분석하세요",
  description:
    "유튜브 영상 URL 하나면 AI가 핵심 요약, 트렌드 분석, 인사이트 리포트를 자동 생성합니다. 무료로 시작하세요.",
  keywords: ["유튜브 분석", "AI 요약", "YouTube Insight", "트렌드 분석"],
  openGraph: {
    title: "YouTube Insight AI",
    description: "AI가 유튜브를 분석합니다. 인사이트는 당신의 것.",
    url: "https://youtube-insight.ai",
    siteName: "YouTube Insight AI",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "YouTube Insight AI",
      },
    ],
    locale: "ko_KR",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "YouTube Insight AI",
    description: "AI가 유튜브를 분석합니다.",
    images: ["/og-image.png"],
  },
};
```

**OG 이미지**도 중요해요. 소셜미디어에서 링크를 공유했을 때 보이는 썸네일입니다. 1200x630px로 만들어야 하고, 서비스명과 핵심 가치가 한눈에 보여야 합니다.

```bash
# OG 이미지 생성은 Vercel의 @vercel/og 패키지로 동적 생성 가능
npm install @vercel/og
```

---

## 정리 (3분)

화면: 최종 결과물 스크린샷 + 체크리스트

오늘 40분 동안 한 일을 정리합시다:

- [x] **Stitch MCP 설정** — Figma ↔ Claude Code 연결
- [x] **랜딩페이지 구조 설계** — Hero, Features, Pricing, CTA 6개 섹션
- [x] **마블로 에이전트로 빌드** — `/tf-analyze` → 자동 태스크 분해 → 컴포넌트 생성
- [x] **Stitch MCP 활용** — Figma 디자인 토큰 → Next.js 컴포넌트 자동 변환
- [x] **반응형 확인** — 모바일, 태블릿, 데스크톱 세 가지 뷰
- [x] **SEO 메타태그** — Open Graph, Twitter Card, 키워드

핵심은 이겁니다: **디자이너가 Figma에서 그린 것을 AI 에이전트가 코드로 변환하고, 마블로가 그 과정을 관리한다.** 디자인 → 코드의 간극을 Stitch MCP가 메워주는 거죠.

다음 섹션에서는 이 랜딩페이지를 실제로 런칭하기 위한 체크리스트를 다루겠습니다. 도메인, SSL, 에러 모니터링, 법적 페이지까지요.

---
다음: [[7-2_런칭_체크리스트]]
