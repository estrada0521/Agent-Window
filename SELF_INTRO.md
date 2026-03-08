# Multiagent 環境 機能詳細資料

## 概要

**Multiagent** は、tmux セッション上で複数の AI エージェント（Claude, Codex, Gemini, Copilot）を並行して動作させるための bash ベースのツールです。Web ブラウザから利用できるチャット UI、自動承認モード、メッセージ履歴管理など、並行 AI 協調作業を支援する機能群を備えています。

一言で言えば、**tmux を実行基盤・JSONL を会話基盤・ブラウザ UI を観測基盤として、多数の AI エージェントを同時運用するための軽量な multi-agent OS** です。

### 2つの情報経路

環境は大きく 2 系統で動いています。

1. **ペイン実行経路**
   - tmux 経由でテキストをペインに貼り付けて Enter
   - `capture-pane` でペイン出力を取得
   - 承認ダイアログ検知時は自動で Enter（auto-mode）

2. **構造化チャット経路**
   - `agent-send` が `.agent-index.jsonl` に会話を追記
   - `agent-index` が JSONL を読みブラウザ UI に表示
   - `--reply <msg-id>` によりスレッドを維持

---

## 1. セッション管理 — `multiagent`

### 起動・基本コマンド

```bash
# セッション起動（auto-mode ON がデフォルト）
multiagent

# 特定エージェントのみ起動
multiagent --agents claude,gemini

# 古いログを消してフレッシュ起動
multiagent --fresh

# auto-mode 無効で起動
multiagent --no-auto

# デタッチして起動
multiagent --detach

# レイアウトを横並びに
multiagent --layout horizontal
```

### セッション管理コマンド

```bash
multiagent list [--verbose] [--all]       # セッション一覧
multiagent status [--session NAME]        # セッション状態確認
multiagent resume [--session NAME | --latest]  # 既存セッションに接続
multiagent kill [--session NAME | --all]  # セッション終了
multiagent rename --session NAME --to NEW # セッション名変更
multiagent save [--session NAME]          # ペイン出力をログに保存
multiagent brief [--session NAME] [--agent NAME]  # エージェントにブリーフィング送信
```

### 起動フラグ一覧

| フラグ | デフォルト | 説明 |
|--------|-----------|------|
| `--agents LIST` | claude,codex,gemini,copilot | 起動するエージェントをカンマ区切りで指定 |
| `--layout LAYOUT` | grid | `grid`（2×2）または `horizontal`（1×4） |
| `--workspace PATH` | カレントディレクトリ | 作業ディレクトリ |
| `--session NAME` | ディレクトリ名 | tmux セッション名 |
| `--log-dir PATH` | WORKSPACE/logs | ログ保存先（空にすると無効化） |
| `--user-pane SPEC` | top:1 | ユーザーペイン構成: `top`/`bottom:2`/`top:2,bottom:1`/`none` |
| `--detach` | off | セッション起動後アタッチしない |
| `--fresh` | off | 既存ログを削除してから起動 |
| `--no-auto` | off | 自動承認モードを無効化 |
| `--install` | off | `~/.local/bin/` にシンボリックリンクを作成 |

### resume 時の挙動

- `MULTIAGENT_AUTO_MODE=1` が保持されていて、モニタープロセスが停止している場合は自動で `multiagent-auto-mode on` を実行し、auto-mode を再起動する。

---

## 2. メッセージ送信 — `agent-send`

### 基本構文

```bash
agent-send [--session NAME] [--reply MSG_ID] <target> "メッセージ"
```

### ターゲット指定

| ターゲット | 説明 |
|-----------|------|
| `claude`, `codex`, `gemini`, `copilot` | 各 AI エージェント |
| `1`, `2`, `3`, `4` | 番号指定（claude=1, codex=2, ...） |
| `user` | チャット UI の受信トレイへ |
| `others` | 送信者以外の全エージェント |
| `claude,gemini` | カンマ区切りで複数同時送信 |

### フラグ

| フラグ | 説明 |
|--------|------|
| `--session NAME` | ターゲットセッションを指定（省略時は自動検出） |
| `--reply MSG_ID` | 親メッセージの msg-id を指定して返信（スレッド化） |

### セッション自動解決の優先順

`--session` が省略された場合、以下の順で解決します。

1. `--session NAME` フラグ
2. `MULTIAGENT_SESSION` 環境変数
3. 現在の tmux セッション
4. ワークスペースが一致するセッション
5. リポジトリ一致の唯一のアクティブセッション
6. `/tmp/multiagent_<socket>_panes` ステートファイル

### メッセージフォーマット

