# 边读边练

入口 `/learn/`；私人文章页也有「边读边练」按钮。文章模式把原文 DOM 暂时放到左侧，保留图片、代码块与链接；关闭或 PJAX 跳转前恢复原位。窄屏改为上下排列。所有输入与输出均用 DOM 文本节点渲染，不解释后端输出中的 HTML。

## 使用

1. 解锁私人页面，在娜娜莉工作室中连接个人后端。
2. 选择 C、C++、Go、Git、Linux 或 MySQL。算法练习可编辑标准输入与最多 10 个测试用例；Git、Linux 和 MySQL 使用各自持续保存的隔离工作区。
3. 点击运行、提交测试或工具检查。`Ctrl / ⌘ + Enter` 运行当前输入。新会话默认启用自动工具检查，在停止编辑 900 毫秒后把代码发送到已连接的个人后端；用户关闭的偏好会保留。只检查 C/C++/Go 与 Git/Linux 脚本语法，不自动执行命令或 SQL，不调用付费 AI。MySQL 仍需明确点击运行。
4. 工具诊断标出行号，点击可选中对应代码行。编译/运行/超时/测试失败保留在结果及提交历史中。MySQL 不提供伪造的即时语法检查，必须明确运行后由真实数据库验证。
5. 请教娜娜莉会携带题目、当前文章、代码版本、输入、测试与当前版本的真实结果。工具结论与 AI 推测分开；编辑代码后旧输出不再作为当前版本的验证依据。
6. 在问题框描述练习要求，点击「请娜娜莉出题并验证」。C/C++/Go 参考解必须经过实际编译和全部指定测试通过，才会载入题面、起始代码与用例。参考解及验证运行 ID 默认折叠显示；AI 生成题面、参考解与测试覆盖仍可纠正，不声称全面证明算法正确。起始代码保持「尚未执行」。原草稿会保存为恢复点；生成期间已改动的草稿不会被自动覆盖。

Git/Linux 每次请求启动一个新 shell；工作目录文件持久保存，`cd` 和环境变量只在本次脚本内生效。MySQL 输出保持后端返回的真实文本表格。文件、仓库和表可重置；代码和提交历史仍保留。未连接服务、未部署容器或服务异常时会明确报错，不运行宿主命令，不生成模拟执行结果。

## 记录与恢复

- 浏览器默认保存草稿与最近 40 次提交，可关闭本机保存、下载 JSON 备份、恢复任一失败或修正版本。存储拒绝或配额不足时保留内存记录，并提示备份。
- 后端记录保存在私有服务中。连接后或手动点击同步时，从 `/api/runs` 合并最近记录；恢复仍需重新运行，不把历史结果标为当前已验证。
- Git/Linux/MySQL 从云端最近提交恢复工作区 ID，并查询最新工作区 revision，跨设备使用 CAS 防止覆盖其他操作。
- 本机与云端历史可分别删除。关闭本机保存不等于删除后端记录。
- 停止等待会中止浏览器请求，但不声称撤销已经执行的命令。有状态执行的结果不确定时禁止继续写入，要求先重置环境；编译型语言可重新执行。

## 集成接口

注入顺序：`privacy-gate.js` → `nanaly-agent.js` 与 `noimpty-ai.js` → `learning-lab.js`。样式为 `source/css/learning-lab.css`。只有 `NOIMPTY_GATE.unlocked() === true` 时才读取记录、挂载页面、同步或发送代码。

使用 `NANALY_AGENT.configured()`、`request(path, {method, body, signal})`、`setContext(object | null)`、`subscribe(callback)` 与 `open()`。调用 `NANALY.askPractice({question, context})` 返回 Promise<boolean> 接入聊天。

后端契约：

- `POST /api/run`：`{language, code, stdin, tests:[{input,expectedOutput?}], revision, mode:'run'|'check', workspaceId?, workspaceRevision?}`。
- 结果：`{runId,revision,status,stdout,stderr,diagnostics:[{severity,message,line?,column?}],tests,workspaceId?,workspaceRevision?,workspaceSummary?,workspaceCommitted?,warnings?}`。
- `POST /api/workspaces/reset`：`{language,workspaceId?}` → `{workspaceId,revision}`。
- `GET /api/workspaces/:id`：返回最新 `revision`、`busy`、`broken` 等状态。
- `GET /api/runs?limit=40`：`{runs:[{...result,language,code,stdin,testCases,createdAt,mode?}]}`；`DELETE /api/runs` 删除私有历史。

`window.LEARNING_LAB.runCurrent({signal})` 供用户已授权的持久任务步骤调用：有测试用例时运行全部测试，否则运行当前输入；成功返回本次真实结果，没有结果则抛出错误。`window.LEARNING_LAB.context()` 返回当前已解锁练习的上下文。

`window.LEARNING_LAB.loadPractice(exercise)` 载入 `NANALY.preparePractice({request,language,signal})` 返回的已验证练习。必需字段为 `id,language,title,statement,starterCode,referenceCode,tests,verification:{runId,status:'accepted'}`；失败、缺失来源或测试不完整会拒绝载入。后台执行生成与验证，前端校验数据契约，不把传入标签当作自身执行证明。`practice` 元数据随实际提交存入私有云端历史，本机另外保留最近 10 个出题前的草稿恢复点。

控制器以递增版本关联代码、输入和用例。编辑会取消旧的自动检查；旧运行可以进入历史，但不得覆盖新版本的结果或诊断。执行期间禁止切换语言和并发提交。后端工作区 CAS 与浏览器 revision 分别用于文件状态和编辑器状态。

## 验证

`tools/tests/learning/learning-lab.test.mjs` 覆盖隐私门控、未连接拒绝、实际请求快照、失败版本恢复、过期诊断、并发、取消后的状态不确定性、CAS、存储失败、跨设备记录、销毁与异步回调等行为。这些测试使用明确标记的请求替身，仅验证前端状态机；真实容器及参考解验收由后端集成测试执行。
