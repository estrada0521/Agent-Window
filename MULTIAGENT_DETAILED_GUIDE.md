# Multiagent OS 厳密仕様拡張・完全構築ガイド

本ドキュメントは、tmux を実行基盤とし、JSONL をデータプレーン、ローカル HTTP サーバーをコントロールプレーン（観測層）として機能させる「軽量 Multiagent OS」の完全な技術仕様書です。

このドキュメントを読むだけで、全く同じアーキテクチャのシステムをゼロから独自に再構築（スクラッチ開発）できるよう、内部の依存関係解決アルゴリズム、環境変数設計、API仕様、並びにプロセス間通信（IPC）の機構について厳密に定義します。

---

## 1. アーキテクチャ基本原則

本システムは、複雑なデーモンプロセスやメッセージキュー（RabbitMQ等）を排し、Unix 哲学と tmux の組み込み機能を最大限に活用して設計されています。システムは以下の層（レイヤー）で構成されます。

1. **実行層 (Execution Layer):** tmux セッション、ウィンドウ、ペイン (Pane)。エージェントプロセスのサンドボックスおよび標準入出力 (stdout/stderr/stdin) の物理的ホカ。
2. **会話・データ層 (Data Layer):** 全エージェントおよび人間の会話、システムイベントをアトミックに追記記録する JSONL フォーマットの構造化ログ。
3. **配送・制御層 (Control Layer):** Bash スクリプトを中心とした CLI コマンド群 (`agent-send`, `multiagent`)。tmux バッファリングを悪用（活用）したプロセス間通信。
4. **観測・監視層 (Observation/Monitoring Layer):** ログディレクトリの FileSystem watcher とポーリングベースの `capture-pane` を組み合わせた React/Vue ブラウザ UI 提供用 HTTP サーバー (`agent-index`)、および自動承認デーモン (`multiagent-auto-mode`)。

---

## 2. コアディレクトリ・ファイル構成仕様

システムは特定のリポジトリへの依存を避けるため、プロジェクトルート、システム全体の設定（`/tmp` 等）、ユーザーホームディレクトリ (`~/.local/bin`) にまたがって構成管理を行います。

### 実行スクリプト群 (`bin/` ディレクトリ)
システムを再構築する際、以下の 5 つの実行バイナリ（スクリプト）を実装する必要があります。
* `bin/multiagent`: セッション管理・ライフサイクル統括
* `bin/agent-send`: Tmux 入力注入および JSONL 書き込みルータ
* `bin/agent-index`: HTTP UI サーバーおよび JSONL 検索・パースエンジン
* `bin/multiagent-auto-mode`: 標準出力ポーリングによるヒューリスティック承認エンジン
* `bin/multiagent-user-shell`: 人間用ペインで起動されるプロファイル・シェル環境

### ログデータ構造 (`logs/` ディレクトリ配下)
ログデータは単一のディレクトリにカプセル化されます。命名規則は `<session_name>_<created_timestamp>_<updated_timestamp>` とし、セッション保存ごとに生成されます。

内部ファイル：
* `.agent-index.jsonl` : イベントおよびメッセージのアペンドオンリーログ
* `claude.ans`, `codex.ans` 等 : ANSI エスケープコードを含む tmux પેイン出力の完全なダンプ
* `claude.log`, `codex.log` 等 : ANSI をストリップした可読プレーンテキスト
* `metadata.json` : セッション構築当時のペインレイアウト、所属変数を保持

### ステートファイル (`/tmp` 配下)
tmux クライアント外部のプロセスがセッションを逆引き解決するための揮発性マッピングファイル。
* `/tmp/multiagent_<socket_hash>_panes`

---

## 3. システムコンポーネント詳細仕様

### 3.1 セッション統括層: `multiagent` コマンド

`multiagent` はシステムの「init プロセス」に相当します。提供すべきサブコマンドとその内部実装要件は以下の通りです。

