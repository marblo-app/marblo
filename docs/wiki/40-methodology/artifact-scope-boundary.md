---
title: 제작물에는 판정 노트 형식을 적용하지 않는다
tags: [domain/methodology, topic/wiki, topic/lectures, topic/marketing, verdict/adopt, method/source-link]
status: verified
date: 2026-08-27
links: [[CONVENTION]], [[wiki-write-at-merge]], [[verify-result-row]], [[decision-sentence-first]]
---

# 제작물에는 판정 노트 형식을 적용하지 않는다

> **한 줄 판정**: ★채택 — R1~R6은 `docs/wiki/` 판정 노트에는 유지하고, 커리큘럼·강의·마케팅 카피·공개 README 같은 제작물에는 적용하지 않는다. 현재 커리큘럼은 573줄 중 실제 커리큘럼 §4가 273줄(약 47.6%)이고, §2+§3 근거표가 84줄, §11 확인 못 한 것이 19줄이라 내부 검증 장부가 독자 본문을 밀어낸 증거가 있다.

## 무엇을 물었나

사장님 지적은 "커리큘럼이 왜 본문 자체보다 주변 내용만 쓰였는가"였다. 질문은 위키 작성 가이드가 형식적으로 주변 내용을 채우게 만드는지, 아니면 판정 노트 규범이 제작물로 번진 것인지다.

## 무엇을 했나

`docs/lectures/2026-08/CURRICULUM.md`의 전체 줄 수와 섹션 경계를 다시 세었다. 현재 파일 기준 전체 573줄, §4 실제 커리큘럼 273줄, §2 화면 대응표와 §3 배포 경계표 합계 84줄, §11 확인 못 한 것 19줄이다. 또한 `verify-result-row`와 `decision-sentence-first`는 방법론 노트 안에서는 알맹이가 있는 판정 규범임을 확인했다. backend/frontend/devops/test 에이전트 스킬의 완료 보고 규약도 읽었고, 모두 티켓 완료 알림용이라 제작물 본문 형식을 요구하지 않는다.

## 규칙

| 문서 종류 | 독자 | 적용 규칙 |
| --- | --- | --- |
| 판정 노트 | 다음 에이전트, 미래의 우리 | [[CONVENTION]]의 R1~R6을 그대로 적용한다 |
| 제작물 | 고객, 수강생, 공개 독자 | 독자 본문을 먼저 쓰고 판정 노트 형식을 적용하지 않는다 |

제작물에서는 `file:line` 근거를 본문에 박지 않는다. 필요하면 문서 끝 부록 한 곳에 모은다. "확인 못 한 것" 섹션은 넣지 않는다. 모르면 쓰지 않거나 티켓으로 올린다. "한 줄 판정"도 해당 없다. 제목과 요약은 조사 결론이 아니라 독자 가치와 다음 행동을 말한다.

단, 없는 화면이나 없는 기능을 "있다" 또는 "곧 된다"로 쓰지 않는 규율은 제작물에도 유지한다. 이것은 형식이 아니라 정직성이다. 방어 섹션을 지우는 것과 거짓말을 허용하는 것을 섞지 않는다.

## 왜

판정 노트는 이어받는 사람이 근거와 한계를 빨리 회수해야 하므로 [[verify-result-row]] 같은 장부가 가치다. 제작물은 독자가 배울 것, 살 것, 실행할 것을 찾는 문서다. 같은 표 구조가 넘어가면 근거 열과 방어 섹션이 본문 밀도를 낮춘다.

## 한계 / 정직성

- 이 노트는 위키 규범을 약화하지 않는다. `docs/wiki/` 판정 노트의 R1~R6은 유지한다.
- 이 노트는 커리큘럼 자체를 고치지 않는다. 커리큘럼 본문 개정은 별도 티켓이 갖는다.
- 현재 커리큘럼 줄 수는 2026-08-27 작업공간 기준이다. 수치가 갈리면 원본 파일이 옳다.
- 코드·설정·운영 변경은 없다. 위키 규약과 링크 등록만 변경한다.

## 실제 영향

이후 커리큘럼, 강의 문서, 마케팅 카피, 공개 README를 쓸 때 위키 판정 노트의 "한 줄 판정 / Evidence / 확인 못 한 것" 형식을 본문에 이식하지 않는다. 반대로 위키 노트를 쓸 때는 R1~R6을 계속 적용한다. 제작물의 정직성 검사는 유지하되, 방어 섹션으로 독자 본문을 대체하지 않는다.

## Evidence

- 적용 범위가 추가된 위키 규약: [../_meta/CONVENTION.md](../_meta/CONVENTION.md)
- 형식이 샌 사례로 재측정한 커리큘럼 원본: [../../lectures/2026-08/CURRICULUM.md](../../lectures/2026-08/CURRICULUM.md)
- 판정 노트 형식이 유효한 방법론 사례: [verify-result-row.md](verify-result-row.md), [decision-sentence-first.md](decision-sentence-first.md)
- 위키 작성 시점과 읽기 기준: [wiki-write-at-merge.md](wiki-write-at-merge.md)
- 완료 보고 규약 확인 대상: [../../../v3/skills/backend_agent.md](../../../v3/skills/backend_agent.md), [../../../v3/skills/frontend_agent.md](../../../v3/skills/frontend_agent.md), [../../../v3/skills/devops_agent.md](../../../v3/skills/devops_agent.md), [../../../v3/skills/test_agent.md](../../../v3/skills/test_agent.md)

## Backlinks

- [[wiki-write-at-merge]] · [[verify-result-row]] · [[decision-sentence-first]]
