# 互动书房首页

首页把书架、复习本、练习台、日程、成长回放、唱片机和聊天入口放到同一张书房插画上。入口都是链接或按钮，支持键盘聚焦；移动端可切换简洁视图，保留所有入口和文字说明。

- 图片：`source/img/study-room.webp`，1536 × 1024，约 307 KiB；浏览器不加载原始大 PNG。
- 交互：`source/js/study-room.js`；样式：`source/css/study-room.css`。
- 简洁／专注偏好存在 `noimpty-room-preferences-v1`，不包含学习记录。
- 专注模式复用 `mao-pet.js` 的暂停逻辑，停止角色主动互动和动画。音乐仍由用户控制。其他页面也有“退出专注”按钮。
- 首页只在门禁解锁后读取学习历史的汇总数量。锁定、跨页、过期请求不会把旧的异步进度写回页面。
- 时间牌收进“此刻 · 小站的时间”；多个标签页改变偏好不会销毁时钟节点。
- `/experiments/`、`/teach/`、`/growth/` 都由现有全站门禁覆盖。个人案例和解释存在浏览器 IndexedDB，不进入静态构建或公开仓库。

## 插画来源

2026-10-02 使用本会话的 ImageGen 工具生成，无外部素材输入。后续只将 PNG 编码为 WebP，没有改绘。

生成提示词（归档）：

> Use case: stylized-concept. Create a full-width interactive personal study room illustration, 1536x1024 landscape, with no UI. Exquisitely art-directed cozy Japanese-inspired editorial handpainted anime environment, fine architectural lines and gouache, not plastic or childish. Palette: ivory, honey oak, dusty rose, mauve, sage. Afternoon spring light. Wide three-quarter view. Left bookshelf; upper-center arched window with cherry branches and distant sky; desk center-right with open notebook near x52 y67, laptop near x72 y55, rose task lamp; calendar on the right near x88 y30; record player near x20 y77; three framed photos; lavender cushion side stool near x87 y79; water, plant and pencils, modest lived-in detail. No people or pets: a separate animated character will be overlaid by the site. No legible text, logos, watermark or interface. Avoid clutter, neon, sparkles and excessive pink.

实际热点坐标以生成图片中的物件位置校正。后续编辑应检查亮色、暗色、手机宽度、键盘聚焦、简洁视图以及跨页退出专注。
