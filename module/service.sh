#!/system/bin/sh
MODDIR=$(cd "${0%/*}" && pwd)
MODPATH="$MODDIR"
cd "$MODDIR" || exit 0
. "$MODDIR/repair_runtime.sh"
# The descriptor also stays open in background watchdog/hourly shells. A
# repeated service entry therefore cannot create another set of permanent jobs.
if [ "${1:-}" != __owned ]; then
    rc=0
    as_lock_run "$MODDIR/.service.flock" 0 sh "$MODDIR/service.sh" __owned || rc=$?
    [ "$rc" != 75 ] || exit 0
    exit "$rc"
fi
# This service stage is non-blocking, but every startup step still has a cap.
as_bounded 5 sh "$MODDIR/boot_safety.sh" begin || exit 0

# Probe in a subshell first: under mksh / toybox sh the option is unknown and a
# bare `set +o standalone` is a fatal special-builtin error (see action.sh).
(set +o standalone) 2>/dev/null && set +o standalone
unset ASH_STANDALONE

[ -f "$MODDIR/common_func.sh" ] && . "$MODDIR/common_func.sh"
# Settings, state and logs: one directory, one key=value file (see as_store.sh).
[ -f "$MODDIR/as_store.sh" ] && . "$MODDIR/as_store.sh"
# A redirect into an unset $AS_LOGS would write to the filesystem root, so the
# path is pinned here even in the impossible case that the file is missing.
: "${AS_LOGS:=/data/adb/tricky_store/alwaysstrong/logs}"
mkdir -p "$AS_LOGS" 2>/dev/null

# Installer performs migration as well; the service repeats it idempotently
# after boot-stage scripts have returned. Failure skips injection for this boot.
if ! as_bounded 20 sh "$MODDIR/boot_prepare.sh" > "$AS_LOGS/boot-prepare.log" 2>&1; then
    log -t "AlwaysStrong" "local prepare failed/timed out; attestation startup skipped"
    exit 0
fi
AS_BOOT_CURRENT=$(cat "${AS_BOOT_ID_FILE:-/proc/sys/kernel/random/boot_id}" 2>/dev/null)

# --- Play Integrity engine adapter ---
# Which prop file the zygisk reads, and what its spoof flags are called, is all
# that differs between the two builds. engine.sh owns it; everything below is
# identical in both.
CONFIG_DIR=/data/adb/tricky_store
if [ -f "$MODDIR/engine.sh" ]; then
    . "$MODDIR/engine.sh"
else
    log -t "AlwaysStrong" "engine.sh missing — no fingerprint handling this boot"
    engine_autopif()       { return 1; }
    engine_install_pif()   { return 1; }
    engine_enforce_spoof() { return 0; }
    ENGINE=none
fi

# --- Attestation engine adapter (TEESimulator-RS | TrickyStoreOSS) -----------
# build.sh overlays exactly one attest.sh; the daemon start/liveness below go
# through it. Fall back to the TEESimulator pattern if it is somehow missing.
if [ -f "$MODDIR/attest.sh" ]; then
    . "$MODDIR/attest.sh"
else
    attest_early() { return 1; }
    attest_start() { return 1; }
    ATTEST=none
    attest_alive() { pidof TEESimulator >/dev/null 2>&1; }
fi

start_attestation() {
    sh "$MODDIR/boot_safety.sh" allow || return 1
    [ "$(cat "$AS_DIR/attest-paused" 2>/dev/null)" != "$AS_BOOT_CURRENT" ] || return 1
    as_bounded 8 sh "$MODDIR/keybox_manage.sh" check >/dev/null 2>&1 || return 1
    # No TEE startup race with the asynchronous post-boot property block.
    if ! as_bounded 8 sh "$MODDIR/boot_props.sh" apply > "$AS_LOGS/boot-props.log" 2>&1; then
        log -t "AlwaysStrong" "boot property policy failed/timed out; new attestation startup skipped"
        return 1
    fi
    attest_start
}

