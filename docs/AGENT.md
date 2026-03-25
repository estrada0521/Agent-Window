# エージェント向けメモ（下書き）

このファイルは **multiagent 環境で動作するエージェント**に、最終的に伝える前提の事柄を蓄積するためのリストです。  
運用ルール・ツールの詳細はリポジトリ内の他ドキュメントやユーザー指示が優先されます。エージェントにそのまま読ませてよい形式を目指します。

---

## メッセージの送り方（agent-send）

- 他ペインのエージェントやユーザー閲覧チャットへ送るには `agent-send` を使う。本文は **stdin** 経由（`printf '%s' '…' | agent-send --stdin <宛先>`）を原則とし、シェルで解釈される文字（`$`、バッククォート、`\` など）を含む場合はインライン引数にしない。
- 宛先の例: `user`、各エージェント名（`claude` / `codex` / `gemini` …）、カンマ区切りで複数、環境によっては番号エイリアス。
- `agent-send --help` 相当の用法は `bin/agent-send` の `usage()` を参照。見つからない場合はリポジトリの `bin/agent-send` を絶対パスで実行できるようにしておく。
- スレッドや返信連携で `msg-id` / `--reply` を使うかどうかは **プロジェクトまたはユーザーの最新指示**に従う（チャットへ全文を送る・Pane にユーザー向け本文を直接出さない、など）。

## セッション・tmux・ログ

- 既定の tmux セッション名は `multiagent`。`MULTIAGENT_SESSION` や `agent-send --session` で別セッションを指すことがある。
- ソケットは `MULTIAGENT_TMUX_SOCKET` またはリポジトリ由来の既定名。複数のクローンを並行するときに取り違えない。
- 会話ログは通常 `.agent-index.jsonl` としてセッション用ディレクトリ以下に置かれる。`MULTIAGENT_LOG_DIR` / `MULTIAGENT_WORKSPACE` とパスの対応を誤らない。

## 自分の置かれた環境を素早く把握する（`multiagent context`）

- **Pane 内のシェル**から `multiagent context` を実行する。tmux セッション名、有効な tmux ソケット、`MULTIAGENT_WORKSPACE` / `MULTIAGENT_LOG_DIR` / `MULTIAGENT_BIN_DIR`、`MULTIAGENT_AGENTS`、各エージェントペインの pane id・タイトル・実行コマンド、（分かる場合）**今のペインがどのインスタンスか**（`MULTIAGENT_AGENT_NAME` または `TMUX_PANE` と `MULTIAGENT_PANE_*` の照合）、ユーザ帯ペインの env がまとまって表示される。
- 機械可読が欲しいとき: `multiagent context --json`
- 別セッションを指定するとき: `multiagent context --session <名前>`
- tmux 外・セッション不明では解決に失敗することがある。その場合は `MULTIAGENT_SESSION` を付与するか、`--session` を明示する。

## チャット UI と添付

- ファイル添付はコンポーザから行う。送信されたメッセージには `[Attached: パス]` のような表記が載る場合があり、ログ上でもパスが参照される。
- Raw / Brief / Memory / Load などのクイックアクションは、送信内容やエージェント制御の挙動がそれぞれ異なる。必要になったら UI またはコード側で確認する。
- 返信スレッド（`reply-to`）、メッセージ ID（`msg-id`）は会話の文脈追跡に使われる。

## Hub・サーバ

- `bin/agent-index --hub` で Hub（セッション一覧・再開・統計・設定など）が立ち上がる。チャット用の `agent-index` 起動とは別プロセス・別ポートのことがある。
- 公開アクセスやリバースプロキシを挟む場合は、表示 URL と実ポート（例: `MULTIAGENT_PUBLIC_HUB_PORT`）の関係に注意する。

## ドキュメントの所在（参照用）

- `docs/cursor-to-user-chat.md` … Cursor からユーザー宛チャットへ返す例。
- `.github/copilot-instructions.md` … Copilot 向けの multiagent 概要（他ツールのルールにも流用されうる）。

## リポジトリ運用メモ（人間・メンテナ向け）

- エージェント向け機能の追加は次の順が望ましい: **(1) 仕組みを実装する (2) 動作確認する (3) この AGENT.md に追記する (4) 所有者の許可後に push する**。

## 追記用（未整理メモ）

- （ここに今後 bullet を足していく）

