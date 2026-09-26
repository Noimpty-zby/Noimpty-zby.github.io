import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const helper=fileURLToPath(new URL('../../../server/runner/shell-session.py',import.meta.url))
const available=process.platform==='linux'&&spawnSync('python3',['--version']).status===0
async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'nanaly-shell-test-'))
  const workspace=path.join(root,'work'),temporary=path.join(root,'tmp'),script=path.join(root,'main.sh')
  await fs.mkdir(workspace);await fs.mkdir(temporary)
  t.after(()=>fs.rm(root,{recursive:true,force:true}))
  const args=['--workspace',workspace,'--temporary',temporary]
  // These fixtures contain only trusted test scripts and never inherit host credentials.
  const options={encoding:'utf8',timeout:5000,maxBuffer:2*1024*1024,env:{PATH:'/usr/bin:/bin',HOME:workspace,LANG:'C.UTF-8'}}
  return {workspace,temporary,async run(code,input='',environment={}){
    await fs.writeFile(script,code)
    const result=spawnSync('python3',[helper,'run',script,...args],{...options,input,env:{...options.env,...environment}})
    assert.ifError(result.error)
    const metadata=JSON.parse(await fs.readFile(path.join(temporary,'nanaly-shell-result.json'),'utf8'))
    return {...result,...metadata}
  },persist(){
    const result=spawnSync('python3',[helper,'persist',...args],options)
    assert.equal(result.status,0,result.stderr)
  }}
}

test('Bash session restores cwd, exported values, umask, aliases and functions without leaking private state into Git',{skip:!available},async t=>{
  const env=await fixture(t)
  const first=await env.run(`mkdir -p 'lesson dir'
cd 'lesson dir'
export LESSON=$'first line\\nsecond "line"'
umask 027
alias hi='printf "alias works\\n"'
greet() { printf 'function works\\n'; }
printf saved > note
`)
  assert.equal(first.status,0,first.stderr);assert.equal(first.shellStateSaved,true)
  assert.equal(first.cwd,path.join(env.workspace,'lesson dir'))
  env.persist()
  const second=await env.run(`test ! -e "$HOME/.nanaly-shell-session.json" || exit 12
builtin pwd -P
printf '%s\\n' "$LESSON"
cat note
printf '\\n'
hi
greet
printf fresh > new-file
mkdir new-dir
`)
  assert.equal(second.status,0,second.stderr)
  assert.equal(second.cwd,first.cwd)
  assert.equal(second.stdout,first.cwd+'\nfirst line\nsecond "line"\nsaved\nalias works\nfunction works\n')
  assert.equal((await fs.stat(path.join(first.cwd,'new-file'))).mode&0o777,0o640)
  assert.equal((await fs.stat(path.join(first.cwd,'new-dir'))).mode&0o777,0o750)
})

test('explicit exit preserves state and exit status; ordinary Bash still allows earlier failures and supplied stdin',{skip:!available},async t=>{
  const env=await fixture(t)
  const first=await env.run('mkdir nested; cd nested; export KEPT=present; printf saved > marker; exit 7')
  assert.equal(first.status,7);assert.equal(first.shellStateSaved,true)
  env.persist()
  const second=await env.run('false\nread -r value\nprintf "%s:%s:" "$KEPT" "$value"\ncat marker\n','typed input\n')
  assert.equal(second.status,0,second.stderr);assert.equal(second.stdout,'present:typed input:saved')
  assert.equal(second.cwd,first.cwd)
})

test('removed current directories fall back to the workspace and remain saveable',{skip:!available},async t=>{
  const env=await fixture(t)
  const deleted=await env.run('mkdir gone; cd gone; rmdir ../gone')
  assert.equal(deleted.status,0,deleted.stderr);assert.equal(deleted.shellStateSaved,true)
  assert.equal(deleted.cwd,env.workspace);assert.ok(deleted.warnings.some(value=>value.includes('目录已被删除')))
  env.persist()
  const saved=await env.run('mkdir missing-next-time; cd missing-next-time')
  assert.equal(saved.status,0,saved.stderr)
  env.persist()
  await fs.rmdir(saved.cwd)
  const resumed=await env.run('pwd')
  assert.equal(resumed.status,0);assert.equal(resumed.stdout,env.workspace+'\n')
  assert.ok(resumed.warnings.some(value=>value.includes('目录已不存在')))
})

