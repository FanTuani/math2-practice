(() => {
  'use strict';
  const loopback = location.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(location.hostname);
  const labels = {M: '掌握', P: '不熟练', N: '不会', u: '未标记'};
  let session = {connected: false, canWrite: false, connectionId: null};
  let available = false;
  let cooldown = 0;
  let lastPoll = 0;
  let syncPanel;
  let globalError = '';
  let expiredId = null;
  let sessionRequest;
  const pendingOps = new Map();
  const observations = new Map();
  const presentations = new Map();
  const current = key => window.getPracticeQuestion?.(key) ||
    (window.getOpenPracticeQuestion?.()?.key === key ? window.getOpenPracticeQuestion() : null);
  const emit = detail => window.dispatchEvent(new CustomEvent('daguan:state', {detail}));
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = '练习资源/sync.css';
  document.head.append(stylesheet);

  function button(label, action) {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'dg-btn';
    element.textContent = label;
    element.addEventListener('click', action);
    return element;
  }
  function show(key, message, actions = []) {
    presentations.set(key, {message, actions});
    paint(key);
  }
  function paint(key) {
    const view = presentations.get(key);
    if (!view) return;
    const fields = Array.from(document.querySelectorAll('[data-sync-message], [data-sync-actions]'));
    for (const field of fields) {
      const forKey = field.closest('[data-sync-key]')?.dataset.syncKey || window.getOpenPracticeQuestion?.()?.key;
      if (forKey !== key) continue;
      if (field.hasAttribute('data-sync-message')) field.textContent = view.message;
      else field.replaceChildren(...view.actions.map(([name, action]) => button(name, action)));
    }
  }
  const favoritePrefix = 'math2.practice.favorite.v1.';
  const favoriteMessages = new Map();
  const favoriteChanges = new Map();
  let favoriteSequence = 0;
  function favoriteRecord(key) {
    try {
      const item = JSON.parse(localStorage.getItem(favoritePrefix + key));
      if (item && typeof item.value === 'boolean') return item;
    } catch { /* Storage can be disabled for file URLs. */ }
    return {value:false, pending:false, revision:null};
  }
  function paintFavorite(key) {
    const note = favoriteMessages.get(key);
    const fields = document.querySelectorAll('[data-sync-key="' + CSS.escape(key) + '"] [data-favorite-message]');
    for (const field of fields) {
      if (!note) field.replaceChildren();
      else field.replaceChildren(note.message, ...note.actions.map(([name, act]) => button(name, act)));
    }
  }
  function favoriteFeedback(key, message = '', actions = []) {
    if (message) favoriteMessages.set(key, {message,actions});
    else favoriteMessages.delete(key);
    paintFavorite(key);
  }
  function notifyFavorite(key) {
    favoriteChanges.set(key, ++favoriteSequence);
    const value = favoriteRecord(key).value;
    window.dispatchEvent(new CustomEvent('practice:favorite-change', {detail:{key,value}}));
    paintFavorite(key);
  }
  function saveFavorite(key, value, pending) {
    const record = {value, pending, revision:crypto.randomUUID()};
    try { localStorage.setItem(favoritePrefix + key, JSON.stringify(record)); }
    catch { favoriteFeedback(key,'收藏保存失败，请检查浏览器存储空间'); return null; }
    notifyFavorite(key);
    return record;
  }
  function currentConnection(state) {
    return session.connected && (!state.connectionId || state.connectionId === session.connectionId);
  }
  function canSaveFavorite(state) { return session.canWrite && (state.canWriteFavorite ?? session.canWriteFavorite) !== false; }
  function receiveFavorite(key, state) {
    if (typeof state.favorite !== 'boolean' || !currentConnection(state)) return;
    const local = favoriteRecord(key);
    if (local.pending && local.value !== state.favorite) {
      const account = session.connectionId;
      const isCurrent = () => favoriteRecord(key).revision === local.revision && session.connectionId === account;
      const actions = [];
      if (canSaveFavorite(state)) actions.push(['同步本机收藏', () => {
        if (isCurrent()) enqueue(key, () => sendFavorite(key, local, state, account), favoriteError(key));
      }]);
      actions.push(['使用大观园收藏', () => enqueue(key, async () => {
        if (!isCurrent()) return;
        const live = await request('question', readArgs(current(key)));
        if (!isCurrent() || !currentConnection(live)) return;
        if (!live.matched) return candidates(current(key), live);
        if (typeof live.favorite !== 'boolean') return;
        if (saveFavorite(key,live.favorite,false)) favoriteFeedback(key,'收藏状态已同步');
      }, favoriteError(key))]);
      favoriteFeedback(key, '大观园' + (state.favorite ? '已收藏' : '未收藏'), actions);
      return;
    }
    if (local.pending || local.value !== state.favorite) {
      if (saveFavorite(key, state.favorite, false)) favoriteFeedback(key, local.pending ? '收藏状态已同步' : '');
    }
  }
  const favoriteError = key => err => favoriteFeedback(key, '收藏已存本机 · ' + err.message,
    [['检查同步', () => enqueue(key, () => read(current(key)), favoriteError(key))]]);
  async function sendFavorite(key, local, observed, connectionId) {
    if (favoriteRecord(key).revision !== local.revision || !session.connected || session.connectionId !== connectionId) return;
    if (!canSaveFavorite(observed)) {
      await read(current(key));
      return;
    }
    if (Date.now() < cooldown) throw new Error('大观园限流，请稍后再试');
    try {
      const result = await request('favorite', {key,id:observed.id,expected:observed.favorite,favorite:local.value,connectionId});
      if (!currentConnection(result) || connectionId !== session.connectionId) return;
      if (!result.matched || result.favorite !== local.value) throw new Error('大观园尚未确认收藏状态');
      observations.set(key,result);
      if (favoriteRecord(key).revision === local.revision) receiveFavorite(key,result);
    } catch (err) {
      if (err.status === 409) { await read(current(key)); return; }
      throw err;
    }
  }
  function toggleFavorite(key) {
    const q = current(key);
    if (!q) return;
    const previous = favoriteRecord(key).value;
    const local = saveFavorite(key,!previous,true);
    if (!local) return;
    favoriteFeedback(key, local.value ? '已收藏到本机' : '已在本机取消收藏');
    const account = session.connectionId;
    if (!available || !session.connected) return;
    return enqueue(key, async () => {
      if (account !== session.connectionId || favoriteRecord(key).revision !== local.revision) return;
      let state = observations.get(key);
      if (typeof state?.favorite !== 'boolean') state = await request('question',readArgs(q));
      if (!currentConnection(state) || account !== session.connectionId) return;
      if (!state.id) return candidates(q,state);
      if (typeof state.favorite !== 'boolean') throw new Error('当前连接未返回收藏状态');
      await sendFavorite(key,local,state,account);
    }, favoriteError(key));
  }
  window.practiceFavorites = {get:key=>favoriteRecord(key).value, toggle:toggleFavorite, paint:paintFavorite};
  window.addEventListener('storage', event => {
    if (event.key?.startsWith(favoritePrefix)) {
      const key = event.key.slice(favoritePrefix.length);
      favoriteMessages.delete(key);
      notifyFavorite(key);
    } else if (event.key === null) {
      favoriteMessages.clear();
      document.querySelectorAll('[data-sync-key]').forEach(el=>notifyFavorite(el.dataset.syncKey));
    }
  });

  function enqueue(key, work, onError = err => show(key, err.message || '同步暂不可用')) {
    const ready = pendingOps.get(key) || Promise.resolve();
    const task = ready.then(work).catch(onError);
    pendingOps.set(key, task);
    task.finally(() => { if (pendingOps.get(key) === task) pendingOps.delete(key); });
    return task;
  }
  async function request(path, data) {
    const options = {cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(40000)};
    if (data !== undefined) Object.assign(options, {
      method: 'POST', headers: {'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf || ''},
      body: JSON.stringify(data)
    });
    let response;
    try { response = await fetch('/api/' + path, options); }
    catch { throw new Error('本机同步服务暂时无法连接'); }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 && session.connectionId) {
        expiredId = session.connectionId; session = {...session, connected:false, canWrite:false}; renderConnect();
      }
      if (response.status === 429) cooldown = Date.now() + Math.max(5, Number(payload.retryAfter) || 60) * 1000;
      const err = new Error(payload.error || '大观园同步请求失败');
      err.status = response.status;
      throw err;
    }
    return payload;
  }
  function renderConnect() {
    const slot = document.querySelector('#daguan-connect');
    if (!slot) return;
    const name = !available ? '本机练习' : !session.connected ? '连接大观园' : session.canWrite ? '大观园已连接' : '大观园只读';
    const trigger = button(name, () => { renderPanel(); syncPanel.showModal(); });
    trigger.classList.add('dg-connect');
    slot.replaceChildren(trigger);
  }
  async function loadSession() {
    if (!loopback) { renderConnect(); return; }
    if (sessionRequest) return sessionRequest;
    sessionRequest = (async () => {
      try {
        const next = await request('session');
        if (typeof next.csrf !== 'string') throw new Error('同步服务未启动');
        if (session.connectionId !== next.connectionId) { observations.clear(); presentations.clear(); favoriteMessages.clear(); }
        session = next.connectionId && next.connectionId === expiredId ? {...next,connected:false,canWrite:false} : next;
        available = true; globalError = '';
      } catch (error) { available = false; globalError = error.message; }
      finally { renderConnect(); sessionRequest = null; }
    })();
    return sessionRequest;
  }
  function renderPanel() {
    if (!syncPanel) {
      syncPanel = document.createElement('dialog');
      syncPanel.className = 'dg-panel';
      syncPanel.setAttribute('aria-labelledby', 'dg-title');
      document.body.append(syncPanel);
    }
    const title = document.createElement('h2'); title.id = 'dg-title'; title.textContent = '大观园同步';
    const text = document.createElement('p');
    const actions = document.createElement('div'); actions.className = 'dg-actions';
    if (!available) {
      text.textContent = '在成品文件夹双击「启动数二练习.command」，即可在浏览器中连接大观园。当前浏览器会保存你的本地标记。';
      if (location.protocol === 'file:') {
        const link = document.createElement('a');
        link.href = 'http://127.0.0.1:17846/';
        link.textContent = '打开已启动的练习站'; link.className = 'dg-btn'; actions.append(link);
      }
    } else {
      text.textContent = session.connected
        ? session.canWrite ? '掌握标记和收藏会同步到大观园。返回页面后会检查近期的进度变化。' : '已授权读取学习进度。允许写入后，可以直接在这里标记大观园的题目。'
        : '连接你自己的大观园账号，在这里同步每道题的掌握情况和收藏。';
      const connect = write => async () => {
        actions.querySelectorAll('button').forEach(el => el.disabled = true);
        try {
          const {url} = await request('connect', {write});
          const destination = new URL(url);
          if (destination.origin !== 'https://cxyonly.fans') throw new Error('授权地址无效');
          location.assign(destination.href);
        } catch (error) { globalError = error.message; renderPanel(); }
      };
      if (!session.connected || !session.canWrite) actions.append(button('授权读写进度', connect(true)));
      if (!session.connected) actions.append(button('只读连接', connect(false)));
      if (session.connected) actions.append(button('断开连接', async () => {
        try { await request('disconnect', {connectionId: session.connectionId}); await loadSession(); }
        catch (error) { globalError = error.message; }
        renderPanel();
      }));
    }
    const close = button('关闭', () => syncPanel.close());
    const error = document.createElement('p'); error.className = 'dg-error'; error.textContent = globalError;
    syncPanel.replaceChildren(title, text, ...(globalError ? [error] : []), actions, close);
  }
  const readArgs = q => ({key:q.key, number:String(q.number), stem:String(q.stem || '').replace(/!\[[^\]]*\]\(data:image\/[^)]+\)/g, '').slice(0,12000)});
  const wire = value => Object.hasOwn(labels, value);
  function synced(q, state) {
    observations.set(q.key,state);
    receiveFavorite(q.key,state);
    emit({key:q.key,status:state.status,version:q.version,confirmed:true,message:'已同步'});
    show(q.key, '已同步 · 大观园 #' + state.id);
  }
  function resolveDifference(q, state) {
    const active = current(q.key);
    if (!active?.pending || active.version !== q.version) return;
    if (q.status === state.status) { synced(q, state); return; }
    const actions = [];
    if (session.canWrite) actions.push(['同步本机标记', () => {
      if (current(q.key)?.version !== q.version) return;
      enqueue(q.key, () => write(q, state));
    }]);
    actions.push(['使用大观园标记', () => enqueue(q.key, async () => {
      if (current(q.key)?.version !== q.version) return;
      const live = await request('question', readArgs(q));
      if (!live.matched) return candidates(q, live);
      if (live.status !== state.status) return resolveDifference(q, live);
      // Explicit choice is required to replace a locally pending mark.
      emit({key:q.key,status:live.status,version:q.version,confirmed:true,adopt:true,message:'已同步'});
      observations.set(q.key, live);
      show(q.key, '已同步 · 大观园 #' + live.id);
    })]);
    show(q.key, '已存本机 · 大观园为「' + labels[state.status] + '」', actions);
  }
  function candidates(q, result) {
    const action = () => candidatePicker(q, result);
    show(q.key, '已存本机 · ' + (result.message || '尚未关联大观园题目'), [['匹配题目', action]]);
  }
  function candidatePicker(q, result) {
    const panel = document.createElement('dialog'); panel.className = 'dg-panel';
    panel.setAttribute('aria-label','关联大观园题目');
    const title = document.createElement('h2'); title.textContent = '关联大观园题目';
    panel.append(title);
    for (const entry of result.candidates || []) {
      const source = document.createElement('strong'); source.textContent = '#' + entry.id + ' ' + (entry.source || '');
      const preview = document.createElement('p');
      preview.innerHTML = window.renderPracticeMarkdown(String(entry.stem || '').slice(0,1400));
      panel.append(source, preview, button('关联这道题', () => {
        panel.close();
        enqueue(q.key, async () => {
          const state = await request('link', {key:q.key,id:entry.id,connectionId:session.connectionId});
          const active = current(q.key);
          if (active && state.matched) reconcile(active,state);
        });
      }));
    }
    const label = document.createElement('label'); label.textContent = '输入大观园题目 ID';
    const field = document.createElement('input'); field.type = 'number'; field.min = '1'; label.append(field);
    panel.append(label, button('查找', async () => {
      const id = Number(field.value);
      if (!Number.isSafeInteger(id) || id <= 0) return;
      try {
        const lookup = await request('question',{...readArgs(q),id});
        panel.close();
        if (lookup.matched) reconcile(q,lookup);
        else candidatePicker(q,lookup);
      } catch (e) { field.setCustomValidity(e.message); field.reportValidity(); field.setCustomValidity(''); }
    }), button('取消', () => panel.close()));
    panel.addEventListener('close',()=>panel.remove(),{once:true});
    document.body.append(panel); panel.showModal();
  }
  function reconcile(q, state) {
    if (!state.matched) return candidates(q, state);
    receiveFavorite(q.key,state);
    if (!wire(state.status)) return show(q.key, '大观园返回了未知的掌握状态');
    observations.set(q.key, state);
    const active = current(q.key);
    if (!active || active.version !== q.version) return;
    if (active.pending) return resolveDifference(active, state);
    emit({key:q.key,status:state.status,version:q.version,message:'已同步'});
    show(q.key, '已同步 · 大观园 #' + state.id);
  }
  async function read(q) {
    if (!q || !available || !session.connected || Date.now() < cooldown) return;
    const connection = session.connectionId;
    const state = await request('question', readArgs(q));
    if (session.connectionId === connection && (!state.connectionId || state.connectionId === connection)) reconcile(q,state);
  }
  async function write(q, observed) {
    if (!available || !session.canWrite || !session.connected || current(q.key)?.version !== q.version) return;
    if (Date.now() < cooldown) return show(q.key, '已存本机 · 大观园限流，稍后可重试');
    const connectionId = session.connectionId;
    try {
      const result = await request('mark',{key:q.key,id:observed.id,expected:observed.status,status:q.status,connectionId});
      if (connectionId !== session.connectionId || (result.connectionId && result.connectionId !== connectionId)) return;
      if (!result.matched || result.status !== q.status) throw new Error('大观园尚未确认该标记');
      observations.set(q.key,result);
      if (current(q.key)?.version === q.version) synced(q,result);
    } catch (err) {
      if (err.status === 409) { await read(q); return; }
      show(q.key, '已存本机 · ' + err.message, [['检查同步',()=>enqueue(q.key,()=>read(current(q.key)))]]);
    }
  }
  window.addEventListener('daguan:open', event => {
    const q = event.detail;
    paint(q.key);
    if (!session.connected) { show(q.key, q.pending ? '已存本机' : '本机进度'); return; }
    enqueue(q.key, () => read(q));
  });
  window.addEventListener('daguan:mark', event => {
    const q = event.detail;
    show(q.key, '已存本机');
    const connection = session.connectionId;
    if (!available || !session.connected) return;
    enqueue(q.key, async () => {
      if (connection !== session.connectionId || current(q.key)?.version !== q.version) return;
      let state = observations.get(q.key);
      if (!state) state = await request('question', readArgs(q));
      if (connection !== session.connectionId || (state.connectionId && state.connectionId !== connection)) return;
      if (!state.id) return candidates(q,state);
      if (!wire(state.status)) return;
      if (state.status === q.status) return synced(q,state);
      if (state.status !== q.previous || !session.canWrite) return resolveDifference(q,state);
      await write(q,state);
    });
  });
  async function refresh() {
    if (document.hidden || !loopback || Date.now() - lastPoll < 5000 || Date.now() < cooldown) return;
    lastPoll = Date.now();
    await loadSession();
    if (!available || !session.connected) return;
    const focused = window.getOpenPracticeQuestion?.();
    if (focused) enqueue(focused.key,()=>read(focused));
    const connection = session.connectionId;
    const stamp = window.getPracticeVersions?.();
    const favoriteStamp = favoriteSequence;
    try {
      const updates = await request('updates',{connectionId:connection});
      if (connection !== session.connectionId || updates.connectionId !== connection) return;
      for (const item of updates.items || []) {
        const q = current(item.key);
        if (!q || pendingOps.has(item.key) || q.key === focused?.key) continue;
        if ((favoriteChanges.get(item.key) || 0) > favoriteStamp) continue;
        observations.set(item.key,{...item,connectionId:connection});
        receiveFavorite(item.key,{...item,connectionId:connection});
        if (q.pending || !wire(item.status)) continue;
        if (stamp && stamp[q.key] !== q.version) continue;
        if (q.status !== item.status) reconcile(q,{...item,matched:true});
      }
    } catch { /* Focused-question refresh remains independently available. */ }
  }
  document.addEventListener('DOMContentLoaded', () => { renderConnect(); refresh(); });
  document.addEventListener('visibilitychange',refresh);
  window.addEventListener('focus',refresh);
  setInterval(refresh,60000);
})();
