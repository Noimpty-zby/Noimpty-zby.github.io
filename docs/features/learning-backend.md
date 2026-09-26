# 娜娜莉私有后端与隔离练习

该服务为博客聊天、目标、笔记与代码小屋提供同一份私有状态；C、C++、Go、Python、Git、Linux 和 MySQL 的代码由真实工具在独立 Docker 容器中执行。前端静态站点不保存访问令牌到仓库；运行依赖未就绪时，服务返回明确错误，不在宿主机直接执行用户代码。

## 本次验证范围

2026-09-25 在 WSL Ubuntu 22.04、Node.js 24.19.0 和 Docker 29.1.3 上完成验证：

- 25 项 Node 行为与独立边界测试通过（含部署阶段新增的代理限流回归），涵盖鉴权、Origin、CAS、备份恢复、历史、工作区锁、探针去重、取消竞态与实例清理范围。
- 真实 Docker 主集成及六种前端课程参考样例共 7 项通过（约 98 秒），包括编译错误、超时、输出上限、Git/Linux 状态接续、MySQL 表/过程/事件恢复及数据库权限。
- 真实隔离/取消集成 1 项通过（约 10 秒）：用例不共享文件、容器只有 lo 网卡、非 root 且无 capability、根文件系统只读、不含宿主仓库/令牌；观察到脚本已修改文件后再取消，确认未提交且恢复旧版本。
- 验收结束未残留运行容器。镜像实测 GCC 13.3.0、Go 1.22.2、Git 2.43.0、MySQL 8.0.46；语言标准为 C17 / C++20。

同日已在腾讯云新加坡 Ubuntu 24.04、2 核 8 GB 主机完成 rootless Docker 生产部署：`https://api.noimpty-zby.cn` 已通过公网 HTTPS、健康检查、鉴权、精确 CORS、私有状态、真实 C 两用例和执行中的 HTTPS 取消验收；云端 8 项 Docker 集成测试全部通过、无跳过，覆盖六种语言、隔离、取消和持久化。完整部署与验收范围见 [生产部署记录](../maintenance/2026-09-25-production-deployment.md)。

主站使用 `https://noimpty-zby.cn`。持久数据位于后端主机磁盘；本地前一版备份不等于已经配置异机灾备。

`NANALY_DOCKER_TESTS=1` 用于显式开启真实集成；未运行该命令的环境不能引用本机或生产机结果声称它也已通过。

2026-09-25 本次 Linux/Git 更新另在候选镜像 `nanaly-runner:shell-20260925` 上通过真实 Docker 集成 13/13 项，无跳过，覆盖六种语言、隔离/取消以及新增的 5 项行为回归：`ncal` 与常用命令、跨次目录/变量/别名/函数/权限、Linux 与 Git 新建子仓库提交、非零退出码和失败前文件恢复。此结果独立于上面的首次部署验收记录。

## 部署条件

- Linux 主机、Node.js 22 或更新版本、Docker Engine、启用 memory / pids / cpu controller 的 cgroup v2。
- 单人使用，默认同时执行 1 个任务；名额被占用时新请求最多等待 20 秒（例如刚取消的检查容器还在清理），超时才返回 429 `RUNNER_BUSY`；每个工作容器最多 1 CPU、1 GiB 内存及 96 个进程，禁用额外 swap。编译器容器与单个测试容器可能短暂并存，建议主机至少 4 GiB 内存。
- API 是需要持久磁盘和 Docker daemon 的常驻服务，不能直接部署到纯静态托管或普通无容器权限的 serverless 函数。
- 使用专用执行主机或专用 rootless Docker daemon。Docker 本身不是抵御所有内核漏洞的绝对安全边界；不把这个单人服务开放成公共多租户 OJ。
- rootless Docker 必须获得 cgroup v2 控制器委派。服务会检查 Docker 能力，并在容器中读取实际 memory.max / pids.max / cpu.max，限制未生效时拒绝执行。
- 数据目录必须在博客仓库之外，不能是符号链接。目录权限 0700，持久文件权限 0600。不要把此目录加入静态网站产物、公开备份或代码仓库。

