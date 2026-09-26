# 代码小屋（边学边练）

入口 `/learn/`；文章页的「边学边练」将原页面左右分屏，可拖动分隔条调整宽度，窄屏用「阅读文章 / 编写代码」切换。分屏打开时按文章选语言：先看分类（Git、Linux 入门），再看正文里最多的代码块语言；随笔等没有代码的文章保持上次的语言。关闭或 PJAX 跳转时恢复原页面。结果按文本渲染，不解释后端输出中的 HTML；终端输出交给 xterm.js 按终端字符处理。

## 使用

1. 解锁页面，点击顶部「连接后端」填写个人后端地址与令牌。状态点显示未连接、连接中、已连接或连接失败，验证成功后才变绿。
2. 选择 C、C++、Go、Python、Git、Linux 或 MySQL。编辑器提供语法高亮与补全；不需要选择题目或载入实例。
3. 下方面板有「终端 / 输出 / 记录」三页，中间的横条可以拖动（或聚焦后按上下方向键）调高度，本浏览器记住，双击恢复默认。
4. 「更多」提供配色、终端字号、自动语法检查、本机保存、请教娜娜莉、手动检查、重启终端、下载代码、清空编辑器与重置环境。自动检查默认开启（关掉后记住选择），停止编辑 900 毫秒后用真实编译器检查 C/C++/Go、Python 或 Bash 语法：错误在编辑器里画红色波浪线并在行号旁标记，警告为黄色，gcc 的 note 只作提示；悬停可看原文。自动检查不执行代码、不调用付费 AI，也不弹出提示；MySQL 需明确运行。诊断行号可点击定位。

## 运行 C / C++ / Go / Python

点「运行」或按 `Ctrl / ⌘ + Enter`：代码存成 `main.c` 等文件，在下方「终端」里像手敲一样显示并执行 `gcc … && ./main`（Go 为 `go build`，Python 为 `python3 main.py`）。程序要输入时直接在终端里打字，`Ctrl+C` 或「停止」结束它；结束后显示退出码和用时。再点「运行」会停掉还在跑的上一次，输出接在后面。编译错误以 gcc 原样的彩色输出出现在终端里，同时由自动检查标在编辑器里。离开页面会结束正在运行的程序。

Python 环境已装好 NumPy 与 CPU 版 PyTorch，第一次 `import torch` 需要几秒。AI 生成的练习带测试用例时，工具栏出现「运行测试」，结果在「输出」页。

## 终端（Git / Linux）

真实的交互式 Bash：逐条输入命令、回车就执行，提示符是 `learner@nanaly:~$`，工具栏显示终端当前所在目录。可以用 `nano`、`vim` 编辑文件，`man` 查手册（`man -k` 搜索），`↑ ↓` 翻命令历史（`history`、`!!`、`Ctrl+R` 都能用），`Tab` 补全文件名和 Git 子命令，`Ctrl+C` 中断，`Ctrl+L` 清屏，还有 `less`、`tail -f`、`tmux`、`htop`、`make` 等。`date` 按北京时间显示。选中文字后 `Ctrl+C` 是复制，`Ctrl+V` 粘贴。手机上终端下方有一排 Tab、Esc、Ctrl+C、Ctrl+D、Ctrl+L 和方向键。

- **终端不随网页关闭**：刷新、换页、关掉分屏再打开，终端都还在（正在跑的命令也还在跑），屏幕内容原样回来；网络断了会自己重连，只补发没收到的部分。离开超过 30 分钟，或者连续开了 3 小时，终端会保存后关闭。
- 文件、当前目录、导出的变量、别名、函数和命令历史都会保存：输入 `exit`、闲置关闭、后端更新都会先保存。下次打开从上次停下的地方继续。退出后按任意键重新打开。
- 「脚本」模式：上面是编辑器，下面是同一个终端；「在终端执行」把整段命令粘进终端执行，效果和手敲一样（`cd` 之后留在那个目录）。
- `code 文件名`：在网页编辑器里打开这个文件（不存在就新建），`Ctrl / ⌘ + S` 或「保存」写回去，「关闭文件」回到终端。一次打开一个文件，超过 64 KB 的请用 nano 或 vim。桌面版 VS Code 在这里打不开。
- Git 和 Linux 各有一个工作区、各自一个终端；同一个终端可以同时在多个网页里打开，打字互相看得见。
- 「重启终端」结束当前 Shell（先保存）再开一个；「重置运行环境」清空文件和命令历史。
- 「请教娜娜莉」能看到当前终端最后约 60 行。

**做不了的事**：运行环境没有管理员权限，也不能联网——`sudo` 会直接说明没有 root，`apt install`、`git clone https://…`、`curl`、`ping` 外网都不行。Git 的远程仓库可以用本地裸仓库练（`git init --bare`），需要的工具可以加进运行环境的镜像。

## MySQL

直接执行编辑器里的 SQL，输出保持后端返回的真实文本表格，在「输出」页。表和数据跨次保留，可重置。未连接服务、未部署容器或服务异常时会明确报错，不运行宿主命令，不生成模拟执行结果。

## 记录与恢复

