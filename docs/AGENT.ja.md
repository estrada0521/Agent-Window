# Multiagent Environment: Agent Guide

このドキュメントは、このリポジトリの **tmux ベースのマルチエージェント session で動作する agent** のための操作リファレンスです。

> **優先順位:** chat の指示、プロジェクト固有の指示、エディタレベルの指示、システム指示とこのドキュメントの間で矛盾がある場合は、常にそれらの指示をこのドキュメントより優先してください。

---

## 1. 最初に知るべきこと

この環境では、各 agent は通常独自の tmux pane で動作します。
user や他の agent への返信は、pane に直接出力するのではなく、**`agent-send`** 経由で送信する必要があります。

まずは基本を確認してください：

```bash
env | rg '^MULTIAGENT|^TMUX'
```

このドキュメント（または workspace 側の `docs/AGENT.md`）を user から受け取った場合は、**一度だけ** 読んで理解したことを報告してください。報告も `agent-send` を使用します。

後でコンパクトなコマンドチートシートだけが必要な場合は、次を実行してください：

```bash
agent-help
```

例：

```bash
printf '%s' 'docs/AGENT.md を読みました。この環境での返信ルーティング、添付ファイル、ログ規約を理解しました。' | agent-send user
```

主要な環境変数：

| Variable                 | 意味                          |
| ------------------------ | -------------------------------- |
| `MULTIAGENT_SESSION`     | 現在の session 名             |
| `MULTIAGENT_AGENT_NAME`  | あなたの agent 名                  |
| `MULTIAGENT_WORKSPACE`   | リポジトリのルートパス |
| `MULTIAGENT_LOGDIR`      | log と JSONL の保存先 |
| `MULTIAGENT_TMUX_SOCKET` | tmux socket（`-L` オプション用） |

workspace 内のファイルにアクセスするには：

```bash
cd "$MULTIAGENT_WORKSPACE"
```

---

## 2. agent-send の使い方

**すべての** 返信は `agent-send` を使って送信します。pane に直接 `echo` や `printf` で出力しても、user には届きません。

### 基本構文

```bash
printf '%s' 'メッセージ本文' | agent-send <target>
```

または複数行の場合：

```bash
agent-send <target> <<'EOMSG'
複数行の
メッセージ
EOMSG
```

### target の指定

- `user` — user に送信
- `claude`, `codex-1`, `gemini-1`, など — 特定の agent に送信
- `others` — 自分以外のすべての agent に送信
- `claude,codex` — カンマ区切りで複数の agent に送信

### 例

```bash
# user への報告
printf '%s' 'タスクが完了しました。' | agent-send user

# 別の agent への質問
printf '%s' 'この関数の意図を教えてください。' | agent-send claude

# 全員に通知
printf '%s' 'セッションを終了します。' | agent-send others
```

---

## 3. ファイル添付

`agent-send` は `--attach` オプションでファイルを添付できます：

```bash
printf '%s' 'レポートを添付します。' | agent-send user --attach report.md
```

複数ファイル：

```bash
printf '%s' 'ログとスクリーンショットです。' | agent-send user --attach error.log --attach screenshot.png
```

**重要:** 添付ファイルのパスは `$MULTIAGENT_WORKSPACE` からの相対パスか絶対パスを使用してください。

---

## 4. ログの規約

すべてのメッセージは自動的に `$MULTIAGENT_LOGDIR/<session>/.agent-index.jsonl` に記録されます。

各 pane の出力は個別の `.log` ファイルにも保存されます：

```bash
ls "$MULTIAGENT_LOGDIR/$MULTIAGENT_SESSION/"*.log
```

あなたの pane の出力は `<agent-name>.log` として保存されます。

---

## 5. 作業の原則

1. **返信には必ず `agent-send` を使う**
   - pane への直接出力は user に届きません
   
2. **workspace パスを前提にする**
   - `cd "$MULTIAGENT_WORKSPACE"` で移動してから作業

3. **添付ファイルで証拠を示す**
   - コード変更、ログ、スクリーンショットなどは添付で送る

4. **他の agent と協力する**
   - 必要なら `agent-send <agent-name>` で直接コミュニケーション

5. **ログを汚さない**
   - デバッグ出力は最小限に
   - 重要な情報だけを pane に出力

---

## 6. よくある操作

### workspace の確認

```bash
echo "Workspace: $MULTIAGENT_WORKSPACE"
echo "Session: $MULTIAGENT_SESSION"
echo "Agent: $MULTIAGENT_AGENT_NAME"
```

### ファイルの編集と報告

```bash
cd "$MULTIAGENT_WORKSPACE"
# ファイルを編集
vim src/main.py
# 変更を報告
printf '%s' 'src/main.py を更新しました。' | agent-send user --attach src/main.py
```

### 他の agent への質問

```bash
printf '%s' 'この API の使い方を知っていますか？' | agent-send codex-1
```

### 作業完了の報告

```bash
printf '%s' 'すべてのテストがパスしました。' | agent-send user --attach test-results.txt
```

---

## 7. トラブルシューティング

### `agent-send` が見つからない

```bash
export PATH="$MULTIAGENT_WORKSPACE/bin:$PATH"
```

または絶対パスで実行：

```bash
printf '%s' 'メッセージ' | "$MULTIAGENT_WORKSPACE/bin/agent-send" user
```

### メッセージが届かない

- `agent-send` の終了コードを確認：
  ```bash
  printf '%s' 'テスト' | agent-send user
  echo "Exit code: $?"
  ```
- 0 以外なら送信失敗です

### 環境変数が設定されていない

新しいシェルで作業している場合、tmux pane 内で実行してください：

```bash
tmux -L "$MULTIAGENT_TMUX_SOCKET" attach -t "$MULTIAGENT_SESSION"
```

---

## 8. セキュリティとプライバシー

- **機密情報は添付しない**: ログに残ります
- **パスワードやトークンは環境変数で**: 直接コードに書かない
- **一時ファイルはクリーンアップ**: 作業後に削除

---

## 9. さらに詳しく

- 全体の設計: [docs/design-philosophy.md](design-philosophy.md)
- 技術詳細: [docs/technical-details.md](technical-details.md)
- チャットコマンド: [docs/chat-commands.md](chat-commands.md)
- README: [../README_jp.md](../README_jp.md)

---

**これで準備完了です。** 何か不明な点があれば `agent-send user` で質問してください。
