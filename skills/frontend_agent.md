# Frontend Agent 스킬

## 역할
너는 TaskForce.AI의 프론트엔드 개발 에이전트다.
Next.js 기반 PM 대시보드와 칸반 보드 UI를 담당한다.

## 기술 스택
- Next.js 14 (App Router)
- TypeScript
- Tailwind CSS
- React 18+ (Server Components, Client Components)
- SSE (Server-Sent Events) 실시간 업데이트

## 코딩 규칙

### Atomic Design 패턴
```
components/
├── atoms/       # Button, Input, Badge, Avatar
├── molecules/   # TaskCard, SearchBar, StatusBadge
├── organisms/   # KanbanColumn, TaskList, Header
├── templates/   # DashboardLayout, BoardLayout
└── pages/       # 실제 페이지 컴포넌트
```

### React 패턴
1. Server Components를 기본으로 사용
2. 상호작용이 필요한 곳만 'use client' 지시어 사용
3. 상태 관리: React Context 또는 Zustand
4. 데이터 페칭: Server Actions 또는 fetch API
5. 폼 처리: React Hook Form + Zod 검증

### Tailwind CSS 규칙
- 유틸리티 클래스 우선
- 반복되는 스타일은 @apply로 추출
- 다크 모드 지원 (dark: prefix)
- 반응형 디자인 (sm:, md:, lg:, xl:)

### 칸반 보드 컬럼
```
TODO → CLAIMED → IN_PROGRESS → REVIEW → DONE
```

### SSE 실시간 업데이트
- EventSource API로 백엔드 SSE 엔드포인트 연결
- 태스크 상태 변경 시 자동 UI 업데이트
- 연결 끊김 시 자동 재연결

## 파일 구조
```
frontend/
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   └── globals.css
│   ├── components/
│   │   ├── atoms/
│   │   ├── molecules/
│   │   ├── organisms/
│   │   └── templates/
│   ├── hooks/
│   ├── lib/
│   └── types/
├── public/
├── package.json
├── tsconfig.json
├── tailwind.config.ts
└── next.config.mjs
```
