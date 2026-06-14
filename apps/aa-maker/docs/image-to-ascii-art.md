# 画像からAA生成 仕様書

## 目的

画像ファイルを読み込み、640x400 の加工済みモノクロ画像を 80x25 の編集グリッドへ変換する。
1 セルは半角 8x16 px、全角 16x16 px として扱い、半角文字の初期マッチング後に全角文字で上書きできる箇所を判定する。

## 既存実装との接続

- `Image` メニューは `apps/aa-maker/src/components/TopMenu.vue:126` にある。
- モーダル類は `apps/aa-maker/src/App.vue:196` 以降のように `App.vue` 直下で開閉する。
- 編集グリッドは `apps/aa-maker/src/model/createDocument.ts:3` の 80 列、`apps/aa-maker/src/model/createDocument.ts:4` の 25 行を使う。
- セル構造は `apps/aa-maker/src/model/types.ts:3`、半角/全角セルは `apps/aa-maker/src/model/types.ts:9` と `apps/aa-maker/src/model/types.ts:17` に従う。
- 文字配置の基本処理は `apps/aa-maker/src/model/gridOperations.ts:42` の `placeChar` と同じ占有ルールを使う。
- Unicode の表示可能ページ情報は `apps/aa-maker/src/data/static/unicode-glyph-pages.json:1` を使う。
- 似た文字検索は `apps/aa-maker/src/search/similarGlyphSearch.ts:23` の `targetBitmap` と `apps/aa-maker/src/search/similarGlyphSearch.ts:209` の `present` ページ展開を参考にする。
- グリフ描画、fallback 除外、画像差分スコアは `apps/aa-maker/src/search/similarGlyphSearchWorker.ts:122` と `apps/aa-maker/src/search/similarGlyphSearchWorker.ts:294` を参考にする。

## 導線

`Image` メニューへ `Image to AA...` を追加する。

`Image to AA...` を選択すると `ImageToAsciiArtModal` を開く。
モーダル内で画像を読み込み、加工、プレビュー、マッチングを行い、`Apply` で編集グリッドへ全置換する。

## UI部位名

実装や仕様相談では、以下の部位名を使う。

