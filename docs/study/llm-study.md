# LLM Study

Source-verified learning resources for the large language model era, adapted from
[melocream/awesome-llm-study](https://github.com/melocream/awesome-llm-study).

This guide is for people who want to study LLMs seriously without getting lost in
random bookmarks: foundations, model building, agents and MCP, RAG, evaluation,
observability, local serving, security, cost, multimodal systems, and ways to
keep up. The original Korean curation was maintained by Dataga Dapida
(Dongwon Kim, [@melocream](https://github.com/melocream)) and was built around a
simple rule: prefer authoritative primary sources, favor recent material, and
leave only the note that helps you decide why to read something.

If you are turning this reading list into an actual team study program, Marblo is
the natural execution layer: split the roadmap into tickets, assign tracks to
different agents or teammates, keep progress visible, and review the outputs
without turning the study into another spreadsheet.

## Roadmap

More resources are not the point. Knowing what to study next is.

| Stage | Goal | Start With | Suggested Time |
| --- | --- | --- | --- |
| 1. Understand the mechanism | Explain tokens, attention, and next-token prediction in plain language | [3Blue1Brown](#1-llm-history-and-foundations), [The Illustrated Transformer](#1-llm-history-and-foundations) | 1-2 weeks |
| 2. Build one yourself | Train and evaluate a small language model | [Karpathy Zero to Hero](#2-courses), [CS336](#2-courses) | 3-6 weeks |
| 3. Connect models to products | Combine structured outputs, RAG, and tool calling | [Agents and MCP](#3-agents-tool-calling-and-mcp), [RAG](#6-rag-retrieval-augmented-generation) | 2-4 weeks |
| 4. Operate real systems | Design evaluation, tracing, serving, cost, and security together | [Evals and observability](#9-evaluation-evals-and-observability), [Local serving](#10-local-running-serving-and-quantization), [Security](#11-llm-security), [Cost](#12-cost-and-token-economics) | Ongoing |

`Beginner`, `Intermediate`, and `Advanced` refer to prerequisite level. Time
estimates are rough first-pass reading or one practical run-through. `Reference`
means you should dip into the resource when needed rather than try to complete it.

## Contents

- [Roadmap](#roadmap)
- [1. LLM History and Foundations](#1-llm-history-and-foundations)
- [2. Courses](#2-courses)
- [3. Agents, Tool Calling, and MCP](#3-agents-tool-calling-and-mcp)
- [4. Coding Agents](#4-coding-agents)
- [5. Prompting and Context Engineering](#5-prompting-and-context-engineering)
- [6. RAG: Retrieval-Augmented Generation](#6-rag-retrieval-augmented-generation)
- [7. Fine-Tuning, RLHF, and Alignment](#7-fine-tuning-rlhf-and-alignment)
- [8. Must-Read Papers](#8-must-read-papers)
- [9. Evaluation, Evals, and Observability](#9-evaluation-evals-and-observability)
- [10. Local Running, Serving, and Quantization](#10-local-running-serving-and-quantization)
- [11. LLM Security](#11-llm-security)
- [12. Cost and Token Economics](#12-cost-and-token-economics)
- [13. Multimodal](#13-multimodal)
- [14. Korean-Language Resources](#14-korean-language-resources)
- [15. Staying Current](#15-staying-current)
- [Attribution and License](#attribution-and-license)

## 1. LLM History and Foundations

Transformer, GPT, instruction tuning, and the current LLM stack: learn what is
happening inside the model through visuals, code, and first-principles
explanations.

- [Beginner, 3 hours] [3Blue1Brown - Neural Networks series](https://www.3blue1brown.com/topics/neural-networks) - The best visual path for building intuition around neural networks and attention without getting buried in notation.
- [Beginner, 30 minutes] [3Blue1Brown - Transformers, the tech behind LLMs](https://www.youtube.com/watch?v=wjZofJX0v4M) - A compact animated explanation of why modern LLMs are built around transformers.
- [Beginner, 1 hour] [Andrej Karpathy - Intro to Large Language Models](https://www.youtube.com/watch?v=zjkBMFhNj_g) - A clear, accessible tour of the whole LLM picture.
- [Intermediate, 3.5 hours] [Andrej Karpathy - Deep Dive into LLMs like ChatGPT](https://www.youtube.com/watch?v=7xTGNNLPyMI) - A longer pass through pretraining, supervised fine-tuning, and RLHF.
- [Beginner, 40 minutes] [The Illustrated Transformer - Jay Alammar](https://jalammar.github.io/illustrated-transformer/) - The classic visual walkthrough of transformer architecture.
- [Beginner, 40 minutes] [The Illustrated GPT-2 - Jay Alammar](https://jalammar.github.io/illustrated-gpt2/) - A visual explanation of how decoder-only language models generate tokens.
- [Intermediate, 2 hours] [Andrej Karpathy - Let's build the GPT Tokenizer](https://www.youtube.com/watch?v=zduSFxRajkE) - Build byte-pair encoding from the ground up and make tokens feel concrete.
- [Beginner, reference] [openai/tiktoken](https://github.com/openai/tiktoken) - The standard GPT-family BPE tokenizer implementation for counting real tokens.
- [Intermediate, 3 hours] [The Annotated Transformer - Harvard NLP](https://nlp.seas.harvard.edu/annotated-transformer/) - A line-by-line PyTorch reproduction of the original transformer paper.
- [Beginner, 20 minutes] [LLM Visualization - bbycroft.net](https://bbycroft.net/llm) - An interactive 3D walkthrough of GPT inference at matrix level.
- [Beginner, 15 minutes] [Generative AI exists because of the transformer - Financial Times](https://ig.ft.com/generative-ai/) - A scroll-based interactive introduction to how generative AI works.

## 2. Courses

Structured curricula for people who learn best by implementing the pieces.

- [Intermediate, 40+ hours] [Stanford CS224n - NLP with Deep Learning](https://web.stanford.edu/class/cs224n/) - The canonical graduate-level NLP course, with notes and slides available.
- [Intermediate, 30 hours] [CS224n lectures, Spring 2024](https://www.youtube.com/playlist?list=PLoROMvodv4rOaMFbaqxPDoLWjDaRAdP9D) - Stanford Online's official playlist of Christopher Manning's full course.
- [Advanced, 60+ hours] [Stanford CS336 - Language Modeling from Scratch](https://stanford-cs336.github.io/spring2025/) - A 2025 course that builds LLMs from data and tokenizers through training and evaluation.
- [Advanced, 25 hours] [CS336 lectures, Spring 2025](https://www.youtube.com/playlist?list=PLoROMvodv4rOY23Y0BoGoBGgQ1zmU_MT_) - Full lecture recordings covering tokenizers, architectures, GPUs, MoE, and the rest of the stack.
- [Intermediate, 20 hours] [Karpathy - Neural Networks: Zero to Hero](https://karpathy.ai/zero-to-hero.html) - A code-first path from micrograd to makemore to GPT.
- [Intermediate, 5 hours] [karpathy/nanoGPT](https://github.com/karpathy/nanoGPT) - The famous minimal GPT training implementation, small enough to study directly.
- [Intermediate, 8 hours] [karpathy/makemore](https://github.com/karpathy/makemore) - A staged language-modeling repo that moves from bigrams to transformers.
- [Intermediate, 15 hours] [Hugging Face - LLM Course](https://huggingface.co/learn/llm-course) - A free practical course on transformers, tokenizers, and fine-tuning.
- [Beginner, 1-2 hours per course] [DeepLearning.AI - Short Courses](https://www.deeplearning.ai/short-courses/) - Short applied LLM courses from Andrew Ng's team and partner companies.
- [Beginner, reference] [Andrej Karpathy - YouTube channel](https://www.youtube.com/@AndrejKarpathy) - The source channel for many of the most useful LLM learning videos.
- [Intermediate, reference] [Practical Deep Learning - fast.ai](https://course.fast.ai/) - A general deep learning course; use it to strengthen fundamentals, not as a direct LLM course.

## 3. Agents, Tool Calling, and MCP

Before jumping into MCP, learn structured outputs and function calling. Tool use
is easier to design when the output contract is explicit.

### Structured Outputs and Function Calling

- [Beginner, 40 minutes] [OpenAI - Function calling](https://platform.openai.com/docs/guides/function-calling) - The baseline for getting a model to call defined functions.
- [Beginner, 40 minutes] [OpenAI - Structured Outputs](https://platform.openai.com/docs/guides/structured-outputs) - Use JSON Schema to constrain responses into parseable data.
- [Beginner, 40 minutes] [Anthropic - Tool use with Claude](https://docs.claude.com/en/docs/agents-and-tools/tool-use/overview) - Claude's official guide to tool use, and a useful foundation before MCP.

### MCP and Agent Patterns

- [Beginner, 30 minutes] [Model Context Protocol - Introduction](https://modelcontextprotocol.io/docs/getting-started/intro) - The starting point for the open protocol that connects LLMs to tools and data.
- [Advanced, 2 hours] [MCP Specification, 2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18) - Read the spec when you need to build MCP servers or clients directly.
- [Intermediate, reference] [modelcontextprotocol on GitHub](https://github.com/modelcontextprotocol) - SDKs, reference servers, schemas, and related ecosystem source.
- [Beginner, 40 minutes] [Anthropic - Building Effective Agents](https://www.anthropic.com/engineering/building-effective-agents) - A practical taxonomy of workflows, agents, prompt chaining, routing, and orchestration.
- [Intermediate, 1.5 hours] [Anthropic - Building agents with the Claude Agent SDK](https://claude.com/blog/building-agents-with-the-claude-agent-sdk) - A production-oriented guide to building agents with an SDK.
- [Intermediate, 1 hour] [ReAct - reasoning plus acting agent pattern](#landmark-papers-2017-2023) - The original pattern that alternates reasoning and action; the arXiv link is listed in the papers section.
- [Intermediate, 1 hour] [Toolformer: Language Models Can Teach Themselves to Use Tools](https://arxiv.org/abs/2302.04761) - A representative paper on models learning API calls.

## 4. Coding Agents

Terminal-native coding agents, vendor docs, and practical operating patterns.
This is the territory Marblo builds around when you coordinate different CLIs in
one workflow.

- [Beginner, 15 minutes] [Claude Code - Overview](https://code.claude.com/docs/en/overview) - What Claude Code is and what it is designed to do.
- [Beginner, 30 minutes] [Claude Code - Quickstart](https://code.claude.com/docs/en/quickstart) - Installation and first-task onboarding.
- [Beginner, 45 minutes] [Claude Code - Common Workflows](https://code.claude.com/docs/en/common-workflows) - Common work such as codebase exploration, refactoring, and test-driven changes.
- [Intermediate, 1 hour] [Claude Code - Best Practices](https://code.claude.com/docs/en/best-practices) - Practical guidance on CLAUDE.md, context, and agentic coding habits.
- [Beginner, reference] [openai/codex](https://github.com/openai/codex) - OpenAI's lightweight open-source terminal coding agent.
- [Beginner, reference] [google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli) - An open-source CLI agent for Gemini.
- [Beginner, 30 minutes] [Aider - AI Pair Programming](https://aider.chat/) - A terminal pair-programming agent that works directly inside git repositories.
- [Intermediate, reference] [Cursor - Docs](https://cursor.com/docs) - Official docs for Cursor's agent, rules, and MCP workflows.

## 5. Prompting and Context Engineering

The field is moving from "how do I ask?" toward "what should be in the context
window, and why?"

- [Beginner, 1 hour] [Anthropic - Prompt Engineering Overview](https://docs.claude.com/en/docs/build-with-claude/prompt-engineering/overview) - A broad official guide to prompt engineering for Claude.
- [Beginner, 6 hours] [Anthropic - Interactive Prompt Engineering Tutorial](https://github.com/anthropics/prompt-eng-interactive-tutorial) - A hands-on tutorial from beginner to advanced prompting.
- [Beginner, 45 minutes] [OpenAI - Prompt Engineering Guide](https://platform.openai.com/docs/guides/prompt-engineering) - Official GPT-family prompting strategies.
- [Intermediate, 1.5 hours] [Anthropic - Effective Context Engineering for AI Agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) - A useful framing of context engineering beyond prompt wording.
- [Intermediate, reference] [Prompt Engineering Guide - DAIR.AI](https://www.promptingguide.ai/) - A community reference covering techniques, papers, and examples.
- [Intermediate, reference] [OpenAI Cookbook](https://cookbook.openai.com/) - Practical recipes for prompts, tool calling, embeddings, and application patterns.

## 6. RAG: Retrieval-Augmented Generation

RAG is the pipeline that connects model behavior to external knowledge. The first
choice is often not the pipeline framework, but the embedding model.

### Embeddings and Vector Search

- [Beginner, reference] [MTEB Leaderboard](https://huggingface.co/spaces/mteb/leaderboard) - A standard leaderboard for comparing embedding models by task.
- [Intermediate, reference] [Sentence Transformers documentation](https://www.sbert.net/) - The practical standard library for embeddings and semantic search.
- [Beginner, 40 minutes] [Hugging Face - Getting Started With Embeddings](https://huggingface.co/blog/getting-started-with-embeddings) - A minimal hands-on introduction to semantic search with embeddings.

### RAG Pipelines

- [Intermediate, 1 hour] [Retrieval-Augmented Generation, original paper](https://arxiv.org/abs/2005.11401) - The 2020 paper that introduced the RAG formulation.
- [Advanced, 4 hours] [Retrieval-Augmented Generation for LLMs: A Survey](https://arxiv.org/abs/2312.10997) - A survey spanning naive, advanced, and modular RAG.
- [Intermediate, 40 minutes] [Anthropic - Contextual Retrieval](https://www.anthropic.com/engineering/contextual-retrieval) - A practical technique for improving retrieval by adding context to chunks.
- [Intermediate, 3 hours] [LangChain - Retrieval docs](https://docs.langchain.com/oss/python/langchain/retrieval) - Official docs for assembling RAG pipelines in code.
- [Intermediate, reference] [LlamaIndex documentation](https://docs.llamaindex.ai/) - A RAG framework focused on document indexing and querying.
- [Beginner, 1 hour] [Pinecone - Retrieval-Augmented Generation](https://www.pinecone.io/learn/retrieval-augmented-generation/) - A vector database perspective on RAG from concept to implementation.
- [Beginner, 1.5 hours] [Hugging Face Cookbook - Simple RAG](https://huggingface.co/learn/cookbook/rag_zephyr_langchain) - A minimal RAG example using an open model and LangChain.

## 7. Fine-Tuning, RLHF, and Alignment

How pretrained models are shaped toward useful behavior: SFT, RLHF, DPO, LoRA,
and related techniques.

- [Advanced, 2 hours] [InstructGPT: Training language models to follow instructions](https://arxiv.org/abs/2203.02155) - The RLHF paper behind the line of instruction-following chat models.
- [Beginner, 40 minutes] [Illustrating RLHF - Hugging Face](https://huggingface.co/blog/rlhf) - A visual explanation of SFT, reward modeling, and PPO.
- [Advanced, 2.5 hours] [Constitutional AI: Harmlessness from AI Feedback](https://arxiv.org/abs/2212.08073) - Anthropic's RLAIF paper on alignment through principles rather than only human labels.
- [Advanced, 2 hours] [DPO: Direct Preference Optimization](https://arxiv.org/abs/2305.18290) - Preference optimization without a separate reward model or RL loop.
- [Intermediate, 1.5 hours] [LoRA: Low-Rank Adaptation](https://arxiv.org/abs/2106.09685) - The standard low-cost fine-tuning method that trains a small number of extra parameters.
- [Advanced, 2 hours] [QLoRA: Efficient Finetuning of Quantized LLMs](https://arxiv.org/abs/2305.14314) - 4-bit quantization that made large-model fine-tuning practical on a single GPU.
- [Intermediate, reference] [Hugging Face PEFT documentation](https://huggingface.co/docs/peft) - Official docs for LoRA, QLoRA, and parameter-efficient fine-tuning.
- [Intermediate, reference] [Hugging Face TRL documentation](https://huggingface.co/docs/trl) - Tooling for SFT, DPO, PPO, and RLHF-style training loops.

## 8. Must-Read Papers

The papers that shaped the LLM era. The original curation checked arXiv pages
directly so titles match the linked papers rather than relying on plausible IDs.

### Landmark Papers, 2017-2023

- [Advanced, 3 hours] [Attention Is All You Need, 2017](https://arxiv.org/abs/1706.03762) - The transformer paper that started the modern era.
- [Advanced, 2 hours] [Scaling Laws for Neural Language Models, 2020](https://arxiv.org/abs/2001.08361) - Shows that model, data, and compute scaling produce predictable gains.
- [Intermediate, 2.5 hours] [GPT-3: Language Models are Few-Shot Learners, 2020](https://arxiv.org/abs/2005.14165) - The paper that established large-model few-shot in-context learning.
- [Advanced, 1.5 hours] [Chinchilla: Training Compute-Optimal LLMs, 2022](https://arxiv.org/abs/2203.15556) - The argument that, at a fixed compute budget, more data often matters more than larger models.
- [Intermediate, 1 hour] [Chain-of-Thought Prompting, 2022](https://arxiv.org/abs/2201.11903) - A relatively approachable paper on improving reasoning with step-by-step prompting.
- [Advanced, 2 hours] [InstructGPT / RLHF, 2022](https://arxiv.org/abs/2203.02155) - The prototype for aligning conversational LLMs through human feedback.
- [Intermediate, 1 hour] [Self-Instruct, 2022](https://arxiv.org/abs/2212.10560) - How models can generate instruction data for their own fine-tuning.
- [Intermediate, 3 hours] [Llama 2, 2023](https://arxiv.org/abs/2307.09288) - Meta's technical report that pushed open-weight LLM adoption forward.
- [Intermediate, 1 hour] [ReAct, 2023](https://arxiv.org/abs/2210.03629) - A conceptual foundation for agents that combine reasoning and action.
- [Beginner, 1.5 hours] [GPT-4 Technical Report, 2023](https://arxiv.org/abs/2303.08774) - A readable report on GPT-4 capabilities and limits, even though many implementation details are withheld.

### Frontier Topics, 2024-2026

These four threads explain why many current models and systems look the way they
do: MoE, long context, test-time compute, and state-space alternatives.

#### MoE: Grow Parameters Without Paying Full Inference Cost

- [Advanced, 2 hours] [Mixtral of Experts, 2024](https://arxiv.org/abs/2401.04088) - A practical report on sparse MoE tradeoffs between quality and inference cost.
- [Advanced, 2.5 hours] [DeepSeek-V3 Technical Report, 2024](https://arxiv.org/abs/2412.19437) - A detailed report on training a 671B-parameter MoE model, including routing, load balancing, and cost.

#### Long Context: Extending Windows and Measuring What Actually Works

- [Advanced, 2 hours] [LongRoPE, 2024](https://arxiv.org/abs/2402.13753) - A representative approach to extending position embeddings for long-context models.
- [Advanced, 2 hours] [Gemini 1.5, 2024](https://arxiv.org/abs/2403.05530) - A technical report on bringing million-token context windows into production-scale models.
- [Advanced, 1.5 hours] [RULER: What's the Real Context Size of Your Long-Context LMs?, 2024](https://arxiv.org/abs/2404.06654) - A benchmark reminder that advertised context length is not the same as usable context length.

#### Test-Time Compute and Reasoning Models

- [Advanced, 2 hours] [Scaling LLM Test-Time Compute Optimally, 2024](https://arxiv.org/abs/2408.03314) - An analysis of when spending more compute at inference time beats simply scaling model size.
- [Advanced, 2 hours] [DeepSeek-R1, 2025](https://arxiv.org/abs/2501.12948) - A useful open reasoning-model report covering training and distillation design.

#### SSM: The Lineage Outside Attention

- [Advanced, 2 hours] [Mamba: Linear-Time Sequence Modeling with Selective State Spaces, 2023](https://arxiv.org/abs/2312.00752) - A starting point for understanding why state-space models came back into the conversation.
- [Advanced, 2.5 hours] [Transformers are SSMs, Mamba-2, 2024](https://arxiv.org/abs/2405.21060) - Shows a structural relationship between transformers and SSMs while introducing Mamba-2.

## 9. Evaluation, Evals, and Observability

When prompts, models, or agents change, you need to know whether the system
actually improved. When multiple agents are running, you also need to see where
and why things failed.

### Evaluation and Evals

- [Intermediate, reference] [EleutherAI LM Evaluation Harness](https://github.com/EleutherAI/lm-evaluation-harness) - One of the most widely used tools for reproducing public model benchmarks under consistent conditions.
- [Beginner, reference] [promptfoo](https://www.promptfoo.dev/docs/intro/) - A practical tool for testing prompts, RAG systems, and agents with assertions and red-team cases in CI.
- [Beginner, 20 minutes] [LMSYS Chatbot Arena](https://lmarena.ai/) - Learn what human-preference leaderboards can and cannot tell you about model choice.
- [Intermediate, reference] [SWE-bench](https://www.swebench.com/) - A representative benchmark for coding agents on real GitHub issues.

### Observability and Tracing

- [Beginner, reference] [Langfuse](https://langfuse.com/docs) - Open-source tracing and evaluation for LLM and agent applications, including cost, latency, prompts, and calls.
- [Beginner, reference] [LangSmith Observability](https://docs.langchain.com/langsmith/observability) - Tracing, debugging, and evaluation for chains and agents.
- [Intermediate, 40 minutes] [OpenTelemetry for Generative AI](https://opentelemetry.io/blog/2024/otel-generative-ai/) - GenAI semantic conventions for vendor-neutral tracing.

## 10. Local Running, Serving, and Quantization

Beyond API calls: run models on laptops and servers, and learn the tradeoffs
between speed, memory, cost, and quality.

- [Beginner, 30 minutes] [Ollama](https://ollama.com/) - The shortest path to pulling and running local models behind an API.
- [Intermediate, reference] [vLLM](https://docs.vllm.ai/) - A standard high-performance serving stack with PagedAttention and continuous batching.
- [Intermediate, reference] [llama.cpp](https://github.com/ggml-org/llama.cpp) - The key project for understanding and running GGUF-quantized models on CPUs and Apple Silicon.
- [Intermediate, 45 minutes] [Hugging Face - Bitsandbytes quantization](https://huggingface.co/docs/transformers/quantization/bitsandbytes) - A practical way to study 8-bit and 4-bit quantization tradeoffs.

## 11. LLM Security

Once a model can read data and use tools, prompt injection and data-exposure
risks become part of the product design.

- [Beginner, 40 minutes] [OWASP Top 10 for LLM Applications](https://genai.owasp.org/llm-top-10/) - A baseline map of common LLM application risks and mitigations.
- [Intermediate, 1 hour] [Anthropic - Mitigate jailbreaks and prompt injections](https://docs.claude.com/en/docs/test-and-evaluate/strengthen-guardrails/mitigate-jailbreaks) - Why layered defenses matter more than any single magic prompt.
- [Intermediate, reference] [promptfoo red teaming](https://www.promptfoo.dev/docs/red-team/) - Move injection and leakage scenarios into automated tests.

## 12. Cost and Token Economics

Good LLM products manage quality together with tokens, latency, caching, and
model selection. The tokenizer material in section 1 makes this section much
easier to reason about.

- [Beginner, 30 minutes] [OpenAI - Prompt caching](https://platform.openai.com/docs/guides/prompt-caching) - A starting point for reducing cost on repeated long contexts.
- [Intermediate, 40 minutes] [Anthropic - Token counting](https://docs.claude.com/en/docs/build-with-claude/token-counting) - Count tokens before calls so budgets, limits, and UX are explicit.
- [Intermediate, reference] [Google Cloud - AI/ML cost optimization](https://docs.cloud.google.com/architecture/framework/perspectives/ai-ml/cost-optimization) - A Well-Architected view of managing model and infrastructure costs against business KPIs.

## 13. Multimodal

Text-only LLMs are now part of a broader stack that reads and generates images,
audio, and documents. Treat this as an extension of the product-building stage.

- [Beginner, 40 minutes] [OpenAI - Images and vision](https://platform.openai.com/docs/guides/images-vision) - Official guidance for adding image input and generation to product flows.
- [Beginner, 40 minutes] [Anthropic - Vision](https://docs.claude.com/en/docs/build-with-claude/vision) - Official guide for image input with Claude.
- [Advanced, 1.5 hours] [CLIP: Learning Transferable Visual Models, 2021](https://arxiv.org/abs/2103.00020) - The foundational paper aligning images and text in a shared representation space.
- [Advanced, 1.5 hours] [ViT: An Image is Worth 16x16 Words, 2020](https://arxiv.org/abs/2010.11929) - The Vision Transformer paper that treats image patches as transformer tokens.
- [Intermediate, 1 hour] [LLaVA: Large Language and Vision Assistant](https://arxiv.org/abs/2304.08485) - A representative paper on combining vision encoders with language models.
- [Intermediate, 1.5 hours] [Qwen2-VL, 2024](https://arxiv.org/abs/2409.12191) - A technical report for a current open vision-language lineage with arbitrary-resolution inputs.
- [Intermediate, reference] [Hugging Face - Multimodal task guides](https://huggingface.co/docs/transformers/tasks/vision) - A practical starting point for experimenting with open vision and document models.

## 14. Korean-Language Resources

High-signal Korean resources that remain useful and active.

- [Beginner, reference] [TeddyNote blog](https://teddylee777.github.io/) - One of the richest Korean technical blogs for LangChain, RAG, and practical LLM examples.
- [Beginner, reference] [TeddyNote on YouTube](https://www.youtube.com/@teddynote) - A steady Korean-language channel for LLM and LangChain practice.
- [Beginner, 10 hours] [teddylee777/langchain-kr](https://github.com/teddylee777/langchain-kr) - A Korean practical tutorial repo reorganizing LangChain official material.
- [Intermediate, 15 hours] [ratsgo's NLPBOOK](https://ratsgo.github.io/nlpbook/) - A deep Korean-language ebook on transformers, BERT, and GPT.
- [Intermediate, reference] [Pseudo-Lab on GitHub](https://github.com/Pseudo-Lab) - Projects and study material from one of Korea's largest open AI study communities.
- [Beginner, 20 hours] [Machine Learning/Deep Learning for Everyone - Sung Kim](https://hunkim.github.io/ml/) - A classic Korean-language foundation course.
- [Intermediate, 12 hours] [rickiepark/nlp-with-transformers](https://github.com/rickiepark/nlp-with-transformers) - Example code for the Korean edition of Natural Language Processing with Transformers.
- [Intermediate, reference] [Hyukppen AI and deep learning lectures](https://www.youtube.com/@hyukppen) - Korean lectures that work through attention, transformers, and related math carefully.
- [Advanced, reference] [SNU DSBA Lab on YouTube](https://www.youtube.com/@dsba2979) - Korean research seminars and paper explanations for practicing serious paper reading.
- [Beginner, reference] [JoCoding on YouTube](https://www.youtube.com/@jocoding) - Practical Korean videos for beginners building AI apps with LLM APIs.

### Start Here: Dataga Dapida

Starter material from Dataga Dapida (Dongwon Kim,
[@melocream](https://github.com/melocream)), the maintainer of the original
curation. These are useful for Korean-speaking learners starting with Claude
Code and Marblo.

- [Beginner, reference] [Dataga Dapida on YouTube](https://www.youtube.com/@데이터가답이다) - Korean content on Claude Code, heterogeneous AI agents, and Marblo.
- [Beginner, reference] [Complete Claude Code setup guide](https://www.youtube.com/watch?v=lqn2kFKUYss) - A practical Korean setup guide for Claude Code.
- [Beginner, reference] [gstack Claude Code setup walkthrough](https://www.youtube.com/watch?v=uL7qVo1W2K0) - A Korean video showing Claude Code plus a skill stack for browsing, review, deployment, and site building.
- [Beginner, reference] [Marblo - Start parallel development with the orchestrator](https://marblo.app/ko/guide) - A Korean guide to turning a goal into tickets, spawning multiple coding agents into separate worktrees, tracking progress, and merging safely.

## 15. Staying Current

Curated repositories age. This list will age too, so subscribe to sources that
help you refresh your own map.

- [Beginner, reference] [Latent Space](https://www.latent.space/) - A newsletter and podcast about LLM practice and product work from an engineering perspective.
- [Beginner, reference] [The Batch - DeepLearning.AI](https://www.deeplearning.ai/the-batch/) - Andrew Ng's team on weekly AI news and explanations.
- [Beginner, reference] [Import AI - Jack Clark](https://importai.substack.com/) - A widely read weekly newsletter on frontier research, policy, and industry movement.
- [Beginner, reference] [Hugging Face - Daily Papers](https://huggingface.co/papers) - A community-voted way to track papers that matter day by day.

## Future Structure

The source repository currently keeps the README as a verified index. Notes and
hands-on material should only be split out once there is enough original study
material to justify it.

```text
01-foundations/        # Concept notes and visual explanations
02-courses/            # Course notes and exercises
03-agents-mcp/         # Tool-calling and MCP experiments
06-rag/                # Retrieval-augmented generation practice
08-papers/             # Paper summaries
```

## Attribution and License

This English version is adapted from
[melocream/awesome-llm-study](https://github.com/melocream/awesome-llm-study),
maintained by Dataga Dapida (Dongwon Kim, [@melocream](https://github.com/melocream)).
The upstream curation was last marked updated on 2026-07-29; see the
[source commit history](https://github.com/melocream/awesome-llm-study/commits/master)
for changes after that point.
The source material is licensed under
[Creative Commons Attribution 4.0 International](https://github.com/melocream/awesome-llm-study/blob/master/LICENSE).

External resources remain links to their original publishers; no third-party
course, paper, documentation, or media content is vendored here.

When you are ready to run this as a group, use [Marblo](https://marblo.app) to
turn the roadmap into visible work: tickets for each module, separate lanes for
paper reading and implementation, and review checkpoints for what the team
actually learned.
