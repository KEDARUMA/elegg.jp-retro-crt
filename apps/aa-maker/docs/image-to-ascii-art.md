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
| `image-to-aa-modal` | `Image to AA` | 画像読み込みから適用までを扱うモーダル本体 | 未ロード / ロード済み / 変換中 / 適用可能 | close-request |
| `image-source-loader` | `Drop image or click to load` | 画像ファイルのドロップまたはクリック選択領域 | 空 / drag-over / 読み込み中 / エラー | drop, click, file-change |
| `image-source-file-input` | なし | `image-source-loader` から起動する非表示ファイル入力 | 待機 | change |
| `image-work-area` | なし | 画像ステージと AA プレビューを並べる作業領域 | 画像ロード後に表示 | resize |
| `image-transform-stage` | `Source` | 読み込んだ画像を 640x400 の変換枠内で確認、移動する領域 | 通常 / ドラッグ中 | pointer-down, pointer-move, pointer-up |
| `image-target-frame` | `640 x 400` | 変換対象の固定フレーム。80x25 グリッドに対応する | 常時固定 | なし |
| `source-image-layer` | なし | スケール、回転、位置調整後の元画像レイヤー | 通常 | transform-update |
| `processed-image-layer` | なし | モノクロ化、コントラスト、反転、エッジ処理後の画像レイヤー | 通常 | processing-update |
| `ascii-overlay-layer` | なし | 加工済み画像の上に重ねる AA プレビュー | 未生成 / 生成中 / 生成済み | match-update |
| `image-control-panel` | `Controls` | 画像加工とマッチングの入力群 | ロード済みで有効 | input |
| `scale-control` | `Scale` | 読み込んだ画像の拡大縮小 | 数値入力 / スライダー | input |
| `rotation-control` | `Rotation` | 読み込んだ画像の回転角度 | 数値入力 / スライダー | input |
| `position-x-control` | `X` | 読み込んだ画像の水平位置 | 数値入力 / ドラッグ連動 | input |
| `position-y-control` | `Y` | 読み込んだ画像の垂直位置 | 数値入力 / ドラッグ連動 | input |
| `contrast-control` | `Contrast` | モノクロ画像のコントラスト調整 | 数値入力 / スライダー | input |
| `invert-toggle` | `Invert` | 加工済み画像の明暗を反転する | on / off | change |
| `edge-toggle` | `Edges only` | エッジ検出結果だけを加工済み画像として使う | on / off | change |
| `match-threshold-control` | `Match Threshold` | 文字採用に必要な一致度しきい値を設定する | 数値入力 / スライダー | input |
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
- `image-source-loader` へのドロップとクリック選択に対応する。
- 画像ロード後、元画像のアスペクト比を維持したまま `image-target-frame` 内に収まる初期スケールを設定する。
- `image-target-frame` の論理サイズは常に 640x400 px とする。
- 表示倍率は UI の都合で変えてよいが、変換処理は 640x400 の加工済みビットマップを入力にする。

## 画像加工

加工処理は以下の順に行う。

1. 元画像を `image-target-frame` へ描画する。
2. `scale-control`、`rotation-control`、`position-x-control`、`position-y-control` を反映する。
3. 640x400 の RGBA ピクセルを取得する。
4. 輝度 `0.2126 * R + 0.7152 * G + 0.0722 * B` でモノクロ化する。
5. `contrast-control` を適用する。
6. `invert-toggle` が on の場合は輝度を反転する。
7. `edge-toggle` が on の場合は、Sobel などのエッジ検出結果で加工済み画像を置き換える。

`edge-toggle` はエッジ検出の加工スイッチであり、別の変換モードではない。
on の場合も、後続の AA マッチング手順は通常と同じにする。

## 変換対象サイズ

| 対象 | サイズ |
| --- | --- |
| 加工済み画像 | 640x400 px |
| 編集グリッド | 80x25 セル |
| 半角マッチング単位 | 8x16 px |
| 全角マッチング単位 | 16x16 px |

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

仕様上のスコアは、一致度を表す `matchScore` とする。

- `matchScore` は 0.0 から 1.0 の値とする。
- 1.0 に近いほど加工済み画像タイルと候補グリフが近い。
- `match-threshold-control` 未満の候補は採用しない。
- 既存の似た文字検索で使う差分値を再利用する場合は、`matchScore = 1 - differenceScore / 100` に変換して比較する。

## 半角 8x16 パス

