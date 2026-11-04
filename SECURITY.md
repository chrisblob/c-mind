# 安全策略

## 报告漏洞

请勿公开提交安全问题。请发邮件至仓库维护者（见 GitHub 主页），或在 GitHub 私密安全公告中提交，我们会在 7 天内回复。

## 安全设计说明

- 渲染层运行于 `contextIsolation`，全部系统能力经 `electron/preload.cjs` 白名单 IPC 暴露
- 所有文件操作都被限制在工作区目录内（`safePath` 校验）
- Git 凭据（用户名 / PAT）仅保存在本机配置：开发态 `.userdata/config.json`，安装后 `~/Library/Application Support/C-Mind/`；不写入 `.git/config`，也不会随仓库分发
- 脑图文件（`.cmind`）为纯文本 JSON，不含可执行内容
