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

test('public background context contains only literal confirmed=true and publicAllowed=true records',async t=>{
  const data={
    memories:[
      {id:'public',kind:'preference',text:'PUBLIC_MEMORY',source:'explicit permission',confirmed:true,publicAllowed:true,privateExtra:'OMIT_EXTRA_FIELD'},
      {id:'private',kind:'fact',text:'SECRET_MEMORY',confirmed:true,publicAllowed:false},
      {id:'inferred',kind:'fact',text:'UNCONFIRMED_MEMORY',confirmed:false,publicAllowed:true},
      {id:'truthy',kind:'fact',text:'STRING_FLAGS',confirmed:'true',publicAllowed:'true'},
      {id:'unspecified',kind:'fact',text:'NO_PERMISSION',confirmed:true}
    ],
    experiences:[
      {id:'public-method',lesson:'PUBLIC_METHOD',evidence:'PUBLIC_EVIDENCE',confirmed:true,publicAllowed:true,privateExtra:'OMIT_STRATEGY_EXTRA'},
      {id:'private-method',lesson:'SECRET_METHOD',confirmed:true,publicAllowed:false},
      {id:'unconfirmed-method',lesson:'UNCONFIRMED_METHOD',confirmed:false,publicAllowed:true}
    ],
    goals:[{title:'SECRET_GOAL'}],notes:[{text:'SECRET_NOTE'}],events:[{detail:'SECRET_EVENT'}]
  }
  const {client,requests}=await fixture(t,{revision:3,data})
  const result=await client.sharedContext()
  const payload=JSON.parse(result.slice(result.indexOf('\n')+1))
  assert.deepEqual(payload,{
    memories:[{kind:'preference',text:'PUBLIC_MEMORY',source:'explicit permission'}],
    strategies:[{lesson:'PUBLIC_METHOD',evidence:'PUBLIC_EVIDENCE'}]
  })
  for(const marker of ['SECRET_','UNCONFIRMED_','STRING_FLAGS','NO_PERMISSION','OMIT_'])assert.equal(result.includes(marker),false)
  assert.equal(requests.length,1);assert.equal(requests[0].url,'https://private.example/api/state')
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

test('action CAS retry reloads current private records and appends only the bounded actual event',async t=>{
  const {client}=await fixture(t,{})
  let reads=0,writes=0;const bodies=[]
  globalThis.fetch=async(url,options)=>{
    assert.equal(url,'https://private.example/api/state')
    if(options.method==='GET'){
      reads++
      return {ok:true,status:200,text:async()=>JSON.stringify({revision:reads,data:{memories:[{text:'private version '+reads}],notes:[],events:[]}})}
    }
    writes++;bodies.push(JSON.parse(options.body))
    return writes===1?{ok:false,status:409,text:async()=>'{"error":"conflict"}'}:{ok:true,status:200,text:async()=>'{}'}
  }
  assert.equal(await client.recordAction({kind:'actual-review',detail:'x'.repeat(1000),status:'returned'}),true)
  assert.equal(reads,2);assert.equal(writes,2)
  assert.equal(bodies[1].revision,2);assert.equal(bodies[1].data.memories[0].text,'private version 2')
  const event=bodies[1].data.events[0]
  assert.equal(event.id,bodies[0].data.events[0].id);assert.equal(event.detail.length,600)
  assert.equal(event.source,'background');assert.equal(event.status,'returned')
})