| 部位名 | 表示文言 | 役割 | 状態 | 操作イベント |
| --- | --- | --- | --- | --- |
| `image-to-aa-menu-item` | `Image to AA...` | 画像AA生成モーダルを開く `Image` メニュー項目 | 通常 / 無効 | click: `open-image-to-aa-modal` |
| `image-to-aa-modal` | `Image to AA` | 画像読み込みから適用までを扱うモーダル本体。モーダル全体を画像ドロップ領域として扱う | 未ロード / drag-over / ロード済み / 変換中 / 適用可能 | drop, close-request |
| `image-load-button` | `Load Image` | クリックで画像ファイル選択を開くボタン | 通常 / 読み込み中 | click |
| `image-save-button` | `Save Image` | 現在の加工済み 640x400 画像を PNG 保存するボタン | 未ロード時は無効 | click |
| `image-source-file-input` | なし | `image-load-button` から起動する非表示ファイル入力 | 待機 | change |
| `image-work-area` | なし | 画像ステージと AA プレビューを並べる作業領域 | 画像ロード後に表示 | resize |
| `image-stage` | `640 x 400` | 読み込んだ画像、半角レイヤー、全角レイヤー、グリッドを重ねて確認する領域 | 通常 / ドラッグ中 | pointer-down, pointer-move, pointer-up, wheel, cmd+wheel(macOS), ctrl+wheel(Windows) |
| `image-stage-empty-message` | `DRAG IMAGE HERE` | 画像未ロード時に `image-stage` 中央へ大きく表示するドロップ誘導 | 画像未ロード時のみ表示 | なし |
| `image-grid-overlay` | なし | 80x25 の基準グリッド。10セルごとに太線を表示し、重なる全レイヤーの位置指標にする | 表示 / 非表示 | なし |
| `full-match-layer` | なし | 16x16 全角マッチング結果を表示する上位レイヤー | 未生成 / 生成中 / 生成済み | match-update |
| `half-match-layer` | なし | 8x16 半角マッチング結果を表示する下位レイヤー | 未生成 / 生成中 / 生成済み | match-update |
| `source-image-layer` | なし | スケール、回転、位置調整後の元画像レイヤー | 通常 | transform-update |
| `image-control-panel` | `Controls` | 画像加工とマッチングの入力群 | ロード済みで有効 | input |
| `scale-control` | `Scale` | 読み込んだ画像の拡大縮小。`1.0` を 100% とする unit value | スライダー / 数値入力 / ホイール連動 | input, wheel |
| `rotation-control` | `Rotation` | 読み込んだ画像の回転角度。macOS は Cmd+ホイール、Windows は Ctrl+ホイールで調整する | スライダー / 数値入力 / 修飾キー+ホイール連動 | input, cmd+wheel, ctrl+wheel |
| `position-x-control` | `X` | 読み込んだ画像の水平位置 | 数値入力 / ドラッグ連動 | input |
| `position-y-control` | `Y` | 読み込んだ画像の垂直位置 | 数値入力 / ドラッグ連動 | input |
| `monochrome-toggle` | `Monochrome` | 加工済み画像をモノクロ化する | on / off | change |
| `contrast-control` | `Contrast` | 加工済み画像のコントラスト調整 | 数値入力 / スライダー | input |
| `invert-toggle` | `Invert` | 加工済み画像の明暗を反転する | on / off | change |
| `grid-visibility-toggle` | `Grid` | footer 左側で `image-grid-overlay` の表示、非表示を切り替える | on / off | change |
| `edge-mode-control` | `Edge Mode` | エッジ検出の加工方式を選択する | Off / Sobel / Laplacian / Canny-like | change |
| `edge-apply-button` | `Apply Edge` | 現在の画像設定と Edge Mode パラメータで加工済みEdge画像を生成する | 画像未ロードまたは Off では無効 | click |
| `sobel-threshold-control` | `Sobel Threshold` | Sobel の採用しきい値 | `0..255` | input |
| `laplacian-threshold-control` | `Laplacian Threshold` | Laplacian の採用しきい値 | `0..255` | input |
| `canny-blur-control` | `Blur` | Canny-like の前処理ぼかし半径 | `0..8` | input |
| `canny-low-threshold-control` | `Low` | Canny-like の弱エッジしきい値 | `0..255` | input |
| `canny-high-threshold-control` | `High` | Canny-like の強エッジしきい値 | `0..255` | input |
| `full-width-matching-toggle` | `Full-width matching` | 半角パス後に全角 16x16 パスを実行するか切り替える | on / off | change |
| `matching-method-control` | `Matching Method` | 画像タイルと候補グリフの比較方式を選択する | Pixel / Pixelmatch / Chamfer / Edge Correlation / Template Matching / Contour Shape | change |
| `matching-method-params` | 方式別パラメータ | `matching-method-control` の選択肢ごとに比較パラメータを表示する | 選択方式に連動 | input |
| `matching-library-toast` | なし | 外部マッチングライブラリのロード結果を toast で通知する | success / error | toast |
| `difference-threshold-control` | `Difference Threshold` | 文字採用に使う差分しきい値を設定する | 数値入力 | input |
| `regenerate-button` | `Regenerate` | 現在の設定で AA マッチングを再実行する | 通常 / 変換中は無効 | click: `start-image-to-aa-match` |
| `match-progress` | `Matching...` | マッチング進捗を表示する | 非表示 / 進捗表示 / 完了 / エラー | progress |
| `cancel-button` | `Cancel` | モーダル内の読み込み、加工、生成結果を破棄する | 通常 | click: `request-cancel-image-to-aa` |
| `apply-button` | `Apply` | 生成 AA を編集グリッドへ全置換してモーダルを閉じる | 未生成時は無効 / 生成済みで有効 | click: `apply-image-to-aa` |
| `cancel-confirm-dialog` | `Discard image conversion?` | キャンセル時の破棄確認 | dirty 時のみ表示 | confirm, cancel |

## モーダル状態

| 状態名 | 条件 | 有効な操作 |
| --- | --- | --- |
| `empty` | 画像未ロード | ファイル選択、ドロップ、キャンセル |
| `loaded` | 画像ロード済み、AA未生成 | 画像調整、加工、再生成、キャンセル |
| `matching` | AAマッチング実行中 | 進捗確認、キャンセル要求 |
| `ready` | AA生成済み | 画像調整、再生成、適用、キャンセル |
| `error` | 読み込みまたは変換に失敗 | ファイル再選択、キャンセル |

## 画像入力

