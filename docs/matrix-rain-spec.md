# Matrix Rain 仕様

## 目的

Matrix Rain は、黒い画面上へ半角カタカナの縦列を多数表示し、上から下へ文字が出現する映像表現を提供する独立 runtime です。

`terminal` や `neon-drive` の描画責務とは分離し、Matrix Rain 固有の文字生成、寿命管理、発光、ストリーム合成、CRT パラメータを `matrix-rain.js` に閉じます。

## 実装ファイル

- runtime 本体: `apps/site/src/matrix-rain.js`
- runtime の生成と切り替え: `apps/site/src/main.js`
- Canvas の GPU 転送: `apps/site/src/webgl-framebuffer-canvas.js`

## Runtime

Matrix Rain は `terminal`、`neon-drive` と同列の runtime として動作します。

`main.js` の `MatrixRainRuntime` は以下を担当します。

- `MatrixRain.render()` の呼び出し
- 描画済み Canvas の `lowCanvas` への転送
- Matrix Rain 固有の CRT パラメータ適用
- 終了要求を runtime system の `popRuntime()` へ通知

描画ロジックや文字状態は `main.js` に持たせません。

## 起動

開発環境では URL パラメータで直接起動できます。

```text
/?boot=matrix-rain
/?boot=matrix-rain&test=1
```

- `boot=matrix-rain` は Matrix Rain runtime を起動します。
- `test=1` は CRT シェーダーを通さず、低解像度 Canvas を直接表示します。
- production build では `boot` の指定を無視し、必ず `terminal` から起動します。

## 終了

以下のキーで Matrix Rain runtime を終了します。

- `Escape`
- `Q`
- `q`

終了時は `popRuntime()` により呼び出し元 runtime へ戻ります。
呼び出し元が存在しない場合は runtime system の fallback により `terminal` へ戻ります。

終了メッセージは以下です。

```text
MATRIX RAIN TERMINATED
```

## 画面

- 背景は完全な黒 `#000000` とします。
- 画面全体へ複数の文字ストリームをランダム配置します。
- ストリーム数は画面幅から算出し、32 本以上 50 本以下とします。
- 各ストリームの横位置と開始 Y 座標はランダムに決定します。

現行実装の配置範囲:

- X: 画面幅の 2% から 98%
- Y: 画面高さの 12% から 88%

## 文字セット

使用文字は半角カタカナのみです。

```text
ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜｦﾝｧｨｩｪｫｬｭｮｯ
```

以下は含めません。

- 全角カタカナ
- 濁点
- 半濁点
- 中黒
- 長音記号
- 英字
- 数字
- 漢字

## ストリーム

1 本の文字列は `RainStream` が管理します。

各ストリームは専用の透過オフスクリーン Canvas を持ちます。
文字を直接メイン Canvas へ配置せず、最初にストリーム Canvas へ描画し、その Canvas 全体をメイン画面へ合成します。

各ストリームが保持する主な状態:

- ストリーム Canvas と 2D context
- 画面上の基準 X 座標
- 画面上の基準 Y 座標（中心）
- 透明余白 `viewPadding`
- 文字間隔
- 文字生成間隔
- 次に使用する文字スロット
- 表示中の文字一覧

## 文字配置

- 1 ストリームは最大 25 文字です。
- 文字はスロット `0` から `24` へ向かって、上から下の順に追加します。
- 各スロットの Y 座標はストリーム Canvas 内で固定です。
- 一度エントリーした文字は、寿命中にスロットの Y 座標を移動しません。
- 雨の流れは、既存文字を移動するのではなく、下方向の次スロットへ新しい文字を追加することで表現します。
- 文字間隔はストリーム生成時にランダムで決定し、そのストリームの寿命中は固定します。

文字生成間隔の現行値:

```text
0.055 秒から 0.11 秒
```

## 文字の寿命

- 各文字は個別の生成時刻を持ちます。
- 生成から 3 秒後に完全に透明になり、ストリームから削除します。
- 不透明度は時間経過に合わせて減衰します。
- 最大 25 スロットを生成し終わり、全ての文字が寿命を終えたらストリームを再生成します。

ストリーム再生成時は、位置、文字間隔、生成間隔、文字列を再度ランダムに決定します。

