# 設計哲学

[English](DESIGN.md)

## 前提

Agent Windowは、意味論とその抽象を本来あるべき場所――人間の認識の中――に還し、ソフトウェアに所有させません。

人間が一つの連続した対象として認識するものは、途中で名前が変わります。作業場所も変わるかもしれません。agent は入れ替わり、process は終了・再起動します。それでも、認識はそれらを跨いで柔らかく連続しています。

その連続性を不変の application object に変換しません。session名は表示名、workspace はその時点の作業場所、runtime は process を生かしておくための実行環境に過ぎません。log は起きたことの痕跡を残します。それらを一つの存在として同期し続ける制度を Agent Window は持ちません。

作業場所は既にあります。それが repository、データベース、一時的なディレクトリ、あるいは単なるフォルダであるかを Agent Window は問いません。workspace は identity ではなく、その時点で参加者が作業している場所です。必要なら変わります。

agent と人間は、その現実に一時的あるいは半永続的に参加する知能です。agent は内側から現実を直接扱えます。人間は外から横断的に見るための窓を必要とします。Agent Window の GUI はその窓です。

窓が壊れても、現実は壊れません。

## 統一ログ

人間 → agent、agent → 人間、agent → agent のメッセージや、Agent Window 自身が起こした出来事を、観測順に一つの log へ記録します。

これは世界の原本ではありません。原本はそれぞれ本来の場所にあり、統一ログはそれらを人間と agent が横断的に参照できる粒度へ落とした射影です。

実体は append-only JSONL であり、現在の workspace から symlink で参照できます。application 内部の状態ではなく、Agent Window が停止してもそのまま残り、読める記録です。

名前、process、workspace が変わっても、過去の記録はその時に観測された事実と provenance を保ったまま残ります。各entryは、それが参照する native log の位置まで遡れます。射影は不可逆ではありません。

## 何を実装しないか

Agent Window は、作業が綺麗な境界に分割できることを前提にしません。

複数の agent が同じ workspace を扱うことも、一つの流れが別の workspace へ移ることもあります。agent、task、worktree、workspace の寿命や境界が一致するとは仮定しません。

たとえば、agent と git worktree を 1:1 に対応させません。それらは寿命も境界も一致せず、その対応関係を永続化すれば Agent Window 自身が新しい source of truth を持つことになるからです。

plan、role、task graph、handoff のような契約も、現在の LLM の能力不足を補うためだけには固定化しません。知能自身が自然言語と既存の道具で扱えるものは、model の進化とともに application 側の制度を陳腐化させるからです。

必要な分離や履歴管理は既存の primitive を使います。それらを Agent Window 固有の恒久的な domain model にはしません。

## 何を実装するか

Agent Window が実装するのは、Agent Window が作らなければ存在しない事実、または参加者が現実の中から直接到達できない機構です。

たとえば、

- 参加者を起動し、生かし、互いに到達可能にすること
- 分散した出来事と作業空間の変化を観測し、人間が横断して読める形へ投影すること
- runtime の消滅を跨いで、再構成に必要な最小情報を残すこと

です。

`agent-send` も独自の messaging protocol ではなく、既存の入力経路へ文字列を届けるための極薄い wrapper に留めます。

## 要約

意味を所有しない。

不可避な機構だけを実装し、事実は本来ある場所から読む。
