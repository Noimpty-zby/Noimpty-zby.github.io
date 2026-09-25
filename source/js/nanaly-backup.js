/* Browser-only encrypted migration. No network, plaintext key access or automatic restore. */
;(() => {
  'use strict'
  const root = typeof window === 'object' ? window : globalThis
  if (root.NANALY_BACKUP) return
  const FORMAT = 'nanaly-local-backup', JOURNAL = 'nanaly-backup-restore-v1'
  const MAX = 64 * 1024 * 1024, FILE_MAX = 90 * 1024 * 1024, ITERATIONS = 250000
  const LABELS = {'nanaly-vault-v1':'密钥保险箱','nanaly-config-v1':'模型设置','nanaly-workspace-v1':'聊天、草稿与确认记忆','nanaly-history-v1':'旧版聊天记录','nanaly-memory-v1':'阅读与提问记录','noimpty-schedule-cache-v1':'日程及未同步修改','noimpty-learning-v1':'练习草稿与提交记录','nanaly-agent-url':'后端地址','nanaly.article-tasks.v1':'文章检查任务记录','mao-play-v1':'Mao 纸条收藏与互动记录','nanaly-usage-v1':'模型用量账本'}
  const KEYS = Object.keys(LABELS)
  const DBS = { images: ['nanaly-images-v1','images'], files: ['nanaly-files-v1','files'] }
  const CONFIG = ['baseURL','model','reasonModel','reasonEffort','visionBaseURL','visionModel','proactive']
  const enc = new TextEncoder(), dec = new TextDecoder('utf-8', { fatal: true })
  const fail = message => { throw new Error(message) }
  const record = value => !!value && typeof value === 'object' && !Array.isArray(value)
  const string = (value, limit = 262144) => typeof value === 'string' && value.length <= limit
  const list = (value, limit) => Array.isArray(value) && value.length <= limit
  const id = value => typeof value === 'string' && /^[a-zA-Z0-9-]{1,160}$/.test(value)
  const json = value => JSON.stringify(value)
  const copy = value => JSON.parse(json(value))
  const marker = owner => '__nanaly_backup_'+owner
  const check = (condition, message = '备份记录格式不正确，未导入。') => { if (!condition) fail(message) }
  const exact = (value, allowed) => record(value) && Object.keys(value).every(key => allowed.includes(key))
  const bytes = value => enc.encode(value).byteLength
  const encode64 = buffer => {
    const view = new Uint8Array(buffer); let result = ''
    for (let i=0;i<view.length;i+=32768) result += String.fromCharCode(...view.subarray(i,i+32768))
    return btoa(result)
  }
  const decode64 = (value, maximum) => {
    check(string(value,Math.ceil(maximum/3)*4+4) && value.length%4===0 && /^[A-Za-z0-9+/]*={0,2}$/.test(value), '备份编码无效。')
    const raw = atob(value); check(raw.length<=maximum,'备份内容过大。')
    return Uint8Array.from(raw,c=>c.charCodeAt(0))
  }
  const tree = value => {
    let count=0
    const visit=(v,depth)=>{
      check(++count<=200000 && depth<=24,'备份结构过大或嵌套过深。')
      if(v===null || typeof v==='boolean')return
      if(typeof v==='number'){check(Number.isFinite(v));return}
      if(typeof v==='string'){check(v.length<=3000000,'备份中的单条内容过大。');return}
      check(Array.isArray(v)||record(v));check(Object.keys(v).length<=12000)
      for(const [k,item] of Object.entries(v)){check(!['__proto__','constructor','prototype'].includes(k));visit(item,depth+1)}
    };visit(value,0)
  }
  const safeURL = (value, originOnly=false) => {
    check(string(value,2048));let u;try{u=new URL(value)}catch(_){fail('备份中的接口地址无效。')}
    check(!u.username&&!u.password&&!u.search&&!u.hash&&(u.protocol==='https:'||u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname))&&(!originOnly||u.pathname==='/'),'备份中的接口地址无效。')
    return value
  }
  const refs = (items,type) => {
    check(list(items,2));for(const ref of items){check(record(ref)&&id(ref.id)&&string(ref.name,160));if(type==='images')check(/^image\/(jpeg|png|webp|gif)$/.test(ref.type));else check(['pdf','docx','text'].includes(ref.type))}
  }
  const messages = items => {
    check(list(items,120));for(const m of items){check(record(m)&&['user','assistant'].includes(m.role)&&string(m.content,32000));if(m.attachments)refs(m.attachments,'images');if(m.files)refs(m.files,'files')}
  }
  const session = s => {
    check(record(s)&&id(s.id)&&string(s.title,80));messages(s.messages)
    if(s.draft!==undefined)check(string(s.draft,32000))
    if(s.draftAttachments)refs(s.draftAttachments,'images');if(s.draftFiles)refs(s.draftFiles,'files')
    if(s.pending){check(record(s.pending)&&id(s.pending.id)&&string(s.pending.text,32000));if(s.pending.baseMessages)messages(s.pending.baseMessages);if(s.pending.attachments)refs(s.pending.attachments,'images');if(s.pending.files)refs(s.pending.files,'files')}
  }
  const validateLocal = (key,raw) => {
    check(KEYS.includes(key)&&string(raw,8*1024*1024),'备份包含不支持的本机记录。')
    if(key==='nanaly-agent-url'){safeURL(raw,true);return raw}
    let value;try{value=JSON.parse(raw)}catch(_){fail(LABELS[key]+'无法解析；旧记录未被修改。')}
    tree(value)
    if(key==='nanaly-vault-v1'){
      check(exact(value,['v','salt','iv','data'])&&value.v===1)
      check(decode64(value.salt,16).length===16&&decode64(value.iv,12).length===12&&decode64(value.data,65536).length>=16)
    }else if(key==='nanaly-config-v1'){
      check(exact(value,CONFIG));for(const [k,v]of Object.entries(value)){check(string(v,2048));if(k.endsWith('BaseURL')||k==='baseURL')safeURL(v)}
      if(value.reasonEffort)check(['low','high','max'].includes(value.reasonEffort));if(value.proactive)check(['gentle','off'].includes(value.proactive))
    }else if(key==='nanaly-workspace-v1'){
      check(value.v===1&&list(value.sessions,40)&&value.sessions.length>0&&list(value.memories,30));value.sessions.forEach(session)
      check(new Set(value.sessions.map(s=>s.id)).size===value.sessions.length&&value.sessions.some(s=>s.id===value.activeId))
      for(const m of value.memories)check(record(m)&&id(m.id)&&m.confirmed===true&&['preference','goal','fact','todo','correction','progress'].includes(m.kind)&&string(m.text,800))
      if(value.undo){check(record(value.undo)&&['delete','clear'].includes(value.undo.kind));if(value.undo.session)session(value.undo.session);if(value.undo.messages)messages(value.undo.messages)}
    }else if(key==='nanaly-history-v1')messages(value)
    else if(key==='nanaly-memory-v1'){
      check(record(value)&&list(value.asks,40)&&record(value.posts));for(const a of value.asks)check(record(a)&&string(a.t,80)&&string(a.on,1000)&&Number.isFinite(a.at))
      for(const p of Object.values(value.posts))check(record(p)&&Number.isFinite(p.n)&&p.n>=0&&Number.isFinite(p.at))
    }else if(key==='noimpty-schedule-cache-v1'){
      check(record(value)&&record(value.days));if(value._dirty!==undefined)check(typeof value._dirty==='boolean')
      const days=days=>{check(record(days));const ids=new Set();for(const [date,tasks]of Object.entries(days)){check(/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date))&&new Date(date).toISOString().slice(0,10)===date&&list(tasks,1000));for(const t of tasks){check(record(t)&&string(t.id,160)&&t.id&&!ids.has(t.id)&&string(t.text,16000)&&typeof t.done==='boolean');ids.add(t.id)}}}
      days(value.days);if(value._base!==undefined&&value._base!==null)days(value._base)
    }else if(key==='nanaly.article-tasks.v1'){
      check(exact(value,['v','tasks'])&&value.v===1&&list(value.tasks,10))
      check(new Set(value.tasks.map(t=>t?.id)).size===value.tasks.length)
      for(const t of value.tasks){check(record(t)&&t.repo==='Noimpty-zby/Noimpty-zby.github.io'&&t.kind==='article-links'&&typeof t.canRefresh==='boolean'&&/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(t.id)&&/^\/\d{4}\/\d{2}\/\d{2}\/[^/?#\\]+\/$/.test(t.path)&&string(t.path,512)&&!/[\u0000-\u001f]/.test(t.path)&&['github','browser'].includes(t.mode)&&['preparing','dispatching','queued','running','waiting','completed','failed','cancelled'].includes(t.state)&&Number.isFinite(Date.parse(t.startedAt))&&Number.isFinite(Date.parse(t.updatedAt)));if(t.runId!==undefined)check(Number.isSafeInteger(t.runId)&&t.runId>0);if(t.runUrl!==undefined)check(t.runUrl==='https://github.com/'+t.repo+'/actions/runs/'+t.runId);if(t.expectedSHA!==undefined)check(/^[a-f\d]{40}$/i.test(t.expectedSHA));if(t.sessionId!==undefined)check(string(t.sessionId,128)&&!/[\u0000-\u001f]/.test(t.sessionId));check(exact(t,['repo','id','kind','path','mode','state','sessionId','startedAt','updatedAt','canRefresh','runId','runUrl','expectedSHA']))}
    }else if(key==='mao-play-v1'){
      check(exact(value,['notes','feeds','feedAt'])&&list(value.notes,24)&&Number.isInteger(value.feeds)&&value.feeds>=0&&value.feeds<=99&&Number.isFinite(value.feedAt))
      for(const n of value.notes)check(exact(n,['kind','date'])&&Number.isInteger(n.kind)&&n.kind>=0&&n.kind<5&&/^\d{4}-\d{2}-\d{2}$/.test(n.date)&&Number.isFinite(Date.parse(n.date))&&new Date(n.date).toISOString().slice(0,10)===n.date)
    }else if(key==='nanaly-usage-v1'){
      check(exact(value,['hit','miss','out','turns','since']));for(const v of Object.values(value))check(typeof v==='number'&&Number.isFinite(v)&&v>=0)
    }else if(key==='noimpty-learning-v1'){
      check(record(value)&&value.version===1);if(value.persist!==undefined)check(typeof value.persist==='boolean');if(value.autoCheck!==undefined)check(typeof value.autoCheck==='boolean')
      if(value.drafts!==undefined){check(record(value.drafts));for(const[k,d]of Object.entries(value.drafts))check(['c','cpp','go','git','linux','mysql'].includes(k)&&record(d)&&string(d.code,65536)&&string(d.stdin,8192)&&list(d.tests,10))}
      for(const field of ['history','backups'])if(value[field]!==undefined){check(list(value[field],field==='history'?40:10));for(const r of value[field])check(record(r)&&string(r.code,65536)&&['c','cpp','go','git','linux','mysql'].includes(r.lessonId))}
    }
    return value
  }
  const image = value => {check(record(value)&&id(value.id)&&string(value.name,160)&&value.type==='image/jpeg'&&Number.isFinite(value.at)&&string(value.dataURL,2600000)&&/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(value.dataURL))}
  const file = value => {
    check(record(value)&&id(value.id)&&string(value.name,160)&&['pdf','docx','text'].includes(value.type)&&Number.isFinite(value.at)&&string(value.text,100000))
    check(list(value.images||[],2));for(const p of value.images||[])check(record(p)&&Number.isInteger(p.page)&&p.page>0&&string(p.dataURL,2000000)&&/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(p.dataURL))
  }
  const validate = payload => {
    check(exact(payload,['format','version','createdAt','sourceOrigin','local','images','files'])&&payload.format===FORMAT&&payload.version===1,'不是支持的本机备份版本。')
    check(Number.isFinite(Date.parse(payload.createdAt))&&string(payload.sourceOrigin,2048));safeURL(payload.sourceOrigin,true)
    check(record(payload.local)&&list(payload.images,1000)&&list(payload.files,1000));tree({images:payload.images,files:payload.files})
    for(const[k,v]of Object.entries(payload.local))validateLocal(k,v)
    for(const kind of ['images','files']){payload[kind].forEach(kind==='images'?image:file);check(new Set(payload[kind].map(v=>v.id)).size===payload[kind].length,'附件编号重复。')}
    check(bytes(json(payload))<=MAX,'本机备份超过64MB，未生成不完整文件。')
    return payload
  }
  const summarize = payload => {
    validate(payload)
    const workspace=payload.local['nanaly-workspace-v1']&&JSON.parse(payload.local['nanaly-workspace-v1'])
    const cfg=payload.local['nanaly-config-v1']&&JSON.parse(payload.local['nanaly-config-v1'])
    const missing=new Set(),images=new Set(payload.images.map(v=>v.id)),files=new Set(payload.files.map(v=>v.id))
    const scan=value=>{if(!value||typeof value!=='object')return;for(const[k,v]of Object.entries(value)){if(['attachments','draftAttachments'].includes(k)&&Array.isArray(v))v.forEach(r=>{if(!images.has(r.id))missing.add(r.id)});if(['files','draftFiles'].includes(k)&&Array.isArray(v))v.forEach(r=>{if(!files.has(r.id))missing.add(r.id)});if(v&&typeof v==='object')scan(v)}}
    scan(workspace)
    return {sourceOrigin:payload.sourceOrigin,createdAt:payload.createdAt,keys:Object.keys(payload.local),sessions:workspace?.sessions.length||0,messages:workspace?.sessions.reduce((n,s)=>n+s.messages.length,0)||0,memories:workspace?.memories.length||0,images:payload.images.length,files:payload.files.length,missingAttachments:missing.size,vault:!!payload.local['nanaly-vault-v1'],endpoints:[cfg?.baseURL,cfg?.visionBaseURL,payload.local['nanaly-agent-url']].filter(Boolean)}
  }
  const empty = (key,raw) => {
    if(raw===null)return true
    try{
      const value=validateLocal(key,raw)
      if(key==='nanaly-workspace-v1')return !value.memories.length&&!value.undo&&value.sessions.every(s=>!s.messages.length&&!s.pending&&!s.draft?.trim()&&!s.draftAttachments?.length&&!s.draftFiles?.length&&['新的话题','随便聊聊','未命名话题'].includes(s.title)&&s.titleSource!=='manual')
      if(key==='nanaly-history-v1')return !value.length
      if(key==='nanaly-memory-v1')return !value.asks.length&&!Object.keys(value.posts).length
      if(key==='noimpty-schedule-cache-v1')return !value._dirty&&!Object.keys(value.days).length&&!Object.keys(value._base||{}).length
      if(key==='noimpty-learning-v1')return !Object.keys(value.drafts||{}).length&&!(value.history||[]).length&&!(value.backups||[]).length
      if(key==='nanaly.article-tasks.v1')return !value.tasks.length
      if(key==='mao-play-v1')return !value.notes.length&&!value.feeds&&!value.feedAt
      if(key==='nanaly-usage-v1')return Object.entries(value).every(([k,v])=>k==='since'||v===0)
    }catch(_){}
    return false
  }
  function driver (indexedDB) {
    const open=(kind,write)=>new Promise((resolve,reject)=>{
      if(!indexedDB)return reject(new Error('浏览器未允许附件存储，不能完整备份或恢复。'))
      const[name,store]=DBS[kind];let missing=false
      const request=indexedDB.open(name)
      request.onupgradeneeded=()=>{if(!write){missing=true;request.transaction.abort()}else request.result.createObjectStore(store,{keyPath:'id'})}
      request.onerror=()=>missing?resolve(null):reject(new Error('无法打开附件存储：'+kind))
      request.onblocked=()=>reject(new Error('附件存储被其他页面占用，请关闭本站其他标签页。'))
      request.onsuccess=()=>{const db=request.result;if(db.version!==1||db.objectStoreNames.length!==1||!db.objectStoreNames.contains(store)){db.close();reject(new Error('附件库版本不兼容。'));return}db.onversionchange=()=>db.close();resolve(db)}
    })
    return {
      async read(kind){const db=await open(kind,false);if(!db)return [];try{return await new Promise((resolve,reject)=>{
        const tx=db.transaction(DBS[kind][1],'readonly'),rows=[];let size=0,error,dataCount=0,owners=0
        const cursor=tx.objectStore(DBS[kind][1]).openCursor()
        cursor.onsuccess=()=>{const item=cursor.result;if(!item)return;try{size+=bytes(json(item.value));const internal=id(item.value?.backupOwner)&&item.value.id===marker(item.value.backupOwner);if(internal)owners++;else dataCount++;check(size<=MAX&&dataCount<=1000&&owners<=1,'附件存储过大，未省略内容生成备份。');rows.push(item.value);item.continue()}catch(e){error=e;tx.abort()}}
        tx.oncomplete=()=>resolve(rows);tx.onerror=tx.onabort=()=>reject(error||new Error('附件读取失败。'))
      })}finally{db.close()}},
      async insert(kind,rows,owner){if(!rows.length)return;const db=await open(kind,true);try{await new Promise((resolve,reject)=>{
        const tx=db.transaction(DBS[kind][1],'readwrite'),store=tx.objectStore(DBS[kind][1]);let error
        const count=store.count();count.onsuccess=()=>{try{check(count.result===0,'附件库刚被其他页面写入，未覆盖。');store.add({id:marker(owner),backupOwner:owner});for(const row of rows)store.add(row)}catch(e){error=e;tx.abort()}}
        tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(error||new Error('附件写入失败，正在回滚。'))
      })}finally{db.close()}},
      async cleanup(kind,owner,expected=null){const db=await open(kind,false);if(!db)return;try{await new Promise((resolve,reject)=>{
        const tx=db.transaction(DBS[kind][1],'readwrite'),store=tx.objectStore(DBS[kind][1]);let error
        const owned=store.get(marker(owner));owned.onsuccess=()=>{
          if(owned.result?.backupOwner!==owner)return
          const remove=()=>{for(const row of expected||[])store.delete(row.id);store.delete(marker(owner))}
          if(!expected?.length){remove();return}
          let remaining=expected.length
          for(const row of expected){const request=store.get(row.id);request.onsuccess=()=>{try{check(request.result===undefined||json(request.result)===json(row),'附件在回滚期间被修改，未覆盖。');if(--remaining===0)remove()}catch(e){error=e;tx.abort()}}}
        }
        tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(error||new Error('附件回滚尚未完成，请保留此页面重试。'))
      })}finally{db.close()}}
    }
  }
  function create (options={}) {
    const storage=options.storage||root.localStorage, db=options.driver||driver(options.indexedDB||root.indexedDB), crypt=options.crypto||root.crypto
    const origin=options.origin||root.location.origin, now=options.now||(()=>new Date().toISOString())
    let busy=false
    const lock=options.lock||(root.navigator?.locks?fn=>root.navigator.locks.request('nanaly-local-backup',{mode:'exclusive'},fn):fn=>fn())
    const exclusive=async fn=>{check(!busy,'本页已有备份操作正在进行。');busy=true;try{return await lock(fn)}finally{busy=false}}
    const digest=async raw=>encode64(await crypt.subtle.digest('SHA-256',enc.encode(raw)))
    const key=async(pass,salt)=>{check(typeof pass==='string'&&pass.length>=10&&pass.length<=256,'备份密码请使用10至256个字符。');const material=await crypt.subtle.importKey('raw',enc.encode(pass),'PBKDF2',false,['deriveKey']);return crypt.subtle.deriveKey({name:'PBKDF2',salt,iterations:ITERATIONS,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt'])}
    const readLocal=()=>Object.fromEntries(KEYS.map(k=>[k,storage.getItem(k)]))
    const collect=()=>exclusive(async()=>{
      check(!storage.getItem(JOURNAL),'上次恢复尚未结束，请先完成回滚。')
      const before=readLocal(),local={}
      for(const[k,v]of Object.entries(before))if(v!==null){
        if(k==='nanaly-config-v1'){let value;try{value=JSON.parse(v)}catch(_){fail('模型配置损坏，未修改原记录。')}check(record(value));local[k]=json(Object.fromEntries(CONFIG.filter(field=>Object.hasOwn(value,field)).map(field=>[field,value[field]])))}
        else local[k]=v
      }
      const images=await db.read('images'),files=await db.read('files')
      check(json(readLocal())===json(before),'其他标签页改动了记录，请关闭它们后重新备份。')
      return validate({format:FORMAT,version:1,createdAt:now(),sourceOrigin:origin,local,images,files})
    })
    const seal=async(payload,password)=>{
      validate(payload);const salt=crypt.getRandomValues(new Uint8Array(16)),iv=crypt.getRandomValues(new Uint8Array(12))
      const encrypted=await crypt.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode(FORMAT+'/1')},await key(password,salt),enc.encode(json(payload)))
      return json({format:FORMAT,version:1,algorithm:'AES-256-GCM',kdf:'PBKDF2-SHA256',iterations:ITERATIONS,salt:encode64(salt),iv:encode64(iv),data:encode64(encrypted)})
    }
    const inspect=async(raw,password)=>{
      check(string(raw,FILE_MAX)&&bytes(raw)<=FILE_MAX,'文件过大或无效。');let box;try{box=JSON.parse(raw)}catch(_){fail('不是有效备份文件。')}
      check(exact(box,['format','version','algorithm','kdf','iterations','salt','iv','data'])&&box.format===FORMAT&&box.version===1&&box.algorithm==='AES-256-GCM'&&box.kdf==='PBKDF2-SHA256'&&box.iterations===ITERATIONS,'备份格式或加密参数不受支持。')
      const salt=decode64(box.salt,16),iv=decode64(box.iv,12),data=decode64(box.data,MAX+16)
      check(salt.length===16&&iv.length===12&&data.length>=16)
      const derived=await key(password,salt);let plain
      try{plain=await crypt.subtle.decrypt({name:'AES-GCM',iv,additionalData:enc.encode(FORMAT+'/1')},derived,data)}catch(_){fail('备份密码不正确，或文件已损坏；未写入任何数据。')}
      let payload;try{payload=JSON.parse(dec.decode(plain))}catch(_){fail('备份正文无效；未写入任何数据。')}
      return copy(validate(payload))
    }
    const recovery=async()=>{
      const raw=storage.getItem(JOURNAL);if(!raw)return false
      let journal;try{journal=JSON.parse(raw)}catch(_){fail('恢复日志损坏；为保护记录，未自动清理。')}
      check(exact(journal,['version','owner','committed','before','after','images','files'])&&journal.version===1&&id(journal.owner)&&typeof journal.committed==='boolean'&&record(journal.before)&&record(journal.after),'恢复日志格式无法识别。')
      for(const kind of ['images','files'])check(record(journal[kind])&&Object.keys(journal[kind]).length<=1000&&Object.entries(journal[kind]).every(([key,hash])=>id(key)&&string(hash,64)),'恢复日志附件编号无效。')
      for(const[k,value]of Object.entries(journal.before)){check(KEYS.includes(k)&&(value===null||string(value,8*1024*1024)));check(Object.hasOwn(journal.after,k)&&string(journal.after[k],64))}
      check(Object.keys(journal.after).length===Object.keys(journal.before).length)
      if(journal.committed){for(const kind of ['files','images'])await db.cleanup(kind,journal.owner);storage.removeItem(JOURNAL);check(!storage.getItem(JOURNAL));return 'completed'}
      const approved={}
      for(const[k,value]of Object.entries(journal.before)){const current=storage.getItem(k);approved[k]=current;if(current!==value&&current!==null)check(await digest(current)===journal.after[k],'恢复期间其他页面修改了记录；已停止，保留恢复日志，未覆盖新数据。')}
      for(const kind of ['files','images']){
        const rows=await db.read(kind),owned=rows.some(row=>row.id===marker(journal.owner)&&row.backupOwner===journal.owner)
        if(!owned)continue
        const expected=[]
        for(const row of rows){if(row.id===marker(journal.owner))continue;check(Object.hasOwn(journal[kind],row.id)&&await digest(json(row))===journal[kind][row.id],'附件在恢复后被其他页面修改；已停止回滚，保留新数据。');expected.push(row)}
        await db.cleanup(kind,journal.owner,expected)
      }
      // IndexedDB cleanup awaited above. Re-check all local keys together before
      // the synchronous rollback so an intervening write is never overwritten.
      for(const[k,value]of Object.entries(journal.before)){const current=storage.getItem(k);check(current===approved[k]||current===value,'附件清理期间其他页面修改了记录；已停止回滚，保留新数据。')}
      for(const[k,value]of Object.entries(journal.before)){if(value===null)storage.removeItem(k);else storage.setItem(k,value)}
      for(const[k,value]of Object.entries(journal.before))check(storage.getItem(k)===value,'本机存储回滚尚未完成，请保留页面重试。')
      storage.removeItem(JOURNAL);check(!storage.getItem(JOURNAL),'恢复日志清理失败。');return 'rolled-back'
    }
    const restore=payload=>exclusive(async()=>{
      payload=copy(validate(payload));check(!storage.getItem(JOURNAL),'请先回滚上次未完成的恢复。')
      const before=readLocal();for(const[k,v]of Object.entries(before))check(empty(k,v),'此浏览器已有'+LABELS[k]+'。当前仅支持恢复到空白目标，未覆盖任何记录。')
      check(!(await db.read('images')).length&&!(await db.read('files')).length,'此浏览器已有附件，未覆盖。请在空白目标恢复。')
      const journal={version:1,owner:crypt.randomUUID(),committed:false,before:{},after:{},images:{},files:{}}
      for(const[k,v]of Object.entries(payload.local)){journal.before[k]=before[k];journal.after[k]=await digest(v)}
      for(const kind of ['images','files'])for(const row of payload[kind])journal[kind][row.id]=await digest(json(row))
      check(json(readLocal())===json(before),'其他页面刚修改了记录，未导入。')
      storage.setItem(JOURNAL,json(journal));check(storage.getItem(JOURNAL)===json(journal),'无法保存恢复日志，未导入。')
      try{
        await db.insert('images',payload.images,journal.owner);await db.insert('files',payload.files,journal.owner)
        check(json(readLocal())===json(before),'恢复期间其他页面修改了记录。')
        for(const[k,v]of Object.entries(payload.local))storage.setItem(k,v)
        for(const[k,v]of Object.entries(payload.local))check(storage.getItem(k)===v,'本机记录写入校验失败。')
        for(const kind of ['images','files']){const actual=(await db.read(kind)).filter(row=>!(row.id===marker(journal.owner)&&row.backupOwner===journal.owner));check(actual.length===payload[kind].length&&actual.every(row=>payload[kind].some(expected=>row.id===expected.id&&json(row)===json(expected))),'附件写入校验失败。')}
        journal.committed=true;storage.setItem(JOURNAL,json(journal));check(storage.getItem(JOURNAL)===json(journal),'无法确认恢复提交状态。')
        for(const kind of ['files','images'])await db.cleanup(kind,journal.owner)
        storage.removeItem(JOURNAL);check(!storage.getItem(JOURNAL),'无法完成恢复日志清理。')
        return summarize(payload)
      }catch(error){let recovered;try{recovered=await recovery()}catch(_){fail('恢复或清理尚未完成。请保留备份文件并在此页重试恢复日志处理；未标记成功。')}if(recovered==='completed')return summarize(payload);fail('恢复失败，已回滚本次写入：'+error.message)}
    })
    return {collect,seal,inspect,restore,recover:()=>exclusive(recovery),pending:()=>!!storage.getItem(JOURNAL)}
  }
  root.NANALY_BACKUP=Object.freeze({create,validate,summarize,driver,KEYS:Object.freeze(KEYS),LABELS:Object.freeze(LABELS),JOURNAL,FILE_MAX})
})()
