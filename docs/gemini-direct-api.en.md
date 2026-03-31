# Gemini Direct API Probe

This repo now includes [`bin/multiagent-gemini-api-stream`](../bin/multiagent-gemini-api-stream), a minimal helper for probing the Gemini Developer API directly instead of going through the Gemini CLI.

The point of this helper is not to replace the existing Gemini pane workflow. It is a first upstream test surface for the longer-term goal of building provider-specific adapters above generic pane capture.

## Requirements

- `GEMINI_API_KEY` or `GOOGLE_API_KEY`
- network access from the current shell

For free-tier testing, Google AI Studio can issue an API key without requiring Gemini Advanced. See the official docs:

- https://ai.google.dev/gemini-api/docs/api-key
- https://ai.google.dev/gemini-api/docs/pricing

## Basic usage

```bash
bin/multiagent-gemini-api-stream "Say hello in one short sentence."
```

stdin also works:

```bash
printf '%s' 'Explain why structured streams matter.' | bin/multiagent-gemini-api-stream
```

## Useful options

Use a different model:

```bash
bin/multiagent-gemini-api-stream --model gemini-2.5-pro "Summarize the task."
```

Add a system instruction:

```bash
bin/multiagent-gemini-api-stream \
  --system "You are terse and technical." \
  "Explain SSE in two sentences."
```

Get normalized JSONL instead of plain text:

```bash
bin/multiagent-gemini-api-stream --format jsonl "Return a short answer."
```

See raw SSE lines:

```bash
bin/multiagent-gemini-api-stream --format raw "Return a short answer."
```

## Output modes

- `text`: prints extracted text only
- `jsonl`: emits one JSON object per streamed chunk, including the raw Gemini payload
- `raw`: prints the raw SSE lines exactly as received

## Why this exists

For generic external agent CLIs, multiagent usually only has access to PTY output, sidecar logs, or pane capture. Direct provider APIs are different: they can expose a more upstream structured stream. This helper is the first small step toward that adapter layer.
