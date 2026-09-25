;(() => {
  'use strict'
  const $=id=>document.getElementById(id), status=$('backup-status'), summary=$('backup-summary')
  let api,verified=null,busy=false,lastURL='',lastFile=null
  const available=()=>{if(window.NOIMPTY_GATE&&!window.NOIMPTY_GATE.unlocked())throw new Error('请先输入站点暗号。');if(!api)throw new Error('浏览器未允许本机存储。')}
  const message=text=>{status.textContent=text}
  const details=payload=>{
    const s=window.NANALY_BACKUP.summarize(payload);summary.replaceChildren()
    const p=text=>{const n=document.createElement('p');n.textContent=text;summary.append(n)}
    p('来源：'+s.sourceOrigin+' · '+new Date(s.createdAt).toLocaleString())
    p(`${s.sessions} 个话题 · ${s.messages} 条消息 · ${s.memories} 条确认记忆 · ${s.images} 张图片 · ${s.files} 份站内文件`)
    p('密钥保险箱：'+(s.vault?'包含原密文，仍使用原保险箱密码解锁':'未包含'))
    p('记录：'+s.keys.map(key=>window.NANALY_BACKUP.LABELS[key]).join('、'))
    if(s.endpoints.length)p('恢复后使用的接口地址：'+s.endpoints.join('、'))
    if(s.missingAttachments)p(`注意：有 ${s.missingAttachments} 个历史附件引用在原浏览器已缺失，文件无法补回它们。`)
    return s
  }
  const run=async fn=>{
    if(busy)return;busy=true
    document.querySelectorAll('button,input').forEach(n=>n.disabled=true)
    try{await fn()}catch(error){message(error.message||'操作未完成。')}
    finally{busy=false;document.querySelectorAll('button,input').forEach(n=>n.disabled=false);$('backup-restore').disabled=!verified;$('backup-recover').hidden=!api?.pending();status.scrollIntoView({behavior:'smooth',block:'center'})}
  }
  const invalidate=()=>{verified=null;$('backup-restore').disabled=true}
  $('backup-origin').textContent=location.origin
  $('backup-export').addEventListener('click',()=>run(async()=>{
    available();invalidate();const pass=$('backup-new-password').value
    if(pass!==$('backup-repeat-password').value)throw new Error('两次备份密码不一致。')
    message('正在读取本机记录与附件，并加密…')
    const payload=await api.collect(),sealed=await api.seal(payload,pass)
    // Verify encryption and the payload before offering a download. This is not a write/restore.
    const decoded=await api.inspect(sealed,pass);details(decoded)
    if(lastURL)URL.revokeObjectURL(lastURL)
    lastURL=URL.createObjectURL(new Blob([sealed],{type:'application/json'}))
    const download=$('backup-download');download.href=lastURL;download.download='nanaly-local-backup-'+new Date().toISOString().slice(0,10)+'.json';download.hidden=false;download.click()
    $('backup-new-password').value='';$('backup-repeat-password').value=''
    message('加密文件已准备并发起下载；若浏览器未下载，请点“保存加密备份”。然后在下方重新选择下载的文件并校验，确认本机文件可用。')
  }))
  $('backup-file').addEventListener('change',()=>{invalidate();lastFile=$('backup-file').files[0]||null;summary.replaceChildren();message('文件只在本机读取，不会上传。')})
  $('backup-password').addEventListener('input',invalidate)
  $('backup-verify').addEventListener('click',()=>run(async()=>{
    available();invalidate();const file=lastFile
    if(!file)throw new Error('请先选择下载的备份文件。')
    if(file.size>window.NANALY_BACKUP.FILE_MAX)throw new Error('备份文件超过90MB，无法读取。')
    message('正在本机校验密码、文件完整性与记录格式…')
    const payload=await api.inspect(await file.text(),$('backup-password').value)
    if(lastFile!==file)throw new Error('选择的文件已改变，请重新校验。')
    verified=payload;details(payload);$('backup-password').value=''
    message('文件校验通过，未写入任何记录。换域名前保留这份文件和备份密码；新域名可用同一文件恢复。')
  }))
  $('backup-restore').addEventListener('click',()=>run(async()=>{
    available();if(!verified)throw new Error('请先校验文件。')
    if(!$('backup-close-tabs').checked)throw new Error('请关闭本站其他标签页，再勾选确认。')
    if(!window.confirm('将已校验的备份恢复到此域名的空白本机存储？现有有效记录不会被覆盖。'))return
    message('正在分阶段恢复，出现错误将回滚；请勿关闭页面…')
    await api.restore(verified);verified=null
    message('恢复成功。即将刷新；进入聊天后仍需原保险箱密码，不会自动调用模型或连接后端。')
    // Session keys/passphrases are intentionally never copied. Stay on this inert page after reload.
    window.setTimeout(()=>location.reload(),1200)
  }))
  const recovered=outcome=>message(outcome==='completed'?'已完成上次恢复的最后清理，记录已恢复。返回聊天后仍需原保险箱密码。':'回滚完成，目标已回到恢复前状态，可以重新校验文件。')
  $('backup-recover').addEventListener('click',()=>run(async()=>{available();message('正在处理上次恢复日志…');recovered(await api.recover())}))
  window.addEventListener('beforeunload',event=>{if(busy){event.preventDefault();event.returnValue=''}})
  window.addEventListener('pagehide',()=>{if(lastURL)URL.revokeObjectURL(lastURL)})
  try{api=window.NANALY_BACKUP.create();if(api.pending()){
    $('backup-recover').hidden=false
    run(async()=>{message('发现上次恢复日志，正在处理后再继续…');recovered(await api.recover())})
  }}catch(_){message('浏览器不允许本机存储，暂不能备份或恢复。')}
})()
