#!/system/bin/sh
# Attestation-engine adapter — TEESimulator (JingMatrix, --engine teesim).
#
# The ORIGINAL TEESimulator: a Kotlin control daemon (launched via app_process)
# plus a native KeyMint/keystore interceptor injected into keystore2. Unlike
# TEESimulator-RS and TrickyStoreOSS it does NOT read /data/adb/tricky_store/ —
# it has its own /data/adb/teesim/config.json. This adapter bridges the two: it
# seeds that config, points TEESimulator's keybox at the AlwaysStrong-managed one
# (so the auto keybox fetch feeds it), and regenerates the config's target-app
# list from /data/adb/tricky_store/target.txt.
#
# 64-bit only (the interceptor is a 64-bit lib injected into the 64-bit keystore2).
# build.sh stages the whole payload under $MODPATH/teesim/:
#   teesim/classes.dex, teesim/config.default.json, teesim/<abi>/{inject,libteesim_*.so,teesim-uds}
#
# build.sh copies this file in as attest.sh. customize.sh sources it for
# attest_install (with $ABI_DIR / $ARCH / $ZIPFILE / $MODPATH + install_file() /
# ui_print() in scope); service.sh sources it for attest_early / attest_start /
# attest_alive / teesim_gen_config (with $MODDIR in scope); keybox_fetch.sh and
# build_target_txt.sh source it for attest_notify (with $MODPATH in scope).

ATTEST=teesim
ATTEST_NAME="TEESimulator (JingMatrix)"
TEESIM_DATA=/data/adb/teesim

# keystore2 injection happens at the service stage, before sys.boot_completed —
# a late start misses the injection window. service.sh honours attest_early.
attest_early() { return 0; }

# Regenerate /data/adb/teesim/config.json from the AlwaysStrong target list.
# The JSON shape mirrors the upstream config.default.json exactly (a known-valid
# schema) with only the "apps" array swapped for the current target.txt, so the
# per-app targeting picked in the WebUI reaches TEESimulator too. Called at boot
# (attest_start), hourly (service.sh) and through attest_notify whenever
# keybox.xml or target.txt is rewritten.
#
# Rewriting config.json is also how the daemon learns about a NEW KEYBOX: its
# FileObserver only watches /data/adb/teesim for config.json / *.xml events, and
# our keybox.xml there is a symlink into /data/adb/tricky_store — inotify never
# reports a write to a symlink's target. The daemon re-reads the keybox bytes on
# every config push, so a fresh config.json is enough to make it pick the new
# keybox up (and to recover from the first-boot "keybox not found" state, where
# it keeps running on no config until one loads).
teesim_gen_config() {
    _tgt=/data/adb/tricky_store/target.txt
    _cfg="$TEESIM_DATA/config.json"
    mkdir -p "$TEESIM_DATA" 2>/dev/null
    _md="${MODDIR:-$MODPATH}"

    # --- device identity: mirror the PIF-spoofed fingerprint --------------
    # CRITICAL for a fork/inject line: PIF spoofs android.os.Build to a Pixel,
    # so TEESimulator's attestation must report the SAME Pixel. Left blank, its
    # KeyMint fields harvest the REAL device, and Play Integrity fails because the
    # attested device (real) mismatches the Build device (Pixel). We copy the
    # brand/model/device/product/manufacturer and the security patch out of the
    # active pif. (No pif — a nopif/Lite line — leaves them blank, which is
    # correct: nothing spoofs Build there, so attesting the real device matches.)
    _pif=""
    for _f in "$_md/custom.pif.prop" /data/adb/tricky_store/custom.pif.prop "$_md/pif.prop" /data/adb/tricky_store/pif.prop; do
        [ -s "$_f" ] && grep -q '^FINGERPRINT=' "$_f" && { _pif="$_f"; break; }
    done
    _pget() { [ -n "$_pif" ] && sed -n "s/^$1=//p" "$_pif" | head -1 | tr -d '\r"'; }
    _fp=$(_pget FINGERPRINT)
    _brand=$(_pget BRAND);   [ -z "$_brand" ] && [ -n "$_fp" ] && _brand=$(printf '%s' "$_fp" | cut -d/ -f1)
    _manu=$(_pget MANUFACTURER)
    _model=$(_pget MODEL)
    _device=$(_pget DEVICE)
    _product=$(_pget PRODUCT)
    _patch=$(_pget SECURITY_PATCH)
    # The attested patch is the fingerprint's own SECURITY_PATCH, stamped on all
    # three partitions — NOT bumped to the current month (that would mismatch the
    # Pixel fingerprint and drop STRONG), and matching what sync_patch.sh writes
    # to the ro.*.security_patch props. The upstream "today"/"YYYY-MM-05" tokens
    # are only a fallback when the pif carries no valid SECURITY_PATCH.
    [ -f "$_md/patch_resolve.sh" ] && . "$_md/patch_resolve.sh"
    case "$_patch" in
        [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]) _sys="$_patch" ;;
        *) _sys="today" ;;
    esac
    # Per-partition manual overrides from the WebUI (System/Vendor/Boot, empty =
    # the fingerprint date _sys). Lets the user set e.g. an older vendor patch
    # deliberately; with nothing set all three stay identical.
    _psys="$_sys"; _pven="$_sys"; _pboot="$_sys"
    if command -v pr_partition >/dev/null 2>&1 && command -v as_get >/dev/null 2>&1; then
        _psys=$(pr_partition "$(as_get patch_system)" "$_sys")
        _pven=$(pr_partition "$(as_get patch_vendor)" "$_sys")
        _pboot=$(pr_partition "$(as_get patch_boot)" "$_sys")
    fi

    # --- target apps from target.txt --------------------------------------
    # target.txt is TrickyStore's format, NOT TEESimulator's. It carries syntax
    # teesim rejects: a trailing "!" (force-generate) or "?" (leaf-hack) on a
    # package, and "[keybox.xml]" marker lines that select a per-app keybox and are
    # not package ids at all. TEESimulator's schema only accepts package,
    # package@user, or uid:N (APP_ENTRY_RE) — an unparseable entry silently drops
    # its target, which is exactly why GMS attestation used to fall through to the
    # real HAL. Sanitise every line and emit only valid entries.
    _apps=""
    _add_app() {   # de-dup, then append one already-validated entry
        case "$_apps" in *"\"$1\","*) return ;; esac
        _apps="$_apps      \"$1\",
