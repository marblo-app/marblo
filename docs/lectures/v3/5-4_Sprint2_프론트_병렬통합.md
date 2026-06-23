---
tags: [강의, v3, 모듈5]
type: lecture
aliases: [Sprint 2 프론트엔드, 병렬 통합]
---

# Sprint 2 — 프론트 병렬 + 통합

> 모듈 5 · 섹션 5-4 · 약 40분
> 관련: [[5-3_Sprint1_백엔드_라이브빌딩]] | [[5-5_상황별대응_PM개입]]

---

## 이 강의에서 다루는 것

- **학습목표:** Codex 프론트 레인이 6개 UI를 일관된 UX로 묶어내는 과정을 관찰하고, **PM 피드백 루프(반려→재작업→재리뷰)**로 품질을 끌어올린 뒤 일괄 리뷰로 **통합**까지 마무리한다.
- **시연할 마블로 화면·기능:** 레인 탭(frontend-codex 행) + 코드 탭 diff + 보드 탭 배치 리뷰(`/tf-review --all`) + 브라우저 통합 실행.
- **진행할 프로젝트 단계:** P3 프론트엔드 + 통합.
- **핵심 메시지:** "의존성이 풀리는 순간 속도가 붙는다. 게이트는 끝까지 사람이."

---

## 도입 — 백엔드가 열어준 길 (4분)

Sprint 1에서 백엔드 기초를 다졌습니다 — DB·인증·CSV·LLM 분석·5톤 생성·발송 큐·결제까지. 이제 **프론트엔드가 본격적으로 흐르는** Sprint 2입니다.

> 화면: 보드 탭 — 백엔드 대부분 DONE, 프론트 카드들 활성화

이번 Sprint의 핵심은 **병렬**입니다.

- backend-claude/codex가 남은 백엔드(응답률 집계·한도 등)를 마무리하는 **동시에**
- frontend-codex가 UI 6개(TASK-013~018)를 짓습니다

두 흐름을 PM이 동시에 관리하는 게 처음엔 정신없을 수 있어요. 하지만 보드와 `/tf-status`가 있으니 괜찮습니다.

> ⚠️ 프론트는 Codex 레인이 맡습니다. 모듈 4에서 잡은 분담 그대로예요 — **Claude=설계·백엔드 핵심, Codex=프론트·테스트**. (손이 더 필요하면 Claude를 프론트에 추가 투입할 수도 있지만, 기본 분담은 이렇습니다.)

---

## 본문

### 1. 현재 상태 확인 (3분)

**(실습)**

```
/tf-status
```

> 화면: `/tf-status` 출력 — 진행률 ~40%

```
📊 Progress: ███████░░░░░░░░░░ 8/22 (36%)

DONE (8): 001 DB · 002 OAuth · 003 CSV · 019 Docker · 004 분석 · 006 큐 …

IN_PROGRESS (4):
  🔨 TASK-009 응답률 집계 API     @backend-claude
  🔨 TASK-012 사용량 한도         @backend-codex
  🔨 TASK-013 로그인 UI           @frontend-codex
  🔨 TASK-014 CSV 업로드 컴포넌트 @frontend-codex

TODO (10): 015~018 (프론트) · 020~022 (테스트, 대기)

Agents:
  backend-claude  : WORKING (009)
  backend-codex   : WORKING (012)
  frontend-codex  : WORKING (013, 014)
  test-codex      : IDLE (개발 완료 대기)
```

보이시죠? **백엔드와 프론트가 동시에** 4개 태스크를 처리 중입니다. 의존성이 풀리면서 frontend-codex가 본격 가동에 들어갔어요.

### 2. CSV 업로드 컴포넌트 관찰 (7분)

ReachWave의 첫 관문은 리드 CSV 업로드입니다. frontend-codex가 만드는 컴포넌트를 봅시다.

> 화면: 레인 탭 — frontend-codex 행, TASK-014 작업 로그