#### 3.1.1 tmux 初期化とソケット解決アルゴリズム
システムはリポジトリ（ワークスペース）ごとに分離された tmux の L2 セッションを構築します。
デフォルトの tmux ソケット名は、ワークスペースの絶対パスの `SHA1` ハッシュ先頭 12 文字を使用します。
```bash
# 実装例: ソケット名生成
TARGET_SOCKET=$(echo -n "$WORKSPACE_PATH" | shasum | cut -c 1-12)
tmux -L "multiagent-$TARGET_SOCKET" new-session -d -s "$SESSION_NAME"
```

#### 3.1.2 注入される環境変数と役割
新しいセッションを作る際、`multiagent` は以下の変数を tmux 内部環境変数として明示的にセット (`tmux set-environment`) しなければなりません。

| 変数名 | 仕様詳細 |
| --- | --- |
| `MULTIAGENT_SESSION` | 対象セッションの文字列名 |
| `MULTIAGENT_WORKSPACE` | アタッチされるべきリポジトリの絶対パス |
| `MULTIAGENT_BIN_DIR` | これらコアコマンド群が格納されている bin ディレクトリの絶対パス |
| `MULTIAGENT_TMUX_SOCKET` | 算出された一意のハッシュソケット名 |
| `MULTIAGENT_LOG_DIR` | 当該セッションのアクティブな稼働ログディレクトリパス |
| `MULTIAGENT_PANE_<AGENT>` | 例: `MULTIAGENT_PANE_CLAUDE`。tmux 内部の `%1` などのペイン ID を保持 |
| `MULTIAGENT_PANES_USER` | 人間用入力領域として確保されたペイン ID リスト |
| `MULTIAGENT_AUTO_MODE` | `"1"` (有効) または `"0"` (無効) のフラグ |

#### 3.1.3 Tmux L2 設定要件
セッション独立性を保つため、以下のパラメーター変更が必須です。
* `set-option -g remain-on-exit on` (エージェントプロセスが死んでもペインを消滅させず、ログとして残すため)
* `set-option -g mouse on` (人間用ペインでの遡り閲覧用)
* `set-option -g history-limit 50000` (過去出力の大容量キャプチャを許容)
* フック: `set-hook -g before-kill-session "run-shell 'multiagent save'"` (セッション破棄前の自動ログバックアップ機構)

#### 3.1.4 ペインレイアウト・アルゴリズム
`--layout horizontal` の場合:
人間用ペインを画面下部に高さ 3~5 行程度割り当て、残り上部空間を起動するエージェント数 $N$ で等分割配置します（`tmux split-window -h` の反復）。`--layout grid` の場合は再帰的な二分割 (`-h`, `-v`) を用いてタイル型に展開します。

---

### 3.2 IPC プロトコルとルーティング層: `agent-send`

`agent-send` は非同期なメッセージパッシングを実現します。エージェントが標準入力（画面上）から文字列を受け取るための最も強固な方法は tmux バッファへの貼り付けです。

#### 3.2.1 ターゲット解決（Target Resolution）アルゴリズム
通信相手としてのペインを特定するために、以下の優先順位でフォールバック評価を行います。
1. 引数 `--session` に指定された場合、そのセッションへの直接クエリ。
2. 環境変数 `MULTIAGENT_SESSION` からのクエリ（ペインの内部で実行された場合）。
3. `tmux display-message -p '#S'` で取得できるカレントセッション。
4. カレントワーキングディレクトリが一致する tmux セッションの探索。
5. `/tmp/multiagent_<socket_hash>_panes` に保存されたキーバリューストア情報からの復元。

#### 3.2.2 メッセージの注入
特定した `PANE_ID` に対して文字列を送る際、シェルスクリプトや特殊文字の崩壊を防ぐため、安全な転送手法を用います。
```bash
# 構築に向けた必須要件
tmux set-buffer "$MESSAGE_PAYLOAD"
tmux paste-buffer -p -t "$PANE_ID"
tmux send-keys -t "$PANE_ID" Enter
```