"
    }
    if [ -f "$_tgt" ]; then
        while IFS= read -r _line || [ -n "$_line" ]; do
            _line=$(printf '%s' "$_line" | tr -d ' \t\r')
            case "$_line" in ''|'#'*|'['*) continue ;; esac   # blanks, comments, [keybox] markers
            _line=${_line%!}; _line=${_line%\?}               # strip TrickyStore force/leaf suffix
            case "$_line" in *.*) : ;; *) continue ;; esac    # must look like a package id
            # keep only package | package@user (schema APP_ENTRY_RE)
            _valid=$(printf '%s' "$_line" | grep -oE '^[A-Za-z0-9_.]+(@[0-9]+)?$')
            [ -n "$_valid" ] && _add_app "$_valid"
        done < "$_tgt"
    fi
    # Always cover the Play Integrity core AND pin their real uids. Package-name
    # targeting alone can miss GMS/DroidGuard (multi-user, shared uid, resolution
    # timing at boot); a raw uid:N token bypasses name resolution and is what makes
    # the interceptor actually claim GMS's generateKey instead of forwarding it to
    # the real HAL. packages.list is root-readable and needs no system_server, so
    # it resolves even at the early boot stage.
    for _p in com.google.android.gms com.android.vending com.google.android.gsf; do
        _add_app "$_p"
        _u=$(sed -n "s/^$_p \([0-9][0-9]*\) .*/\1/p" /data/system/packages.list 2>/dev/null | head -1)
        case "$_u" in [0-9]*) _add_app "uid:$_u" ;; esac
    done
    _apps=$(printf '%s' "$_apps" | sed '$ s/,$//')   # drop the trailing comma

    # --- root of trust: force a locked/Verified boot with a non-zero key+hash --
    # TEESimulator attests the device's REAL harvested root of trust: it derives
    # verifiedBootKey from ro.boot.vbmeta.public_key_digest and verifiedBootHash
    # from ro.boot.vbmeta.digest, and reads the lock state off the real TEE key.
    # On an UNLOCKED bootloader all of those are zero/false, so it attests a zeroed
    # ORANGE root of trust and Play Integrity never reaches STRONG. That is exactly
    # the "bootloader unlock status, verifiedBootKey and verifiedBootHash all zero"
    # report. Unlike TEESimulator-RS / TrickyStoreOSS the daemon does NOT trust the
    # ro.boot.* lock props we pin in service.sh, and once it has harvested a key it
    # PERSISTS that key ("KEK stability"), so pinning a prop afterwards can't undo an
    # already-zero harvest. Its own fix for this is the override layer at
    # overrides.json, which is merged on top of the harvest and always wins; that is
    # the file the stock WebUI writes when a user edits an all-zero boot key/hash.
    # AlwaysStrong ships its own WebUI, so we populate it here.
    _ov="$TEESIM_DATA/overrides.json"
    _hex64() {   # 64 lowercase hex chars, not all zero
        case "$1" in ''|*[!0-9a-f]*) return 1 ;; esac
        [ "${#1}" -eq 64 ] || return 1
        case "$1" in *[!0]*) return 0 ;; *) return 1 ;; esac
    }
    _clean() { printf '%s' "$1" | tr 'A-F' 'a-f' | tr -d ' \t\r\n:'; }

    # verifiedBootHash: the same deterministic ro.boot.vbmeta.digest service.sh pins
    # (recovered from the cached boot_hash when the live prop is still zero early in
    # boot). Omitted when not yet resolvable -- the daemon then computes the vbmeta
    # digest from the partitions itself, which is non-zero.
    _vbh=""
    command -v resetprop >/dev/null 2>&1 && _vbh=$(_clean "$(resetprop ro.boot.vbmeta.digest 2>/dev/null)")
    _hex64 "$_vbh" || _vbh=""
    if [ -z "$_vbh" ] && command -v st_get >/dev/null 2>&1; then
        _c=$(_clean "$(st_get boot_hash)"); _hex64 "$_c" && _vbh="$_c"
    fi

    # verifiedBootKey: a locked GREEN boot carries a real key digest, never zeros.
    # Keep a genuine non-zero public_key_digest if the bootloader already reports one
    # (a really-locked device); otherwise derive a device-stable value from the active
    # fingerprint and cache it so it never changes across boots (KEK stability). Play
    # does not verify this value against a known OEM key -- it only has to be present,
    # 32 bytes and consistent -- so a stable synthetic digest is sufficient for STRONG.
    _vbk=""
    command -v st_get >/dev/null 2>&1 && _vbk=$(_clean "$(st_get teesim_vbk)")
    _hex64 "$_vbk" || _vbk=""
    if [ -z "$_vbk" ] && command -v resetprop >/dev/null 2>&1; then
        _p=$(_clean "$(resetprop ro.boot.vbmeta.public_key_digest 2>/dev/null)")
        _hex64 "$_p" && _vbk="$_p"
    fi
    if [ -z "$_vbk" ]; then
        _seed="$_fp"; [ -n "$_seed" ] || _seed="${_model}${_device}"; [ -n "$_seed" ] || _seed="alwaysstrong-teesim"
        _vbk=$(printf 'AlwaysStrong-vbk:%s' "$_seed" | sha256sum 2>/dev/null | cut -c1-64)
        _vbk=$(_clean "$_vbk"); _hex64 "$_vbk" || _vbk=""
    fi
    [ -n "$_vbk" ] && command -v st_set >/dev/null 2>&1 && st_set teesim_vbk "$_vbk"

    # Pin ro.boot.vbmeta.public_key_digest to the same value so a FUTURE harvest (and
    # the other engines that read the prop) see a non-zero key too. Only when it would
    # change, so a device that already carries a genuine digest keeps it.
    if [ -n "$_vbk" ] && command -v resetprop >/dev/null 2>&1; then
        [ "$(_clean "$(resetprop ro.boot.vbmeta.public_key_digest 2>/dev/null)")" = "$_vbk" ] ||
            resetprop -n ro.boot.vbmeta.public_key_digest "$_vbk" 2>/dev/null
    fi

    # Write overrides.json: force Verified(0) + locked, and supply the non-zero
    # key/hash. deviceLocked / verifiedBootState are the daemon's own forced fields
    # (it ignores them here if it force-sets them already); the key and hash are the
    # editable override it exists for. Written atomically so the daemon's data-dir
    # watcher re-merges and re-pushes cleanly.
    mkdir -p "$TEESIM_DATA" 2>/dev/null
    {
        printf '{\n'
        printf '  "deviceLocked": true,\n'
        printf '  "verifiedBootState": 0'
        [ -n "$_vbk" ] && printf ',\n  "verifiedBootKey": "%s"' "$_vbk"
        [ -n "$_vbh" ] && printf ',\n  "verifiedBootHash": "%s"' "$_vbh"
        printf '\n}\n'
    } > "$_ov.tmp" 2>/dev/null && mv -f "$_ov.tmp" "$_ov" 2>/dev/null
    chmod 0600 "$_ov" 2>/dev/null

    # mode=generation: mint the whole key in software under the keybox. "patch"
    # keeps the real hardware key and only re-signs its attestation — fewer
    # detection points, but it needs a working hardware KeyMint level. Many custom
    # ROMs (and this repo's target audience) run devices whose real TEE keystore is
    # unreachable (keystore2 reports HARDWARE_TYPE_UNAVAILABLE); there, patch has no
    # base key to re-sign and falls through to the real HAL → BASIC. generation
    # always works and still yields a hardware-backed chain (the keybox is the root).
    cat > "$_cfg" <<EOF
{
  "version": 1,
  "profiles": {
    "default": {
      "keybox": "keybox.xml",
      "mode": "generation",
      "patchLevel": { "system": "$_psys", "vendor": "$_pven", "boot": "$_pboot" },
      "osVersion": "harvested",
      "brand": "$_brand",
      "device": "$_device",
      "product": "$_product",
      "manufacturer": "$_manu",
      "model": "$_model",
      "serial": "",
      "imei": "",
      "meid": "",
      "imei2": "",
      "apps": [
$_apps
      ]
    }
  }
}
EOF
    chmod 0600 "$_cfg" 2>/dev/null
}

