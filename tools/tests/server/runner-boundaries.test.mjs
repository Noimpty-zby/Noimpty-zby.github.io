import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { PrivateStore } from '../../../server/lib/store.mjs'
import { DockerRunner } from '../../../server/lib/runner.mjs'
import { validateRun } from '../../../server/lib/validation.mjs'
import { createApp } from '../../../server/app.mjs'
import { once } from 'node:events'

const output=(stdout='',code=0,reason)=>({code,stdout:Buffer.from(stdout),stderr:Buffer.alloc(0),reason})
const info=JSON.stringify({OSType:'linux',CgroupVersion:'2',MemoryLimit:true,PidsLimit:true,CpuCfsQuota:true})
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}}
async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'nanaly-boundaries-'))
  const store=await new PrivateStore(root).init()
  t.after(async()=>{await store.close();await fs.rm(root,{recursive:true,force:true})})
  return store
}
function mockDocker(hook){
  const calls=[]
  const execute=async(command,args,options={})=>{
    calls.push({command,args,options})
    const result=await hook?.(args,options,calls)
    if(result)return result
    if(args[0]==='info')return output(info)
    if(args[0]==='image')return output('sha256:runner')
    if(args.includes('cat')&&args.includes('/work/program'))return output('ELF')
    if(args.includes('/tmp/nanaly-shell-result.json'))return output(JSON.stringify({cwd:'/work',shellStateSaved:true,warnings:[]}))
    if(args.includes('-czf'))return output('workspace snapshot')
    return output()
  }
  return {execute,calls}
}

for(const action of ['reset','delete'])test(`workspace ${action} does not resurrect a backup referencing already deleted snapshots`,async t=>{
  const store=await fixture(t)
  let workspace=await store.resetWorkspace(null,'linux')
  workspace=await store.commitWorkspace(workspace,Buffer.from('old snapshot'))
  const oldId=workspace.workspaceId
  const current=action==='reset'?await store.resetWorkspace(oldId,'linux'):null
  if(action==='delete')await store.deleteWorkspace(oldId)
  await fs.writeFile(path.join(store.directory,'workspaces.json'),'incomplete primary')
  await store.close();await store.init()
  assert.equal(store.recovered,true)
  assert.throws(()=>store.getWorkspace(oldId),{code:'WORKSPACE_NOT_FOUND'})
  if(current)assert.equal(store.getWorkspace(current.workspaceId).revision,0)
  assert.deepEqual(await fs.readdir(path.join(store.directory,'workspaces')),[])
})

test('cold concurrent health checks share one Docker probe rather than spawn per HTTP caller',async t=>{
  const store=await fixture(t),gate=deferred()
  const docker=mockDocker(async args=>{if(args[0]==='info'){await gate.promise;return output(info)}})
  const runner=new DockerRunner(store,{execute:docker.execute})
  const pending=Array.from({length:12},()=>runner.health())
  const count=docker.calls.filter(call=>call.args[0]==='info').length
  gate.resolve();const results=await Promise.all(pending)
  assert.equal(count,1);assert.ok(results.every(result=>result.ready))
})

test('abandoned container cleanup targets only the current private-store owner label',async t=>{
  const a=await fixture(t),b=await fixture(t),owners=new Map(),docker=mockDocker(args=>{
    if(args[0]==='create'){
      const owner=args.find(value=>value.startsWith('nanaly.owner='))
      assert.ok(owner,'every created sandbox must carry an instance owner')
      if(!owners.has(owner))owners.set(owner,owners.size?'bbbbbbbbbbbb':'aaaaaaaaaaaa')
    }
    if(args[0]==='ps'){
      const filter=args.find(value=>value.startsWith('label=nanaly.owner='))
      return output(filter?owners.get(filter.slice(6))||'':[...owners.values()].join('\n'))
    }
  })
  const runnerA=new DockerRunner(a,{execute:docker.execute}),runnerB=new DockerRunner(b,{execute:docker.execute})
  for(const runner of [runnerA,runnerB])await runner.run(validateRun({language:'linux',code:'echo harmless',mode:'check'}))
  assert.equal(owners.size,2)
  const count=docker.calls.length;await runnerA.cleanAbandoned()
  const deletes=docker.calls.slice(count).filter(call=>call.args[0]==='rm').map(call=>call.args.at(-1))
  assert.deepEqual(deletes,['aaaaaaaaaaaa'])
})

