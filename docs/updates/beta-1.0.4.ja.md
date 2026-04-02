# multiagent-chat beta 1.0.4

English version: [beta-1.0.4.md](beta-1.0.4.md)

公開日: 2026-04-02

このノートは、beta 1.0.3 のリリース準備を行った 2026-04-01 の commit `2590f14` 以降の変更をまとめたものです。

## 主な更新

### Hub に daily Cron scheduler を追加した

- 既存の session と agent を対象に、1 日 1 回の prompt を定時実行する専用の Cron ページを Hub に追加しました。
- 各 job には名前、対象 session、対象 agent、実行時刻、prompt 本文、enable / disable 状態、直近 status を保持します。
- `Run Now` も同じ UI に入っているため、定時運用と手動確認を別ツールに分けずに扱えます。
- Cron の実行経路は専用 transport ではなく、通常の pane と `agent-send` を使うため、結果は普段の chat と同じタイムラインに戻ります。
- pending run は追跡され、一定時間返答が無ければ 1 回 reminder を送り、それでも結果が無い job は timeout として記録されます。

### file preview が chat renderer に近づいた

- Markdown preview は preview 専用の別フォントではなく、設定された agent font を引き継ぐようになりました。
- preview modal 内から dark / light を切り替えられるようになり、長文の読解や書き出し後の確認がしやすくなりました。
- local と public の route 差も詰め、reload 後にどちらでも同じ markdown preview の見た目とフォント挙動が出やすくなりました。

### standalone export の忠実度が上がった

- static HTML export を単体で開いたとき、一部 viewer で header だけに見えるような崩れが出にくくなり、live chat に近い形を保てるようになりました。
- 添付が多い export でも、PC とスマホの両方でアプリ内に近い読み心地を維持しやすくなっています。
- これにより export は単なる保存物ではなく、共有・引き継ぎ用の読み物としても使いやすくなりました。

### Hub 周りの authoring flow をさらに整理した

- Hub top と関連ページでは、タイトル直下の説明文を外して chrome を軽くしました。
- New Session の workspace picker は、直接入力、recent path、folder browser を 1 つの流れとして再整理しました。
- workspace の browse control も `Browse` / `Close` 切り替え時に位置が跳ねないように調整しました。
- panel overflow 回りの不具合も修正し、branch menu の長い commit 一覧を再びスクロールできるようにしました。
- あわせて、preview / export の実例にも使える multiferroics 関連の文書も追加しています。

## そのほか

- export、file preview、Hub compose surface は、1 回入れて終わりではなく、その後も細かく調整を続けています。
- README と更新ノートも拡充し、Cron、export fidelity、preview parity の位置づけがコード外からでも追いやすくなりました。