# Engines that hijack keystore2 (TrickyStoreOSS) must start at the service stage,
# before sys.boot_completed — a late start misses the injection window and the
# daemon crash-loops with EBADF. Engines that don't (TEESimulator) return false
# here and are started after the boot-completed wait below.
#
# Every adapter goes through start_attestation, which applies and verifies the
# same boot property policy synchronously before starting the engine.
if attest_early 2>/dev/null; then start_attestation || :; fi

# Recovery/charger modes are rejected by boot_safety before any changes.
# Do not falsify encryption state or chmod SELinux control/policy interfaces.

# --- Late properties (after boot_completed) — required for some OEMs ---
{
as_bounded 185 sh "$MODDIR/boot_safety.sh" wait 180 || exit 0

# Lock/debug properties are applied synchronously by start_attestation.
# Keep the unrelated ROM/DenyList work outside that startup gate.

# --- LineageOS prop scrub (hide derivative-ROM markers from PI checks) ---
# Low-risk cosmetic strips (vendor name prefix, Aperture camera package list)
# run always — they don't affect any Settings UI. The riskier deletes that can
# break ROM features are gated behind the opt-in hide_rom_markers flag.
LV=$(getprop ro.product.vendor.name 2>/dev/null)
case "$LV" in
    lineage_*) resetprop -n ro.product.vendor.name "${LV#lineage_}" ;;
esac
for LP in vendor.camera.aux.packagelist persist.vendor.camera.privapp.list; do
    LCV=$(getprop "$LP" 2>/dev/null)
    case "$LCV" in
        *org.lineageos.aperture*)
            LCV=$(echo "$LCV" | sed -e 's/,org\.lineageos\.aperture//g' \
                                    -e 's/org\.lineageos\.aperture,//g' \
                                    -e 's/^org\.lineageos\.aperture$//')
            resetprop -n "$LP" "$LCV"
            ;;
    esac
done
# Lineage Health HAL: LineageOS Settings shows the "Fast charging" / charging
# control toggles only when init.svc.vendor.lineage_health reports "running";
# deleting the prop makes Settings believe the HAL is down and HIDES the whole
# toggle (reported on LineageOS — the fast-charging switch disappears). The
# "lineage" in the prop name is a PI tell, but PI doesn't read init.svc.*, so
# dropping it costs the user a real feature for no integrity gain. Preserve by
# default; only delete when the user opts into aggressive marker hiding. See
# issue #7.
#   Opt-in:  hide_rom_markers=1 in alwaysstrong/config
as_on hide_rom_markers && \
    resetprop --delete init.svc.vendor.lineage_health 2>/dev/null

# --- DenyList: add the Google Play stack (entries only; never enforcement) ---
# Runs after boot_completed so the packages are registered. denylist.sh is a
# no-op unless denylist_gms is on, the manager is Magisk, and enforcement is off.
[ -f "$MODDIR/denylist.sh" ] && sh "$MODDIR/denylist.sh" 2>/dev/null
}&

_src=$(sed -n 's/^author=//p' "$MODDIR/module.prop" 2>/dev/null)
case "$_src" in *[Ee]vokerr*) ;; *)
  sed -i 's/^description=.*/description=⚠️ UNOFFICIAL BUILD — get the real one: gitlab.com\/Evokerr\/AlwaysStrong/' "$MODDIR/module.prop" 2>/dev/null
  log -t "AlwaysStrong" "unofficial build detected"
;; esac

# --- Conflict re-scan on every boot ---
# A user can install a conflicting module AFTER they've installed AlwaysStrong
# (the install-time scan in customize.sh only fires once). Re-run the same
# disable-known-conflicts pass at every boot so a fresh install of e.g.
# playintegrityfix doesn't silently break our hooks.
if [ -x "$MODDIR/conflict_scan.sh" ]; then
    MODPATH="$MODDIR" sh "$MODDIR/conflict_scan.sh" >/dev/null 2>&1
    n=$?
    [ "$n" -gt 0 ] && log -t "AlwaysStrong" "detected $n conflicting module(s); no modules changed"
fi

# --- Wait for boot, then start TEE simulator ---
if ! as_bounded 185 sh "$MODDIR/boot_safety.sh" wait 180; then
    log -t "AlwaysStrong" "boot completion not observed; remaining jobs skipped"
    exit 0