test('Git summary cannot leave hook-created processes alive while the persistent archive is taken',async t=>{
  const store=await fixture(t);let dirty=false,archivedDirty=false
  const docker=mockDocker(args=>{
    if(args.includes('/opt/nanaly/cleanup.py'))dirty=false
    if(args.includes('git')&&args.includes('status')&&!args.some(value=>/core\.fsmonitor=(false|0)/.test(value)))dirty=true
    if(args.includes('-czf'))archivedDirty=dirty
  })
  const runner=new DockerRunner(store,{execute:docker.execute})
  const result=await runner.run(validateRun({language:'git',code:'git config core.fsmonitor ./watcher'}))
  assert.equal(result.workspaceCommitted,true)
  assert.equal(archivedDirty,false)
})

test('failed resource enforcement check executes no learner command and cleans its container/job/lock',async t=>{
  const store=await fixture(t)
  const docker=mockDocker(args=>args.includes('/opt/nanaly/check-limits.py')?output('',1):undefined)
  const runner=new DockerRunner(store,{execute:docker.execute})
  await assert.rejects(runner.run(validateRun({language:'linux',code:'touch important-file'})),{code:'LIMITS_UNAVAILABLE'})
  assert.equal(docker.calls.some(call=>call.args.includes('/input/main.sh')),false)
  assert.equal(docker.calls.filter(call=>call.args[0]==='rm').length,1)
  assert.equal(runner.active.size,0);assert.equal(runner.busy.size,0)
  assert.deepEqual(await fs.readdir(path.join(store.directory,'jobs')),[])
})

test('timed-out compiled case invokes container kill and frees both case and compile sandboxes',async t=>{
  const store=await fixture(t)
  const docker=mockDocker((args,options)=>{
    if(args.includes('/input/program')){options.onLimit();return output('',-1,'timeout')}
  })
  const runner=new DockerRunner(store,{execute:docker.execute})
  const result=await runner.run(validateRun({language:'c',code:'int main(){for(;;){}}'}))
  assert.equal(result.status,'timeout')
  assert.ok(docker.calls.some(call=>call.args[0]==='kill'&&call.args[1].includes('-case-')))
  assert.equal(docker.calls.filter(call=>call.args[0]==='rm').length,2)
  assert.equal(runner.containers.size,0);assert.equal(runner.active.size,0)
})

test('MySQL snapshot includes stored routines and events, restores as learner and never sends SQL into a shell',async t=>{
  const store=await fixture(t),calls=[]
  const runner=new DockerRunner(store,{execute:mockDocker().execute})
  const exec=async(args,input)=>{calls.push({args,input});return output(args[0]==='mysqldump'?'SQL snapshot':'')}
  const code='CREATE PROCEDURE say_hi() SELECT 1; CALL say_hi();'
  const result=await runner.mysql(exec,{mode:'run',code},{revision:1})
  assert.equal(result.status,'accepted');assert.equal(result.snapshot.toString(),'SQL snapshot')
  const dump=calls.find(call=>call.args[0]==='mysqldump').args
  assert.ok(dump.includes('--routines'));assert.ok(dump.includes('--events'))
  const client=calls.find(call=>call.input===code)
  assert.equal(client.args[0],'mysql');assert.ok(client.args.includes('--user=learner'))
  assert.ok(client.args.includes('--binary-mode'));assert.ok(client.args.includes('--local-infile=0'))
  assert.ok(calls.some(call=>call.args.includes('/opt/nanaly/restore-mysql.py')))
  assert.ok(calls.every(call=>!call.args.includes('sh')&&!call.args.includes('bash')))
})

test('syntax-only workspace check never commits or creates a replacement workspace',async t=>{
  const store=await fixture(t),workspace=await store.resetWorkspace(null,'linux')
  const docker=mockDocker(),runner=new DockerRunner(store,{execute:docker.execute})
  const result=await runner.run(validateRun({language:'linux',code:'touch should-not-exist',mode:'check',workspaceId:workspace.workspaceId,workspaceRevision:0}))
  assert.equal(result.status,'checked');assert.equal(result.workspaceCommitted,false)
  assert.equal(store.getWorkspace(workspace.workspaceId).revision,0)
  const commands=docker.calls.filter(call=>call.args.includes('/input/main.sh'))
  assert.equal(commands.length,1);assert.ok(commands[0].args.includes('-n'))
})

test('cancelling a running shell kills its container and cannot commit the changed workspace',{timeout:5000},async t=>{
  const store=await fixture(t),started=deferred(),stopped=deferred(),controller=new AbortController()
  const docker=mockDocker(async args=>{
    if(args[0]==='kill'){stopped.resolve();return output()}
    if(args.includes('/opt/nanaly/shell-session.py')&&args.includes('run')){
      started.resolve();await stopped.promise;return output('',137)
    }
  })
  const runner=new DockerRunner(store,{execute:docker.execute})
  const work=runner.run(validateRun({language:'linux',code:'touch changed; sleep 5'}),{signal:controller.signal}).catch(error=>error)
  await started.promise;controller.abort(new Error('user paused'))
  const result=await work
  assert.ok(result instanceof Error||result.workspaceCommitted===false)
  assert.ok(docker.calls.some(call=>call.args[0]==='kill'))
  const workspaces=Object.values(store.workspaces.items)
  assert.equal(workspaces.length,1);assert.equal(workspaces[0].revision,0)
  assert.equal(runner.active.size,0);assert.equal(runner.busy.size,0)
  assert.deepEqual(await fs.readdir(path.join(store.directory,'jobs')),[])
})

