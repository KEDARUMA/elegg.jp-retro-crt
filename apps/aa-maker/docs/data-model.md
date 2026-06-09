# AA Maker データモデル設計

## 目的

このドキュメントは、AA Maker の View 実装と編集ロジック実装で使うデータ構造を定義する。
実装は View 先行で進めるため、ここでは TypeScript 実装前に最低限必要なモデル境界と状態を固定する。

## 基本方針

- 論理グリッドは常に 80 列 x 25 行とする。
- 表示ズームはセル表示サイズだけを変え、モデル上の行列数は変えない。
- 未配置セルと、空白キャラを配置したセルは区別する。
- `キャンバスカラー` とセルの `BGC` は別の値として扱う。
- View は仮データでも本モデルに近い形で表示できるようにする。

## 型の概要

実装時は以下の型を中心に構成する。

- `Color`
- `Cell`
- `Layer`
- `Document`
- `Selection`
- `ToolState`
- `CharPalette`
- `Stamp`
- `ColorScheme`

## Color

色は 6 桁の小文字 16 進数で扱う。

```ts
type Color = string; // 例: "ffffff"
```

表示上の接頭辞は用途ごとに分ける。

- `FGC`: 文字色
- `BGC`: 配置済みセルが保持する背景色
- `キャンバスカラー`: 未配置セルや `BGC:0` の背景表示に使う色
- `FGDC`: `キャンバスカラー` の反転色

情報表示では既存仕様に合わせて `FC:ffffff` / `BC:000000` の形式で表示する。

## Cell

`Cell` は 1 グリッドセルの実データを表す。

```ts
type Cell =
  | EmptyCell
  | CharCell
  | WideTailCell;

type EmptyCell = {
  kind: "empty";
};

type CharCell = {
  kind: "char";
  char: string;
  width: 1 | 2;
  fgc: Color;
  bgc: Color | null;
};

type WideTailCell = {
  kind: "wide-tail";
  headX: number;
};
```

### EmptyCell

未配置セルを表す。

- 実データ上はキャラなし。
- 表示上は通常スペース `' '` として扱う。
- 状態は `FGC:0, BGC:0`。
- 背景表示は `Document.canvasBGC` を使う。

### CharCell

配置済みセルを表す。

- 通常文字、全角文字、特殊 SP を含む。
- `fgc` は必須。
- `bgc` が `null` の場合は `BGC:0` とし、背景表示は `Document.canvasBGC` を使う。
- `bgc` が色値を持つ場合は `BGC:1` とし、その色を背景表示に使う。

### 特殊 SP

空白キャラを配置したセルは `U+00A0 NBSP / no-break space` を使う。

- 見た目は空白でも `CharCell` とする。
- 状態は `FGC:1, BGC:0` または `FGC:1, BGC:1`。
- 範囲カラー、削除、コピー、レイヤー合成の対象に含める。

### 不正状態

`FGC:0, BGC:1` は存在しない不正状態とする。
実装時は `EmptyCell` に `BGC` を持たせないことで、この状態を型で防ぐ。

### WideTailCell

全角文字の右側セルを表す。

- 実データ上は単独の文字を持たない。
- `headX` で同じ行にある先頭セルの X 座標を参照する。
- 削除、スポイト、範囲選択では参照先の `CharCell` と一体で扱う。
- `WideTailCell` 単体に `FGC` / `BGC` は持たせない。

## 全角文字の占有

全角文字は横 2 セルを占有する。

全角文字は、左側セルを `CharCell`、右側セルを `WideTailCell` として表現する。

実装上は、`CharCell.width === 2` のセルを全角文字の先頭セルとして扱う。

理由:

- 全角文字の片側削除で文字全体を削除しやすい。
- スポイト時に右側セルから先頭セルを参照できる。
- 範囲選択時に全角文字全体を対象にしやすい。

最終的な型は実装時に確定する。

## Layer

`Layer` は 80x25 のセル配列と表示状態を持つ。

```ts
type Layer = {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  cells: CellGrid;
};

type CellGrid = Cell[][];
```

ルール:

- `cells` は 25 行 x 80 列。
- `Document.layers[0]` は最背面レイヤーとする。
- `Document.layers[Document.layers.length - 1]` は最前面レイヤーとする。
- UI のレイヤーリストは、上が前面、下が背面に見えるように `Document.layers` を逆順表示する。
- `visible: false` のレイヤーは合成表示に含めない。
- `visible: false` のレイヤーは選択・編集できない。
- `locked: true` のレイヤーは選択・編集できない。
- レイヤーは最低 1 つ必ず残す。
- レイヤー名は `Layer 1` から開始し、削除済み番号は再利用しない。

## Document

`Document` は AA Maker の編集データ全体を表す。

```ts
type Document = {
  version: 1;
  width: 80;
  height: 25;
  canvasBGC: Color;
  layers: Layer[];
  activeLayerId: string;
  nextLayerNumber: number;
};
```

ルール:

- `canvasBGC` は仕様書上の `キャンバスカラー`。
- `Invert BG` は `canvasBGC` を反転する。
- `Invert BG` では `canvasBGC` に合わせて `FGDC` を更新する。
- `Invert BG` では配置済みセルの `BGC` は変更しない。
- `Invert BG` では配置済みセルの `FGC` が反転前の `FGDC` だった場合だけ、最新の `FGDC` に変更する。
- `activeLayerId` は、選択・編集対象レイヤーを示す。
- `layers` の配列順は合成順の基準とし、インデックスが小さいほど背面、大きいほど前面とする。

## レイヤー合成

表示用グリッドは、`Document.layers[0]` から末尾へ順に合成して作る。

```ts
type CompositedCell = {
  char: string;
  fgc: Color | null;
  bgc: Color;
  sourceLayerId: string | null;
};
```

