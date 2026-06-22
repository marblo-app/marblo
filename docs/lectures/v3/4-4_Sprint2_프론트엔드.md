---
tags: [강의, v3, 모듈4]
type: lecture
aliases: [Sprint 2 프론트엔드]
---

# Sprint 2 — 프론트엔드 + 병렬 처리

> 모듈 4 · 섹션 4-4 · 약 50분
> 관련: [[4-3_Sprint1_백엔드]] | [[4-5_Sprint3_통합리뷰]]

> 🗄️ **[구버전 · M5로 이동]** 이 문서는 구 모듈4(ReachWave / P3) 자료입니다. 강의 재편(재작성 청사진 기준)으로 **모듈 5(실전 SaaS 스프린트, P3)**로 이동·재집필되었습니다. 최신 본문은 신 **[[5-4_Sprint2_프론트_병렬통합]]** 를 보세요.
> 신 모듈4는 **P2 날씨 대시보드 멀티에이전트 협업**(Claude + Codex)으로 바뀌었습니다 → [[4-4_리뷰거버넌스_반려재작업]].

---

## 도입 (5분)

Sprint 1에서 백엔드 기초를 다졌습니다. DB 스키마, 인증 API, YouTube 메타데이터, 자막 추출, Claude 분석까지. 이제 **프론트엔드가 본격적으로 시작**되는 Sprint 2입니다.

화면: 칸반 보드 — 백엔드 태스크 대부분 DONE, 프론트엔드 태스크 활성화

이번 Sprint의 핵심 포인트는 **병렬 처리**입니다:

- Backend Agent가 남은 백엔드 태스크(TASK-006, 007)를 처리하는 **동시에**
- Frontend Agent가 UI 태스크(TASK-008~014)를 처리합니다

두 에이전트가 동시에 일하는 모습을 실시간으로 보게 될 거예요. PM으로서 두 흐름을 모두 관리해야 하는데, 이게 처음에는 좀 정신없을 수 있습니다. 하지만 칸반 보드와 `/tf-status`가 있으니 괜찮아요.

---

## 본문

### 현재 상태 확인 (3분)

**(실습)** 먼저 현재 프로젝트 상태를 확인합시다:

```bash
/tf-status
```

화면: `/tf-status` 출력 — 진행률 ~40%

```
📊 Progress: ███████░░░░░░░░░░ 7/18 (39%)

DONE (7):
  ✅ TASK-001  DB 스키마 설계               DONE
  ✅ TASK-002  사용자 인증 API              DONE
  ✅ TASK-003  YouTube 메타데이터 API        DONE
  ✅ TASK-004  YouTube 자막 추출 API         DONE
  ✅ TASK-005  Claude API 분석 엔드포인트    DONE
  ✅ TASK-015  Docker Compose 설정           DONE
  ✅ TASK-016  환경 변수 + 설정 관리         DONE

IN_PROGRESS (4):
  🔨 TASK-006  분석 결과 저장/조회 API      @Backend-Agent
  🔨 TASK-007  사용량 제한 미들웨어         @Backend-Agent
  🔨 TASK-008  로그인/회원가입 UI           @Frontend-Agent
  🔨 TASK-009  URL 입력 폼 컴포넌트         @Frontend-Agent

TODO (5):
  ⏳ TASK-010  분석 진행 상태 UI            (blocked: 005 ✅ → unblocked!)
  ⏳ TASK-011  인사이트 카드 컴포넌트       (blocked: 005 ✅ → unblocked!)
  ⏳ TASK-012  분석 상세 페이지             (blocked: 011)
  ⏳ TASK-013  대시보드 (히스토리 목록)     (blocked: 006, 012)
  ⏳ TASK-014  검색 기능                    (blocked: 013)

Agents:
  Backend Agent   : WORKING on TASK-006, TASK-007
  Frontend Agent  : WORKING on TASK-008, TASK-009
  DevOps Agent    : IDLE (all tasks DONE)
  Test Agent      : IDLE (waiting for dependencies)
```

