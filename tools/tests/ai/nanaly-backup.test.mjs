import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { webcrypto } from 'node:crypto'
import vm from 'node:vm'

const source=readFileSync('source/js/nanaly-backup.js','utf8')
const window={crypto:webcrypto,location:{origin:'https://old.example'}}
vm.runInNewContext(source,{window,TextEncoder,TextDecoder,URL,Uint8Array,btoa,atob,console})
const API=window.NANALY_BACKUP,clone=value=>JSON.parse(JSON.stringify(value)),pass='fixture-password-123'
const workspace=()=>({v:1,activeId:'topic-main',sessions:[{id:'topic-main',title:'新的话题',titleSource:'local',messages:[],draft:'',pending:null,draftAttachments:[],draftFiles:[]}],memories:[],undo:null})
const image={id:'image-first',name:'screenshot.jpg',type:'image/jpeg',at:100,dataURL:'data:image/jpeg;base64,AA=='}
const file={id:'file-first',name:'example.pdf',type:'pdf',size:1234,at:100,text:'Private parsed document',images:[{page:1,dataURL:'data:image/jpeg;base64,AQ=='}],readPages:[1],imagePages:[1],pageCount:1,truncated:false,summary:'One page'}
const refs=({id,name,type})=>({id,name,type})
function fixture(){
  const w=workspace();w.sessions[0].title='Private topic';w.sessions[0].draft='unsent draft';w.sessions[0].messages=[{role:'user',content:'Private chat',at:100,attachments:[refs(image)],files:[refs(file)]}]
  w.memories=[{id:'memory-one',kind:'fact',text:'Private memory',confirmed:true,updatedAt:100}]
  return {format:'nanaly-local-backup',version:1,createdAt:'2026-09-25T00:00:00.000Z',sourceOrigin:'https://old.example',local:{
    'nanaly-vault-v1':JSON.stringify({v:1,salt:btoa('s'.repeat(16)),iv:btoa('i'.repeat(12)),data:btoa('encrypted-keys-fixture')}),
    'nanaly-config-v1':JSON.stringify({baseURL:'https://api.deepseek.com',model:'fixture-model',visionBaseURL:'https://api.siliconflow.cn/v1',visionModel:'fixture-vision',reasonModel:'fixture-reason',reasonEffort:'high',proactive:'off'}),
    'nanaly-workspace-v1':JSON.stringify(w),'nanaly-history-v1':JSON.stringify([{role:'assistant',content:'Legacy private chat'}]),
    'nanaly-memory-v1':JSON.stringify({asks:[{t:'Private question',on:'Article',at:100}],posts:{Article:{n:1,at:100}},since:100}),
    'noimpty-schedule-cache-v1':JSON.stringify({days:{'2026-09-25':[{id:'task-one',text:'Unsent plan',done:false}]},_dirty:true,_base:{'2026-09-25':[{id:'task-one',text:'Old plan',done:false}]}}),
    'noimpty-learning-v1':JSON.stringify({version:1,persist:true,autoCheck:false,drafts:{c:{code:'int main(){}',stdin:'',tests:[],exercise:null}},history:[],backups:[]}),
    'nanaly-agent-url':'https://api.noimpty-zby.cn',
    'nanaly.article-tasks.v1':JSON.stringify({v:1,tasks:[{repo:'Noimpty-zby/Noimpty-zby.github.io',id:'12345678-1234-1234-1234-123456789abc',kind:'article-links',path:'/2026/09/25/test/',mode:'github',state:'waiting',sessionId:'topic-main',startedAt:'2026-09-25T00:00:00Z',updatedAt:'2026-09-25T00:00:00Z',canRefresh:true,runId:123,runUrl:'https://github.com/Noimpty-zby/Noimpty-zby.github.io/actions/runs/123'}]}),
    'mao-play-v1':JSON.stringify({notes:[{kind:1,date:'2026-09-25'}],feeds:2,feedAt:100}),
    'nanaly-usage-v1':JSON.stringify({hit:123,miss:10,out:45,turns:1,since:100})
  },images:[clone(image)],files:[clone(file)]}
}
function environment(initial={},attachments={images:[],files:[]}){
  const stored=new Map(Object.entries(initial)),data={images:clone(attachments.images),files:clone(attachments.files)},ops=[]
  const faults={set:null,insert:null,remove:null,read:null},storage={
    getItem:key=>stored.get(key)??null,
    setItem(key,value){ops.push(['set',key]);if(faults.set?.(key,value))throw Error('fixture quota failure');stored.set(key,String(value))},
    removeItem(key){ops.push(['remove',key]);stored.delete(key)}
  }
  const driver={
    async read(kind){if(faults.read)await faults.read(kind);return clone(data[kind])},
    async insert(kind,rows,owner){if(!rows.length)return;ops.push(['insert',kind]);if(typeof faults.insert==='function')await faults.insert(kind,rows);if(faults.insert===kind||data[kind].length)throw Error('fixture IDB transaction aborted');data[kind].push({id:'__nanaly_backup_'+owner,backupOwner:owner},...clone(rows))},
    async cleanup(kind,owner,expected=null){ops.push(['cleanup-db',kind]);if(faults.cleanup)await faults.cleanup(kind,owner,expected);if(faults.remove===kind)throw Error('fixture rollback unavailable');if(!data[kind].some(v=>v.id==='__nanaly_backup_'+owner&&v.backupOwner===owner))return;for(const row of expected||[]){const current=data[kind].find(v=>v.id===row.id);if(current&&JSON.stringify(current)!==JSON.stringify(row))throw Error('concurrent write')};data[kind]=data[kind].filter(v=>v.id!=='__nanaly_backup_'+owner&&!(expected||[]).some(r=>r.id===v.id))}
  }
  const create=()=>API.create({storage,driver,crypto:webcrypto,origin:'https://new.example',now:()=>fixture().createdAt})
  return {storage,stored,data,ops,faults,driver,create,api:create()}
}
let passed=0
async function test(name,fn){await fn();passed++;console.log('  ✓ '+name)}

