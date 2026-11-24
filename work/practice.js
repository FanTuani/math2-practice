const practiceText = JSON.parse(document.querySelector('#question-content').textContent);
const entriesByKey = new Map(papers.flatMap(p=>p.questions.map(q=>{
  const key=p.year+'-'+q.position;
  return [key,{key,p,q,initial:q.status}];
})));
const markPrefix='math2.practice.mark.v1.';
const answerVisibility=new Map();
const choices=new Map();
const topicsById=Map.groupBy(Array.from(entriesByKey.values()),entry=>entry.q.topicId);
const iconShapes={
  back:'<path d="m10 5-7 7 7 7M3 12h18"/>',
  list:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 10h18M3 15h18"/>',
  single:'<path d="M6 2h8l5 5v15H6zM14 2v6h5M9 12h7m-7 4h7"/>',
  copy:'<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M15 5V3H3v12h2"/>',
  star:'<path d="m12 2.5 3 6.1 6.8 1-4.9 4.8 1.2 6.8-6.1-3.2-6.1 3.2 1.2-6.8-4.9-4.8 6.8-1z"/>',
  check:'<path d="m4 12 5 5L20 6"/>',
  answer:'<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  unsure:'<circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 3h.01"/>',
  cross:'<path d="m6 6 12 12m0-12L6 18"/>'
};
function practiceIcon(name){return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+iconShapes[name]+'</svg>';}
function paperNumber(entry){
  return entry.p.sectioned || entry.p.partial ? entry.q.number : '第'+entry.q.number+'题';
}
function practiceQuestionTitle(entry){return entry.p.year+'年'+paperNumber(entry);}
let practiceQueue=[], practiceIndex=0, practiceTitle='', practiceMode='single', cardObserver;
let currentTrigger, lastNotifiedKey='', dirtyOverview=false, stopScrollRestore;
const nextVersion=()=>crypto.randomUUID?.() ?? String(Date.now())+'-'+Math.random().toString(36).slice(2);
function loadMark(entry){
  let mark;
  try{mark=JSON.parse(localStorage.getItem(markPrefix+entry.key));}catch{}
  if(mark && statusKeys.includes(mark.status) && typeof mark.version==='string'){
    entry.q.status=mark.status;entry.version=mark.version;entry.pending=mark.pending===true;
  }else{
    entry.q.status=entry.initial;entry.version='snapshot';entry.pending=false;
  }
}
for(const entry of entriesByKey.values())loadMark(entry);
function persistMark(entry,status,pending,version){
  try{
    localStorage.setItem(markPrefix+entry.key,JSON.stringify({status,pending,version}));
  }catch{return false;}
  entry.q.status=status;entry.version=version;entry.pending=pending;
  dirtyOverview=true;
  return true;
}
function getQuestionData(key){
  const entry=entriesByKey.get(key);
  if(!entry)return null;
  return {key,year:entry.p.year,position:entry.q.position,number:entry.q.number,
    stem:practiceText[key].stem,status:entry.q.status,pending:entry.pending,version:entry.version};
}
window.getPracticeQuestion=getQuestionData;
window.getPracticeVersions=()=>Object.fromEntries(Array.from(entriesByKey,([key,entry])=>[key,entry.version]));
window.getOpenPracticeQuestion=()=>dialog.open && practiceQueue.length?getQuestionData(practiceQueue[practiceIndex].key):null;
function practiceEvent(name,detail){window.dispatchEvent(new CustomEvent('daguan:'+name,{detail}));}
function refreshHighlights(entry){
  if(!dialog.open)return;
  const card=body.querySelector('[data-card="'+entry.key+'"]');
  if(card && card.dataset.ready){
    for(const button of card.querySelectorAll('.pr-mark')){
      const selected=button.dataset.mark===entry.q.status;
      button.setAttribute('aria-pressed',String(selected));
      button.title=selected?'再次点击清除标记':labels[button.dataset.mark];
    }
    card.querySelector('[data-mark="u"]').hidden=entry.q.status==='u';
  }
  const number=body.querySelector('[data-jump="'+entry.key+'"]');
  if(number){
    number.className='pr-number s-'+entry.q.status;
    number.title=titleText(entry.p,entry.q)+' · '+labels[entry.q.status];
    number.setAttribute('aria-label',number.title);
  }
}
function refreshOverview(){
  if(!dialog.open && dirtyOverview){refreshWorkspaceData();dirtyOverview=false;}
}
window.addEventListener('storage',event=>{
  if(event.key!==null && !event.key.startsWith(markPrefix))return;
  const affected=event.key ? [entriesByKey.get(event.key.slice(markPrefix.length))].filter(Boolean) : entriesByKey.values();
  for(const entry of affected){loadMark(entry);refreshHighlights(entry);}
  dirtyOverview=true;refreshOverview();
});
window.addEventListener('daguan:state',event=>{
  const {key,status,version,confirmed,adopt}=event.detail||{};
  const entry=entriesByKey.get(key);
  if(!entry || !statusKeys.includes(status) || !version)return;
  loadMark(entry);
  if(version!==entry.version || (entry.pending && (!confirmed || (!adopt && status!==entry.q.status))))return;
  if(!entry.pending && status===entry.q.status)return;
  if(persistMark(entry,status,false,nextVersion())){refreshHighlights(entry);refreshOverview();}
});
function activeEntries(){
  let entries=selectedPapers().flatMap(p=>p.questions.filter(matchesSubject).map(q=>({p,q})));
  if(view==='review'||view==='bank' && bankMode==='weak')entries=entries.filter(({q})=>isWeak(q));
  if(statusFilter)entries=entries.filter(({q})=>q.status===statusFilter);
  return searchQuestions(entries,view==='bank'?bankSearch.value.trim():view==='matrix'?matrixSearch.value.trim():'');
}
function openChapter(id){openPractice(activeEntries().filter(({q})=>q.chapterId===id),chapters[id].name,'list');}
function openModule(id){
  if(id==='scope'){openPractice(bankQuestions,chapterFilter?chapters[chapterFilter].name:bankMode==='weak'?'薄弱队列':'题海练习','list');return;}
  const [kind,value]=id.split('-');
  let items,name;
  if(kind==='topic'){items=bankQuestions.filter(({q})=>q.topicId===value);name=items[0]?.q.topic;}
  else if(kind==='chapter'){items=bankQuestions.filter(({q})=>q.chapterId===value);name=chapters[value].name;}
  else{items=bankQuestions.filter(({q})=>q.subject===value);name=subjects[value];}
  openPractice(items,name,'list');
}
function handleDetail(event){
  const target=event.target.closest('[data-q],[data-year]');
  if(!target)return;
  const entry=entriesByKey.get(target.dataset.q);
  if(!entry){const p=papers.find(p=>p.year===Number(target.dataset.year));if(p)openPractice(p.questions.filter(matchesSubject).map(q=>({p,q})),p.year+' 年数二原卷','list');return;}
  const {p,q}=entry;
  let queue,name;
  if(view==='bank' && bankMode==='map'){queue=bankQuestions.filter(({q:item})=>item.topicId===q.topicId);name=q.topic;}
  else if(view==='review'||view==='bank'){queue=Array.from(results.querySelectorAll('[data-q]'),button=>entriesByKey.get(button.dataset.q));name='待复习';}
  else{queue=p.questions.filter(matchesSubject).map(q=>({p,q}));name=p.year+' 年数二原卷';}
  openPractice(queue,name,'single',entry.key);
}
function openPractice(items,title,mode,key){
  const queue=items.map(({p,q})=>entriesByKey.get(p.year+'-'+q.position));
  if(!queue.length)return;
  enterWorkspacePage();
  showPractice(queue,title,mode,key);
}
function showPractice(queue,title,mode,key){
  if(!dialog.open){
    detailOrigin=document.activeElement;
    currentTrigger=detailOrigin?.dataset;
  }
  practiceQueue=queue;
  practiceIndex=Math.max(0,queue.findIndex(e=>e.key===key));
  practiceTitle=title;practiceMode=mode;
  if(!dialog.open)dialog.showModal();
  paintPractice();
  body.querySelector('.pr-back').focus({preventScroll:true});
}
function practiceFrame(queue,index,title,mode){
  return {keys:queue.map(entry=>entry.key),current:queue[index].key,title,mode};
}
function firstVisibleCard(scrollArea,list){
  const top=scrollArea.getBoundingClientRect().top+12;
  let lo=0,hi=list.children.length-1;
  while(lo<hi){
    const mid=(lo+hi)>>1;
    if(list.children[mid].getBoundingClientRect().bottom<top)lo=mid+1;else hi=mid;
  }
  return lo;
}
function getPracticeResumeState(){
  if(!dialog.open || !practiceQueue.length)return null;
  const area=body.querySelector('.pr-scroll'),list=body.querySelector('.pr-cards');
  const anchor=list.children[firstVisibleCard(area,list)];
  const trigger=['q','chapter','module','year'].find(key=>currentTrigger?.[key]!==undefined);
  return {
    ...practiceFrame(practiceQueue,practiceIndex,practiceTitle,practiceMode),
    anchor:anchor.dataset.card,offset:anchor.getBoundingClientRect().top-area.getBoundingClientRect().top,
    related:Array.from(list.querySelectorAll('[data-face="related"][aria-pressed="true"]'),el=>el.closest('[data-card]').dataset.card),
    revealed:[...answerVisibility.keys()].filter(key=>answerVisibility.get(key)),choices:[...choices],
    trigger:trigger?[trigger,currentTrigger[trigger]]:null
  };
}
function readPracticeFrame(frame){
  if(!Array.isArray(frame?.keys) || frame.keys.length>entriesByKey.size || !['list','single'].includes(frame.mode))return null;
  const queue=Array.from(new Set(frame.keys),key=>entriesByKey.get(key)).filter(Boolean);
  const index=queue.findIndex(entry=>entry.key===frame.current);
  if(index<0)return null;
  return {queue,index,mode:frame.mode,title:typeof frame.title==='string'?frame.title:queue[index].q.topic};
}
function restoreReadingOffset(area,card,offset){
  if(!card || !Number.isFinite(offset))return;
  fillCard(card);
  const controller=new AbortController();
  const align=()=>{
    if(controller.signal.aborted)return;
    const change=card.getBoundingClientRect().top-area.getBoundingClientRect().top-offset;
    if(Math.abs(change)>.5)area.scrollTop+=change;
  };
  // Cards above this question grow as their formulas and figures enter the lazy render window.
  const layout=new ResizeObserver(align);
  layout.observe(card.parentElement);
  stopScrollRestore=()=>{controller.abort();layout.disconnect();stopScrollRestore=null;};
  for(const event of ['wheel','touchstart','pointerdown','keydown']){
    dialog.addEventListener(event,stopScrollRestore,{signal:controller.signal,capture:true,passive:true});
  }
  align();
  document.fonts.ready.then(align);
}
function restorePracticeResumeState(saved){
  const frame=readPracticeFrame(saved);
  if(!frame)return false;
  for(const key of Array.isArray(saved.revealed)?saved.revealed:[]){
    if(entriesByKey.has(key) && !answerVisibility.has(key))answerVisibility.set(key,true);
  }
  for(const pair of Array.isArray(saved.choices)?saved.choices:[]){
    if(Array.isArray(pair) && !choices.has(pair[0]) && practiceText[pair[0]]?.options && ['A','B','C','D'].includes(pair[1]))choices.set(pair[0],pair[1]);
  }
  showPractice(frame.queue,frame.title,frame.mode,frame.queue[frame.index].key);
  if(Array.isArray(saved.trigger) && ['q','chapter','module','year'].includes(saved.trigger[0]) && typeof saved.trigger[1]==='string'){
    const [key,value]=saved.trigger;
    currentTrigger={[key]:value};
    detailOrigin=results.querySelector('[data-'+key+'="'+CSS.escape(value)+'"]');
  }
  const related=new Set(Array.isArray(saved.related)?saved.related:[]);
  const cards=body.querySelector('.pr-cards');
  for(const card of cards.children){
    if(related.has(card.dataset.card)){fillCard(card);switchCardFace(card,entriesByKey.get(card.dataset.card),'related');}
  }
  const anchor=Array.from(cards.children).find(card=>card.dataset.card===saved.anchor);
  restoreReadingOffset(body.querySelector('.pr-scroll'),anchor,saved.offset);
  return true;
}
function safelyRender(text){
  return window.renderPracticeMarkdown(text);
}
function refreshFavorite(card){
  const star=card.querySelector('[data-favorite]');
  const selected=window.practiceFavorites?.get(card.dataset.card)===true;
  star.setAttribute('aria-pressed',String(selected));
  star.setAttribute('aria-label',selected?'取消收藏':'收藏');
  star.title=star.getAttribute('aria-label');
}
window.addEventListener('practice:favorite-change',event=>{
  const entry=entriesByKey.get(event.detail?.key);
  const card=entry && body.querySelector('[data-card="'+entry.key+'"][data-ready]');
  if(card)refreshFavorite(card);
});
async function copyPracticeQuestion(entry,card){
  const note=card.querySelector('.pr-copy-note'), data=practiceText[entry.key];
  const title=practiceQuestionTitle(entry)+(Number.isFinite(data.points)?'（'+data.points+'分）':'');
  const plain=title+'\n'+data.stem.replace(/!\[([^\]]*)\]\(data:image\/[^)]+\)/g,'【题图：$1】');
  const rich='<p>'+title+'</p>'+safelyRender(data.stem);
  let copied=false;
  try{
    if(window.ClipboardItem && navigator.clipboard?.write){
      const record=new ClipboardItem({'text/plain':new Blob([plain],{type:'text/plain'}),'text/html':new Blob([rich],{type:'text/html'})});
      await navigator.clipboard.write([record]);copied=true;
    }else if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(plain);copied=true;}
  }catch{}
  if(!copied){
    const transfer=event=>{
      if(!event.clipboardData)return;
      event.clipboardData.setData('text/plain',plain);event.clipboardData.setData('text/html',rich);event.preventDefault();
    };
    const field=document.createElement('textarea'),focus=document.activeElement;
    field.value=plain;field.className='pr-copy-field';field.setAttribute('aria-label','题目文本');
    card.append(field);field.select();
    document.addEventListener('copy',transfer);
    try{copied=document.execCommand('copy');}catch{}finally{
      document.removeEventListener('copy',transfer);field.remove();focus?.focus({preventScroll:true});
    }
  }
  note.textContent=copied?'已复制题目':'复制失败，请选择题干后复制';
  window.setTimeout(()=>{note.textContent='';},2600);
}
function fillCard(card){
  if(card.dataset.ready)return;
  const entry=entriesByKey.get(card.dataset.card),data=practiceText[entry.key],q=entry.q;
  const optionMarkup=data.options?'<div class="pr-choice-grid" role="group" aria-label="选择答案">'+data.options.map((option,i)=>{
    const letter='ABCD'[i];
    return '<button type="button" class="pr-choice" data-letter="'+letter+'" aria-pressed="false"><b>'+letter+'</b><span>'+safelyRender(option||letter)+'</span></button>';
  }).join('')+'</div>':'';
  card.classList.remove('pr-skeleton');card.dataset.ready='1';
  const related=topicsById.get(q.topicId).length>1;
  card.classList.toggle('pr-stacked',related);
  const tag=(name,text)=>'<span class="pr-tag '+name+'">'+text+'</span>';
  const actions='<div class="pr-head-actions"><span class="pr-copy-note" role="status"></span><button type="button" class="pr-copy" data-copy aria-label="复制题目" title="复制题目">'+practiceIcon('copy')+'</button><button type="button" class="pr-favorite" data-favorite aria-pressed="false" aria-label="收藏">'+practiceIcon('star')+'</button></div>';
  const tabs=related?'<div class="pr-stack-tabs" role="group" aria-label="题卡切换"><button type="button" data-face="original" aria-pressed="true">原题</button><button type="button" data-face="related" aria-pressed="false">同考点</button></div>':'';
  const markNames={M:'掌握',P:'不熟',N:'不会'},markIcons={M:'check',P:'unsure',N:'cross'};
  card.innerHTML=tabs+'<div class="pr-sheet"><header class="pr-card-head"><div class="pr-tags">'+tag('pr-year',entry.p.year)+tag('pr-index',paperNumber(entry))+
    (Number.isFinite(data.points)?tag('pr-points',data.points+'分'):'')+'</div>'+actions+'</header>'+
    '<div class="pr-original"><div class="pr-stem">'+safelyRender(data.prompt||data.stem)+'</div>'+optionMarkup+
    '<div class="pr-controls"><div class="pr-context"><span>'+subjects[q.subject]+' · '+q.topic+'</span>'+
    '<div class="pr-save"><span class="pr-sync-msg" role="status"></span><span class="pr-sync-actions"></span><button type="button" data-mark="u" class="pr-clear" hidden>清除标记</button></div></div>'+
    '<button type="button" class="pr-act" data-reveal aria-expanded="false">'+practiceIcon('answer')+'<span>查看答案</span></button></div>'+
    '<div class="pr-feedback"></div><div class="pr-marks" role="group" aria-label="掌握情况">'+
    ['M','P','N'].map(s=>'<button type="button" data-mark="'+s+'" class="pr-mark s-'+s+'">'+practiceIcon(markIcons[s])+'<span>'+markNames[s]+'</span></button>').join('')+
    '</div></div>'+
    '<div class="pr-related" hidden></div><div class="pr-favorite-note" data-favorite-message aria-live="polite"></div></div>';
  bindSyncCard(card);
  refreshHighlights(entry);showAnswer(card,entry);refreshFavorite(card);
  window.practiceFavorites?.paint(entry.key);
}
function switchCardFace(card,entry,face){
  const showRelated=face==='related';
  for(const button of card.querySelectorAll('[data-face]'))button.setAttribute('aria-pressed',String(button.dataset.face===face));
  const original=card.querySelector('.pr-original'),related=card.querySelector('.pr-related');
  original.hidden=showRelated;related.hidden=!showRelated;
  if(showRelated && !related.childElementCount){
    const matches=topicsById.get(entry.q.topicId).filter(e=>e!==entry);
    related.innerHTML='<h3>'+entry.q.topic+'</h3><div class="pr-related-list">'+matches.map(e=>
      '<button type="button" class="pr-related-item" data-related="'+e.key+'"><strong>'+practiceQuestionTitle(e)+'</strong><span>'+e.q.type+'</span></button>').join('')+'</div>';
  }
}
function leavePractice(){
  if(activeRoute.hasParent){
    history.back();
    return;
  }
  dialog.close();
  clearPaperLink();
}
function bindSyncCard(card){
  if(!card)return;
  card.dataset.syncKey=card.dataset.card;
  card.querySelector('.pr-sync-msg')?.setAttribute('data-sync-message','');
  card.querySelector('.pr-sync-actions')?.setAttribute('data-sync-actions','');
}
function showAnswer(card,entry){
  const open=answerVisibility.get(entry.key)===true, data=practiceText[entry.key],selected=choices.get(entry.key);
  const button=card.querySelector('[data-reveal]');
  button.setAttribute('aria-expanded',String(open));button.querySelector('span').textContent=open?'收起答案':'查看答案';
  for(const opt of card.querySelectorAll('[data-letter]')){
    const letter=opt.dataset.letter;
    opt.setAttribute('aria-pressed',String(selected===letter));
    opt.classList.toggle('correct',open && data.correctOption===letter);
    opt.classList.toggle('incorrect',open && selected===letter && data.correctOption!==letter);
  }
  const area=card.querySelector('.pr-feedback');
  if(!open){area.replaceChildren();return;}
  if(area.childElementCount)return;
  area.innerHTML='<section class="pr-answer"><h3>参考答案</h3><div class="pr-reading">'+safelyRender(data.answer)+'</div></section>'+
    '<section class="pr-solution"><h3>解析</h3><div class="pr-reading">'+safelyRender(data.explanation)+'</div></section>';
  if(data.answerSource?.startsWith('https://github.com/wangziyu1234/Mathematics-II-/')){
    const link=document.createElement('a');
    link.href=data.answerSource;link.textContent='查看解析来源';link.target='_blank';link.rel='noreferrer';link.className='pr-answer-source';area.append(link);
  }
}
function highlightIndex(entry){
  body.querySelector('#detail-title').textContent=practiceQuestionTitle(entry);
  const count=(practiceIndex+1)+' / '+practiceQueue.length;
  body.querySelector('[data-counter]').textContent=count;
  const mobileCount=body.querySelector('[data-mobile-count]');
  if(mobileCount)mobileCount.textContent=count;
  body.querySelector('[aria-current="true"]')?.removeAttribute('aria-current');
  const number=body.querySelector('[data-jump="'+entry.key+'"]');
  if(!number)return;
  number.setAttribute('aria-current','true');
  number.scrollIntoView({block:'nearest',inline:'nearest'});
}
function trackListPosition(scrollArea,list){
  let frame,timer;
  const track=()=>{scrollArea.dataset.manualScroll='true';};
  scrollArea.addEventListener('wheel',track,{passive:true});
  scrollArea.addEventListener('touchmove',track,{passive:true});
  scrollArea.addEventListener('pointerdown',event=>{if(event.target===scrollArea)track();});
  scrollArea.addEventListener('keydown',event=>{
    if(['PageUp','PageDown','Home','End','ArrowUp','ArrowDown',' '].includes(event.key))track();
  });
  scrollArea.addEventListener('scroll',()=>{
    if(frame)return;
    frame=requestAnimationFrame(()=>{
      frame=0;
      if(!dialog.open || practiceMode!=='list' || !list.isConnected || scrollArea.dataset.manualScroll!=='true')return;
      let lo=firstVisibleCard(scrollArea,list);
      if(scrollArea.scrollTop>0 && scrollArea.scrollTop+scrollArea.clientHeight>=scrollArea.scrollHeight-2)lo=list.children.length-1;
      if(practiceIndex!==lo){practiceIndex=lo;highlightIndex(practiceQueue[lo]);}
      clearTimeout(timer);
      const entry=practiceQueue[lo];
      timer=setTimeout(()=>{
        if(!dialog.open || !list.isConnected || practiceQueue[practiceIndex]!==entry || lastNotifiedKey===entry.key)return;
        lastNotifiedKey=entry.key;practiceEvent('open',getQuestionData(entry.key));
      },420);
    });
  },{passive:true});
}
function selectIndex(index,{scroll=false,notify=true}={}){
  if(!Number.isInteger(index)||index<0||index>=practiceQueue.length)return;
  const before=practiceQueue[practiceIndex]?.key;
  practiceIndex=index;
  const entry=practiceQueue[index],scrollArea=body.querySelector('.pr-scroll');
  scrollArea.dataset.manualScroll='false';
  if(practiceMode==='single'){
    const card=document.createElement('article');card.className='pr-card';card.dataset.card=entry.key;
    body.querySelector('.pr-cards').replaceChildren(card);fillCard(card);
    scrollArea.scrollTop=0;
  }
  const active=body.querySelector('[data-card="'+entry.key+'"]');
  fillCard(active);bindSyncCard(active);
  if(scroll && practiceMode==='list'){
    const inset=parseFloat(getComputedStyle(scrollArea).paddingTop);
    scrollArea.scrollTop=index===0?0:scrollArea.scrollTop+active.getBoundingClientRect().top-scrollArea.getBoundingClientRect().top-inset;
  }
  highlightIndex(entry);
  const prev=body.querySelector('.pr-step.prev'),next=body.querySelector('.pr-step.next');
  if(prev){prev.disabled=index===0;next.disabled=index===practiceQueue.length-1;}
  if(notify || before!==entry.key){lastNotifiedKey=entry.key;practiceEvent('open',getQuestionData(entry.key));}
}
function paintPractice(){
  stopScrollRestore?.();
  cardObserver?.disconnect();
  const single=practiceMode==='single';
  const navigation=single?'<nav class="pr-pager" aria-label="逐题切换"><button type="button" class="pr-step prev" data-step="-1" aria-label="上一题"><span>‹</span><small>上一题</small></button><span class="pr-mobile-count" data-mobile-count></span><button type="button" class="pr-step next" data-step="1" aria-label="下一题"><small>下一题</small><span>›</span></button></nav>':'';
  const outline=single || practiceQueue.length<2?'':'<aside class="pr-outline" aria-label="题目导航"><div class="pr-numbers">'+
    practiceQueue.map((entry,i)=>'<button type="button" class="pr-number s-'+entry.q.status+'" data-jump="'+entry.key+'" aria-label="'+titleText(entry.p,entry.q)+' · '+labels[entry.q.status]+'" title="'+titleText(entry.p,entry.q)+' · '+labels[entry.q.status]+'">'+(i+1)+'</button>').join('')+'</div></aside>';
  body.innerHTML='<header class="pr-top"><div class="pr-main-title"><button class="pr-back" type="button" aria-label="返回" data-leave>'+practiceIcon('back')+'<span>返回</span></button><h2 id="detail-title"></h2></div>'+
    '<div class="pr-modes" role="group" aria-label="练习模式"><button type="button" data-mode="list" aria-label="列表模式" aria-pressed="'+!single+'">'+practiceIcon('list')+'<span>列表模式</span></button><button type="button" data-mode="single" aria-label="单题模式" aria-pressed="'+single+'">'+practiceIcon('single')+'<span>单题模式</span></button></div>'+
    '<div class="pr-toolbar"><span data-counter></span></div></header><div class="pr-main '+(single?'pr-single':'')+'"><div class="pr-scroll"><div class="pr-cards"></div></div>'+
    navigation+outline+'</div>';
  body.querySelector('#detail-title').title=practiceTitle;
  if(!single){
    const list=body.querySelector('.pr-cards');
    list.innerHTML=practiceQueue.map(e=>'<article class="pr-card pr-skeleton" data-card="'+e.key+'" aria-label="'+titleText(e.p,e.q)+'"></article>').join('');
    cardObserver=new IntersectionObserver(items=>{for(const item of items)if(item.isIntersecting){fillCard(item.target);cardObserver.unobserve(item.target);}},
      {root:body.querySelector('.pr-scroll'),rootMargin:'450px'});
    for(const card of list.children)cardObserver.observe(card);
    trackListPosition(body.querySelector('.pr-scroll'),list);
  }
  selectIndex(practiceIndex,{scroll:!single});
}
body.addEventListener('click',event=>{
  const target=event.target.closest('button');
  if(!target)return;
  if(target.hasAttribute('data-leave')){leavePractice();return;}
  if(target.dataset.mode){if(practiceMode!==target.dataset.mode){practiceMode=target.dataset.mode;paintPractice();}return;}
  if(target.dataset.step){selectIndex(practiceIndex+Number(target.dataset.step));return;}
  if(target.dataset.jump){selectIndex(practiceQueue.findIndex(e=>e.key===target.dataset.jump),{scroll:true});return;}
  const card=target.closest('[data-card]');
  if(!card || !target.matches('[data-reveal],[data-letter],[data-mark],[data-copy],[data-favorite],[data-face],[data-related]'))return;
  const entry=entriesByKey.get(card.dataset.card);
  if(entry!==practiceQueue[practiceIndex] || lastNotifiedKey!==entry.key)selectIndex(practiceQueue.indexOf(entry));
  if(target.hasAttribute('data-copy')){copyPracticeQuestion(entry,card);return;}
  if(target.hasAttribute('data-favorite')){
    if(target.disabled)return;
    target.disabled=true;
    Promise.resolve().then(()=>window.practiceFavorites.toggle(entry.key)).catch(()=>{
      card.querySelector('[data-favorite-message]').textContent='收藏未能保存，请重试。';
    }).finally(()=>{target.disabled=false;refreshFavorite(card);});
    return;
  }
  if(target.dataset.face){switchCardFace(card,entry,target.dataset.face);return;}
  if(target.dataset.related){
    const next=entriesByKey.get(target.dataset.related);
    if(!next || next.q.topicId!==entry.q.topicId)return;
    enterWorkspacePage();
    practiceQueue=topicsById.get(entry.q.topicId);practiceIndex=practiceQueue.indexOf(next);
    practiceMode='single';practiceTitle=entry.q.topic;paintPractice();
    body.querySelector('.pr-back').focus({preventScroll:true});return;
  }
  if(target.hasAttribute('data-reveal')){
    answerVisibility.set(entry.key,!answerVisibility.get(entry.key));
    showAnswer(card,entry);
  }else if(target.dataset.letter){
    choices.set(entry.key,target.dataset.letter);showAnswer(card,entry);
  }else if(target.dataset.mark){
    loadMark(entry);
    const previous=entry.q.status,status=target.dataset.mark===previous?'u':target.dataset.mark;
    if(!persistMark(entry,status,true,nextVersion())){
      card.querySelector('.pr-sync-msg').textContent='保存失败，请检查浏览器存储空间。';return;
    }
    refreshHighlights(entry);
    card.querySelector('.pr-sync-msg').textContent='已存本机';
    practiceEvent('mark',{...getQuestionData(entry.key),previous});
  }
});
dialog.addEventListener('keydown',event=>{
  if(event.altKey||event.metaKey||event.ctrlKey||event.shiftKey||event.target.closest('input,textarea,select,[contenteditable=true]'))return;
  if(event.key==='ArrowLeft'||event.key==='ArrowRight'){
    event.preventDefault();selectIndex(practiceIndex+(event.key==='ArrowLeft'?-1:1),{scroll:true});
  }
});
dialog.addEventListener('cancel',event=>{event.preventDefault();leavePractice();});
dialog.addEventListener('close',()=>{
  if(dialog.open)return;
  stopScrollRestore?.();
  cardObserver?.disconnect();practiceQueue=[];body.replaceChildren();refreshOverview();
  let origin=detailOrigin;
  if(!origin?.isConnected && currentTrigger){
    const focusKey=['q','chapter','module','year'].find(k=>currentTrigger[k]!==undefined);
    if(focusKey)origin=results.querySelector('[data-'+focusKey+'="'+CSS.escape(currentTrigger[focusKey])+'"]');
  }
  origin?.focus({preventScroll:true});
});
