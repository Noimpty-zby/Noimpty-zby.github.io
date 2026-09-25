import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync('source/js/nanaly-agent.js','utf8')
const ui = readFileSync('source/js/nanaly-agent-ui.js','utf8')
const copy = value => JSON.parse(JSON.stringify(value))
const empty = () => ({ memories:[], goals:[], notes:[], experiences:[], events:[] })
const response = (value,status=200) => ({ok:status<400,status,headers:{get:()=>null},text:async()=>JSON.stringify(value)})
const deferred = () => { let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject} }
const flush = async () => { for(let i=0;i<30;i++)await Promise.resolve() }
function environment (fetch, additions={}, timers={}) {
  const events=[],listeners=new Map()
  const window={fetch,crypto:{randomUUID:()=>String(Math.random())},location:{href:'https://blog.test/lesson'},addEventListener(type,fn){const list=listeners.get(type)||[];list.push(fn);listeners.set(type,list)},
    CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail}},dispatchEvent:event=>events.push(copy(event)),...additions}
  vm.runInNewContext(source,{window,URL,AbortController,setTimeout,clearTimeout,console,...timers})
  let id=0,now=2_000_000_000_000
  const create=(options={})=>window.NANALY_AGENT_FACTORY.create({fetch,now:()=>now,id:()=>String(++id),...options})
  return {window,create,events,fire:(type,event={})=>{for(const fn of listeners.get(type)||[])fn(event)},advance:ms=>{now+=ms},now:()=>now}
}
const token='test-token-of-at-least-24-characters'
function backend (data=empty()) {
  let state={revision:0,data:copy(data)},readDelay=null,writeDelay=null
  const requests=[]
  const fetch=async(url,opts)=>{
    requests.push({url,...opts})
    if(opts.method==='PUT'){
      const body=JSON.parse(opts.body)
      if(writeDelay){const hold=writeDelay;writeDelay=null;await hold.promise}
      if(opts.signal.aborted)throw opts.signal.reason
      if(body.revision!==state.revision)return response({...copy(state),error:{message:'conflict'}},409)
      state={revision:state.revision+1,data:body.data};return response(copy(state))
    }
    const result=copy(state)
    if(readDelay){const hold=readDelay;readDelay=null;await hold.promise}
    return response(result)
  }
  return {fetch,requests,state:()=>copy(state),replace:fn=>{fn(state.data);state.revision++},delayRead:hold=>{readDelay=hold},delayWrite:hold=>{writeDelay=hold}}
}
let passed=0
async function test(label,fn){try{await fn();passed++;console.log('  ✓ '+label)}catch(error){process.exitCode=1;console.error('  ✗ '+label,error)}}

