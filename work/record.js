const recordPrefix='math2.exam-record.v1.';
const recordUndo=[];
const recordColors={green:'#55b393',yellow:'#e2bc59',red:'#df666b'};
const recordNames={green:'绿色',yellow:'黄色',red:'红色'};
const recordEditor=document.querySelector('#record-editor');
const recordNotice=document.querySelector('#record-notice');
let recordKey='';
function isObjective(key){
  return ['选择题','填空题'].includes(entriesByKey.get(key).q.type);
}
function readRecord(key){
  try{
    const stored=localStorage.getItem(recordPrefix+key);
    if(!key.startsWith('total-') && isObjective(key) && Number(stored)>0)return String(practiceText[key].points);
    return stored;
  }catch{return null;}
}
function recordColor(value,points){
  if(value in recordColors)return recordColors[value];
  return recordGradient(Number(value)/points*1.5);
}
function recordGradient(fraction){
  const scale=Math.max(0,Math.min(1,fraction))*2;
  const stops=[[85,179,147],[226,188,89],[223,102,107]];
  const index=Math.min(1,Math.floor(scale));
  return 'rgb('+stops[index].map((v,i)=>Math.round(v+(stops[index+1][i]-v)*(scale-index))).join(',')+')';
}
function recordCell(p,q){
  const key=p.year+'-'+q.position, points=practiceText[key].points;
  const value=readRecord(key);
  const hasScore=value!==null && /^\d+$/.test(value) && Number(value)<=points;
  const manual=Object.hasOwn(recordNames,value);
  const pending=manual && isObjective(key);
  const fill=!pending && (hasScore || manual)?recordColor(value,points):'';
  const mark=pending?'?':manual?({green:'●',yellow:'▲',red:'◆'})[value]:hasScore?(value==='0'?'✓':'−'+value):q.position;
  const label=titleText(p,q)+'，'+points+' 分，'+(pending?'旧颜色记录，待确认分数':manual?recordNames[value]+'标记':hasScore?'扣 '+value+' 分':'未记录');
  return '<button type="button" class="cell rec-cell" data-record="'+key+'" '+(fill?'style="--record-fill:'+fill+'" data-filled':'')+' title="'+label+'" aria-label="'+label+'">'+mark+'</button>';
}
function recordTotal(paper){
  let score=0, scored=0, marked=false, maximum=0;
  for(const q of paper.questions){
    const key=paper.year+'-'+q.position;
    const points=practiceText[key].points;
    const value=readRecord(key);
    maximum+=points;
    if(value!==null)marked=true;
    if(value!==null && /^\d+$/.test(value) && Number(value)<=points){
      score+=points-Number(value);
      scored++;
    }
  }
  const complete=!paper.partial && scored===paper.questions.length;
  const key='total-'+paper.year;
  const manual=readRecord(key);
  const displayed=manual??(marked?String(score):'-');
  const different=manual!==null && Number(manual)!==score;
  const color=complete?' style="--score-color:'+recordGradient((130-Number(displayed))/30)+'"':'';
  const label=paper.year+' 年 · '+(manual!==null?'手填 '+manual+' 分，':'')+'逐题累计 '+score+' 分，点击编辑总分';
  return '<button type="button" class="record-total" data-total="'+paper.year+'" data-max="'+maximum+'" data-sum="'+score+'"'+(different?' data-different':'')+color+' title="'+label+'" aria-label="'+label+'">'+displayed+'</button>';
}
function editTotal(button){
  const year=button.dataset.total;
  const key='total-'+year;
  const previous=readRecord(key);
  recordEditor.innerHTML='<header><strong id="record-heading">'+year+' 年总分</strong><span>逐题累计 '+button.dataset.sum+' 分</span></header><form class="total-form"><input aria-label="手填总分" type="number" min="0" max="'+button.dataset.max+'" step="any" placeholder="0–'+button.dataset.max+'"><button type="submit">保存</button></form><footer><button class="rec-clear" type="button">恢复逐题合计</button></footer>';
  const input=recordEditor.querySelector('input');
  input.value=previous??(button.textContent==='-'?'':button.textContent);
  function commit(value){
    if(readRecord(key)!==previous){dismissRecord();refreshWorkspaceData();recordNotice.textContent='总分已更新，请重新编辑';return;}
    if(value!==previous){
      try{
        if(value===null)localStorage.removeItem(recordPrefix+key);
        else localStorage.setItem(recordPrefix+key,value);
      }catch{recordNotice.textContent='保存失败，请检查本机存储';return;}
      recordUndo.push({key,value,previous,title:year+' 年总分'});
    }
    dismissRecord();
    refreshWorkspaceData();
    results.querySelector('[data-total="'+year+'"]')?.focus({preventScroll:true});
    recordNotice.textContent=year+' 年 · '+(value===null?'已恢复逐题合计':'已保存总分');
  }
  recordEditor.querySelector('form').onsubmit=event=>{
    event.preventDefault();
    commit(input.value===''?null:String(input.valueAsNumber));
  };
  recordEditor.querySelector('.rec-clear').onclick=()=>commit(null);
  positionRecordEditor(button);
  input.focus({preventScroll:true});
  input.select();
}
function dismissRecord(){
  if(recordEditor.matches(':popover-open'))recordEditor.hidePopover();
}
function saveRecord(key,value){
  const points=practiceText[key].points;
  if(value==='full')value=String(points);
  if(value==='clear')value=null;
  if(isObjective(key) && value!==null && value!=='0' && value!==String(points)){
    recordNotice.textContent='本题只可记满分或扣 '+points+' 分';
    return false;
  }
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
      recordNotice.textContent='已撤销 · '+(last.title??practiceQuestionTitle(entriesByKey.get(last.key)));
    }catch{recordUndo.push(last);recordNotice.textContent='撤销失败，请检查本机存储';}
  }
}
function activateRecord(button){
  const key=button.dataset.record;
  recordKey=key;
  const entry=entriesByKey.get(key),points=practiceText[key].points,value=readRecord(key);
  const objective=isObjective(key);
  const losses=objective?[0,points]:Array.from({length:points+1},(_,i)=>i);
  const choices=losses.map(i=>'<button data-loss="'+i+'" aria-pressed="'+(String(i)===value)+'" style="--swatch:'+recordColor(String(i),points)+'">'+(i?'−'+i:'满分')+'</button>').join('');
  const colors=objective?'':'仅标颜色 '+Object.entries(recordNames).map(([name,label])=>'<button class="record-dot" data-loss="'+name+'" style="--swatch:'+recordColors[name]+'" title="'+label+'" aria-label="仅标'+label+'" aria-pressed="'+(value===name)+'"></button>').join('');
  recordEditor.innerHTML='<header><strong id="record-heading">'+practiceQuestionTitle(entry)+'</strong><span>满分 '+points+' 分</span></header><div class="rec-topic">'+entry.q.topic+'</div><div class="rec-presets'+(objective?' rec-binary':'')+'">'+choices+'</div><footer>'+colors+'<button class="rec-clear" data-loss="clear">清除记录</button></footer>';
  positionRecordEditor(button);
  (recordEditor.querySelector('[aria-pressed=true]')||recordEditor.querySelector('button')).focus({preventScroll:true});
}
function positionRecordEditor(button){
  recordEditor.showPopover();
  const rect=button.getBoundingClientRect(), box=recordEditor.getBoundingClientRect();
  recordEditor.style.left=Math.max(8,Math.min(innerWidth-box.width-8,rect.left+(rect.width-box.width)/2))+'px';
  recordEditor.style.top=Math.max(8,rect.bottom+box.height+8<=innerHeight?rect.bottom+6:rect.top-box.height-6)+'px';
}
recordEditor.addEventListener('click',event=>{
  const button=event.target.closest('[data-loss]');
  if(button)saveRecord(recordKey,button.dataset.loss);
});
document.addEventListener('keydown',event=>{
  if(view==='records' && !dialog.open && !recordEditor.matches(':popover-open') && recordUndo.length &&
      (event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase()==='z'){
    event.preventDefault();
    undoRecord();
  }
});
window.addEventListener('resize',dismissRecord);
window.addEventListener('storage',event=>{
  if(view==='records' && (!event.key || event.key.startsWith(recordPrefix))){dismissRecord();refreshWorkspaceData();}
});