合成ルール:

- 非表示レイヤーはスキップする。
- `EmptyCell` は透過する。
- `CharCell` は表示対象になる。
- `CharCell.bgc === null` の場合、背景は `Document.canvasBGC` を使う。
- `CharCell.bgc` が色値を持つ場合、背景はその `BGC` を使う。
- 上位レイヤーの空白セルは下位レイヤーを透過する。
- すべてのレイヤーが空の場合、表示上は通常スペース `' '` と `Document.canvasBGC` を使う。

## Selection

`Selection` は範囲選択や配置後選択を表す。

```ts
type Selection =
  | { kind: "none" }
  | {
      kind: "rect";
      x: number;
      y: number;
      width: number;
      height: number;
    };
```

ルール:

- `x` / `y` は 0 始まり。
- `width` / `height` はセル数。
- 未選択時、情報表示の `W` / `H` は `--`。
- 範囲選択中に全角文字の一部が含まれる場合、操作対象は全角文字全体に拡張する。
- スタンプ配置後は、配置された範囲を `rect` として選択状態にする。

## ToolState

`ToolState` は現在のツールと入力状態を表す。

```ts
type Tool =
  | "move"
  | "select"
  | "eyedropper"
  | "pen"
  | "eraser"
  | "text"
  | "stamp"
  | "range-color";

type ToolState = {
  activeTool: Tool;
  selectedChar: string;
  selectedFGC: Color;
  selectedBGC: Color | null;
  selection: Selection;
  zoom: number;
};
```

ルール:

- `selectedBGC: null` は、背景カラーなしを表す。
- 左ツールボックス最下部の選択中文字表示は `selectedChar` / `selectedFGC` / `selectedBGC` を表示する。
- `range-color` は範囲選択中のみ選択可能。
- `zoom` は連続値で管理し、論理グリッドサイズには影響しない。

## CharPalette

キャラパレットセットは右サイドバーのコンボボックスで切り替える。

```ts
type CharPalette =
  | NormalCharPalette
  | HistoryPalette
  | KeyboardInputPalette
  | UnicodePalette;
```

### NormalCharPalette

```ts
type NormalCharPalette = {
  kind: "normal";
  id: string;
  name: string;
  cells: string[];
  cellWidth: 1 | 2;
};
```

- 半角セットは `16x16`。
- 全角のみのセットは `8x16`。
- 色の概念は持たない。
- 文字色は `FGDC` で表示する。

### HistoryPalette

```ts
type HistoryPalette = {
  kind: "history";
  history: string[];
  editableCells: string[];
};
```

- 全体は `16x16`。
- 上 `16x8` が選択履歴。
- 下 `16x8` が通常パレット相当。
- キャラパレットクリックまたはスポイトで選択文字が変わった時に履歴更新する。
- 同じキャラは連続追加しない。
- 下半分は右クリックで現在の選択文字を登録できる。

### KeyboardInputPalette

```ts
type KeyboardInputPalette = {
  kind: "keyboard-input";
  value: string;
};
```

- 直接入力用。
- 複数文字が入力された場合は先頭 1 文字を選択中文字にする。

### UnicodePalette

```ts
type UnicodePalette = {
  kind: "unicode";
  query: string;
  scrollOffset: number;
};
```

- Unicode 文字表を仮想スクロールで表示する。
- 文字コード検索で該当位置へジャンプする。
- 名称検索は将来対応。

## Stamp

スタンプは複数セルの塊として扱う。

```ts
type Stamp =
  | MonoStamp
  | ColorStamp;

type StampCell = {
  char: string;
  width: 1 | 2;
  fgc: Color | null;
  bgc: Color | null;
};

type MonoStamp = {
  kind: "mono";
  id: string;
  name: string;
  width: number;
  height: number;
  cells: (StampCell | null)[][];
};

type ColorStamp = {
  kind: "color";
  id: string;
  name: string;
  width: number;
  height: number;
  cells: (StampCell | null)[][];
};
```

白黒スタンプ:

- `Invert BG` の影響を受ける。
- `キャンバスカラー` / `FGDC` の反転ルールに従って表示・配置する。
- `BGC` は保持する。

カラースタンプ:

- スタンプ自身の `FGC` / `BGC` を保持する。
- 透明または未配置部分だけ `キャンバスカラー` を反映して表示する。

配置ルール:

- カーソル位置を左上として配置する。
- グリッド外にはみ出す場合は、収まる範囲だけ配置する。
- 配置後は、配置された範囲を `Selection` に設定する。

## ColorScheme

カラースキーマは色選択 UI で使う。

```ts
type ColorScheme = {
  id: string;
  name: string;
  colors: Color[];
};
```

用途:

- 選択中文字表示の左クリックで `selectedFGC` を変更する。
- 選択中文字表示の右クリックで `selectedBGC` を変更する。
- 範囲カラーの左クリックで範囲内キャラありセルの `FGC` を変更する。
- 範囲カラーの右クリックで範囲内キャラありセルの `BGC` を変更する。
- 範囲カラー右クリック側では「カラーなし」を選択できる。

## View 実装用の仮データ

View 先行実装では、以下の仮データを用意する。

- 80x25 の空グリッド
- `Layer 1` から始まるレイヤーリスト
- 選択中文字 `A`
- `selectedFGC: "00ff00"`
- `selectedBGC: null`
- `canvasBGC: "ffffff"`
- 通常キャラパレット 1 セット
- ヒストリーパレット 1 セット
- Unicode 文字表のダミー表示
- 白黒スタンプ 1 件
- カラースタンプ 1 件

この仮データは、後続のデータモデル実装時にそのまま TypeScript 型へ移行できる形にする。
