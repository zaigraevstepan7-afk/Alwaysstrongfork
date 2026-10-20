#!/system/bin/sh
# AlwaysStrong — keybox auto-fetch.
#
# Downloads a base64-encoded keybox from the project's keybox mirror
# ($BASE_URL/key), hashes the downloaded bytes locally to detect whether
# anything changed since the last apply, decodes, validates that the payload
# looks like a keybox, then atomically replaces the target file. Override the
# source endpoint with the KEYBOX_BASE_URL env var.
#
# Exit codes:
#   0  keybox updated (new content written)
#   2  no change (already up to date)
#   1  fetch / verify failed (existing keybox preserved)

BASE_URL="${KEYBOX_BASE_URL:-https://evoker.qzz.io}"
KEY_URL="$BASE_URL/key"

CONFIG_DIR=${AS_CFG_ROOT:-/data/adb/tricky_store}
TARGET="$CONFIG_DIR/keybox.xml"
MODPATH="${MODPATH:-/data/adb/modules/tricky_store}"
export AS_CFG_ROOT="$CONFIG_DIR"

log() { echo "keybox_fetch: $*"; }

# The custom-keybox switch lives in the store, and without it we cannot tell
# whether the user manages keybox.xml themselves - guessing wrong overwrites
# their file, so this fails closed rather than fetching blind.
if [ -f "$MODPATH/as_store.sh" ]; then
    . "$MODPATH/as_store.sh"
else
    log "as_store.sh missing - refusing to touch the keybox."
    exit 1
fi

# Custom-keybox mode: the user manages keybox.xml themselves via the WebUI —
# never fetch or overwrite it. (Defensive; action.sh/service.sh also gate on this.)
if as_on custom_keybox && [ "${AS_REPAIR_FETCH:-0}" != 1 ]; then
    log "custom keybox active — skipping fetch."
    exit 2
fi

if [ -z "$BASE_URL" ]; then
    log "no KEYBOX_BASE_URL configured — skipping."
    exit 1
fi

case "$BASE_URL" in
    https://*) ;;
    *) log "HTTPS endpoint required; current keybox preserved."; exit 1 ;;
esac

# ---- Resolve tools ----
# No single downloader works on every device: busybox wget's built-in TLS
# stalls mid-stream on the keybox mirror CDN on some devices, while our bundled
# rustls fetcher (asfetch) fails to connect on others. So we try each available
# certificate-validating engine in turn (asfetch → curl). Busybox/system wget
# are excluded here because their TLS verification varies across root managers.
SELF_DIR=$(cd "${0%/*}" 2>/dev/null && pwd)
[ -z "$SELF_DIR" ] && SELF_DIR=/data/adb/modules/tricky_store
case "$(uname -m)" in
    aarch64)        ABI=arm64-v8a ;;
    armv7*|armv8l)  ABI=armeabi-v7a ;;
    x86_64)         ABI=x86_64 ;;
    i?86)           ABI=x86 ;;
    *)              ABI="" ;;