test('unavailable capture and corrupt state are reported without pretending the session was saved',{skip:!available},async t=>{
  const env=await fixture(t)
  const replaced=await env.run('trap - EXIT; exec /bin/true')
  assert.equal(replaced.status,0);assert.equal(replaced.shellStateSaved,false)
  assert.ok(replaced.warnings.some(value=>value.includes('未能保存')))
  await fs.writeFile(path.join(env.workspace,'.nanaly-shell-session.json'),'invalid json')
  const recovered=await env.run('printf recovered')
  assert.equal(recovered.status,0);assert.equal(recovered.stdout,'recovered');assert.equal(recovered.shellStateSaved,true)
  assert.ok(recovered.warnings.some(value=>value.includes('无法读取')))
})

test('user EXIT handlers still run and restricted PATH does not break session capture',{skip:!available},async t=>{
  const env=await fixture(t)
  const first=await env.run('export PATH=/nonexistent; trap \'printf "user exit\\n"\' EXIT; printf "body\\n"')
  assert.equal(first.status,0,first.stderr);assert.equal(first.stdout,'body\nuser exit\n');assert.equal(first.shellStateSaved,true)
  env.persist()
  const second=await env.run('printf "%s" "$PATH"')
  assert.equal(second.status,0,second.stderr);assert.equal(second.stdout,'/nonexistent')
})

test('only learner-made environment changes persist, so a new image PATH reaches existing workspaces',{skip:!available},async t=>{
  const env=await fixture(t)
  const first=await env.run('export MINE=kept\nexport LANG=C\n')
  assert.equal(first.shellStateSaved,true);env.persist()
  const saved=JSON.parse(await fs.readFile(path.join(env.workspace,'.nanaly-shell-session.json'),'utf8'))
  assert.equal(saved.env,'diff')
  assert.match(saved.shell,/MINE=/);assert.match(saved.shell,/LANG=/)
  assert.doesNotMatch(saved.shell,/declare -x (PATH|HOME)=/)
  const second=await env.run('printf "%s|%s|%s\\n" "$PATH" "$MINE" "$LANG"\n','',{PATH:'/opt/py/bin:/usr/bin:/bin'})
  assert.equal(second.stdout,'/opt/py/bin:/usr/bin:/bin|kept|C\n')
})

test('a legacy full-environment state gets the current container values back and keeps learner variables',{skip:!available},async t=>{
  const env=await fixture(t)
  await fs.writeFile(path.join(env.workspace,'.nanaly-shell-session.json'),JSON.stringify({version:1,cwd:env.workspace,
    shell:'declare -x PATH="/old/image/bin"\ndeclare -x HOME="/old/home"\ndeclare -x LAB_TOPIC="linux practice"\nbuiltin umask 0022\n'}))
  const result=await env.run('printf "%s|%s|%s\\n" "$PATH" "$HOME" "$LAB_TOPIC"\n','',{PATH:'/opt/py/bin:/usr/bin:/bin'})
  assert.equal(result.status,0,result.stderr)
  assert.equal(result.stdout,`/opt/py/bin:/usr/bin:/bin|${env.workspace}|linux practice\n`)
  env.persist()
  const saved=JSON.parse(await fs.readFile(path.join(env.workspace,'.nanaly-shell-session.json'),'utf8'))
  assert.equal(saved.env,'diff');assert.match(saved.shell,/LAB_TOPIC=/);assert.doesNotMatch(saved.shell,/declare -x (PATH|HOME)=/)
})
