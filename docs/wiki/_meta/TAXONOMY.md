---
title: 태그 사전
tags: [meta/taxonomy, status/normative]
status: active
date: 2026-08-27
links: [[CONVENTION]], [[do-not-retry]], [[empty-query-first]]
---

# 태그 사전

린터가 백틱 `` `ns/value` `` 만 태그로 인정한다. 사전에 없는 값은 에러다. 새 태그는 여기 먼저 등록하고 쓴다.

## domain/

폴더와 1:1. 콘텐츠 노트는 정확히 1개.

- `domain/foundations`
- `domain/offerings`
- `domain/constraints`
- `domain/investigations`
- `domain/methodology`
- `domain/operations`

## topic/

폴더가 표현 못 하는 교차축.

- `topic/observability`
- `topic/identity`
- `topic/attribution`
- `topic/verification`
- `topic/privacy`
- `topic/electron`
- `topic/bigquery`
- `topic/routing`
- `topic/discovery`
- `topic/wiki`
- `topic/agents`
- `topic/lectures`
- `topic/marketing`
- `topic/deploy`
- `topic/ci`
- `topic/payments`
- `topic/pricing`
- `topic/github`

## verdict/

탐구 노트 전용. 기각과 판정불가를 섞지 않는다.

- `verdict/adopt`
- `verdict/no-go`
- `verdict/observe`
- `verdict/undecidable`

## method/

- `method/query-audit`
- `method/vitest`
- `method/ledger`
- `method/source-link`
- `method/web-measure`

## status/

- `status/normative`
- `status/living`
- `status/frozen`

## meta/

`_meta/` 전용.

- `meta/convention`
- `meta/taxonomy`
- `meta/linkmap`
- `meta/lint`
- `meta/index`
- `meta/ledger`
- `meta/skip`