#### 3.2.3 構造化打刻 (JSONL Append)
`agent-send` がメッセージを送信した瞬間に、同時に `.agent-index.jsonl` に対してアトミックに 1 行追記を行います。
形式（仕様）：
```json
{
  "id": "msg_xxx_12345",
  "timestamp": "2030-01-01T12:00:00.000Z",
  "sender": "user",
  "targets": ["claude", "codex"],
  "message": "Please implement the target feature.",
  "reply_to": "msg_xxx_12344",
  "is_silent": false
}
```
※ `is_silent: true` の場合（メモリ操作等）、UI パースエンジン側で無視する、もしくはシステムログとしてフィルタします。

---

### 3.3 観測プレーン・HTTP サーバー層: `agent-index`

本システムにおけるグラフィカルな観測機能を提供するため、`agent-index --chat` は静的アセット（HTML/JS）をサーブしつつ、動的な API を露出する HTTP サーバーの実装が求められます（利用言語は Node.js, Python, Go 等いずれも可）。

#### 3.3.1 必須 API エンドポイント名とレスポンス仕様

* **`GET /messages`**
  * 返却: ログディレクトリ内の `.agent-index.jsonl` をパースした全行の JSON 配列。
  * 機能要求: `timestamp` の照合機能。ポーリングに対し差分だけを返す Long-polling 等が望ましい。

* **`GET /trace?agent=<name>`**
  * 役割: tmux ペインの生出力を同期取得。
  * 必須内部処理: サーバープロセスがホストの tmux を叩く。
    `tmux capture-pane -t "$PANE_ID" -p -e`
    この出力をエンコードしてフロントエンドに返す。
  * フロントエンド実装規則: 文字列に含まれる ANSI エスケープのディム色（faint/dim: `ESC[2m`）等を CSS 等で視認可能な明度に変換し、必ず `white-space: pre-wrap` および monospace フォントで描画すること。これを遵守しないとターミナルの厳密な表示が崩壊し、観測価値が消失する。

* **`GET /files?dir=<path>`**
  * 役割: UI 上の `@` オートコンプリート用ファイルツリー展開。
  * 除外要求: `.git/`, `node_modules/`, `venv/`, `__pycache__/`, 変動の激しいログディレクトリ等、深さ 3 を超えるトラバースを禁止する（パフォーマンス維持のため）。

* **`POST /send`**
  * 役割: UI の入力フォームから `agent-send` に相当する送信をフォワード。リクエストボディには `targets`, `message`, `reply_to` を含める。

* **`GET /memory-path?agent=<name>`**
  * 役割: エージェント毎の共有メモリファイルの絶対パス、および現在の状態（ファイル内容）の string を返す。`<session_dir>/<agent>_memory.md` に解決される。

* **`POST /log-system`**
  * 役割: 監査用。UI ボタンがクリックされた際（ルール再案内、メモリロード等）、会話ではなく「監査ログ」として `sender: "system"` で JSONL に打刻追記を行う。

---

### 3.4 オートメーション・承認エンジン: `multiagent-auto-mode`

エージェント自律性を擬似的に高めるため、ターミナルの出力を監視し、条件合致時に `Enter` を送信するデーモンです。

#### 3.4.1 検知アルゴリズムループ
`multiagent-auto-mode on` 引数でバックグラウンドジョブとして常駐させます。
1. `0.5` 秒間隔で無限ループさせる (`sleep 0.5`)。
2. 管理下にある全ペインの出力を末尾 5 行程度取得 (`tmux capture-pane -p -t "$PANE_ID" | tail -n 5`)。
3. エージェントの AI モデルごとに方言となっている承認待ちプロンプトの正規表現評価を実施。

#### 3.4.2 正規表現検知対象群（必須実装要件）
* **Claude方言**: `Do you want to .*`
* **Codex/Dev方言**: `Would you like to run the following command\?`, `Press enter to confirm or esc to cancel`
* **Gemini方言**: `Action Required`, `Allow once`
* 追加プロンプト: (Y/n) や (y/N) などの末尾合致