送信されるメッセージの先頭に自動でヘッダーが付加されます。

```
[From: claude | msg-id: a1b2c3d4e5f6]
[From: claude | msg-id: a1b2c3d4e5f6 | reply-to: parent_msg_id]
```

チャット UI 表示時にこのヘッダーは除去されます。

### JSONL ログ記録

送信したメッセージは全て `.agent-index.jsonl` に追記されます。

```json
{
  "timestamp": "2026-03-08 15:47:23",
  "session": "multiagent",
  "sender": "user",
  "targets": ["claude"],
  "message": "メッセージ本文",
  "msg_id": "a1b2c3d4e5f6",
  "reply_to": "parent_id（返信時のみ）",
  "reply_preview": "user: 親メッセージの冒頭80文字（返信時のみ）"
}
```

---

## 3. チャット UI — `agent-index --chat`

### 起動

```bash
agent-index --chat             # ブラウザでチャット画面を開く
agent-index --limit 200        # 表示上限を変更（デフォルト: 500）
agent-index --agent claude     # 特定エージェントのみ表示
agent-index --follow           # 端末でライブ表示（ブロッキング）
agent-index --json             # JSON 出力（サーバーなし）
```

---

## 4. チャット UI — 機能詳細

### 4-1. メッセージ表示

- **Markdown レンダリング**: `marked.js` による完全な GFM サポート（表・コードブロック・見出しなど）
- **数式レンダリング**: KaTeX による `$...$`（インライン）/ `$$...$$`（ブロック）サポート
- **ANSI カラー**: `ansi_up.js` で端末の色付き出力を HTML 変換
- **エージェント別カラー**: 送信者ごとに配色を変えて表示
- **アバター**: エージェントアイコン（SVG）またはイニシャル
- **メタ情報**: 送信者・宛先・タイムスタンプを各メッセージに表示

### 4-2. 検索・フィルター

- **キーワード検索**: ヘッダーの検索ボックスで送信者名・本文をリアルタイム絞り込み
- **エージェントフィルター**: `all / user / claude / codex / gemini / copilot` のチップを複数選択可能
- **ヒット数表示**: フィルター中は `N hits` を表示

### 4-3. 返信機能

- **返信ボタン（↩）**: 各メッセージにある返信ボタンをクリックすると返信モードに入る
- **自動ターゲット選択**: 返信元のエージェントが送信先に自動設定される
- **返信バナー**: 入力欄上部に引用元プレビューを表示（✕で解除可能）
- **インライン表示**: チャット画面上で返信元の冒頭テキストがメッセージ内に表示
- **スレッドジャンプ**: 返信プレビューをクリックすると元メッセージへスクロール＆ハイライト
- **msg-id 埋め込み**: エージェントペインのヘッダーに msg-id が注入され、エージェントが `--reply` を使えるようになる

### 4-4. @ファイル補完

- **トリガー**: 入力欄で `@` を入力するとファイル候補ドロップダウンが表示される
- **検索**: ワークスペース内のファイルを深さ 3 まで走査（`.git`, `logs`, `node_modules` 等を除外）
- **操作**: 矢印キーで選択 → Enter または Tab で挿入、Esc で閉じる
- **誤送信防止**: `stopImmediatePropagation()` で Enter による送信を防止

### 4-5. ペイン出力ツールチップ

