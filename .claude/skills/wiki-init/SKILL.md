---
name: wiki-init
description: >
  마블로 공유 위키(docs/wiki) 뼈대를 1회 구축한다. 번호-도메인 폴더, _meta 규범 4종,
  로컬 린터, 위키 홈을 만든다. 기존 문서는 이동·편집하지 않는다. 이미 docs/wiki 가
  있으면 중단하고 /wiki-note 를 안내한다.
---

# /wiki-init

공유 위키는 마블로 저장소 `docs/wiki` **하나**다. 형제 프로젝트에 위키를 만들지 마라.

## 목적

`docs/wiki/` 를 규범이 완비된 상태로 만든다. 콘텐츠 노트는 만들지 않는다.

## 입력

| 항목 | 필수 | 마블로 기본 |
| --- | --- | --- |
| 위키 루트 | ✅ | `docs/wiki` (리포 루트 금지) |
| 도메인 슬롯 6개 | ✅ | foundations · offerings · constraints · investigations · methodology · operations |
| 원장 | ⬜ | 번호 조항 원장 없음. CONTROL-PLANE.md 는 포지셔닝 SSoT, 읽기 전용 |
| Evidence | ⬜ | `v3/docs/`, `docs/`, `docs/lectures/` |

## 단계

| # | 단계 | 검증 |
| --- | --- | --- |
| 1 | 기존 문서 스캔 (읽기만) | 원본을 이동하지 않는다 |
| 2 | `docs/wiki` 가 이미 있으면 **중단** | `/wiki-note` 안내 |
| 3 | `00-foundations` … `50-operations` + `_meta/` + 각 README 스텁 | 빈 슬롯에 콘텐츠 노트를 넣지 않는다 |
| 4 | `_meta/CONVENTION.md` | P1~P6 · R1~R6 |
| 5 | `_meta/TAXONOMY.md` | 모든 태그를 백틱으로 |
| 6 | `_meta/LINK-MAP.md` | 별칭 `wiki-home` → `README.md` 한 건 |
| 7 | `_meta/LINT.md` | "린트 0 ≠ 자체완결" |
| 8 | `_meta/lint_wiki.py` | 표준 라이브러리, 읽기 전용 |
| 9 | 홈 `README.md` | 형제 프로젝트 AGENTS.md 복붙 절 포함 |
| 10 | `python3 docs/wiki/_meta/lint_wiki.py` | 에러 0 |

## 산출

홈 README, 폴더 README ×6, `_meta` 4종 + `lint_wiki.py`. **콘텐츠 노트 없음.**
