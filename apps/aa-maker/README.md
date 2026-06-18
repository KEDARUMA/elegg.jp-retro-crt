# AA Maker

<p align="center">
  <img src="./docs/assets/aa-maker-logo-horizontal.png" alt="AA Maker logo" width="420">
</p>

<p align="center">
  <img alt="app" src="https://img.shields.io/badge/app-AA--Maker-blue">
  <img alt="Vue" src="https://img.shields.io/badge/Vue-3.5-42b883">
  <img alt="Vite" src="https://img.shields.io/badge/Vite-powered-646cff">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-ready-3178c6">
  <img alt="pnpm" src="https://img.shields.io/badge/pnpm-10.24-f69220">
  <img alt="grid" src="https://img.shields.io/badge/grid-80x25-555">
  <img alt="Image to AA" src="https://img.shields.io/badge/Image%20to%20AA-supported-16a34a">
  <img alt="license" src="https://img.shields.io/badge/license-non--commercial-lightgrey">
</p>

AA Maker は、ブラウザ上で初期80x25の可変グリッドに文字を配置してアスキーアートを編集するアプリです。

半角・全角の表示幅を考慮した編集、レイヤー、文字色/背景色、パレット、スタンプ、保存/読み込み/エクスポート、画像から AA 生成を扱います。

## アプリ全景

![AA Maker app overview](./docs/assets/aa-maker-app-overview.png)

## 特筆すべき機能

- Unicode の全ての文字を使って創作できる
- Unicode の全文字ビューアとして使える
- 文字や画像を Unicode の全文字から検索できる
- 画像から AA を生成する `Image to AA` を使える

## Image to AA

![Image to AA modal](./docs/assets/aa-maker-image-to-aa.png)

画像を読み込み、加工して、文字マッチングで 80x25 の AA に変換します。

### Edge 化メソッド

- `Sobel`
- `Laplacian`
- `Canny-like` ← オススメ

### 文字マッチングメソッド

- `Pixel`
- `Pixelmatch`
- `Chamfer` ← オススメ
- `Edge Correlation`
- `Template Matching`
- `Contour Shape`

## できること

- 初期80x25、最大256x256の可変グリッド編集
- 半角 / 全角の幅判定を考慮した文字配置
- レイヤー編集
- ペン、消しゴム、テキスト、スポイト、スタンプ
- 文字色 / 背景色の変更
- 保存、読み込み、ライブラリ操作、エクスポート
- `Image to AA` で画像から AA 生成

## 起動方法

リポジトリルートから実行します。

```sh
pnpm install
pnpm dev:aa-maker
```

開発サーバーは `http://127.0.0.1:5174` で固定起動します。ポート使用中は別ポートへ切り替えず起動エラーになります。

よく使うコマンド:

```sh
pnpm build:aa-maker
pnpm preview:aa-maker
```

## 画面構成

- 上部メニュー: `File` / `Image` / `Dev`
- 左側ツールボックス: 選択、スポイト、ペン、消しゴム、テキスト、スタンプ
- 中央編集領域: 初期80x25の可変編集グリッド
- 右側サイドバー: 情報、キャラパレット、レイヤーなど
- `Image to AA` モーダル: 画像ロード、加工、マッチング、適用

## 注意事項

- 固定幅フォント前提のため、`2 / 4ちゃんねる` で見かける AA の見え方をそのまま再現する用途には向きません。
- Unicode の見え方はフォントやブラウザの描画差に影響されます。

## 参照ドキュメント

- [仕様書](./docs/spec.md)
- [データモデル](./docs/data-model.md)
- [画像からAA生成 仕様書](./docs/image-to-ascii-art.md)
