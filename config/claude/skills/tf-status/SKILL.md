---
name: tf-status
description: 프로젝트 태스크 진행 상태를 대시보드 형태로 요약합니다
allowed-tools: Bash, Read
---

# TaskForce 상태 확인

> 터미널에서 대시보드 없이 빠르게 현황을 파악합니다.

---

## 조회 순서

1. `get_all_tasks`로 전체 태스크 조회 (프로젝트 필터 적용)
2. 상태별로 분류 + 카운트
3. `check_feedback`으로 미확인 PM 피드백 확인
4. FAILED/BLOCKED 태스크가 있으면 활동 로그로 원인 표시

## 출력 형식

```
📊 프로젝트: {project_name}
━━━━━━━━━━━━━━━━━━━━━━━━━━

  ✅ DONE          {n}개  ██████████░░  {percent}%
  🔄 IN_PROGRESS   {n}개  {task titles}
  👀 REVIEW        {n}개  {task titles} ← 리뷰 필요!
  📋 TODO          {n}개
  ❌ FAILED        {n}개  {원인 요약}
  🚫 BLOCKED       {n}개

  ━━━━━━━━━━━━━━━
  진행률: {done}/{total} ({percent}%)
  예상 남은 태스크: {remaining}개

⚠️ 주의 필요:
  • FAILED: TASK-006 — "port already in use"
  • 미확인 피드백: TASK-003에 PM 코멘트 있음

💡 다음 행동:
  • /tf-review — REVIEW {n}개 처리
  • /tf-fix — FAILED {n}개 복구
```

## 상황별 추가 안내

| 상황 | 안내 |
|------|------|
| 모든 태스크 DONE | "🎉 프로젝트 완료! 수고하셨습니다." |
| REVIEW가 3개 이상 | "리뷰가 밀려있습니다. `/tf-review`로 처리하세요." |
| FAILED가 있음 | "문제가 있는 태스크가 있습니다. `/tf-fix`로 확인하세요." |
| TODO만 있고 IN_PROGRESS 없음 | "아직 작업이 시작되지 않았습니다. `/tf-start`로 시작하세요." |