#### 3.4.3 暴走抑制セーフティ制御機構
1. **クールダウン制**: 同じペインに対して一度 Enter を送信したら、該当ペインへは最低 2000 ミリ秒間、承認検知をスキップする。
2. **コンテンツハッシュ制約**: `tail -n 5` で取得した文字列の `sha256sum` を直前の文字列保持機構と比較し、取得データが完全に一致している場合（画面が更新されていない状態）にのみ承認を実行する。これにより処理中（画面が流れている最中）の誤 Enter を厳格にパージし、暴走を阻止する。

---

### 3.5 アシスタントコンテキスト: メモリ読み書き仕様

システムは状態崩壊（コンテキストウィンドウの不必要な溢れ込みおよびハルシネーション）を防ぐため、コンテキストデータを永続化する「メモリ」の概念を有します。

#### 3.5.1 メモリの物理実装
メモリは各エージェント毎に `<session_log_dir>/<agent>_memory.md` としてディスク上にプレーンテキストファイルとして存在します。

#### 3.5.2 メモリの更新仕様（Save Memory）
UI から `Save Memory` が発火した際、システムは以下のプロトコルを該当エージェントに「サイレント送信 (`is_silent: true`)」します。
```text
System Instruction:
Update your memory state regarding this project.
Save the summarized current objectives, architectural decisions, and next steps strictly into this file path:
[ABSOLUTE_PATH_TO_MEMORY_FILE]
Ensure you retain old crucial rules while adding new progress.
```
これを受け取ったエージェント側の CLI ツールがディスクへのファイル書き込みを実行します。システムの外部（JSONL 履歴外）での出来事として処理されます。

#### 3.5.3 メモリのロード仕様（Load Memory）
セッションの再開時に、保存されている `_memory.md` を読み込み、その文字列データを環境変数または一時ファイルとして保持します。
その後、次のようなサイレント通信を送信します。
```text
System Instruction:
Restore your context using the following memory items:
-------------------
[CONTENTS_OF_MEMORY_FILE]
-------------------
Internalize these rules and state before acknowledging new commands.
```

---

## 4. トラブルシューティングおよびエッジケース監視要件

システムの再構築時、特に考慮して実装すべき運用上のエッジケースを以下に定義します。

### 4.1 ゴーストペインの発生と再構築
エージェント内の処理がハードクラッシュダウンし、ペインの Unix プロセスが `dead` 状態になることがあります（`remain-on-exit` 設定による）。
再構築システム側では、`multiagent status` 呼び出し時に `tmux list-panes -F '#{pane_dead}'` フォーマット引数を適用し、もし死んでいるペインを発見した場合は、ペイン識別子を維持したまま `respawn-pane -k` を使ってエージェントの基本シェルを再アタッチするオートヒール機構を構築する必要があります。

### 4.2 ペインリサイズによるレンダリング崩壊
ブラウザでの UI 描画（ホバートレース）は文字としての取得であるため、人間が手動で tmux などのターミナルクライアントの画面サイズ (Window Size: Cols/Rows) をリサイズすると、取得されるダンプ（ANSI文字列）に tmux エンジン側で再計算された改行文字が混入し、ブラウザ上で文字表現が物理的に破綻します。
仕様として、システムのホスト側 tmux セッションアタッチメントが行われていない時のバックグラウンド Window Cols は常に `150 ~ 200` 等の固定大文字幅になるように tmux 初期化時に `default-size` リミットを付与することが推奨されます。

---

## 5. まとめ

本ドキュメントにおけるプロトコル定義、ステートマシンの概念、並びに環境変数やソケットを通じた IPC の要求を満たす実装を行うことで、任意のプログラミング言語（Go, Python, Bash等）の組み合わせで、完全互換・同等性能の「Multiagent OS 実行環境」を構築することが可能です。設計の中核にある**「状態はTmuxペインが持ち、会話の記録はJSONLが持ち、UIは完全に従属したリードオンリービューである」**という三層責務分離パラダイムを逸脱してはなりません。
