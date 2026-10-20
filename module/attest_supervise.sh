#!/system/bin/sh
# One owner, limited rapid retries and a keystore restart circuit breaker.
set -eu
umask 077
MODPATH=$(cd "${0%/*}" && pwd)
. "$MODPATH/as_store.sh"
as_init
engine=${1:-tee}
case "$engine" in tee|trickystoreoss|teesim) ;; *) exit 1 ;; esac
if [ "${2:-}" != __locked ]; then
    as_lock_run "$AS_DIR/attest-supervisor.flock" 0 sh "$MODPATH/attest_supervise.sh" "$engine" __locked
    exit $?
fi
id=$(cat "${AS_BOOT_ID_FILE:-/proc/sys/kernel/random/boot_id}")
[ "$(cat "$AS_DIR/attest-paused" 2>/dev/null || :)" != "$id" ] || exit 0
child=''
child_start=''
child_alive() {
    [ -n "$child" ] && kill -0 "$child" 2>/dev/null || return 1
    if [ -d /proc ]; then
        [ -n "$child_start" ] && [ "$child_start" = "$(_proc_start "$child")" ] || return 1
    fi
}
stop_child() {
    if child_alive; then
        kill -TERM "$child" 2>/dev/null || :
        sleep 1
        if child_alive; then kill -KILL "$child" 2>/dev/null || :; fi
    fi
    child=''
}
trap stop_child EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
pause_engine() {
    printf '%s\n' "$id" > "$AS_DIR/attest-paused"
    printf '%s\n' "$1" > "$AS_LOGS/attest-safety.log"
}
rapid=0; ks_changes=0; ks_window=$(date +%s); ks_pid=''
while sh "$MODPATH/boot_safety.sh" allow; do
    # A malformed or missing keybox is never passed to keystore injection.
    sh "$MODPATH/keybox_manage.sh" check >/dev/null 2>&1 || exit 0
    # Re-check on every owned daemon restart, not just service startup: an OEM
    # service may have restored an unlocked/debug property after the first run.
    as_bounded 8 sh "$MODPATH/boot_props.sh" apply > "$AS_LOGS/boot-props.log" 2>&1 || exit 0
    started=$(date +%s)
    if [ -z "$ks_pid" ]; then ks_pid=$(pidof keystore2 2>/dev/null | head -1 || :); fi
    if [ "$engine" = teesim ]; then
        home="$MODPATH/teesim"
        [ -s "$home/classes.dex" ] || exit 1
        nice -n 10 /system/bin/app_process -Djava.class.path="$home/classes.dex" "$home" --nice-name=teesim org.matrix.teesim.App "$home" &
    else
        [ -f "$MODPATH/daemon" ] || exit 1
        nice -n 10 sh "$MODPATH/daemon" "$MODPATH" &
    fi
    child=$!
    child_start=$(_proc_start "$child")
    while child_alive; do
        now=$(date +%s)
        if [ "$((now - started))" -lt 120 ]; then sleep 5; else sleep 30; fi
        sh "$MODPATH/boot_safety.sh" allow || exit 0
        current=$(pidof keystore2 2>/dev/null | head -1 || :)
        now=$(date +%s)
        if [ "$((now - ks_window))" -ge 60 ]; then ks_changes=0; ks_window=$now; fi
        if [ -n "$current" ] && [ -n "$ks_pid" ] && [ "$current" != "$ks_pid" ]; then
            ks_changes=$((ks_changes + 1))
            if [ "$ks_changes" -ge 2 ]; then
                pause_engine 'Attestation paused for this boot: keystore2 restarted repeatedly.'
                exit 0
            fi
        fi
        [ -z "$current" ] || ks_pid=$current
    done
    wait "$child" 2>/dev/null || :
    child=''
    now=$(date +%s)
    if [ "$((now - started))" -ge 60 ]; then rapid=0; else rapid=$((rapid + 1)); fi
    if [ "$rapid" -ge 3 ]; then
        pause_engine 'Attestation paused for this boot after three rapid daemon exits.'
        exit 0
    fi
    case "$rapid" in 0|1) sleep 10 ;; *) sleep 30 ;; esac
done