await test('endpoint rejects credential-bearing, insecure remote and path URLs',()=>{
  const env=environment(async()=>response({revision:0,data:empty()})),endpoint=env.window.NANALY_AGENT_FACTORY.endpoint
  assert.equal(endpoint('http://localhost:5000'),'http://localhost:5000')
  for(const url of ['http://remote.test','https://user:pass@test','https://test/path','https://test/?key=secret'])assert.throws(()=>endpoint(url))
})
await test('API query requests preserve same origin and reject external/traversal destinations before sending a token',async()=>{
  const server=backend(),env=environment(server.fetch),agent=env.create();await agent.connect('https://test',token)
  await agent.request('/api/runs?limit=40')
  assert.equal(server.requests.at(-1).url,'https://test/api/runs?limit=40')
  assert.equal(server.requests.at(-1).headers.Authorization,'Bearer '+token)
  const count=server.requests.length
  for(const path of ['https://evil.test/api/runs','//evil.test/api/runs','/api/../admin','/api/runs#fragment','/api/\\evil.test'])await assert.rejects(agent.request(path),/无效/)
  assert.equal(server.requests.length,count)
})
await test('connection status verifies initial state before turning green and emits disconnects immediately',async()=>{
  const hold=deferred(),env=environment(()=>hold.promise),agent=env.create(),states=[]
  agent.subscribe(state=>states.push(state.connection))
  assert.equal(agent.snapshot().connection,'disconnected')
  const connecting=agent.connect('https://test',token)
  assert.equal(agent.snapshot().connection,'connecting');assert.equal(agent.configured(),false)
  assert.equal(agent.snapshot().connected,true,'legacy connected means credentials are present')
  assert.equal(states.at(-1),'connecting')
  hold.resolve(response({revision:0,data:empty()}));await connecting
  assert.equal(agent.snapshot().connection,'connected');assert.equal(agent.configured(),true)
  agent.disconnect()
  assert.equal(agent.snapshot().connection,'disconnected');assert.equal(agent.configured(),false)
  assert.equal(states.at(-1),'disconnected')
})
await test('failed initial authentication clears credentials and exposes a connection error',async()=>{
  const env=environment(async()=>response({error:{message:'令牌无效'}},401)),agent=env.create()
  await assert.rejects(agent.connect('https://test',token),/令牌无效/)
  assert.equal(agent.snapshot().connection,'error');assert.equal(agent.snapshot().problem,'令牌无效')
  assert.equal(agent.configured(),false);assert.equal(agent.snapshot().connected,false)
  agent.disconnect();assert.equal(agent.snapshot().connection,'disconnected');assert.equal(agent.snapshot().problem,'')
})
await test('authentication, network and server failures revoke green status while retaining retryable configuration',async()=>{
  let failure=null
  const server=backend(),env=environment((url,opts)=>failure?failure():server.fetch(url,opts)),agent=env.create()
  await agent.connect('https://test',token)
  for(const fail of [
    ()=>response({error:{message:'unauthorized'}},401),
    ()=>response({error:{message:'forbidden'}},403),
    ()=>response({error:{message:'unavailable'}},503),
    ()=>Promise.reject(new TypeError('Failed to fetch')),
    ()=>({ok:true,status:200,headers:{get:()=>null},text:async()=>'<html>not a backend</html>'})
  ]){
    failure=fail;await assert.rejects(agent.request('/api/runs'))
    assert.equal(agent.snapshot().connection,'error');assert.equal(agent.configured(),true)
    assert.ok(agent.snapshot().problem)
    failure=null;await agent.request('/api/runs')
    assert.equal(agent.snapshot().connection,'connected');assert.equal(agent.snapshot().problem,'')
  }
  for(const status of [400,409,429]){
    failure=()=>response({error:{message:'business error'}},status)
    await assert.rejects(agent.request('/api/runs'))
    assert.equal(agent.snapshot().connection,'connected','business failures are not connection failures')
  }
})
await test('caller cancellation preserves connection health, while request timeout reports failure',async()=>{
  let timeout,waiting=false
  const server=backend(),env=environment((url,opts)=>waiting?new Promise((resolve,reject)=>{
    opts.signal.addEventListener('abort',()=>reject(opts.signal.reason),{once:true})
  }):server.fetch(url,opts),{}, {setTimeout:fn=>{timeout=fn;return 1},clearTimeout(){}}),agent=env.create()
  await agent.connect('https://test',token);waiting=true
  const controller=new AbortController(),cancelled=agent.refresh(controller.signal)
  controller.abort(new Error('user cancelled'));await assert.rejects(cancelled,/user cancelled/)
  assert.equal(agent.snapshot().connection,'connected');assert.equal(agent.snapshot().problem,'')
  const timed=agent.request('/api/runs');timeout();await assert.rejects(timed,/后端请求超时/)
  assert.equal(agent.snapshot().connection,'error');assert.equal(agent.configured(),true)
})
const sessionKey='nanaly-agent-session-v1'
const savedSession=(base='https://test',secret=token)=>JSON.stringify({version:1,base,token:secret})
function sessionStorage(initial={}) {
  const entries=new Map(Object.entries(initial)),reads=[],writes=[]
  return {entries,reads,writes,getItem:key=>{reads.push(key);return entries.get(key)??null},setItem:(key,value)=>{writes.push([key,value]);entries.set(key,String(value))},removeItem:key=>entries.delete(key)}
}
await test('only verified credentials enter session storage and never enter snapshots or local storage',async()=>{
  const hold=deferred(),storage=sessionStorage(),env=environment(()=>hold.promise,{localStorage:{setItem(){throw Error('must not use localStorage')}}}),agent=env.create({sessionStorage:storage})
  const pending=agent.connect('https://test/',token)
  assert.equal(storage.entries.has(sessionKey),false);assert.equal(storage.writes.length,0)
  hold.resolve(response({revision:0,data:empty()}));await pending
  assert.deepEqual(JSON.parse(storage.entries.get(sessionKey)),{version:1,base:'https://test',token})
  assert.equal(JSON.stringify(agent.snapshot()).includes(token),false)
  assert.equal(storage.writes.length,1)
})
await test('new document restores the same tab connection with one read and no replayed actions',async()=>{
  const data={...empty(),goals:[{id:'g',title:'Learn',status:'active',steps:[{id:'s',title:'Review',tool:'review',input:'Summarize',state:'todo'}]}]}
  const storage=sessionStorage(),server=backend(data),first=environment(server.fetch).create({sessionStorage:storage})
  await first.connect('https://test',token)
  const next=environment(server.fetch).create({sessionStorage:storage,permitted:()=>true})
  assert.equal(next.configured(),false)
  await next.resume()
  assert.equal(next.configured(),true);assert.equal(next.snapshot().connection,'connected')
  assert.equal(next.snapshot().data.goals[0].steps[0].state,'todo')
  assert.equal(server.requests.length,2);assert.ok(server.requests.every(r=>r.method==='GET'&&r.url==='https://test/api/state'))
  assert.equal(server.requests.at(-1).headers.Authorization,'Bearer '+token)
  await next.resume();assert.equal(server.requests.length,2)
})
await test('locked pages do not read session credentials or contact the backend before unlock',async()=>{
  let permitted=false
  const storage=sessionStorage({[sessionKey]:savedSession()}),server=backend(),agent=environment(server.fetch).create({sessionStorage:storage,permitted:()=>permitted})
  assert.equal(await agent.resume(),null);assert.equal(storage.reads.length,0);assert.equal(server.requests.length,0)
  assert.ok(storage.entries.has(sessionKey))
  permitted=true;await agent.resume();assert.equal(server.requests.length,1)
})
await test('concurrent resume calls share one validation request and remain yellow until it returns',async()=>{
  const hold=deferred(),storage=sessionStorage({[sessionKey]:savedSession()});let calls=0
  const agent=environment(()=>{calls++;return hold.promise}).create({sessionStorage:storage,permitted:()=>true})
  const first=agent.resume(),second=agent.resume(),third=agent.resume()
  assert.equal(first,second);assert.equal(first,third);assert.equal(calls,1)
  assert.equal(agent.snapshot().connection,'connecting');assert.equal(agent.configured(),false)
  hold.resolve(response({revision:2,data:empty()}));await first
  assert.equal(agent.snapshot().connection,'connected');assert.equal(agent.configured(),true)
})
await test('manual disconnect removes stored credentials and late restoration cannot revive them',async()=>{
  const hold=deferred(),storage=sessionStorage({[sessionKey]:savedSession()});let calls=0
  const agent=environment(()=>{calls++;return hold.promise}).create({sessionStorage:storage,permitted:()=>true})
  const pending=agent.resume();agent.disconnect()
  assert.equal(storage.entries.has(sessionKey),false)
  hold.resolve(response({revision:1,data:empty()}));await assert.rejects(pending)
  await agent.resume()
  assert.equal(calls,1);assert.equal(agent.snapshot().connection,'disconnected');assert.equal(storage.entries.has(sessionKey),false)
})
await test('temporary restoration failures preserve saved credentials for a later online retry',async()=>{
  const storage=sessionStorage({[sessionKey]:savedSession()}),server=backend();let failure=true
  const agent=environment((...args)=>failure?Promise.reject(new TypeError('offline')):server.fetch(...args)).create({sessionStorage:storage,permitted:()=>true})
  await assert.rejects(agent.resume(),/offline/)
  assert.equal(agent.snapshot().connection,'error');assert.equal(agent.configured(),false);assert.ok(storage.entries.has(sessionKey))
  failure=false;await agent.resume()
  assert.equal(agent.snapshot().connection,'connected');assert.equal(server.requests.length,1)
})
await test('authentication rejection during restoration clears the invalid saved session',async()=>{
  for(const status of [401,403]){
    const storage=sessionStorage({[sessionKey]:savedSession()});let calls=0
    const agent=environment(()=>{calls++;return response({error:{message:'invalid credentials'}},status)}).create({sessionStorage:storage,permitted:()=>true})
    await assert.rejects(agent.resume(),/invalid credentials/)
    assert.equal(storage.entries.has(sessionKey),false);assert.equal(agent.snapshot().connection,'error')
    await agent.resume();assert.equal(calls,1)
  }
})
await test('malformed or unsafe saved credentials are discarded without any authenticated request',async()=>{
  const invalid=['{',JSON.stringify([]),JSON.stringify({version:2,base:'https://test',token}),savedSession('http://remote.test'),savedSession('https://user:pass@test'),savedSession('https://test/path'),savedSession('https://test','short'),savedSession('https://test',token+'\r\nInjected: yes'),'x'.repeat(10001)]
  for(const value of invalid){
    const storage=sessionStorage({[sessionKey]:value});let calls=0
    const agent=environment(()=>{calls++;return response({revision:0,data:empty()})}).create({sessionStorage:storage,permitted:()=>true})
    assert.equal(await agent.resume(),null);assert.equal(calls,0);assert.equal(storage.entries.has(sessionKey),false)
  }
})
await test('denied session storage keeps the current connection usable and reports its limitation',async()=>{
  const storage={getItem(){throw Error('denied')},setItem(){throw Error('denied')},removeItem(){throw Error('denied')}},server=backend()
  const agent=environment(server.fetch).create({sessionStorage:storage,permitted:()=>true})
  assert.equal(await agent.resume(),null)
  await agent.connect('https://test',token)
  assert.equal(agent.configured(),true);assert.equal(agent.snapshot().connection,'connected');assert.match(agent.snapshot().sessionIssue,/浏览器.*会话/)
  await agent.request('/api/runs');assert.equal(server.requests.length,2)
  agent.disconnect();assert.equal(agent.snapshot().sessionIssue,'')
})
await test('an obsolete backend response cannot overwrite a newly saved connection',async()=>{
  const storage=sessionStorage(),hold=deferred(),server=backend(),agent=environment((url,opts)=>url.startsWith('https://a.test')?hold.promise:server.fetch(url,opts)).create({sessionStorage:storage})
  const first=agent.connect('https://a.test',token)
  await agent.connect('https://b.test',token+'-new')
  hold.resolve(response({revision:4,data:empty()}));await assert.rejects(first)
  assert.deepEqual(JSON.parse(storage.entries.get(sessionKey)),{version:1,base:'https://b.test',token:token+'-new'})
})
await test('singleton startup and navigation/online events obey the gate and deduplicate restoration',async()=>{
  const storage=sessionStorage({[sessionKey]:savedSession()}),hold=deferred();let unlocked=false,calls=0
  const app=environment(()=>{calls++;return hold.promise},{sessionStorage:storage,NOIMPTY_GATE:{unlocked:()=>unlocked}})
  assert.equal(calls,0);assert.equal(storage.reads.length,0)
  app.fire('pageshow');assert.equal(calls,0)
  unlocked=true;app.fire('pjax:complete');app.fire('pageshow');app.fire('online')
  assert.equal(calls,1);assert.equal(app.window.NANALY_AGENT.snapshot().connection,'connecting')
  hold.resolve(response({revision:0,data:empty()}));await flush()
  assert.equal(app.window.NANALY_AGENT.configured(),true)
  app.fire('pjax:complete');app.fire('pageshow');app.fire('online');assert.equal(calls,1)
  app.fire('noimpty:search-reset');assert.equal(storage.entries.has(sessionKey),false)
  app.fire('online');assert.equal(calls,1);assert.equal(app.window.NANALY_AGENT.configured(),false)
})
await test('restoring an old cached page honors a disconnect made on the newer page',async()=>{
  const storage=sessionStorage(),server=backend(),app=environment(server.fetch),old=app.create({sessionStorage:storage,permitted:()=>true})
  await old.connect('https://test',token)
  const newer=app.create({sessionStorage:storage,permitted:()=>true});await newer.resume();newer.disconnect()
  const count=server.requests.length
  assert.equal(old.configured(),true,'the cached document still has old memory before pageshow')
  await old.resume({reconcile:true})
  assert.equal(old.configured(),false);assert.equal(old.snapshot().connection,'disconnected')
  assert.equal(server.requests.length,count);assert.equal(storage.entries.has(sessionKey),false)
})
await test('restoring a cached page reconciles the latest backend and never sends its old token',async()=>{
  const storage=sessionStorage(),server=backend(),app=environment(server.fetch),old=app.create({sessionStorage:storage,permitted:()=>true})
  await old.connect('https://a.test',token)
  const newer=app.create({sessionStorage:storage,permitted:()=>true});await newer.connect('https://b.test',token+'-new')
  const count=server.requests.length
  await old.resume({reconcile:true})
  assert.equal(server.requests.length,count+1)
  assert.equal(server.requests.at(-1).url,'https://b.test/api/state');assert.equal(server.requests.at(-1).headers.Authorization,'Bearer '+token+'-new')
  assert.equal(old.snapshot().connection,'connected')
  await old.request('/api/runs')
  assert.equal(server.requests.at(-1).url,'https://b.test/api/runs');assert.equal(server.requests.at(-1).headers.Authorization,'Bearer '+token+'-new')
})
await test('a cached page that becomes locked drops private memory without reading or deleting its session',async()=>{
  let permitted=true
  const storage=sessionStorage(),server=backend(),agent=environment(server.fetch).create({sessionStorage:storage,permitted:()=>permitted})
  await agent.connect('https://test',token);agent.setContext({private:'previous article'})
  const reads=storage.reads.length,calls=server.requests.length
  permitted=false;await agent.resume({reconcile:true})
  assert.equal(agent.configured(),false);assert.equal(agent.context(),null);assert.equal(storage.reads.length,reads);assert.equal(server.requests.length,calls)
  assert.ok(storage.entries.has(sessionKey))
})
await test('singleton restores immediately on an unlocked page but not during backup recovery',async()=>{
  const storage=sessionStorage({[sessionKey]:savedSession()}),server=backend()
  const app=environment(server.fetch,{sessionStorage:storage,NOIMPTY_GATE:{unlocked:()=>true}})
  await flush();assert.equal(server.requests.length,1);assert.equal(app.window.NANALY_AGENT.configured(),true)
  const recovery=environment(server.fetch,{sessionStorage:storage,NOIMPTY_GATE:{unlocked:()=>true},NANALY_BACKUP_PENDING:true})
  await flush();assert.equal(server.requests.length,1);assert.equal(recovery.window.NANALY_AGENT.configured(),false)
})
await test('late failures from an old connection cannot overwrite the new backend status',async()=>{
  let delay=false
  const hold=deferred(),server=backend(),env=environment((url,opts)=>delay&&url.startsWith('https://a.test')?hold.promise:server.fetch(url,opts)),agent=env.create()
  await agent.connect('https://a.test',token);delay=true
  const old=agent.request('/api/runs').catch(error=>error)
  await agent.connect('https://b.test',token)
  hold.reject(new TypeError('old backend offline'));await old
  assert.equal(agent.snapshot().connection,'connected');assert.equal(agent.snapshot().problem,'')
})
await test('an old connect response cannot disconnect a newer successfully established backend',async()=>{
  const hold=deferred(),server=backend(),env=environment((url,opts)=>url.startsWith('https://a.test')?hold.promise:server.fetch(url,opts)),agent=env.create()
  const old=agent.connect('https://a.test',token).catch(error=>error)
  await agent.connect('https://b.test',token)
  hold.resolve(response({revision:5,data:{...empty(),notes:[{id:'old',text:'private A'}]}}));await old
  assert.equal(agent.configured(),true);assert.equal(agent.snapshot().revision,0)
  assert.equal(agent.snapshot().problem,'');assert.equal(agent.snapshot().data.notes.length,0)
  assert.equal(agent.snapshot().connection,'connected')
  await agent.saveMemory({kind:'fact',text:'B only',confirmed:true})
  assert.ok(server.requests.at(-1).url.startsWith('https://b.test'))
})
await test('disconnect aborts requests, clears private data/context, and isolates a new mutation queue',async()=>{
  const a=backend(),b=backend(),hold=deferred();let ignoreOld=false
  const env=environment((url,opts)=>url.startsWith('https://a.test')&&ignoreOld?hold.promise:(url.startsWith('https://a.test')?a:b).fetch(url,opts)),agent=env.create()
  await agent.connect('https://a.test',token);agent.setContext({secret:'A exercise'})
  ignoreOld=true
  const old=agent.saveNote({text:'A private note'}).catch(error=>error);await flush()
  agent.disconnect();assert.equal(agent.context(),null);assert.equal(agent.snapshot().data.notes.length,0)
  await agent.connect('https://b.test',token)
  await agent.saveNote({text:'B note'})
  hold.resolve(response({revision:9,data:{...empty(),notes:[{id:'A',text:'A note'}]}}));await old
  assert.equal(agent.snapshot().problem,'');assert.equal(agent.snapshot().data.notes[0].text,'B note')
})
await test('late GET cannot roll back a newer committed revision',async()=>{
  const server=backend(),env=environment(server.fetch),agent=env.create();await agent.connect('https://test',token)
  const hold=deferred();server.delayRead(hold);const read=agent.refresh()
  await agent.saveMemory({kind:'fact',text:'new memory',confirmed:true});assert.equal(agent.snapshot().revision,1)
  hold.resolve();await read
  assert.equal(agent.snapshot().revision,1);assert.equal(agent.snapshot().data.memories[0].text,'new memory')
})
await test('two devices use revision conflict recovery without losing either confirmed memory',async()=>{
  const server=backend(),env=environment(server.fetch),a=env.create(),b=env.create()
  await a.connect('https://test',token);await b.connect('https://test',token)
  await a.saveMemory({kind:'preference',text:'A',confirmed:true})
  await assert.rejects(b.saveMemory({kind:'fact',text:'B',confirmed:true}),/另一设备/)
  assert.equal(b.snapshot().data.memories[0].text,'A');assert.equal(server.state().data.memories.length,1)
  await b.saveMemory({kind:'fact',text:'B',confirmed:true});assert.equal(server.state().data.memories.length,2)
})
await test('unconfirmed memories are rejected and snapshots cannot mutate private state',async()=>{
  const server=backend(),env=environment(server.fetch),agent=env.create();await agent.connect('https://test',token)
  await assert.rejects(agent.saveMemory({kind:'fact',text:'unconfirmed'}),/明确确认/)
  await agent.saveMemory({kind:'goal',text:'learn',confirmed:true})
  const snapshot=agent.snapshot();snapshot.data.memories[0].text='changed'
  assert.equal(agent.snapshot().data.memories[0].text,'learn')
})
await test('malformed nested backend records never replace the last usable snapshot or crash context generation',async()=>{
  const server=backend(),env=environment(server.fetch),agent=env.create();await agent.connect('https://test',token)
  await agent.saveMemory({kind:'fact',text:'Keep this confirmed memory',confirmed:true})
  const previous=copy(agent.snapshot()),valid=copy(server.state().data)
  const malformed=[
    {memories:[null]}, {memories:[{id:'m',kind:'fact',text:'bad flag',confirmed:'true'}]},
    {goals:[{id:'g',title:'broken',status:'active',steps:null}]},
    {goals:[{id:'g',title:'broken',status:'active',steps:[null]}]},
    {goals:[{id:'g',title:'broken',status:'active',steps:[{id:'s',title:'bad',input:'x',tool:'unknown',state:'todo'}]}]},
    {notes:[null]}, {notes:[{id:'n',title:'invalid text',text:{private:'object'}}]},
    {experiences:[null]}, {events:[null]}
  ]
  for(const patch of malformed){
    server.replace(data=>Object.assign(data,copy(valid),patch))
    await assert.rejects(agent.refresh(),/无法加载，未覆盖当前记录/)
    assert.equal(agent.snapshot().revision,previous.revision)
    assert.deepEqual(copy(agent.snapshot().data),previous.data)
    assert.match(agent.contextPrompt(),/Keep this confirmed memory/)
  }
  server.replace(data=>Object.assign(data,copy(valid)))
  await agent.refresh();assert.equal(agent.snapshot().problem,'')
})
const goalData=(state='todo',startedAt=0,attempt='')=>({...empty(),goals:[{id:'g',title:'Learn',status:'active',steps:[{id:'s',title:'Review',tool:'review',input:'Summarize',state,startedAt,attempt}]}]})
await test('five minute lease prevents another device from retrying an actually running step',async()=>{
  const server=backend(),tool=deferred(),env=environment(server.fetch,{NANALY:{agentTool:()=>tool.promise}}),a=env.create(),b=env.create()
  server.replace(data=>Object.assign(data,goalData()))
  await a.connect('https://test',token);await b.connect('https://test',token)
  const run=a.runStep('g');await flush()
  assert.equal(server.state().data.goals[0].steps[0].state,'running')
  await assert.rejects(b.runStep('g'),/五分钟/)
  tool.resolve({text:'Actual review'});await run
  assert.equal(server.state().data.goals[0].status,'completed')
})
await test('pause aborts the active tool and preserves paused status when a late result arrives',async()=>{
  const server=backend(goalData()),tool=deferred();let signal
  const env=environment(server.fetch,{NANALY:{agentTool:options=>{signal=options.signal;return tool.promise}}}),agent=env.create()
  await agent.connect('https://test',token);const run=agent.runStep('g').catch(error=>error);await flush()
  await agent.updateGoal('g',{status:'paused'});assert.equal(signal.aborted,true)
  tool.resolve({text:'too late'});await run
  const goal=server.state().data.goals[0];assert.equal(goal.status,'paused');assert.equal(goal.steps[0].state,'failed')
  assert.equal(goal.steps[0].result,undefined)
})
await test('expired execution cannot mark a newer device attempt as completed or failed',async()=>{
  const server=backend(goalData()),tool=deferred(),env=environment(server.fetch,{NANALY:{agentTool:()=>tool.promise}}),agent=env.create()
  await agent.connect('https://test',token);const run=agent.runStep('g').catch(error=>error);await flush()
  server.replace(data=>{data.goals[0].steps[0].attempt='other-device';data.goals[0].steps[0].startedAt=env.now()})
  tool.resolve({text:'old result'});await run
  const step=server.state().data.goals[0].steps[0]
  assert.equal(step.attempt,'other-device');assert.equal(step.state,'running');assert.equal(step.result,undefined)
})
await test('retry of a save-note step uses its stable identity and does not duplicate a saved note',async()=>{
  const data=goalData('failed');data.goals[0].steps[0].tool='save_note';data.notes.push({id:'step-s',title:'Learn',text:'previous successful note'})
  const server=backend(data),env=environment(server.fetch),agent=env.create();await agent.connect('https://test',token)
  await agent.runStep('g');assert.equal(server.state().data.notes.length,1);assert.equal(server.state().data.goals[0].status,'completed')
})
await test('pause during initial refresh never claims a step or invokes its tool',async()=>{
  const server=backend(goalData());let calls=0
  const env=environment(server.fetch,{NANALY:{agentTool:()=>{calls++;return {text:'no'}}}}),agent=env.create();await agent.connect('https://test',token)
  const hold=deferred();server.delayRead(hold);const run=agent.runStep('g').catch(error=>error)
  await agent.updateGoal('g',{status:'paused'});hold.resolve();await run
  assert.equal(calls,0);assert.equal(server.state().data.goals[0].steps[0].state,'todo')
})
await test('activity reports only live starts/ends, tracks overlapping work and never replays persisted history',async()=>{
  const server=backend(goalData()),env=environment(server.fetch),agent=env.create();await agent.connect('https://test',token)
  assert.equal(env.events.length,0);assert.equal(agent.activity().busy,false)
  agent.activity({id:'old-goal',phase:'complete',text:'must not replay'});assert.equal(env.events.length,0)
  agent.activity({id:'prepare-1',phase:'thinking',text:'正在出题'})
  agent.activity({id:'prepare-2',phase:'thinking',text:'正在准备第二题'})
  agent.activity({id:'prepare-1',phase:'complete',text:'第一题好了'})
  assert.equal(agent.activity().busy,true);assert.equal(agent.activity().current.id,'prepare-2')
  agent.activity({id:'prepare-2',phase:'cancelled',text:'暂停出题'})
  assert.equal(agent.activity().busy,false);assert.equal(agent.activity().current,null)
  const count=env.events.length;agent.activity({id:'prepare-2',phase:'complete'});await agent.refresh()
  assert.equal(env.events.length,count)
  assert.ok(env.events.every(event=>event.type==='nanaly:agent-activity'))
  assert.equal(server.state().data.events.length,0,'ephemeral notifications never become stored history')
})
await test('runStep emits live thinking and completion only after actual tool and durable result success',async()=>{
  const server=backend(goalData()),tool=deferred(),env=environment(server.fetch,{NANALY:{agentTool:()=>tool.promise}}),agent=env.create()
  await agent.connect('https://test',token);const run=agent.runStep('g');await flush()
  assert.deepEqual(env.events.map(event=>event.detail.phase),['thinking']);assert.equal(agent.activity().busy,true)
  tool.resolve({text:'verified result'});await run
  assert.deepEqual(env.events.map(event=>event.detail.phase),['thinking','complete'])
  assert.equal(env.events[0].detail.id,env.events[1].detail.id);assert.equal(agent.activity().busy,false)
  await agent.refresh();assert.equal(env.events.length,2)
})
await test('pause cancels live task activity immediately and its late result cannot replay completion',async()=>{
  const server=backend(goalData()),tool=deferred(),env=environment(server.fetch,{NANALY:{agentTool:()=>tool.promise}}),agent=env.create()
  await agent.connect('https://test',token);const run=agent.runStep('g').catch(error=>error);await flush()
  const pause=agent.updateGoal('g',{status:'paused'})
  assert.equal(agent.activity().busy,false);assert.equal(env.events.at(-1).detail.phase,'cancelled')
  await pause;tool.resolve({text:'late'});await run
  assert.deepEqual(env.events.map(event=>event.detail.phase),['thinking','cancelled'])
})
await test('tool failures emit error, while disconnect clears activity and ignores later old-session events',async()=>{
  const server=backend(goalData()),env=environment(server.fetch,{NANALY:{agentTool:async()=>{throw new Error('tool failed')}}}),agent=env.create()
  await agent.connect('https://test',token);await assert.rejects(agent.runStep('g'),/tool failed/)
  assert.deepEqual(env.events.map(event=>event.detail.phase),['thinking','error'])
  agent.activity({id:'prepare',phase:'thinking',text:'出题中'});agent.disconnect()
  assert.equal(agent.activity().busy,false);assert.equal(agent.activity().phase,'idle')
  const count=env.events.length;agent.activity({id:'prepare',phase:'complete'});assert.equal(env.events.length,count)
})

