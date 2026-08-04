# Agent Window

Agent Windowは、Claude、Codex、Gemini、Cursor、CopilotなどのAgent CLIを、一つのworkspaceと一つの時系列で扱うために開発した**macOS向けのローカルインターフェース**です。各Agent CLIはtmuxのpane内で通常どおり起動します。Agent Windowは、選択したpaneへ文字列を送り、各CLIのnative logから発話を取得し、一つの画面へまとめます。CLIを共通APIで包んだり、独自のagent runtimeへ載せ替えることなく、**CLIが本来備えているものをそのまま使用します**。

[設計思想](DESIGN_jp.md) · [English](README.md)

<p align="center">
  <img src="media/agent-window-hero-1.png" width="100%" alt="Agent Window hero 1">
  <img src="media/agent-window-hero-2.png" width="100%" alt="Agent Window hero 2">
</p>

# 構成

一つのAgent Window sessionには、一つのworkspace、一つのtmux process、一つのchat server、一つのlocal JSONLが紐づきます。tmuxの各paneには、任意のAgent CLIを追加・削除できます。同じAgentを複数起動することもでき、その場合は `Claude-3` のような個別のinstance名で扱います。会話履歴はCLI processではなくAgent Window sessionに属します。CLIを終了、再起動、削除、再追加しても、同じsessionである限り、通常メッセージは同じJSONLへ追記されます。このJSONLは追記のみで、Agent Windowがなくても読めます。基本的なデータフローは次のとおりです。

```text
入力欄
  → chat server
  → tmux pane
  → Agent CLI

Agent CLI
  → native log
  → native log watcher
  → chat server
  → UI / session JSONL
```

workspaceとGitの状態は、これとは別にFSEventsで監視され、右paneへ反映されます。

## 送信

送信バックエンドには `tmux send-keys` を使用します。入力欄から送信された文字列は、選択中のAgent CLIが動作するpaneへ直接入力されます。Agent Window専用のメッセージ形式へ変換されないため、各CLIのslash commandやその他のCLIコマンドもそのまま使用できます。エージェント間の送信には `agent-send` を使用します。これは指定した別のAgent CLIへ文字列を入力する薄いwrapperで、同じsession内だけでなく、別sessionのAgentへ送ることもできます。Agentは `agent-send name <target> <name>` で、別のinstanceにsession内の名前を付けられます。名前が使われるのは `agent-send` の宛先と `[From: ...]` prefixだけで、既存のinstance名とlog上の識別子は変わりません。

## 受信

受信側はPID treeなどから各CLIのnative log pathを解決し、kqueueで直接監視します。CLIの再起動、Agentの再追加、chat serverのreloadなど、必要なタイミングでprocessとlog pathの対応を再解決します。したがって、CLI processが入れ替わっても、Agent Window session側の時系列は継続します。native logから取得したeventは、通常メッセージとtool callなどに分類されます。人間からAgent、Agentから人間、Agentから別のAgentへ送られた通常メッセージは、sessionのJSONLへ保存されます。tool callやcommand outputは必要に応じて画面へ一時的にstreamされますが、共通の会話履歴には無差別に保存しません。

## アプリ

実体はローカルで動作するWebアプリです。macOS版はRust / Tauriでbuildした薄いwrapperで、window制御や外観など、desktop applicationとして必要な部分を担当します。mobile端末から同じ画面へ接続するためのPWAも用意しています。

# インターフェース

## Hub

左側のHubは、Agent Window sessionの一覧を管理します。新しいsessionの開始、archive、削除はここから行います。外観や、session間で共通する機能設定もHubに保持されます。外観はDark、Light、Hybridの3 themeです。

## チャット画面

中央には、sessionに参加した各Agentとの通常メッセージを、一つの時系列として表示します。表示はAgentごとの独立したchat roomには分割されません。CLIを切り替えたり、複数のAgentを同時に動かしたりしても、同じsession内で発生した会話は同じ流れに残ります。画面に見えている時系列が、そのままsessionのJSONLに残る時系列です。

