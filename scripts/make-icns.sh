#!/bin/bash
# 从 build/icon.png 生成 macOS .icns（使用系统自带 sips + iconutil）
set -e
cd "$(dirname "$0")/.."
mkdir -p build/icon.iconset
SRC=build/icon.png
for spec in "16 icon_16x16" "32 icon_16x16@2x" "32 icon_32x32" "64 icon_32x32@2x" \
            "128 icon_128x128" "256 icon_128x128@2x" "256 icon_256x256" \
            "512 icon_256x256@2x" "512 icon_512x512" "1024 icon_512x512@2x"; do
  size=${spec%% *}
  name=${spec#* }
  sips -z $size $size "$SRC" --out "build/icon.iconset/$name.png" >/dev/null
done
iconutil -c icns build/icon.iconset -o build/icon.icns
rm -rf build/icon.iconset
echo "OK -> build/icon.icns"