await test('encrypted round trip includes ciphertext vault, chat/drafts/memory, dirty schedule and stored attachments across origins',async()=>{
  const payload=fixture(),old=environment(payload.local,payload),collected=await old.api.collect()
  assert.equal(collected.local['nanaly-vault-v1'],payload.local['nanaly-vault-v1']);assert.equal(old.ops.length,0)
  const encrypted=await old.api.seal(collected,pass)
  for(const secret of ['Private chat','Private memory','Private parsed document','Unsent plan','unsent draft','encrypted-keys-fixture'])assert.ok(!encrypted.includes(secret))
  const target=environment(),decoded=await target.api.inspect(encrypted,pass)
  assert.deepEqual(clone(decoded.local),clone(collected.local));assert.deepEqual(clone(decoded.images),payload.images);assert.equal(target.ops.length,0)
  const result=await target.api.restore(decoded);assert.equal(result.messages,1);assert.equal(result.missingAttachments,0)
  assert.deepEqual(Object.fromEntries(target.stored),clone(collected.local));assert.deepEqual(target.data.files,payload.files);assert.equal(target.api.pending(),false)
  assert.ok(target.ops.every(([,key])=>key!=='nanaly-session-v1'&&!key.includes('private-pass')))
})
await test('wrong password, modified ciphertext and unsupported KDF never touch persistent storage',async()=>{
  const env=environment(),encrypted=await env.api.seal(fixture(),pass)
  await assert.rejects(env.api.inspect(encrypted,'wrong-password-123'),/密码不正确/)
  const tampered=JSON.parse(encrypted);tampered.data=(tampered.data[0]==='A'?'B':'A')+tampered.data.slice(1)
  await assert.rejects(env.api.inspect(JSON.stringify(tampered),pass),/损坏/)
  const costly=JSON.parse(encrypted);costly.iterations=1000000000
  await assert.rejects(env.api.inspect(JSON.stringify(costly),pass),/不受支持/)
  assert.equal(env.ops.length,0)
})
await test('config export preserves known settings and excludes obsolete plaintext secret fields',async()=>{
  const config=JSON.parse(fixture().local['nanaly-config-v1']);config.apiKey='fixture-plaintext-secret';config.ghToken='fixture-token'
  const env=environment({'nanaly-config-v1':JSON.stringify(config)}),payload=await env.api.collect()
  assert.ok(!JSON.stringify(payload).includes('fixture-plaintext-secret'));assert.ok(!JSON.stringify(payload).includes('fixture-token'))
  assert.equal(JSON.parse(payload.local['nanaly-config-v1']).baseURL,config.baseURL);assert.equal(env.ops.length,0)
})
await test('unknown keys, nested poison keys, unsafe endpoints, invalid dates and oversized attachments fail before restore',async()=>{
  const changes=[
    p=>{p.local['nanaly-session-v1']='{"apiKey":"no"}'},
    p=>{p.local['nanaly-config-v1']='{"baseURL":"https://user:pass@evil.test"}'},
    p=>{p.local['nanaly-config-v1']='{"baseURL":"http://remote.test"}'},
    p=>{p.local['nanaly-workspace-v1']=p.local['nanaly-workspace-v1'].replace('"v":1','"v":2')},
    p=>{p.local['nanaly-memory-v1']='{"asks":[],"posts":{"__proto__":{"n":1,"at":1}}}'},
    p=>{p.local['noimpty-schedule-cache-v1']='{"days":{"2026-02-31":[]}}'},
    p=>{p.images.push(clone(image))},p=>{p.images[0].dataURL='data:image/jpeg;base64,'+'A'.repeat(2600001)},
    p=>{p.files[0].images=[{page:1,dataURL:'javascript:alert(1)'}]},
    p=>{p.local['nanaly.article-tasks.v1']='{"v":1,"tasks":[{"repo":"foreign/repo"}]}'},
    p=>{const t=JSON.parse(p.local['nanaly.article-tasks.v1']);t.tasks[0].runUrl='https://evil.test/';p.local['nanaly.article-tasks.v1']=JSON.stringify(t)},
    p=>{p.local['mao-play-v1']='{"notes":[{"kind":6,"date":"2026-09-25"}],"feeds":0,"feedAt":0}'},
    p=>{p.local['nanaly-usage-v1']='{"hit":-1,"miss":0,"out":0,"turns":0,"since":1}'}
  ]
  for(const change of changes){const env=environment(),p=fixture();change(p);await assert.rejects(env.api.restore(p));assert.equal(env.ops.length,0)}
})
await test('existing valid target records or attachments cannot be silently overwritten',async()=>{
  for(const key of API.KEYS){const env=environment({[key]:fixture().local[key]});await assert.rejects(env.api.restore(fixture()),/已有/);assert.equal(env.ops.length,0)}
  const env=environment({}, {images:[image],files:[]});await assert.rejects(env.api.restore(fixture()),/已有附件/);assert.equal(env.ops.length,0)
})
await test('new-page empty placeholders do not block restore and are preserved by rollback',async()=>{
  const placeholders={'nanaly-workspace-v1':JSON.stringify(workspace()),'nanaly-memory-v1':'{"asks":[],"posts":{},"since":100}','nanaly-history-v1':'[]','noimpty-learning-v1':'{"version":1,"persist":false,"autoCheck":false}'}
  const env=environment(placeholders);env.faults.insert='files'
  await assert.rejects(env.api.restore(fixture()),/已回滚/)
  assert.deepEqual(Object.fromEntries(env.stored),placeholders);assert.equal(env.data.images.length,0);assert.equal(env.data.files.length,0)
  env.faults.insert=null;await env.api.restore(fixture());assert.equal(JSON.parse(env.stored.get('nanaly-workspace-v1')).sessions[0].draft,'unsent draft')
})
await test('localStorage quota failure after attachments commit rolls back both databases and all partial keys',async()=>{
  const env=environment();let failed=false
  env.faults.set=key=>key==='nanaly-workspace-v1'&&!failed&&(failed=true)
  await assert.rejects(env.api.restore(fixture()),/已回滚/)
  assert.equal(env.stored.size,0);assert.equal(env.data.images.length,0);assert.equal(env.data.files.length,0)
})
await test('rollback failure leaves a durable journal; a fresh instance completes recovery without a password',async()=>{
  const env=environment();env.faults.insert='files';env.faults.remove='images'
  await assert.rejects(env.api.restore(fixture()),/尚未完成/);assert.equal(env.api.pending(),true);assert.equal(env.data.images.length,2)
  env.faults.remove=null;env.faults.insert=null
  const restarted=env.create();assert.equal(await restarted.recover(),'rolled-back');assert.equal(env.stored.size,0);assert.equal(env.data.images.length,0)
})
await test('interrupted partial local writes are recovered and foreign later edits are not overwritten',async()=>{
  const env=environment();let journal
  env.faults.insert='files';env.faults.remove='images';await assert.rejects(env.api.restore(fixture()))
  journal=JSON.parse(env.stored.get(API.JOURNAL));env.stored.set('nanaly-vault-v1',fixture().local['nanaly-vault-v1'])
  env.faults.remove=null;await env.create().recover();assert.equal(env.stored.size,0)
  env.stored.set(API.JOURNAL,JSON.stringify(journal));env.stored.set('nanaly-config-v1','{"model":"new-user-edit"}')
  await assert.rejects(env.create().recover(),/其他页面修改/);assert.equal(env.stored.get('nanaly-config-v1'),'{"model":"new-user-edit"}');assert.ok(env.stored.has(API.JOURNAL))
})
await test('concurrent source mutation refuses export instead of combining mismatched records',async()=>{
  const env=environment(fixture().local,fixture())
  env.faults.read=async kind=>{if(kind==='files')env.stored.set('nanaly-history-v1','[]')}
  await assert.rejects(env.api.collect(),/其他标签页改动/);assert.equal(env.ops.length,0)
})
await test('missing historical attachments are clearly counted without invented contents',async()=>{
  const p=fixture();p.files=[];const result=API.summarize(p);assert.equal(result.missingAttachments,1);assert.equal(result.files,0)
})
await test('zero-commit conflicting attachment insert never deletes the concurrent original',async()=>{
  const env=environment(),other={...image,name:'concurrent-user-image.jpg'}
  env.faults.insert=async kind=>{if(kind==='images')env.data.images.push(clone(other))}
  await assert.rejects(env.api.restore(fixture()),/已回滚/)
  assert.deepEqual(env.data.images,[other]);assert.equal(env.stored.size,0)
})
await test('an attachment modified after our commit is preserved and blocks destructive rollback',async()=>{
  const env=environment()
  env.faults.insert=async kind=>{if(kind==='files'){env.data.images.find(v=>v.id===image.id).name='concurrent edit';throw Error('files fail')}}
  await assert.rejects(env.api.restore(fixture()),/尚未完成/)
  assert.equal(env.data.images.find(v=>v.id===image.id).name,'concurrent edit');assert.equal(env.api.pending(),true)
})
await test('committed recovery log completes cleanup without undoing verified imported records',async()=>{
  const env=environment();env.faults.remove='files'
  await assert.rejects(env.api.restore(fixture()),/尚未完成/)
  assert.equal(JSON.parse(env.stored.get(API.JOURNAL)).committed,true)
  env.faults.remove=null;assert.equal(await env.create().recover(),'completed')
  assert.deepEqual(Object.fromEntries(env.stored),fixture().local);assert.deepEqual(env.data.images,[image]);assert.deepEqual(env.data.files,[file])
})
await test('a local edit arriving during asynchronous attachment rollback is preserved with the recovery log',async()=>{
  const env=environment();let failed=false
  env.faults.set=key=>key==='nanaly-history-v1'&&!failed&&(failed=true)
  env.faults.cleanup=async(kind,owner,expected)=>{if(kind==='images'&&expected)env.stored.set('nanaly-config-v1','{"model":"concurrent-user-edit"}')}
  await assert.rejects(env.api.restore(fixture()),/尚未完成/)
  assert.equal(env.stored.get('nanaly-config-v1'),'{"model":"concurrent-user-edit"}');assert.equal(env.api.pending(),true)
})
await test('empty payload migration does not create session unlock state or source-origin binding',async()=>{
  const env=environment(),p=await env.api.collect(),encrypted=await env.api.seal(p,pass),target=environment()
  await target.api.restore(await target.api.inspect(encrypted,pass));assert.equal(target.stored.size,0);assert.equal(target.data.images.length,0)
})
await test('real IndexedDB cursor driver allows 1000 data rows plus one ownership marker, rejects excess and never exports the marker',async()=>{
  const rows=Array.from({length:1000},(_,n)=>({...image,id:'image-number-'+n})),owner='12345678-1234-1234-1234-123456789abc'
  const internal={id:'__nanaly_backup_'+owner,backupOwner:owner}
  const fake=items=>({open(){
    const db={version:1,objectStoreNames:{length:1,contains:name=>name==='images'},close(){},transaction(){
      let stopped=false,index=0
      const tx={abort(){stopped=true;queueMicrotask(()=>tx.onabort?.())},objectStore(){return {openCursor(){
        const request={}
        const next=()=>queueMicrotask(()=>{if(stopped)return;request.result=index<items.length?{value:clone(items[index++]),continue:next}:null;request.onsuccess?.();if(!request.result&&!stopped)queueMicrotask(()=>tx.oncomplete?.())})
        next();return request
      }}}};return tx
    }}
    const request={result:db};queueMicrotask(()=>request.onsuccess?.());return request
  }})
  assert.equal((await API.driver(fake([...rows,internal])).read('images')).length,1001)
  await assert.rejects(API.driver(fake([...rows,{...image,id:'one-too-many'}])).read('images'),/过大/)
  await assert.rejects(API.driver(fake([internal,{...internal,id:'__nanaly_backup_second-owner',backupOwner:'second-owner'}])).read('images'),/过大/)
  const p=fixture();p.images=[internal];assert.throws(()=>API.validate(p))
})
console.log(`\n${passed} encrypted migration cases passed`)
