let engine;
self.onmessage = async ({data:d}) => {
  try {
    if (d.type === 'init') {
      engine = await require_jq()({wasmBinary:d.bytes, outputLimit:1048576,onOutputLimit(){postMessage({type:'error',kind:'サイズ上限',message:'出力またはエラー出力が上限 1 MiB（1,048,576 bytes）を超えました。Workerを終了し、結果を破棄しました。'});}});
      await engine.whenReady;
      postMessage({type:'ready',version:engine.versionSync().trim()});
      return;
    }
    // Parse for validation only. Pass the original text to jq without serialization.
    const text=d.input.replace(/^\uFEFF/,'');
    if (!text.trim()) return postMessage({type:'error',kind:'入力エラー',message:'入力が空です。null は有効なJSON値です。'});
    if (!d.filter.trim()) return postMessage({type:'error',kind:'フィルター未入力',message:'jqフィルターを入力してください。'});
    try {
      if(d.mode==='jsonl') {
        const lines=text.split(/\r?\n/);
        for(let i=0;i<lines.length;i++) if(lines[i].trim()) {
          try {JSON.parse(lines[i]);} catch(e) {throw Error(`${i+1}行目: ${e.message}`);}
        }
      } else JSON.parse(text);
    } catch(e) {return postMessage({type:'error',kind:'入力エラー',message:e.message});}
    postMessage({type:'running'});
    const start=performance.now();
    const result=engine.rawSync(text,d.filter,d.flags);
    postMessage({type:'result',...result,ms:performance.now()-start});
  } catch(e) {
    postMessage({type:'error',kind:String(e).includes('OUTPUT_LIMIT')?'サイズ上限':'実行エラー',message:String(e).includes('OUTPUT_LIMIT')?'出力またはエラー出力が上限 1 MiB（1,048,576 bytes）を超えました。結果は破棄しました。':String(e)});
  }
};
