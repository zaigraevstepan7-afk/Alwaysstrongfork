#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${ANDROID_NDK_HOME:?Set ANDROID_NDK_HOME}"
root="$PWD"
stage="$root/build/isolation-stage"
rm -rf "$stage"
mkdir -p "$stage/zygisk" "$root/out"
cp -R isolation-module/. "$stage/"
version=$(sed -n 's/^version=//p' module/module.prop)
code=$(sed -n 's/^versionCode=//p' module/module.prop)
sed -i "s/^version=.*/version=$version/;s/^versionCode=.*/versionCode=$code/" "$stage/module.prop"
compiler="$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/bin/clang++"
for spec in 'aarch64-linux-android:arm64-v8a' 'armv7a-linux-androideabi:armeabi-v7a'; do
    target=${spec%%:*}; abi=${spec#*:}
    "$compiler" --target="${target}29" -std=c++17 -O2 -fPIC -fvisibility=hidden \
        -fno-exceptions -fno-rtti -fno-threadsafe-statics -nostdlib++ -shared \
        -Wl,--no-undefined,-z,relro,-z,now,-z,max-page-size=16384 \
        native/isolation/module.cpp -lstdc++ -o "$stage/zygisk/$abi.so"
    nm_tool="$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-nm"
    "$nm_tool" -D "$stage/zygisk/$abi.so" > "$root/build/isolation-symbols-$abi.txt"
    grep -qE ' T zygisk_module_entry$' "$root/build/isolation-symbols-$abi.txt"
    grep -qE ' T zygisk_companion_entry$' "$root/build/isolation-symbols-$abi.txt"
done
cp LICENSE "$stage/LICENSE"
archive="$root/out/AlwaysStrong-Isolation-${version}.zip"
rm -f "$archive"
(cd "$stage" && zip -qr9 "$archive" .)
python3 scripts/verify-isolation-zip.py "$archive"