- 対応入力はブラウザが `HTMLImageElement` または `createImageBitmap` で読める画像ファイルとする。
- `image-to-aa-modal` 全体へのドロップに対応する。
- `image-load-button` のクリックでファイル選択に対応する。
- `matching` 状態では、画像更新につながる操作をすべて禁止する。対象は `Load Image`、`Save Image`、ドラッグ＆ドロップ、`image-stage` ドラッグ、ホイール、Transform、Processing、Edge 操作とする。
- 画像ロード後、元画像のアスペクト比を維持したまま `image-stage` 内に収まる初期スケールを設定する。
- 画像ロード後、加工済みプレビュー画像の背景明度を判定し、`image-grid-overlay` の線色を反対色へ自動更新する。
- `image-stage` の論理サイズは常に 640x400 px とする。
- `image-stage` の表示比率も常に 640:400 を維持し、親レイアウトの高さに合わせて縦方向へ stretch しない。
- `image-stage` 上のドラッグで画像位置を調整する。
- `image-stage` 上の通常ホイールでスケールを調整する。
- `image-stage` 上の macOS `Cmd + Wheel`、Windows `Ctrl + Wheel` でローテーションを調整する。
- `scale-control` は `1.0` を 100% とする単位なし数値で扱う。
- 表示倍率は UI の都合で変えてよいが、変換処理は 640x400 の加工済みビットマップを入力にする。

## 画像加工

加工処理は以下の順に行う。

1. 元画像を `image-stage` へ描画する。
2. `scale-control`、`rotation-control`、`position-x-control`、`position-y-control` を反映する。
3. 640x400 の RGBA ピクセルを取得する。
4. `monochrome-toggle` が on の場合、輝度 `0.2126 * R + 0.7152 * G + 0.0722 * B` でモノクロ化する。
5. `contrast-control` を適用する。
6. `invert-toggle` が on の場合は輝度を反転する。
7. `edge-apply-button` が押された場合、選択中の `edge-mode-control` と各Edgeパラメータで加工済み画像を置き換える。

`edge-mode-control` は画像加工方式の選択であり、別の変換モードではない。
`Sobel` / `Canny-like` / `Laplacian` のいずれを選んだ場合も、後続の AA マッチング手順は通常と同じにする。
`scale-control`、`rotation-control`、`position-x-control`、`position-y-control`、`monochrome-toggle`、`contrast-control`、`invert-toggle`、画像再ロード、Edgeパラメータ変更のいずれかが発生した場合、適用済みEdge画像は破棄する。
`invert-toggle` の変更時は、加工済みプレビュー画像の背景明度を再判定し、`image-grid-overlay` の線色を反対色へ自動更新する。
`scale-control`、`rotation-control`、`position-x-control`、`position-y-control` の変更で既存のAA結果を破棄する必要がある場合は、破棄確認を先に表示する。
画像更新前の確認と、文字配置破棄、Edge破棄は個別ハンドラへ分散させず、画像更新要求の一元入口で集中処理する。

## Edge Mode パラメータ

| Mode | Parameters | 初期値 |
| --- | --- | --- |
| `Sobel` | `sobel-threshold-control` | `48` |
| `Laplacian` | `laplacian-threshold-control` | `32` |
| `Canny-like` | `canny-blur-control`, `canny-low-threshold-control`, `canny-high-threshold-control` | `1`, `32`, `96` |

## 変換対象サイズ

| 対象 | サイズ |
| --- | --- |
| 加工済み画像 | 640x400 px |
| 編集グリッド | 80x25 セル |
| 半角マッチング単位 | 8x16 px |
| 全角マッチング単位 | 16x16 px |
| `image-grid-overlay` | 80x25、10セルごとに太線 |

## マッチング候補

- 候補文字は Unicode 全範囲を対象にする。
- 実装上は `unicode-glyph-pages.json` の `present: true` ページのみを走査対象にする。
- 走査対象ページ内では、制御文字、サロゲート、非文字コードポイントを除外する。
- Canvas 描画で `.notdef` fallback と判定される文字は候補から除外する。
- 半角パスでは、実描画幅または現在の幅モードで `width: 1` と判定される文字だけを使う。
- 全角パスでは、実描画幅または現在の幅モードで `width: 2` と判定される文字だけを使う。

候補グリフは、変換中に毎セルで再描画しない。
初期実装では Worker 内でグリフビットマップをキャッシュし、同一フォント、同一サイズ、同一幅モードの再利用を前提にする。

## スコア

仕様上のスコアは、既存の似た文字検索に合わせて差分値を表す `differenceScore` とする。

