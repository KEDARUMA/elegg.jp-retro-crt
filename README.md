# Elegg Retro CRT / AA Maker

## 日本語

このリポジトリには、次の2つの主要コンポーネントがあります。

- `AA-Maker`: ブラウザ上でアスキーアートを作成するエディター
- `Elegg Retro CRT`: レトロ CRT シミュレーター上で動くホームページ

`AA-Maker` は、初期80x25の可変グリッドで文字を配置し、半角と全角の幅を考慮して編集するための SPA です。
`Elegg Retro CRT` は、ターミナル風の表示を WebGL とシェーダーで歪ませる、ブラウザ向けのホームページです。

## 起動

```sh
pnpm dev
pnpm dev:aa-maker
```

- Elegg Retro CRT: `http://127.0.0.1:5173`
- AA Maker: `http://127.0.0.1:5174`

## ビルド

```sh
pnpm build
pnpm build:aa-maker
```

## テスト

```sh
pnpm test
```

## 方針

- 商用利用は不可
- 著作権表記を残した非商用の改変・再配布は可
- 本プロジェクトの丸ごとの複製や、実質的に同一な公開配布は不可
- Issue、Pull Request、レビュー、検証のための fork / clone / branch は可
- 商標やロゴの利用は `TRADEMARK.md` に従う
- 提案、修正、機能追加の PR は歓迎
- contribution は、本プロジェクトの LICENSE と同じ条件で提供されるものとして扱う

詳細は [LICENSE](./LICENSE)、[NOTICE](./NOTICE)、[TRADEMARK.md](./TRADEMARK.md) を参照してください。

## English

This repository contains two main components:

- `AA-Maker`: a browser-based editor for ASCII art
- `Elegg Retro CRT`: a homepage rendered through a retro CRT simulator

`AA-Maker` is an SPA for placing characters on a resizable grid that starts at 80x25 while respecting half-width and full-width character widths.
`Elegg Retro CRT` is a browser-facing homepage that bends terminal-like output through WebGL and shader effects.

## Run

```sh
pnpm dev
pnpm dev:aa-maker
```

- Elegg Retro CRT: `http://127.0.0.1:5173`
- AA Maker: `http://127.0.0.1:5174`

## Build

```sh
pnpm build
pnpm build:aa-maker
```

## Test

```sh
pnpm test
```

## Policy

- Commercial use is not allowed
- Non-commercial modifications and redistribution are allowed if copyright notices are kept
- Public copies that are unmodified or substantially identical are not allowed
- Forks, clones, and branches for issues, pull requests, review, or testing are allowed
- Trademark and logo use is governed by `TRADEMARK.md`
- PRs for improvements, fixes, and new features are welcome
- Contributions are provided under the same terms as this project's LICENSE

See [LICENSE](./LICENSE), [NOTICE](./NOTICE), and [TRADEMARK.md](./TRADEMARK.md) for details.
