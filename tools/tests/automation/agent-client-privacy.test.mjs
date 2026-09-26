import test from 'node:test'
import assert from 'node:assert/strict'

let sequence=0
async function fixture(t, state, configured=true) {
  const previous={url:process.env.NANALY_AGENT_URL,token:process.env.NANALY_AGENT_TOKEN,fetch:globalThis.fetch,argv:process.argv}
  t.after(()=>{
    for(const [key,value] of [['NANALY_AGENT_URL',previous.url],['NANALY_AGENT_TOKEN',previous.token]]){
      if(value===undefined)delete process.env[key];else process.env[key]=value
    }
    globalThis.fetch=previous.fetch;process.argv=previous.argv
  })
  if(configured){process.env.NANALY_AGENT_URL='https://private.example';process.env.NANALY_AGENT_TOKEN='private-test-token-at-least-24'}
  else{delete process.env.NANALY_AGENT_URL;delete process.env.NANALY_AGENT_TOKEN}
  const requests=[]
  globalThis.fetch=async(url,options)=>{requests.push({url,options});return {ok:true,status:200,text:async()=>JSON.stringify(state)}}
  const client=await import('../../nanaly/agent-client.mjs?privacy-test='+sequence++)
  return {client,requests}
}

test('public background context comes from the restricted endpoint and keeps only the needed fields',async t=>{
  // The server filters confirmed/publicAllowed records (tools/tests/server/backend.test.mjs); the client never sees private state.
  const context={
    memories:[{kind:'preference',text:'PUBLIC_MEMORY',source:'explicit permission',privateExtra:'OMIT_EXTRA_FIELD'}],
    strategies:[{lesson:'PUBLIC_METHOD',evidence:'PUBLIC_EVIDENCE',privateExtra:'OMIT_STRATEGY_EXTRA'}]
  }
  const {client,requests}=await fixture(t,context)
  const result=await client.sharedContext()
  const payload=JSON.parse(result.slice(result.indexOf('\n')+1))
  assert.deepEqual(payload,{
    memories:[{kind:'preference',text:'PUBLIC_MEMORY',source:'explicit permission'}],
    strategies:[{lesson:'PUBLIC_METHOD',evidence:'PUBLIC_EVIDENCE'}]
  })
  assert.equal(result.includes('OMIT_'),false)
  assert.equal(requests.length,1);assert.equal(requests[0].url,'https://private.example/api/automation/context')
  assert.equal(requests[0].options.redirect,'error');assert.equal(requests[0].options.credentials,'omit')
  assert.equal(result.includes(process.env.NANALY_AGENT_TOKEN),false)
})

test('unconfigured background tasks do not fetch or invent shared personal history',async t=>{
  const {client,requests}=await fixture(t,{},false)
  assert.equal(await client.sharedContext(),'')
  assert.equal(await client.recordAction({kind:'review',detail:'done',status:'returned'}),false)
  assert.equal(requests.length,0)
})

test('HTTP remote backends and credential-bearing URLs are rejected before token transmission',async t=>{
  const {client,requests}=await fixture(t,{data:{}})
  for(const url of ['http://remote.example','https://user:pass@remote.example','https://remote.example/private','https://remote.example/?token=x']){
    process.env.NANALY_AGENT_URL=url
    await assert.rejects(client.sharedContext())
  }
  assert.equal(requests.length,0)
})

test('dry background action records never write to the private service',async t=>{
  const {client,requests}=await fixture(t,{revision:1,data:{events:[]}})
  process.argv=[...process.argv,'--dry']
  assert.equal(await client.recordAction({kind:'reply',detail:'would reply',status:'returned'}),false)
  assert.equal(requests.length,0)
})

test('action records are appended through the restricted endpoint without reading private state',async t=>{
  const {client,requests}=await fixture(t,{event:{}})
  assert.equal(await client.recordAction({kind:'actual-review',detail:'x'.repeat(1000),status:'returned'}),true)
  assert.equal(requests.length,1)
  assert.equal(requests[0].url,'https://private.example/api/automation/events');assert.equal(requests[0].options.method,'POST')
  const body=JSON.parse(requests[0].options.body)
  assert.deepEqual(Object.keys(body).sort(),['detail','kind','status'])
  assert.equal(body.kind,'actual-review');assert.equal(body.detail.length,600);assert.equal(body.status,'returned')
})