- 浏览器默认保存草稿与最近 40 次运行；可在「更多」关闭本机保存或下载当前代码，在「记录」恢复代码与输入。存储拒绝或配额不足时保留内存记录并提示。
- 「记录」收的是经接口执行的运行（测试、SQL、娜娜莉的任务步骤）；在终端里交互运行的程序和敲过的命令不进「记录」，命令留在终端的 `history` 里。
- 后端记录保存在私有服务中。连接后或手动点击同步时，从 `/api/runs` 合并最近记录；恢复仍需重新运行，不把历史结果标为当前已验证。
- Git/Linux/MySQL 通过 `GET /api/workspaces` 读取服务器当前工作区列表，按语言恢复最近更新的工作区；不从运行历史猜测 ID，因此清空历史不会丢失文件。执行前恢复完成，并使用最新 revision 做 CAS 校验，防止跨设备覆盖。
- 本机与云端历史可分别删除。关闭本机保存不等于删除后端记录。
- 停止等待或网络异常后，不声称命令已撤销，也不自动重跑。下次运行前核对工作区 revision、busy 与 broken；空闲且完好时可继续使用，仍忙碌则等待，快照损坏时才要求重置。恢复失败保留原工作区并允许重试。

## 集成接口

注入顺序：`privacy-gate.js` → `nanaly-agent.js` 与 `noimpty-ai.js` → `learning-editor.js` → `learning-lab.js`。样式为 `source/css/learning-lab.css`。终端的 xterm.js 打包在 `learning-terminal.js`（约 350 KB），只在第一次打开终端时加载；页面里一个 `type="text/plain"` 的 `#learning-terminal-src` 标签带着它的内容指纹 URL，不会被执行。两个包都由 `npm run build:learning-editor` 从 `tools/assets/*-entry.mjs` 构建。只有 `NOIMPTY_GATE.unlocked() === true` 时才读取记录、挂载页面、同步或发送代码。

使用 `NANALY_AGENT.configured()`、`request(path, {method, body, signal})`、`socketURL(path)`（终端 WebSocket 地址）、`setContext(object | null)`、`subscribe(callback)` 与 `open()`。调用 `NANALY.askPractice({question, context})` 返回 Promise<boolean> 接入聊天。

后端契约：

- `POST /api/run`：`{language, code, stdin, tests:[{input,expectedOutput?}], revision, mode:'run'|'check', workspaceId?, workspaceRevision?}`。
- 结果：`{runId,revision,status,stdout,stderr,diagnostics:[{severity,message,line?,column?}],tests,workspaceId?,workspaceRevision?,workspaceSummary?,workspaceCommitted?,cwd?,exitCode?,warnings?}`。
- `GET /api/workspaces`：`{workspaces:[{workspaceId,language,revision,updatedAt,busy,broken?,...}]}`，为恢复环境的权威列表。
- `POST /api/workspaces/reset`：`{language,workspaceId?}` → `{workspaceId,revision}`。
- `GET /api/workspaces/:id`：返回最新 `revision`、`busy`、`broken` 等状态。
- `POST /api/terminal/ticket` 取一次性票据，再连 `GET /api/terminal?ticket=…` 的 WebSocket：`kind:'shell'` 接到 Git/Linux 工作区的终端（带上次的 `sessionId` 与 `since` 只补发缺的输出），`kind:'task'` 带 `code` 运行一次程序。消息格式见 `learning-backend.md`「交互式终端」。
- 终端开着时，同一工作区的 `POST /api/run` 在终端所在的沙箱和目录里执行，改动随终端一起保存。
- `GET /api/runs?limit=40`：`{runs:[{...result,language,code,stdin,testCases,createdAt,mode?}]}`；`DELETE /api/runs` 删除私有历史。

`window.LEARNING_LAB.runCurrent({signal})` 供用户已授权的持久任务步骤调用：有测试用例时运行全部测试，否则运行当前输入；成功返回本次真实结果，没有结果则抛出错误。`window.LEARNING_LAB.context()` 返回当前已解锁练习的上下文。

`window.LEARNING_LAB.loadPractice(exercise)` 载入 `NANALY.preparePractice({request,language,signal})` 返回的已验证练习。必需字段为 `id,language,title,statement,starterCode,referenceCode,tests,verification:{runId,status:'accepted'}`；失败、缺失来源或测试不完整会拒绝载入。当前页面不提供出题按钮；此接口保留给已有智能体流程，前端校验数据契约，不把传入标签当作自身执行证明。`practice` 元数据随实际提交存入私有云端历史，本机另外保留最近 10 个出题前的草稿恢复点。

控制器以递增版本关联代码、输入和用例。编辑会取消旧的自动检查；旧运行可以进入历史，但不得覆盖新版本的结果或诊断。执行期间禁止切换语言和并发提交。后端工作区 CAS 与浏览器 revision 分别用于文件状态和编辑器状态。

## 验证

`tools/tests/learning/learning-lab.test.mjs` 覆盖终端连接（票据、早按的键、断线自动重连只补缺、退出后开新终端、旧后端提示更新、程序运行不重连）、隐私门控、未连接拒绝、实际请求快照、失败版本恢复、过期诊断、并发、取消后的状态不确定性、CAS、存储失败、跨设备记录、销毁与异步回调等行为。这些测试使用明确标记的请求替身，仅验证前端状态机；真实容器及参考解验收由后端集成测试执行。
