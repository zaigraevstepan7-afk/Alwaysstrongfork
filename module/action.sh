#!/system/bin/sh
# AlwaysStrong action button.
# Shows each step progressively with status feedback.

case "$0" in
    */*) MODPATH=$(cd "${0%/*}" 2>/dev/null && pwd) ;;
    *)   MODPATH="$PWD" ;;
esac
[ -z "$MODPATH" ] && MODPATH="$PWD"
cd "$MODPATH" 2>/dev/null

# Hop into the manager's busybox ash before doing anything else. Magisk used to
# run action.sh inside its own ash, but newer Magisk Alpha builds (app 96221b69+)
# start it with /system/bin/sh — mksh — and the `set +o standalone` below is a
# special-builtin error there: mksh exits on it, silently (stderr is discarded),
# and the Action screen sits black with no output at all. Everything below is
# prefers ash, so re-exec once per process under the first busybox we find.
# A boolean AS_ASH survives the native lock helper's NEW `sh` process and used
# to bypass this hop there. Compare the current PID, which survives exec only.
# With no busybox at all we stay put and only flip standalone if this shell
# knows the option.
if [ "${AS_ASH:-}" != "$$" ]; then
    for bb in /data/adb/magisk/busybox /data/adb/ksu/bin/busybox /data/adb/ap/bin/busybox \
              /data/adb/modules/busybox-ndk/system/*/busybox; do
        if [ -x "$bb" ]; then
            export AS_ASH="$$"
            exec "$bb" sh "$MODPATH/action.sh" "$@"
        fi
    done
fi
(set +o standalone) 2>/dev/null && set +o standalone
unset ASH_STANDALONE

# Boot auto-press sets AS_FAST=1: all the sleeps below are cosmetic progress
# pacing for the WebUI/terminal, and nothing is watching the output at boot, so
# skip them to reach STRONG as soon as the device is up. Every sleep in this
# script is UI-only (fetches are bounded by `timeout`, not sleep), and the helper
# scripts it calls run in their own `sh` and keep their real retry delays.
if [ "${AS_FAST:-0}" = "1" ]; then
    sleep() { :; }
else
    # Manual WebUI/terminal tap: the per-step sleeps below are only cosmetic
    # progress pacing and add up to ~12s of pure idle between the fast steps.
    # Cap each to a fraction of a second so Action feels responsive. The real
    # fetches are bounded by `timeout`, not sleep, so this never cuts short work.
    sleep() { command sleep 0.2 >/dev/null 2>&1 || :; }
fi

# `action.sh logs` — dump a diagnostic bundle for a GitHub issue and exit.
if [ "$1" = "logs" ] && [ -x "$MODPATH/collect_logs.sh" ]; then
    p=$(sh "$MODPATH/collect_logs.sh")
    echo "log written to: $p"
    exit 0
fi

CONFIG_DIR=${AS_CFG_ROOT:-/data/adb/tricky_store}
# Our own settings/state/logs (one directory, see as_store.sh).
[ -f "$MODPATH/as_store.sh" ] && . "$MODPATH/as_store.sh" && as_init
# Share one lock across manager taps, WebUI, reset and the boot auto-action.
# The inherited native descriptor remains held by the actual worker.
if [ "${AS_ACTION_LOCKED:-0}" != 1 ]; then
    export AS_ACTION_LOCKED=1
    rc=0
    as_lock_run "$AS_TMP/action.flock" 0 sh "$MODPATH/action.sh" "$@" || rc=$?
    [ "$rc" != 75 ] || echo "Action is already running; try again after it finishes."
    exit "$rc"
fi
: "${AS_LOGS:=/data/adb/tricky_store/alwaysstrong/logs}"
mkdir -p "$AS_LOGS" 2>/dev/null
LINE="========================="
VER=$(grep -m1 '^version=' "$MODPATH/module.prop" 2>/dev/null | cut -d= -f2-)
# A non-release build carries its tag in module.prop - v1.0.4 (74-abc1234-nightly)
# - which the manager, the WebUI and a collected log all show. This header is
# three lines on a phone screen, so it keeps the plain version.
VER=${VER%%" ("*}

row() { printf '    %s   %s\n' "$1" "$2"; }
ACTION_ERRORS=0
ACTION_WARNINGS=0
action_error() { ACTION_ERRORS=$((ACTION_ERRORS + 1)); row "❗" "$1"; }
action_warning() { ACTION_WARNINGS=$((ACTION_WARNINGS + 1)); row "⚠️" "$1"; }