fi

if attest_early 2>/dev/null; then
    as_bounded 8 sh "$MODDIR/boot_props.sh" apply > "$AS_LOGS/boot-props.log" 2>&1 || :
fi

# Each adapter uses one kernel-locked supervisor. Do not kill/restart a live
# engine when service.sh is accidentally run twice in the same boot.
if ! attest_alive 2>/dev/null; then start_attestation || :; fi
# A boot counts as healthy only after Android remains up for two minutes.
# This also catches fast reboots caused by post-boot TEE initialization.
{
    sleep 120
    sh "$MODDIR/boot_safety.sh" allow && as_bounded 5 sh "$MODDIR/boot_safety.sh" complete
} &

# --- aswatcher native daemon (inotify target.txt + Xposed + conflict) ---
case "$(uname -m)" in
    aarch64)       AS_ABI=arm64-v8a ;;
    armv7*|armv8l) AS_ABI=armeabi-v7a ;;
    x86_64)        AS_ABI=x86_64 ;;
    i?86)          AS_ABI=x86 ;;
    *)             AS_ABI="" ;;
esac
AS_BIN="$MODDIR/bin/$AS_ABI/aswatcher"
if [ -x "$AS_BIN" ] && ! pidof aswatcher >/dev/null 2>&1; then
    {
        sleep 5
        "$AS_BIN" &
        log -t "AlwaysStrong" "aswatcher launched ($AS_ABI)"
    } &
fi

# --- Anti-detection hardening (each opt-out via a no_* flag) --------------
# Runs after the TEE/aswatcher daemons are up. All three degrade quietly if
# their prerequisites are missing (no pif yet, SELinux blocks /proc writes).
{
    sleep 8   # let supervisor/daemon/aswatcher come up first

    # NOTE: prop_unify.sh (global resetprop of ro.product.*) ships but is
    # deliberately never invoked, on either engine. Both spoof Build/ro.product.*
    # where Play Integrity looks, so a global resetprop buys no integrity — and it
    # leaks the spoofed model to every process, so the device shows up as e.g.
    # "Pixel 10" in scrcpy/ADB. It stays in the tree for manual use only.

    # Suppress our log tags + scrub ANR/tombstone traces (self-daemonizes).
    if as_on logcat_cleanup && [ -f "$MODDIR/logcat_cleanup.sh" ]; then
        MODPATH="$MODDIR" sh "$MODDIR/logcat_cleanup.sh" >/dev/null 2>&1 &
    fi
} &

# --- VBMeta digest (deferred, bounded) ---
# After a bootloader unlock ro.boot.vbmeta.digest reads 0000…, which boot-hash
# detectors flag. Resolve a valid 64-hex digest with a priority chain (the idea
# borrowed from Specter's boot-hash resolver — minus its random fallback, which
# fails any baseline check and can't be reproduced):
#   1. a valid non-zero value the bootloader already reports -> keep it (real).
#   2. our cached value (state key 'boot_hash') -> stable across boots, and skips
#      re-reading the partition (that read can stall early boot on some Xiaomis).
#   3. sha256 of the vbmeta partition -> deterministic from THIS device, so it is
#      stable every boot; computed once, then cached.
{
sleep 60
_valid_hash() {   # 64 hex chars, not all zero
    case "$1" in ''|*[!0-9a-fA-F]*) return 1 ;; esac
    [ "${#1}" -eq 64 ] || return 1
    case "$1" in *[!0]*) return 0 ;; *) return 1 ;; esac
}
_cur=$(resetprop ro.boot.vbmeta.digest 2>/dev/null | tr 'A-F' 'a-f' | tr -d ' \t\r\n')
if ! _valid_hash "$_cur"; then
    _bh=""
    if command -v st_get >/dev/null 2>&1; then
        _cached=$(st_get boot_hash | tr 'A-F' 'a-f' | tr -d ' \t\r\n')
        _valid_hash "$_cached" && _bh="$_cached"
    fi
    if [ -z "$_bh" ]; then
        for p in /dev/block/by-name/vbmeta /dev/block/by-name/vbmeta_a /dev/block/bootdevice/by-name/vbmeta; do
            [ -e "$p" ] && VBMETA_BLK="$p" && break
        done
        if [ -n "$VBMETA_BLK" ]; then
            _calc=$(dd if="$VBMETA_BLK" bs=4096 count=16 2>/dev/null | sha256sum 2>/dev/null | cut -d' ' -f1 | tr -d ' \t\r\n')
            _valid_hash "$_calc" && _bh="$_calc"
        fi
    fi
    if _valid_hash "$_bh"; then
        command -v st_set >/dev/null 2>&1 && st_set boot_hash "$_bh"
        resetprop -n ro.boot.vbmeta.digest "$_bh"
        log -t "AlwaysStrong" "VBMeta digest set: $(printf '%s' "$_bh" | cut -c1-16)... (resolved)"
        # The digest is the TEESimulator verifiedBootHash override. The daemon
        # harvested before this resolved, so push a fresh config/override now
        # instead of waiting for the hourly tick (no-op on the other engines).
        [ "$ATTEST" = teesim ] && command -v teesim_gen_config >/dev/null 2>&1 && teesim_gen_config
    fi
