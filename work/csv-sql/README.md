# CSV SQL ワークベンチ

配布物はルートの `csv-sql.html`。`index.html` のツールボックスからリンクしている。GitHub Pages などの静的配信、または HTML 単体を保存して `file://` で利用できる。

## 利用と制約

- UTF-8 CSV/TSV を複数登録し、`t1`、`t2`… を SELECT / WITH で参照する。区切り文字・ヘッダー・全列文字列モードを選べる。設定変更は登録済みファイルに遡及しない。
- 登録は `File` を Worker に渡し、`BROWSER_FILEREADER` / direct I/O で部分読み取りする。`File.text()` / `arrayBuffer()` で CSV 全体を JS に展開しない。DuckDB 内部の読み取りバッファなどには別途メモリが必要。
- 全行をテーブルへ取り込まず `read_csv` を参照する VIEW を作る。型推定は先頭 20,480 行をサンプルする。データ後半の型不一致はクエリ時にエラーになるため、登録だけで全行の妥当性を確認したとは扱わない。
- 表示は 100 / 500 / 1,000 行、結果データは 4 MiB まで。表示上限を SQL 側に適用する。CSV 保存は表示結果のみ。全件エクスポート・更新 SQL・拡張追加・ディスク退避は提供しない。
- BIGINT / HUGEINT / DECIMAL などは DuckDB 内で VARCHAR に変換して返す。JS Number による精度の損失を避ける。DOUBLE の浮動小数点誤差を除去するものではない。
- 中断 / タイムアウトは Worker を終了し、保持した `File` と読み取り設定で VIEW を復元する。ファイルと結果は自動保存しない。
- SQL はサブクエリに包んで prepared statement として実行し、複数文やサブクエリを閉じて追加文を実行する入力も拒否する。

## 通信なしの構成

CSS、JS、DuckDB-Wasm、Arrow、WASM を単独 HTML に同梱。約 47 MB（非圧縮）。広告・解析・CDN・外部フォントなし。初期 HTML の HTTP 取得を除き、分析操作で HTTP/HTTPS を使わない。ブラウザーの更新や別ページへの移動は別の取得になる。

CSP は `default-src 'none'` とし、スクリプト / Worker と WASM 用の blob URL のみ許可する。HTTP/HTTPS の `connect-src` は許可しない。Worker の fetch は初期化時の同梱 WASM blob だけを許可し、初期化後は全面拒否する。同期 XMLHttpRequest も禁止。拡張の自動取得・自動ロードを無効化して設定をロックする。SELECT 内に外部 URL を渡した場合も通信せず失敗する。

DuckDB-Wasm **1.32.0**（実行時 DuckDB **v1.4.3**）、Apache Arrow **17.0.0** を固定。EH 単一 Worker を使い、SharedArrayBuffer や COOP/COEP ヘッダーを必要としない。WebAssembly 例外処理に対応する現行ブラウザーが必要。`memory_limit` は 1,536 MB。これは WASM / ブラウザー全体のメモリ上限ではない。

## 再生成

Python 標準ライブラリだけで生成できる。初回の開発用依存取得時のみ通信が必要。

```powershell
python work/csv-sql/prepare.py
python work/csv-sql/build.py
```

`prepare.py` は公式 npm の固定版アーカイブを SHA256 で照合し、指定ファイルだけを展開する。`build.py` は上流の export と Arrow import を単一 classic Worker 用に接続し、source map 参照を除去する。エンジン本体・WASM の変更は行わない。Arrow の公式 UMD 配布物を利用する。ビルダー、アプリ、Worker、HTML テンプレート、ライセンスはこのディレクトリに保存。

## 検証の再実行

既存の `work/node_modules/playwright` とインストール済み Chrome / Edge を利用する。テストは一時ブラウザープロファイルを使用し、通常プロファイルは操作しない。

```powershell
python work/csv-sql/make-fixture.py
node work/csv-sql/verify.cjs
node work/csv-sql/verify-http.cjs
```

生成 CSV は **1,073,741,864 bytes**（1 GiB より 40 bytes 大きい）、8 BIGINT 列、**13,421,773 行**。100,000 行の数値ブロックを繰り返し、端数を追加する。行のサイズは 80 bytes。文字列・高カーディナリティの巨大 JOIN などを代表するデータではない。期待件数と合計値は Python で独立に計算する。CSV と配布アーカイブは Git 管理対象外。

実測結果と端末条件は [verification.md](verification.md)。機械可読の記録は Git 管理対象外で、再検証時に生成する: `verification-results.json` / `http-results.json`。

## ブラウザー全体のメモリ制限テスト（Windows）

```powershell
python work/csv-sql/memory-job.py
```

Windows Job Object で Node のテストプロセスと、そこから起動した Chrome の全子プロセスの合計コミットメモリを **4 GiB** に制限する。対象の Node を一時停止状態で起動してジョブに登録してから再開し、ブラウザー起動前から上限を適用する。ブラウザーの CDP が返した browser / renderer / GPU / utility の各 PID について `IsProcessInJob` でも所属を確認する。DuckDB 内だけを制限した検証ではない。

通常利用中のブラウザー、OS 設定、ページファイル、システム全体の利用可能メモリは変更しない。ジョブを閉じると検証用プロセスだけが終了する。結果は `memory-results.json` と `memory-job-results.json`。物理 RAM 16 GB の実機や VM を再現するものではなく、ブラウザー側のメモリ予算を絞った検証。

`--edge` を付けると Edge も検証する。ただし今回の環境では Edge が OS 経由で起動した `WinrtAppIdService` がジョブに属していなかったため、ブラウザー全体への制限が成立したとは判断していない。その試行は `memory-edge-attempt-results.json` / `memory-edge-attempt-job-results.json` に残した。ジョブ外の OS 補助プロセスの設定は変更しない。検証プログラムは所属確認に失敗したブラウザーの制限付きベンチマークを打ち切る。

GitHub Pages の通常の Jekyll ビルドでは、ルートの `_config.yml` の `exclude: [work]` により、このソース・テスト・検証記録と依存ファイルのディレクトリ全体を配信対象から除外する。今回のツールで配信するのはルートの `csv-sql.html`。リポジトリ全体をそのままアップロードする独自 Actions の場合は、この Jekyll 設定だけでは除外されない。

依存物・アーカイブ・fixtures・キャッシュと、検証結果 JSON・画像は Git 管理対象外。ソース・ライセンス・検証スクリプト・Markdown の検証記録を管理する。記録内の JSON ファイル名は検証時の生成先を示す。Playwright の導入手順は [../README.md](../README.md) を参照。
