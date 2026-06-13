# MDS 仕様

MDS は仮想ターミナルで表示する軽量ドキュメント形式です。
MDS の構文を変更する場合は、同じ変更でこの仕様書も更新します。

工程表とフェイズごとの進捗は [mds-roadmap.md](./mds-roadmap.md) に記録します。

## ブラウザコマンド

```sh
mds-browser FILE.mds
```

- `.mds` ファイルのみ対応します。
- ブラウザ表示中は `Ctrl+C` を押すまで表示状態を維持します。
- ブラウザ表示中は通常のターミナル入力とペーストを無視します。
- リンククリックは有効です。
- `Ctrl+C` を押すとブラウザ表示を終了し、`^C` を表示してシェルプロンプトへ戻ります。

## MDS コンテンツ配置

MDS の通常コンテンツは仮想 FS の `/var/www/mds/` 配下に配置します。

```text
/var/www/mds/
```

テスト用コンテンツは `/var/www/mds/test/` 配下に機能別ディレクトリを作って配置します。

```text
/var/www/mds/test/text/formatting.mds
/var/www/mds/test/link/link.mds
/var/www/mds/test/link/link-target/link-target.mds
/var/www/mds/test/image/image.mds
/var/www/mds/test/form/form.mds
/var/www/mds/test/assets/elegg-logo-163.png
/var/www/mds/test/assets/elegg-logo-40.png
```

テスト用 MDS は `mds-browser` で開いて確認します。

```sh
mds-browser /var/www/mds/test/text/formatting.mds
mds-browser /var/www/mds/test/link/link.mds
mds-browser /var/www/mds/test/link/link-target/link-target.mds
mds-browser /var/www/mds/test/image/image.mds
mds-browser /var/www/mds/test/form/form.mds
```

仮想 FS 内のファイルを参照する場合は `vfs:` を指定します。外部画像は `http://` / `https://` を指定できます。

## テスト起動

Playwright などの自動確認では、URL パラメータでテスト対象 MDS を直接起動します。

```text
/?mds=/var/www/mds/test/text/formatting.mds&test=1
/?vfs=/var/www/mds/test/assets/elegg-logo-40.png&test=1
```

- `mds` は起動後に直接開く MDS ファイルを指定します。
- `vfs` は起動後に仮想 FS 内のファイルを直接開きます。`.mds` は MDS として、画像はターミナル内の画像ページとして表示します。
- `mds` が指定されている場合は `.eshrc` を実行しません。
- `vfs` が指定されている場合も `.eshrc` を実行しません。
- `test=1` はテスト用高速表示を有効にします。
- `test=1` では CRT シェーダーを通さず、素の terminal canvas を直接表示します。
- `test=1` では 1 フレーム 1 文字の出力制限を解除します。
- `test=1` では文字と画像ブロックの表示アニメーションをスキップします。
- `test=1` では揺らぎ、ノイズ、scanline、curve、glass overlay を表示しません。
- 通常起動では `.eshrc` と表示アニメーションを維持します。

## 画面制御

### 画面クリア

状態: 実装済み。

```mds
<clear>
```

表示中のターミナル文字列を消去し、カーソルを左上へ移動します。

既存仕様:

```mds
[[clear]]
```

## テキスト装飾

### 太字

状態: 実装済み。

```mds
*text*
```

`text` を太字で表示します。

### 色指定

状態: 実装済み。

```mds
<color="red">
ここから赤
この行も赤
<color>
直前の色指定へ戻る
```

タグで囲まず、指定位置以後の前景色を変更します。

- 色名または `#rrggbb` 形式を指定できます。
- `<color="...">` は現在の色をスタックに積んでから、指定色へ変更します。
- `<color>` は色スタックから 1 つ戻し、直前の色指定へ戻します。
- 初期状態で `<color>` が来た場合は何もしません。
- 色名は実装時に対応色の一覧を定義します。
- 未対応の色は通常表示へフォールバックします。

### 背景色指定

状態: 未実装。

```mds
<bgcolor="#000000">
ここから黒背景
この行も黒背景
<bgcolor>
直前の背景色指定へ戻る
```

タグで囲まず、指定位置以後の背景色を変更します。

- 色名または `#rrggbb` 形式を指定できます。
- `<bgcolor="...">` は現在の背景色をスタックに積んでから、指定色へ変更します。
- `<bgcolor>` は背景色スタックから 1 つ戻し、直前の背景色指定へ戻します。
- 初期状態で `<bgcolor>` が来た場合は何もしません。
- 色名は `<color>` と同じ対応色一覧を使用します。
- 未対応の色は通常背景へフォールバックします。
- `<color>` は前景色、`<bgcolor>` は背景色だけを変更し、互いのスタックには影響しません。

