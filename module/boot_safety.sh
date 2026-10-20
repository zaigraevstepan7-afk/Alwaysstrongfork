#!/system/bin/sh
# Boot health belongs to this module only. No reboot, partition or user-data writes.
set -eu
umask 077
MODPATH=$(cd "${0%/*}" && pwd)
. "$MODPATH/as_store.sh"
as_init
boot_id() { cat "${AS_BOOT_ID_FILE:-/proc/sys/kernel/random/boot_id}" 2>/dev/null; }
allow_boot() {
    [ ! -f "$MODPATH/disable" ] && [ ! -f "$AS_DIR/boot-safe" ] || return 1
    for prop in ro.bootmode ro.boot.mode ro.boot.bootmode vendor.bootmode; do
        mode=$(getprop "$prop" 2>/dev/null || :)
        case "$mode" in recovery|charger|rescue|fastboot|fastbootd) return 1 ;; esac
    done
}
cmd=${1:-status}
if [ "$cmd" = allow ]; then allow_boot; exit $?; fi
if [ "$cmd" = wait ]; then
    limit=${2:-180}
    case "$limit" in ''|*[!0-9]*) exit 1 ;; esac
    [ "$limit" -ge 1 ] && [ "$limit" -le 600 ] || exit 1
    waited=0
    while [ "$(getprop sys.boot_completed 2>/dev/null || :)" != 1 ]; do
        allow_boot || exit 1
        [ "$waited" -lt "$limit" ] || exit 1
        sleep 1; waited=$((waited + 1))
    done
    exit 0
fi
if [ "$cmd" = status ]; then
    cat "$AS_DIR/boot-state" 2>/dev/null || :
    [ ! -f "$AS_DIR/boot-safe" ] || echo 'safe=1'
    current_id=$(boot_id || :)
    if [ -n "$current_id" ] && [ "$(cat "$AS_DIR/attest-paused" 2>/dev/null || :)" = "$current_id" ]; then
        echo 'attestation_paused=1'
    fi
    exit 0
fi
if [ "$cmd" != __locked ]; then
    allow_boot || exit 1
    as_lock_run "$AS_DIR/boot-guard.flock" 0 sh "$MODPATH/boot_safety.sh" __locked "$cmd"
    exit $?
fi
cmd=${2:-}
id=$(boot_id)
case "$id" in ''|*[!A-Za-z0-9-]*) exit 1 ;; esac
state="$AS_DIR/boot-state"
old_id=$(_kv_get "$state" boot_id)
count=$(_kv_get "$state" attempts)
case "$count" in ''|*[!0-9]*) count=0 ;; esac
case "$cmd" in
    begin)
        [ "$id" != "$old_id" ] || exit 0
        count=$((count + 1))
        if [ "$count" -ge 3 ]; then
            touch "$AS_DIR/boot-safe" "$MODPATH/disable"
            printf '%s\n' 'Three boots did not reach the stable checkpoint; only tricky_store disabled.' > "$AS_LOGS/boot-safety.log"
        fi ;;
    complete)
        [ "$id" = "$old_id" ] && [ "$(getprop sys.boot_completed 2>/dev/null || :)" = 1 ] || exit 1
        count=0 ;;
    *) exit 1 ;;
esac
tmp=$(mktemp "$AS_DIR/.boot-state.XXXXXX")
trap 'rm -f "$tmp"' EXIT
printf 'boot_id=%s\nattempts=%s\n' "$id" "$count" > "$tmp"
mv -f "$tmp" "$state"
[ ! -f "$AS_DIR/boot-safe" ]
