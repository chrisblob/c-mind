/**
 * C-Mind 预加载脚本：以最小 API 面暴露主进程能力
 */
const { contextBridge, ipcRenderer } = require('electron')

const ALLOWED = new Set([
  'config:get', 'config:set',
  'workspace:choose', 'workspace:set',
  'fs:tree', 'fs:read', 'fs:write', 'fs:createFile', 'fs:createRaw', 'fs:createDir',
  'fs:rename', 'fs:move', 'fs:delete', 'fs:listMaps',
  'os:openExternal', 'os:openPath', 'os:openItem',
  'import:open', 'export:save',
  'git:bind', 'git:unbind', 'git:status', 'git:commit', 'git:commitpush', 'git:push', 'git:pull', 'git:log',
  'git:branches', 'git:checkout', 'git:createBranch', 'git:deleteBranch'
])

contextBridge.exposeInMainWorld('cmind', {
  invoke: (channel, ...args) => {
    if (!ALLOWED.has(channel)) return Promise.reject(new Error('不允许的通道: ' + channel))
    return ipcRenderer.invoke(channel, ...args)
  },
  // 主进程推送的链接打开事件（cmind:// 内部跳转）
  onOpenLink: (cb) => {
    ipcRenderer.on('open-link', (_e, url) => cb(url))
  }
})
