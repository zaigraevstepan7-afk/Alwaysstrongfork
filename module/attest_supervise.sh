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
# Persist the latest startup phase atomically. A failed daemon can disappear
# before the user collects logcat; this read-only diagnostic survives.
record_startup() (
    _phase=${1:-unknown}
    _detail=${2:-}
    _tmp=$(mktemp "$AS_LOGS/.attest-startup.XXXXXX") || exit 0
    if printf 'boot_id=%s\nengine=%s\nphase=%s\ndetail=%s\n' \
        "$id" "$engine" "$_phase" "$_detail" > "$_tmp" &&
        chmod 600 "$_tmp" && mv -f "$_tmp" "$AS_LOGS/attest-startup.status"; then
        :
    else
        rm -f "$_tmp"
    fi
    exit 0
)
if [ "$(cat "$AS_DIR/attest-paused" 2>/dev/null || :)" = "$id" ]; then
    record_startup paused 'circuit breaker already tripped in this boot'
    exit 0
fi
record_startup starting 'supervisor lock acquired'
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
trap 'exit_code=$?; stop_child; [ "$exit_code" -eq 0 ] || record_startup failed "supervisor exit code $exit_code"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
pause_engine() {
    printf '%s\n' "$id" > "$AS_DIR/attest-paused"
    printf '%s\n' "$1" > "$AS_LOGS/attest-safety.log"
    record_startup paused "$1"
}
# Circuit-breaker time must not jump when network time corrects the clock.
uptime_seconds() {
    read -r seconds rest < "${AS_UPTIME_FILE:-/proc/uptime}" || return 1
    seconds=${seconds%%.*}
    case "$seconds" in ''|*[!0-9]*) return 1 ;; esac
    [ "${#seconds}" -le 9 ] || return 1
    printf '%s\n' "$seconds"
}
budget="$AS_DIR/attest-attempts"
rapid=0
if [ "$(_kv_get "$budget" boot_id)" = "$id" ]; then
    rapid=$(_kv_get "$budget" attempts)
    case "$rapid" in 0|1|2|3) ;; *) rapid=3 ;; esac
fi
save_budget() {
    tmp=$(mktemp "$AS_DIR/.attest-attempts.XXXXXX") || return 1
    printf 'boot_id=%s\nattempts=%s\n' "$id" "$rapid" > "$tmp" && mv -f "$tmp" "$budget"
}
ks_changes=0; ks_window=$(uptime_seconds); ks_pid=''
while sh "$MODPATH/boot_safety.sh" allow; do
    # A malformed or missing keybox is never passed to keystore injection.
    if ! as_bounded 8 sh "$MODPATH/keybox_manage.sh" check >/dev/null 2>&1; then
        record_startup blocked 'keybox check failed or timed out'
        exit 0
    fi
    # Re-check on every owned daemon restart, not just service startup: an OEM
    # service may have restored an unlocked/debug property after the first run.
    if ! as_bounded 8 sh "$MODPATH/boot_props.sh" apply > "$AS_LOGS/boot-props.log" 2>&1; then
        record_startup blocked 'boot property check failed or timed out'
        exit 0
    fi
    if [ "$rapid" -ge 3 ]; then
        pause_engine 'Attestation paused for this boot after three unconfirmed daemon launches.'
        exit 0
    fi
    rapid=$((rapid + 1))
    save_budget || exit 0
    started=$(uptime_seconds)
    if [ -z "$ks_pid" ]; then ks_pid=$(pidof keystore2 2>/dev/null | head -1 || :); fi
    if [ "$engine" = teesim ]; then
        home="$MODPATH/teesim"
        if [ ! -s "$home/classes.dex" ]; then
            record_startup blocked 'TEESimulator classes.dex missing or empty'
            exit 1
        fi
        record_startup launching "attempt=$rapid (JingMatrix)"
        nice -n 10 /system/bin/app_process -Djava.class.path="$home/classes.dex" "$home" --nice-name=teesim org.matrix.teesim.App "$home" &
    else
        if [ ! -s "$MODPATH/daemon" ]; then
            record_startup blocked 'TEE daemon launcher missing or empty'
            exit 1
        fi
        record_startup launching "attempt=$rapid"
        nice -n 10 sh "$MODPATH/daemon" "$MODPATH" &
    fi
    child=$!
    child_start=$(_proc_start "$child")
    while child_alive; do
        now=$(uptime_seconds)
        if [ "$((now - started))" -lt 120 ]; then sleep 5; else sleep 30; fi
        sh "$MODPATH/boot_safety.sh" allow || exit 0
        current=$(pidof keystore2 2>/dev/null | head -1 || :)
        now=$(uptime_seconds)
        # A stable owned daemon clears the persisted launch budget. The
        # keystore churn check still runs before declaring this launch healthy.
        if [ "$((now - ks_window))" -ge 60 ]; then ks_changes=0; ks_window=$now; fi
        if [ -n "$current" ] && [ -n "$ks_pid" ] && [ "$current" != "$ks_pid" ]; then
            ks_changes=$((ks_changes + 1))
            if [ "$ks_changes" -ge 2 ]; then
                pause_engine 'Attestation paused for this boot: keystore2 restarted repeatedly.'
                exit 0
            fi
        fi
        [ -z "$current" ] || ks_pid=$current
        if [ "$rapid" -ne 0 ] && [ "$((now - started))" -ge 60 ]; then
            rapid=0; save_budget || exit 0
            record_startup running 'daemon stayed alive for 60s; verdict not verified'
        fi
    done
    wait "$child" 2>/dev/null || :
    child=''
    now=$(uptime_seconds)
    record_startup exited "daemon stopped after $((now - started))s; attempt=$rapid"
    if [ "$((now - started))" -ge 60 ]; then rapid=0; save_budget || exit 0; fi
    if [ "$rapid" -ge 3 ]; then
        pause_engine 'Attestation paused for this boot after three rapid daemon exits.'
        exit 0
    fi
    case "$rapid" in 0|1) sleep 10 ;; *) sleep 30 ;; esac
done
record_startup stopped 'boot guard denied further operation'
