#!/system/bin/sh
# Re-apply the engine's STRONG spoof flags to every pif file it reads, then
# restart the Play Integrity consumers so the change takes effect immediately.
# Called from the WebUI right after the spoofProps toggle is flipped so the user
# doesn't have to press Action or wait for the hourly refresh.

case "$0" in
    */*) MODPATH=$(cd "${0%/*}" 2>/dev/null && pwd) ;;
    *)   MODPATH="$PWD" ;;
esac
[ -z "$MODPATH" ] && MODPATH="$PWD"
CONFIG_DIR=/data/adb/tricky_store

BB=""
for bb in /data/adb/ksu/bin/busybox /data/adb/magisk/busybox /data/adb/ap/bin/busybox \
          /data/adb/modules/busybox-ndk/system/*/busybox "$(command -v busybox 2>/dev/null)"; do
    [ -n "$bb" ] && [ -x "$bb" ] && BB="$bb" && break
done
SED_I="sed -i"
[ -n "$BB" ] && SED_I="$BB sed -i"
export MODPATH CONFIG_DIR SED_I

[ -f "$MODPATH/engine.sh" ] || { echo "ERR: engine.sh missing"; exit 1; }
. "$MODPATH/engine.sh"

# Lite line (ENGINE=none) has no bundled engine to enforce; the spoof flags live
# on the user's own standalone PIF, so push the spoof.conf overrides onto it via
# lite_pif_sync (which mirrors the fingerprint and re-asserts the flags). Every
# other line enforces on its bundled PIF.
if [ "${ENGINE:-none}" = none ]; then
    [ -f "$MODPATH/lite_pif_sync.sh" ] && sh "$MODPATH/lite_pif_sync.sh" >/dev/null 2>&1
else
    engine_enforce_spoof
fi
killall -9 com.google.android.gms.unstable 2>/dev/null
killall -9 com.android.vending 2>/dev/null
echo "OK"