- `differenceScore` は 0.0 から 100.0 の値とする。
- 0.0 に近いほど加工済み画像タイルと候補グリフが近い。
- `difference-threshold-control` より大きい候補は採用しない。
- 初期値は既存の似た文字検索を想定し、`18` とする。

`matching-method-control` で `differenceScore` の算出方式を切り替えられる。

| 方式 | ライブラリ | 概要 |
| --- | --- | --- |
| `Pixel` | built-in | 現行方式。ピクセル alpha / luminance の絶対差を使う。 |
| `Pixelmatch` | `pixelmatch` | Pixelmatch の知覚差分を使う。 |
| `Chamfer` | `OpenCV.js` | OpenCV.js を遅延ロードし、`distanceTransform` で線の近さを評価する。 |
| `Edge Correlation` | `OpenCV.js` | OpenCV.js を遅延ロードし、Sobel / Laplacian 系 API 可用性を確認してエッジ方向の近さを評価する。 |
| `Template Matching` | `OpenCV.js` | OpenCV.js を遅延ロードし、template matching API 可用性を確認して相関を評価する。 |
| `Contour Shape` | `OpenCV.js` | OpenCV.js を遅延ロードし、contour / shape API 可用性を確認して形状特徴を評価する。 |

外部ライブラリは初期表示時には読み込まない。
`matching-method-control` で外部方式を選択した時点で preload し、実際のマッチングWorker内でも未ロードなら再度 `ensure` する。
preload は非ブロッキングで行い、`regenerate-button` は preload 中でも押せるようにする。

## 半角 8x16 パス

半角 8x16 パスは常に実行する。
`full-width-matching-toggle` が off の場合は、この半角結果を完成結果として扱う。
全角だけで完成するモードは持たない。

1. 加工済み画像を 8x16 px 単位で 80x25 に分割する。
2. 各タイルに対して、半角候補文字の 8x16 グリフビットマップを比較する。
3. 最も `differenceScore` が低い候補を選ぶ。
4. `differenceScore <= differenceThreshold` の場合、その半角文字を `half-match-layer` に仮配置する。
5. しきい値を超える場合、そのセルは `EmptyCell` とする。
6. 各セルには、採用文字と `differenceScore` を保持する。

半角パスの結果は `half-match-layer` に即時反映できる。
この段階のプレビューは、加工済み画像の上に 80x25 の AA を重ねて表示する。
`half-match-layer` は常に最背面の候補レイヤーとして扱い、全角候補に覆われない箇所の fallback 表示を担う。

## 全角 16x16 パス

`full-width-matching-toggle` が on の場合だけ、半角 8x16 パスの後に実行する。
off の場合は `full-match-layer` を生成せず、`half-match-layer` だけをプレビューと適用結果に使う。

1. 加工済み画像を 16x16 px の窓で走査する。
2. X 方向は半角 1 セルずつ進める。つまり `x=0..78` の半角ステップで評価する。
3. Y 方向は 1 行ずつ進める。つまり `y=0..24` を評価する。
4. 各 16x16 窓に対して、全角候補文字の 16x16 グリフビットマップを比較する。
5. 最も `differenceScore` が低い全角候補を選ぶ。
6. 対象位置に既存の半角仮配置がある場合、左セルと右セルの半角 `differenceScore` 平均を `halfAverageDifference` とする。
7. `differenceScore <= differenceThreshold` かつ `differenceScore < halfAverageDifference` の場合だけ、全角文字を採用候補にする。
8. 採用候補は `full-match-layer` に配置する。
9. 採用済みの全角文字と重ならない場合は、左セルを `CharCell(width: 2)`、右セルを `WideTailCell` として配置する。
10. 採用済みの全角文字と 1 セルずれて重なる場合は、既存全角候補の `differenceScore` と新しい全角候補の `differenceScore` を比較する。
11. 既存全角候補の `differenceScore` が低い場合は、既存全角候補を残し、新しい候補は破棄する。
12. 新しい全角候補の `differenceScore` が低い場合は、既存全角候補を `full-match-layer` から削除し、新しい候補を配置する。

半角仮配置が片側だけ存在する場合、存在しない側の半角 `differenceScore` は 100.0 として `halfAverageDifference` を計算する。
全角候補の削除で `full-match-layer` に空きができても、`half-match-layer` の半角候補が下から見えるため、左側 8x16 分を復元する追加処理は行わない。
全角候補は `halfAverageDifference - differenceScore` が大きい順に採用を試みる。
同点の場合は左上に近い候補を先に扱い、採用済みの全角候補と同点で重なる場合は先に採用済みの候補を残す。