보이시죠? **Backend Agent와 Frontend Agent가 동시에 4개 태스크를 처리** 중입니다. DevOps Agent는 자기 할 일(Docker 설정)을 이미 다 끝냈고, Test Agent는 아직 기다리는 중이에요.

### TASK-008: 로그인/회원가입 UI 관찰 (7분)

화면: Frontend Agent 터미널 — TASK-008 작업 로그

Frontend Agent가 만드는 로그인 UI를 봅시다:

```
[Frontend Agent] TASK-008: 로그인/회원가입 UI
[Frontend Agent] Creating frontend/src/app/login/page.tsx
[Frontend Agent] Creating frontend/src/app/register/page.tsx
[Frontend Agent] Creating frontend/src/components/auth/LoginForm.tsx
[Frontend Agent] Creating frontend/src/lib/auth.ts
```

```tsx
// frontend/src/components/auth/LoginForm.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ username: email, password }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || "로그인에 실패했습니다");
      }

      const { access_token } = await res.json();
      localStorage.setItem("token", access_token);
      router.push("/dashboard");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-md mx-auto">
      <h1 className="text-2xl font-bold text-center">로그인</h1>
      {error && (
        <div className="bg-red-50 text-red-500 p-3 rounded">{error}</div>
      )}
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="이메일"
        className="w-full p-3 border rounded-lg"
        required
      />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="비밀번호"
        className="w-full p-3 border rounded-lg"
        required
      />
      <button
        type="submit"
        disabled={loading}
        className="w-full p-3 bg-blue-600 text-white rounded-lg
                   hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? "로그인 중..." : "로그인"}
      </button>
    </form>
  );
}
```

TailwindCSS로 깔끔한 폼을 만들었네요. 로딩 상태, 에러 표시, API 연동까지 기본적인 것들이 다 들어있습니다.

### TASK-009: URL 입력 폼 컴포넌트 (5분)

화면: Frontend Agent 터미널 — TASK-009

```tsx
// frontend/src/components/analysis/URLInputForm.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function URLInputForm() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  const isValidYouTubeURL = (url: string) => {
    const pattern =
      /^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)[\w-]+/;
    return pattern.test(url);
  };

  const handleAnalyze = async () => {
    if (!isValidYouTubeURL(url)) {
      setError("유효한 YouTube URL을 입력해주세요");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const token = localStorage.getItem("token");
      const res = await fetch("/api/youtube/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ url }),
      });

      if (!res.ok) throw new Error("분석 요청에 실패했습니다");

      const data = await res.json();
      router.push(`/analysis/${data.analysis_id}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h2 className="text-xl font-semibold mb-4">YouTube 영상 분석</h2>
      <div className="flex gap-3">
        <input
          type="url"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setError("");
          }}
          placeholder="YouTube URL을 붙여넣으세요"
          className="flex-1 p-3 border rounded-lg text-lg"
        />
        <button
          onClick={handleAnalyze}
          disabled={loading || !url}
          className="px-6 py-3 bg-purple-600 text-white rounded-lg
                     hover:bg-purple-700 disabled:opacity-50 font-medium"
        >
          {loading ? "분석 중..." : "분석하기"}
        </button>
      </div>
      {error && <p className="text-red-500 mt-2 text-sm">{error}</p>}
    </div>
  );
}
```

YouTube URL 유효성 검증, 로딩 상태, 에러 처리까지. 사용자 경험을 고려한 코드입니다.

### PM 피드백 실습 — `/tf-feedback` (8분)

자, 여기서 PM으로서 피드백을 줘봅시다. URL 입력 폼이 REVIEW로 올라왔는데, 개선할 점이 보입니다.

**(실습)** 리뷰 후 피드백:

```bash
/tf-review TASK-009
```

코드를 보니 괜찮은데, 몇 가지 추가하고 싶은 게 있어요:

```bash
R
> 1. URL 붙여넣기 시 자동으로 분석 시작하는 옵션 추가
> 2. 최근 분석한 URL 3개를 아래에 표시해주세요 (빠른 재분석용)
> 3. 유효하지 않은 URL일 때 입력 필드 테두리를 빨간색으로
```

```
🔄 TASK-009 Rejected with feedback
  → Frontend Agent: 피드백 반영 작업 시작
