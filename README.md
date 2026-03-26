# multiagent-chat

tmux ベースのローカル multi-agent chat/workbench です。複数の AI エージェントを同一セッションに並べ、Hub と chat UI から会話・送信・ログ確認を行えます。

<p align="center">
  <img src="screenshot/Hub_Top-portrait.png" alt="Hub overview" width="250">
  <img src="screenshot/message_body-portrait.png" alt="Chat UI" width="250">
  <img src="screenshot/new_session-portrait.png" alt="New session from mobile" width="250">
</p>

## 何ができるか

### チャット

この環境の中心は chat UI です。ユーザー目線では、大きく「メッセージ本体」「入力部分」「ヘッダー部分」に分かれています。

<p align="center">
  <img src="screenshot/message_body-portrait.png" alt="Chat message area" width="230">
  <img src="screenshot/atamrk_command-portrait.png" alt="@ command autocomplete" width="230">
  <img src="screenshot/slash_command-portrait.png" alt="Slash commands" width="230">
</p>

メッセージ本体では、

- user と agent の会話を時系列で追える
- `msg-id` に紐づく reply を扱える
- `[Attached: ...]` を含むメッセージからファイル参照をたどれる
- 構造化された chat log をそのまま残せる

入力部分では、

- target agent selection
- `agent-send` を背後に使った送信
- raw send
- `/memo`, `/silent`, `/brief` などの slash command
- `@` による file path autocomplete
- Import ボタンからのファイル添付
- 添付ファイルのプレビュー
- 音声入力
- Brief / Memory の送受信

が使えます。

<p align="center">
  <img src="screenshot/import-portrait.png" alt="Import attachments" width="230">
  <img src="screenshot/brief-portrait.png" alt="Brief workflow" width="230">
  <img src="screenshot/file_preview-portrait.png" alt="File preview" width="230">
</p>

ヘッダー部分では、

- attached files パネル
- git branch overview
- export
- external terminal / pane viewer
- add agent / remove agent

のような session 操作用の導線を扱えます。

<p align="center">
  <img src="screenshot/Add_agent-portrait.png" alt="Add agent" width="230">
  <img src="screenshot/remove_agent-portrait.png" alt="Remove agent" width="230">
  <img src="screenshot/Git_diff-portrait.png" alt="Git diff from header" width="230">
</p>

この chat UI の背後にある基本の仕組みが `agent-send` です。単に複数 pane を並べるだけでなく、**user と agent、agent 同士の会話を明示的にルーティング**できます。

### Hub

Hub は session 全体を見るための入口です。

<p align="center">
  <img src="screenshot/Hub_Top-portrait.png" alt="Hub top" width="230">
  <img src="screenshot/new_session-portrait.png" alt="Create new session" width="230">
  <img src="screenshot/settings-portrait.png" alt="Hub settings" width="230">
</p>

- active / archived session の一覧
- latest preview つきの session overview
- session ごとの chat UI への導線
- new session の作成
- settings
- statistics ページ

を持っています。

また、local / public の状態を踏まえた導線もあり、スマホからでも session 一覧や新規 session 作成に触れます。

### ログ

ログ系は大きく 2 層あります。

<p align="center">
  <img src="screenshot/Pane_trace-portrait.png" alt="Pane trace" width="250">
  <img src="screenshot/Stats-portrait.png" alt="Stats page" width="250">
</p>

- `.agent-index.jsonl`
  chat メッセージそのものを残す構造化ログ
- `*.log` / `*.ans`
  pane capture を保存する terminal 側ログ

これにより、

- chat の流れ
- pane 上で何が起きていたか
- archived session の再読
- export 用の元データ

をまとめて扱えます。チャットだけでなく、**pane の痕跡まで含めて残せる**のが特徴です。

### バックエンド系

表からは見えにくいですが、運用を支える機能もあります。

<p align="center">
  <img src="screenshot/settings-portrait.png" alt="Runtime settings" width="230">
  <img src="screenshot/new_session-portrait.png" alt="Remote new session" width="230">
  <img src="screenshot/Stats-portrait.png" alt="Statistics" width="230">
</p>

- Auto-mode
  permission prompt を検知して自動承認する補助機構
- Awake mode
  `caffeinate` を使って sleep を防ぐ
- Sound notifications
  通知音、commit 音、時刻指定音などを鳴らせる
- mobile / public access
  スマホからの remote control や public Hub 運用
- export
  session を standalone HTML として持ち出す

単なるチャット画面ではなく、**長時間の multi-agent 運用を支える土台**まで含んでいます。

## 典型的な使い方

1. `./bin/quickstart` で Hub を起動する
2. Hub から session を開く
3. chat UI で target agent を選び、依頼を送る
4. 必要に応じて Brief / Memory を使って指示や文脈を整理する
5. 作業後も session とログを残し、あとで再開する

## 典型的なユースケース

- 複数 agent に同時に調査や実装を振る
- user と agent、agent 同士の会話を 1 つの session に集約する
- 長い会話の途中で Brief / Memory を整理し直す
- スマホから既存 session を追い、必要なら新規 session も作る
- 作業結果をログや export HTML として残す

## 主な構成

### Session ベース

作業単位は tmux session です。各 agent は独立した pane で動き、Hub では active / archived をまとめて扱えます。

### Chat UI とログ

chat UI は単なる送信欄ではなく、target selection、message log、session 状態、quick actions、添付ファイル導線をまとめた作業画面です。ログは `.agent-index.jsonl` に残るため、あとから検索や追跡ができます。

### Brief と Memory

- Brief: session 固有の再利用テンプレート
- Memory: agent ごとの要約状態

Brief は selected targets にまとめて送れます。Memory は現在の `memory.md` と、更新前スナップショットの `memory.jsonl` に分かれています。

### ローカル中心、必要なら public 化

通常はローカルで使い、必要なときだけ Cloudflare 経由で Hub を外部公開できます。public 化しても、ローカル利用の流れを置き換える設計ではありません。

## Quickstart

```bash
git clone https://github.com/estrada0521/multiagent-chat.git ~/multiagent-chat
cd ~/multiagent-chat
./bin/quickstart
```

`./bin/quickstart` は次を行います。

- `python3` と `tmux` の存在確認
- 必要なら依存の案内または対話的インストール
- エージェント CLI の確認
- multiagent セッションのセットアップ
- Hub / chat UI の起動

起動後は通常、Hub 一覧または chat UI がローカルで開ける状態になります。

## Requirements

- `python3`
- `tmux`
- macOS または Linux

macOS では Homebrew が入っていると導入が楽です。

## Main Commands

- `./bin/quickstart`: 依存確認つきで Hub を起動
- `./bin/multiagent`: セッション作成・再開・操作
- `./bin/agent-index`: セッション一覧、chat UI、ログ閲覧
- `./bin/agent-send`: user や他 agent へのメッセージ送信

## Docs

- [docs/AGENT.md](docs/AGENT.md): この環境で動くエージェント向けの運用ガイド
- [docs/cloudflare-quick-tunnel.md](docs/cloudflare-quick-tunnel.md): Cloudflare Quick Tunnel / named tunnel
- [docs/cloudflare-access.md](docs/cloudflare-access.md): public Hub に Cloudflare Access を掛ける方法
- [docs/cloudflare-daemon.md](docs/cloudflare-daemon.md): public tunnel の常駐運用
