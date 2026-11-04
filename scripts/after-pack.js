/* electron-builder afterPack 钩子：打包出 .app 后、压 dmg 前，补 ad-hoc 签名。
   identity:null 跳过签名时 arm64 产物缺 _CodeSignature，下载运行会被 Gatekeeper 判定"已损坏"。 */
const { execSync } = require('child_process')
const path = require('path')

exports.default = async function (context) {
  if (context.electronPlatformName !== 'darwin') return // 仅 macOS 包需要 ad-hoc 签名
  const app = path.join(context.appOutDir, context.packager.appInfo.productFilename + '.app')
  console.log('afterPack: ad-hoc signing', app)
  execSync(`codesign --force --deep --sign - "${app}"`, { stdio: 'inherit' })
  execSync(`codesign --verify --deep --strict "${app}"`, { stdio: 'inherit' })
  console.log('afterPack: signature OK')
}
