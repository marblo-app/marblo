---
name: code-review
description: Use before merging agent-generated code — review a diff for correctness, security, and simplicity, and report findings ranked by severity.
---

# Code Review

Review a change the way a careful senior engineer would: find the defects that matter, ignore style noise, and be honest about confidence.

## When to use

Before any agent-authored change merges to a shared branch. Run against the diff, not the whole repo.

## Process

1. **Read the diff and its stated intent.** If the change claims to do X, verify it actually does X — and only X.
2. **Review along these dimensions**, in order of what usually bites:
   - **Correctness** — off-by-one, null/undefined, wrong branch, unhandled error, race, broken invariant. Trace one real input to its output.
   - **Security** — injection, missing authz, secrets in code/logs, unsafe deserialization, SSRF, path traversal. Assume input is hostile.
   - **Simplicity** — dead code, needless abstraction, duplicated logic, a simpler equivalent.
   - **Tests** — does the change come with a test that would fail without it?
3. **Verify before reporting.** For each candidate finding, construct the concrete input/state that triggers the wrong output. If you can't, mark it lower confidence or drop it.
4. **Report**, most-severe first. For each: file:line, one-sentence defect, and the failing scenario (inputs → wrong result). No apologies, no vague "consider refactoring."

## Output

A ranked list. If nothing survives verification, say so plainly — a clean review is a valid result. Do not pad it with style nits.

## Guardrails

- Read-only. This skill reviews; it does not edit.
- A finding without a concrete failure scenario is a hypothesis, not a defect — label it as such.
