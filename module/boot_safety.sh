#!/system/bin/sh
# Boot health belongs to this module only. No reboot, partition or user-data writes.
set -eu
umask 077
MODPATH=$(cd "${0%/*}" && pwd)
. "$MODPATH/as_store.sh"
as_init
boot_id() { cat "${AS_BOOT_ID_FILE:-/proc/sys/kernel/random/boot_id}" 2>/dev/null; }
# A disable flag alone is reversible from the manager. Keep the actual PIF
# payload outside the loader's zygisk/<abi>.so paths until explicit recovery.
# This path needs no native helper/lock, including on an interrupted update.
enforce_safe() {
    [ -e "$AS_DIR/boot-safe" ] || return 0
    touch "$MODPATH/disable" || return 1
    if [ -d "$MODPATH/zygisk" ]; then
        if [ ! -e "$MODPATH/.boot-safe-zygisk" ]; then
            mv "$MODPATH/zygisk" "$MODPATH/.boot-safe-zygisk" || return 1
        else
            # A repeated install/manual copy may put fresh libraries beside an
            # existing quarantine. Save the newest ABI files, never nest dirs.
            [ -d "$MODPATH/.boot-safe-zygisk" ] || return 1
            for lib in "$MODPATH"/zygisk/*.so; do
                [ -e "$lib" ] || continue
                mv -f "$lib" "$MODPATH/.boot-safe-zygisk/" || return 1
            done
            rmdir "$MODPATH/zygisk" 2>/dev/null || :
        fi
    fi
    return 1
}
normal_boot_mode() {
    for prop in ro.bootmode ro.boot.mode ro.boot.bootmode vendor.bootmode; do
        mode=$(getprop "$prop" 2>/dev/null || :)
        case "$mode" in recovery|charger|rescue|fastboot|fastbootd) return 1 ;; esac
    done
}
allow_boot() {
    enforce_safe || return 1
    [ ! -e "$MODPATH/disable" ] && [ ! -e "$MODPATH/remove" ] || return 1
    normal_boot_mode
}
cmd=${1:-status}
# Early entry points and the installer call this before any native deadline or
# service lock. A latched guard always returns 1, even after successful quarantine.
if [ "$cmd" = enforce ]; then enforce_safe; exit $?; fi
if [ "$cmd" = allow ]; then allow_boot; exit $?; fi
if [ "$cmd" = wait ]; then
    allow_boot || exit 1
    limit=${2:-180}
    case "$limit" in ''|*[!0-9]*) exit 1 ;; esac
    [ "$limit" -ge 1 ] && [ "$limit" -le 600 ] || exit 1
    waited=0
    while [ "$(getprop sys.boot_completed 2>/dev/null || :)" != 1 ]; do
        allow_boot || exit 1
        [ "$waited" -lt "$limit" ] || exit 1
        sleep 1; waited=$((waited + 1))
    done
    allow_boot; exit $?
fi
if [ "$cmd" = status ]; then
    cat "$AS_DIR/boot-state" 2>/dev/null || :
    [ ! -f "$AS_DIR/boot-safe" ] || echo 'safe=1'
    [ ! -d "$MODPATH/.boot-safe-zygisk" ] || echo 'zygisk_quarantined=1'
    current_id=$(boot_id || :)
    if [ -n "$current_id" ] && [ "$(cat "$AS_DIR/attest-paused" 2>/dev/null || :)" = "$current_id" ]; then
        echo 'attestation_paused=1'
    fi
    exit 0
fi
if [ "$cmd" != __locked ]; then
    if [ "$cmd" = recover ]; then
        # Recovery is deliberately separate from enabling the manager toggle,
        # reinstalling, resetting WebUI settings, or running Action.
        enforce_safe || :
        [ -e "$AS_DIR/boot-safe" ] && [ -f "$MODPATH/disable" ] || exit 1
    else
        allow_boot || exit 1
    fi
    as_lock_run "$AS_DIR/boot-guard.flock" 0 sh "$MODPATH/boot_safety.sh" __locked "$cmd"
    exit $?
fi
cmd=${2:-}
if [ "$cmd" = recover ]; then
    [ -e "$AS_DIR/boot-safe" ] && [ -f "$MODPATH/disable" ] && [ ! -e "$MODPATH/remove" ] || exit 1
    [ "$(getprop sys.boot_completed 2>/dev/null || :)" = 1 ] || exit 1
    normal_boot_mode || exit 1
    if [ -d "$MODPATH/.boot-safe-zygisk" ]; then
        [ ! -e "$MODPATH/zygisk" ] || exit 1
        mv "$MODPATH/.boot-safe-zygisk" "$MODPATH/zygisk" || exit 1
    fi
    # Clear the latch last. Keep disable so recovery cannot start the module
    # in this boot; the user must enable it in the manager and reboot.
    rm -f "$AS_DIR/boot-state" "$AS_DIR/boot-safe"
    echo 'Boot-safe cleared; module remains disabled. Enable in the manager and reboot to retry.'
    exit 0
fi
allow_boot || exit 1
id=$(boot_id)
case "$id" in ''|*[!A-Za-z0-9-]*) exit 1 ;; esac
state="$AS_DIR/boot-state"
old_id=$(_kv_get "$state" boot_id)
count=$(_kv_get "$state" attempts)
case "$count" in '') count=0 ;; 0|1|2) ;; *) count=2 ;; esac
case "$cmd" in
    begin)
        [ "$id" != "$old_id" ] || exit 0
        count=$((count + 1))
        if [ "$count" -ge 3 ]; then
            touch "$AS_DIR/boot-safe"
            enforce_safe || :
            printf '%s\n' 'Three boots did not reach the stable checkpoint; boot-safe latched. Explicit recovery is required.' > "$AS_LOGS/boot-safety.log"
            if [ -d "$MODPATH/zygisk" ]; then
                echo 'Zygisk quarantine incomplete; keep the module disabled and inspect the payload paths.' >> "$AS_LOGS/boot-safety.log"
            else
                echo 'Module disabled; bundled Zygisk payload quarantined (or absent in Lite).' >> "$AS_LOGS/boot-safety.log"
            fi
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
