# Agent Window

Agent Windowは、複数のAgent CLIが動いている作業場所を外から眺めるための、UNIX哲学に則った**macOS向けのローカルインターフェース**です。

各Agent CLIはtmuxのpane内で通常どおり起動します。APIやSDK等を経由してmodelを呼ぶことはありません。**CLIが既に備えている機能を、そのまま利用します。**

[設計哲学](DESIGN_jp.md) · [English](README.md)

<p align="center">
  <img src="media/agent-window-hero-1.png" width="100%" alt="Agent Window hero 1">
  <img src="media/agent-window-hero-2.png" width="100%" alt="Agent Window hero 2">
</p>

---

# 構成

frontendにframework、`package.json`、npm buildはありません。HTML、CSS、vanilla JavaScriptのfragmentをPythonの小さなinclude展開で組み立てます。MarkedやKaTeX等は表示libraryとしてのみ使用します。

Tauri/RustはmacOSのwindowとnative menu、Finder等との境界を担当し、session、Agent、log、workspaceの観測はPython、tmux、filesystemに残します。

```text
Tauri window
└─ Hub server :8788
   └─ iframe → workspaceごとのchat server
               ├─ tmux pane
               ├─ CLI native log
               └─ workspace / git
```

# Setup

現在の実装はmacOSを前提としています。

## 必要なもの

* `python3`
* `tmux`
* `cargo`
* `tauri-cli`
* Xcode Command Line Tools

`./setup/preflight` は、不足している依存関係と、その導入コマンドを確認します。このscriptが何かをinstallすることはありません。

使用するAgent CLIは個別にinstallし、通常の方法で認証を済ませてください。

## 起動

repo rootで次を実行します。

```bash
./tauri_app/tauri_start
```

Tauri Appをbuildし、既存の `/Applications/Agent Window.app` を置き換えて起動します。buildとinstallだけ行う場合は `--no-open` を付けます。HubはTauri Appから起動され、portはrepoの `hub-port` fileの値（`8788`）です。変えるにはこのfileを書き換えます。

# 使う

## sessionを始める

desktop Hubの `New Session`（`⌘N`）からworkspaceを選択します。sessionはAgentなしで作られるため、続けて必要なAgentを追加します。同じworkspaceをclaimするsessionは複数作れません。

一つの統一ログは、session名、workspace、参加Agentが変わっても続きます。`New Session` は別のlogを始める操作であり、いつそうするかは人間が決めます。

sessionを右クリックすると、次の状態操作を行えます。

| 操作 | 意味 |
|---|---|
| Archive | tmux runtimeを終了し、logと再構成情報を残します。 |
| Revive | 保存されたworkspaceとAgent構成からruntimeを作り直します。 |
| Delete | archived sessionの保存物を削除します。元には戻せません。 |
| Rename | session labelを変更します。chat serverは再起動せず、URLも変わりません。 |
| Change Workspace | archived sessionのworkspaceを変更します。 |
| Reset Agents | 次回のRevive時に以前のAgentを復元しないようにします。 |

`⌘1`–`⌘9` で1〜9番目のactive sessionへ切り替えます。

## Agentを足す

右上の `Add / Remove Agent` からAgentを追加・削除できます。同種のCLI Agentを複数起動した場合は `Claude-2` のようなinstance名になります。

* `Terminal`（`⌘T`）— workspace rootで素のシェルを開きます
* `tmux window`（`⌥⌘T`）— compactなpane切り替え式のtmux terminalを直接開きます(tmux socket名は `agent-window` で固定です)
* `Finder`（`⌥⌘R`）— 現在のworkspaceをFinderで開きます

隣のreload buttonはGUI serverをhard reloadします。source codeを変更している場合は、動作中のserverを新しい実装へ置き換えます。tmux paneとAgent processは再起動しません。`⌘R` でchat server、`⇧⌘R` でHub serverを同様に。

<p align="center">
  <img src="media/agent-window-menu.png" width="100%" alt="Menu">
</p>

## 送る

