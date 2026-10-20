#!/system/bin/sh
# Local maintenance runs only in non-blocking service mode, under a deadline.
set -eu
umask 077
MODPATH=$(cd "${0%/*}" && pwd)
. "$MODPATH/as_store.sh"
as_init
if [ "${1:-}" != __locked ]; then
    as_lock_run "$AS_DIR/boot-prepare.flock" 0 sh "$MODPATH/boot_prepare.sh" __locked
    exit $?
fi
id=$(cat "${AS_BOOT_ID_FILE:-/proc/sys/kernel/random/boot_id}")
case "$id" in ''|*[!A-Za-z0-9-]*) exit 1 ;; esac
[ "$(cat "$AS_DIR/boot-prepared" 2>/dev/null || :)" != "$id" ] || exit 0
# Nothing from an earlier boot can hold a live lock. Do not erase active work
# when service.sh is manually run a second time in the same boot.
rm -rf "$AS_TMP"/* 2>/dev/null || :
as_migrate
sh "$MODPATH/repair_init.sh"
sh "$MODPATH/keybox_manage.sh" recover >/dev/null 2>&1 || :
st_del refresh; st_del ts_loop; st_del teesim_loop
printf '%s\n' "$id" > "$AS_DIR/boot-prepared"
