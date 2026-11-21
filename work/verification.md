# jqプレイグラウンド検証記録

検証日: 2026-11-22（日本時間）

成果物: `../jq-playground.html`（約1.34 MiB）。CSS、アプリJavaScript、Workerコード、jq WASM、ライセンスをすべて埋め込み。

採用: jq-wasm 3.0.0-jq-1.8.2 / 正規jq 1.8.2。実行時の `--version` でも確認。
パッケージ: https://registry.npmjs.org/jq-wasm/-/jq-wasm-3.0.0-jq-1.8.2.tgz
上流: https://github.com/owenthereal/jq-wasm
比較用ネイティブjq: https://github.com/jqlang/jq/releases/download/jq-1.8.2/jq-windows-amd64.exe

配布ラッパーの修正: stdout/stderrのtrimを除去。stdout/stderrのバイト収集に各1 MiBの上限を追加し、超過時にメインスレッドへ即時通知してWorkerを終了。正規jqのWASMバイナリは変更していない。

## 実施結果

Playwrightでインストール済みの実ブラウザをヘッドレス起動し、完成HTMLを直接 `file://` から読み込んだ。ブラウザーコンテキストは最初からoffline。HTTPサーバーは使用していない。

- Chrome 157.0.8103.79: 主要24検証すべて合格（`verification-results.json`）。
- ChromeおよびEdge 157.0.4341.60: 追加検証すべて合格（`extra-results.json`）。Edgeはサンドボックス内で起動できなかったため、一時プロファイルを使いサンドボックス外で検証した。
- チートシート全32例: 期待値・WASM出力・公式ネイティブjq出力の3者一致。UIの「この例を試す」も全例実行した。
- runtimeのHTTP/HTTPSリクエスト0件。ブラウザスクリプトエラー0件。localStorage/sessionStorageへの保存0件。

| 指定検証項目 | 結果・方法 |
| --- | --- |
| 1. 抽出・絞り込み・集計 | 合格。32例とネイティブjq比較 |
| 2. JSONの全種類 | 合格。オブジェクト・配列・文字列・数値・true/false・null。巨大整数も元テキストのまま比較 |
| 3. JSONL・inputs・slurp | 合格。複数入力、空行、reduce inputs、-s |
| 4. -r・-c | 合格。空白、日本語、文字列内改行、複数結果と併用も比較 |
| 5. エラー分類 | 合格。不正JSON、元の3行目のJSONL不正行、構文エラー、実行時エラーを区別。出力消去とコピー無効も確認 |
| 6. 空入力等の区別 | 合格。空入力・空フィルターはエラー。emptyは成功・出力0件、null/false/複数結果はそれぞれ出力 |
| 7. 素早い編集 | 合格。重い処理中に続けて編集し、古い出力を即座に消去。最後の入力だけを表示 |
| 8. 停止・再実行 | 合格。同期WASM処理中も検索欄を操作し、停止後に新しいフィルターが成功 |
| 9. タイムアウト・再実行 | 合格。0.3秒に設定し強制終了、その後5秒設定へ戻して成功 |
| 10. サイズ制限 | 合格。入力、フィルター、ファイル、stdout、stderr。出力1,048,576 bytesは成功、1 byte超過は破棄・コピー無効。復帰も確認 |
| 11. 全チートシート | 合格。全32例を期待値・ネイティブjqと比較し、UIボタンでも実行 |
| 12. 作業復元 | 合格。32例を順次試した後、最初の入力・フィルター・モード・オプションを復元 |
| 13. コピー・代替 | 合格。Clipboard API実書込み・読戻し、API不在時のexecCommand実コピー、失敗時の手動選択案内を確認。CR/LFを含む元のjq出力をコピーAPIと代替copyイベントに渡すことも確認 |
| 14. HTML/script安全性 | 合格。入力・出力・エラー・ファイル名にタグを使用。要素やグローバル変数が生成されないことを確認 |
| 15. 遮断状態の新規読込み | 合格。offlineコンテキスト内で初期化・実行。ネットワーク要求なし |
| 16. 単独コピー | 合格。HTMLだけが存在する `standalone/` へコピーし、offlineで新規読込み・成功 |
| 17. LF/CRLF/BOM | 合格。BOM付きUTF-8、LF/CRLF、空行のあるファイルを選択読込み。DataTransferによるファイルドロップも確認 |
| 18. PC/狭い画面 | 合格。1440×1000と390×844で確認。狭い画面で縦配置、長い文字列でもページ全体の横溢れなし。PNGも目視確認 |

追加: Ctrl+Vによる実際のクリップボード貼り付け、Ctrl+Enter実行をChromeとEdgeで確認。IME変換中の抑制はcompositionstart/endイベントを使って確認。

## 制限・未検証

- 実機スマートフォン、OSの実際の日本語IME、Firefox/Safariは未検証。IMEイベント処理と狭い画面の動作は自動検証済み。
- 大きな中間値の生成は、出力に到達する前にブラウザメモリ上限で失敗する場合がある。停止・時間制限でWorkerは終了できる。
- タイムアウトは初期化・検証も含める。初期値5秒、設定可能範囲0.1〜30秒。
- 入力とフィルターは各1 MiB、出力とエラー出力も各1 MiB。超過結果は部分表示・コピーせず破棄。
- Windowsクリップボードはシステム側でLFをCRLFへ正規化する。改行の構造・raw出力の空白は保持され、アプリから渡す文字列にはtrimやJSON再直列化を行っていない。
- file://上のClipboard API利用可否はブラウザー設定による。代替コピーが失敗した場合は結果を選択して手動コピーする案内を表示。
- 外部jqモジュール・OSファイルアクセスは提供しない。jq本体は同梱WASMで実行する。

## 再実行

開発・検証ファイルはすべてこの `work/` に配置し、Gitの管理対象としている。再取得できる `work/node_modules/` とPythonの `work/__pycache__/` は `.gitignore` で除外する。GitHub Pagesでは、ルートの `_config.yml` の `exclude: [work]` により、このディレクトリ全体を公開対象から除外する。コミットは実行していない。

```powershell
python work/make_examples.py
python work/build.py
node work/verify.cjs
node work/extra.cjs
```

完成HTMLのSHA256: `2BA139C9F808385DA3B61731D6D9ECE6E1781F7F11FBB36545406589FED2B136`
