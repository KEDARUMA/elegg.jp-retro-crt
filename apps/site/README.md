<p align="right">
  <a href="./README.md">日本語</a> | <a href="./README.en.md">English</a>
</p>

# Retro Tube

Retro Tube は、ブラウザ上に古いCRTディスプレイと仮想ターミナルを再現するWebアプリです。

文字セルベースのターミナル、実ファイルから構築する仮想ファイルシステム、独自ドキュメント形式のMDS、CRTシェーダー、Matrix Rain、Neon Driveを1つのランタイムシステム上で動かします。

## 主な機能

- 80列の仮想ターミナル
- 8x16セルを基準にした半角・全角文字表示
- CRTの湾曲、走査線、発光、同期ずれなどの映像表現
- `public/root`から構築する読み取り専用の仮想ファイルシステム
- MDSによる色付きテキスト、リンク、画像、include表示
- Matrix Rainランタイム
- Neon Driveランタイム
- モバイルブラウザ向け表示調整

## 起動方法

リポジトリルートで依存関係をインストールします。

```sh
pnpm install
```

開発サーバーを起動します。

```sh
pnpm dev
```

開発サーバーはLANから確認できるよう、`0.0.0.0:5173`で待ち受けます。

## ターミナル

起動時に`public/root`を仮想ファイルシステムとして読み込み、`/home/guest/.eshrc`を実行します。

主なコマンド:

```text
help
ls -la
cd PATH
cat FILE
imgcat FILE.jpg [SIZE%]
mds-browser FILE.mds
neon-drive
matrix-rain
reload
clear
```

主な操作:

- `Enter`: コマンドを実行
- `ArrowUp`: 直前のコマンドを復元
- `Tab`: パスを補完
- `PageUp` / `PageDown`: スクロールバック
- `Ctrl+C`: MDSブラウザを終了

## 仮想ファイルシステム

仮想ファイルシステムの実体は以下に配置します。

```text
apps/site/public/root/
```

ファイルを追加・削除・更新した場合は、マニフェストを更新します。

```sh
pnpm update-fs
```

生成されるマニフェスト:

```text
apps/site/public/root-manifest.json
```

開いているターミナルへ反映するには、ブラウザを再読み込みするか`reload`コマンドを実行します。

## MDS

MDSは、仮想ターミナル内で表示する軽量ドキュメント形式です。

通常コンテンツ:

```text
apps/site/public/root/var/www/mds/
```

表示例:

```sh
mds-browser /var/www/mds/home/index.mds
```

MDSでは、色指定、背景色、テキスト装飾、外部リンク、仮想FSリンク、コマンドリンク、画像、includeを利用できます。

```mds
<a href="vfs:news.mds">News</a>
<a href="cmd:matrix-rain">Matrix Rain</a>
<a href="cmd:neon-drive">Neon Drive</a>
<a href="cmd:exit">Exit</a>
```

詳細はリポジトリルートの[`docs/mds-spec.md`](../../docs/mds-spec.md)を参照してください。

## Matrix Rain

半角カタカナなどの文字ストリームをCanvasへ描画する独立ランタイムです。

```sh
matrix-rain
```

- `Escape` / `Q`: 終了して呼び出し元へ戻る
- 開発環境では`/?boot=matrix-rain`で直接起動可能

詳細は[`docs/matrix-rain-spec.md`](../../docs/matrix-rain-spec.md)を参照してください。

## Neon Drive

ワイヤーフレーム風の道路とライトバイクを描画する独立ランタイムです。

```sh
neon-drive
```

- `ArrowUp`: 加速
- `ArrowLeft` / `ArrowRight`: 左右操作
- `Escape` / `Q`: 終了して呼び出し元へ戻る

## AA Makerとの関係

AA Makerは、Retro Tubeとは別のSPAとして`apps/aa-maker`に配置されています。

画像から生成したAAをMDSとして書き出し、Retro Tubeの仮想ファイルシステムへ配置して表示できます。

```sh
pnpm dev:aa-maker
```

AA Makerの詳細は[`apps/aa-maker/README.md`](../aa-maker/README.md)を参照してください。

## 参照ドキュメント

- [MDS仕様](../../docs/mds-spec.md)
- [MDS改修工程表](../../docs/mds-roadmap.md)
- [Matrix Rain仕様](../../docs/matrix-rain-spec.md)
- [AA Maker README](../aa-maker/README.md)
- [AA Maker仕様書](../aa-maker/docs/spec.md)
- [AA Makerデータモデル](../aa-maker/docs/data-model.md)
- [画像からAA生成 仕様書](../aa-maker/docs/image-to-ascii-art.md)

## 主要ファイル

```text
apps/site/
├── src/
│   ├── main.js
│   ├── terminal.js
│   ├── retro-tube.js
│   ├── matrix-rain.js
│   ├── neon-drive.js
│   └── webgl-framebuffer-canvas.js
├── public/
│   ├── root/
│   └── root-manifest.json
├── scripts/
│   ├── update-root-manifest.mjs
│   └── test-mds-snapshots.mjs
├── README.md
└── README.en.md
```

- `main.js`: ランタイム生成と切り替え
- `terminal.js`: ターミナル、仮想FS、MDS表示
- `retro-tube.js`: CRTシェーダー
- `matrix-rain.js`: Matrix Rain
- `neon-drive.js`: Neon Drive
- `webgl-framebuffer-canvas.js`: 低解像度CanvasのGPU転送

## テスト用起動

開発環境ではURLパラメータでMDSや仮想FSファイルを直接開けます。

```text
/?mds=/var/www/mds/test/link/link.mds&test=1
/?vfs=/var/www/mds/test/assets/elegg-logo-40.png&test=1
```

`test=1`ではCRTシェーダーと主な表示アニメーションを無効化し、確認を高速化します。