test('a workspace commit cancelled while queued never writes a snapshot or advances revision',async t=>{
  const store=await fixture(t),workspace=await store.resetWorkspace(null,'linux'),hold=deferred(),controller=new AbortController()
  const first=store.serial(()=>hold.promise)
  const pending=store.commitWorkspace(workspace,Buffer.from('must not be committed'),{signal:controller.signal})
  controller.abort(new Error('paused before storage turn'));hold.resolve()
  await first;await assert.rejects(pending)
  assert.equal(store.getWorkspace(workspace.workspaceId).revision,0)
  assert.deepEqual(await fs.readdir(path.join(store.directory,'workspaces')),[])
})

test('cancelling during a late case start never launches the learner program after that start resolves',{timeout:5000},async t=>{
  const store=await fixture(t),starting=deferred(),release=deferred(),controller=new AbortController()
  const docker=mockDocker(async args=>{
    if(args[0]==='start'&&args[1].includes('-case-')){starting.resolve();await release.promise;return output()}
  })
  const runner=new DockerRunner(store,{execute:docker.execute})
  const work=runner.run(validateRun({language:'cpp',code:'int main(){}'}),{signal:controller.signal}).catch(error=>error)
  await starting.promise;controller.abort();release.resolve();await work
  assert.equal(docker.calls.some(call=>call.args.includes('/input/program')),false)
  assert.equal(runner.active.size,0);assert.equal(runner.containers.size,0)
})

test('aborting the HTTP run propagates a cancellation signal and saves no completed run history',{timeout:5000},async t=>{
  const store=await fixture(t),started=deferred(),aborted=deferred()
  const runner={busy:new Set(),health:async()=>({ready:true}),run:async(request,{signal}={})=>{
    assert.ok(signal,'HTTP handler must supply a signal')
    started.resolve()
    await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}))
    aborted.resolve();throw signal.reason||new Error('aborted')
  }}
  const token='boundary-test-secret-long-enough',server=createApp({store,runner,token})
  server.listen(0,'127.0.0.1');await once(server,'listening')
  t.after(()=>{server.closeAllConnections();server.close()})
  const controller=new AbortController()
  const request=fetch('http://127.0.0.1:'+server.address().port+'/api/run',{
    method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify({language:'linux',code:'sleep 5'}),signal:controller.signal
  }).catch(error=>error)
  await started.promise;controller.abort();await request;await aborted.promise
  assert.equal(store.history.runs.length,0)
})

test('shell runs preserve file permissions, use session cwd for Git, and report the real exit code',async t=>{
  const store=await fixture(t)
  let workspace=await store.resetWorkspace(null,'git')
  workspace=await store.commitWorkspace(workspace,Buffer.from('old snapshot'))
  const docker=mockDocker(args=>{
    if(args.includes('/opt/nanaly/shell-session.py')&&args.includes('run'))return output('retained output',7)
    if(args.includes('/tmp/nanaly-shell-result.json'))return output(JSON.stringify({cwd:'/work/project',shellStateSaved:true,warnings:[]}))
  })
  const runner=new DockerRunner(store,{execute:docker.execute})
  const result=await runner.run(validateRun({language:'git',code:'exit 7',workspaceId:workspace.workspaceId,workspaceRevision:workspace.revision}))
  assert.equal(result.status,'runtime_error');assert.equal(result.exitCode,7);assert.equal(result.cwd,'/work/project')
  assert.equal(result.workspaceCommitted,true)
  const restore=docker.calls.find(call=>call.args.includes('-xzf')).args
  assert.ok(restore.includes('--same-permissions'));assert.ok(restore.includes('--no-same-owner'))
  const summary=docker.calls.find(call=>call.args.includes('status')).args
  assert.equal(summary[summary.indexOf('-C')+1],'/work/project')
  const create=docker.calls.find(call=>call.args[0]==='create').args
  assert.ok(create.includes('--network=none'));assert.ok(!create.includes('--env=GIT_CONFIG_NOSYSTEM=1'))
  const persistIndex=docker.calls.findIndex(call=>call.args.includes('persist'))
  const cleanIndex=docker.calls.map(call=>call.args.includes('/opt/nanaly/cleanup.py')).lastIndexOf(true)
  assert.ok(persistIndex>cleanIndex)
})

