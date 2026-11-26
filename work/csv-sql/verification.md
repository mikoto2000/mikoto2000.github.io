# CSV SQL ワークベンチ検証記録

検証日: 2026-11-27（日本時間）。成果物: `../../csv-sql.html`（47,179,997 bytes、約 45 MiB）。初回の非圧縮転送量は約 47 MB。検証後にライセンス表示の末尾空白だけを正規化しており、検証時の HTML は 2 bytes 大きい。実行コード・WASM は同一。

SHA256: `6e96d3a542e3624599cbccaaee465e525eaff9b75de0250b2c1875658ac16c65`

## 結果

**数値中心の 1 GiB CSV について、Chrome / Edge ともに通信遮断下で全行集計が成功した。** 行数・合計値を Python で計算した期待値と照合した。プレビューだけの検証ではない。

主要 16 検証と追加 7 検証がすべて合格。機械可読の結果は `verification-results.json` と `http-results.json`。Playwright からインストール済みの実ブラウザーを一時プロファイルで起動した。通常ブラウザーのプロファイルは使っていない。

## 端末とデータ

- Windows（10.0.26300）、Intel Core i9-12900、OS が認識する RAM 137,167,679,488 bytes（約 128 GiB）。
- Chrome 158.0.8127.88 / Edge 158.0.4370.33。
- DuckDB-Wasm 1.32.0、実行時 DuckDB v1.4.3、Arrow 17.0.0、EH 単一 Worker、`memory_limit = '1536MB'`。
- 入力 CSV: **1,073,741,864 bytes**、ヘッダーあり、8 BIGINT 列、**13,421,773 行**。
- 100,000 行の数値ブロックを反復して作成。各行 80 bytes、先頭列の値は 100,000,000〜100,099,999。値の種類が少ない人工データであり、任意の 1 GB CSV を代表するものではない。
- `SUM(c1)` = **1,342,847,530,320,878**、`SUM(c8)` = **10,738,088,630,320,878**。

## 実測

SQL 内部の実行から結果文字列化までの時間。初回 HTML 読み込み・WASM 初期化・ファイル登録・画面への描画時間はこの列に含めない。繰り返し測定の統計ではなく、その実行時の値。

| 処理 | ブラウザー / 経路 | 実測 |
| --- | --- | --- |
| 全行 COUNT・2 列 SUM・MIN・MAX | Chrome、file://、初めから offline | 5.55 秒 |
| 条件で絞って全行 COUNT | Chrome、file://、offline | 4.32 秒 |
| GROUP BY と SUM（100 グループ） | Chrome、file://、offline | 5.13 秒 |
| 全行から ORDER BY DESC LIMIT 10 | Chrome、file://、offline | 5.06 秒 |
| 小さい別 CSV と JOIN し COUNT | Chrome、file://、offline | 5.32 秒 |
| 全行 COUNT・2 列 SUM | Chrome、HTTP 初回取得後 offline | 5.95 秒 |
| 全行 COUNT・2 列 SUM | Edge、file://、offline | 6.64 秒 |

Chrome のファイル登録は約 0.2 秒程度。登録時には型推定のサンプルを読むだけで、全行を検証してはいない。プレビュー登録と全行走査の実測を区別した。

WASM 線形メモリの確保量は、登録後 **103,415,808 bytes**、全行集計後 **1,196,687,360〜1,228,144,640 bytes**（約 1.11〜1.14 GiB）。`db.mod.HEAPU8.buffer.byteLength` のスナップショットであり、ピーク使用量やブラウザープロセス全体のメモリではない。JS・HTML・Blob・DOM などは別途メモリを使う。

## 通信の検証

1. **file://**: ブラウザーコンテキストを最初から offline にして HTML を直接開いた。初期化、1 GiB 登録、全行集計、絞り込み、GROUP BY、JOIN、結果保存が成功。HTTP/HTTPS リクエスト **0 件**、ブラウザーの pageerror **0 件**。
2. **HTTP**: テスト内の一時ローカル HTTP サーバーで配信。取得は HTML の **1 回だけ**。通信可能な状態でも外部 CSV / Parquet を指す SQL は失敗し、外部へのリクエストは発生しなかった。
3. HTTP で初期化後、コンテキストを offline に変更。1 GiB CSV の全行 COUNT / SUM を実行でき、初期読み込み後の HTTP/HTTPS リクエスト **0 件**。結果は期待値と一致。

`File.prototype.text` / `arrayBuffer` をテスト側で例外に置き換えても、主要な file:// の全行検証が成功。アプリが入力 CSV 全体をそれらの API で一括読み取りしないことも確認した。

## 操作と表示の検証

