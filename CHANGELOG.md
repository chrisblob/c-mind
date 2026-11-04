# 更新日志（Changelog）

遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.1.0] - 2026-11-04

首个可用版本。

### 新增
- 多层级脑图编辑（基于 simple-mind-map，7 种布局、4 套主题）
- 文件式管理：工作区文件夹即脑图库，支持新建 / 重命名 / 拖拽移动 / 删除（回收站）
- 标签页多开、只读查看模式、脑图之间 `cmind://` 互链跳转
- 节点嵌入图片（base64 随文件走）与网页链接；画布内缩略图展示，点击弹窗看大图（可缩放/拖动）
- 节点内换行（Shift+Enter）
- 导入：XMind（新旧版）、FreeMind/Freeplane、OPML、Markdown、JSON/.cmind
- 导出：XMind、FreeMind、OPML、Markdown、JSON、PNG、SVG
- Git/GitHub 绑定：提交、推送、拉取、分支切换、历史查看（PAT 仅存本机）
- 自动保存、脏标记、快捷键帮助（与 Xmind 对齐）

### 修复
- 图片节点空白文本导致节点不可点击
- 图片缺少尺寸记录导致渲染成窄条
- Git 绑定冲突会把冲突标记写入 `.cmind` 损坏文件（现改为保留本地文件并提示）
- 新建脑图/文件夹按钮位置（移至文件区顶部工具条）

### 已知限制
- 仅提供 macOS arm64 安装包，未做代码签名与公证