1. 加工済み画像を 8x16 px 単位で 80x25 に分割する。
2. 各タイルに対して、半角候補文字の 8x16 グリフビットマップを比較する。
3. 最も `matchScore` が高い候補を選ぶ。
4. `matchScore >= matchThreshold` の場合、その半角文字を `half-match-layer` に仮配置する。
5. しきい値未満の場合、そのセルは `EmptyCell` とする。
6. 各セルには、採用文字と `matchScore` を保持する。

半角パスの結果は `ascii-overlay-layer` に即時反映できる。
この段階のプレビューは、加工済み画像の上に 80x25 の AA を重ねて表示する。
`half-match-layer` は常に最背面の候補レイヤーとして扱い、全角候補に覆われない箇所の fallback 表示を担う。

## 全角 16x16 パス

1. 加工済み画像を 16x16 px の窓で走査する。
2. X 方向は半角 1 セルずつ進める。つまり `x=0..78` の半角ステップで評価する。
3. Y 方向は 1 行ずつ進める。つまり `y=0..24` を評価する。
4. 各 16x16 窓に対して、全角候補文字の 16x16 グリフビットマップを比較する。
5. 最も `matchScore` が高い全角候補を選ぶ。
6. 対象位置に既存の半角仮配置がある場合、左セルと右セルの半角 `matchScore` 平均を `halfAverageScore` とする。
7. `matchScore >= matchThreshold` かつ `matchScore > halfAverageScore` の場合だけ、全角文字を採用する。
8. 採用候補は `full-match-layer` に配置する。
9. 採用済みの全角文字と重ならない場合は、左セルを `CharCell(width: 2)`、右セルを `WideTailCell` として配置する。
10. 採用済みの全角文字と 1 セルずれて重なる場合は、既存全角候補の `matchScore` と新しい全角候補の `matchScore` を比較する。
11. 既存全角候補の `matchScore` が高い場合は、既存全角候補を残し、新しい候補は破棄する。
12. 新しい全角候補の `matchScore` が高い場合は、既存全角候補を `full-match-layer` から削除し、新しい候補を配置する。

半角仮配置が片側だけ存在する場合、存在しない側の半角 `matchScore` は 0.0 として `halfAverageScore` を計算する。
全角候補の削除で `full-match-layer` に空きができても、`half-match-layer` の半角候補が下から見えるため、左側 8x16 分を復元する追加処理は行わない。
初期実装では左上から右下へ決定的に走査し、同点の場合は先に採用済みの全角候補を残す。

## 生成レイヤー構成

AA 生成結果は、編集用の通常レイヤーとは別に、モーダル内の一時レイヤーとして保持する。

| レイヤー名 | 役割 | 合成順 |
| --- | --- | --- |
| `half-match-layer` | 8x16 半角マッチング結果 | 下 |
| `full-match-layer` | 16x16 全角マッチング結果 | 上 |

`full-match-layer` の `EmptyCell` は透過し、下の `half-match-layer` を表示する。
最終プレビューと適用時の生成結果は、この 2 レイヤーを合成した 80x25 セルとして扱う。

## プレビュー

- `processed-image-layer` を下地として表示する。
- `ascii-overlay-layer` は、`half-match-layer` の上に `full-match-layer` を重ねた合成結果を表示する。
- AA 文字は編集グリッドと同じフォント、同じ幅判定、同じ 80x25 セル配置で表示する。
- 生成結果の文字色は `FGDC` 相当、背景色はなしとして表示する。
- `edge-toggle` や `invert-toggle` などの画像加工を変更した場合、既存の AA 生成結果は stale として扱い、`Regenerate` を促す。

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

- 画像ロード前は確認なしで閉じる。
- 画像ロード後、設定変更後、または AA 生成後は `cancel-confirm-dialog` を表示する。
- 破棄を確定した場合、編集グリッドには何も反映せずに閉じる。
- 破棄を取り消した場合、モーダルへ戻る。

## 初期値

| 項目 | 初期値 |
| --- | --- |
| `scale-control` | 画像全体が 640x400 に収まる値 |
| `rotation-control` | `0deg` |
| `position-x-control` | 中央揃え |
| `position-y-control` | 中央揃え |
| `contrast-control` | `100%` |
| `invert-toggle` | off |
| `edge-toggle` | off |
| `match-threshold-control` | `0.70` |

## 未確定事項

- エッジ検出の最終アルゴリズムを Sobel 固定にするか。
- 全角 16x16 パスで、左上から順に確定するか、改善幅が大きい候補順に確定するか。
- `match-threshold-control` の初期値と UI 上の刻み幅。
- 変換中の Worker 数と進捗表示の粒度。
- 候補グリフキャッシュをメモリ上だけに持つか、IndexedDB などに永続化するか。
