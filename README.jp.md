<div align="center">

# Agent Window

UNIX哲学で作られた、macOS向けのAgentアプリケーション。

[設計哲学](DESIGN.jp.md) · [English](README.md)

</div>

<p align="center">
  <img src="media/agent-window-hero-1.png" width="100%" alt="Agent Window hero 1">
  <img src="media/agent-window-hero-2.png" width="100%" alt="Agent Window hero 2">
</p>

---

## Principle

1. 単位は一つのlog。実体は `~/.agent-window/log/{timeline_name}/.log.jsonl`。
2. Agentは普通のCLIで、tmux内で動く。数は任意。
3. workspaceもCLIも、途中で差し替えられる。logは同じものが続く。
4. 送信は `tmux send-keys`。入力欄の文字が、Agentのpaneに入る。
5. 受信は各CLIのnative logの監視。tool callは実行中だけ画面に出て、logには残らない。

<p align="center">
  <img src="media/agent-window-running.gif" width="392" alt="Claudeの実行中のtool call表示">
</p>

## Setup

`python3`、`tmux`、Xcode Command Line Toolsが必要。使うAgent CLIは各自installして認証しておく。

```bash
./macos/build
```

Appをbuildし、`/Applications/Agent Window.app` に保存して起動する。

## timeline

`New Timeline` でworkspaceを選び、そこでtmux sessionを始める。

<details>
<summary>状態操作</summary>

| 操作 | 内容 | 備考 |
|---|---|---|
| Archive | tmux sessionを終了する | logは残る |
| Revive | 保存したworkspaceとAgent構成でtmux sessionを作り直す | 会話の再開はCLIの `/resume` |
| Delete | timelineの保存物を完全に削除する | Archive中のみ |
| Rename | timelineの名前を変える | |
| Change Workspace | workspaceを変える | Archive中のみ |
| Reset Agents | 保存したAgent構成を消す | Revive用のもの |

</details>

## Agent

`Add / Remove Agent` でAgentを追加・削除する。同じCLIを複数追加すると `Claude-2` のようなinstance名が付く。

CLI本体は `tmux window` から開ける。

## Send

`O` ボタンを押したら入力欄が開く。

`@` でworkspace内のfileを検索する。添付fileは `<workspace>/.agent-window/uploads/` に保存され、そのpathがtextとしてAgentに渡る。

<details>
<summary>入力欄のcommand</summary>

| Command | 対象 | 内容 | 備考 |
| --- | --- | --- | --- |
| `/restart` |  | Agentのpaneを再起動する | |
| `/idle` |  | Agentのrunning表示を解除する | |
| `/log` |  | logのpathをmessageに挿入する | |
| `/skill` |  | `agent-send` SKILLへの参照をmessageに挿入する | |
| `/openpane` | desktop | Agentのpaneを開く | 未選択ならterminal paneを開く |
| `/nativelog` | desktop | Agentのnative logをFinderで表示する | |
| `/terminal <text>` | mobile | terminal paneに文字列を送る | |

</details>

AgentはAgentに `agent-send` で送れる。宛先のpaneに `[From: Claude]` のようなprefix付きで入力される。

```bash
printf '%s' '<message>' | agent-send <target>
```

使う場合は、`tmux/agent_send/agent-send` へのPATHと、`tmux/agent_send/SKILL.md` を、自分で置く。

## workspace

side barにgitの状態とfile treeが出る。差分は `git difftool`。fileは既定のアプリ、mobileは内蔵viewer。

file iconは、VS Codeなどのfile icon themeの定義JSONへのsymlinkを `~/.agent-window/file-icon-theme.json` に置くと使える。

## Fit Height

`⌥⌘H` でwindowの高さが最新messageに合い続ける。`⌥⌘M` でwindowが最小まで畳まれ、新しいmessageで戻る。

<p align="center">
  <img src="media/agent-window-fit.gif" width="100%" alt="Fit Height demo">
</p>

## Shortcut

<details>
<summary>Hub</summary>

| 操作 | キー | 備考 |
|---|---|---|
| New Timeline | `⌘N` | |
| active timelineの切り替え | `⌘1`–`⌘9` | |
| ブラウザでHubを開く | `⇧⌥⌘O` |  |
| workspaceのpathをコピー | | 右クリックmenu |
| timelineの統計表示 | hover |  |

</details>

<details>
<summary>Control</summary>

| 操作 | キー | 備考 |
|---|---|---|
| 入力欄を開く | `Enter` / ホイール押し込み | |
| 入力欄を閉じる | `Esc` | |
| 入力欄を下部／中央へ移動 | `⌃⌘↓` / `⌃⌘↑` | 入力欄を開いている時 |
| 送信先の切り替え | `Ctrl+1`–`Ctrl+9` | |
| timeline server / Hub serverの再起動 | `⌘R` / `⇧⌘R` | 変更後のsourceを読み直す |
| Git summaryのpin | `⇧⌘P` | |

</details>

<details>
<summary>timeline menu (<code>⌘.</code>)</summary>

