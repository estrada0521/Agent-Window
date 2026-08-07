# Agent Window

Agent Windowは、複数のAgent CLIが動いている作業場所を、外から眺めるための**macOS向けのローカルインターフェース**です。

各Agent CLIは、tmuxのpane内で通常どおり起動します。APIやSDK等を経由してmodelを呼ぶことはありません。**CLIが既に備えている機能を、そのまま利用します。**

[設計思想](DESIGN_jp.md) · [English](README.md)

<p align="center">
  <img src="media/agent-window-hero-1.png" width="100%" alt="Agent Window hero 1">
  <img src="media/agent-window-hero-2.png" width="100%" alt="Agent Window hero 2">
</p>

---

# Setup

現在の実装はmacOSを前提としています。

## 必要なもの

* `python3`
* `tmux`
* `cargo`
* `tauri-cli`
* Xcode Command Line Tools

 `./setup/preflight` は、不足している依存関係と、その導入コマンドを確認します。このscriptが何かをinstallすることはありません。

使用するAgent CLIは個別にインストールし、通常の方法で認証を済ませてください。

## 起動

repo rootで次を実行します。

```bash
./tauri_app/tauri_start
```

Tauri Appをbuildして起動します。HubはTauri Appから起動され、既定のportは `8788` です。

Tauri Appのrebuildだけを行う場合は、次を使用します。

```bash
./tauri_app/tauri-build
```

# 使う

## sessionを始める

Hubの `New Session` からworkspace root を選択し、sessionを設立します。
Hubはsessionの一覧を管理し、Archive、削除もここから行います。

## Agentを足す

右上の `Add / Remove Agent` から、Agent を該当sessionに追加/削除できます。同種のCLI Agentを複数起動した場合は `Claude-2` のようなinstance名になります。

* `Terminal` —compactなpane切り替え式のtmux terminalを直接開きます
* `Finder` — sessionのworkspaceをFinderで開きます

隣の独立したreload buttonは、GUI serverをhard reloadします。source codeを変更している場合は、動作中のserverを新しい実装へ置き換えます。

## 送る

入力欄は通常、chatの表示領域を広く取るために最小化されており、画面下部の `O` button、またはホイール押し込みで展開されます。Agent Iconの選択状態が、メッセージの送信先を指定します。

入力欄の文字列は、選択中のAgent CLIが動作するpaneへ`tmux send-keys` を介して直接入力されます。Agent Window専用のmessage形式へは変換しません。。従って、**各CLIのslash commandやその他のCLIコマンドも、同じ入力欄から通ります。** 入力に失敗した場合は`send_error`として検出されますが、成功は通知しません。Pane自体の`restart`やmobileからの中断等、CLIの既定コマンドでは実現できない最小限の制御はAgent Windowが配線しています。

`@` を入力すると、workspace内のfileを検索できます。fileはplus buttonまたはdrag-and-dropでも添付できます。添付されたfileは `<workspace>/.agent-window/uploads/` に保存され、そのpathがAgentへ通常テキストとして渡されます。


## 読む

GUI は、sessionに参加した人間と各Agentのメッセージを、一つの時系列として表示します。**Agentごと、Worktreeごとの独立したchat roomには分割されません。** CLIを切り替えても、複数のAgentを同時に動かしても、同じsession内で発生した会話は同じ流れに残ります。
CLIを終了、再起動、削除、再追加しても、同じsessionである限り、時系列は続きます。

実体は次の場所にあり、workspaceにはsymlinkが貼られます。

```text
~/.agent-window/session/{session_name}/.log.jsonl
```

tool callは体感のために実行中に画面へstreamされますが、この時系列には残りません。

技術的には、PID treeなどから各CLIのnative log pathを解決し、kqueueがこれを直接監視しています。CLIの再起動、Agentの再追加、GUI serverのreloadなど、必要なタイミングでprocessとlog pathの対応が再解決されます。したがって、CLI processが入れ替わっても、session側の時系列は継続します

## workspaceを見る

git と workspaceの状態はFSEventsで監視され、右paneに投影されます。file検索は、このFSEventsで取得したfile情報のcacheを使用しています

fileをクリックすると、はmacOSの既定のapplicationで展開されます。desktop版のAgent Windowでは既に存在しているfile viewerの再実装をしていません。mobileではそれらに頼れないため、bottom sheet型の内蔵viewerが開きます。

## Agent同士をつなぐ

Agentは `agent-send` で、session内の別のAgentへ直接メッセージを送れます。必要な場合は、`SKILL.md`を所定の場所に配置してください。これはAgent Windowが契約した唯一のSKILLです。

```bash
agent-send <target> <message>
```

技術的には、`agent-send` は、人間の使う経路と同じ`tmux send-keys`の薄いwrapperです。宛先の解決と`[From: Claude]`のような Prefixの付与のみを行います。

## 名前をつける

Agent Windowの唯一の不要な機能です。

```bash
agent-send name <target> <name>
```

Agentに、session内で通じる名前を付けられます。名前が使われるのは `agent-send` の宛先と `[From: ...]` prefixだけで、既存のinstance名とlog上の識別子は変わりません。

## スマートフォンから使う

同一LAN上のmobile端末から、同じ画面へ接続できます。

最初に、HTTP modeでTauri AppとHubを起動します。その状態で次を実行します。

```bash
./setup/pwa/enable
```

このscriptは実行中のHubを確認し、mkcertとlocal certificateを準備します。**mkcertはシステムにlocal CAをinstallします。**

以降は起動時に `~/.agent-window/state/pwa/enabled` が検出され、HTTPS modeで起動します。

```bash
./tauri_app/tauri_start
```

mkcertの `rootCA.pem` を接続する端末へ送り、certificate profileをinstallして信頼を有効にします。その後、Safariで次のいずれかを開きます。

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


## 対応CLI

Claude、Codex、Antigravity、Cursor、Grok。

受信側は、各CLIのnative logの置き場所と形式を知る必要があるため、CLIごとの対応が入ります。
送信側はどのCLIも同じです。paneへ文字列を入力するだけなので、CLI固有の実装はありません。

# License

[0BSD](LICENSE)です。好きにしてください。