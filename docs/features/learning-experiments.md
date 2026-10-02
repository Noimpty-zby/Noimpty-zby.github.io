# 文章实验室

入口 `/experiments/`。三个实验也分别嵌入数组 ADT、Git 分支和 GAMES101 光栅化文章；不需要外部 CDN 或图形库。

## 写作接入

在 Markdown 中插入一个独立标签，参数只接受以下三项：

```text
{% learning_experiment array %}
{% learning_experiment git %}
{% learning_experiment barycentric %}
```

`scripts/noimpty-experiments.js` 输出语义化容器与无脚本提示，`source/js/learning-experiments.js` 在 DOM ready 和 PJAX 完成后幂等挂载。样式来自 `source/css/learning-experiments.css`。这两项资源由主题配置统一注入。页面随现有全站软锁保护，没有新增公开数据接口。

## 模型边界

- 数组：容量固定为 8，整数范围 -999 到 999；插入按从右到左复制，删除按从左到右复制。length 之外的旧值会保留，便于区分物理存储与逻辑元素。移动计数不包括写入新值和更新长度。修改参数后点击「应用参数」，支持空数组、头尾操作和容量错误。
- Git：初始 main → C0，只模拟干净工作区中的创建分支、切换、空提交和分离 HEAD。没有实现合并、暂存区或冲突。编号 C0/C1 是教学标识，真实代码通过提交消息与 shell 变量映射到真实哈希。提交上限 14、分支上限 5，图可滚动，文本列表提供同一父子关系。回看后再操作会从选中状态继续。
- 重心坐标：固定三角形 A=(0.1,0.15)、B=(0.9,0.15)、C=(0.5,0.9)，移动连续采样点 P。权重使用有向面积公式，容许浮点误差；三条权重非负代表覆盖。展示 RGB 通道的屏幕空间线性插值，不模拟透视校正、纹理采样或显示器色彩管理。

## 操作与练习台

全部按钮可用键盘和触屏；三角形支持拖动、方向键、Shift 加速以及原生坐标滑块。实验无自动播放，提供重置；跟随站点暗色模式并响应 reduced-motion。数组在窄容器中显示为四列，兼顾手机和文章/编辑器并排布局；每个槽位都有完整读屏描述。

「把当前实验代码放进练习台」调用 `window.LEARNING_LAB.openSnippet({ language, code, title, sourceUrl })`。数组和重心坐标生成完整 Python 代码，Git 生成独立临时仓库中的真实 Git 命令。桥接只载入，不自动运行；覆盖草稿的确认和恢复点由练习台负责。桥未就绪或载入失败时，用户仍可展开完整代码并手工复制。

状态只存在当前页面内存中。失败或取消的 PJAX 导航保留操作进度；成功换页后旧 DOM 可以释放。没有轮询、后台计时器、网络请求或浏览器全局拖动监听器。

## 验证

运行 `node tools/tests/site/learning-experiments.test.mjs`。测试对数组全部合法插入/删除下标执行生成的 Python，核对模型结果；在隔离目录运行生成的 Git 脚本核对引用；对重心坐标的内部、边界、外部点核对 Python 与模型一致性。测试需要 `python3` 和 `git`，均为现有 Linux 开发/CI 环境工具。

运行 `node tools/tests/site/learning-experiments-ui.test.mjs` 检查按钮、参数错误、历史回看、方向键、指针捕获、PJAX 取消/替换和代码载入取消。这是行为测试，不替代实际浏览器的暗色与窄屏视觉检查。
