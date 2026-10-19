<div align="center">

# Agent Window

UNIX哲学のmacOS向けAgent application。

https://okadaharuto.com/agent-window/

</div>

<p align="center">
  <img src="media/agent-window-hero-1.png" width="100%" alt="Agent Window, light theme">
  <img src="media/agent-window-hero-2.png" width="100%" alt="Agent Window, dark theme">
</p>

<div align="center">

対応CLI: Claude・Codex・Antigravity・Cursor・Grok

</div>

---

## Principle

AWの設計哲学については、[DESIGN](DESIGN.jp.md)をご覧ください。

1. Timelineが単位で、実体はJSONLのログ
2. Agent Processは普通のCLI
3. Agent・WorkspaceはTimelineの途中で差し替えられる

## Agent Windowについてもっと知る

<details>
<summary>Hub</summary>

<p align="center">
  <img src="media/agent-window-hub-menu.png" width="100%" alt="Hub menu">
</p>

| 操作 | 内容 |
|---|---|
| New Timeline | `⌘N` |
| active timelineの切り替え | `⌘1`–`⌘9` |
| ブラウザでHubを開く | `⇧⌥⌘O` |
| serverの再起動 | `⇧⌘R`<br>変更後のsourceを読み直す |
| workspaceのpathをコピー | 右クリックmenu |
| timelineの統計表示 | hover |

</details>

<details>
<summary>Composer</summary>

https://github.com/user-attachments/assets/5ce44e5a-de19-46cb-9861-11caac880c08

*入力欄は必要なときだけ現れ、timelineの場所を取りません。*

| 操作 | 内容 |
|---|---|
| 入力欄を開く | `Enter` / ホイール押し込み<br>`O` ボタンでも開く |
| 入力欄を閉じる | `Esc` |
| 入力欄を下部／中央へ移動 | `⌃⌘↓` / `⌃⌘↑`<br>入力欄を開いている時 |
| 送信先の切り替え | `⌃1`–`⌃9`<br>未指定はlogにのみ残る |
| workspace内のfileを検索 | `@`<br>`.gitignore`対象外のfile |
| fileを添付 | `+`ボタン / drag & drop / paste<br>`<workspace>/.agent-window/uploads/` に保存され、そのpathがtextとしてAgentに渡る |

</details>

<details>
<summary>Commands</summary>

| Command | 内容 |
|---|---|
| `/jump YYYY-MM[-DD [HH[:MM[:SS]]]]` | 指定した月・日・時刻の最初のmessageへ移動 |
| `/restart` | Agentのpaneを再起動する |
| `/idle` | Agentのrunning表示を解除する |
| `/log` | logのpathをmessageに挿入する |
| `/skill` | `agent-send` SKILLへの参照をmessageに挿入する |
| `/openpane` | Agentのpaneを開く (desktop)<br>未選択ならterminal paneを開く |
| `/nativelog` | Agentのnative logをFinderで表示する (desktop) |
| `/terminal <text>` | terminal paneに文字列を送る (mobile) |

</details>

<details>
<summary>timeline menu (<code>⌘.</code>)</summary>

<p align="center">
  <img src="media/agent-window-timeline-menu.png" width="100%" alt="Timeline menu">
</p>

| 操作 | 内容 |
|---|---|
| Agentの追加 / 削除 |  |
| Terminalを開く | `⌥⌘T` |
| Finderでworkspaceを開く | `⌥⌘R` |
| tmux terminal paneを開く | `⌘T`<br>mobileの`Pane Trace`から操作可能 |
| FinderでLogを開く | `⌥⌘L` |
| ブラウザでtimelineを開く | `⌥⌘O` |
| timelineの全文検索 | `⌘F` / Search<br>`⇧`併用で10件ずつ飛び |
| timelineをHTML / JSONLとしてExport |  |

</details>

<details>
<summary>timeline</summary>

| 操作 | 内容 |
|---|---|
| 先頭 / 末尾へ移動 | `⌘↑` / `⌘↓` |
| 前 / 次のmessage | `⌥↑` / `⌥↓` |
| 選択中の宛先の前 / 次のmessage | `⌃⌥↑` / `⌃⌥↓`<br>無選択ならuser |
| Copy | 右クリック / hover |
| Copy Log Entry | 右クリック<br>AW logのJSON row / mobileではcopy長押しから |
| Copy Native Log Entry | 右クリック<br>native logのJSON row |
| URLをcopy | 外部linkを右click |

</details>

<details>
<summary>CLI</summary>

https://github.com/user-attachments/assets/006bfe63-5e14-4abe-9039-e7e86b1a5851

*必要なときはCLI自体を開けます。*

</details>

<details>
<summary>Timelineの状態操作</summary>

| 操作 | 内容 |
|---|---|
| Rename | timelineの名前を変える |
| Archive | tmux sessionを終了する<br>logは残る |
| Revive | 保存したworkspaceとAgent構成でtmux sessionを再起動する<br>CLIはresumeされる |
| Delete | timelineの保存物を完全に削除する<br>Archive中のみ可 |
| Change Workspace | workspaceを変更する<br>Archive中のみ可 |
| Reset Agents | 保存したAgent構成を削除する<br>Archive中のみ可 |

</details>

<details>
<summary>git / workspace</summary>

https://github.com/user-attachments/assets/d878b522-99fb-4ba6-9326-29d73bace9ea

| **file** |  |
|---|---|
| fileを開く | `⌘O` |
| Quick Look | `⌘Y` / `⌥` + click |
| Finderで表示 | `⌥⌘R` |
| fileをcopy | `⌘C` |
| 絶対pathをcopy | `⌥⌘C` |
| 相対pathをcopy | `⇧⌥⌘C` |

