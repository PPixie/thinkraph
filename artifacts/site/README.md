# 产品介绍页验收

验收日期：2026-10-07。

修改范围为 `site/` 和 `vite.pages.config.js`。保留 GitHub Pages 的 `/thinkraph/` 路径、`#explore` / `#start` 入口以及原有本机工作台。视觉参考 ThoughtDAG 的留白、清晰层级与交互叙事，沿用 Thinkraph 绿色品牌。页面不引用视频、视频宣传封面或第三方吸睛图片；分享卡片来自新版页面截图，功能图来自真实工作台截图。

## 交互与布局

- 首页示例复用 `shared/templates.js` 的内容和 `shared/domain/graph.js` 的前置知识遍历，验证节点选择、前置路径高亮、各节点独立的示例笔记、笔记空态、固定题目自测、解析及重置。
- 验证四个功能标签的截图与文案切换，以及方向键切换、首尾跳转的实现。
- 验证主题切换、主题偏好、复制安装命令、可展开的问题说明。
- 手机展示提示词工程、Embedding 和 RAG 三个节点，桌面展示五个节点。检查 320px、390px、768px、1024px、1440px 的布局，修正最窄屏的终端区溢出。
- 构建资源和图片通过 `/thinkraph/` 子路径加载；浏览器未报告运行错误。
- 首页示例状态只留在页面内存，不调用模型，也不写入学习空间，页面对此作出说明。

## 构建与性能

`npm run build:pages -- --base /thinkraph/` 和 `npm run typecheck` 通过。

对本机生产构建运行 Lighthouse 13.4.1，使用默认手机模拟：性能 96，可访问性 100，最佳实践 100，SEO 100；LCP 约 2.5 秒，CLS 0，TBT 0 毫秒。这是本机实验室测量，非线上真实用户数据。

截图：`desktop-light.png`、`desktop-dark.png`、`mobile-light.png`、`mobile-dark.png`、`features-light.png`、`features-mobile.png`。
