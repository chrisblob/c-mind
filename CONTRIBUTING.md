# 贡献指南（Contributing）

感谢你对 C-Mind 心图的关注！欢迎提交 Issue 与 Pull Request。

## 开发环境

- macOS（当前仅分发 arm64 安装包）
- Node.js >= 20（推荐 22 LTS）
- pnpm >= 9

```bash
git clone https://github.com/chrisblob/c-mind.git
cd c-mind
pnpm install
pnpm dev        # 开发模式（Vite + Electron 热更新）
```

## 目录结构

```
electron/            主进程（窗口、IPC、文件系统、Git）
  main.cjs
  preload.cjs
src/                 渲染层（Vue 3）
  App.vue
  components/        FileTree / TreeNode / MindMapEditor / GitPanel / TabBar
  store.js           全局状态（工作区文件树、标签页、右键菜单）
  formats.js         导入导出格式转换（XMind / FreeMind / OPML / Markdown / JSON）
  uitest.js          端到端自检脚本（CMIND_UITEST=1）
docs/                设计文档与评审
examples/demo-workspace/  示例脑图库
scripts/             图标生成脚本
```

## 提交规范

- 提交信息使用中文或英文均可，建议 `类型: 摘要`，类型如 `feat` / `fix` / `ui` / `docs` / `chore`
- 一个 PR 聚焦一件事；改动交互请附截图
- 涉及数据文件格式（`.cmind`）的改动必须保持向后兼容

## 自测

```bash
pnpm build                     # 渲染层构建必须通过
pnpm dist                      # 可打包出 dmg
CMIND_UITEST=1 pnpm start      # 跑内置端到端自检（日志含 [uitest] RESULT）
```

## 代码风格

- 2 空格缩进、单引号、无分号
- Vue 组件使用 `<script setup>`
- 主进程能力统一经 `preload.cjs` 白名单暴露，禁止在渲染层直接使用 Node API

## 提交 PR

1. Fork 并切出分支：`feat/xxx` 或 `fix/xxx`
2. 确保 `pnpm build` 通过、自检无回归
3. 填写 PR 模板，说明动机、改动点、验证方式（截图/录屏更好）

## 行为准则

请保持友善、就事论事；不接受人身攻击与骚扰。
