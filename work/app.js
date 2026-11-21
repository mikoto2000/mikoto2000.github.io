'use strict';
const $=id=>document.getElementById(id), enc=new TextEncoder(), LIMIT=1048576;
let worker=null,workerURL=null,generation=0,debounce=null,timer=null,ticker=null,composing=false,started=0,backup=null,fileGeneration=0,successfulOutput=null;
function clearWorker(){if(worker)worker.terminate();worker=null;if(workerURL)URL.revokeObjectURL(workerURL);workerURL=null;clearTimeout(timer);clearInterval(ticker);$('stop').disabled=true;}
function invalidate(){generation++;clearTimeout(debounce);clearWorker();started=0;successfulOutput=null;$('output').value='';$('copy').disabled=true;$('copyStatus').textContent='';$('error').textContent='';$('resultInfo').textContent='現在の入力はまだ成功していません。';$('elapsed').textContent='— ms';}
function state(name,message=''){$('status').textContent=name;$('error').textContent=message;}
function elapsed(){if(started)$('elapsed').textContent=`${(performance.now()-started).toFixed(1)} ms（初期化・検証を含む）`;}
function finishError(kind,message){generation++;elapsed();clearWorker();state('エラー',`${kind}: ${message}`);$('resultInfo').textContent='完全な成功結果はありません。';}
function schedule(){invalidate();state(composing?'停止':'待機中',composing?'IME変換中です。':'');if(!composing)debounce=setTimeout(run,300);}
function snapshot(){return {input:$('input').value,filter:$('filter').value,mode:$('mode').value,flags:['raw','compact','slurp'].map(id=>$(id).checked)};}
function apply(s){$('input').value=s.input;$('filter').value=s.filter;$('mode').value=s.mode;['raw','compact','slurp'].forEach((id,i)=>$(id).checked=s.flags[i]);$('fileInfo').textContent='';schedule();}
function run(){
  invalidate();if(composing)return;
  const s=snapshot(),id=generation;
  if(enc.encode(s.input).length>LIMIT || enc.encode(s.filter).length>LIMIT){finishError('入力サイズ上限','入力・フィルターはそれぞれ 1 MiB（1,048,576 bytes）以内にしてください。');return;}
  if(!s.filter.trim()){finishError('フィルター未入力','jqフィルターを入力してください。');return;}
  if(!s.input.replace(/^\uFEFF/,'').trim()){finishError('入力エラー','入力が空です。null は有効なJSON値です。');return;}
  let seconds=Number($('timeout').value);if(!Number.isFinite(seconds)||seconds<.1||seconds>30){finishError('設定エラー','制限時間は0.1〜30秒で指定してください。');return;}
  started=performance.now();state('初期化中');$('stop').disabled=false;
  ticker=setInterval(elapsed,75);
  timer=setTimeout(()=>{if(id!==generation)return;generation++;elapsed();clearWorker();state('タイムアウト',`制限時間 ${seconds} 秒を超えたためWorkerを終了しました。再実行できます。`);$('resultInfo').textContent='結果を破棄しました。';},seconds*1000);
  try {
    workerURL=URL.createObjectURL(new Blob([WORKER_SOURCE],{type:'text/javascript'}));worker=new Worker(workerURL);
    worker.onerror=e=>{if(id===generation)finishError('Workerエラー',e.message);};
    worker.onmessage=({data:d})=>{
      if(id!==generation)return;
      if(d.type==='ready'){$('version').textContent=d.version;state('実行中');worker.postMessage({type:'run',input:s.input,filter:s.filter,mode:s.mode,flags:['-r','-c','-s'].filter((_,i)=>s.flags[i])});}
      else if(d.type==='running')state('実行中');
      else if(d.type==='error')finishError(d.kind,d.message);
      else if(d.type==='result'){
        elapsed();clearWorker();
        if(d.exitCode!==0){finishError(d.exitCode===3?'jq構文エラー':'jq実行時エラー',d.stderr||`終了コード ${d.exitCode}`);return;}
        successfulOutput=d.stdout;$('output').value=d.stdout;$('copy').disabled=d.stdout==='';
        state('成功',d.stderr?`jqからのメッセージ: ${d.stderr}`:'');
        $('resultInfo').textContent=d.stdout===''?'出力なし（0件）— 正常に完了しました。':`完全な出力 / ${enc.encode(d.stdout).length.toLocaleString()} bytes / jq処理 ${d.ms.toFixed(1)} ms`;
      }
    };
    const bytes=Uint8Array.from(atob($('wasm').textContent.trim()),c=>c.charCodeAt(0));worker.postMessage({type:'init',bytes},[bytes.buffer]);
  }catch(e){finishError('初期化エラー',String(e));}
}
$('run').onclick=run;
$('stop').onclick=()=>{generation++;clearTimeout(debounce);elapsed();clearWorker();$('output').value='';$('copy').disabled=true;state('停止','Workerを終了しました。再実行できます。');$('resultInfo').textContent='結果を破棄しました。';};
for(const id of ['input','filter']){
  $(id).addEventListener('input',()=>{fileGeneration++;schedule();});
  $(id).addEventListener('compositionstart',()=>{composing=true;schedule();});
  $(id).addEventListener('compositionend',()=>{composing=false;schedule();});
}
for(const id of ['mode','raw','compact','slurp','timeout'])$(id).addEventListener('change',schedule);
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'&&!e.isComposing){e.preventDefault();run();}});
async function loadFile(file){
  if(!file)return;const token=++fileGeneration;invalidate();state('初期化中','ファイルを読み込み中です。');
  if(file.size>LIMIT){finishError('入力サイズ上限',`ファイル「${file.name}」は1 MiB（1,048,576 bytes）を超えています。`);return;}
  try{const bytes=await file.arrayBuffer();if(token!==fileGeneration)return;const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);$('input').value=text.replace(/^\uFEFF/,'');$('fileInfo').textContent=`${file.name} / ${file.size.toLocaleString()} bytes`;schedule();}
  catch(e){if(token===fileGeneration)finishError('ファイル入力エラー',`UTF-8ファイルを読み込めません: ${e.message}`);}
}
$('file').onchange=e=>{loadFile(e.target.files[0]);e.target.value='';};
for(const ev of ['dragenter','dragover'])$('dropZone').addEventListener(ev,e=>{e.preventDefault();$('dropZone').classList.add('drag');});
$('dropZone').addEventListener('dragleave',()=>$('dropZone').classList.remove('drag'));
$('dropZone').addEventListener('drop',e=>{e.preventDefault();$('dropZone').classList.remove('drag');if(e.dataTransfer.files.length!==1){invalidate();finishError('ファイル入力エラー','ファイルを1つずつドロップしてください。');return;}loadFile(e.dataTransfer.files[0]);});
document.addEventListener('dragover',e=>e.preventDefault());document.addEventListener('drop',e=>e.preventDefault());
async function copyText(text,notice,field){
  try{if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(text);notice.textContent='コピーしました。';return;}}catch{}
  let temp;
  try{
    const target=field||(temp=document.createElement('textarea'));
    if(temp){temp.value=text;temp.style.position='fixed';temp.style.top='0';document.body.append(temp);}
    target.focus();target.select();
    const onCopy=e=>{if(e.clipboardData){e.clipboardData.setData('text/plain',text);e.preventDefault();}};
    let ok;document.addEventListener('copy',onCopy);
    try{ok=document.execCommand('copy');}finally{document.removeEventListener('copy',onCopy);}
    notice.textContent=ok?'コピーしました。':'自動コピーを確認できません。選択したテキストを Ctrl / ⌘ + C でコピーしてください。';
    if(!ok&&temp){temp.remove();temp=null;notice.textContent='自動コピーできません。上のフィルター例を選択して手動コピーしてください。';}
  }catch{notice.textContent='自動コピーできません。結果欄を選択し Ctrl / ⌘ + C でコピーしてください。';if(field){field.focus();field.select();}}
  finally{temp?.remove();}
}
$('copy').onclick=()=>{if(!$('copy').disabled&&successfulOutput!==null)copyText(successfulOutput,$('copyStatus'),$('output'));};
function renderExamples(){
  const q=$('search').value.toLowerCase();$('cards').replaceChildren();
  for(const ex of EXAMPLES){if(!JSON.stringify(ex).toLowerCase().includes(q))continue;
    const card=document.createElement('article');card.className='card';
    function add(tag,text){const n=document.createElement(tag);n.textContent=text;card.append(n);return n;}
    add('h3',`${ex.category} / ${ex.title}`);add('p',ex.description);
    add('small',`モード: ${ex.mode==='jsonl'?'JSONL':'JSON'} / オプション: ${ex.flags.join(' ')||'なし'}`);
    add('pre',ex.filter);const bar=document.createElement('div');bar.className='bar';card.append(bar);
    const notice=document.createElement('span');notice.setAttribute('role','status');
    const copy=document.createElement('button');copy.textContent='フィルターをコピー';copy.onclick=()=>copyText(ex.filter,notice);bar.append(copy);
    const tryIt=document.createElement('button');tryIt.textContent='この例を試す';tryIt.onclick=()=>{fileGeneration++;if(!backup)backup=snapshot();$('exampleBanner').hidden=false;apply({input:ex.input,filter:ex.filter,mode:ex.mode,flags:['-r','-c','-s'].map(f=>ex.flags.includes(f))});$('filter').focus();};bar.append(tryIt);card.append(notice);
    add('small','サンプル入力');add('pre',ex.input);add('small','期待する出力（末尾のLFを含む）');add('pre',ex.output||'（出力なし）');$('cards').append(card);
  }
  if(!$('cards').childElementCount){const p=document.createElement('p');p.textContent='一致する例がありません。';$('cards').append(p);}
}
$('search').oninput=renderExamples;
$('restore').onclick=()=>{if(backup){fileGeneration++;apply(backup);backup=null;$('exampleBanner').hidden=true;}};
window.addEventListener('pagehide',()=>{clearTimeout(debounce);clearWorker();});
renderExamples();run();
