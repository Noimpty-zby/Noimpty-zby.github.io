# 2026-09-25 私有后端生产部署

## 当前状态

私有后端 `https://api.noimpty-zby.cn` 已部署并通过公网 HTTPS 与真实代码执行验收。前端提交 `8232297` 已在旧 GitHub Pages 网址成功发布，公开备份页及学习台可访问，线上脚本与发布版本一致。用户随后确认没有需要迁移的本机数据，明确跳过备份。正式域名配置提交 `da9afcc` 的 GitHub Pages 发布已成功，Custom domain 已绑定 `noimpty-zby.cn`；主域名四条 A、www CNAME 与 api A 均已查验。升级 DNSPod 专业版后，注册局 NS 已同步为 `ns3.dnsv2.com`、`ns4.dnsv2.com`。用户确认 GitHub DNS 检查通过并开启 Enforce HTTPS；主站及 www 的有效 HTTPS、正式发布资源和新域名组件到真实 API 的连接已通过验收。

## 资源与运行方式

- 腾讯云新加坡轻量应用服务器，Ubuntu 24.04 LTS、amd64，2 核 8 GB、80 GB SSD；公网 IPv4 为 `43.156.15.56`。
- 域名为 `noimpty-zby.cn`，`api` A 记录已指向该服务器，公网 TCP 443 已放行，Caddy 已取得有效 Let's Encrypt 证书。
- Node.js 24.19.0 安装于 `/opt/node-v24.19.0-linux-x64`，通过 `/usr/local/bin/node` 运行；安装包已核对官方 SHA-256 清单。
- API 由宿主 `nanaly.service` 运行，代码位于 `/opt/blog` 并由 root 持有，API 只监听 `127.0.0.1:4318`；Caddy 承担公网 HTTPS 入口。
- 专用账户 `nanaly`，主目录 `/var/lib/nanaly`；使用官方 Docker CE rootless daemon，rootful Docker service/socket 已停用。主机采用 cgroup v2 与 systemd driver，向该账户委派 cpu/cpuset/io/memory/pids，启用用户 lingering。保留 Ubuntu AppArmor，不通过全局关闭限制实现 rootless。
- rootless socket 位于 `/run/user/<nanaly实际UID>/docker.sock`。系统服务依赖实际 `user@UID.service`，`ExecStartPre` 使用同一 `DOCKER_HOST` 执行 `docker info`；UID 由目标主机读取，仓库示例使用占位符并提供替换步骤。
- `/srv/nanaly-private` 属于 `nanaly:nanaly`，权限 0700；持久文件 0600。令牌文件 `/etc/nanaly/token` 属于专用账户，权限 0400；环境配置 `/etc/nanaly.env` 为 root 所有、权限 0600。令牌不在仓库、部署包和公开页面中。
- 当前精确 Origin 允许名单为 `https://noimpty-zby.github.io`、`https://noimpty-zby.cn`、`https://www.noimpty-zby.cn`。该精确允许名单在主站迁移后保持有效，未放开任意来源。

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
- Edge 独立测试浏览器完成虚构数据加密下载、重新选择文件校验、错误密码不写入、跨 Origin 恢复（本机记录、保险箱密文及两套附件库逐值相等）、已有数据拒绝覆盖；390 像素布局无横向溢出，无页面 JavaScript 错误或外部 HTTP 请求。测试使用虚构记录，未读取用户真实浏览器数据；用户后来确认本次不需要迁移。
- 云端集成测试结束后的空闲观测：used 约 764 MiB、available 约 6921 MiB，swap 为 0。这不是测试峰值采样，不能据此承诺并发容量；生产仍同时执行 1 份 OJ 提交。

## 仍待完成的发布与运维工作

- 用户明确确认不需要本机数据迁移，已取消“先备份再切域名”的本次前置条件。备份功能保留，操作说明见 [本机加密备份](../features/nanaly-local-backup.md)。不删除或清空旧浏览器数据。
- 前端上线后验收浏览器跨设备接续、状态冲突、工作区恢复与用户可见取消效果。公网 API 取消链路已验收，但不能替代新版页面的用户操作验收。
- 真实付费模型调用和生成练习的回答质量尚未实测，不能把替身测试或真实编译成功描述为真实模型体验验收。
- 另行配置受保护的异机备份与恢复演练；当前数据落在主机持久磁盘，应用前一版备份只能处理部分写入/文件损坏问题，不能替代整机故障恢复。