esac
ASFETCH="$SELF_DIR/bin/$ABI/asfetch"
BB=""
for bb in /data/adb/ksu/bin/busybox /data/adb/magisk/busybox /data/adb/ap/bin/busybox \
          /data/adb/modules/busybox-ndk/system/*/busybox "$(command -v busybox 2>/dev/null)"; do
    [ -n "$bb" ] && [ -x "$bb" ] && BB="$bb" && break
done

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
# run_engine NAME OUTFILE URL — one download attempt with the named engine.
# Each engine's own -T bounds one idle wait; the outer cap bounds the call.
run_engine() {
    rm -f "$2"
    case "$1" in
        asfetch) [ -n "$ABI" ] && [ -f "$ASFETCH" ] && { [ -x "$ASFETCH" ] || chmod 0755 "$ASFETCH" 2>/dev/null; } && bounded 90 "$ASFETCH" -T 15 -o "$2" "$3" 2>/dev/null ;;
        bb)      [ -n "$BB" ] && bounded 90 "$BB" wget -q -T 20 -O "$2" "$3" 2>/dev/null ;;
        curl)    command -v curl >/dev/null 2>&1 && bounded 90 curl -fsSL --proto =https --proto-redir =https --connect-timeout 15 --speed-limit 1 --speed-time 20 --max-time 85 -o "$2" "$3" 2>/dev/null ;;
        wget)    command -v wget >/dev/null 2>&1 && bounded 90 wget -q -T 20 -O "$2" "$3" 2>/dev/null ;;
    esac
    _download_rc=$?
    [ "$_download_rc" -eq 0 ] && [ -s "$2" ] || return 1
    [ "$(wc -c < "$2")" -le 1048576 ] || return 1
    as_base64_check "$2" || return 1
    $B64DEC < "$2" > "$2.xml" 2>/dev/null || return 1
    TMPDIR="$AS_TMP" sh "$MODPATH/keybox_validate.sh" "$2.xml" >/dev/null 2>&1
}

# try_fetch OUTFILE URL — try each engine until one returns a non-empty file.
# The engine that last worked is remembered (kb_engine in alwaysstrong/state)
# and tried first, so we don't burn a fetcher's full timeout on every call.
try_fetch() {
    _o="$1"; _u="$2"
    _first=$(st_get kb_engine)
    _seen=" "
    for _e in "$_first" asfetch curl; do
        case "$_e" in asfetch|curl) ;; *) continue ;; esac
        case "$_seen" in *" $_e "*) continue ;; esac
        _seen="$_seen$_e "
        if run_engine "$_e" "$_o" "$_u"; then
            [ "$_e" != "$_first" ] && st_set kb_engine "$_e"
            return 0
        fi
    done
    return 1
}

B64DEC=""
if echo dGVzdA== | base64 -d >/dev/null 2>&1; then
    B64DEC="base64 -d"
else
    for bb in /data/adb/magisk/busybox /data/adb/ksu/bin/busybox /data/adb/ap/bin/busybox; do
        if [ -x "$bb" ] && echo dGVzdA== | "$bb" base64 -d >/dev/null 2>&1; then
            B64DEC="$bb base64 -d"; break
        fi
    done
fi
[ -z "$B64DEC" ] && { log "no base64 decoder available."; exit 1; }

# ---- Fetch ----
mkdir -p "$CONFIG_DIR"
TMP=$(as_tmp "keybox.$$")
mkdir -p "$TMP"
trap 'rm -rf "$TMP"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

try_fetch "$TMP/key" "$KEY_URL" || { log "download failed on all engines ($KEY_URL)"; exit 1; }

if [ ! -s "$TMP/key" ]; then
    log "downloaded file is empty."
    exit 1
fi

# Each downloader is accepted only after decoding and completeness validation.
# The manager revalidates under a single-writer lock and saves the last good file.
_rc=0
_mode=auto
if [ "${AS_REPAIR_FETCH:-0}" = 1 ]; then
    as_on auto_repair || exit 2
    # Keep custom mode after a one-off repair, so hourly fetches stay paused.
    if as_on custom_keybox; then _mode=custom; fi
fi
sh "$MODPATH/keybox_manage.sh" install "$TMP/key.xml" "$_mode" downloaded-keybox || _rc=$?
case "$_rc" in
    0) log "$TARGET updated after XML/PEM/DER checks." ;;
    2) log "already up to date or custom mode enabled."; exit 2 ;;
    *) log "replacement rejected; current keybox preserved."; exit 1 ;;
esac

# Tell the attestation engine the keybox changed. TEESimulator-RS and
# TrickyStoreOSS watch this directory themselves; JingMatrix TEESimulator only
# watches /data/adb/teesim, where our keybox is a symlink into here, and inotify
# never sees a write to a symlink's target — its adapter rewrites config.json so
# the daemon re-reads the keybox. No-op on the other engines. Subshell so the
# adapter's variables don't leak into this script.
_md=$(cd "${0%/*}" 2>/dev/null && pwd)
[ -f "$_md/attest.sh" ] || _md=/data/adb/modules/tricky_store
if as_live_config && [ -f "$_md/attest.sh" ]; then
    ( MODPATH="$_md"; . "$_md/attest.sh" 2>/dev/null
      command -v attest_notify >/dev/null 2>&1 && attest_notify ) >/dev/null 2>&1
fi
exit 0