- **トリガー**: 右上のエージェントステータス行にホバー
- **内容**: エージェントペインの最新約 50 行の出力を表示
- **ANSI 対応**: `ansi_up` でカラー変換、dim コード（ESC[2m）はグレーに正規化
- **リアルタイム更新**: ホバー中 300ms 間隔で最新出力を再取得
- **表示形式**: モノスペースフォント、折り返しなし（tmux のビジュアルを保持）

### 4-6. Auto-Mode フラッシュ

- **仕組み**: 自動承認モニターが承認を送信すると `/tmp/multiagent_auto_approved_<SESSION>` を更新
- **検出**: チャット画面が 3 秒ごとに mtime をポーリング
- **視覚フィードバック**: 承認されたエージェントのターゲットチップが 1.8 秒間緑色にフラッシュ

### 4-7. エージェントステータスパネル

- **表示位置**: 右上隅
- **ステータス種別**:
  - `running`（緑グロー）— ペインが変化している
  - `idle`（グレー）— 変化なし
  - `dead`（赤）— ペインが存在しない
  - `offline`（薄グレー）— 情報取得不可
- **更新**: 3 秒間隔でポーリング

### 4-8. クイックアクションボタン

| ボタン | 動作 | チャットへの記録 |
|--------|------|----------------|
| **Send Brief** | 選択エージェントにブリーフィングを非同期送信 | システムメッセージとして記録 |
| **Load Memory** | メモリファイルをエージェントに silent 送信、エージェントは "Memory loaded" で返答 | システムメッセージとして記録 |
| **Save Memory** | メモリ更新指示を silent 送信、エージェントは "Memory saved" で返答 | システムメッセージとして記録 |
| **Save Log** | `multiagent save` でペイン出力を保存 | システムメッセージとして記録 |
| **Kill** | `multiagent kill` でセッションを終了 | — |

> **Silent 送信**: Load Memory / Save Memory は `agent-send` を経由せず tmux に直接送信するため、JSONL ログには記録されずチャット画面にも表示されません。

### 4-9. システムメッセージ

ボタン操作時などに自動生成される特別なメッセージ。

- **表示形式**: 中央寄せの細い区切り線スタイル（例: `────── Send Brief → claude ──────`）
- **記録**: `/log-system` エンドポイント経由で `sender: "system"` として JSONL に書き込み
- **用途**: ボタン操作の履歴をチャット上に残す

### 4-10. セッション状態表示

ヘッダーのステータスピルで現在の状態を確認できます。

| ピル | 説明 |
|------|------|
| `messages: N` | 表示中のメッセージ数 |
| `filter: all|agent` | アクティブなフィルター |
| `mode: snapshot|follow` | スナップショット or ライブ（1秒更新） |
| `state: active|archived` | セッションの活動状態 |
| `source: /path/to/.jsonl` | ログファイルのパス |
| `Auto: on|off` | auto-mode の状態（ON 時は緑） |

---

## 5. 自動承認モード — `multiagent-auto-mode`

```bash
multiagent-auto-mode on|off|status [--session NAME]
```

### 動作原理

- バックグラウンドで監視ループを起動（PID を `/tmp/multiagent_auto_<SESSION>.pid` に保存）
- 各エージェントペインを **0.5 秒間隔** でキャプチャし、承認ダイアログを検出したら Enter を送信

### エージェント別検出パターン

| エージェント | 検出パターン |
|-------------|------------|
| Claude | "Do you want to" |
| Codex | "Would you like to run" / "Press enter to confirm" |
| Gemini | "Action Required" / "Allow once" |

### 重複防止

- ペイン内容のハッシュ（cksum）を保持し、同一ダイアログへの二重送信を防止
- 3 秒間のクールダウンで連続送信を防止

---

## 6. セッションメモリ機能

### 概要

エージェントごとにセッション固有のメモリファイル（`logs/<session>/<agent>_memory.md`）を持ちます。

### 操作方法

| 操作 | 説明 |
|------|------|
| **Save Memory ボタン** | エージェントにメモリファイルの更新を指示（`agent-send user "Memory saved"` で完了報告） |
| **Load Memory ボタン** | 保存済みメモリの内容をエージェントに送信し、コンテキストを復元（`agent-send user "Memory loaded"` で完了報告） |

### 指示文

メモリ保存時にエージェントに送られる指示：

```
Please update your session memory file at: <path>

Do not ask for clarification. Read the existing content if the file exists,
rewrite it with key context from this conversation: important facts, user
preferences, decisions made, and work in progress. Max 100 lines.
Do NOT save memory on your own — only save when explicitly instructed by the user.
After saving, run: agent-send user "Memory saved"
```

---

## 7. ユーザーシェルショートカット

ユーザーペインのシェルで使用できる短縮コマンドです。

| コマンド | 等価な操作 |
|---------|-----------|
| `brief [SESSION]` | `multiagent brief --session SESSION` |
| `follow` | `agent-index --follow` |
| `idx` | `agent-index` |
| `kill` | `multiagent kill --session SESSION` |
| `save` | `multiagent save --session SESSION` |
| `auto-mode [on|off|toggle]` | `multiagent-auto-mode [on|off]` |

---

## 8. ログ・ファイル構造

### ディレクトリ構造

```
WORKSPACE/logs/
└── <session>_<created_yymmdd>_<updated_yymmdd>/
    ├── .agent-index.jsonl   # 構造化メッセージ履歴
    ├── claude.log           # テキスト出力（ANSI 除去済み）
    ├── claude.ans           # 生出力（ANSI コード付き）
    ├── codex.log / codex.ans
    ├── gemini.log / gemini.ans
    ├── copilot.log / copilot.ans
    ├── claude_memory.md     # Claude のセッションメモリ
    ├── codex_memory.md
    ├── gemini_memory.md
    └── copilot_memory.md
```

---

## 9. アーキテクチャ

### tmux ソケット

複数のインストール間の競合を防ぐため、リポジトリルートの SHA1 ハッシュから一意のソケット名を生成します。

```
multiagent-<SHA1(REPO_ROOT)[:12]>
```

### セッション環境変数

各エージェントペインに注入される環境変数：

| 変数 | 説明 |
|------|------|
| `MULTIAGENT_SESSION` | セッション名 |
| `MULTIAGENT_BIN_DIR` | `bin/` ディレクトリのパス |
| `MULTIAGENT_WORKSPACE` | 作業ディレクトリ |
| `MULTIAGENT_LOG_DIR` | ログ親ディレクトリ（`logs/` フォルダ） |
| `MULTIAGENT_PANE_CLAUDE` 等 | 各エージェントの tmux ペイン ID |
| `MULTIAGENT_PANE_USER` | ユーザーペイン ID（1つ目） |
| `MULTIAGENT_PANES_USER` | ユーザーペイン ID 一覧（複数ペイン時） |
| `MULTIAGENT_TMUX_SOCKET` | tmux ソケット名 |
| `MULTIAGENT_AUTO_MODE` | auto-mode 状態（`1` = ON） |
| `MULTIAGENT_AGENT_NAME` | 各ペインのエージェント名 |

### /tmp ステートファイル

tmux 環境変数を継承できないサンドボックス環境向けに `/tmp/multiagent_<socket>_panes` にペイン ID を書き出します。これにより `agent-send` 等が tmux 外からでもペインを解決できます。

### メッセージフロー

```
ユーザー（チャット UI）
    ↓ POST /send
Python サーバー
    ↓ subprocess
agent-send
    ↓ JSONL 書き込み + tmux paste-buffer + send-keys Enter
エージェントペイン（受信・処理）
    ↓ agent-send --reply <msg-id> user "返答"
JSONL に記録
    ↓ チャット UI が 1 秒ポーリングで取得・表示
```

---

## 10. チャット UI — HTTP エンドポイント一覧

### GET

| エンドポイント | クエリ | 説明 |
|--------------|-------|------|
| `/messages` | `ts=TIMESTAMP` | メッセージ一覧を JSON で返す |
| `/trace` | `agent=NAME&ts=TIMESTAMP` | ペインの最新出力（ANSI 付き） |
| `/files` | — | ワークスペースのファイル一覧（深さ 3 まで） |
| `/agents` | `ts=TIMESTAMP` | 各エージェントのステータス |
| `/auto-mode` | `ts=TIMESTAMP` | auto-mode 状態と直近の承認情報 |
| `/memory-path` | `agent=NAME` | メモリファイルのパスと内容 |
| `/icon/AGENT` | — | エージェントアイコン（SVG） |

### POST

| エンドポイント | ボディ | 説明 |
|--------------|-------|------|
| `/send` | `{target, message, reply_to?, silent?}` | メッセージ送信（`silent=true` で JSONL ログなし） |
| `/auto-mode` | — | auto-mode のトグル |
| `/log-system` | `{message}` | システムメッセージを JSONL に書き込み |

---

---

## 11. agent-index のログ探索

`agent-index` はアクティブセッションとアーカイブ済みセッションの両方を扱えます。ログ root の候補を以下の順で収集します。

1. アクティブセッションの `MULTIAGENT_LOG_DIR`
2. `MULTIAGENT_WORKSPACE/logs`
3. リポジトリの `logs/`

その後、`<session>_<created>_<updated>/.agent-index.jsonl` パターンで最新のログファイルを探索します。

---

## 12. 運用知見

この環境を長期運用して得られた実践的な知見です。

- **tmux と browser の表示ずれ**: ペインの文字幅・折り返し・ANSI の扱いで容易にずれる。browser 側の見栄えより tmux ペインの見た目を基準に合わせる方が運用満足度が高い
- **メモリ操作は明示的に**: Save Memory / Load Memory はユーザーが明示的に指示した時だけ行う。エージェントが自律的に保存すると予期しないタイミングで上書きされる
- **コードブロックの shell 安全性**: `agent-send` でコードブロックを含むメッセージを送る場合、バッククォート（`` ` ``）が shell のコマンド置換として解釈される。heredoc + tick 変数（`tick='```'`）を使うと安全
- **返信には必ず `--reply` を**: スレッドの追跡と可読性のため、特定のメッセージへの返信では常に `--reply <msg-id>` を付ける
- **コミットのタイミング**: visual fix と visual polish は分けてコミットすると安全。コミットはユーザーが明示的に依頼した時だけ

---

*作成日: 2026-03-08*