attest_install() {
    # 64-bit only — the interceptor is injected into the 64-bit keystore2.
    case "$ARCH" in
        arm64|x64) : ;;
        *) ui_print "⚠️ TEESimulator (JingMatrix) is 64-bit only — $ARCH can't run it"
           ui_print "⚠️ use a -tee or -TSOSS build on this device"
           return 0 ;;
    esac
    # Stage the whole teesim/ payload from the flashed zip.
    unzip -qqo "$ZIPFILE" 'teesim/*' -d "$MODPATH" 2>/dev/null
    # Keep only this device's ABI; other ABIs' ~28 MB of libs are dead weight.
    for _abi in arm64-v8a x86_64; do
        [ "$_abi" = "$ABI_DIR" ] || rm -rf "$MODPATH/teesim/$_abi" 2>/dev/null
    done
    chmod -R 0755 "$MODPATH/teesim" 2>/dev/null

    # The release zip ships arm64-v8a only. On x86_64 there is no payload to run.
    if [ ! -f "$MODPATH/teesim/$ABI_DIR/inject" ]; then
        ui_print "⚠️ no TEESimulator (JingMatrix) payload for $ABI_DIR"
        ui_print "⚠️ this build is arm64-v8a only — use a -tee or -TSOSS build here"
        return 0
    fi

    # Seed the config dir. Point TEESimulator's keybox at the AlwaysStrong-managed
    # one so the automatic keybox fetch feeds this engine; write the initial config
    # from the current target list.
    mkdir -p "$TEESIM_DATA"
    ln -sf /data/adb/tricky_store/keybox.xml "$TEESIM_DATA/keybox.xml" 2>/dev/null
    teesim_gen_config
    ui_print "TEESimulator (JingMatrix) installed ($ABI_DIR)"
}

# app_process control daemon, respawned if it exits. Idempotent via a loop-pid
# marker so the early start and the watchdog don't stack parallel daemons (they
# would fight over the keystore2 injection). The App's argv[0] is the home dir
# where its inject binary + native libs live ($MODDIR/teesim).
attest_start() {
    teesim_gen_config
    [ -f "$MODDIR/teesim/classes.dex" ] || return 1
    sh "$MODDIR/attest_supervise.sh" teesim > "$AS_LOGS/attest-supervisor.log" 2>&1 &
    return 0
}

# The App renames its own process to "TEESimulator" (overriding app_process's
# --nice-name=teesim), so match on the class-path argv instead of a fixed name.
attest_alive() { pgrep -f 'org.matrix.teesim.App' >/dev/null 2>&1 || pidof teesim >/dev/null 2>&1; }

# keybox.xml / target.txt changed: push a fresh config so the daemon re-reads
# both (see teesim_gen_config for why the keybox needs this).
attest_notify() { teesim_gen_config; }
