# 私密资料迁移与安全切换

此版本保留公开代码与文章，日程、行动日志、背景资料、用量改存鉴权后端。原来的 HTML 暗号门仍是软锁，不将已公开文章变成保密正文。以下步骤必须在发布新前端前完成。

## 迁移顺序

1. 暂停旧自动任务写入，并保留当前后端目录与私密数据备份。将最终版本的四份源资料复制到仓库外、权限 0700 的目录；文件权限 0600。保留原始字节和校验清单，不把备份放入 Git 或 Actions 产物。
2. 部署通过测试的新后端，确认新增私密资料接口可用。`tools/schedule-data.cjs` 和迁移工具已加入部署包。
3. 用主令牌的受限文件路径运行迁移工具。工具默认只预检；仅 `--apply` 导入。它先检查所有记录，再写入 revision=0 的空目标；任何目标已有不同内容就停止，不覆盖。失败可重试，已迁移且相同的记录不会重复增加版本。

```sh
node tools/migrate-private-content.mjs --source /secure/private-import --validate-source
node tools/migrate-private-content.mjs --source /secure/private-import \
  --url https://api.your-blog.example --token-file /secure/owner-token
node tools/migrate-private-content.mjs --source /secure/private-import \
  --url https://api.your-blog.example --token-file /secure/owner-token --apply
```

目录须包含 `schedule.json`、`nanaly-journal.json`、`noimpty-profile.md`、`nanaly-usage.json`。工具只输出记录名和迁移状态，不输出资料内容或令牌。使用空测试后端演练时应提供合成数据。

4. 配置 Actions 的 `NANALY_AGENT_URL` 和 `NANALY_AGENT_TOKEN`。后者使用受限后台令牌，禁止使用主令牌。新版自动化先加载并校验所有记录，未迁移、未配置或读取失败时停止；日志和用量通过 CAS 追加，日程 CAS 冲突明确失败并保留远端修改。profile 原文不进入公开成稿；日志只有明确 `publicAllowed:true` 才能成为公开回复背景。
5. 轮换 `SITE_PASSPHRASE` 为未公开过的新暗号，再构建发布。仅升级 KDF 而继续使用曾公开 SHA-256 摘要的暗号，无法消除旧副本带来的猜解风险。站点暗号和娜娜莉本机保险箱密码是不同设置。
6. 发布已移除四份原文的新前端及工作流，确认静态产物不存在日程、日志、背景资料或用量文件；打开日程连接后端，核对条目、一次正常保存及多设备冲突。恢复自动任务。

## 公开历史清理

工作树删除和 `.gitignore` 只防止今后的公开提交，过去提交中的资料仍可能被读取。应在独立镜像和可恢复备份上，过滤四条敏感路径的全部历史，并核对提交树与分支后再更新远端。该操作会改变提交 ID，需要所有协作者重新同步；不得在未确认影响范围时强推当前仓库。

即使历史重写完成，已有 fork、clone、缓存或转载也无法保证收回。需要时按 GitHub 的敏感数据移除流程处理缓存和引用。对曾公开的真实凭据必须单独轮换；本次资料迁移不能证明历史中所有凭据均已排查。

## 日常使用

- 日程点击「保存日程」后直接更新后端，不再触发整站部署；没有 GitHub Contents 权限也可通过主后端令牌保存。
- 页面仍保留本地未保存草稿和三方合并；网络失败不会以空表覆盖远端。
- 断开后端或锁定站点后，新的日程/日志读取被拒绝，旧连接返回不会写回新会话。
- 终端文件读写和宿主 Docker CLI 使用有界队列，满载时提示稍后重试，正常原子保存和工作区恢复保持原有语义。
- 构建前的私密资料检查会拒绝四份旧源文件重新出现；Pages 自检也拒绝它们进入静态产物。

这份文档说明切换步骤；不能以代码存在或本地测试通过推断生产迁移已经完成。
