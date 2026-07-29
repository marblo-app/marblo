# LLM Study — Curated Resources

A source-verified path for learning LLMs, condensed into English for the Marblo ecosystem. Every link here was opened and checked; the full, continuously-updated (Korean-first) list lives in [**awesome-llm-study**](https://github.com/melocream/awesome-llm-study).

## Four-stage roadmap

1. **Grasp how it works** — tokens, attention, next-token prediction. _(1–2 weeks)_
2. **Build one yourself** — train and evaluate a small language model. _(3–6 weeks)_
3. **Connect it to a product** — structured output, RAG, tool use. _(2–4 weeks)_
4. **Make it operable** — evals, observability, serving, cost, security. _(ongoing)_

Labels: `[intro] / [mid] / [deep]` are **prerequisite** levels; time is a **first-pass** estimate; `ref` means dip-in reference (no completion).

## Foundations

- [intro · 30m] [3Blue1Brown — Transformers (Ch.5)](https://www.youtube.com/watch?v=wjZofJX0v4M) — why LLMs are transformers, in 27 animated minutes.
- [intro · 40m] [The Illustrated Transformer](https://jalammar.github.io/illustrated-transformer/) — the structure, drawn.
- [mid · 2h] [Karpathy — Let's build the GPT Tokenizer](https://www.youtube.com/watch?v=zduSFxRajkE) — tokenization from scratch (ties straight to token cost).

## Build it

- [mid · 20h] [Karpathy — Neural Networks: Zero to Hero](https://karpathy.ai/zero-to-hero.html) — micrograd → makemore → GPT, in code.
- [deep · 25h] [Stanford CS336 — Language Modeling from Scratch (2025)](https://stanford-cs336.github.io/spring2025/) — data → tokenizer → training → eval.

## Agents · tool use · MCP

- [intro · 40m] [Anthropic — Building Effective Agents](https://www.anthropic.com/engineering/building-effective-agents) — workflow vs agent patterns.
- [intro · 30m] [Model Context Protocol](https://modelcontextprotocol.io/docs/getting-started/intro) — the open standard for connecting tools and data.

## RAG (start with embeddings)

- [ref] [MTEB Leaderboard](https://huggingface.co/spaces/mteb/leaderboard) — pick an embedding model first.
- [mid · 40m] [Anthropic — Contextual Retrieval](https://www.anthropic.com/engineering/contextual-retrieval) — a big accuracy win in practice.

## Operate — evals & observability

- [ref] [Langfuse](https://langfuse.com/docs) / [LangSmith](https://docs.langchain.com/langsmith/observability) — trace calls, cost, and latency across many agents.
- [mid · 40m] [OpenTelemetry for Generative AI](https://opentelemetry.io/blog/2024/otel-generative-ai/) — vendor-neutral tracing conventions.

## Stay current

- [ref] [Latent Space](https://www.latent.space/) · [The Batch](https://www.deeplearning.ai/the-batch/) · [Import AI](https://importai.substack.com/) · [HF Daily Papers](https://huggingface.co/papers)

---

> Want depth, Korean commentary, papers, and the full 15-section map? → [**awesome-llm-study**](https://github.com/melocream/awesome-llm-study). Licensed CC-BY-4.0.