```tsx
// frontend/src/components/leads/CSVUpload.tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

const REQUIRED_COLS = ["email", "first_name", "company", "job_title"];

export default function CSVUpload() {
  const [error, setError] = useState("");
  const [count, setCount] = useState(0);
  const [uploading, setUploading] = useState(false);
  const router = useRouter();

  const handleFile = async (file: File) => {
    if (file.size > 1_000_000) {
      setError("CSV는 1MB(약 500행) 이하만 업로드할 수 있어요");
      return;
    }
    setUploading(true);
    setError("");
    try {
      const token = localStorage.getItem("token");
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/leads/import", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      if (!res.ok) throw new Error((await res.json()).detail || "임포트 실패");
      const data = await res.json();
      setCount(data.imported);
      router.push("/leads");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto p-6">
      <h2 className="text-xl font-semibold mb-4">리드 CSV 업로드</h2>
      <label
        className="block border-2 border-dashed rounded-xl p-10 text-center
                   cursor-pointer hover:bg-gray-50"
      >
        <input
          type="file"
          accept=".csv"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
        {uploading ? "업로드 중..." : "CSV 파일을 끌어다 놓거나 클릭하세요"}
      </label>
      <p className="text-gray-400 text-sm mt-2">
        필수 컬럼: {REQUIRED_COLS.join(", ")}
      </p>
      {error && <p className="text-red-500 mt-2 text-sm">{error}</p>}
      {count > 0 && (
        <p className="text-green-600 mt-2">{count}개 리드 등록 완료!</p>
      )}
    </div>
  );
}
```

파일 크기 검증, 필수 컬럼 안내, 로딩·에러·성공 상태까지. 사용자 경험을 챙긴 코드입니다.

### 3. PM 피드백 루프 — 반려와 재작업 (8분)

여기서 PM으로서 피드백을 줘봅시다. **5톤 미리보기 UI**(TASK-015)가 REVIEW로 올라왔는데, 개선할 점이 보입니다.

**(실습)**

```
/tf-review TASK-015
```

> 화면: 코드 탭 — TASK-015 diff

코드를 보니 5톤이 세로로만 쌓여서 비교가 불편합니다. 피드백:

```
R
> 1. 5톤을 탭이 아니라 2열 그리드로 나란히 보여주세요. 톤 비교가 쉽게.
> 2. 각 톤 카드에 "이 톤으로 발송" 버튼을 바로 달아주세요.
> 3. 생성 중일 때 스켈레톤 로더 표시 (8초 걸리니까).
```

```
🔄 TASK-015 Rejected with feedback
  → frontend-codex: 피드백 반영 작업 시작
```

> 화면: 레인 탭 — frontend-codex가 피드백 반영 로그

```
[frontend-codex] processing feedback for TASK-015
[frontend-codex] 2-column grid layout · per-card send button · skeleton loader
[frontend-codex] TASK-015: IN_PROGRESS → REVIEW (updated)
```

수정이 끝나 다시 REVIEW로 올라오면 재확인:

```
/tf-review TASK-015
```

이번엔 피드백이 잘 반영됐네요. Approve!

> **이 피드백 루프가 PM의 핵심 도구입니다.** 에이전트에게 구현은 맡기되, 방향은 PM이 잡습니다. "에이전트는 틀릴 수 있다 — 게이트는 사람이." (FAILED·BLOCKED 같은 더 거친 상황 대응은 다음 섹션에서.)

### 4. A/B 응답률 대시보드 — 서비스의 얼굴 (7분)

ReachWave에서 가장 중요한 화면 — 톤별 응답률을 비교하는 대시보드입니다. (이 화면 때문에 사용자가 재구독해요.)

> 화면: 레인 탭 — frontend-codex, TASK-017 A/B 대시보드

```tsx
// frontend/src/components/dashboard/ABResponseChart.tsx
"use client";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface ToneStat {
  tone: string;
  sent: number;
  opened: number;
  replied: number;
  reply_rate: number; // %
}

export default function ABResponseChart({ stats }: { stats: ToneStat[] }) {
  return (
    <div className="bg-white rounded-2xl shadow-lg p-6">
      <h3 className="text-lg font-bold mb-1">톤별 응답률 A/B</h3>
      <p className="text-gray-500 text-sm mb-4">
        같은 리드 그룹에 톤을 나눠 보낸 결과예요. 응답률이 높은 톤을 다음
        캠페인에 쓰세요.
      </p>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={stats}>
          <XAxis dataKey="tone" />
          <YAxis unit="%" />
          <Tooltip />
          <Bar dataKey="reply_rate" radius={[6, 6, 0, 0]} fill="#6366f1" />
        </BarChart>
      </ResponsiveContainer>
      <div className="grid grid-cols-5 gap-2 mt-4 text-center text-sm">
        {stats.map((s) => (
          <div key={s.tone} className="bg-gray-50 rounded-lg p-2">
            <div className="font-semibold">{s.tone}</div>
            <div className="text-indigo-600">{s.reply_rate}%</div>
            <div className="text-gray-400">
              {s.replied}/{s.sent}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

> 화면: 브라우저 미리보기 — 5톤 응답률 막대 차트 + 톤별 요약 카드

이 카드가 ReachWave의 **핵심 UI**입니다. 데이터 정확성·가독성·반응형을 꼼꼼히 리뷰하세요.

**(실습)** 리뷰 체크리스트:

- [ ] 응답률 계산이 맞는가? (`replied / sent`)
- [ ] 데이터가 0건일 때 빈 상태(empty state)를 보여주는가?
- [ ] 톤 5개가 많아져도 레이아웃이 안 깨지는가?
- [ ] 모바일에서 차트가 잘 보이는가? (반응형)

### 5. 일괄 리뷰 + 통합 실행 (8분)

남은 프론트와 테스트가 REVIEW로 모이면, 하나씩 보는 건 비효율적이죠. **배치 리뷰**를 씁니다.

**(실습)**

```
/tf-review --all
```

> 화면: 보드 탭 — REVIEW 상태 카드 목록

```
📝 Batch Review — 5 tasks pending
 1. TASK-016 발송·예약 UI        → View | Approve | Reject
 2. TASK-017 A/B 대시보드        → View | Approve | Reject
 3. TASK-018 Pricing + 결제 흐름 → View | Approve | Reject
 4. TASK-020 E2E 통합 테스트     → View | Approve | Reject
 5. TASK-021 API 유닛 테스트     → View | Approve | Reject