## 生成レイヤー構成

AA 生成結果は、編集用の通常レイヤーとは別に、モーダル内の一時レイヤーとして保持する。

| レイヤー名 | 役割 | 表示順 |
| --- | --- | --- |
| `image-grid-overlay` | 80x25 の基準グリッド | 最前面 |
| `full-match-layer` | 16x16 全角マッチング結果 | 上 |
| `half-match-layer` | 8x16 半角マッチング結果 | 下 |
| `source-image-layer` | 変換対象画像 | 最背面 |

`full-match-layer` の `EmptyCell` は透過し、下の `half-match-layer` を表示する。
`image-grid-overlay` は位置指標として常に最前面に表示し、適用データには含めない。
`grid-visibility-toggle` が off の場合、`image-grid-overlay` は非表示にする。
`full-width-matching-toggle` が off の場合、`full-match-layer` は生成、表示、適用しない。
`full-width-matching-toggle` が on の場合、最終プレビューと適用時の生成結果は `full-match-layer` と `half-match-layer` を合成した 80x25 セルとして扱う。
off の場合は、`half-match-layer` だけを 80x25 セルとして扱う。

## プレビュー

- `source-image-layer` を下地として表示する。
- `full-width-matching-toggle` が on の場合は、`half-match-layer` の上に `full-match-layer` を重ねて表示する。
- `full-width-matching-toggle` が off の場合は、`half-match-layer` だけを表示する。
- `grid-visibility-toggle` が on の場合は、`image-grid-overlay` を最前面に表示し、画像、半角、全角すべての位置指標にする。
- `image-grid-overlay` の線色は、現在表示中の加工済みプレビュー画像の背景明度に応じて白系または黒系へ自動切替する。
- AA 文字は編集グリッドと同じフォント、同じ幅判定、同じ 80x25 セル配置で表示する。
- 生成結果の文字色は `FGDC` 相当、背景色はなしとして表示する。
- `edge-mode-control` や `invert-toggle` などの画像加工を変更した場合、既存の AA 生成結果は stale として扱い、`Regenerate` を促す。

## 適用

`apply-button` を押すと、生成済み AA を編集グリッドへ全置換する。

- 既存の全レイヤー内容は破棄する。
- `half-match-layer` と `full-match-layer` を合成した生成結果を持つ単一レイヤーを作成し、そのレイヤーをアクティブにする。
- `Document.canvasBGC` は維持する。
- 生成文字の `fgc` は適用時点の `FGDC` 相当とする。
- 生成文字の `bgc` は `null` とする。
- 未採用セルは `EmptyCell` とする。
- 適用操作は編集履歴に 1 操作として記録する。
- 適用後は `image-to-aa-modal` を閉じる。

## キャンセル

`cancel-button` またはモーダル close 要求では、モーダル内の画像、加工設定、マッチング結果を破棄する。

- モーダル外をタップしても閉じない。
- 画像ロード前は確認なしで閉じる。
- 画像ロード後、設定変更後、または AA 生成後は `cancel-confirm-dialog` を表示する。
- 破棄を確定した場合、編集グリッドには何も反映せずに閉じる。
- 破棄を取り消した場合、モーダルへ戻る。

## 初期値

| 項目 | 初期値 |
| --- | --- |
| `scale-control` | 画像全体が 640x400 に収まる unit value。640x400 等倍は `1.0` |
| `rotation-control` | `0deg` |
| `position-x-control` | 中央揃え |
| `position-y-control` | 中央揃え |
| `monochrome-toggle` | on |
| `contrast-control` | `100%` |
| `invert-toggle` | off |
| `grid-visibility-toggle` | on |
| `edge-mode-control` | `Off` |
| `sobel-threshold-control` | `48` |
| `laplacian-threshold-control` | `32` |
| `canny-blur-control` | `1` |
| `canny-low-threshold-control` | `32` |
| `canny-high-threshold-control` | `96` |
| `full-width-matching-toggle` | on |
| `matching-method-control` | `Pixel` |
| `difference-threshold-control` | `18` |

## 未確定事項

- `Canny-like` の最終品質調整。
- 変換中グリッドのボーダー色と進捗表示の詳細。
- IndexedDB に永続化する候補グリフキャッシュのキー設計と破棄条件。