test('missing or failed shell state never overwrites the last usable workspace snapshot',async t=>{
  for(const metadata of ['not json',JSON.stringify({cwd:'/work',shellStateSaved:false,warnings:['session warning']})]){
    const store=await fixture(t)
    const docker=mockDocker(args=>args.includes('/tmp/nanaly-shell-result.json')?output(metadata):undefined)
    const runner=new DockerRunner(store,{execute:docker.execute})
    const result=await runner.run(validateRun({language:'linux',code:'echo changed'}))
    assert.equal(result.workspaceCommitted,false)
    assert.equal(docker.calls.some(call=>call.args.includes('-czf')),false)
    assert.ok(result.warnings.some(warning=>warning.includes('快照未能保存')))
    if(metadata.startsWith('{'))assert.ok(result.warnings.includes('session warning'))
  }
})

test('a run arriving while the only slot is being released waits for it instead of failing busy',async t=>{
  const store=await fixture(t),release=deferred()
  let first=true
  const docker=mockDocker(async args=>{if(args[0]==='create'&&first){first=false;await release.promise}})
  const runner=new DockerRunner(store,{execute:docker.execute,concurrency:1})
  const request=validateRun({language:'c',code:'int main(){}',tests:[]})
  const running=runner.run(request)
  for(let i=0;i<20&&!runner.active.size;i++)await new Promise(r=>setImmediate(r))
  assert.equal(runner.active.size,1)
  const waiting=runner.run(request)
  await new Promise(r=>setTimeout(r,450))
  assert.equal(runner.active.size,1,'second run must wait, not start alongside')
  release.resolve()
  const [a,b]=await Promise.all([running,waiting])
  assert.equal(a.status,'accepted');assert.equal(b.status,'accepted')
})

test('waiting for a slot gives up with RUNNER_BUSY and honours cancellation',async t=>{
  const store=await fixture(t),hold=deferred()
  const docker=mockDocker(async args=>{if(args[0]==='create')await hold.promise})
  const runner=new DockerRunner(store,{execute:docker.execute,concurrency:1})
  const request=validateRun({language:'c',code:'int main(){}'})
  const running=runner.run(request)
  for(let i=0;i<20&&!runner.active.size;i++)await new Promise(r=>setImmediate(r))
  await assert.rejects(runner.slot(()=>{},300),{code:'RUNNER_BUSY'})
  const controller=new AbortController()
  const cancelled=runner.run(request,{signal:controller.signal})
  setTimeout(()=>controller.abort(),250)
  await assert.rejects(cancelled,{code:'RUN_CANCELLED'})
  hold.resolve();await running
})

test('python syntax is checked with py-check, cases run main.py directly with a longer limit, tracebacks mark the line',async t=>{
  const store=await fixture(t)
  const traceback='Traceback (most recent call last):\n  File "/input/main.py", line 3, in <module>\n    print(1/0)\nZeroDivisionError: division by zero\n'
  const docker=mockDocker(async args=>{if(args.includes('/input/main.py')&&!args.includes('/opt/nanaly/py-check.py'))return {code:1,stdout:Buffer.alloc(0),stderr:Buffer.from(traceback)}})
  const runner=new DockerRunner(store,{execute:docker.execute,concurrency:1})
  const result=await runner.run(validateRun({language:'python',code:'import torch\nx=1\nprint(1/0)\n',tests:[{input:'',expectedOutput:'1'}]}))
  const check=docker.calls.find(c=>c.args.includes('/opt/nanaly/py-check.py'))
  assert.ok(check,'syntax check ran')
  const exec=docker.calls.find(c=>c.args[0]==='exec'&&c.args.at(-1)==='/input/main.py'&&c.args.includes('python3')&&!c.args.includes('/opt/nanaly/py-check.py'))
  assert.ok(exec,'case ran python3 /input/main.py');assert.equal(exec.options.timeout,15000)
  assert.equal(docker.calls.some(c=>c.args.includes('/work/program')),false,'no binary export for python')
  assert.equal(result.status,'runtime_error')
  assert.deepEqual(result.diagnostics,[{severity:'error',line:3,message:'ZeroDivisionError: division by zero'}])
})

test('go builds seed the writable cache from the warmed image copy first',async t=>{
  const store=await fixture(t),docker=mockDocker()
  const runner=new DockerRunner(store,{execute:docker.execute,concurrency:1})
  await runner.run(validateRun({language:'go',code:'package main\nfunc main(){}\n',mode:'check'}))
  const copy=docker.calls.findIndex(c=>c.args.join(' ').endsWith('cp -r /opt/go-cache /tmp/go-cache'))
  const build=docker.calls.findIndex(c=>c.args.includes('go')&&c.args.includes('build'))
  assert.ok(copy>=0&&build>copy,'cache copied before go build')
})
