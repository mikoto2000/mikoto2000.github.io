# 開発用ファイル

公開するのはルートの生成済み HTML。`work/` は `_config.yml` により Jekyll の公開対象から除外する。
ソース、ビルダー、ライセンス、検証スクリプトと Markdown の検証記録は Git 管理する。
再取得できる依存物・アーカイブ・ネイティブ実行ファイル、検証結果 JSON・画像・単独 HTML の検証用コピーは Git 管理しない。
これらはローカルに残り、再生成後も `.gitignore` で除外される。

## jq Playground の再ビルド

Python 標準ライブラリを使用する。初回の依存取得のみ通信が必要。

```powershell
python work/prepare.py
python work/make_examples.py
python work/build.py
```

`prepare.py` は npm の jq-wasm **3.0.0-jq-1.8.2** のアーカイブを SHA256 で照合し、ビルドに使う JS と WASM だけを展開する。
ライセンスは `jq-wasm-LICENSE`、`jq-COPYING`、`oniguruma-COPYING`、`emscripten-LICENSE` に保存し、生成 HTML に同梱する。

## jq の検証

インストール済み Chrome / Edge と Playwright を使用する。

```powershell
npm install --prefix work --no-save --package-lock=false playwright@1.65.1
python work/prepare.py --with-jq
node work/verify.cjs
node work/extra.cjs
```

`--with-jq` は比較検証用の Windows x64 jq **1.8.2** を公式リリースから取得し、SHA256 を照合する。
ビルドだけなら不要。検証結果 JSON と画像は各スクリプトが生成する。過去の検証内容は [verification.md](verification.md) を参照。

## CSV SQL

再ビルドと検証の手順は [csv-sql/README.md](csv-sql/README.md) を参照。
