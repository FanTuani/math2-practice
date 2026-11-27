const recordPrefix='math2.exam-record.v1.';
const recordUndo=[];
const recordColors={green:'#55b393',yellow:'#e2bc59',red:'#df666b'};
const recordNames={green:'绿色',yellow:'黄色',red:'红色'};
const recordEditor=document.querySelector('#record-editor');
const recordNotice=document.querySelector('#record-notice');
const recordBrush=document.querySelector('#record-brush');
let recordKey='';
function readRecord(key){
  try{return localStorage.getItem(recordPrefix+key);}catch{return null;}
}
function recordColor(value,points){
  if(value in recordColors)return recordColors[value];
  const scale=Math.min(1,Number(value)/points*2)*2;
  const stops=[[85,179,147],[226,188,89],[223,102,107]];
  const index=Math.min(1,Math.floor(scale));
  return 'rgb('+stops[index].map((v,i)=>Math.round(v+(stops[index+1][i]-v)*(scale-index))).join(',')+')';
}
function recordCell(p,q){
  const key=p.year+'-'+q.position, points=practiceText[key].points;
  const value=readRecord(key);
  const hasScore=value!==null && /^\d+$/.test(value) && Number(value)<=points;
  const manual=Object.hasOwn(recordNames,value);
  const fill=hasScore || manual?recordColor(value,points):'';
  const mark=manual?({green:'●',yellow:'▲',red:'◆'})[value]:hasScore?(value==='0'?'✓':'−'+value):q.position;
  const label=titleText(p,q)+'，'+points+' 分，'+(manual?recordNames[value]+'标记':hasScore?'扣 '+value+' 分':'未记录');
  return '<button type="button" class="cell rec-cell" data-record="'+key+'" '+(fill?'style="--record-fill:'+fill+'" data-filled':'')+' title="'+label+'" aria-label="'+label+'">'+mark+'</button>';
}
function recordProgress(p,questions){
  const n=questions.filter(q=>readRecord(p.year+'-'+q.position)!==null).length;
  return '<b>'+n+'</b> / '+questions.length;
}
function dismissRecord(){
  if(recordEditor.matches(':popover-open'))recordEditor.hidePopover();
}
function saveRecord(key,value){
  const points=practiceText[key].points;
  if(value==='full')value=String(points);
  if(value==='clear')value=null;
  if(value!==null && !Object.hasOwn(recordColors,value) && (!/^\d+$/.test(value)||Number(value)>points)){
    recordNotice.textContent='本题满分 '+points+' 分，请重新选择扣分';
    return false;
  }
  const previous=readRecord(key);
  if(previous!==value){
    try{
      if(value===null)localStorage.removeItem(recordPrefix+key);
      else localStorage.setItem(recordPrefix+key,value);
    }catch{recordNotice.textContent='保存失败，请检查本机存储';return false;}
    recordUndo.push({key,previous,value});
    document.querySelector('#record-undo').disabled=false;
  }
  dismissRecord();
  refreshWorkspaceData();
  document.querySelector('[data-record="'+key+'"]')?.focus({preventScroll:true});
  recordNotice.textContent=practiceQuestionTitle(entriesByKey.get(key))+' · '+(value===null?'已清除':recordNames[value]|| (value==='0'?'满分':'−'+value+' 分'));
  return true;
}
function undoRecord(){
  const last=recordUndo.pop();
  if(!last)return;
  if(readRecord(last.key)!==last.value){recordNotice.textContent='此题记录已更新，已保留最新修改';}
  else{
    try{
      if(last.previous===null)localStorage.removeItem(recordPrefix+last.key);
      else localStorage.setItem(recordPrefix+last.key,last.previous);
      refreshWorkspaceData();
      recordNotice.textContent='已撤销 · '+practiceQuestionTitle(entriesByKey.get(last.key));
    }catch{recordUndo.push(last);recordNotice.textContent='撤销失败，请检查本机存储';}
  }
  document.querySelector('#record-undo').disabled=!recordUndo.length;
}
function activateRecord(button){
  const key=button.dataset.record;
  if(recordBrush.value!=='edit'){saveRecord(key,recordBrush.value);return;}
  recordKey=key;
  const entry=entriesByKey.get(key),points=practiceText[key].points,value=readRecord(key);
  const choices=Array.from({length:points+1},(_,i)=>'<button data-loss="'+i+'" aria-pressed="'+(String(i)===value)+'" style="--swatch:'+recordColor(String(i),points)+'">'+(i?'−'+i:'满分')+'</button>').join('');
  const colors=Object.entries(recordNames).map(([name,label])=>'<button class="record-dot" data-loss="'+name+'" style="--swatch:'+recordColors[name]+'" title="'+label+'" aria-label="仅标'+label+'" aria-pressed="'+(value===name)+'"></button>').join('');
  recordEditor.innerHTML='<header><strong id="record-heading">'+practiceQuestionTitle(entry)+'</strong><span>满分 '+points+' 分</span></header><div class="rec-topic">'+entry.q.topic+'</div><div class="rec-presets">'+choices+'</div><footer>仅标颜色 '+colors+'<button class="rec-clear" data-loss="clear">清除记录</button></footer>';
  recordEditor.showPopover();
  const rect=button.getBoundingClientRect(), box=recordEditor.getBoundingClientRect();
  recordEditor.style.left=Math.max(8,Math.min(innerWidth-box.width-8,rect.left+(rect.width-box.width)/2))+'px';
  recordEditor.style.top=Math.max(8,rect.bottom+box.height+8<=innerHeight?rect.bottom+6:rect.top-box.height-6)+'px';
  (recordEditor.querySelector('[aria-pressed=true]')||recordEditor.querySelector('button')).focus({preventScroll:true});
}
recordEditor.addEventListener('click',event=>{
  const button=event.target.closest('[data-loss]');
  if(button)saveRecord(recordKey,button.dataset.loss);
});
document.querySelector('#record-undo').addEventListener('click',undoRecord);
recordBrush.addEventListener('change',()=>{recordNotice.textContent=recordBrush.value==='edit'?'':'点选题格即可连续标记';});
window.addEventListener('resize',dismissRecord);
window.addEventListener('storage',event=>{
  if(view==='records' && (!event.key || event.key.startsWith(recordPrefix))){dismissRecord();refreshWorkspaceData();}
});
