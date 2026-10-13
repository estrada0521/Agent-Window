# Agent Window Agent Handbook

- For Agent Window basics, see [README.md](README.md); for its design philosophy, see [DESIGN.md](DESIGN.md).
- The Agent Window website is managed in `/Users/okadaharuto/workspace/okadaharuto.com`.

## Additional Note by H.Okada

- 作業は**The Algorithm**の順序を守ること。そもそも要件は何か？そもそも問題の存在自体を消せないか。その後で単純化・最適化・高速化、そして自動化する。

- 必ずしも現代的に正しいコードを書くことに執着してはならない。単純で原始的な手段をなるべく使うこと。型や構造は悪ではないが、**型も構造もオーバエンジニアリングに見える**コードが本来好ましい。型は実行される実体そのものではない。実体を見ること。

- SoTとは、真実の**唯一の**源を指す。ある値を一つの場所から読んでいるからといって、それは真実が複製されていないことを意味しない。本来存在すべき値が何らかの理由で存在しない・壊れている場合、アプリケーションは**壊れなければならない**。別の経路で救済できることは、真実が分散しているか、あるいは確実な根拠のない推定を用いていることを意味する。

- 基本的にコメントを書かないこと。

- commit descriptionには会話内容から分かる**履歴と意図を残す**こと。そもそも・なぜ、を書くこと。コードからわかることを冗長に連ねないこと。

- 間違った動きをする必要なコード以上に、**正しい動きをする不要なコード**を許してはいけない。バグは露出するので修正は安いが、**もっと良い実装が存在しないこと**を追求するのは難しく、知性はそちらに宿る。すべてのコードをload-bearingに圧縮しようとすること。

- 最も優れたエラーハンドリングとは、エラーが発生しないことである。外部依存やuserの誤操作は例外として、**そもそも失敗してはいけない**。上流で失敗をなくし、下流では楽観的で単純な世界を作るのが基本方針。高度で複雑なコードは、「書けた」のではなく「書いてしまった」と考えること。

- **AWの固有名詞を発明してはならない**。安易な抽象名は実体を隠し、大げさな意味論の元凶になる。

- **自明で、何も感じない**美しさを目指せ。例えば、アニメーションがないと違和感があるとする。この場合、アニメーションは必要である。ただし、使用時にそのアニメーションの存在が**意識に上ってはいけない**。自明とはそういう意味である。

- レビューについて。粗探しをしろ、と言っているわけではない。指摘に必ず代替案を含めること。**粗が意図的である可能性を履歴から確かめること**。この文書の要件と照らし合わせること。

- 「使われていないコード」「重複しているコード」を列挙するのはそれが求められている時だけにすること。そんなものはいつでも機械判定できるので監査価値は低い。重複は特に意図的である場合が少なくない。**使われているし、重複もしていないけど、不要なコード**こそが本質的に抹消しなければならない対象である。「全てのファイルの全ての行は自分が存在することが許されることを示さなければならない。」ぐらいの気持ちを持つこと。（つまり、**本当の意味で知能を使う監査**をして欲しいということ。これは言葉以上に重要である。）

## 1. Prefer the intended path

- Do not replace a broken input, a broken progress record, or an unreadable source with an empty stand-in, a zero, or a skipped step just to let the rest of the work continue.
- Do not paper over a defect with a fallback or a retry. A second path catching the first one's failure is no better. Fix the first path itself.
- When the defect is not yours — a third party, content you did not author — using a fallback or retry appropriately is permitted. But never let the failure go unseen.
- Independent paths are not jointly liable. When one path fails, fail that path alone. Do not stop unrelated paths along with it.

## 2. Cut completely

- Dead code is erased, not kept around behind a flag or a comment. When a path is replaced, the old one is erased with it. There is no compatibility window and no legacy alias.
- Do not stop at what looks safe to delete. Cut until something necessary screams. If you deleted ten things and only two had to come back, you still haven't deleted enough. Looking unused is not the same as being dead.
- If a name clearly does not match what it names, fix it. You do not need to be asked. Functions, files, and folders are all in scope.

## 3. Keep living code spare

- Do not optimize what should not exist in the first place. Question the thing before you improve it. The best implementation is no implementation.
- As a rule, gather the same work scattered across multiple places into one place. But if doing so pulls in more complexity than it removes, don't — duplication is sometimes cheaper than abstraction.
- A value used repeatedly is one fact. Do not restate it as a hardcoded literal each time.
- Do not spend memory, CPU, GPU, or battery on work that changes neither what can be seen nor what must be remembered. Idle should be as idle as possible.
- Down to the last remaining line, everything should carry meaning you can explain.

## 4. Tests are not a second product

- Adding a test always requires the user's judgment.
- Tests exist not only to guard basic boundaries but to lock in deliberately-shaped code — so that an overeager agent doesn't "improve" something that only looks bad by convention.
- Tests are not written for coverage, as a refactor souvenir, or because you're "already in there."
- Do not add tests for a boundary that has never broken and isn't likely to.
- When a test disagrees with the product, suspect the test just as much as the product.
- When a path is cut, cut its tests in the same change.

## 5. The user's words are not doctrine

- If the user is wrong, say so at once. Do not agree just to move things along.

