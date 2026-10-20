#!/usr/bin/env bash
# Rust Android targets + NDK r25+, no cargo-ndk dependency. macOS/Linux.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
: "${ANDROID_NDK_HOME:?Set ANDROID_NDK_HOME}"
case "$(uname -s)" in Darwin) host=darwin-x86_64 ;; Linux) host=linux-x86_64 ;; *) exit 1 ;; esac
TOOL="$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/$host/bin"
export RUSTFLAGS="${RUSTFLAGS:-} --remap-path-prefix=$ROOT=/src --remap-path-prefix=${CARGO_HOME:-$HOME/.cargo}=/cargo --remap-path-prefix=$HOME=/build"
for spec in 'aarch64-linux-android:arm64-v8a:aarch64-linux-android' 'armv7-linux-androideabi:armeabi-v7a:armv7a-linux-androideabi'; do
  IFS=: read -r target abi clang_target <<< "$spec"
  env_target=${target//-/_}
  upper=$(printf %s "$env_target" | tr '[:lower:]' '[:upper:]')
  env "CARGO_TARGET_${upper}_LINKER=$TOOL/${clang_target}29-clang" \
      "CC_$env_target=$TOOL/${clang_target}29-clang" "AR_$env_target=$TOOL/llvm-ar" \
      cargo build --locked --release --target "$target" --manifest-path "$ROOT/native/asfetch/Cargo.toml"
  cp "$ROOT/native/asfetch/target/$target/release/asfetch" "$ROOT/native/asfetch/prebuilt/$abi/asfetch"
done
