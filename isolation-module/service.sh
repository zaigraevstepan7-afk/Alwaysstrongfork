#!/system/bin/sh
# Non-blocking manager service. Nothing is enabled during Android startup.
set -eu
umask 077
MODDIR=$(cd "${0%/*}" && pwd)
boot_file=${AS_BOOT_ID_FILE:-/proc/sys/kernel/random/boot_id}
id=$(cat "$boot_file")
case "$id" in ''|*[!a-f0-9-]*) exit 0 ;; esac
[ "${#id}" -eq 36 ] || exit 0
active() {
    [ ! -e "$MODDIR/disable" ] && [ ! -e "$MODDIR/remove" ] || return 1
    for prop in ro.bootmode ro.boot.mode ro.boot.bootmode vendor.bootmode; do
        case "$(getprop "$prop" 2>/dev/null || :)" in
            recovery|charger|rescue|fastboot|fastbootd) return 1 ;;
        esac
    done
}
waited=0
while [ "$(getprop sys.boot_completed 2>/dev/null || :)" != 1 ]; do
    active || exit 0
    [ "$waited" -lt 180 ] || exit 0
    sleep 1
    waited=$((waited + 1))
done
active || exit 0
sleep 120
active || exit 0
[ "$(getprop sys.boot_completed 2>/dev/null || :)" = 1 ] || exit 0
[ "$(cat "$boot_file")" = "$id" ] || exit 0
tmp=$(mktemp "$MODDIR/.boot-ready.XXXXXX") || exit 0
trap 'rm -f "$tmp"' EXIT
printf '%s\n' "$id" > "$tmp"
chmod 600 "$tmp"
mv -f "$tmp" "$MODDIR/.boot-ready"