参数化部署步骤、服务模板与资源边界见 [后端说明](../features/learning-backend.md)。

## 正式域名切换验证

- 博客 URL、后台任务/日报地址、文章检查目标与链接检查来源已统一为 `https://noimpty-zby.cn`，保留旧 Pages 历史结果的严格来源白名单。
- 15 组后台回归与 13 项任务回归通过，构建、17,719 条站内链接及公开页面泄漏检查通过。提交 `da9afcc` 的 Pages 工作流已成功，以下公网验证在 DNS 与证书就绪后执行。
- Pages 使用 GitHub Actions，Custom domain 已保存为 `noimpty-zby.cn`。DNSPod 已配置四条 GitHub Pages apex A 记录及 `www` CNAME，既有 `api` 记录保持有效；证书就绪后用户已开启 Enforce HTTPS。


## DNS 切换与首次连接记录

- 腾讯云中国站免费 DNS 套餐对相同主机、记录类型、线路的记录数上限为 2 条，专业版为 10 条；四条 `@ / A / 默认` 会超过免费版限制。此次用户升级专业版后出现 DNS 服务器不匹配提示，已按专业版指定 NS 同步域名注册设置。套餐限制需在提供四条 A 的操作步骤前明确核对，不能将此提示归因于用户误操作。
- `.cn` 注册局实测已委派到 `ns3.dnsv2.com` 与 `ns4.dnsv2.com`。A 记录为 `185.199.108.153`、`185.199.109.153`、`185.199.110.153`、`185.199.111.153`，www CNAME 指向 `noimpty-zby.github.io`，api A 保持 `43.156.15.56`；未发现阻碍签发的 apex CAA 记录。
- DNS 切换后再次确认公网 API 有效 HTTPS、健康检查 HTTP 200、Runner ready，以及六种语言能力。首次检查时主站证书仍待签发，随后已签发并完成下方验证；全程未跳过证书验证。
- HTTPS 就绪后，用户在 `/learn/` 输入原有站点暗号，点击“连接 / 管理个人后端”；默认后端地址为 `https://api.noimpty-zby.cn`，使用独立后端访问令牌“连接并读取”。该令牌不是 SSH 密码或站点暗号，只保留当前页面内存，连接后输入框清空；刷新页面后需要重新连接。此处为源码核对的操作步骤，不代替新域名正式页面的用户验收。

参考：[DNSPod 记录数限制](https://cloud.tencent.com/document/product/302/9069)、[专业版 DNS 服务器](https://cloud.tencent.com/document/product/302/79833)、[GitHub Pages HTTPS](https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https)。


## 新域名公网验收结果

- `https://noimpty-zby.cn/` 使用正常证书验证返回 HTTP 200；`https://www.noimpty-zby.cn/` 返回 301 到 HTTPS 主域名。
- HTTP 主域名与 HTTP/HTTPS www 的 `/learn/?from=domain-check` 均返回 301 到 `https://noimpty-zby.cn/learn/?from=domain-check`，路径和查询参数保留。旧 GitHub Pages 相同学习路径直接 301 到新 HTTPS 地址；旧站首页当时仍命中此前指向 HTTP 的缓存，后续由主站强制 HTTPS 跳转，不将其描述为首页已全部单跳更新。
- 正式 HTTPS 备份页及四个带版本标识的脚本均返回 200；除构建生成的 manifest 外，脚本 SHA-256 与仓库源文件一致。正式学习页包含 Runner、工作室入口和版本化脚本。
- Edge 全新临时浏览器访问正式 `/learn/`，页面 200、暗号门禁可见且处于锁定状态，无页面 JavaScript 错误。未输入或获取用户站点暗号，不宣称已验证真实暗号解密后的完整页面。
- 另一独立临时上下文以新域名为 Origin，仅替换专用验收页面的 HTML 为合成门禁外壳，JS/CSS 从正式 HTTPS 发布版本加载：连接真实 API 成功且访问令牌输入清空；三个 C 测试用例全部通过；修改代码后旧结果失效；真实编译错误可点击定位到对应行；断开成功；localStorage/sessionStorage 没有保存访问令牌；无页面 JavaScript 错误、无意外状态写入。所有运行均设置 `saveHistory:false`，未调用付费模型。

发布记录：[正式域名配置工作流](https://github.com/Noimpty-zby/Noimpty-zby.github.io/actions/runs/36124017785)。
