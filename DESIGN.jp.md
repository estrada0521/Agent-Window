# 設計哲学

[English](DESIGN.md)

## UNIX and E2E

意味を人間の認識へ還し、ソフトウェアに所有させない。

- **Beyond Abstraction**：ソフトウェアは上に積むのではなく、より下位の層から直接駆動される方向へベットする。役目を失った層は、それに依存するすべてを道連れにする。
- **Standing on the Shoulders of Giants**：その時点で十分に安定した low-level primitive を直接使う。実行は tmux と agent CLI、履歴は git と filesystem、到達と認証は Tailscale、desktop viewer は OS 既定、log は `jsonl`。
- **No Proxy to Intelligence**：実際に計算能力を有するプロバイダの CLI を直接使い、最大到達面を保つ。wrapper を wrap しない。
- **No Institutional Semantics**：agent と worktree の 1:1 対応、plan、task graph、handoff、固有の domain type を作らない。LLM の能力不足を補う制度は、model の進化とともに陳腐化する。

## The Window

窓が壊れても現実は壊れない。

- **Projection, Not Reality**：統一ログは原本ではなく native log の位置を遡れる射影。filesystem と git は変化のたびに観測し直し、同期された複製は持たない。SoT を守り、推測で救済しない。
- **One Step to the Source**：ブラウザ、log ファイル、tmux、Finder、git tool、既定のアプリへ、それぞれ一つの操作で移れる。
- **Don’t Disturb. You're Just an Application**：composer は最小化され、window は小さく縮む。Fit Mode では window の方がメッセージに合わせにいき、最小待機と Always on top で作業の傍らに置いておける。

## Beauty and Engineering for Humans

欲求・感性・身体。

- **A Simple Want**：複数の AI を同じ場所から扱いたいという素朴な欲求。あるいは…。
- **Unified Log**：人間が一続きと捉える流れを、そのまま一本の log にする。agent や workspace が入れ替わっても、読むのは一本。
- **Beautiful and Usable**：Liquid Glass を纏い、見た目は px 単位、性能は 0.1s 単位で詰める。基本操作は keyboard で完結させ、mobile では片手操作を前提に操作面を下部へ集約。

## The Algorithm

Agent Window の開発方針。

1. **Question the Requirement**：間違った要件はその上に積まれる全ての努力を無駄にする。
2. **Delete**：改善は対象があって初めて定義され、対象を消せば問題ごと消える。**The best part is no part.**
3. **Simplify and Optimize**：1 と 2 を通ったものだけを対象にする。存在すべきでないものを改善してはいけない。
4. **Accelerate**：単純になったものだけを速くする。**無駄に**複雑なものを速くするのは愚か。
5. **Automate**：残った反復だけを自動化する。