AA Maker などセル単位の色を MDS に変換する場合は、ファイル肥大化を避けるため、連続する同一色範囲ではタグを繰り返しません。

- 直前の出力セルと同じ前景色の場合、追加の `<color="...">` は出力しません。
- 直前の出力セルと同じ背景色の場合、追加の `<bgcolor="...">` は出力しません。
- 前景色または背景色が変わる直前にだけ、必要なタグを出力します。
- 行末は `trimEnd()` 相当で削除し、削除される範囲の色タグは出力しません。
- 行中の空白は、色付きセルであれば必要な色タグを出力し、未配置セルであれば現在色を維持したまま空白だけを出力します。
- 各行末では前景色と背景色の状態をリセットしてから改行します。

### 下線

状態: 実装済み。

```mds
<u>text</u>
```

`text` に下線を付けて表示します。

### 修正線

状態: 実装済み。

```mds
<s>text</s>
```

`text` に修正線を付けて表示します。

### 反転

状態: 実装済み。

```mds
<inv>text</inv>
```

`text` の前景色と背景色を反転して表示します。

## リンク・ボタン

`<a>` 形式のリンクは、自動 URL リンクより優先します。

### 自動 URL リンク

状態: 実装済み。

```mds
https://example.com/
```

`http://` と `https://` の URL を自動検出し、新しいブラウザタブで開きます。

### 外部リンク

状態: 実装済み。

```mds
<a href="https://example.com/">Open Example</a>
```

`Open Example` をクリック可能なリンクとして表示し、新しいブラウザタブで URL を開きます。

### 仮想 FS リンク

状態: 実装済み。

```mds
<a href="vfs:/var/www/mds/test/link/link-target/link-target.mds">Open Absolute Path Page</a>
<a href="vfs:link-target/link-target.mds">Open Offset Path Page</a>
<a href="vfs:../assets/elegg-logo-40.png">Open VFS Image</a>
```

- `vfs:` のリンク先は仮想 FS 内のファイルのみ対応します。
- `/` から始まるパスは仮想 FS の絶対パスとして解決します。
- `/` から始まらないパスは、現在表示中の MDS ファイルがあるディレクトリからの相対パスとして解決します。
- `.mds` はターミナル内部で MDS として表示します。
- 画像ファイルはターミナル内部の画像ページとして表示します。
- `vfs:` 遷移時、`.mds` はブラウザ URL の `mds` パラメータ、画像は `vfs` パラメータを更新します。
- ブラウザの戻るボタンで直前の MDS 表示へ戻れます。

例: `/var/www/mds/test/link/link.mds` から `vfs:link-target/link-target.mds` を開くと、`/var/www/mds/test/link/link-target/link-target.mds` を表示します。

### コマンドリンク

状態: 実装済み。

```mds
<a href="cmd:echo 'abc'">Run Echo</a>
```

`cmd:` 以降のコマンドを仮想ターミナル内で実行します。

### ホバー表示

状態: 実装済み。

クリック可能なリンク範囲は、ホバー中に反転表示します。

## 画像

### 画像表示

状態: 実装済み。

```mds
<img src="https://example.com/image.png" alt="External image">
<img src="vfs:../assets/elegg-logo-40.png" alt="Elegg logo">
<img src="vfs:../assets/elegg-logo-40.png" align="left" alt="Elegg logo">
<img src="vfs:../assets/elegg-logo-40.png" align="center" alt="Elegg logo">
<img src="vfs:../assets/elegg-logo-40.png" align="right" alt="Elegg logo">
```

画像を表示します。

- `src` は外部 URL、ブラウザ相対 URL、または `vfs:` 付きの仮想 FS 画像パスを指定します。
- `http://` と `https://` は外部画像としてブラウザが読み込みます。
- prefix なしの相対パスはブラウザ相対 URL として扱います。
- `vfs:/...` は仮想 FS の絶対パスとして解決します。
- `vfs:...` は現在表示中の MDS ファイルがあるディレクトリからの相対パスとして解決します。
- `/root/...` は使用しません。
- `alt` は画像を表示できない場合の代替テキストを指定します。
- `align` は `left`、`center`、`right` を指定できます。
- `align` を省略した場合は `left` として扱います。
- Phase 1 の画像テスト確認用画像は `/var/www/mds/test/assets/elegg-logo-40.png` を使用します。

### 画像リンク

状態: 実装済み。