# --- ABI + fetchers ---
case "$(uname -m)" in
    aarch64)        ABI=arm64-v8a ;;
    armv7*|armv8l)  ABI=armeabi-v7a ;;
    x86_64)         ABI=x86_64 ;;
    i?86)           ABI=x86 ;;
    *)              ABI="" ;;
esac
ASFETCH=""
[ -n "$ABI" ] && [ -x "$MODPATH/bin/$ABI/asfetch" ] && ASFETCH="$MODPATH/bin/$ABI/asfetch"
BB=""
for bb in /data/adb/magisk/busybox /data/adb/ksu/bin/busybox /data/adb/ap/bin/busybox \
          /data/adb/modules/busybox-ndk/system/*/busybox; do
    [ -x "$bb" ] && BB="$bb" && break
done
# toybox sed (AOSP default) can lack -i on older devices; prefer busybox sed,
# which always supports in-place edits, when we have it.
SED_I="sed -i"
[ -n "$BB" ] && SED_I="$BB sed -i"

# bounded SECS cmd... — run cmd under a hard wall-clock cap. A fetcher that
# never returns (asfetch / wget / curl stuck on a dead route, a hung DNS, a
# TLS stall) used to freeze the whole Action: status_fetch and the first-tap
# keybox fetch called it with no bound at all, so the screen sat after the last
# row with no "done" until the user gave up. Every network step now goes through
# this; the caller falls through to the next engine when the cap trips.
# toybox timeout (Android 10+) and busybox timeout both take -k; -k SIGKILLs a
# command that ignores the SIGTERM, which a `sh` waiting on a child would defer.
TO=""
if timeout -k 1 5 true >/dev/null 2>&1; then TO="timeout -k 3"
elif timeout 5 true >/dev/null 2>&1; then TO="timeout"
elif [ -n "$BB" ] && "$BB" timeout -k 1 5 true >/dev/null 2>&1; then TO="$BB timeout -k 3"
elif [ -n "$BB" ] && "$BB" timeout 5 true >/dev/null 2>&1; then TO="$BB timeout"
fi
bounded() { _bs="$1"; shift; if [ -n "$TO" ]; then $TO "$_bs" "$@"; else "$@"; fi; }
# Caps are set for "definitely dead", never for "slow": each downloader's own
# -T is an IDLE timeout (asfetch, busybox wget, wget) or is paired with a speed
# floor (curl), so a slow link that keeps delivering bytes is never cut off; the
# outer cap only backstops a process that is stuck entirely.

# --- Play Integrity engine adapter ---
# Which prop file the zygisk reads, and what its spoof flags are called, is all
# that differs between the two builds. engine.sh owns it; everything below is
# identical in both.
if [ -f "$MODPATH/engine.sh" ]; then
    . "$MODPATH/engine.sh"
else
    echo "  engine.sh missing — broken install, reflash the module"; exit 1
fi

# asfetch first (connects IPv4-first, works on IPv6-only-DNS networks); fall
# through to busybox wget / curl if it ever fails on a host.
dl_out() {
    if [ -n "$ASFETCH" ]; then bounded 120 $ASFETCH -T 20 "$1" 2>/dev/null && return 0; fi
    if [ -n "$BB" ]; then bounded 120 $BB wget -q -T 20 -O - "$1" 2>/dev/null && return 0; fi
    if command -v curl >/dev/null 2>&1; then bounded 120 curl -fsSL --connect-timeout 15 --speed-limit 1 --speed-time 20 --max-time 110 "$1" 2>/dev/null && return 0; fi
    if command -v wget >/dev/null 2>&1; then bounded 120 wget -q -T 20 -O - "$1" 2>/dev/null && return 0; fi
    return 1
}
dl_to() {
    if [ -n "$ASFETCH" ]; then rm -f "$1"; bounded 600 $ASFETCH -T 60 -o "$1" "$2" 2>/dev/null; [ -s "$1" ] && return 0; fi
    if [ -n "$BB" ]; then rm -f "$1"; bounded 600 $BB wget -q -T 60 -O "$1" "$2" 2>/dev/null; [ -s "$1" ] && return 0; fi
    if command -v curl >/dev/null 2>&1; then rm -f "$1"; bounded 600 curl -fsSL --connect-timeout 15 --speed-limit 1 --speed-time 60 --max-time 590 -o "$1" "$2" 2>/dev/null; [ -s "$1" ] && return 0; fi
    if command -v wget >/dev/null 2>&1; then rm -f "$1"; bounded 600 wget -q -T 60 -O "$1" "$2" 2>/dev/null; [ -s "$1" ] && return 0; fi
    return 1
}

# --- Header ---
# Refuse to run a partly parsed/broken script instead of returning success
# after repeated "function: inaccessible or not found" diagnostics.
for _required in row action_error action_warning bounded as_on st_get st_set engine_enforce_spoof; do
    command -v "$_required" >/dev/null 2>&1 || {
        printf 'Action: required function %s is unavailable\n' "$_required" >&2
        exit 1
    }
done
echo ""
echo "  $LINE"
row "🔒" "AlwaysStrong  ${VER}"
echo "  $LINE"
echo ""

_au=$(sed -n 's/^author=//p' "$MODPATH/module.prop" 2>/dev/null)
case "$_au" in *[Ee]vokerr*) ;; *)
  row "⚠️" "UNOFFICIAL BUILD"
  row "⚠️" "Original author removed."
  row "⚠️" "Official: gitlab.com/Evokerr/AlwaysStrong"
  row "⚠️" "          t.me/keyboxstrong"
  echo ""
;; esac

row "⏳" "initializing..."
sleep 3

# --- Step 1: Target list ---
# `pm list packages` can stall while PackageManager is busy — cap it (an old
# phone with hundreds of apps legitimately takes ~30 s here).
if ! bounded 180 sh "$MODPATH/build_target_txt.sh" "$CONFIG_DIR/target.txt" >/dev/null 2>&1; then
    action_error "target list refresh failed; existing list kept"
fi
TGT_N=$(grep -cvE '^[[:space:]]*$' "$CONFIG_DIR/target.txt" 2>/dev/null)
row "🎯" "${TGT_N:-0} apps > target"
sleep 1

# --- Step 2: Keybox ---
# Custom-keybox mode (WebUI toggle): user supplied their own keybox, so we do
# NOT fetch/overwrite it. Keep the note short.
if as_on custom_keybox; then
    if sh "$MODPATH/keybox_manage.sh" check >/dev/null 2>&1; then
        row "🔑" "custom keybox — skip fetch"
        row "💡" "disable in webui for auto"
    else
        action_error "custom keybox not set or invalid"
    fi
elif [ -x "$MODPATH/keybox_fetch.sh" ]; then
    # "keybox ok" used to mean "a keybox-looking file exists" — but a fresh
    # install seeds the upstream demo keybox (public, never STRONG) just so the
    # engine has a file, so with no internet the very first tap said "ok" over a
    # keybox that cannot work. Now the mirror is the judge: ask it every tap.
    #
    # 1. Quick reachability probe (ICMP, then DNS for networks that drop ping):
    #    offline is reported as offline, with no fetch attempt — keybox_fetch's
    #    four downloaders would otherwise spend up to ~80 s of idle timeouts.
    # 2. Online: run the fetch synchronously (bounded — an unbounded fetch here
    #    is what left the Action on a blank screen). Its exit code is the verdict:
    #    0 = new keybox written, 2 = the file on disk IS what the mirror serves,
    #    1 = the mirror could not be reached / rejected the payload.
    row "🔑" "checking keybox..."
    net_ok() {
        bounded 4 ping -c1 -W2 1.1.1.1 >/dev/null 2>&1 && return 0
        bounded 4 ping -c1 -W2 8.8.8.8 >/dev/null 2>&1 && return 0
        _h=$(echo "${KEYBOX_BASE_URL:-http://evoker.qzz.io}" | sed -e 's#^[a-z]*://##' -e 's#/.*##' -e 's#:.*##')
        [ -n "$BB" ] && bounded 5 "$BB" nslookup "$_h" >/dev/null 2>&1 && return 0
        return 1
    }
    if ! net_ok; then
        if sh "$MODPATH/keybox_manage.sh" check >/dev/null 2>&1; then
            action_warning "no internet — current keybox kept"
        else
            action_error "no internet — no valid keybox available"
        fi
        row "🌐" "connect and tap again (or hourly)"
    else
        bounded 400 sh "$MODPATH/keybox_fetch.sh" >/dev/null 2>&1
        case "$?" in
            0) row "🔑" "keybox updated" ;;
            2) row "🔑" "keybox ok" ;;
            *) if sh "$MODPATH/keybox_manage.sh" check >/dev/null 2>&1; then
                   action_warning "keybox fetch failed"
                   row "🌐" "server unreachable — kept current, retried hourly"
               else
                   action_error "keybox fetch failed"
                   row "🌐" "server unreachable — no keybox yet"
               fi ;;
        esac
    fi
else
    action_error "keybox fetch not available"
fi
sleep 1

if [ "$ENGINE" = "none" ]; then
# PIF-less "Lite" line: no fingerprint spoof of our own. If the user runs a
# standalone PlayIntegrityFork, sync its fingerprint into the attested identity and
# re-assert the STRONG spoof flags it resets; otherwise it's attestation + keybox only.
# lite_pif_sync identifies the standalone module (only real PlayIntegrityFork /
# PlayIntegrityFix inject-s qualify — an id-squatting keystore toolkit is left
# alone) and prints the kind. Report exactly what it synced, or fall back to the
# plain PIF-less message.
# On Lite the standalone PIF owns the fingerprint (AlwaysStrong only mirrors it into
# the attested identity), so point the user at that module's own WebUI to change it.
_synced=$(bounded 180 sh "$MODPATH/lite_pif_sync.sh" 2>/dev/null)
case "$_synced" in
    "OK fork")   row "🔗" "synced with PlayIntegrityFork"
                 row "🔧" "set fingerprint in Fork's WebUI" ;;
    "OK inject") row "🔗" "synced with PlayIntegrityFix (inject)"
                 row "🔧" "set fingerprint in inject's WebUI" ;;
    *)           row "🚫" "PIF-less build"
                 row "🔒" "attestation + keybox only" ;;
esac
sleep 1
else
# --- Step 3: Fingerprint ---
# Three sources, tried in order: our native crawl, upstream's own fetcher, then
# the two shipped static props. Each hands its result to the engine adapter, so
# whichever lands ends up in the file this build's zygisk reads, with that
# engine's STRONG flags applied. A failed primary shows once as "trying with
# fallback".
if as_on custom_pif; then
# User imported their own fingerprint (Advanced > Import) — the pif counterpart
# of a custom keybox. Do NOT fetch/overwrite it; just report which pif is loaded.
# The patch (Step 4) and model (Step 5) rows below still read it via pick_pif.
_pn=$(st_get pif_name 2>/dev/null)
_pm=$(st_get pif_model 2>/dev/null)
row "🧬" "custom pif — skip fetch"
[ -n "$_pm" ] && row "📱" "$_pm"
[ -n "$_pn" ] && row "📄" "$_pn"
row "💡" "enable fingerprint in webui for auto"
else
FP_OK=0
FP_SRC=""

# apply_pif SRC.prop — hand a fingerprint prop to the engine adapter, which
# knows where its own zygisk reads from and which spoof-flag names it wants.
apply_pif() { engine_install_pif "$1"; }

# 1. native crawl (PRIMARY) — the same Google servers upstream uses, driven
#    through asfetch. The multi-page crawl runs ~20-25s on a cold network, so a
#    tight bound just forces the fallback on every tap. Gate on the EXIT CODE:
#    it is 0 only when the engine accepted a fresh fingerprint — a stale file
#    must not count as success.
row "🌐" "fetching fingerprint..."
if [ -x "$MODPATH/pif_native_fetch.sh" ]; then
    bounded "$ENGINE_NATIVE_TIMEOUT" sh "$MODPATH/pif_native_fetch.sh" \
        >"$AS_LOGS/autopif.log" 2>&1 && FP_OK=1
    [ "$FP_OK" = 1 ] && FP_SRC="native"
fi

if [ "$FP_OK" = 0 ]; then
    row "🔄" "trying with fallback"
    sleep 1

    # 2. upstream's own fetcher (FALLBACK), whichever engine is installed.
    #    Bounded so its crawl can't freeze the Action. `timeout` takes a command,
    #    not a shell function, so this re-enters a subshell — and the engine
    #    functions read $MODPATH / $CONFIG_DIR / $SED_I, which are plain shell
    #    variables here. They have to go through the environment; without the
    #    prefix the subshell sees them empty and the fallback never runs.
    MODPATH="$MODPATH" CONFIG_DIR="$CONFIG_DIR" SED_I="$SED_I" \
        bounded "$ENGINE_AUTOPIF_TIMEOUT" \
        sh -c '. "$MODPATH/engine.sh"; engine_autopif' \
        >>"$AS_LOGS/autopif.log" 2>&1 && FP_OK=1
    [ "$FP_OK" = 1 ] && FP_SRC="pif"

    # 3. shipped static props (alternate 2 each tap) — installed through the
    #    engine adapter like the fetched ones, so they land in the right file.
    if [ "$FP_OK" = 0 ]; then
        IDX=$(st_get fp_idx)
        if [ "$IDX" = "2" ]; then IDX=1; else IDX=2; fi
        st_set fp_idx "$IDX"

        FB="$MODPATH/pif_fallback_${IDX}.prop"
        if [ -s "$FB" ] && grep -q "FINGERPRINT=" "$FB" && apply_pif "$FB"; then
            cp -f "$FB" "$CONFIG_DIR/pif.prop" 2>/dev/null
            FP_OK=1; FP_SRC="local"
        fi
    fi
fi

case "$FP_SRC" in
    pif|native) row "🌐" "fingerprint ok" ;;
    local)      row "🌐" "fingerprint ok (local)" ;;
    *)          action_error "fingerprint failed" ;;
esac
fi
sleep 1

# --- Step 4: Spoof settings + security patch ---
# Re-enforced even when the fetch above already did it: a user or an upstream
# script can edit the prop between taps.
engine_enforce_spoof || action_error "engine settings could not be applied"

# Reapply the same session-only policy on a manual refresh. No partition writes.
if [ -f "$MODPATH/boot_props.sh" ]; then
    bounded 8 sh "$MODPATH/boot_props.sh" apply > "$AS_LOGS/boot-props.log" 2>&1 || \
        action_error "boot property policy incomplete; see logs"
fi
if [ -f "$MODPATH/denylist.sh" ]; then
    bounded 15 sh "$MODPATH/denylist.sh" > "$AS_LOGS/denylist.log" 2>&1 || :
fi

PATCH=""
if [ -f "$MODPATH/sync_patch.sh" ]; then
    PATCH=$(sh "$MODPATH/sync_patch.sh" boot 2>/dev/null) || action_error "security patch sync failed"
fi

pick_pif() {
    # Module dir first: it holds the engine's ACTIVE pif for every source (auto,
    # beta, Import). $CONFIG_DIR/pif.prop is only the last auto-fetch and is stale
    # after an Import / beta pick, so it must not shadow the module-dir file.
    for f in "$MODPATH/custom.pif.prop" "$MODPATH/pif.prop" \
             "$CONFIG_DIR/custom.pif.prop" "$CONFIG_DIR/pif.prop"; do
        [ -s "$f" ] && { echo "$f"; return 0; }
    done
    return 1
}
PIF=$(pick_pif)
# Device identity straight from the pif: brand + model, e.g. "Google Pixel 6a"
# (skip the manufacturer when the model already starts with it).
MD=$(grep -m1 '^MODEL=' "$PIF" 2>/dev/null | cut -d= -f2-)
MAN=$(grep -m1 '^MANUFACTURER=' "$PIF" 2>/dev/null | cut -d= -f2-)
case "$MD" in "$MAN "*|"$MAN"|'') ;; *) [ -n "$MAN" ] && MD="$MAN $MD" ;; esac
[ -z "$PATCH" ] && PATCH=$(grep -m1 '^SECURITY_PATCH=' "$PIF" 2>/dev/null | cut -d= -f2-)

row "📅" "${PATCH:-unknown}"
sleep 1

# --- Step 5: Device ---
# custom-pif already printed the device in Step 3, so don't repeat it here.
as_on custom_pif || row "📱" "${MD:-unknown}"
sleep 1
fi

# --- Restart PI + status ---
killall -9 com.google.android.gms.unstable 2>/dev/null
killall -9 com.android.vending 2>/dev/null
bounded 45 am force-stop com.android.vending >/dev/null 2>&1 || \
    action_warning "Play Store could not be stopped; restart it manually"

# Status indicator — network again, and it runs right before "done": this is
# the call that froze the Action for good whenever asfetch hung.
if [ -x "$MODPATH/status_fetch.sh" ]; then
    MODPATH="$MODPATH" bounded 150 sh "$MODPATH/status_fetch.sh" manual >/dev/null 2>&1 || \
        action_warning "status refresh failed; see logs"
fi

# WebUI hosts are installed explicitly by the user.

# --- Done ---
echo "  $LINE"
ACTION_RC=0
if [ "$ACTION_ERRORS" -gt 0 ]; then
    row "❗" "finished with $ACTION_ERRORS error(s); review the log"
    ACTION_RC=1
elif [ "$ACTION_WARNINGS" -gt 0 ]; then
    row "⚠️" "finished with $ACTION_WARNINGS warning(s); review the log"
    ACTION_RC=2
else
    row "✅" "done"
fi
echo "  $LINE"
echo ""
row "📣" "@alwaysstrongfork"
row "👤" "@evokerr"
row "👤" "@SUKISU_ULTR4"
echo "  $LINE"
echo ""

if { [ "$KSU" = "true" ] || [ "$APATCH" = "true" ]; } \
   && [ "$KSU_NEXT" != "true" ] && [ "$WKSU" != "true" ] && [ "$MMRL" != "true" ]; then
    sleep 2
fi
exit "$ACTION_RC"
