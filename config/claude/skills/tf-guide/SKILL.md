---
name: tf-guide
description: Marblo 슬래시 명령어 가이드. 상황별 어떤 명령어를 쓸지 안내합니다.
disable-model-invocation: true
allowed-tools: Read
---

# Marblo 슬래시 명령어 가이드

> 이 가이드를 그대로 출력하세요. 추가 설명 없이 아래 내용만 보여주면 됩니다.

---

아래 내용을 그대로 사용자에게 출력합니다:

```
🎯 Marblo 슬래시 명령어 가이드
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📌 프로젝트 시작
  /tf-plan     PRD 작성 + 태스크 분해 계획 (소크라틱 질문 → 구조화)
  /tf-start    PRD 기반 태스크 일괄 생성 + 에이전트 스폰

🔧 작업 진행
  /tf-work     태스크 claim → 코딩 + 진행 상황 자동 기록
  /tf-status   전체 태스크 현황 대시보드 요약
  /tf-add      진행 중 프로젝트에 새 태스크 추가/기존 태스크 수정

⏸️ 중단 / 재개
  /tf-hold     작업 일시 중단 + 현황 정리 + 다음 행동 제안
  /tf-resume   중단된 작업 이어하기 (컨텍스트 자동 복원)

👀 리뷰 / 문제 해결
  /tf-review   PM 코드 리뷰 — 승인/반려
  /tf-feedback PM 피드백 확인 + 답변 (양방향 소통)
  /tf-fix      FAILED/BLOCKED 태스크 진단 + 복구 + 태스크 취소
  /tf-handoff  에이전트 실패 → 직접 이어받기

🔄 동기화 / 정리
  /tf-sync     코드 상태와 티켓 상태 불일치 감지 + 동기화
  /tf-done     프로젝트 완료 — 결과 요약 + 아카이브 + 회고

🔁 반복 작업
  /tf-ralph    같은 작업을 N개 대상에 반복 (티켓 단위 추적)

📖 도움말
  /tf-guide    이 가이드 보기
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

💡 일반적인 흐름:
  /tf-plan → /tf-start → /tf-status → /tf-review → /tf-done

💡 상황별 추천:
  • 처음 시작          → /tf-plan
  • 어디까지 했더라    → /tf-resume
  • 현황 파악          → /tf-status
  • 리뷰가 쌓여있음    → /tf-review
  • 에이전트가 실패    → /tf-fix
  • 피드백 남겼는데     → /tf-feedback
  • 티켓이 안 맞음     → /tf-sync
  • 반복 작업 일괄     → /tf-ralph
  • 프로젝트 끝        → /tf-done
  • 뭘 해야 할지 모름  → /tf-hold (현황 정리 + 다음 행동 제안)
```
