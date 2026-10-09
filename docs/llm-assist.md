# LLM assist

Opt-in model-backed helpers. Off by default — no `DOCKETRY_LLM_API_KEY`, no
LLM calls, and every assist surface returns `503 LLM_DISABLED`.

## Config

```bash
DOCKETRY_LLM_API_KEY=sk-or-…            # OpenRouter (or compatible) key
DOCKETRY_LLM_BASE_URL=https://openrouter.ai/api/v1
DOCKETRY_LLM_MODEL=google/gemini-2.5-flash-lite
```

The provider speaks OpenAI-style `POST /chat/completions`, so any compatible
endpoint works (OpenRouter, a local llama.cpp server, a proxy). Default model
is deliberately cheap; set `DOCKETRY_LLM_MODEL` to whatever fits your budget.

## Surfaces

All advisory — nothing mutates issues:

| Endpoint | Purpose |
|---|---|
| `GET /v1/:ws/llm/status` | `{enabled, model}` — the UI uses this to hide assist controls |
| `POST /v1/:ws/issues/:key/summarize` | 2–3 sentence summary of title + description + recent comments |
| `POST /v1/:ws/issues/:key/triage-suggest` | `{action: accept\|decline, reason}` triage verdict |
| `POST /v1/:ws/issues/dup-check` | `{title, description?}` → likely duplicate open issues |
| `POST /v1/:ws/issues?dupCheck=1` | same detection, attached to create as `possibleDuplicates` |

Issue detail renders a `✦ summarize` button only when the status endpoint
reports `enabled`. Upstream failures surface as `502 LLM_UPSTREAM`;
unparseable model output as `502 LLM_BAD_RESPONSE`.

## Provider seam

`services/llm.ts` defines `LLMProvider` (`complete({system, user, …})`).
`createOpenRouterProvider()` is plain fetch — no SDK. A second provider
(local model, Perplexity, a gateway) implements the same interface and
plugs into `createAssist(provider)`.
