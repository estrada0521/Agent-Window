# Gemini direct API の試験導線

この repo には [`bin/multiagent-gemini-api-stream`](../bin/multiagent-gemini-api-stream) を追加しました。Gemini CLI を経由せず、Gemini Developer API を直接叩いて stream の粒度を確かめるための最小ヘルパーです。

目的は既存の Gemini pane 運用を置き換えることではありません。generic な pane capture より上流の provider-specific adapter を作れるかを見るための、最初の実験面です。

## 必要なもの

- `GEMINI_API_KEY` または `GOOGLE_API_KEY`
- その shell からのネットワーク疎通

無料枠での試験は Google AI Studio の API key で始められます。Gemini Advanced は必須ではありません。公式 docs:

- https://ai.google.dev/gemini-api/docs/api-key
- https://ai.google.dev/gemini-api/docs/pricing

## 基本の使い方

```bash
bin/multiagent-gemini-api-stream "Say hello in one short sentence."
```

stdin でも送れます。

```bash
printf '%s' 'Explain why structured streams matter.' | bin/multiagent-gemini-api-stream
```

## よく使うオプション

別 model を使う:

```bash
bin/multiagent-gemini-api-stream --model gemini-2.5-pro "Summarize the task."
```

system instruction を付ける:

```bash
bin/multiagent-gemini-api-stream \
  --system "You are terse and technical." \
  "Explain SSE in two sentences."
```

plain text ではなく normalized JSONL を見る:

```bash
bin/multiagent-gemini-api-stream --format jsonl "Return a short answer."
```

raw SSE 行をそのまま見る:

```bash
bin/multiagent-gemini-api-stream --format raw "Return a short answer."
```

## 出力モード

- `text`: 抽出した text だけを出します
- `jsonl`: streamed chunk ごとに 1 行の JSON を出します。raw payload も含みます
- `raw`: 受け取った SSE 行をそのまま出します

## このヘルパーの位置づけ

generic な外部 agent CLI では、multiagent が触れるのは process / PTY / sidecar log / pane capture が中心です。一方、provider API 直結では、それより上流の structured stream に触れられます。このヘルパーは、その adapter 層に向けた最小の足場です。