[A]pprove all  [R]eview each  [?] Help
```

이미 코드를 확인했다면 `A`로 일괄 승인, 의심스러운 게 있으면 `R`로 하나씩. test-codex가 만든 테스트도 함께 통과시킵니다.

```
✅ 5 tasks approved!
📊 Progress: ████████████████ 22/22 (100%) ✅
🎉 All tasks completed!
```

이제 완성된 서비스를 직접 돌려봅니다. P3는 규모가 있으니 Docker Compose로 전체를 한 번에 올려요.

**(실습)**

```
docker compose up -d --build
```

```
[+] Running 4/4
 ✅ postgres  Started
 ✅ redis     Started
 ✅ backend   Built and started
 ✅ frontend  Built and started
```

> 화면: 브라우저 — ReachWave 통합 데모

**시연 시나리오:**

1. **회원가입/로그인** → 무료 5리드 체험
2. **CSV 업로드** → 리드 목록 + 회사·직책 자동 분석
3. **5톤 생성** → 2열 그리드로 톤 비교 → 하나 선택
4. **발송·예약** → 시간대 분산 큐 등록
5. **A/B 대시보드** → 톤별 응답률 막대 차트
6. **Pricing** → 토스 결제 위젯(테스트키)

이 모든 게 에이전트들이 22개 태스크를 처리해 만든 결과물입니다. 직접 코딩한 건 없고, PM으로서 기획·관찰·리뷰·의사결정만 했어요.

> **[설명보드: 5-4 의존성 해제 → 속도]** — Excalidraw (후속 제작)
> 📊 보드 파일: [assets/5-4_의존성해제_속도.excalidraw](assets/5-4_의존성해제_속도.excalidraw) — Excalidraw 에디터/excalidraw.com 에서 열기
>
> - 타임라인 가로축: Sprint 1(백엔드) → REVIEW 게이트 → Sprint 2(프론트 병렬 폭발).
> - 게이트 통과 직후 프론트 레인 6개가 한꺼번에 열리는 "팬아웃" 시각화.
> - 오른쪽 끝: `docker compose up` → 브라우저 통합 데모 썸네일.
> - 캡션: "의존성 풀리는 순간 속도가 붙는다. 게이트는 사람이."
> - 모델 칩: Claude Code · Codex. ※ Gemini 표기 금지.

---

## 정리 (1분)

1. **병렬 처리** — 백엔드 마무리와 프론트 6개 UI가 동시에 흐른다.
2. **프론트 핵심 UI** — CSV 업로드 · 5톤 미리보기 · A/B 응답률 대시보드 · Pricing.
3. **PM 피드백 루프** — `/tf-review` → 반려 + 피드백 → 재작업 → 재리뷰. 방향은 PM이.
4. **배치 리뷰 + 통합** — `/tf-review --all`로 일괄 승인 → `docker compose up`으로 전체 기동.
5. **22/22 완료** — 두(+) 모델, 하나의 동작하는 SaaS.

다음 섹션에서는 순조롭지 않을 때 — FAILED·BLOCKED·끼어드는 새 기능·세션 끊김 — PM이 개입하는 순간들을 다룹니다.

---

다음: [[5-5_상황별대응_PM개입]]