- CSV の BOM・CRLF・日本語・カンマを含む引用符付きセル・引用符のエスケープ・セル内改行。
- TSV、ヘッダーなし、全列文字列指定による先頭ゼロ保持、WITH クエリ。
- 大きい BIGINT / DECIMAL の正確な表示、NULL 表示、表示上限による打ち切り。
- 不正 SQL、複数 SQL、更新文、サブクエリを閉じて追加文を実行しようとする入力を拒否。エラー後の古い結果消去・保存ボタン無効化・再実行。
- 重いクエリの中断、タイムアウト、登録ファイルの復元、再実行。
- 表示結果の UTF-8 BOM 付き CSV 保存。引用符・セル内改行を保持。
- HTML に見える CSV の値を textContent で表示し、タグとして解釈しない。
- Ctrl+Enter 実行、ファイル削除、全データ消去。
- 1440px / 390px 幅のスクリーンショットを確認。ページ全体の横溢れなし。結果表のみ横スクロール。

## 適用範囲

この環境・人工データ・SQL についての結果であり、ユーザーの実ファイルやすべての端末での動作保証ではない。スマートフォン、低メモリ PC、高カーディナリティの巨大集計、1 GiB 同士の JOIN、全件の結果保存は検証していない。ソート検証は上位 10 件の取得で、全件ソートの出力ではない。

ページはメモリ内 DB と CSV の直接読み取りを使い、OPFS への永続保存や一時退避は使用しない。大きな中間データを作るクエリはメモリ不足になることがある。中断・タイムアウト時は Worker を破棄して復旧する。

再現手順は [README.md](README.md)。検証用 CSV は `make-fixture.py` から再生成できる。

## 追加: 16 GB PC を想定したメモリ予算の検証

2026-11-27 に、Windows Job Object を使って **Chrome 全体と Node のテスト処理の合計コミットメモリを 4 GiB に制限**して再検証した。DuckDB の設定値だけを下げたテストではない。物理 RAM は元の約 128 GiB のままで、OS・他アプリ・ファイルキャッシュに圧力を加える操作は行っていない。

テストの Node を一時停止状態で起動し、ジョブに所属させてから再開した。ジョブの上限を Windows API から読み戻し、**4,294,967,296 bytes** であることを確認。Chrome の CDP が列挙した browser・renderer・GPU・NetworkService・StorageService の全 PID がジョブに属することも `IsProcessInJob` で確認した。子プロセスの breakaway は許可していない。

**Chrome 158.0.8127.88 で 9 項目すべて合格。** 同じ 1 GiB / 8 列 / 13,421,773 行の CSV を使用した。

| 処理 | 実測 |
| --- | --- |
| 全行 COUNT / SUM / MIN / MAX（期待値と一致） | 4.38 秒 |
| 条件で絞って全行 COUNT | 3.03 秒 |
| GROUP BY / SUM | 3.18 秒 |
| ORDER BY DESC LIMIT 10 | 2.91 秒 |
| 小さい別 CSV との JOIN / COUNT | 2.89 秒 |

ファイル登録、中断後の復元・再実行、HTTP/HTTPS 通信 0 件、ブラウザーの pageerror 0 件も確認した。

Windows が記録したジョブ全体のピークコミットメモリは **4,186,177,536 bytes（約 3.90 GiB）**、単一プロセスのピークは **3,796,910,080 bytes**。この値には Node と検証用 Chrome のプロセス群を含む。WASM 領域だけの約 1.14 GiB と混同しない。物理 RAM 使用量・システム全体の使用量と同じ指標ではない。

この結果から、今回の CSV と SQL については、16 GB PC でブラウザー用に数 GiB の余裕を確保できれば動作する見込みがある。ただし **物理 RAM 16 GB の実機や 16 GB VM で検証したという意味ではない**。CPU・ディスク・OS のキャッシュ条件が異なるため、16 GB PC で同じ速度になる保証もない。4 GiB 上限には近づいており、より重い JOIN・集計や別データでは追加の余裕が必要になる。

Edge も試したが、OS 経由で起動された `winrt_app_id.mojom.WinrtAppIdService` の PID がジョブ外だった。集計自体は成功したものの、Edge 全体へのメモリ制限が成立したとは判断していない。その所属検証の失敗も `memory-edge-attempt-results.json` / `memory-edge-attempt-job-results.json` に保存した。ジョブ外の補助プロセスに制限を追加する操作はしていない。最終の Chrome 単独テストは終了コード 0 で完了。

再現: `python work/csv-sql/memory-job.py`。最終結果は `memory-results.json` / `memory-job-results.json`。Job Object の制限・ピーク値の意味は [Microsoft の公式仕様](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_extended_limit_information)、子ジョブの扱いは [Nested Jobs](https://learn.microsoft.com/en-us/windows/win32/procthread/nested-jobs) を参照。

検証結果 JSON と画像は Git 管理対象外。本文中のファイル名は各検証スクリプトの生成先を示す。再実行手順は [README.md](README.md) を参照。