| 操作 | キー | 備考 |
|---|---|---|
| Agentの追加 / 削除 | | |
| Terminalを開く | `⌘T` | |
| Finderでworkspaceを開く | `⌥⌘R` | |
| tmux windowを開く | `⌥⌘T` | |
| FinderでLogを開く | `⌥⌘L` |  |
| ブラウザでtimelineを開く | `⌥⌘O` |  |
| timelineをHTML / JSONLとしてExport | | |

</details>

<details>
<summary>timeline</summary>

| 操作 | キー | 備考 |
|---|---|---|
| 先頭 / 末尾へ移動 | `⌘↑` / `⌘↓` | |
| 前 / 次のmessage | `⌥↑` / `⌥↓` | |
| 選択中の宛先の前 / 次のmessage | `⌃⌥↑` / `⌃⌥↓` | 無選択ならuser |

</details>

<details>
<summary>git / workspace</summary>

| 操作 | キー | 備考 |
|---|---|---|
| fileを開く | `⌘O` |  |
| Quick Look | `⌘Y` / `⌥` + click | |
| Finderで表示 | `⌥⌘R` | |
| fileをcopy | `⌘C` | |
| 絶対pathをcopy | `⌥⌘C` | |
| 相対pathをcopy | `⇧⌥⌘C` | |
| commit hashをcopy |  | |
| commit messageをcopy |  | |
| commitのinfo表示 | hover |  |
| worktreeの切り替え |  | timeline menuから |

</details>

<details>
<summary>window</summary>

| 操作 | キー | 備考 |
|---|---|---|
| size 既定 / コンパクト / ミニ | `⌥⌘0` / `⌥⌘9` / `⌥⌘8` | |
| Hub / side barの開閉 | `⌘B` / `⌘E` | `⌥` 併用で外側に広がる |
| side barの左右入れ替え | `⇧⌘E` | |
| Git / Workspaceの上下入れ替え | `⇧⌥⌘E` | |
| 画面端へ移動 | `⌥⌘↑` `←` `→` `↓` | `↓` は中央 |
| 最前面に固定 | `⌥⌘P` | |
| Fit Height | `⌥⌘H` | |
| 最小まで畳む | `⌥⌘M` | 新しいmessageで復帰。Fit Height中のみ |

</details>

<details>
<summary>Appearance menu</summary>

| 操作 | キー | 備考 |
|---|---|---|
| theme | | System/light/dark |
| text size | `⌘0` / `⌘+` / `⌘-` | desktopのみ。windowも相似にresize |
| hand | | mobileのみ。右手/左手に最適化 |

</details>

## Mobile

Tailscale等でHubに接続し、PWAとして使う。gitやfile treeへ繋がるmenuは左スワイプで開く。

`Pane Trace` でCLI本体を確認できる。最低限のキーマクロはボタンにしてある。`tmux/key_macro.py` の `PANE_TEXT_MACROS` でよく使うCLIコマンドを登録できる。

<p align="center">
  <img src="media/agent-window-mobile-light-1.png" width="48%" alt="Mobile UI, light 1">
  <img src="media/agent-window-mobile-dark-1.png" width="48%" alt="Mobile UI, dark 1">
  <img src="media/agent-window-mobile-light-2.png" width="48%" alt="Mobile UI, light 2">
  <img src="media/agent-window-mobile-dark-2.png" width="48%" alt="Mobile UI, dark 2">
  <img src="media/agent-window-mobile-light-3.png" width="48%" alt="Mobile UI, light 3">
  <img src="media/agent-window-mobile-dark-3.png" width="48%" alt="Mobile UI, dark 3">
  <img src="media/agent-window-mobile-light-4.png" width="48%" alt="Mobile UI, light 4">
  <img src="media/agent-window-mobile-dark-4.png" width="48%" alt="Mobile UI, dark 4">
  <img src="media/agent-window-mobile-light-5.png" width="48%" alt="Mobile UI, light 5">
  <img src="media/agent-window-mobile-dark-5.png" width="48%" alt="Mobile UI, dark 5">
</p>

## Supported CLI

Claude、Codex、Antigravity、Cursor、Grok。

## Stack

HTML/CSS/vanilla JavaScript、Python標準libraryと、app用のObjective-Cが1 file。Node、npm build、DBなどは使わず、次を直接叩く。

- **browser primitive** — DOM・`fetch` / `EventSource`
- **native OS API** — FSEvents / kqueue・AppKit / Objective-C
- **canonical CLI** — git・tmux・Agent CLI

## Footprint

telemetryなし。Agent CLI以外のネットワーク依存は `cdn.jsdelivr.net` の `marked` と `katex` のみ。local完結させたいなら、自分でvendorする。

Hubの port は `server/hub/port` fileの値(既定 `8788`)を専有する。fileを書き換えれば変わる。timelineごとのport はworkspaceのpathから決まる固定値を専有する。

Agent Window自身がfilesystemへ保存するdataは `~/.agent-window/` と、workspace内の `.agent-window/` だけ。

## License

[MIT](LICENSE)。画像内のfile iconはMaterial Icon ThemeとVS Code Modern Iconsのもの。
