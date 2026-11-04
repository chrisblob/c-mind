#!/bin/bash
# 打包后对 .app 做 ad-hoc 签名。
# electron-builder 以 identity:null 跳过签名时，arm64 产物缺少 bundle 级签名
# （无 _CodeSignature/CodeResources），下载后会被 Gatekeeper 判定"已损坏"。
set -e
APP="${1:-release/mac-arm64/C-Mind.app}"
echo "re-signing (ad-hoc): $APP"
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP"
echo "signature OK: $APP"