## 発光

文字は緑色の通常表示と、生成直後の白い強調表示で構成します。

通常文字:

- 主色: `#43ff35`
- 芯の色: `#98ff7d`
- 発光色: `#21ff16`

生成直後の文字:

- 主色: `#f4fff0`
- 発光色: `#aaff9a`
- 白い強調は生成後約 0.22 秒で消えます。

白い強調表現は `terminal` の実装を共有せず、Matrix Rain 内で独立して描画します。

## Glyph キャッシュ

文字ごとのフォント描画と shadow blur を毎フレーム繰り返さないため、`GlyphSpriteCache` を使用します。

キャッシュキー:

```text
tone:font-size:character
```

- `tone` は `green` または `white` です。
- フォントサイズは 4px 単位へ量子化します。
- 最大 768 エントリーまで保持します。
- 上限に達した場合はキャッシュ全体を破棄して再構築します。

## ストリーム Canvas の合成

各ストリーム Canvas は、中央を原点としてメイン画面へ合成します。
拡大率は `接近拡大` の状態に従って時間変化します。

合成原点:

- 水平方向: ストリーム Canvas の中央
- 垂直方向: ストリーム Canvas の中央

合成式:

```text
scale = getScale()
drawWidth = viewCanvas.width * scale
drawHeight = viewCanvas.height * scale
drawX = centerX - drawWidth / 2
drawY = centerY - drawHeight / 2
```

`viewPadding` はストリーム Canvas の透明余白です。内部レイアウト用の余白として保持します。

## 接近拡大

状態: 実装済み。

合意済み要件:

- ストリーム内の文字を個別に拡大しません。
- ストリームは `x` / `y` / `z` の座標を持ちます。
- `z` は時間経過で手前へ近づきます。
- `z` は開始値から固定オフセットだけ小さくなります。
- 投影の中心は画面中央です。
- `x` / `y` は `z` に応じて投影位置が変化します。
- 投影倍率は `z` に対する単純な逆比率です。
- ストリーム Canvas 内の文字スロット Y 座標は拡大中も変更しません。

この要件では、ストリーム Canvas 内のレイアウトは固定したまま、画面中央基準で `x` / `y` とサイズをまとめて投影します。画面への拡大感は `STREAM_PROJECTION_FOCAL_LENGTH / z` で決まります。

## 調整用定数

実装では、表示サイズと拡大感を調整しやすいように以下の定数を切り出します。

- `STREAM_FONT_SIZE`: 文字の基準フォントサイズ
- `STREAM_CELL_STEP`: 文字間隔の固定値。旧レンジの中間値を採用します。
- `STREAM_Z_START_MIN` / `STREAM_Z_START_MAX`: エントリー時の奥行きレンジ
- `STREAM_Z_OFFSET`: 開始奥行きから差し引く量
- `STREAM_PROJECTION_FOCAL_LENGTH`: `z` を画面倍率へ変換する係数
- `STREAM_APPROACH_DURATION`: 奥行きが手前へ到達するまでの時間。大きいほど近づくのはゆっくりになります。

現行値は以下です。

| 定数 | 値 |
| --- | ---: |
| `STREAM_FONT_SIZE` | `18` |
| `STREAM_CELL_STEP` | `18.45` |
| `STREAM_Z_START_MIN` | `2.4` |
| `STREAM_Z_START_MAX` | `5.0` |
| `STREAM_Z_OFFSET` | `1.1` |
| `STREAM_PROJECTION_FOCAL_LENGTH` | `3.0` |
| `STREAM_APPROACH_DURATION` | `3` |

## CRT パラメータ

Matrix Rain は独自の固定 CRT パラメータを持ちます。

| Parameter | Value |
| --- | ---: |
| `curve` | `0.14` |
| `bleed` | `0.24` |
| `sync` | `0` |
| `burst` | `0` |
| `bloomThreshold` | `0.04` |
| `bloomSoftness` | `0.18` |
| `bloomRadius` | `2.2` |
| `bloomPasses` | `2` |
| `bloomIntensity` | `1.8` |
| `vsyncOffset` | `0` |
| `vsyncSnap` | `0` |
| `vsyncSnapStretch` | `0.05` |
| `vsyncSnapBrightness` | `0.08` |

