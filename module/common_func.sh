# Shared helper functions for AlwaysStrong module scripts.
# Adapted from PlayIntegrityFork's common_func.sh (osm0sis, chiteroman, Displax).

SKIPDELPROP=false
[ -f "$MODPATH/skipdelprop" ] && SKIPDELPROP=true

# delprop_if_exist <prop name>
delprop_if_exist() {
    local NAME="$1"
    [ -n "$(resetprop "$NAME")" ] && resetprop --delete "$NAME"
}

SKIPPERSISTPROP=false
[ -f "$MODPATH/skippersistprop" ] && SKIPPERSISTPROP=true

# persistprop <prop name> <new value>
persistprop() {
    local NAME="$1"
    local NEWVALUE="$2"
    # Session-only changes: disabling the module and rebooting restores ROM
    # defaults without rewriting persistent property storage or uninstall.sh.
    resetprop -n "$NAME" "$NEWVALUE"
}

# Supported root managers provide resetprop -n. Never patch property-area
# bytes with dd: an offset inferred from strings is not a safe write target.
RESETPROP="resetprop -n"

# resetprop_if_diff <prop name> <expected value>
resetprop_if_diff() {
    local NAME="$1"
    local EXPECTED="$2"
    local CURRENT
    CURRENT="$(resetprop "$NAME")"
    [ -z "$CURRENT" ] || [ "$CURRENT" = "$EXPECTED" ] || $RESETPROP "$NAME" "$EXPECTED"
}

# resetprop_if_match <prop name> <value match string> <new value>
resetprop_if_match() {
    local NAME="$1"
    local CONTAINS="$2"
    local VALUE="$3"
    [[ "$(resetprop "$NAME")" = *"$CONTAINS"* ]] && $RESETPROP "$NAME" "$VALUE"
}

# stub for boot-time
if [ "$(getprop sys.boot_completed)" != "1" ]; then
    ui_print() { return; }
fi

# --- Download helpers (needed by inject-s autopif.sh) --------------------
# Merged from PlayIntegrityFix v4.7-inject-s common_func.sh. inject-s's
# autopif.sh sources OUR common_func.sh (path-patched), so these must exist.
sleep_pause() {
    # APatch and KernelSU need this, but not KSU_NEXT / MMRL
    if [ -z "$MMRL" ] && [ -z "$KSU_NEXT" ] && { [ "$KSU" = "true" ] || [ "$APATCH" = "true" ]; }; then
        sleep 5
    fi
}

download_fail() {
    dl_domain=$(echo "$1" | awk -F[/:] '{print $4}')
    rm -rf "$TEMPDIR"
    ping -c 1 -W 5 "$dl_domain" > /dev/null 2>&1 || {
        echo "[!] Unable to connect to $dl_domain, check your internet connection and try again"
        sleep_pause
        exit 1
    }
    conflict_module=$(ls /data/adb/modules | grep busybox)
    for i in $conflict_module; do
        echo "[!] Please remove $i and try again."
    done
    echo "[!] download failed!"
    echo "[x] bailing out!"
    sleep_pause
    exit 1
}

download() { busybox wget -T 10 --no-check-certificate -qO - "$1" > "$2" || download_fail "$1"; }
if command -v curl > /dev/null 2>&1; then
    download() { curl --connect-timeout 10 -s "$1" > "$2" || download_fail "$1"; }
fi
