# External research on context management

Status: research, not implementation. Sources accessed online on 2026-09-09. This extends the proposal in `19-context-management-strategy.md`; the research below does not measure RPI latency or establish an optimal token budget for its current models.

## Recommended reading and conclusion

Start with the March 2026 [Anthropic context-engineering cookbook](https://platform.claude.com/cookbook/tool-use-context-engineering-context-engineering-tools) and the July 2026 [SentinelLABS compaction evaluation](https://www.sentinelone.com/labs/context-engineering-compaction-agent-memory-for-automated-malware-analysis/). They distinguish practical mechanisms and demonstrate why cost and quality need separate evaluation. For 2026 papers, read [SimpleMem](https://arxiv.org/abs/2601.02553) on assignment-aware retrieval and [AgeMem](https://arxiv.org/abs/2601.01885) on coordinating persistent memory with active context. The older Anthropic, OpenAI, LongMemEval, and Manus material below supplies background and qualifications.

Together, these sources support selecting relevant current artifacts, loading supporting material on demand, keeping recoverable originals, and carrying explicit progress between sessions. They also refine the proposal: preserve complete binding sections and useful failure evidence, prefer a small known input set plus optional discovery, and consider prompt-cache reuse when deciding when to rebuild context. Neither the research nor the specifications reviewed establish a universal 2,000-token bootstrap, 8,000-to-12,000-token working set, or 60% turnover threshold. Those remain hypotheses to test with our tasks and models.

## Publications from 2026

Dates here are the publication dates displayed by the original publisher, or the first submission dates in arXiv's version history. They are not dates inferred from an older article being refreshed. Sources and full texts were checked online on September 9, 2026.

### Anthropic cookbook, March 20: choose the mechanism that matches the problem

[Context engineering: memory, compaction, and tool clearing](https://platform.claude.com/cookbook/tool-use-context-engineering-context-engineering-tools) is a first-party, executable tutorial that distinguishes three mechanisms:

- Compaction summarizes an accumulating conversation, including reasoning and dialogue.
- Tool-result clearing removes bulky, re-fetchable observations while retaining the tool-call record.
- External memory persists selected state across sessions.

It demonstrates these independently and together using eight synthetic research documents, with probes for which details survive compaction. Its configuration values are tuned for demonstration, not production recommendations. It warns that clearing can cause redundant reads, invalidate cache prefixes, and perform poorly when passages need side-by-side comparison. This is a tutorial, not an independent coding-agent benchmark.

For RPI, this strengthens the distinction between selecting artifacts at startup, managing old file-read results inside an active conversation, and preserving a continuation checkpoint. Re-fetchability must mean the exact needed revision can be recovered; a mutable path that now points to different content is insufficient for historical evidence. bb/provider integrations own history editing.

### SimpleMem, January 5: retrieve according to the current intent

[SimpleMem: Efficient Lifelong Memory for LLM Agents](https://arxiv.org/abs/2601.02553), [full text reviewed, v3 January 29](https://arxiv.org/html/2601.02553v3), combines structured memory entries, consolidation, and intent-aware retrieval. Table 5 reports LoCoMo average F1 of 43.24 for the full system versus 37.78 without intent-aware retrieval, using GPT-4.1-mini.

This supports testing selection by assignment rather than returning every artifact. Its evaluations concern conversational memory QA, not multi-phase repository work. The authors' compression terminology and reported token savings do not establish lossless preservation of arbitrary requirements or expected savings for RPI. Keep original artifacts recoverable.

### AgeMem, January 5: token count alone is the wrong objective

[Agentic Memory: Learning Unified Long-Term and Short-Term Memory Management for Large Language Model Agents](https://arxiv.org/abs/2601.01885), [full text reviewed, v3 July 23](https://arxiv.org/html/2601.01885v3), treats persistent-memory operations and active-context retrieval, summarization, and filtering as related controls. It trains a policy using reinforcement learning rather than assuming tool availability alone produces appropriate memory behavior.

Its small Qwen-model experiments cover interactive environments and HotpotQA. Section 4.3 reports different quality at similar token counts across filtering settings: excessive filtering loses useful context, while permissive filtering admits marginal material. This supports evaluating sufficient evidence and correct continuation, not minimizing input size alone. It does not justify adding an RL stack to RPI.

### MemRL, January 6: similar past work may still be unhelpful

[MemRL: Self-Evolving Agents via Runtime Reinforcement Learning on Episodic Memory](https://arxiv.org/abs/2601.03192), [full text reviewed, v2 February 12](https://arxiv.org/html/2601.03192v2), first retrieves similar experiences and then selects using relevance and utility learned from execution feedback. It includes BigCodeBench alongside other evaluations, but not versioned repository-artifact workflows. Noisy feedback and ambiguous credit assignment are acknowledged limitations.

The useful RPI principle is to retain verified outcomes and relevant failed approaches with their scope and provenance. Keyword similarity alone does not make an old artifact useful. Deterministic phase/dependency selection remains a simpler starting point than learned utility ranking.

### Sourcegraph, May 28: a practical guide for coding-agent retrieval

[Context Engineering: A Practical Guide for AI Agents](https://sourcegraph.com/blog/context-engineering), by Matt Tanner, discusses instructions, retrieval, memory, and tools. It emphasizes code-aware retrieval, freshness, filtering, and per-task token/tool-call measurements. Its warnings about stale indexes and deprecated documentation are relevant to artifact versions.

This is a vendor engineering/product guide. It references Sourcegraph's own benchmark and promotes its product; those benchmark numbers were not independently evaluated here and are not used as proof of an RPI improvement.

### Red Hat, June 1: keep memory separate from authoritative records

[From context to dreams: architecting memory for AI agents](https://next.redhat.com/2026/06/01/from-context-to-dreams-architecting-memory-for-ai-agents/) distinguishes session memory, persistent files, episodic memory, and semantic memory. Its illustrative architecture explicitly separates derived memories from source-of-truth records. It also presents a small two-session demonstration of continuity.

This is an emerging-technology architecture overview with an introductory example, not a controlled general benchmark. It supports separating RPI's checkpoint from authoritative artifacts, but does not establish that a new external memory service is necessary.

### SentinelLABS, July 2: measure capability losses beneath the aggregate score

[Context Engineering: Compaction & Agent Memory for Automated Malware Analysis](https://www.sentinelone.com/labs/context-engineering-compaction-agent-memory-for-automated-malware-analysis/), by Gabriel Bernadett-Shapiro, reports about 86% fewer input tokens with native compaction and an effectively unchanged aggregate evaluation score in its malware-analysis harness.

The material caveat is that domain object modeling declined. The authors interpret this as loss of structural reasoning useful later. They retain exact artifacts and findings outside the compacted working state, and explicitly recommend preserving failed paths and measuring quality alongside resource use.

This is a vendor evaluation in a specialized domain. The article does not provide a sample count or sufficient experiment details for independent reproduction, and its token reduction is not an expected RPI result. Its strongest contribution to our plan is the evaluation design: track specific requirements and reasoning capabilities rather than declaring success from one overall score.

### Agentic Context Management, July 23: a recent architecture opinion

[Agentic Context Management: Solving Agent Memory and Cost by Treating Them as Lifecycle and Architecture Problems](https://arxiv.org/abs/2607.21503), [v1 full text](https://arxiv.org/html/2607.21503v1), by Gaurav Dadhich, argues that storing memory, selecting context, retiring stale information, and validating compaction form a lifecycle. It distinguishes retrieving something relevant from retrieving all evidence necessary to reason correctly.

This is a Maximem vendor-authored systems/position preprint. Section 6.3 explicitly provides no production-latency, token-cost-per-task, or context-rot evaluation. Per-run artifacts are available on request, and vendor comparisons are not controlled head-to-head experiments. Treat its taxonomy as an architecture opinion, not a standard or demonstrated latency solution.

The current MCP resources specification cited below is also dated July 28, 2026. It remains a protocol specification rather than empirical evidence for an optimal context policy.

## Empirical evidence

### 1. Lost in the Middle: placement and selection matter

**Source:** Liu et al., *Transactions of the Association for Computational Linguistics*, 2024, volume 12, pages 157-173. First preprint appeared in 2023. [Published paper and metadata](https://aclanthology.org/2024.tacl-1.9/); [full text reviewed, v3](https://arxiv.org/html/2307.03172v3).

The researchers varied context length and the position of relevant material in multi-document question answering and synthetic key-value retrieval. In the tested models, question-answering performance was often highest when the relevant passage occurred near the beginning or end and worse when it occurred in the middle. Extended-context counterparts were not necessarily better at using the same supplied context. Adding retrieved documents also produced diminishing returns in a separate open-domain QA experiment. See sections 2.3 and 5.

Evidence snippet: “extended-context models are not necessarily better at using their input context.”

**Application to RPI:** select the relevant artifact and sections before loading them. Do not treat a model's advertised context window as proof that it will reliably use every document placed inside it.

**Limit:** the main experiments used 2023 models, including GPT-3.5-Turbo, Claude 1.3, MPT, and LongChat, with additional GPT-4 and Llama-2 experiments. These are retrieval/QA evaluations, not current coding-agent benchmarks. They establish a failure mode, not a universal placement rule or current-model performance prediction.

### 2. Context Rot: unrelated input can reduce reliability even with newer models

**Source:** Hong, Troynikov, and Huber, Chroma technical report, July 14, 2025, with a July 16 clarification noted on the page. [Report, methods, results, and limitations](https://research.trychroma.com/context-rot).

This is **vendor research**, not a peer-reviewed standard. It evaluates 18 models, including GPT-4.1, Claude 4, Gemini 2.5, and Qwen3, on controlled retrieval variants, conversational QA, and repeated-word replication. Performance varied with input length, semantic similarity, distractors, and the structure of otherwise irrelevant context.

The most relevant experiment compares focused and full inputs on a filtered subset of LongMemEval. The authors retained 306 questions concerning knowledge updates, temporal reasoning, and multiple sessions. Focused prompts averaged about 300 tokens; full prompts averaged about 113,000. The focused inputs were selected using dataset evidence labels and manual adjustments, and performed better across the evaluated models.

Evidence snippet: “Across all models, we see significantly higher performance on focused prompts compared to full prompts.”

**Application to RPI:** providing only the relevant current evidence is a credible strategy. Measure retrieval quality separately from the quality of the model's answer once evidence has been selected.

**Limits:** this focused condition uses effectively known relevant evidence. It does not prove that an automatic selector will find the right sections. The report uses LLM judges, controlled tasks, and a manually filtered dataset; it explicitly does not explain the mechanism behind the degradation. It provides no measured RPI latency improvement and no universal compaction threshold.

### 3. LLMs Get Lost In Multi-Turn Conversation: accumulated assumptions are a separate problem

**Source:** Laban, Hayashi, Zhou, and Neville, research preprint, May 9, 2025. [Paper](https://arxiv.org/abs/2505.06120); [full text reviewed, v1](https://arxiv.org/html/2505.06120v1).

The authors compare fully specified requests with equivalent instructions revealed gradually over simulated conversations. Across 15 models and six analytical generation tasks, including code and database queries, they report an average 39% performance decrease in the multi-turn condition. Their analysis covers more than 200,000 simulated conversations. Models often committed to assumptions early and then over-relied on their own earlier answers. See sections 6.1, 6.2, and Appendix F.

This is not solely a context-length experiment: five of the six main tasks do not target long-context capabilities. The distinction matters for artifact revision, where stale assumptions and previous solutions can remain salient even when the latest document has been retrieved correctly.

Evidence snippet: “Consolidate before retrying.”

Section 7.4 recommends consolidating requirements before starting a new conversation. The Concat condition supports giving the full requirements together. However, Recap and Snowball interventions that repeated user information within continuing conversations only partially recovered performance in the additional experiments with GPT-4o and GPT-4o-mini.

**Application to RPI:** a fresh continuation should receive consolidated current requirements, explicit decisions, unresolved work, and source references. A generic “continue” instruction requires reconstruction and may carry the wrong assumptions forward.

**Limits:** the paper studies automated, English, text-only conversations with analytical tasks. The authors explicitly state that the simulated conversations are not representative of natural human-AI conversation. The 39% is a reported aggregate for that setup, not an expected slowdown or accuracy loss in RPI. It does not validate any particular handoff format, automatic summarizer, or session-rotation schedule.

### 4. LongMemEval: preserve recoverable evidence and test knowledge updates

**Source:** Wu et al., *LongMemEval: Benchmarking Chat Assistants on Long-Term Interactive Memory*, ICLR 2025. [Full text reviewed, v2 dated March 4, 2025](https://arxiv.org/html/2410.10813v2); [authors' benchmark repository and publication notice](https://github.com/xiaowu0162/LongMemEval).

The benchmark contains 500 curated questions covering information extraction, reasoning across sessions, temporal reasoning, knowledge updates, and abstention. It separates memory design into indexing, retrieval, and reading. These are useful distinctions for a plugin that must retain history while using current information.

Section 5.2 compares whole-session storage, decomposition into conversation rounds, and replacement with summaries or extracted facts. Round-level retrieval improved reading with GPT-4o but was similar to whole sessions with Llama 3.1 8B. Summary/fact replacement generally reduced QA performance through information loss, with an exception for fact decomposition on multi-session reasoning. The best context budget was model-dependent: GPT-4o continued improving beyond 20,000 retrieved tokens in this experiment, while Llama 3.1 8B degraded beyond 3,000.

Evidence snippet: “replacing sessions or rounds with extracted summaries or facts negatively impacts QA performance due to information loss.”

**Application to RPI:** use summaries to locate evidence, retain exact source sections for binding requirements, and make old revisions recoverable. Evaluate whether the agent distinguishes a superseded decision from a current one, follows timestamps/version references, combines necessary dependencies, and recognizes missing evidence.

**Limits:** this benchmark concerns personal conversational memory, not software artifact lifecycle or concurrent editing. Its decomposition and compression findings depend on its retriever, reader, and extraction setup. It cautions against both indiscriminate full-history loading and treating the shortest prompt as automatically best. No numerical budget from this experiment should become an RPI policy without local evaluation.

### 5. MemGPT: an architectural precedent for bounded working context

**Source:** Packer et al., research preprint first submitted October 12, 2023, revised February 12, 2024. [Paper and revision history](https://arxiv.org/abs/2310.08560); [full text reviewed, v2](https://arxiv.org/html/2310.08560v2).

MemGPT separates working context from external recall and archival storage. The agent explicitly retrieves information into its finite context, uses paginated retrieval, and preserves evicted messages externally. Its queue manager combines a rolling history with summaries and memory-pressure warnings. Evaluations cover multi-session conversation, document QA, and nested key-value retrieval using GPT-3.5/GPT-4-era models. See sections 2 and 3.

Evidence snippet: “implement pagination to prevent retrieval calls from overflowing the context window.”

**Application to RPI:** durable storage and active context should be separate. Existing artifacts and version history can remain available without loading all their content into a session. Bounded discovery, explicit reads, and a compact current handoff fit this general architecture.

**Limits:** this is a system design and evaluation, not a standard or a reason to adopt its complete framework. Its example warning/flush percentages are illustrative implementation values, not empirically optimal thresholds. Model function-calling quality materially affected its results. RPI does not need to add a vector database or autonomous memory service to apply the storage/context separation.

## Engineering documentation and practitioner opinion

### 6. Anthropic: references first, content when needed

**Source:** Anthropic Applied AI team, September 29, 2025. [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents).

This first-party engineering article recommends lightweight identifiers such as paths and links, retrieving content as it becomes relevant, and progressively discovering supporting information. For long tasks it describes compaction, persistent structured notes, and focused subagents whose detailed working context stays separate from the coordinator.

The article also acknowledges that runtime discovery can be slower than precomputed retrieval. Its hybrid example preloads a small amount of stable context and uses search for the rest. For compaction, it recommends first maximizing recall of relevant information, then removing superfluous content; overly aggressive compression can discard details whose importance emerges later.

**Application:** preload the assignment, selected primary reference, shared constraints, and checkpoint. Offer bounded discovery for the rest. Retain complete necessary sections. This is engineering guidance and examples, not a benchmark validating RPI's particular artifact-selection algorithm.

### 7. Anthropic: compaction alone does not make continuation reliable

**Source:** Anthropic engineering, November 26, 2025. [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents).

Their coding-harness experiments encountered half-finished work with inadequate handoff notes and later sessions declaring completion prematurely. The successful harness combined incremental work, an explicit feature list, progress notes, git history, and verification. New sessions read progress and inspect the environment before choosing the next unfinished feature.

**Application:** a checkpoint should identify remaining work and verified state, and the next agent should check it against the current repository. This directly supports improving RPI's generic Iterate prompt. The article does not establish that its initializer/coding-agent architecture, JSON feature format, or entire workflow must be copied. Existing RPI phase artifacts can own the corresponding information.

### 8. OpenAI: trimming and summarization have different failure modes

**Source:** Emre Okcular, OpenAI Cookbook, September 9, 2025. [Context engineering: short-term memory management with sessions from OpenAI Agents SDK](https://developers.openai.com/cookbook/examples/agents_sdk/session_memory).

The guide provides concrete session implementations for retaining recent turns and summarizing earlier history. Trimming is deterministic and avoids an extra summarizer call, but can lose old decisions and still admit a huge recent tool response. Summarization carries older requirements forward, but adds processing cost and risks omissions, bias, and compounding incorrect facts. The guide calls out summary logging and evaluation as necessary observability.

**Application:** store exact requirements and evidence separately from the compact checkpoint. Avoid treating an agent-generated summary as an authoritative replacement for every source. Evaluate whether decisions survive handoff, not just whether the summary is short. These are tutorial implementations, not an automatic memory guarantee from selecting an SDK.

Current [OpenAI compaction documentation](https://developers.openai.com/api/docs/guides/compaction) also describes native server-side and standalone compaction. The output can include opaque encrypted state. Standalone compact output is the canonical next window and must be passed onward intact. [Claude context-editing documentation](https://platform.claude.com/docs/en/build-with-claude/context-editing) describes selective removal of older tool results and notes cache invalidation when content is cleared.

For RPI, these APIs establish available provider mechanisms, not proof that bb currently exposes or enables them. bb/provider integrations own conversation-history management; RPI should own artifact selection and portable, inspectable task handoffs. A cross-provider handoff cannot depend solely on opaque provider state.

### 9. Manus and OpenAI: optimize context quality and cache reuse together

**Source:** Yichao Ji, Manus, July 18, 2025. [Context Engineering for AI Agents: Lessons from Building Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus). Corroborating mechanism: [OpenAI prompt-caching documentation](https://developers.openai.com/api/docs/guides/prompt-caching).

Manus describes stable prompt prefixes, deterministic serialization, and preserving history within a running segment to improve cache reuse. It also externalizes large observations to files and retains paths or URLs so omitted content can be recovered. The article recommends keeping failure evidence that helps the agent avoid repeating an unsuccessful action. These are lessons from one production team, not universal experimental results.

OpenAI's current documentation confirms that cache reuse depends on matching rendered prefixes and eligible cache boundaries. It explicitly warns that compaction can reduce cache reuse and recommends comparing total input cost before and after compaction. Caching reuses computation; it does not remove the retained information from the model's context or repair contradictory instructions.

**Application:** keep static instructions and the current segment's selected references stable. Refresh selection and consolidate history at deliberate checkpoints rather than rebuilding every preceding message on every turn. Measure time to first meaningful action, uncached/cached input, total cost, and correctness together. Discard redundant raw failure output only after retaining the relevant failed attempt, reason, and recovery evidence. The plugin must work through bb's supported history/provider controls.

## Relevant standards and specifications

### Agent Skills: progressive disclosure is explicitly specified

[Agent Skills specification](https://agentskills.io/specification), current page accessed September 9, 2026, describes three loading levels: startup metadata, instructions when a skill activates, and referenced resources only when required. It recommends focused reference files and a main skill body under 500 lines, with fewer than 5,000 instruction tokens recommended.

This is an open skill-format specification. Its token guidance concerns skill instructions, not a universal budget for the entire agent or task. RPI can apply its loading pattern to phase instructions and references without interpreting every available skill/resource as mandatory context.

### MCP: standardize discovery and reading, leave selection to the host

[MCP resources specification, 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/server/resources), resolved from the live `latest` URL, defines identifiable resources, separate resource listing and reading, paginated discovery, and optional change notifications. It explicitly describes resources as application-driven: the host determines how to incorporate them, including user selection, search/filtering, or automatic inclusion.

MCP does not prescribe an ideal context budget, current-artifact policy, or phase-specific selection algorithm. Its existence does not mean every resource should be injected. RPI already has tool/RPC surfaces; adopting this pattern does not require adding another MCP server.

### W3C PROV-O: stable identities and revision provenance

[PROV-O, W3C Recommendation, April 30, 2013](https://www.w3.org/TR/prov-o/) defines revision and provenance relationships, including `prov:wasRevisionOf` and `prov:specializationOf`. Its document example distinguishes a lasting permalink from individual revision snapshots and records how one revision derives from another.

This is a formal provenance standard, not an LLM context-management policy. It supports the conceptual distinction between an evolving artifact and the exact revision used as evidence. The RPI application is to retain stable identity and record the revision read, while deciding currentness and approval separately. There is no need to introduce RDF or a provenance framework to preserve these invariants in the existing schema.

## What these sources support, and what they leave open

The evidence supports a **smallest sufficient working context**: select current, relevant evidence; preserve complete necessary requirements; store history outside the active prompt; consolidate work before deliberate continuation; and retain a path back to original sources. This is a synthesis of the findings above, not a published end-to-end standard for agent artifact versioning.

It also narrows the prior proposal. Latest-only retrieval is useful but does not by itself address long current documents, accumulated incorrect answers, or requirements scattered across many turns. Conversely, aggressively summarizing everything can lose information. Model-specific evaluations are required before turning token targets or context-warning percentages into hard policy.

For local validation, hold the assignment and required content fixed while adding unrelated artifacts, old revisions, or previous unsuccessful attempts. Check task correctness, superseded-decision use, missing constraints, recovery after continuation, retrieved/emitted tokens, cache reuse, and latency separately. Compare selected full sections with summary-only and full-history baselines. This proposed evaluation is an RPI-specific application of the sources, not a result already demonstrated by them.

## Verification

The primary paper full texts, first-party reports, engineering articles, provider documentation, and specifications were fetched and reviewed online. Publication/revision metadata was checked against ACL Anthology, arXiv, and the LongMemEval authors' repository. Reported experimental numbers above are attributed to their original sources. This is a targeted source review, not an exhaustive literature search.

No runtime behavior, live task, artifact, or session was changed; this document is the only repository edit from this research pass.

`npm test` passed typechecking and 242 of 243 tests. The same pre-existing naming check fails on the unchanged, tracked `docs/phases/18-concise-artifact-writing.md`. `bb plugin build` passed. No new implementation or live installation was performed. These checks establish repository baseline status, not empirical validation of the proposed context strategy.
