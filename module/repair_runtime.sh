#!/system/bin/sh
# Android ROMs do not consistently include awk. Use the installed manager's
# BusyBox applets explicitly, without depending on its shell standalone mode.
AS_BB=''
for _as_bb in /data/adb/ksu/bin/busybox /data/adb/magisk/busybox /data/adb/ap/bin/busybox \
              /debug_ramdisk/.magisk/busybox /data/adb/modules/busybox-ndk/system/*/busybox; do
    if [ -x "$_as_bb" ]; then AS_BB=$_as_bb; break; fi
done
if [ -n "$AS_BB" ]; then
    awk() { "$AS_BB" awk "$@"; }
    base64() { "$AS_BB" base64 "$@"; }
    od() { "$AS_BB" od "$@"; }
    mktemp() { "$AS_BB" mktemp "$@"; }
fi
unset _as_bb

# The bundled helper uses flock(2), so a crashed writer releases its lock
# without PID reuse, stale-directory deletion or a BusyBox flock dependency.
if [ -z "${AS_NATIVE_TOOL:-}" ]; then
    case "$(uname -m)" in
        aarch64) _as_abi=arm64-v8a ;;
        armv7*|armv8l) _as_abi=armeabi-v7a ;;
        *) _as_abi=unsupported ;;
    esac
    AS_NATIVE_TOOL="${AS_RUNTIME_DIR:-${MODPATH:-${V_DIR:-${0%/*}}}}/bin/$_as_abi/asfetch"
    unset _as_abi
fi
as_lock_run() {
    [ -x "$AS_NATIVE_TOOL" ] || { echo 'repair: native lock helper unavailable; write refused' >&2; return 1; }
    AS_CFG_ROOT="${AS_CFG_ROOT:-/data/adb/tricky_store}" "$AS_NATIVE_TOOL" lock-run "$@"
}
as_bounded() {
    [ -x "$AS_NATIVE_TOOL" ] || { echo 'repair: deadline helper unavailable; startup skipped' >&2; return 1; }
    AS_CFG_ROOT="${AS_CFG_ROOT:-/data/adb/tricky_store}" "$AS_NATIVE_TOOL" run-bounded "$@"
}

# Scratch-root checks must not notify the live engine or restart Google apps.
as_live_config() { [ "${AS_CFG_ROOT:-/data/adb/tricky_store}" = /data/adb/tricky_store ]; }

# Some Android base64 applets ignore stray characters. Check the complete
# encoded envelope before decoding, instead of relying on applet exit status.
as_base64_check() {
    awk '{ gsub(/[[:space:]]/, ""); b=b $0; if(length(b)>1048576) exit 1 }
      END { if(length(b)<16 || length(b)%4 || b ~ /[^A-Za-z0-9+\/=]/) exit 1;
        sub(/==?$/, "", b); if(index(b,"=")) exit 1 }' "$1"
}
