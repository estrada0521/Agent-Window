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

## Agent Windowの原則

1. Timelineが単位で、実体はJSONLのログ
2. Agent Processは普通のCLI
3. Agent・WorkspaceはTimelineの途中で差し替えられる

## Agent Windowについてもっと知る

<details>
<summary>Fit Window</summary>

アプリケーションは必要な面積だけを使います。

- `⌥⌘H`で`Fit Window`を有効にすると、Windowが最新のメッセージに合わせて自動でResizeされます。
- `⌥⌘[` `⌥⌘]`で表示するメッセージ数を調整できます。
- `⌥⌘M`でWindowは最小化され、次の新規メッセージまで待機します。

</details>

<details>
<summary>Window Resize / Move</summary>

ResizeはWindow全体の相似関係を保ちます。作業の邪魔にならない位置と大きさに素早く調整できます。

</details>

<details>
<summary>Hub Menu</summary>

ほぼ全てのAgent Window固有のショートカットは、Hub Menuからも操作可能です。\
カラーテーマ（system / light / dark）の切り替えはここから行います。

</details>

<details>
<summary>Timeline States Actions</summary>

TimelineはRename・Archive・Reviveできます。Archiveしてもログは残り、Reviveすると保存したWorkspaceとAgent構成で再開します。Archive中はWorkspaceの変更・Agent構成のリセット・Timelineの削除もできます。

</details>

<details>
<summary>Prompt Box</summary>

入力欄は必要なときだけ現れ、Timelineの場所を取りません。入力されたテキストは、Agent CLIのPaneにそのまま入力されます。`⌃1`–`⌃9`で送信先を切り替えます。

</details>

<details>
<summary>Commands</summary>

入力欄で`/`を入力すると、AW固有のコマンド候補が表示されます。CLIのコマンドはPane本体から実行します。

</details>

<details>
<summary>Substance is CLI</summary>

`/openpane`・`timeline menu → tmux pane`・Running表示のタップからCLI本体を確認できます。

</details>

<details>
<summary>Agent to Agent</summary>

`tmux/agent_send/SKILL.md`を利用すれば、A2A通信ができます。プロトコルはなく、宛先のPaneに`[From: Claude]`のようなprefix付きで`tmux send-keys`が実行されます。使う場合は、`tmux/agent_send/agent-send`へのPATHを配線します。

</details>

<details>
<summary>File Attachment</summary>

`+` / drag & drop / pasteでファイルを添付できます。添付したファイルは`<workspace>/.agent-window/uploads/`に保存され、そのpathがplain textとして送信テキストの末尾に追加されます。

</details>

<details>
<summary>File Search</summary>

入力欄での`@`から、Workspace内のファイルを検索できます。対象はGit管理下に限定しています。子Repoを監視対象に追加すると、その分のファイルも対象になります。

</details>

<details>
<summary>File Open</summary>

Desktopには独自のFile Viewerはありません。原則として既定のアプリで展開されます。DiffはGitに設定されたdiff toolをそのまま利用します。素早い確認には`⌥ + click` / `⌘Y`でmacOSのQuick Lookを利用します。

</details>

<details>
<summary>Sidebar</summary>

Sidebarには`FSEvents`によるイベント駆動でGit・Workspaceの状態が表示されます。横幅調整に加え、上下（`⇧⌥⌘E`）・左右（`⇧⌘E`）を入れ替えることができます。

</details>

<details>
<summary>Independent Sidebar</summary>

`Fit Window`中は、Sidebarは独立Windowになります。好きな位置、大きさで保持できます。

</details>

<details>
<summary>Add Repository</summary>

指定した子ディレクトリをRepo rootとして、監視対象に追加・削除できます。追加したRepoの一覧は`timeline menu → Repository`に表示され、Sidebarの表示を切り替えられます。Worktreeの一覧は、選択中のRepoのものになります。

</details>

<details>
<summary>Worktrees</summary>

`timeline menu → Worktree`からSidebarに表示するlinked worktreeを切り替えることができます。

</details>

<details>
<summary>Follow Changes</summary>

Follow Changesを有効にすると、Sidebarの表示が最後に更新されたRepo・Worktreeに自動追従します。表示対象を明示指定すると解除されます。

</details>

<details>
<summary>Pin Changes</summary>

現在の差分をSidebarを開くことなく、Timeline上部に小さく保持できます。hoverで一覧が展開されます。

</details>

<details>
<summary>Timeline Search</summary>

`⌘F`でTimelineを全文検索します。`⇧`併用で、10件単位で移動できます。

</details>

<details>
<summary>What AW records</summary>

Agentのメッセージには、投影元のnative logのpath・offsetが記録されます。ユーザーのメッセージには送信元のクライアント（mobile / desktop）が記録されます。

メッセージ上を右クリックすることで粒度別のCopyが可能です（モバイルではCopyボタンを長押しします）。ログ全体の正本（JSONL）は`⌥⌘L`で開くことができます。

</details>

<details>
<summary>Export</summary>

Timelineのログを範囲指定して、JSONLまたはHTMLとしてExportできます。HTMLは表示されたWebViewをそのまま焼き込むため、見た目は完全に保持されます。

</details>

<details>
<summary>Open in browser</summary>

Agent Windowの基本操作はブラウザのみで完結します（`⇧⌥⌘O`）。特定のTimelineだけを直接ブラウザで開くことも可能です（`⌥⌘O`）。

</details>

<details>
<summary>HUD</summary>

エラー表示から通常操作のフィードバックに至るまで、一時的な通知はTimeline上部のHUDに集約され、滑らかに切り替わります。一部のHUDは常駐します。

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
  - **Build**: 1s from ./macos/build
  - **Size** : < 200 KB
- **System**:
  - **Network**: CDN（marked・DOMPurify・katex・highlight.js）
  - **Port**: value of server/port (default 8788)
  - **Files**: ~/.agent-window/(log)・{workspace}/.agent-window/(symlink・uploaded file)
