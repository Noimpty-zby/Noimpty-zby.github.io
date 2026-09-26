# 代码小屋（边学边练）

入口 `/learn/`；文章页的「边学边练」将原页面左右分屏，可拖动分隔条调整宽度，窄屏用「阅读文章 / 编写代码」切换。分屏打开时按文章选语言：先看分类（Git、Linux 入门），再看正文里最多的代码块语言；随笔等没有代码的文章保持上次的语言。关闭或 PJAX 跳转时恢复原页面。输入与输出按文本渲染，不解释后端输出中的 HTML。

## 使用

1. 解锁页面，点击顶部「连接后端」填写个人后端地址与令牌。状态点显示未连接、连接中、已连接或连接失败，验证成功后才变绿。
2. 选择 C、C++、Go、Python、Git、Linux 或 MySQL 后直接写代码。编辑器提供语法高亮与补全；不需要选择题目或载入实例。Python 环境已装好 NumPy 与 CPU 版 PyTorch，运行环境不联网、不能 pip install，第一次 `import torch` 需要几秒。
3. 在「输入」填写标准输入，点击「运行」或按 `Ctrl / ⌘ + Enter`；Git/Linux 按钮为「执行脚本」，每次执行整个编辑器内容。真实输出、错误、当前目录及退出码显示在「终端」，历史在「记录」中恢复。MySQL 直接执行编辑器里的 SQL。
4. 「更多」提供配色、自动语法检查、本机保存、请教娜娜莉、手动检查、下载代码、清空编辑器与重置环境。自动检查默认开启（关掉后记住选择），停止编辑 900 毫秒后用真实编译器检查 C/C++/Go、Python 或 Bash 语法：错误在编辑器里画红色波浪线并在行号旁标记，警告为黄色，gcc 的 note 只作提示；悬停可看原文。自动检查不执行脚本或 SQL、不调用付费 AI，也不弹出提示或错误，只更新标记；MySQL 需明确运行。运行结果里的编译错误和 Python traceback 同样标在对应行。诊断行号可点击定位，编辑后的旧输出标为上次运行。
5. 编辑器和终端之间的横条可以拖动（或聚焦后按上下方向键）调整终端高度，本浏览器记住高度，双击恢复默认。

Git/Linux 按 Bash 脚本执行。下次运行会接续上次保存的目录、`export` 变量、`umask`、别名和函数，并保留工作区文件及权限；例如先运行 `mkdir demo; cd demo; export NAME=hello`，下次运行 `pwd; echo "$NAME"` 会继续在 `demo` 中得到 `hello`。普通未导出变量、后台进程和 `/tmp` 文件不会跨次保留。显式 `exit 7` 会显示失败及实际退出码，失败前已完成的文件变化是否保存以 `workspaceCommitted` 为准。

Linux 已提供 `ncal` / `cal`、常用文本工具、压缩解压、`jq`、`bc` 和 `man`；Linux 与 Git 中新建仓库都能使用默认身份提交。这里仍是无网络、非 root、没有交互式终端的隔离脚本环境，`curl`、`wget`、`ssh` 虽已安装也不能连接外网；交互式编辑器、密码提示和长期后台服务不在支持范围内。

MySQL 输出保持后端返回的真实文本表格。文件、仓库和表可重置；代码和提交历史仍保留。未连接服务、未部署容器或服务异常时会明确报错，不运行宿主命令，不生成模拟执行结果。

## 记录与恢复

- 浏览器默认保存草稿与最近 40 次运行；可在「更多」关闭本机保存或下载当前代码，在「记录」恢复代码与输入。存储拒绝或配额不足时保留内存记录并提示。
- 后端记录保存在私有服务中。连接后或手动点击同步时，从 `/api/runs` 合并最近记录；恢复仍需重新运行，不把历史结果标为当前已验证。
- Git/Linux/MySQL 通过 `GET /api/workspaces` 读取服务器当前工作区列表，按语言恢复最近更新的工作区；不从运行历史猜测 ID，因此清空历史不会丢失文件。执行前恢复完成，并使用最新 revision 做 CAS 校验，防止跨设备覆盖。
- 本机与云端历史可分别删除。关闭本机保存不等于删除后端记录。
- 停止等待或网络异常后，不声称命令已撤销，也不自动重跑。下次运行前核对工作区 revision、busy 与 broken；空闲且完好时可继续使用，仍忙碌则等待，快照损坏时才要求重置。恢复失败保留原工作区并允许重试。

## 集成接口

注入顺序：`privacy-gate.js` → `nanaly-agent.js` 与 `noimpty-ai.js` → `learning-lab.js`。样式为 `source/css/learning-lab.css`。只有 `NOIMPTY_GATE.unlocked() === true` 时才读取记录、挂载页面、同步或发送代码。

使用 `NANALY_AGENT.configured()`、`request(path, {method, body, signal})`、`setContext(object | null)`、`subscribe(callback)` 与 `open()`。调用 `NANALY.askPractice({question, context})` 返回 Promise<boolean> 接入聊天。

后端契约：

- `POST /api/run`：`{language, code, stdin, tests:[{input,expectedOutput?}], revision, mode:'run'|'check', workspaceId?, workspaceRevision?}`。
- 结果：`{runId,revision,status,stdout,stderr,diagnostics:[{severity,message,line?,column?}],tests,workspaceId?,workspaceRevision?,workspaceSummary?,workspaceCommitted?,cwd?,exitCode?,warnings?}`。
- `GET /api/workspaces`：`{workspaces:[{workspaceId,language,revision,updatedAt,busy,broken?,...}]}`，为恢复环境的权威列表。
- `POST /api/workspaces/reset`：`{language,workspaceId?}` → `{workspaceId,revision}`。
- `GET /api/workspaces/:id`：返回最新 `revision`、`busy`、`broken` 等状态。
- `GET /api/runs?limit=40`：`{runs:[{...result,language,code,stdin,testCases,createdAt,mode?}]}`；`DELETE /api/runs` 删除私有历史。

`window.LEARNING_LAB.runCurrent({signal})` 供用户已授权的持久任务步骤调用：有测试用例时运行全部测试，否则运行当前输入；成功返回本次真实结果，没有结果则抛出错误。`window.LEARNING_LAB.context()` 返回当前已解锁练习的上下文。

`window.LEARNING_LAB.loadPractice(exercise)` 载入 `NANALY.preparePractice({request,language,signal})` 返回的已验证练习。必需字段为 `id,language,title,statement,starterCode,referenceCode,tests,verification:{runId,status:'accepted'}`；失败、缺失来源或测试不完整会拒绝载入。当前页面不提供出题按钮；此接口保留给已有智能体流程，前端校验数据契约，不把传入标签当作自身执行证明。`practice` 元数据随实际提交存入私有云端历史，本机另外保留最近 10 个出题前的草稿恢复点。

控制器以递增版本关联代码、输入和用例。编辑会取消旧的自动检查；旧运行可以进入历史，但不得覆盖新版本的结果或诊断。执行期间禁止切换语言和并发提交。后端工作区 CAS 与浏览器 revision 分别用于文件状态和编辑器状态。

## 验证

`tools/tests/learning/learning-lab.test.mjs` 覆盖隐私门控、未连接拒绝、实际请求快照、失败版本恢复、过期诊断、并发、取消后的状态不确定性、CAS、存储失败、跨设备记录、销毁与异步回调等行为。这些测试使用明确标记的请求替身，仅验证前端状态机；真实容器及参考解验收由后端集成测试执行。