```

화면: Frontend Agent 터미널 — 피드백 반영 작업 로그

에이전트가 피드백을 읽고 수정합니다:

```
[Frontend Agent] Processing feedback for TASK-009
[Frontend Agent] Adding auto-paste analysis option
[Frontend Agent] Adding recent URLs section
[Frontend Agent] Updating input validation styling
[Frontend Agent] TASK-009: IN_PROGRESS → REVIEW (updated)
```

수정이 끝나면 다시 REVIEW로 올라오고, 다시 확인합니다:

```bash
/tf-review TASK-009
```

이번엔 피드백이 잘 반영되었네요. Approve!

**이 피드백 루프가 PM의 핵심 도구입니다.** 에이전트한테 모든 걸 맡기되, 방향은 PM이 잡는 거예요.

### TASK-011: 인사이트 카드 — 서비스의 얼굴 (7분)

이제 가장 중요한 프론트엔드 컴포넌트를 봅시다:

화면: Frontend Agent — TASK-011 인사이트 카드

```tsx
// frontend/src/components/analysis/InsightCard.tsx
interface InsightCardProps {
  analysis: {
    summary: string;
    key_points: string[];
    keywords: string[];
    action_items: string[];
    video: {
      title: string;
      channel_name: string;
      thumbnail_url: string;
      duration: number;
    };
  };
}

