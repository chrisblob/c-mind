# C-Mind 心图 🧠

> 本地优先的 macOS 桌面脑图工具 —— 把思维导图当「文件」来管理，把知识用「链接」串起来。

![C-Mind icon](build/icon-512.png)

![编辑器界面](build/screenshot-editor.png)

![Git 面板](build/screenshot-git.png)

## 一、名字与语义

**C-Mind**（中文名 **心图**）

- **C = Connect（连接）**：节点可嵌入网页链接、图片，更可以把一张脑图链接到另一张脑图，思维在图谱之间自由跳转；
- **C = Chain（思维链）**：脑图以 `.cmind` 纯文本文件存储在工作区文件夹中，文件夹即脑图库，可整体绑定 Git / GitHub，形成可版本化的知识链；
- **C = Create（创造）**：Xmind 一致的快捷键与极简界面，让记录想法快到不打断思路；
- 中文「心图」：Mind Map 的 Mind 既指头脑也指内心，用心绘制的图谱，即为心图。

## 二、图标设计思路

图标为 **macOS 规范圆角方形 + 靛蓝→青色对角渐变**（深→浅，象征思维从混沌到清晰），前景是白色图形：

- **中心节点**：你正在思考的核心命题；
- **C 形弧线**：右侧留出开口 —— 它既是字母 **C**，也是导图分支的生长轨迹，开口代表思维永远向新方向开放；
- **三个分支节点 + 连接线**：放射式的思维导图结构，也是「连接」语义的具象化。

生成方式可复现：`python3 scripts/gen-icon.py && bash scripts/make-icns.sh`。

## 三、功能

| 功能 | 说明 |
| --- | --- |
| 多层级脑图 | 基于 simple-mind-map，7 种布局（逻辑图 / 思维导图 / 组织结构 / 鱼骨 / 时间轴…） |
| Xmind 快捷键 | `Tab` 子节点、`Enter` 同级、`⇧Tab` 上级、`⌘Z` 撤销…（应用内点 `⌘?` 查看全部） |
| 节点嵌网页链接 | 节点工具栏 🔗 → 网页链接，点击后在系统浏览器打开 |
| 节点嵌图片 | 本地图片以 base64 内嵌（随文件走），或填网络图片地址；自动按原始比例缩放到 200×100 内展示 |
| 导入 | XMind（.xmind 新/旧版）、FreeMind/Freeplane（.mm）、OPML 大纲（幕布/Workflowy 等）、Markdown 大纲（.md）、JSON/.cmind；空图整体导入，非空图追加为子树 |
| 导出 | XMind（.xmind）、FreeMind（.mm）、OPML、Markdown（.md）、JSON、PNG、SVG —— 均可被对应平台导入 |
| 脑图之间跳转 | 🔗 → 脑图链接，选择工作区里任意一张 `.cmind`；点击后**在新标签页打开** |
| 两种管理方式 | **标签页（查看模式）**：多开、跳转、只读查看模式；**文件树（管理模式）**：文件夹 + 文件、新建 / 重命名 / 移动（可拖拽）/ 删除（进废纸篓） |
| Git / GitHub 绑定 | 工作区一键 `git init` + 绑定远程仓库（HTTPS + PAT），提交 / 推送 / 拉取 / 历史 一面板搞定 |
| 自动保存 | 编辑后自动落盘，`⌘S` 随时手动保存 |
| 导出 | PNG / SVG / XMind / JSON |
| 主题 | 经典蓝 / 青竹绿 / 暖阳橙 / 暗夜紫 四套预设配色 |

## 四、快捷键（与 Xmind 一致）

| 按键 | 功能 | 按键 | 功能 |
| --- | --- | --- | --- |
| `Tab` | 添加子节点 | `⌘Z` / `⌘Y` | 撤销 / 重做 |
| `Enter` | 添加同级节点 | `⌘C` / `⌘X` / `⌘V` | 复制 / 剪切 / 粘贴节点 |
| `⇧Tab` | 添加上级节点 | `⌘↑` / `⌘↓` | 节点上移 / 下移 |
| `⌫` / `Del` | 删除节点 | `⌘A` | 全选节点 |
| 直接输入文字 | 编辑节点文本 | `/` | 展开 / 收起 |
| 触控板 / 滚轮 | 缩放画布 | `⌘G` | 添加概要 |
| `⌘S` | 保存 | `⌘N` / `⌘W` | 新建脑图 / 关闭标签 |

> 提示：左侧「＋ 脑图 / ＋ 文件夹」在**当前操作文件夹**下创建（点击文件夹切换）；文件名与脑图根节点名称自动同步。

## 五、文件格式

`.cmind` 是纯 JSON（包含布局 / 主题 / 视图 / 节点树），对 diff 与版本控制友好，任何编辑器都能打开：

```json
{
  "format": "c-mind",
  "version": 1,
  "layout": "logicalStructure",
  "theme": { "template": "default", "config": {} },
  "view": null,
  "root": { "data": { "text": "中心主题" }, "children": [] }
}
```

## 六、Git / GitHub 绑定

1. 侧栏点 **Git** → 填仓库地址（`https://github.com/you/repo.git`）、用户名、**Fine-grained PAT**（需 repo 读写权限）；
2. Token 只保存在本机配置（未打包时在 `.userdata/config.json`，打包后在 `~/Library/Application Support/C-Mind/`），推送时拼接进 URL，不写入 `.git/config`；
3. 「绑定 / 更新」会自动 `git init`（如尚未是仓库）并校验凭据；之后即可在面板中 **提交 → 推送 → 拉取**，查看最近 20 条历史。

## 七、本地开发与打包

```bash
pnpm install          # 安装依赖
pnpm dev              # 开发模式（Vite 热更新 + Electron）
pnpm build            # 仅构建渲染层
pnpm dist             # 构建并打包 macOS arm64 的 .app 与 .dmg（输出到 release/）
pnpm icon             # 重新生成应用图标（需要 python3 + Pillow）
```

打包产物：`release/C-Mind-0.1.0-arm64.dmg`（拖入 Applications 即安装）。

> **首次打开提示**：安装包未做苹果公证（无开发者证书），第一次打开若提示「无法验证开发者」，
> 请在应用图标上**右键 → 打开**，或在「系统设置 → 隐私与安全性」中点「仍要打开」。

`examples/demo-workspace/` 内置了一套示例脑图库（产品路线图 / 团队知识库 / 学习笔记，
含脑图互链与网页链示例），开发模式（`pnpm dev`）默认指向它，可直接体验脑图跳转。

## 八、技术栈

- **Electron** — 桌面壳，主进程通过受控 IPC（contextIsolation）暴露文件与 Git 能力
- **Vue 3 + Vite** — 渲染层
- [simple-mind-map](https://github.com/wanglin2/mind-map)（思绪思维导图内核）— 脑图渲染 / 编辑 / 布局 / 导出
- **simple-git** — 工作区 Git 操作
- electron-builder — 打包分发

## 九、路线图

- [ ] 富文本节点（simple-mind-map RichText 插件）
- [ ] 大纲视图、全局搜索（Search 插件）、关联线（AssociativeLine）
- [ ] 节点 Drill 下钻演示模式
- [ ] 多工作区切换、iCloud 目录支持
- [ ] 自动定时 commit（知识库时间机器）

---

License: MIT