## rootless 生产部署

生产 API 运行在宿主 systemd 服务 `nanaly.service`，代码位于 `/opt/blog` 且由 root 持有；专用账户 `nanaly` 的主目录为 `/var/lib/nanaly`。Docker daemon 则由该账户的用户级 `docker.service` 管理，不把 rootless daemon 塞入系统级 `User=nanaly` 单元。

先按 [Docker Ubuntu 安装说明](https://docs.docker.com/engine/install/ubuntu/) 安装官方软件包，包括 `docker-ce-rootless-extras`、`uidmap`、`dbus-user-session`、`apparmor` 与 `slirp4netns`。Ubuntu 24.04 对非特权用户命名空间有 AppArmor 限制，官方 deb 安装方式有相应 rootlesskit 配置；不要全局关闭 AppArmor 绕过问题。账户在 `/etc/subuid` 与 `/etc/subgid` 中须分别拥有至少 65,536 个 subordinate ID，且主机使用 cgroup v2。

只在确认新主机没有其他 Docker 服务时停用 rootful `docker.service`/`docker.socket`。生产环境仅使用专用 rootless daemon；API 与 daemon 必须使用同一账户，保持私有数据目录 0700，不通过放宽目录权限解决挂载错误。

以下命令由管理员在已创建 `nanaly` 账户后执行，UID 每次从目标主机获取，不能复制其他主机的数字：

```sh
nanaly_uid="$(id -u nanaly)"
sudo install -d -m 0755 "/etc/systemd/system/user@${nanaly_uid}.service.d"
printf '[Service]\nDelegate=cpu cpuset io memory pids\n' | sudo tee "/etc/systemd/system/user@${nanaly_uid}.service.d/delegate.conf" >/dev/null
sudo systemctl daemon-reload
sudo loginctl enable-linger nanaly
sudo systemctl start "user@${nanaly_uid}.service"
sudo runuser -u nanaly -- env XDG_RUNTIME_DIR="/run/user/${nanaly_uid}" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/${nanaly_uid}/bus" dockerd-rootless-setuptool.sh install
sudo runuser -u nanaly -- env XDG_RUNTIME_DIR="/run/user/${nanaly_uid}" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/${nanaly_uid}/bus" systemctl --user enable --now docker
```

如果 `user@UID.service` 在增加委派配置前已经运行，必须在没有其他用户任务时重新启动它，再启动用户级 Docker 服务，使委派生效。通过同一 socket 检查 `docker info` 的 cgroup v2、systemd driver、CPU/memory/pids 支持及 rootless security option；不能只看到 Docker 进程就判定可执行。

部署包应包含 `server/`、`tools/tests/server/` 与课程参考文件 `source/js/learning-lab.js`。Node.js 生产版本为 24.19.0，入口 `/usr/local/bin/node`；安装其他路径时同步调整 service。执行镜像必须在 API 所连接的同一个 rootless daemon 中构建：

```sh
cd /opt/blog
nanaly_uid="$(id -u nanaly)"
sudo runuser -u nanaly -- env DOCKER_HOST="unix:///run/user/${nanaly_uid}/docker.sock" docker compose -f server/compose.yaml --profile build build runner-image
```

创建 `/srv/nanaly-private`，归属 `nanaly:nanaly`、权限 0700；创建 `/etc/nanaly`，归属 `root:nanaly`、权限 0750。令牌在 `/etc/nanaly/token` 单独生成，内容为 32 字节安全随机数的十六进制文本，归属 `nanaly:nanaly`、权限 0400。不要覆盖已有令牌，也不要将其输出到终端、日志、仓库或部署包。`NANALY_TOKEN` 仍可作为 `NANALY_TOKEN_FILE` 的替代；生产优先使用受权限保护的令牌文件或 secret manager。

可选的后台令牌给 GitHub Actions 用：按同样方式另生成 `/etc/nanaly/automation-token`（必须与主令牌不同），在 `/etc/nanaly.env` 加上 `NANALY_AUTOMATION_TOKEN_FILE=/etc/nanaly/automation-token`。配置了却读不到文件时服务拒绝启动。

示例文件中的 `@NANALY_UID@` 是必须替换的占位符，systemd 不会自动展开它。首次安装时，在仓库根目录执行：

```sh
nanaly_uid="$(id -u nanaly)"
sed "s/@NANALY_UID@/${nanaly_uid}/g" server/nanaly.service.example | sudo tee /etc/systemd/system/nanaly.service >/dev/null
sudo install -m 0600 -o root -g root server/.env.example /etc/nanaly.env
sudo sed -i "s/@NANALY_UID@/${nanaly_uid}/g" /etc/nanaly.env
```

用管理员编辑器将 `/etc/nanaly.env` 的 `NANALY_ALLOWED_ORIGINS` 改为实际前端来源，按协议、域名、端口精确填写，不带尾部斜杠，多个 Origin 用逗号分隔。部署更新时保留现有环境配置，不再覆盖它。生产允许当前 GitHub Pages 及规划中的主域名、www 域名；允许名单不代表那些前端均已发布。

完成令牌、路径和来源配置后执行：

```sh
sudo systemd-analyze verify /etc/systemd/system/nanaly.service
sudo systemctl daemon-reload
sudo systemctl enable --now nanaly
curl --fail http://127.0.0.1:4318/api/health
```

service 依赖实际 `user@UID.service`，启动前通过同一 `DOCKER_HOST` 执行 `docker info`；daemon 未就绪时服务等待下一次重启，避免跳过启动清理。API 默认只监听 `127.0.0.1:4318`，云防火墙不公开该端口或 Docker socket。

使用官方 Caddy 软件包管理 HTTPS，将 `server/Caddyfile.example` 的 API 域名替换为实际域名，配置 DNS A 记录并放行公网 TCP 80/443，再执行 `caddy validate` 和启动服务。Caddy 上游 keepalive 为 4 秒，低于 Node 的 5 秒；响应头超时为 150 秒。保留默认客户端取消传播，不添加 `flush_interval -1`。代理超时与容器的 150 秒生存期不是同一个计时器，完整批次仍需通过实际 HTTPS 链路验收。

## 更新部署

首次安装按上一节手动完成。之后每次更新后端，提交代码后在仓库根目录执行：

```sh
npm run deploy:backend            # 执行镜像没变时约半分钟
npm run deploy:backend -- --full  # 另外强制跑一遍真实 Docker 集成测试
```

脚本 `tools/deploy/backend.sh` 只部署已提交的代码：本地后端测试通过后，用 `git archive` 打包 `server/`、`tools/tests/server/`、课程参考代码和服务器端脚本，经部署密钥传到服务器，由 `tools/deploy/backend-remote.sh` 以 root 执行：

1. 解包到 `/opt/blog.next`，写入 `server/BUILD`（提交号）。
2. 执行镜像按 `server/runner/` 的 git 树哈希命名为 `nanaly-runner:<哈希>`；不存在时在 nanaly 的 rootless daemon 中构建，并用新镜像跑真实 Docker 集成测试。测试失败即停止，线上目录、环境配置和服务都不动。
3. 把 `/etc/nanaly.env` 的 `NANALY_RUNNER_IMAGE` 换成新镜像，`/opt/blog` 与新目录对调（旧版留在 `/opt/blog.prev`），重启 `nanaly.service`。
4. 本机健康检查必须在 40 秒内报出新提交号且执行环境就绪；否则把目录和环境配置换回上一版并重启，失败版本留在 `/opt/blog.failed`。
5. 成功后只保留当前和上一版执行镜像。

最后脚本从公网复查 `GET /api/health` 的 `build` 字段。重启会中断正在执行的代码。`server/nanaly.service.example` 与已安装的服务文件不同时只提示，不自动替换；Caddy 配置也不在脚本范围内。服务器地址、密钥和 known_hosts 可用 `NANALY_DEPLOY_HOST`、`NANALY_DEPLOY_KEY`、`NANALY_DEPLOY_KNOWN_HOSTS` 覆盖。

## API 契约

除 `GET /api/health` 和 CORS 预检之外，所有接口均要求 `Authorization: Bearer <token>`。后台令牌只能访问 `/api/automation/` 下的两个接口，其余一律返回 403 `SCOPE_DENIED`；主令牌可以访问全部接口。JSON 写请求要求 `Content-Type: application/json`，请求体上限约 1.2 MB。所有响应使用 `Cache-Control: no-store`；异常响应不包含宿主路径、令牌或错误堆栈。没有登录 cookie，不信任传入的 X-Forwarded-For。正确认证、失败认证和健康探针分别限流，避免反向代理共享 loopback 地址时错误令牌阻断合法操作。

| 接口 | 请求与结果 |
| --- | --- |
| GET /api/health | 返回 version、build（部署的提交号，手动部署时为 null）、runner.ready、capabilities；API在线不等于执行容器已就绪 |
| GET /api/state | `{revision,data}`，初始 data 包含 memories/goals/notes/experiences/events 数组 |
| PUT /api/state | `{revision,data}`；原子替换并返回新 revision，保留调用者发送的未知字段 |
| POST /api/run | `{language,code,stdin?,tests?,revision?,mode?,workspaceId?,workspaceRevision?,saveHistory?,practice?}` |
| GET /api/runs?limit=50 | `{runs:[...]}`，按最新在前排列；保留代码、输入、testCases、真实结果及时间 |
| DELETE /api/runs | 清空服务器历史及其前一版备份，不影响浏览器自己的草稿和历史 |
| POST /api/terminal/ticket | `{kind:'shell',language:'git'\|'linux',workspaceId?,sessionId?,since?}` 或 `{kind:'task',language,code}`，都可带 `cols,rows`；返回 `{ticket,expiresIn:30}`：一次性、30 秒内有效的终端票据 |
| GET /api/terminal?ticket=… | WebSocket 升级（见下文「交互式终端」）；只认票据，不接受令牌，Origin 须在允许列表内 |
| GET /api/workspaces | 返回 `{workspaces:[{workspaceId,language,revision,updatedAt,busy,broken?,...}]}`，按最近更新时间排列，供前端权威恢复环境 |
| POST /api/workspaces/reset | `{language,workspaceId?}`，返回全新 `{workspaceId,language,revision:0}` |
| GET /api/workspaces/:id | 返回 language、revision、busy、updatedAt |
| DELETE /api/workspaces/:id | 删除此工作区与快照，忙碌时返回 409 |
| GET /api/automation/context | `{memories,strategies}`：服务器只返回 `confirmed===true` 且 `publicAllowed===true` 的记忆和经验，字段只有 kind/text/source 与 lesson/evidence |
| POST /api/automation/events | `{kind,detail,status}`，追加一条 `source:'background'` 的行动记录（detail 截到 600 字，status 为小写英文，保留最近 200 条），返回 `{event}`；不需要也不读取整份状态 |

错误格式为 `{error:{code,message},...extra}`。state 版本冲突返回 HTTP 409 和服务器最新 `revision,data`，客户端应合并或让用户决定，不得直接覆盖。工作区冲突返回 `workspaceRevision`。工作区上限 12；重置替换旧编号，旧设备使用旧编号会得到 404，避免 reset 后 revision 归零造成 ABA 覆盖。

### 交互式终端

浏览器的 WebSocket 无法带 `Authorization` 头，所以先用令牌 `POST /api/terminal/ticket` 取票据，再连 `wss://…/api/terminal?ticket=…`。票据只能用一次，30 秒过期；长期令牌不进任何 URL。WebSocket 由 `server/lib/websocket.mjs` 自己实现（部署不带 node_modules），只支持单连接所需的部分：掩码帧、分片、ping/pong、关闭握手，服务端每 25 秒 ping 一次，对端两次不回应即断开；单条消息上限 2 MB（给编辑器保存文件留的）。

票据请求：
- `{kind:'shell', language:'git'|'linux', workspaceId?, sessionId?, since?, cols?, rows?}`：接到这个工作区的 Shell。开着的 Shell 所有网页共用；带上次的 `sessionId` 和已收到的字节数 `since` 时只补发缺的部分，否则补发服务端保留的最近 256 KB（页面先清屏）。
- `{kind:'task', language:'c'|'cpp'|'go'|'python', code, cols?, rows?}`：在一个一次性容器里编译并运行 `code`，同一语言再次运行会结束上一次。

浏览器 → 服务（文本帧 JSON）：`{type:'input',data}`（≤ 64 KiB）、`{type:'resize',cols,rows}`、`{type:'terminate'}`（结束 Shell 或程序）、`{type:'read',id,path}` 与 `{type:'write',id,path,content}`（`code 文件名`，只对 Shell，≤ 1 MB 的 UTF-8 文本）。

服务 → 浏览器：二进制帧是终端原始输出；文本帧 JSON 为 `status`（正在启动）、`ready`（`sessionId`、`offset`、`reset`、`replay` 字节数、`workspaceId`、`workspaceRevision`）、`exit`（`code`、`seconds`、`reason`；Shell 另有 `committed`、`workspaceRevision`、`cwd`、`warnings`、`message`）、`file` / `written`，启动失败时 `error`。`exit` 之后以 1000 关闭；后端重启时以 1012 关闭，页面自行重连。紧跟 `ready` 的 `replay` 字节是补发的旧输出，页面重画但不再执行其中的 `code` 请求。

生命周期：连接断开不结束 Shell；没有页面连着超过 30 分钟、连续 3 小时、输入 `exit`、重置/删除工作区或后端停止时，Shell 挂断并保存工作区（CAS）。程序运行在页面离开时就结束，最长 30 分钟。同时最多 2 个 Shell、2 个程序运行，都不占脚本执行的并发槽。

data 为最大 1 MiB 的 JSON 对象，限制深度和字段数量，不允许 prototype 污染字段。服务仅保存状态；目标是否获授权、事实/观察/推测的区别、模型工具授权和人格规则由统一智能体控制层处理。记录经验不代表模型参数已训练。

执行语言为 `c / cpp / go / python / git / linux / mysql`；测试用例适用于 c / cpp / go / python；代码和单条输入最多 64 KiB；最多 10 个测试，测试合计最多 256 KiB。`revision` 是代码版本，仅用于原样返回并让前端丢弃过期诊断。`workspaceRevision` 是独立的持续工作区 CAS 版本。

运行结果包含：

```json
{
  "runId": "uuid",
  "revision": 7,
  "status": "accepted",
  "stdout": "5\n",
  "stderr": "",
  "diagnostics": [],
  "tests": [{"input": "2 3", "expectedOutput": "5", "stdout": "5\n", "stderr": "", "status": "accepted"}]
}
```

status 可为 accepted、wrong_answer、compile_error、runtime_error、timeout、output_limit、checked 或 unsupported_check。诊断中的 line/column 仅在工具能解析出位置时返回；输出按文本返回，前端必须用 textContent 渲染。测试比较将 CRLF 统一成 LF 并忽略末尾空白，不忽略内部空白。

`mode:check` 对 C/C++/Go 只编译，对 Git/Linux 只做 bash 语法检查，不执行用户脚本。MySQL 返回 unsupported_check，不把 EXPLAIN 当成任意 SQL 的可靠或无副作用校验。MySQL 执行结果是制表符分隔的文本表格，不是伪造的结构化结果。

`practice` 可附带生成练习的 id、language、title、statement、starterCode、referenceCode、原始 tests 与 verification 来源；该上下文经字段/长度校验后保存在历史中，客户端提交的 verification 标签本身不是服务器签发的验证证明。

`saveHistory:false` 可跳过此次云端历史保存。默认保留最近 50 次运行，历史文件最多 2 MiB；历史中的单段输出最多 16 Ki 字符，超长时标记 historyOutputTruncated；历史无法保存时执行结果附带 warning。浏览器本机保存开关与后端历史独立。

## 容器边界及恢复

- 容器无网络、无端口发布、无 capability、禁止新增权限，以 UID/GID 10001 运行，根文件系统只读，保持 Docker 默认 seccomp。
- 只挂载本次代码与已有快照的只读输入目录；不挂载 Docker socket、私有状态目录或宿主可写目录。
- 工作目录为 256 MiB tmpfs，临时目录为 128 MiB tmpfs；每条命令输出上限 128 KiB，快照上限 32 MiB。Git/Linux 每次脚本最多执行 30 秒，算法每个用例 3 秒（Python 15 秒，`import torch` 本身就要几秒），C/C++编译 30 秒、Go编译 45 秒。容器还有 150 秒固定生存期限。
- 执行镜像另装 `/opt/py` 虚拟环境（NumPy、CPU 版 PyTorch，已在 PATH 最前，Linux 练习里的 `python3` 也是它），设 `OMP_NUM_THREADS=1`。Python 先由 `py-check.py` 编译检查，错误按 gcc 的 `文件:行:列` 格式输出；运行时的 traceback 取 `main.py` 最内层一帧作为诊断行。
- 镜像构建时预编译常用 Go 标准库到 `/opt/go-cache`，每次编译前复制进可写的 `/tmp/go-cache`（约 31 MB）；否则每次运行都要从空缓存重编标准库，服务器上约 20 秒。
- C/C++/Go 先编译，再为每个测试新建容器。用例之间不共享可写文件系统或进程。超时或输出超限时杀死容器，并在 finally 中删除容器。
- Git/Linux 每次执行独立 Bash 脚本；同一工作区会恢复上次保存的当前目录、导出的环境变量、umask、别名、函数及 `/work` 下的文件和权限。普通未导出变量、后台进程及 `/tmp` 文件不跨次保留；工作目录已不存在时回到 `/work` 并给出提示。后台残留进程清理后才生成快照。结果中的 `cwd` 为本次结束目录，`exitCode` 为实际脚本退出码；Git 状态或文件列表通过 workspaceSummary 返回。
- Linux 工具包括 `ncal` / `cal`、文本过滤、压缩解压、`jq`、`bc`、进程/文件查看及带手册的 `man`，另有 `nano`、`vim` 和 bash-completion（含 Git 子命令补全）。Linux 与 Git 工作区均提供默认 Git 提交身份，可在新建子仓库中直接提交，并可用 `git config` 修改；`.lesshst`、`.viminfo`、`.python_history` 等工具在 HOME（即 `/work`）留下的文件由系统级 excludesFile 忽略。`curl` / `wget` / `ssh` 已安装，但执行容器仍无外网；没有 root / sudo 或长期后台服务。
- 交互式终端（Git/Linux）用同样限制的容器（无网络、无 root、只读根文件系统），外加 `--hostname=nanaly`，生存期 3 小时 + 2 分钟；`shell-session.py terminal` 在容器里开 PTY 运行 `bash -i`，提示符为 `learner@nanaly:~$`（同时设窗口标题），`TERM=xterm-256color`，`TZ=Asia/Shanghai`。每条命令结束时（PROMPT_COMMAND）记下当前目录、导出变量、umask、别名、函数，命令历史也存进同一份 Shell 状态（最多 2000 行 / 200 KiB），所以连接意外断开也保留最后一个提示符时的状态。Shell 开着时占用工作区：同一工作区的脚本在这个容器里、Shell 当前目录下执行（`--pidfile` 给出 Shell 的 PID，读 `/proc/<pid>/cwd`），改动随 Shell 一起保存；重置和删除先结束 Shell。结束时 Bash 收到挂断，2 秒不退出就强制结束，然后清理残留进程、快照、按 CAS 提交。
- 程序运行（C/C++/Go/Python）用同样限制的一次性容器：代码放进只读的 `/input`，`shell-session.py pty` 在 PTY 上跑 `bash -c` 脚本，先显示一行带提示符的命令再真正执行（`gcc -std=c17 -Wall -Wextra -g main.c -o main -lm && ./main` 等，Go 先复制预热缓存）。
- 镜像去掉了 Ubuntu 最小化镜像对手册的排除，重装常用软件包，`man` / `man -k` 可用；另装 `nano vim tmux htop psmisc lsof strace make tzdata`。`/usr/local/bin/code` 用 OSC 7337 请页面打开文件；`/usr/local/bin/sudo` 只说明没有 root 权限，不是真的 sudo。
- MySQL 每次建立禁用 TCP 的独立实例，仅开放容器内 Unix socket；learner 账户只有 practice 数据库权限，禁止 FILE、SUPER、LOCAL INFILE 和服务端文件导出。mysql 客户端使用 binary-mode，禁用非交互输入中的 shell 客户端命令。表/行通过私有 SQL 快照跨次恢复。
- 工作区采用“执行 → 有界快照 → 原子提交 metadata”的顺序。执行被终止、快照超限或保存失败时保留上个已保存版本，并返回 workspaceCommitted:false。SQL/命令产生了输出不代表其变化已持久化；以此字段及 workspaceRevision 为准。
- 客户端断开会触发取消并杀死本次容器，后端在下一执行/快照阶段停止，取消后不再启动新测试；若断开发生在提交完成之后，提交仍可能已生效。前端通过 `GET /api/workspaces` 恢复当前列表；已知工作区在取消或网络异常后再读取 revision、busy 与 broken。空闲且完好即可继续使用，无需强制重置；忙碌时等待，损坏时要求重置。不会自动重跑有副作用的命令。
- 服务正常停止时先让所有终端保存并告知页面（reason `shutdown`），再删除其余容器。服务重启仅清理同时带 nanaly.runner 与本私有目录哈希 nanaly.owner 标签的遗留容器和临时输入，不会清理其他后端实例。持久文件有校验和、前一版备份与单实例锁；主文件损坏时恢复合法备份并在 health 中标记 recovered。两份均损坏时拒绝覆盖，需管理员从备份恢复。
- 常规状态和元数据备份保留前一版；删除重要私有内容后，如果要求物理清除所有旧副本，应同时遵循托管商快照/备份保留策略。清空运行历史会同步清空本地历史备份文件。

## 验收命令

```sh
node --test tools/tests/server/*.test.mjs
NANALY_DOCKER_TESTS=1 node --test tools/tests/server/docker*.integration.test.mjs
```

第一条在没有 Docker 时仍验证 Node 层，真实容器项明确跳过；第二条要求容器就绪，缺依赖会失败。rootless 主机必须以 `nanaly` 身份、携带实际 `DOCKER_HOST` 运行第二条，例如：

```sh
cd /opt/blog
nanaly_uid="$(id -u nanaly)"
sudo runuser -u nanaly -- env DOCKER_HOST="unix:///run/user/${nanaly_uid}/docker.sock" NANALY_DOCKER_TESTS=1 /usr/local/bin/node --test tools/tests/server/docker*.integration.test.mjs
```

测试使用独立临时存储，不应替换生产 `NANALY_DATA_DIR`；测试过程会占用真实 CPU 和内存，应在无人练习时进行。升级部署后，通过实际 HTTPS 域名复查健康、鉴权、Origin、真实代码执行和取消；前端发布后再验收浏览器跨设备 state 冲突和工作区恢复。

实现依据：[Docker 运行时限制](https://docs.docker.com/engine/containers/run/)、[tmpfs 说明](https://docs.docker.com/engine/storage/tmpfs/)、[rootless cgroup 前提](https://docs.docker.com/engine/security/rootless/tips/)、[MySQL 客户端 binary-mode](https://dev.mysql.com/doc/refman/8.0/en/mysql-command-options.html)。
