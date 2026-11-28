const recordPrefix='math2.exam-record.v1.';
const recordUndo=[];
const recordFlags={careless:'粗心',learned:'已学会'};
function activeFlags(key){
  return Object.keys(recordFlags).filter(flag=>readRecord(flag+'-'+key)==='1');
}
function writeRecord(key,value,kind){
  if(value===null)localStorage.removeItem(recordPrefix+key);
  else localStorage.setItem(recordPrefix+key,value);
}
// Keep a batch as one undo step, including any successful writes before a storage failure.
function applyRecordChanges(target,title,updates,kind='edit'){
  const step={target,title,kind,changes:[]};
  let complete=true;
  try{
    for(const [key,value] of updates){
      const previous=readRecord(key);
      if(previous===value)continue;
      writeRecord(key,value,kind);
      step.changes.push({key,previous,value});
    }
  }catch{complete=false;}
  if(step.changes.length)recordUndo.push(step);
  if(!complete)recordNotice.textContent='存储失败，已保存 '+step.changes.length+' 项';
  return complete;
}
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
    if(Number(stored)>0 && entriesByKey.has(key) && isObjective(key))return String(practiceText[key].points);
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
  const flags=activeFlags(key);
  const badges=flags.map(flag=>'<i aria-hidden="true" class="rec-badge '+flag+'"></i>').join('');
  const label=titleText(p,q)+'，'+points+' 分，'+(pending?'旧颜色记录，待确认分数':manual?recordNames[value]+'标记':hasScore?'扣 '+value+' 分':'未记录')+flags.map(flag=>'，'+recordFlags[flag]).join('');
  return '<button type="button" class="cell rec-cell" data-record="'+key+'" '+(fill?'style="--record-fill:'+fill+'" data-filled':'')+' title="'+label+'" aria-label="'+label+'">'+mark+badges+'</button>';
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
function refreshRecordedScore(key){
  const isTotal=key.startsWith('total-');
  const year=isTotal?key.slice(6):key.split('-')[0];
  const totalSelector='[data-total="'+year+'"]';
  const oldTotal=results.querySelector(totalSelector);
  const oldText=oldTotal?.textContent, oldMismatch=oldTotal?.hasAttribute('data-different');
  refreshWorkspaceData();
  const total=results.querySelector(totalSelector);
  const target=isTotal?total:results.querySelector('[data-record="'+key+'"]');
  target?.classList.add('record-confirm');
  if(!isTotal && total && (total.textContent!==oldText || total.hasAttribute('data-different')!==oldMismatch)){
    total.classList.add('record-tally');
  }
  target?.focus({preventScroll:true});
}
function editTotal(button){
  const year=button.dataset.total;
  const key='total-'+year;
  const previous=readRecord(key);
  const yearKeys=Array.from(entriesByKey.keys()).filter(k=>k.startsWith(year+'-'));
  const unmarked=()=>yearKeys.filter(k=>readRecord(k)===null && !activeFlags(k).length);
  const count=unmarked().length;
  const latest=recordUndo.at(-1);
  const canUndo=latest?.kind==='fill' && latest.target===key;
  recordEditor.innerHTML='<header><strong id="record-heading">'+year+' 年总分</strong><span>逐题累计 '+button.dataset.sum+' 分</span></header><form class="total-form"><input aria-label="手填总分" type="number" min="0" max="'+button.dataset.max+'" step="any" placeholder="0–'+button.dataset.max+'"><button type="submit">保存</button></form><div class="rec-bulk"><button type="button" data-fill-year '+(count?'':'disabled')+'>未标记补满分 <small>'+count+' 题</small></button></div><footer>'+(canUndo?'<button type="button" class="rec-undo">撤销补全</button>':'')+'<button class="rec-clear" type="button">恢复逐题合计</button></footer>';
  const input=recordEditor.querySelector('input');
  input.value=previous??(button.textContent==='-'?'':button.textContent);
  function commit(value){
    if(readRecord(key)!==previous){dismissRecord();refreshWorkspaceData();recordNotice.textContent='总分已更新，请重新编辑';return;}
    if(!applyRecordChanges(key,year+' 年总分',[[key,value]]))return;
    dismissRecord();
    refreshRecordedScore(key);
    recordNotice.textContent=year+' 年 · '+(value===null?'已恢复逐题合计':'已保存总分');
  }
  recordEditor.querySelector('form').onsubmit=event=>{
    event.preventDefault();
    commit(input.value===''?null:String(input.valueAsNumber));
  };
  recordEditor.querySelector('.rec-clear').onclick=()=>commit(null);
  recordEditor.querySelector('[data-fill-year]').onclick=()=>{
    const blanks=unmarked();
    dismissRecord();
    const saved=applyRecordChanges(key,year+' 年补全',blanks.map(k=>[k,'0']),'fill');
    refreshRecordedScore(key);
    if(saved)recordNotice.textContent=year+' 年 · 已补全 '+blanks.length+' 题';
  };
  if(canUndo)recordEditor.querySelector('.rec-undo').onclick=()=>{dismissRecord();undoRecord();};
  positionRecordEditor(button);
  if(matchMedia('(pointer: coarse)').matches){
    recordEditor.querySelector('[data-fill-year]:enabled, .rec-clear').focus({preventScroll:true});
  }else{
    input.focus({preventScroll:true});
    input.select();
  }
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
  const updates=[[key,value]];
  if(value===null)for(const flag of activeFlags(key))updates.push([flag+'-'+key,null]);
  if(!applyRecordChanges(key,practiceQuestionTitle(entriesByKey.get(key)),updates)){
    refreshWorkspaceData();
    return false;
  }
  dismissRecord();
  refreshRecordedScore(key);
  recordNotice.textContent=practiceQuestionTitle(entriesByKey.get(key))+' · '+(value===null?'已清除':recordNames[value]|| (value==='0'?'满分':'−'+value+' 分'));
  return true;
}
function undoRecord(){
  const last=recordUndo.pop();
  if(!last)return;
  let skipped=0;
  while(last.changes.length){
    const change=last.changes.at(-1);
    if(readRecord(change.key)!==change.value)skipped++;
    else{
      try{writeRecord(change.key,change.previous);}
      catch{recordUndo.push(last);refreshWorkspaceData();recordNotice.textContent='撤销失败，请检查本机存储';return;}
    }
    last.changes.pop();
  }
  refreshRecordedScore(last.target);
  recordNotice.textContent='已撤销 · '+last.title+(skipped?'，已保留其他修改':'');
}
function activateRecord(button){
  const key=button.dataset.record;
  recordKey=key;
  const entry=entriesByKey.get(key),points=practiceText[key].points,value=readRecord(key);
  const objective=isObjective(key);
  const losses=objective?[0,points]:Array.from({length:points+1},(_,i)=>i);
  const choices=losses.map(i=>'<button data-loss="'+i+'" aria-pressed="'+(String(i)===value)+'" style="--swatch:'+recordColor(String(i),points)+'">'+(i?'−'+i:'满分')+'</button>').join('');
  const colors=objective?'':'仅标颜色 '+Object.entries(recordNames).map(([name,label])=>'<button class="record-dot" data-loss="'+name+'" style="--swatch:'+recordColors[name]+'" title="'+label+'" aria-label="仅标'+label+'" aria-pressed="'+(value===name)+'"></button>').join('');
  const flags=activeFlags(key);
  const toggles=Object.entries(recordFlags).map(([flag,name])=>'<button type="button" data-flag="'+flag+'" aria-pressed="'+flags.includes(flag)+'"><i aria-hidden="true" class="rec-icon '+flag+'"></i>'+name+'</button>').join('');
  recordEditor.innerHTML='<header><strong id="record-heading">'+practiceQuestionTitle(entry)+'</strong><span>满分 '+points+' 分</span></header><div class="rec-topic">'+entry.q.topic+'</div><div class="rec-presets'+(objective?' rec-binary':'')+'">'+choices+'</div><div class="rec-flags" role="group" aria-label="错题标记">'+toggles+'</div><footer>'+colors+'<button class="rec-clear" data-loss="clear">清除记录</button></footer>';
  positionRecordEditor(button);
  (recordEditor.querySelector('[aria-pressed=true]')||recordEditor.querySelector('button')).focus({preventScroll:true});
}
function positionRecordEditor(button){
  recordEditor.classList.remove('record-enter');
  recordEditor.showPopover();
  const rect=button.getBoundingClientRect(), box=recordEditor.getBoundingClientRect();
  recordEditor.style.left=Math.max(8,Math.min(innerWidth-box.width-8,rect.left+(rect.width-box.width)/2))+'px';
  recordEditor.style.top=Math.max(8,rect.bottom+box.height+8<=innerHeight?rect.bottom+6:rect.top-box.height-6)+'px';
  const x=Math.min(box.width,Math.max(0,rect.left+rect.width/2-parseFloat(recordEditor.style.left)));
  recordEditor.style.transformOrigin=x+'px '+(parseFloat(recordEditor.style.top)>=rect.bottom?'top':'bottom');
  recordEditor.classList.add('record-enter');
}
recordEditor.addEventListener('click',event=>{
  const toggle=event.target.closest('[data-flag]');
  if(toggle){
    const field=toggle.dataset.flag+'-'+recordKey;
    const value=readRecord(field)==='1'?null:'1';
    if(applyRecordChanges(recordKey,practiceQuestionTitle(entriesByKey.get(recordKey)),[[field,value]])){
      toggle.setAttribute('aria-pressed',String(value!==null));
      const cell=results.querySelector('[data-record="'+recordKey+'"]');
      const {p,q}=entriesByKey.get(recordKey);
      if(cell)cell.outerHTML=recordCell(p,q);
    }
    return;
  }
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
