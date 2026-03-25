# Gemini 向け依頼: Hub iframe チャット × iOS Safari 下端 UI

## 依頼の目的

iOS Safari で **ローカル Hub（`bin/agent-index`）が iframe オーバーレイで開くチャット**について、**Public（同一チャットをトップレベルで開いたとき）** に近い見え方・操作感にしたい。特に **下端の Safari UI（タブバー／いわゆる O 付近）とセーフゾーンまわり**で、**キーボードやツールバーの表示変化のあとにレイアウトが「元に戻る」**挙動が直らない。

**Public のコードは変えず**、`window.frameElement` がある（Hub iframe）ときだけの分岐で対処したい。

## 現象の詳細（ユーザー報告）

- チャットの **入力／コンポーザ** が、キーボードやビューポートまわりで **「帯の中央」に寄る**問題があった（親が `#chatOverlay` を `visualViewport` に合わせて縮めていたため iframe 内の `100vh`／`innerHeight` が「帯」だけになっていた、という分析）。
- **O ボタン（下端の Safari UI）を押し下げている／ツールバーが引っ込んでいる状態**だと、**セーフゾーンが目立たなくなり望ましい**。
- **手を離すと元に戻る**／または **時間が経つと「取り憑いたように」元の悪い状態に戻る**。
- **80px しきい値**での innerHeight 差分リセットでは足りない（セーフゾーンが大きい）という指摘もあった。

## 技術コンテキスト（リポジトリ）

### 親: `bin/agent-index`

- `#chatOverlay` は **フルレイアウト**（以前は `visualViewport` に合わせて top/height をいじっていたがやめた）。
- iframe 表示中、親の **最大 `innerHeight`** を `_hubChatParentLayoutMax` として保持し、子へ `postMessage`：
  - `type: "multiagent-hub-layout"`
  - `layoutHeight`, `parentInnerHeight`, `parentVvHeight`, `parentVvOffsetTop`, `parentChromeGap`
- 子から `multiagent-chat-request-hub-layout` で再送。
- 親で **下端クロムの「raw」** を計算し、**最小値をラッチ**して `parentChromeGap` に載せている。

### 子（iframe 内のみ）: `lib/agent_index/chat_assets.py` 埋め込み JS

- `data-hub-iframe-chat="1"`
- `--hub-iframe-lock-height`（親の `layoutHeight` でコンポーザオーバーレイの高さ）
- `--hub-parent-chrome-gap`（`main` の `padding-bottom` や FAB の `bottom` に加算）
- **子側でも** `parentChromeGap` を **`Math.min` で増やさない**二重防御。

## raw（gap）の定義の変遷

1. 当初: `parentInnerHeight - parentVvHeight`
2. 改善試行: **親で min ラッチ**（iframe 内だけだと postMessage の順序で戻りやすい）
3. **innerHeight が 80px 以上変わったらリセット** → 揺れで頻繁に外れるため **廃止**
4. **`orientationchange` でリセット** → **誤発火の疑い**で廃止
5. **`matchMedia("(orientation: portrait)")` の change でリセット** → やはり **ツールバー変化で誤る疑い**で廃止
6. 現在: **親の `innerWidth`/`innerHeight` で縦長／横長のバケットが変わったときだけ** 親ラッチをリセット。子も同様にバケット変化で min をリセット。
7. **raw を** `innerHeight - visualViewport.offsetTop - visualViewport.height` に変更（アドレスバー等で `offsetTop` が動くケース向け）。

## 制約

- **Public（トップレベル）の挙動を壊さない** → `frameElement` があるときだけ。
- ネイティブの **O ボタンそのものの位置は Web から固定できない**；できるのは **視覚領域に合わせた余白・固定要素の位置の近似**。

## 依頼してほしいこと

1. **なぜ「O を押しているときは良いのに、離すと戻る」のか**を、iOS Safari の **layout viewport / visual viewport / iframe / 固定オーバーレイ** の観点で整理し、**現行の raw＋min ラッチ設計の穴**（計測がズレている、イベント順、親子どちらの `visualViewport` を見るべきか、キーボード時の混線など）を指摘してほしい。
2. **別アプローチ**の提案（例: 親の `visualViewport` の **offsetTop/offsetLeft/height** を全部渡して子で FAB を絶対配置する、iframe 内では `env(safe-area-inset-bottom)` を無効化／上書きする、**Intersection Observer**、**ResizeObserver** 方針、親が **一定間隔でレイアウトを送らない** 等）があれば、**メリット／デメリット**付きで短く列挙してほしい。
3. 可能なら **検証手順**（Safari の Web Inspector で親子のどの値をログすべきか）を箇条書きでほしい。

## 成果物の形式

- 箇条書き中心でよい。
- コード変更案がある場合は **どのレイヤ（親 HTML／子の CSS 変数／postMessage ペイロード）か** を明記してほしい。

## 補足

精度を上げるには、この brief に加えて **`bin/agent-index` と `lib/agent_index/chat_assets.py` の該当ブロック**を Gemini に貼るとよい。