入力欄は通常、chatの表示領域を広く取るために最小化されており、画面下部の `O` button、またはホイール押し込みで展開されます。Agent Iconの選択状態がメッセージの送信先を指定します。`Ctrl+1`–`Ctrl+9` で、表示順に左からtargetを切り替えられます。

入力された文字列は、選択中のAgent CLIが動作するpaneへ `tmux send-keys` を介して直接入力されます。Agent Window専用のmessage形式へ変換しないため、**各CLIのslash commandやその他のCLIコマンドも同じ入力欄から通ります。**

入力に失敗した場合は `send_error` として検出されますが、成功は通知しません。paneのrestartやmobileからのinterruptなど、CLIの既定コマンドだけでは届かない最小限の制御はAgent Windowが配線します。

Agent Windowは次のshortcut commandも認識します。

| Command | 操作 |
| --- | --- |
| `/restart` | CLIをrestartします。 |
| `/open-pane` | 選択中のAgentのtmux paneを開きます。何も選択していない場合はterminalを開きます。desktopのみ。 |
| `/terminal <text>` | terminal paneへ直接文字列を送ります。mobileのみ。 |
| `/nativelog` | 選択中のAgentのnative logをFinderで表示します。desktopのみ。 |
| `/log` | `.agent-window/.log.jsonl` をmessageへ挿入します。文中でも使用できます。 |

スマートフォンではmenuの `Pane Trace` から、Terminal, Agent Paneを確認できます。`Esc`、`Ctrl-C`、矢印key、`Enter`のボタンがあります。CLI commandは`shortcut_command/catalog.py`のPANE_TEXT_MACROSから登録できます。

`@` を入力するとworkspace内のfileを検索できます。fileはplus buttonまたはdrag-and-dropでも添付できます。添付されたfileは `<workspace>/.agent-window/uploads/` に保存され、そのpathがAgentへ通常のtextとして渡されます。

## 読む

GUIは統一ログを、人間と各Agentを横断する一つの時系列として表示します。

`⌘↑` / `⌘↓` で時系列の先頭 / 末尾へ移動し、`⌥↑` / `⌥↓` でmessageを一つずつ移動します。

CLIの切り替え、複数Agentの同時実行、processの再起動を跨いで、メッセージは同じ統一ログへ続きます。session名やworkspaceを変更しても、過去の記録はそのまま残ります。

sessionの保存物は次のdirectoryにあります。

```text
~/.agent-window/session/{session_name}/
```

append-onlyの統一ログ `.log.jsonl` と、Reviveに必要なworkspaceとAgent構成の最小snapshot `.meta` だけが置かれます。現在のworkspaceの `.agent-window/.log.jsonl` は前者へのsymlinkです。Agent Window内部に閉じたdatabaseではなく、Agent Windowが停止しても通常のfileとして読めます。

統一ログは各CLIの詳細な実行履歴そのものではありません。人間とAgentが横断して読める粒度へのprojectionです。

tool callは進行状況を示すため実行中にstreamされますが、この時系列には残りません。アイコンをクリックすると対応するtmux paneを開きます。

各CLIの実行記録は外側から監視され、processやlog pathが変われば必要に応じて再解決されます。そのためCLI processの寿命と統一ログの寿命は一致しません。

各entryには、参照元のnative logのpathとその中の位置が記録されています。

## workspaceを見る

gitとworkspaceの状態は監視され、右paneへ投影されます。file検索も観測したworkspaceの情報を利用します。

PythonからmacOS FSEventsを直接監視し、更新はSSEでUIへ渡します。gitの状態も独自に再構成せず、`git status`、`git log`、`git diff`を直接読みます。

Git summaryは `⇧⌘P` でchat上にpinできます。

fileをクリックするとmacOSの既定applicationで開きます。desktop版では、既に存在するfile viewerを再実装しません。mobileではそれらに頼れないため、bottom sheet型の内蔵viewerが開きます。

変更されたfileは、uncommittedでも過去のcommit内でも、クリックするとgitに設定されたdiff viewer (`git difftool`) で開きます。

fileのアイコンは、VS Codeなどのfile icon themeの定義JSONへのsymlinkを `~/.agent-window/file-icon-theme.json` に置くと、そのまま使えます。置かなければ内蔵のアイコンです。