### Agentの選択と入力

メッセージの送信先は、現在選択されているAgent CLIです。入力欄は通常、chatの表示領域を広く取るために最小化されています。画面下部の `O` buttonから展開します。`@` を入力すると、workspace内のfileを検索できます。検索対象にはFSEventsで取得したfile情報のcacheを使用します。fileはplus buttonまたはdrag-and-dropで添付できます。添付されたfileはworkspace内の `.agent-window/uploads/` に保存され、そのpathがAgentへ渡されます。

### Workspace

右paneには、現在のworkspaceの状態を表示します。FSEventsでfile systemの変更を追跡し、未commitのdiffを小さくまとめて表示します。untracked fileの削除・ignore、file単位のrevertにも対応しています。埋め込みfile viewerは最小限の実装で、text file、HTML、Markdownなどを確認できます。`Open in Default App` を有効にしている場合、fileはmacOSの既定のapplicationで開きます。通常はこちらを使用します。

### メニュー

右上のhamburger buttonから、次の操作を行えます。

* `Terminal`
  sessionに紐づくtmux terminalを直接開きます。

* `Finder`
  sessionのworkspaceをFinderで開きます。

* `Add / Remove Agent`
  Agent CLIをsessionへ追加・削除します。同じAgentの複数instanceも追加できます。

* `reload`
  chat serverをhard reloadします。source codeを変更している場合は、動作中のserverを新しい実装へ置き換えます。

# Setup

以下は、repoをcloneした後にAgent Windowを起動するための最小限の入口です。現在の実装はmacOSを前提としています。環境固有の詳細や最新の挙動については、repo内の実装を参照してください。

## 必要なもの

事前に次をインストールします。

* `python3`
* `tmux`
* `cargo`
* `tauri-cli`
* Xcode Command Line Tools

不足している依存関係と、その導入コマンドだけを確認する場合は `./setup/preflight` を実行します。このscriptが何かをinstallすることはありません。

使用するAgent CLIも個別にインストールし、それぞれ通常の方法で認証を済ませてください。すべての対応CLIを入れる必要はありません。

## Tauri App + HTTP

repo rootで次を実行します。

```bash
./tauri_app/tauri_start
```

Tauri Appをbuildして起動します。HubはTauri Appから起動され、既定のportは `8788` です。起動後、Hubの `New Session` からsessionを開始します。Tauri Appのrebuildだけを行う場合は、次を使用します。

```bash
./tauri_app/tauri-build
```

## PWA / HTTPS

PWAは、同じLAN上のmobile端末からAgent Windowへ接続するためのものです。最初に、HTTP modeでTauri AppとHubを起動します。その状態で次を実行します。

```bash
./setup/pwa/enable
```

このscriptは実行中のHubを確認し、mkcertとlocal certificateを準備します。

PWAを有効にした後は、次回以降の起動時に `~/.agent-window/state/pwa/enabled` が検出され、HTTPS modeで起動します。

```bash
./tauri_app/tauri_start
```

mkcertの `rootCA.pem` を接続する端末へ送り、certificate profileをinstallして信頼を有効にします。

その後、Safariで次のいずれかを開きます。

```text
https://<MacのLAN IP>:8788/
https://<Mac名>.local:8788/
```

ホーム画面へ追加するとPWAとして使用できます。

<p align="center">
  <img src="media/agent-window-mobile-1.png" width="24%" alt="Mobile UI 1">
  <img src="media/agent-window-mobile-2.png" width="24%" alt="Mobile UI 2">
  <img src="media/agent-window-mobile-3.png" width="24%" alt="Mobile UI 3">
  <img src="media/agent-window-mobile-4.png" width="24%" alt="Mobile UI 4">
</p>

# License

[0BSD](LICENSE)です。好きにしてください。
