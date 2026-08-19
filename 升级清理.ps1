# 升级到新版之后，删掉那些「已经不该存在、但覆盖不会删掉」的旧文件。
#
# 为什么需要这个脚本：
#
#   把新文件拖进来选「替换」，Windows 只会覆盖**同名**文件。
#   那些在新版里已经删掉的旧文件，它一个都不会动 —— 它们会安静地留在原地。
#
#   而这批旧文件里有 6 个是**页面**（/study/ 那四个、/ideas/、/ideas-vault/）。
#   它们留着的后果不是报错，是：这 6 个页面照常生成，
#   把新版给它们准备的跳转页顶掉了。旧地址不再跳转，站上多出 6 个僵尸页面，
#   而且构建全绿、部署成功、页面能打开 —— 你不会发现。
#
#   实测确认过：不会泄漏内容（新的锁是默认拒绝，它们照样被锁住），
#   但跳转确实会失效。这是最难查的那类错，所以做成脚本，别靠手删。
#
# 用法：在 PowerShell 里 cd 到 D:\secret\blog，然后
#
#   Unblock-File .\升级清理.ps1                        # 去掉「此文件来自网络」的标记
#   powershell -ExecutionPolicy Bypass -File .\升级清理.ps1
#
# 第二句是一次性绕过执行策略，不改系统设置。
# （如果确实想改当前窗口的策略：Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process
#   —— 注意 Bypass 是 -ExecutionPolicy 的值，不是一个开关参数。）

$ErrorActionPreference = 'Stop'

# ── 先确认位置对不对，别在错误的目录里删东西 ──────────────────
if (-not (Test-Path '_config.yml') -or -not (Test-Path 'source')) {
    Write-Host ''
    Write-Host '这里不像是博客仓库的根目录（找不到 _config.yml 或 source\）。' -ForegroundColor Red
    Write-Host '请先 cd 到 D:\secret\blog 再运行。' -ForegroundColor Red
    Write-Host ''
    exit 1
}
if (-not (Test-Path 'source\extra') -or -not (Test-Path 'tools\studio')) {
    Write-Host ''
    Write-Host '新版文件好像还没复制进来（找不到 source\extra\ 或 tools\studio\）。' -ForegroundColor Yellow
    Write-Host '请先把压缩包里「博客仓库」的内容拖进来替换，再运行这个脚本。' -ForegroundColor Yellow
    Write-Host ''
    exit 1
}

# ── 该删的东西 ────────────────────────────────────────────────
$critical = @(
    # 这 6 个是页面，留着会顶掉跳转页
    'source\study',
    'source\ideas',
    'source\ideas-vault',
    # 这两个测试会被 npm test 自动扫到；它们依赖的 ideas.mjs 已经不在了
    'tools\tests\ideas.test.mjs',
    'tools\tests\ideas-render.test.mjs',
    'tools\nanaly\ideas.mjs'
)
$tidy = @(
    # 下面这些留着无害，只是没人再引用了
    'source\js\ideas-vault.js',
    'source\css\ideas-vault.css',
    'source\img\sections\study.webp',
    'source\img\sections\ideas.webp',
    'source\music\请把原来的音乐文件放回这里.txt'
)

Write-Host ''
Write-Host '=== 要删除的旧文件 ===' -ForegroundColor Cyan
$found = @()
foreach ($p in ($critical + $tidy)) {
    if (Test-Path $p) { $found += $p; Write-Host "  $p" }
}
if ($found.Count -eq 0) {
    Write-Host '  （没有需要删的，看来你已经清理过了）' -ForegroundColor Green
} else {
    Write-Host ''
    $answer = Read-Host "共 $($found.Count) 项，删除吗？(y/N)"
    if ($answer -ne 'y' -and $answer -ne 'Y') {
        Write-Host '已取消，什么都没动。' -ForegroundColor Yellow
        exit 0
    }
    foreach ($p in $found) { Remove-Item -Recurse -Force $p }
    Write-Host "已删除 $($found.Count) 项。" -ForegroundColor Green
}

# ── 清掉构建缓存 ──────────────────────────────────────────────
# db.json 里缓存着上一次构建时的页面清单。不清的话，
# 刚才删掉的那些页面可能还会被生成一次。
#
# public 要特殊对待：旧版构建产物里有一个目录叫
#   public\2026\08\07\UE5-ActionRoguelike-Chapter2 \   ← 结尾带一个空格
# Windows 解析路径时会把结尾的空格吃掉，于是这个目录建得出来、删不掉，
# Remove-Item 会报「系统找不到指定的文件」。
# 用 \\?\ 前缀走 .NET 可以绕过路径规范化 —— 这是唯一稳的删法。
# （新版已经把那条跳转规则删了，所以以后不会再生成这种目录。）
Write-Host ''
Write-Host '=== 清理构建缓存 ===' -ForegroundColor Cyan
if (Test-Path 'db.json') { Remove-Item -Force 'db.json'; Write-Host '  已删除 db.json' }
if (Test-Path 'public') {
    try {
        [System.IO.Directory]::Delete("\\?\$((Get-Location).Path)\public", $true)
        Write-Host '  已删除 public'
    } catch {
        Write-Host "  public 删除失败：$($_.Exception.Message)" -ForegroundColor Yellow
        Write-Host '  手动删：cmd /c rd /s /q "\\?\D:\secret\blog\public"' -ForegroundColor Yellow
    }
}

# ── 音乐还在不在 ──────────────────────────────────────────────
$mp3 = @(Get-ChildItem -Path 'source\music' -Filter '*.mp3' -ErrorAction SilentlyContinue)
Write-Host ''
if ($mp3.Count -ge 10) {
    Write-Host "音乐文件在（$($mp3.Count) 个 mp3）。" -ForegroundColor Green
} else {
    Write-Host "⚠️ source\music\ 里只有 $($mp3.Count) 个 mp3，应该是 10 个。" -ForegroundColor Yellow
    Write-Host '   压缩包里没带音乐（84 MB，而且一个字节都没改），从你原来的备份里复制回来。' -ForegroundColor Yellow
}

Write-Host ''
Write-Host '=== 接下来 ===' -ForegroundColor Cyan
Write-Host '  npm test           跑测试（应该是 5 个文件全过）'
Write-Host '  npm run build      构建'
Write-Host '  npm run linkcheck  查死链'
Write-Host '  npx hexo server    本地看看'
Write-Host ''
Write-Host '  想让站内搜索也能用，构建前先设暗号：'
Write-Host '    $env:NOIMPTY_PASSPHRASE = "你的暗号"' -ForegroundColor DarkGray
Write-Host '  填错了构建时会有醒目的黄色警告，照着改就行。'
Write-Host ''
Write-Host '  确认没问题之后再 git add -A && git commit && git push。'
Write-Host ''