```mds
<a href="https://example.com/">
  <img src="vfs:../assets/elegg-logo-40.png" alt="Open Example">
</a>

<a href="vfs:/var/www/mds/test/link/link-target/link-target.mds">
  <img src="vfs:../assets/elegg-logo-40.png" alt="Open Link Target" align="center">
</a>

<a href="cmd:echo 'abc'">
  <img src="vfs:../assets/elegg-logo-40.png" alt="Run Echo" align="right">
</a>
```

画像をクリック可能なリンクとして表示します。

- 画像専用のリンクタグは定義しません。
- `<a>` の中に `<img>` を入れて画像リンクとして扱います。
- `<img>` の `src`、`alt`、`align` は通常の画像表示と同じ扱いにします。
- `<a>` の `href` は既存のリンクと同じリンク先形式を使用します。
- `https://` と `http://` は新しいブラウザタブで開きます。
- `vfs:` は既存の仮想 FS リンクと同じ動作にします。
- `cmd:` は既存のコマンドリンクと同じ動作にします。

### 画像テストページ

状態: 実装済み。

```mds
Left image:
<img src="vfs:../assets/elegg-logo-40.png" align="left" alt="Elegg logo left">

Center image:
<img src="vfs:../assets/elegg-logo-40.png" align="center" alt="Elegg logo center">

Right image:
<img src="vfs:../assets/elegg-logo-40.png" align="right" alt="Elegg logo right">

Image link:
<a href="vfs:/var/www/mds/test/link/link-target/link-target.mds">
  <img src="vfs:../assets/elegg-logo-40.png" align="center" alt="Open link target">
</a>
```

`/var/www/mds/test/image/image.mds` は、左寄せ、中央寄せ、右寄せ、画像リンクを 1 ページ内に表示します。

## AA Maker スタンプ

AA Maker のスタンプデータは、MDS 内に `<stamp-set>` と `<stamp>` を置いて定義できます。

```mds
<stamp-set id="speech-bubble" name="Speech Bubble">
<stamp id="speech-bubble-001" name="Speech Bubble 001">
　 ／￣￣￣￣￣￣￣
＜
　 ＼＿＿＿＿＿＿＿
</stamp>
</stamp-set>
```

- 1 つの `.mds` ファイルに複数の `<stamp>` を配置できます。
- `<stamp-set>` の `id` / `name` はコンボボックスの分類に使います。
- `<stamp>` の `id` / `name` はスタンプごとの識別と表示名に使います。
- `width` / `height` は固定メタ情報として持たせず、本文を読み込んだ時点で各スタンプごとに算出します。
- 行末の空白は削除し、行中と行頭の空白はセル位置として保持します。
- 半角スペース、全角スペース、タブは透明セルとして扱います。
- 色が必要な場合は、既存の `<color="...">` / `<bgcolor="...">` と `<color>` / `<bgcolor>` を使います。

## フォーム

フォーム系タグは Phase 2 で表示仕様を定義し、入力値の保存、送信、イベント連携は Phase 3 で扱います。

### テキストエリア

状態: Phase 2 で実装予定。

```mds
<textarea name="message" rows="4" placeholder="Message"></textarea>
<textarea name="title" rows="1" placeholder="Title"></textarea>
```

テキスト入力欄を表示します。

- `name` は入力欄の識別子を指定します。
- `rows` は表示行数を指定します。
- `rows="1"` の場合は 1 行テキストフィールドとして表示します。
- `placeholder` は未入力時の表示文字列を指定します。

### チェックボックス

状態: Phase 2 で実装予定。

```mds
<checkbox name="agree" label="Agree" checked="false">
```

チェックボックスを表示します。

- `name` は入力欄の識別子を指定します。
- `label` は表示ラベルを指定します。
- `checked` は初期状態を指定します。

### ラジオボタン

状態: Phase 2 で実装予定。

```mds
<radio name="plan" value="basic" label="Basic" checked="true">
<radio name="plan" value="pro" label="Pro">
```

ラジオボタンを表示します。

- 同じ `name` のラジオボタンは 1 つのグループとして扱います。
- `value` は選択値を指定します。
- `label` は表示ラベルを指定します。
- `checked` は初期状態を指定します。

### コンボボックス

状態: Phase 2 で実装予定。

```mds
<select name="country" placeholder="Country">
  <option value="jp" label="Japan">
  <option value="us" label="United States">
</select>
```

コンボボックスを表示します。

- `select` の `name` は入力欄の識別子を指定します。
- `placeholder` は未選択時の表示文字列を指定します。
- `option` の `value` は選択値を指定します。
- `option` の `label` は表示ラベルを指定します。