| **git** |  |
|---|---|
| 監視repoの追加 / 解除 | フォルダを右クリック |
| commit hashをcopy |  |
| commit messageをcopy |  |
| commitのinfo表示 | hover |
| repo / worktreeの切り替え | timeline menu・mobileのbranchボタンから |
| Follow changes | repo・worktreeを跨いで追従。既定でON |
| Pin changes | `⇧⌘P` / pinボタン |

</details>

<details>
<summary>sidebar</summary>

<p align="center">
  <img src="media/agent-window-hero-3.png" width="100%" alt="Workspace">
</p>

*Fit Windowでは、gitとworkspaceをtimelineから独立したwindowに置き、位置と大きさを自由に変えられます。*

</details>

<details>
<summary>Resize window</summary>

https://github.com/user-attachments/assets/7d155603-6263-4f5e-971d-df41952b0b29

*window全体の比率を保ったまま拡大・縮小します。作業の邪魔にならない位置と大きさに調整できます。*

| 操作 | 内容 |
|---|---|
| size 既定 / コンパクト / ミニ | `⌥⌘0` / `⌥⌘9` / `⌥⌘8` |
| Hub / side barの開閉 | `⌘B` / `⌘E`<br>`⌥` 併用で外側に広がる |
| side barの左右入れ替え | `⇧⌘E` |
| Git / Workspaceの上下入れ替え | `⇧⌥⌘E` |
| 画面端へ移動 | `⌥⌘↑` `←` `→` `↓`<br>`↓` は中央 |
| 最前面に固定 | `⌃⌘T` |

</details>

<details>
<summary>Fit Window</summary>

https://github.com/user-attachments/assets/d9f3cbc2-39c5-4b28-8be9-0d98c8328e1f

*`⌥⌘H` でwindowの高さが最新messageに合い続ける。`⌥⌘[` / `⌥⌘]` で表示するmessage数を減らす／増やす。`⌥⌘M` でwindowが最小まで畳まれ、新しいmessageで戻る。*

</details>

<details>
<summary>UI・UX</summary>

| 操作 | 内容 |
|---|---|
| theme | System/light/dark |
| text size | `⌘0` / `⌘+` / `⌘-`<br>desktopのみ。windowも相似にresize |
| hand | mobileのみ。右手/左手に最適化 |
| sound | mobileのみ。message着信時にページ内で音を鳴らすだけで、native通知ではない。既定OFF |

</details>

<details>
<summary>customize</summary>

| 項目 | 設定方法 |
|---|---|
| Main Font & Code Font | symlink CSS (`--font-main` / `--font-code`・`@font-face`) -> `~/.agent-window/fonts.css`; font files -> `~/.agent-window/fonts/` |
| File Icon | symlink VS Code theme json -> `~/.agent-window/file-icon-theme.json` |
| Syntax highlight | symlink highlight.js CSS -> `~/.agent-window/syntax-light(dark).css` |
| Keymacro for Pane Trace | add to `tmux/key_macro.py/PANE_TEXT_MACROS` |

</details>

<details>
<summary>A2A</summary>

AgentはAgentに `agent-send` で送れる。宛先のpaneに `[From: Claude]` のようなprefix付きで入力される。

```bash
printf '%s' '<message>' | agent-send <target>
```

使う場合は、`tmux/agent_send/agent-send` へのPATHと、`tmux/agent_send/SKILL.md` を、自分で置く。

<p align="center">
  <img src="media/agent-window-agent-send.png" width="100%" alt="Conversation between Claude, Codex and Grok">
</p>

</details>

## iPhoneから操作する

TailscaleでHubに接続し、PWAとして使用します

<p align="center">
  <img src="media/agent-window-mobile-light-1.png" width="48%" alt="Mobile UI, light 1">
  <img src="media/agent-window-mobile-dark-1.png" width="48%" alt="Mobile UI, dark 1">
</p>

<details>
<summary>More screenshots</summary>

<p align="center">
  <img src="media/agent-window-mobile-light-2.png" width="48%" alt="Mobile UI, light 2">
  <img src="media/agent-window-mobile-dark-2.png" width="48%" alt="Mobile UI, dark 2">
  <img src="media/agent-window-mobile-light-3.png" width="48%" alt="Mobile UI, light 3">
  <img src="media/agent-window-mobile-dark-3.png" width="48%" alt="Mobile UI, dark 3">
  <img src="media/agent-window-mobile-light-4.png" width="48%" alt="Mobile UI, light 4">
  <img src="media/agent-window-mobile-dark-4.png" width="48%" alt="Mobile UI, dark 4">
  <img src="media/agent-window-mobile-light-5.png" width="48%" alt="Mobile UI, light 5">
  <img src="media/agent-window-mobile-dark-5.png" width="48%" alt="Mobile UI, dark 5">
</p>

</details>

## Footprint

- **Source**:
  - **Size**: 1.6 MB・40,000 LOC
  - **Stack**: HTML・CSS・vanilla JavaScript・Python stdlib
- **App**:
  - **Spec**: native launcher of local repo
  - **Requirements**: python3・tmux・Xcode CLI
  - **Build**: 1s from `./macos/build`
  - **Size** : < 200 KB
- **System**:
  - **Network**: CDN（`marked`・`DOMPurify`・`katex`・`highlight.js`）
  - **Port**: value of `server/port` (default `8788`)
  - **Files**: `~/.agent-window/`(log)・`{workspace}/.agent-window/`(symlink・uploaded file)