Matrix Rain は CRT ダメージ振幅を生成しません。
動的に変化させる必要がある場合は Matrix Rain runtime が `retro-tube` の公開パラメータを直接更新します。

## 描画フロー

1. `main.js` が `MatrixRain.render()` を呼びます。
2. 各 `RainStream` が文字生成、寿命更新、再生成を行います。
3. 各ストリームを専用 Canvas へ描画します。
4. ストリーム Canvas をメインの scene Canvas へ合成します。
5. scene Canvas を `WebGlFramebufferCanvas.putCanvas()` へ渡します。
6. `lowCanvas.present()` で表示します。
7. test mode でなければ `retro-tube` が CRT エフェクトを適用します。

## 性能要件

- 毎フレーム `getImageData()` で全画面ピクセルを CPU へ読み戻しません。
- scene Canvas は `putCanvas()` で WebGL texture へ直接転送します。
- 文字の発光画像は `GlyphSpriteCache` で再利用します。
- フォント設定、shadow blur、文字描画を表示文字ごとに毎フレーム再生成しません。
- 1 ストリームの文字数は最大 25 文字に制限します。
- ストリーム数は最大 50 本に制限します。

理論上の最大表示管理数:

```text
50 streams * 25 glyphs = 1250 glyphs
```

実際の表示数は各文字の 3 秒寿命と生成間隔により変動します。

## Canvas 転送

`WebGlFramebufferCanvas.putCanvas()` は source Canvas を WebGL texture へ直接アップロードします。

- `UNPACK_FLIP_Y_WEBGL` は `false` とします。
- Canvas の上方向を表示画面の上方向として維持します。
- Matrix Rain の文字列が上下反転しないことを保証します。

## 入力

Matrix Rain はゲーム操作を持ちません。

- キーボード: `Escape` / `Q` で終了
- マウスクリック: 処理なし
- マウス移動: 処理なし
- ホイール: 処理なし
- ペースト: 処理なし

## 主要定数

| Constant | Value | Meaning |
| --- | ---: | --- |
| `GLYPH_LIFETIME` | `3` | 文字の寿命（秒） |
| `STREAM_COUNT_MIN` | `32` | 最小ストリーム数 |
| `STREAM_COUNT_MAX` | `50` | 最大ストリーム数 |
| `MAX_GLYPHS_PER_STREAM` | `25` | 1 ストリームの最大文字数 |
| `STREAM_FONT_SIZE` | `18` | ストリーム Canvas 内の基準フォントサイズ |
| `STREAM_CELL_STEP` | `18.45` | 文字間隔の固定値 |
| `STREAM_Z_START_MIN` | `2.4` | エントリー時の奥行き下限 |
| `STREAM_Z_START_MAX` | `5.0` | エントリー時の奥行き上限 |
| `STREAM_Z_OFFSET` | `1.1` | 開始奥行きから差し引く量 |
| `STREAM_PROJECTION_FOCAL_LENGTH` | `3.0` | `z` を画面倍率へ変換する係数 |
| `STREAM_APPROACH_DURATION` | `3` | 奥行きが手前へ到達するまでの時間 |
| `GLYPH_CACHE_LIMIT` | `768` | Glyph キャッシュ上限 |

## 変更時の確認項目

- 文字が半角カタカナのみであること
- 文字がスロット順に上から下へ追加されること
- エントリー済み文字のストリーム Canvas 内 Y 座標が変化しないこと
- 1 ストリームが 25 文字を超えないこと
- 各文字が生成から 3 秒で削除され、奥行きは 3 秒かけて手前へ進むこと
- `z` の終端値が開始値から固定オフセットだけ減ること
- ストリーム Canvas の投影で縦横比が変化しないこと
- 投影中心が中央であること
- `z` の変化に応じて `x` / `y` の投影位置も変化すること
- Canvas 転送で上下反転しないこと
- `Escape` / `Q` で呼び出し元 runtime へ戻ること
- `?boot=matrix-rain&test=1` で直接起動できること
- 全画面の `getImageData()` 読み戻しを再導入していないこと
