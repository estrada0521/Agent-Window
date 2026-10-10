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

Appは 1s でbuildされ、`/Applications/Agent Window.app` に保存・起動される。

## timeline

`New Timeline` でworkspaceを選び、そこでtmux sessionを始める。

`Add / Remove Agent` でAgentを追加・削除する。同じCLIを複数追加すると `Claude-2` のようなinstance名が付く。CLI本体は `tmux pane` から開ける。


<details>
<summary>状態操作</summary>

| 操作 | 内容 | 備考 |
|---|---|---|
| Archive | tmux sessionを終了する | logは残る |
| Revive | 保存したworkspaceとAgent構成でtmux sessionを作り直す | 各CLIのresume機能を利用する |
| Delete | timelineの保存物を完全に削除する | Archive中のみ |
| Rename | timelineの名前を変える | |
| Change Workspace | workspaceを変える | Archive中のみ |
| Reset Agents | 保存したAgent構成を消す | Revive用のもの |

</details>

## workspace

side barにgitの状態とfile treeが出る。差分は `git difftool`。fileは既定のアプリ、mobileは内蔵viewer。

file iconは、VS Codeなどのfile icon themeの定義JSONへのsymlinkを `~/.agent-window/file-icon-theme.json` に置くと使える。

構文色は、highlight.jsのtheme CSSへのsymlinkを `~/.agent-window/syntax-light.css` と `~/.agent-window/syntax-dark.css` に置くと使える。

**Follow changes**では、最後に変更を検知したworktreeへGit表示が自動で切り替わる。

<p align="center">
  <img src="media/agent-window-hero-3.png" width="100%" alt="Agent Window workspace, light theme">
  <img src="media/agent-window-hero-4.png" width="100%" alt="Agent Window workspace, dark theme">
</p>

*次のFit Window中では、git・workspaceをtimelineとは独立したwindowとして、好きな位置・大きさで保持できる。*

## Fit Window to Message

`⌥⌘H` でwindowの高さが最新messageに合い続ける。`⌥⌘[` / `⌥⌘]` で表示するmessage数を減らす／増やす。`⌥⌘M` でwindowが最小まで畳まれ、新しいmessageで戻る。

https://github.com/user-attachments/assets/d9f3cbc2-39c5-4b28-8be9-0d98c8328e1f

## Shortcut

<details>
<summary>Hub</summary>

| 操作 | キー | 備考 |
|---|---|---|
| New Timeline | `⌘N` | |
| active timelineの切り替え | `⌘1`–`⌘9` | |
| ブラウザでHubを開く | `⇧⌥⌘O` |  |
| Hub serverの再起動 | `⇧⌘R` | 変更後のsourceを読み直す |
| workspaceのpathをコピー | | 右クリックmenu |
| timelineの統計表示 | hover |  |

<p align="center">
  <img src="media/agent-window-hub-menu.png" width="100%" alt="Hub menu">
</p>

</details>

<details>
<summary>Composer</summary>

| 操作 | キー | 備考 |
|---|---|---|
| 入力欄を開く | `Enter` / ホイール押し込み | `O` ボタンでも開く |
| 入力欄を閉じる | `Esc` | |
| 入力欄を下部／中央へ移動 | `⌃⌘↓` / `⌃⌘↑` | 入力欄を開いている時 |
| 送信先の切り替え | `⌃1`–`⌃9` | 未指定はlogにのみ残る |
| workspace内のfileを検索 | `@` | `.gitignore`対象外のfile |
| fileを添付 | `+`ボタン / drag & drop / paste | `<workspace>/.agent-window/uploads/` に保存され、そのpathがtextとしてAgentに渡る |

| Command | 対象 | 内容 | 備考 |
| --- | --- | --- | --- |
| `/jump YYYY-MM[-DD [HH[:MM[:SS]]]]` |  | 指定した月・日・時刻の最初のmessageへ移動 | |
| `/restart` |  | Agentのpaneを再起動する | |
| `/idle` |  | Agentのrunning表示を解除する | |
| `/log` |  | logのpathをmessageに挿入する | |
| `/skill` |  | `agent-send` SKILLへの参照をmessageに挿入する | |
| `/openpane` | desktop | Agentのpaneを開く | 未選択ならterminal paneを開く |
| `/nativelog` | desktop | Agentのnative logをFinderで表示する | |
| `/terminal <text>` | mobile | terminal paneに文字列を送る | |

