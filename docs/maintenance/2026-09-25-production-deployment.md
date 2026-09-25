# 2026-09-25 私有后端生产部署

## 当前状态

私有后端已部署到腾讯云新加坡服务器，API 地址为 `https://api.noimpty-zby.cn`，公网 HTTPS 与真实代码执行已验收。本轮前端发布地址仍为 `https://noimpty-zby.github.io`，包含学习台、工作室、Mao 互动与独立加密备份页；博客主域名待用户实际备份后迁移。公开发布是否完成以对应提交的 GitHub Pages 工作流为准。

## 资源与运行方式

- 腾讯云新加坡轻量应用服务器，Ubuntu 24.04 LTS、amd64，2 核 8 GB、80 GB SSD；公网 IPv4 为 `43.156.15.56`。
- 域名为 `noimpty-zby.cn`，`api` A 记录已指向该服务器，公网 TCP 443 已放行，Caddy 已取得有效 Let's Encrypt 证书。
- Node.js 24.19.0 安装于 `/opt/node-v24.19.0-linux-x64`，通过 `/usr/local/bin/node` 运行；安装包已核对官方 SHA-256 清单。
- API 由宿主 `nanaly.service` 运行，代码位于 `/opt/blog` 并由 root 持有，API 只监听 `127.0.0.1:4318`；Caddy 承担公网 HTTPS 入口。
- 专用账户 `nanaly`，主目录 `/var/lib/nanaly`；使用官方 Docker CE rootless daemon，rootful Docker service/socket 已停用。主机采用 cgroup v2 与 systemd driver，向该账户委派 cpu/cpuset/io/memory/pids，启用用户 lingering。保留 Ubuntu AppArmor，不通过全局关闭限制实现 rootless。
- rootless socket 位于 `/run/user/<nanaly实际UID>/docker.sock`。系统服务依赖实际 `user@UID.service`，`ExecStartPre` 使用同一 `DOCKER_HOST` 执行 `docker info`；UID 由目标主机读取，仓库示例使用占位符并提供替换步骤。
- `/srv/nanaly-private` 属于 `nanaly:nanaly`，权限 0700；持久文件 0600。令牌文件 `/etc/nanaly/token` 属于专用账户，权限 0400；环境配置 `/etc/nanaly.env` 为 root 所有、权限 0600。令牌不在仓库、部署包和公开页面中。
- 当前精确 Origin 允许名单为 `https://noimpty-zby.github.io`、`https://noimpty-zby.cn`、`https://www.noimpty-zby.cn`。主域名与 www 被允许，不代表对应站点迁移已完成。

部署包仅包含后端、后端验收测试与课程参考代码，没有包含博客文章、私有数据或访问令牌。本机使用独立部署 SSH 密钥，私钥留在本机 WSL 用户的 `.ssh`，不加入仓库。

## 已通过的验证

- 后端 Node 行为与独立边界测试 25 项通过，包括代理后的限流隔离：错误令牌请求不会耗尽正确认证或健康检查的额度，也不信任客户端伪造的转发 IP。
- 云端以实际 `nanaly` 账户和 rootless daemon 运行 8 项 Docker 集成测试，全部通过、没有跳过；覆盖 C/C++/Go/Git/Linux/MySQL 六种环境及前端课程参考样例。
- 真实集成验证编译诊断、超时、输出上限、每个测试用例的独立容器、非 root/无 capability/只读根文件系统/无外部网络、持久工作区恢复与执行中取消；取消后不提交新快照。
- 公网 HTTPS 已验证有效证书、健康检查、错误令牌拒绝、正确鉴权、精确 CORS 和私有状态接口；真实 C 提交的两个测试用例均通过。
- 公网 HTTPS 取消验收通过：先持久保存 `note=saved`，下一请求写入 `changed` 和取消标记；实际观测到容器已开始执行后中止客户端请求，取消经 Caddy 传播。工作区版本未变，重连后仍读到 `saved` 且不存在取消标记，没有新增完成历史，容器已清理，验收临时工作区已删除。
- `nanaly.service` 重启后，公网健康检查和 Runner 自动恢复；已确认服务 enabled 与专用用户 lingering。此次未执行整机重启，不能将服务重启结果描述为整机重启验收。
- Windows Edge 独立临时浏览器中，以旧站 `https://noimpty-zby.github.io` 为 Origin，用本地源码响应构成测试页面，连接真实公网 HTTPS API；实际预检与 CORS 通过，UI 中的访问令牌输入已清空。
- 上述浏览器测试中，C 的三个真实测试用例全部通过；编辑后旧版本的通过状态消失。引入第 2 行 `undeclared_fixture` 后获得真实编译错误，点击诊断能选中对应代码行；无页面 JavaScript 错误，未写入生产运行历史，也未调用付费模型。
- 这部分验证的是本地源码组件到云端 API 的浏览器链路，不代表新版公开页面已经发布，也不代表主域名迁移或新域名上的全部功能已验收。
- Caddy 上游 keepalive 为 4 秒，低于 Node 的 5 秒；保留默认请求取消传播。
- 加入本机备份后，76 个测试文件全部通过；构建生成 710 个文件、186 个 HTML，最终独立页面布局版本检查 17,719 个站内链接无死链，公开页面泄漏检查通过。备份核心另有 17 项认证、回滚、崩溃恢复及并发修改回归。
- Edge 独立测试浏览器完成虚构数据加密下载、重新选择文件校验、错误密码不写入、跨 Origin 恢复（本机记录、保险箱密文及两套附件库逐值相等）、已有数据拒绝覆盖；390 像素布局无横向溢出，无页面 JavaScript 错误或外部 HTTP 请求。用户真实浏览器中的数据仍需用户按页面操作导出，未读取或代替其真实备份。
- 云端集成测试结束后的空闲观测：used 约 764 MiB、available 约 6921 MiB，swap 为 0。这不是测试峰值采样，不能据此承诺并发容量；生产仍同时执行 1 份 OJ 提交。

## 仍待完成的发布与运维工作

- 先在现有 `noimpty-zby.github.io` 发布本轮前端及浏览器数据加密备份入口，再由用户在旧站点完成本机备份；切换主域名必须在该备份之后。备份功能仍待审查修复后重新进行浏览器核验，加入后须重新执行全量检查。前端发布后，从公开页面连接私有 API，验证工作室、OJ、Mao 与现有博客的完整流程。
- 完成博客主域名及 www 的迁移、重定向和相应托管 HTTPS 配置；当前现有 GitHub Pages 保留。
- 前端上线后验收浏览器跨设备接续、状态冲突、工作区恢复与用户可见取消效果。公网 API 取消链路已验收，但不能替代新版页面的用户操作验收。
- 真实付费模型调用和生成练习的回答质量尚未实测，不能把替身测试或真实编译成功描述为真实模型体验验收。
- 另行配置受保护的异机备份与恢复演练；当前数据落在主机持久磁盘，应用前一版备份只能处理部分写入/文件损坏问题，不能替代整机故障恢复。

参数化部署步骤、服务模板与资源边界见 [后端说明](../features/learning-backend.md)。