export default function InsightCard({ analysis }: InsightCardProps) {
  return (
    <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
      {/* 영상 정보 헤더 */}
      <div className="relative">
        <img
          src={analysis.video.thumbnail_url}
          alt={analysis.video.title}
          className="w-full h-48 object-cover"
        />
        <div
          className="absolute bottom-2 right-2 bg-black/70 text-white
                        px-2 py-1 rounded text-sm"
        >
          {formatDuration(analysis.video.duration)}
        </div>
      </div>

      <div className="p-6 space-y-4">
        {/* 영상 제목 + 채널 */}
        <div>
          <h3 className="text-lg font-bold">{analysis.video.title}</h3>
          <p className="text-gray-500 text-sm">{analysis.video.channel_name}</p>
        </div>

        {/* AI 요약 */}
        <div className="bg-purple-50 p-4 rounded-lg">
          <h4 className="font-semibold text-purple-700 mb-2">AI 요약</h4>
          <p className="text-gray-700 leading-relaxed">{analysis.summary}</p>
        </div>

        {/* 핵심 포인트 */}
        <div>
          <h4 className="font-semibold mb-2">핵심 포인트</h4>
          <ul className="space-y-2">
            {analysis.key_points.map((point, i) => (
              <li key={i} className="flex items-start gap-2">
                <span
                  className="bg-blue-100 text-blue-700 rounded-full
                               w-6 h-6 flex items-center justify-center
                               text-sm flex-shrink-0 mt-0.5"
                >
                  {i + 1}
                </span>
                <span className="text-gray-700">{point}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* 키워드 태그 */}
        <div className="flex flex-wrap gap-2">
          {analysis.keywords.map((kw, i) => (
            <span
              key={i}
              className="bg-gray-100 text-gray-600 px-3 py-1
                                     rounded-full text-sm"
            >
              #{kw}
            </span>
          ))}
        </div>

        {/* 추천 행동 */}
        <div className="border-t pt-4">
          <h4 className="font-semibold mb-2">추천 행동</h4>
          {analysis.action_items.map((item, i) => (
            <div key={i} className="flex items-center gap-2 mb-1">
              <span className="text-green-500">→</span>
              <span className="text-gray-600 text-sm">{item}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

화면: 인사이트 카드 렌더링 미리보기 — 썸네일 + AI 요약 + 핵심 포인트 + 키워드 태그

이 카드가 서비스의 **핵심 UI**입니다. 사용자가 가장 많이 보는 화면이죠. 디자인, 정보 구조, 가독성을 꼼꼼히 리뷰하세요.

**(실습)** 리뷰:

```bash
/tf-review TASK-011
```

**체크리스트:**

- [ ] 썸네일이 정상 표시되는가?
- [ ] AI 요약이 충분히 읽기 편한가?
- [ ] 핵심 포인트 번호 매기기가 깔끔한가?
- [ ] 키워드 태그가 많아질 때 레이아웃이 깨지지 않는가?
- [ ] 모바일에서도 잘 보이는가? (반응형)

### 병렬 처리 현황 모니터링 (5분)

Sprint 2 중간쯤 되면 이런 상태가 됩니다:

화면: 칸반 보드 — 다양한 상태의 카드들

```bash
/tf-status
```

```
📊 Progress: ██████████████░░░ 13/18 (72%)

Active:
  🔨 TASK-012  분석 상세 페이지      @Frontend-Agent
  🔨 TASK-013  대시보드 (히스토리)    @Frontend-Agent  (partially blocked)
  ✅ TASK-006  분석 결과 저장 API     REVIEW @Backend-Agent

Agents working: 2 / 4
Estimated completion: ~25 minutes
```

72%! 10개 이상의 태스크가 완료되었고, 프론트엔드의 핵심 화면들이 만들어지고 있습니다. Backend Agent는 마지막 태스크를 리뷰 대기 중이고, Frontend Agent가 남은 UI를 열심히 만들고 있어요.

### TASK-013: 대시보드 — 전체 모습 (5분)

화면: Frontend Agent — TASK-013 대시보드

대시보드는 사용자의 분석 히스토리를 보여주는 메인 화면입니다:

```tsx
// frontend/src/app/dashboard/page.tsx
export default async function DashboardPage() {
  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">내 분석 대시보드</h1>
        <URLInputForm compact />
      </div>

      {/* 통계 카드 */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <StatCard label="총 분석" value={stats.total} />
        <StatCard label="이번 주" value={stats.thisWeek} />
        <StatCard label="남은 횟수" value={stats.remaining} />
      </div>

      {/* 최근 분석 목록 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {analyses.map((analysis) => (
          <InsightCard key={analysis.id} analysis={analysis} />
        ))}
      </div>
    </div>
  );
}
```

통계 요약 + 인사이트 카드 그리드. 깔끔한 대시보드가 완성되었습니다.

### TASK-014: 검색 기능 (5분)

마지막 프론트엔드 태스크:

```tsx
// frontend/src/components/SearchBar.tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import { useDebounce } from "@/hooks/useDebounce";

export default function SearchBar({
  onSearch,
}: {
  onSearch: (q: string) => void;
}) {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounce(query, 300);

  useEffect(() => {
    onSearch(debouncedQuery);
  }, [debouncedQuery, onSearch]);

  return (
    <input
      type="search"
      value={query}
      onChange={(e) => setQuery(e.target.value)}
      placeholder="분석 결과 검색..."
      className="w-full p-3 border rounded-lg"
    />
  );
}
```

디바운싱 적용된 검색 — 사용자가 타이핑할 때마다 API를 호출하지 않고, 300ms 대기 후에 검색합니다. 이런 작은 UX 디테일까지 에이전트가 챙겨주네요.

---

## 정리

Sprint 2에서 진행된 내용:

1. **프론트엔드 핵심 UI**: 로그인, URL 입력, 인사이트 카드, 대시보드, 검색
2. **병렬 처리**: Backend Agent + Frontend Agent가 동시에 작업
3. **PM 피드백 루프**: `/tf-review` → Reject + 피드백 → 수정 → 재리뷰
4. **의존성 파이프라인**: 백엔드 완료 → 프론트엔드 활성화 → UI 완성
5. **진행률**: 72%까지 도달 — 남은 건 통합과 테스트

다음 Sprint에서는 모든 것을 하나로 합치고, 최종 테스트를 진행합니다.

---

다음: [[4-5_Sprint3_통합리뷰]]
