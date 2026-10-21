#!/system/bin/sh
# Short WebUI requests; the detached worker owns the lock, log and deadline.
umask 077
MODPATH=$(cd "${0%/*}" && pwd) || exit 1
export MODPATH
. "$MODPATH/as_store.sh"
as_init
LOCK="$AS_TMP/webui-action.flock"
STATUS="$AS_LOGS/action-webui.status"
OUTPUT="$AS_LOGS/action-webui.log"

write_status() {
    printf 'state=%s\ncode=%s\n' "$1" "$2" > "$STATUS.tmp" &&
        mv -f "$STATUS.tmp" "$STATUS"
}

case "${1:-}" in
    start)
        rc=0
        as_lock_run "$LOCK" 0 sh "$MODPATH/webui_action.sh" __start || rc=$?
        # Another WebUI is attached to the same run: keep its log intact.
        [ "$rc" != 75 ] || { echo running; exit 0; }
        exit "$rc"
        ;;
    __start)
        : > "$OUTPUT" || exit 1
        write_status running '' || exit 1
        # Background children inherit lock-run's descriptor. Redirect all three
        # streams so the bridge returns immediately and page closure is harmless.
        sh "$MODPATH/webui_action.sh" __run </dev/null >/dev/null 2>&1 &
        echo started
        ;;
    __run)
        rc=0
        AS_FAST=1 as_bounded 480 sh "$MODPATH/action.sh" > "$OUTPUT" 2>&1 || rc=$?
        write_status finished "$rc"
        ;;
    __recover)
        # Acquiring the lock proves there is no worker, without PID reuse races.
        if grep -qx 'state=running' "$STATUS" 2>/dev/null; then
            write_status interrupted 143 || exit 1
        fi
        ;;
    status)
        rc=0
        as_lock_run "$LOCK" 0 sh "$MODPATH/webui_action.sh" __recover || rc=$?
        [ "$rc" = 0 ] || [ "$rc" = 75 ] || exit "$rc"
        if [ -f "$STATUS" ]; then cat "$STATUS"; else printf 'state=idle\ncode=\n'; fi
        printf '%s\n' '--log--'
        # Bound bridge payloads and DOM size; the full log stays on disk.
        if [ -f "$OUTPUT" ]; then tail -c 65536 "$OUTPUT"; fi
        ;;
    *) echo 'Usage: webui_action.sh start|status' >&2; exit 2 ;;
esac
