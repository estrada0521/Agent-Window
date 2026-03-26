# Chat Commands

chat UI で使う command と pane control をまとめた補助メモです。README は概要、ここは現時点の一覧です。

## Pane Trace

- mobile: thinking 行を押すと埋め込み Pane Trace viewer を開きます
- desktop: thinking 行を押すと選択中 agent の Pane Trace を popup window で開きます
- desktop の `Terminal` は terminal 本体を開きます
- mobile の `Terminal` は Pane Trace につながります

## Slash Commands

slash command は composer の先頭で `/` を入力すると候補が出ます。

| command | 内容 |
|------|------|
| `/memo [text]` | `user` 自身へのメモ。本文が空でも Import 添付だけで送れます |
| `/raw <text>` | `[From: User]` や `msg-id` を付けずに 1 回だけ pane へ raw paste します |
| `/brief` | `default` brief を開きます |
| `/brief set <name>` | `brief_<name>.md` を開きます |
| `/model` | 選択中 pane に `model` を送ります |
| `/up [count]` | 選択中 pane に上移動を送ります。`count` 省略時は 1 |
| `/down [count]` | 選択中 pane に下移動を送ります。`count` 省略時は 1 |
| `/restart` | 選択中 agent pane を再起動します |
| `/resume` | 選択中 agent pane を再開します |
| `/interrupt` | 選択中 agent pane に `Esc` を送ります |
| `/enter` | 選択中 agent pane に `Enter` を送ります |

`/up` と `/down` の `count` は 1 から 100 の範囲に丸められます。

## Quick Actions

composer 下の quick action や `Cmd` / `Command` メニューから使える操作です。

| UI | 内容 |
|------|------|
| `Import` | ローカル端末のファイルを session uploads に追加 |
| `Raw` / `Raw Send` | raw send を切り替えるか、その場で raw send します |
| `Brief` / `Send Brief` | 保存済み brief を selected targets へ送ります |
| `Load` / `Load Memory` | 現在の `memory.md` を selected agent に送ります |
| `Memory` / `Save Memory` | 現在の会話をもとに `memory.md` を更新させます |
| `Save` / `Save Log` | pane log の snapshot を即時保存します |
| `Restart` | 選択中 agent pane を再起動します |
| `Resume` | 選択中 agent pane を再開します |
| `Ctrl+C` | 選択中 agent pane に `Ctrl+C` を送ります |
| `Enter` | 選択中 agent pane に `Enter` を送ります |
| `Esc` / `Interrupt` | 選択中 agent pane に `Esc` を送ります |

## Notes

- pane control 系の command や quick action は、selected targets が空だと実行できません
- `Raw` 系は通常の chat message ではなく、pane への直接入力です
- command は今後増える前提なので、README ではなくこのファイルを更新基点にする想定です