fi
}&

# --- TEESimulator + aswatcher watchdog ---
{
    while true; do
        sleep 120
        sh "$MODDIR/boot_safety.sh" allow || exit 0
        if [ -s "$AS_DIR/verdict-inbox.json" ]; then
            sh "$MODDIR/verdict_report.sh" >"$AS_LOGS/verdict-import.log" 2>&1 || :
        fi
        (sh "$MODDIR/auto_repair.sh" >"$AS_LOGS/repair-worker.log" 2>&1 < /dev/null &)
        if ! attest_alive; then
            log -t "AlwaysStrong" "attestation daemon died, restarting..."
            start_attestation || :
        fi
        if [ -x "$AS_BIN" ] && ! pidof aswatcher >/dev/null 2>&1; then
            log -t "AlwaysStrong" "aswatcher died, restarting..."
            "$AS_BIN" &
        fi
    done
}&

# --- First-boot auto-action (once per install) ---------------------------
# One automatic press of [Action] on the FIRST boot after install, so a fresh
# install lands STRONG without the user ever opening the WebUI. First boot only
# on purpose — a plain reboot does NOT re-run it; ongoing refresh is the hourly
# loop's job.
#
# It runs the real action.sh, the exact same path a manual press takes: build
# the target list, fetch the fingerprint with all three sources (native crawl,
# upstream fetcher, then the shipped local props as a guaranteed fallback),
# enforce the STRONG spoof flags, sync the security patch, and restart PI. The
# old inline copy here skipped the target-list build and the local fingerprint
# fallback, so on a first boot where the network crawl wasn't ready yet it left
# no usable fingerprint and the device sat at BASIC until a manual press —
# which is exactly the "first-boot Action doesn't happen" bug. Calling action.sh
# means there is only one copy of that logic and no weaker duplicate to drift.
#
# The .bootstrapped marker lives in MODDIR, which is wiped on uninstall/update,
# so a reinstall re-bootstraps but a reboot doesn't.
if [ ! -f "$MODDIR/.bootstrapped" ]; then
{
    # Right as the device comes up — no long pre-wait. Only a short settle so
    # GMS has started, then a brief network probe (cap ~12s) and go: action.sh
    # has a guaranteed local-fingerprint fallback, so it reaches STRONG even
    # before the network is ready, and the hourly loop later refreshes to a
    # freshly fetched fingerprint. (Lite's standalone-PIF timing is handled by
    # the separate every-boot re-sync below, so no extra wait is needed here.)
    sleep 5
    j=0
    until ping -c1 -W2 1.1.1.1 >/dev/null 2>&1; do
        j=$((j+1)); [ $j -gt 6 ] && break
        sleep 2
    done
    log -t "AlwaysStrong-boot" "first boot: auto-pressing Action"

    # Run action.sh under busybox ash: its `set +o standalone` line needs ash,
    # and toybox sh (some ROMs' default) aborts there. Fall back to plain sh
    # (this service already runs under the manager's ash) if no busybox is found.
    BB=""
    for bb in /data/adb/magisk/busybox /data/adb/ksu/bin/busybox /data/adb/ap/bin/busybox \
              /data/adb/modules/busybox-ndk/system/*/busybox; do
        [ -x "$bb" ] && BB="$bb" && break
    done
    sh "$MODDIR/boot_safety.sh" allow || exit 0
    rc=0
    if [ -n "$BB" ]; then
        AS_FAST=1 as_bounded 480 "$BB" sh "$MODDIR/action.sh" >"$AS_LOGS/action-boot.log" 2>&1 || rc=$?
    else
        AS_FAST=1 as_bounded 480 sh "$MODDIR/action.sh" >"$AS_LOGS/action-boot.log" 2>&1 || rc=$?
    fi
    if [ "$rc" = 0 ]; then
        touch "$MODDIR/.bootstrapped"
        log -t "AlwaysStrong-boot" "first boot: Action done"
    else
        log -t "AlwaysStrong-boot" "first boot: Action failed/timed out; existing files kept"
    fi
}&
fi

# --- Lite + standalone PIF: re-sync shortly after every boot -------------
# Separate from the first-boot Action above and NOT one-shot: a standalone
# PlayIntegrityFork/Fix re-runs its own autopif on every boot and resets the
# spoof flags to weak defaults (Fork: spoofVendingFinger 1 -> 0), which would
# drop the Lite verdict after a plain reboot. Once its boot autopif has had time
# to land, mirror its fingerprint into the attested identity and re-assert the
# STRONG flags. No-op on the other lines and when no PIF is installed; the hourly
# loop keeps it in sync from there.
if grep -q '^ENGINE=none' "$MODDIR/engine.sh" 2>/dev/null; then
    { sleep 90; sh "$MODDIR/lite_pif_sync.sh" 2>&1 | log -t "AlwaysStrong-boot"; } &
fi

# --- Hourly refresh (fingerprint + keybox, each toggle-able from WebUI) --
# The WebUI writes the switches into alwaysstrong/config:
#   auto_fp=0      -> skip the fingerprint refresh
#   custom_pif=1   -> user imported a pif; never fetch over it
#   auto_keybox=0  -> skip the keybox fetch
# Keybox-only restarts PI when it actually changed (exit 0); fingerprint
# updates are picked up naturally on the next PI invocation, so we don't
# kick running banking apps for cosmetic refreshes.
{
    export MODPATH="$MODDIR"
    # Interval is user-configurable from the WebUI. Default 1h, floor 60s so a
    # misconfigured 0/-1/garbage can't busy-spin the loop (as_int clamps).
    #
    # The wait is counted in slices rather than slept in one go: `sleep "$(as_int
    # interval_sec)"` read the setting once, at the START of the wait, so turning
    # 60 minutes into 1 still sat out the rest of the hour and the new interval
    # looked like it had been ignored. A slice is at most 60s — the shortest
    # interval that can be set — so a change is picked up within a minute, and
    # the time already waited counts towards the new interval, which makes a
    # shortened one fire at once.
    #
    # The interval is read once, when the wait starts - and the wait is dropped
    # the moment it changes, because whoever writes the setting tells us
    # (as_store.sh's as_notify -> CONT). It is the way nginx handles a changed
    # config: the daemon does not watch the file, `nginx -s reload` tells it.
    # Nothing is polled here, so an idle hour costs exactly one wakeup, as it
    # did before any of this.
    #
    # The sleep runs in the background and is waited on: a shell only runs a
    # trap once the foreground child is done, so a plain `sleep 3600` would
    # swallow the signal for the rest of the hour - the very thing being fixed.
    #
    # A config edited by hand sends no signal; `sh as_store.sh reload` does, and
    # without it the change lands on the next cycle.
    RESET=0
    # In a background block $$ is the PARENT shell's pid and `sh -c 'echo $PPID'`
    # answers for whichever shell the command substitution forked - both name the
    # wrong process, and the signal then goes to a shell with no trap for it. The
    # first field of /proc/self/stat is read by a builtin in THIS process.
    read LOOP_PID _ < /proc/self/stat 2>/dev/null || LOOP_PID=$$
    # the pid plus its start time (a pid on its own is not an identity, the
    # system reuses them), kept as one line in the state file rather than a file
    # of its own
    st_set refresh "$LOOP_PID $(_proc_start "$LOOP_PID")"
    # CONT rather than USR1: should the stored pid ever name something else, the
    # default action for CONT is to carry on, while USR1 terminates.
    #
    # RESET is set only when there IS a wait to interrupt. A signal that arrives
    # while the refresh itself is running has nothing to cancel - the next wait
    # reads the new interval by itself - and leaving the flag set would have made
    # that wait end in a `continue`, silently skipping one whole cycle.
    trap '[ -n "$SLEEP_PID" ] && { RESET=1; kill "$SLEEP_PID" 2>/dev/null; }' CONT
    while true; do
        sleep "$(as_int interval_sec 60)" &
        SLEEP_PID=$!
        wait "$SLEEP_PID" 2>/dev/null
        SLEEP_PID=""
        sh "$MODDIR/boot_safety.sh" allow || exit 0
        if [ "$RESET" = 1 ]; then
            RESET=0          # interval changed: drop this wait, start the new one now
            continue
        fi
        if ! as_on custom_pif && as_on auto_fp && [ "${ENGINE:-none}" != "none" ]; then
            FP_DONE=0
            if [ -x "$MODDIR/pif_native_fetch.sh" ]; then
                sh "$MODDIR/pif_native_fetch.sh" >"$AS_LOGS/autopif.log" 2>&1 && FP_DONE=1
                cat "$AS_LOGS/autopif.log" 2>/dev/null | log -t "AlwaysStrong-hourly"
            fi
            if [ "$FP_DONE" = 0 ]; then
                engine_autopif 2>&1 | log -t "AlwaysStrong-hourly"
            fi
            [ -f "$MODDIR/sync_patch.sh" ] && sh "$MODDIR/sync_patch.sh" 2>&1 | log -t "AlwaysStrong-hourly"
            # upstream's fetcher resets these to a WEAK config (Fork's
            # migrate.sh writes spoofProvider=1 / spoofVendingFinger=0), which
            # would silently drop the verdict an hour after boot.
            engine_enforce_spoof
        elif [ "${ENGINE:-none}" = "none" ] && as_on auto_fp; then
            # Lite line: no bundled engine to autopif, but if the user runs their
            # own standalone PlayIntegrityFork, mirror its fingerprint into the
            # attested identity and re-assert the STRONG spoof flags it keeps
            # resetting (spoofVendingFinger 1 -> 0). No-op with no PIF present.
            sh "$MODDIR/lite_pif_sync.sh" 2>&1 | log -t "AlwaysStrong-hourly"
        fi
        if ! as_on custom_keybox && as_on auto_keybox && [ -x "$MODDIR/keybox_fetch.sh" ]; then
            kbout=$(sh "$MODDIR/keybox_fetch.sh" 2>&1)
            kbrc=$?
            [ -n "$kbout" ] && echo "$kbout" | log -t "AlwaysStrong-hourly"
            if [ "$kbrc" = "0" ]; then
                log -t "AlwaysStrong-hourly" "keybox updated, restarting PI"
                killall -9 com.google.android.gms.unstable 2>/dev/null
                killall -9 com.android.vending 2>/dev/null
            fi
        fi
        # Status — independent of toggles; cheap GET, idempotent module.prop write
        if [ -x "$MODDIR/status_fetch.sh" ]; then
            sh "$MODDIR/status_fetch.sh" 2>&1 | log -t "AlwaysStrong-hourly"
        fi
        # TEESimulator (JingMatrix) only: keep its config.json target list in sync
        # with target.txt so a newly installed app is attested without a reboot.
        # No-op / undefined on the other engines.
        command -v teesim_gen_config >/dev/null 2>&1 && teesim_gen_config
    done
}&