function uiEnvironment () {
  let subscriber,snapshot={connected:false,revision:null,data:empty(),problem:''},document
  const all=[]
  const make=tag=>{
    const listeners=new Map(),node={tagName:tag.toUpperCase(),children:[],value:'',checked:false,disabled:false,open:false,isConnected:false,
      className:'',textContent:'',attrs:{},dataset:{},setAttribute(key,value){this.attrs[key]=value},
      append(...nodes){for(const child of nodes){child.parentElement=this;this.children.push(child)}},
      replaceChildren(...nodes){this.children=[];this.append(...nodes)},addEventListener(type,fn){listeners.set(type,fn)},
      fire(type){return listeners.get(type)?.({target:this,preventDefault(){}})},
      focus(){document.activeElement=this},showModal(){this.open=true},close(){this.open=false},querySelector(){return null}}
    Object.defineProperty(node,'options',{get:()=>node.children.filter(child=>child.tagName==='OPTION')})
    all.push(node);return node
  }
  document={createElement:make,body:make('body'),documentElement:{classList:{contains:()=>false}},querySelector:()=>null,activeElement:{focus(){}}}
  const agent={tools:{review:'review'},snapshot:()=>copy(snapshot),configured:()=>snapshot.connected,
    subscribe:fn=>{subscriber=fn},disconnect:()=>{snapshot={connected:false,revision:null,data:empty(),problem:''};subscriber(snapshot)},
    connect:async()=>{},saveMemory:async()=>{},saveNote:async()=>{},feedback:async()=>{},refresh:async()=>{}}
  const window={NANALY_AGENT:agent,addEventListener(){}}
  vm.runInNewContext(ui,{window,document,localStorage:{getItem:()=>null,setItem(){}},location:{href:'https://blog.test'},URL,Blob,setTimeout,console})
  return {agent,window,all,load:state=>{snapshot=state;subscriber(snapshot)}}
}
await test('studio connection message and color state follow verified connectivity without a false green',()=>{
  const app=uiEnvironment();app.window.NANALY_AGENT_UI.open()
  const status=app.all.find(node=>node.className==='studio-status')
  assert.equal(status.dataset.connection,'disconnected');assert.match(status.textContent,/尚未连接/)
  app.load({connected:true,connection:'connecting',revision:null,data:empty(),problem:''})
  assert.equal(status.dataset.connection,'connecting');assert.match(status.textContent,/正在连接/)
  assert.doesNotMatch(status.textContent,/已连接/)
  app.load({connected:true,connection:'connected',revision:3,data:empty(),problem:''})
  assert.equal(status.dataset.connection,'connected');assert.match(status.textContent,/后端已连接.*3/)
  app.load({connected:true,connection:'error',revision:3,data:empty(),problem:'后端请求超时'})
  assert.equal(status.dataset.connection,'error');assert.equal(status.textContent,'后端请求超时')
  assert.doesNotMatch(status.textContent,/已连接/)
  app.load({connected:false,connection:'error',revision:null,data:empty(),problem:'访问令牌无效'})
  assert.equal(status.dataset.connection,'error');assert.equal(status.textContent,'访问令牌无效')
  app.agent.disconnect()
  assert.equal(status.dataset.connection,'disconnected');assert.match(status.textContent,/尚未连接/)
})
await test('studio shows a session-storage warning while keeping a verified connection green',()=>{
  const app=uiEnvironment();app.window.NANALY_AGENT_UI.open()
  const status=app.all.find(node=>node.className==='studio-status')
  const state={connected:true,connection:'connected',revision:1,data:empty(),problem:'',sessionIssue:'后端已连接，但浏览器未允许保留会话；切换页面后可能需要重新连接。'}
  app.load(state)
  assert.equal(status.dataset.connection,'connected');assert.equal(status.textContent,state.sessionIssue)
  app.window.NANALY_AGENT_UI.close();app.window.NANALY_AGENT_UI.open()
  assert.equal(status.textContent,state.sessionIssue)
})
await test('disconnect clears every private draft and detached list, preventing cross-backend resubmission',async()=>{
  const app=uiEnvironment();app.window.NANALY_AGENT_UI.open()
  const data=empty();data.memories=[{id:'private-id',kind:'fact',text:'secret-memory'}]
  app.load({connected:true,revision:1,data,problem:''});app.window.NANALY_AGENT_UI.open()
  for(const input of app.all.filter(node=>['INPUT','TEXTAREA'].includes(node.tagName))){if(input.type==='checkbox')input.checked=true;else if(input.type!=='url')input.value='secret draft'}
  app.all.find(node=>node.tagName==='BUTTON'&&node.textContent==='编辑').fire('click');await flush()
  app.window.NANALY_AGENT_UI.close();app.agent.disconnect()
  for(const input of app.all.filter(node=>['INPUT','TEXTAREA'].includes(node.tagName)&&node.type!=='url')){
    assert.equal(input.value,'');assert.equal(input.checked,false)
  }
  app.window.NANALY_AGENT_UI.open()
  assert.ok(app.all.filter(node=>node.tagName==='SELECT').some(node=>node.options.length===0))
})
console.log(`\n${passed} 私有代理状态与工作室回归通过`)