https://github.com/user-attachments/assets/5ce44e5a-de19-46cb-9861-11caac880c08

*prompt boxは必要な時だけ現れる。timelineのための面積を占有しない。*

</details>

<details>
<summary>timeline menu (<code>⌘.</code>)</summary>

| 操作 | キー | 備考 |
|---|---|---|
| Agentの追加 / 削除 | | |
| Terminalを開く | `⌥⌘T` | |
| Finderでworkspaceを開く | `⌥⌘R` | |
| tmux terminal paneを開く | `⌘T` | mobileの`Pane Trace`から操作可能 |
| FinderでLogを開く | `⌥⌘L` |  |
| ブラウザでtimelineを開く | `⌥⌘O` |  |
| timelineの全文検索 | Search... | `⇧`併用で10件ずつ飛び |
| timelineをHTML / JSONLとしてExport | | |
| timeline serverの再起動 | `⌘R` | 変更後のsourceを読み直す |

<p align="center">
  <img src="media/agent-window-timeline-menu.png" width="100%" alt="Timeline menu">
</p>

</details>

<details>
<summary>timeline</summary>

| 操作 | キー | 備考 |
|---|---|---|
| 先頭 / 末尾へ移動 | `⌘↑` / `⌘↓` | |
| 前 / 次のmessage | `⌥↑` / `⌥↓` | |
| 選択中の宛先の前 / 次のmessage | `⌃⌥↑` / `⌃⌥↓` | 無選択ならuser |
| Copy | 右クリック / hover | |
| Copy Log Entry | 右クリック | AW logのJSON row / mobileではcopy長押しから |
| Copy Native Log Entry | 右クリック | native logのJSON row |
| URLをcopy | 外部linkを右click | |

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
| Follow changes |  | 既定でON |
| Pin changes | `⇧⌘P` / pinボタン | |

https://github.com/user-attachments/assets/7adeae0e-3384-4e55-af63-bf9220fc5f6c

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
| 最前面に固定 | `⌃⌘T` | |
| Fit Window to Message | `⌥⌘H` | |
| Fitの表示message数を減らす／増やす | `⌥⌘[` / `⌥⌘]` | Fit中のみ |
| Collapse Window | `⌥⌘M` | 新しいmessageで復帰。Fit Window to Message中のみ |

https://github.com/user-attachments/assets/08a26dd6-e640-49dd-91a8-87f953e8c181

*拡大・縮小はwindow全体の相似を保つ。sizeと位置を変えて、アプリケーションを作業の邪魔にならない場所へ。*

</details>

<details>
<summary>UI・UX</summary>

| 操作 | キー | 備考 |
|---|---|---|
| theme | | System/light/dark |
| text size | `⌘0` / `⌘+` / `⌘-` | desktopのみ。windowも相似にresize |
| hand | | mobileのみ。右手/左手に最適化 |
| sound | | mobileのみ。message着信時にページ内で音を鳴らすだけで、native通知ではない。既定OFF |

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

AgentはAgentに `agent-send` で送れる。宛先のpaneに `[From: Claude]` のようなprefix付きで入力される。

```bash
printf '%s' '<message>' | agent-send <target>
```

使う場合は、`tmux/agent_send/agent-send` へのPATHと、`tmux/agent_send/SKILL.md` を、自分で置く。

## Stack

HTML/CSS/vanilla JavaScript、Python標準libraryと、app用のObjective-Cが1 file。Node、npm build、DBなどは使わず、次を直接叩く。

- **browser primitive** — DOM・`fetch` / `EventSource`
- **native OS API** — FSEvents / kqueue・AppKit / Objective-C
- **canonical CLI** — git・tmux・Agent CLI

## Footprint

appサイズは under 200 KB。telemetryなし。Agent CLI以外のネットワーク依存は `cdn.jsdelivr.net` の `marked`・`DOMPurify`・`katex`・構文配色設定時のみ `highlight.js` 。local完結させる場合は自分でvendorする。

Hubの port は `server/hub/port` fileの値(既定 `8788`)を専有する。fileを書き換えれば変わる。timelineごとのport はworkspaceのpathから決まる固定値を専有する。

Agent Window自身がfilesystemへ保存するdataは `~/.agent-window/` と、workspace内の `.agent-window/` だけ。

## License

[MIT](LICENSE)。画像内のfile iconはMaterial Icon ThemeとVS Code Modern Iconsのもの。