## ウィンドウを合わせる

Agent Windowは作業場所ではなく手段なので、作業領域を占有しないようwindow自体を内容と画面へ合わせます。

`⌘,` でtheme、text size、window操作をまとめたAppearance menuを開きます。

| キー | 動作 |
|---|---|
| `⌘0` / `⌘+` / `⌘-` | テキストサイズ変更。Window自体も相似関係を満たすようにresizeされます |
| `⌥⌘0` / `⌥⌘9` / `⌥⌘8` | 既定 / コンパクト / ミニサイズ |
| `⌘B` / `⌘E` | Hubサイドバー / 右paneの表示切替（`⌥` 併用でchat領域を保ったまま外側に広げる） |
| `⌥⌘↑` `←` `→` `↓` | その画面端へ移動。`↓` は中央 |
| `⌥⌘P` | 最前面に固定 |
| `⌥⌘H` | ウィンドウの高さを最新メッセージに合わせ続ける |
| `⌥⌘M` | Fit Height中、ウィンドウを最小に畳んで保持（新規メッセージで復帰） |

Fit Height (`⌥⌘H`) を有効にすると、Hubと右paneがOSのnative menuに置き換えられます。

<p align="center">
  <img src="media/agent-window-fit.gif" width="100%" alt="Fit Height demo">
</p>

## Agent同士をつなぐ

Agentは `agent-send` で別のAgentへ直接メッセージを送れます。必要な場合は `SKILL.md` を所定の場所に配置してください。これはAgent Windowが契約した唯一のSKILLです。

```bash
printf '%s' '<message>' | agent-send <target>
```

`agent-send` は、人間の入力と同じ `tmux send-keys` を使う薄いwrapperです。宛先を解決し、`[From: Claude]` のようなprefixを付けて入力します。

ここでのsuccessは、入力がruntimeへ渡されたことだけを意味します。送信先のAgentが理解した、あるいは行動したことを意味しません。

## スマートフォンから使う

mobile UIはdesktopを狭くしたものではなく、片手操作を前提にした別のshellです。composer展開buttonとHub menuを左下へ集め、chatを右へswipeするとHub、左へswipeするとmenuが開きます。

起動時は前回開いていたactive sessionを、なければ最新のactive sessionを開きます。Hubのsession rowをswipeするとArchive、Revive、Deleteを操作できます。themeはHub menuからSystem、Light、Darkを選べます。

HubはHTTPで `127.0.0.1` のみにbindします。phoneはTailscale経由でそのloopbackへ到達し、Home ScreenのPWAに必要なHTTPSはTailscale側が提供します。Tailscale自体はこのrepositoryの外で設定します。

<p align="center">
  <img src="media/agent-window-mobile-light-1.png" width="48%" alt="Mobile UI, light 1">
  <img src="media/agent-window-mobile-dark-1.png" width="48%" alt="Mobile UI, dark 1">
  <img src="media/agent-window-mobile-light-2.png" width="48%" alt="Mobile UI, light 2">
  <img src="media/agent-window-mobile-dark-2.png" width="48%" alt="Mobile UI, dark 2">
  <img src="media/agent-window-mobile-light-3.png" width="48%" alt="Mobile UI, light 3">
  <img src="media/agent-window-mobile-dark-3.png" width="48%" alt="Mobile UI, dark 3">
  <img src="media/agent-window-mobile-light-4.png" width="48%" alt="Mobile UI, light 4">
  <img src="media/agent-window-mobile-dark-4.png" width="48%" alt="Mobile UI, dark 4">
</p>

## 対応CLI

Claude、Codex、Antigravity、Cursor、Grok。

受信側は各CLIの実行記録の置き場所と形式を知る必要があるため、CLIごとの対応があります。

送信側は共通です。paneへ文字列を入力するだけなので、CLI固有のmessage protocolはありません。

# License

[0BSD](LICENSE)です。好きにしてください。

画像内のfileアイコンはMaterial Icon Themeのものです。このrepositoryには同梱していません。
