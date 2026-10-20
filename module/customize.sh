# shellcheck disable=SC2034
SKIPUNZIP=1
MIN_SDK=29
CONFIG_DIR=/data/adb/tricky_store

if [ "$BOOTMODE" != true ]; then
  abort "install from a root manager, not recovery"
fi
if [ "$KSU" = true ] && [ "$KSU_VER_CODE" -lt 10670 ]; then
  abort "please update KernelSU + manager first"
fi

case "$ARCH" in
  arm64) ABI_DIR="arm64-v8a" ;;
  arm)   ABI_DIR="armeabi-v7a" ;;
  x64)   ABI_DIR="x86_64" ;;
  x86)   ABI_DIR="x86" ;;
  *)     abort "unsupported arch: $ARCH" ;;
esac

[ "$API" -lt "$MIN_SDK" ] && abort "needs Android 10+ (SDK $MIN_SDK)"

VERSION=$(grep_prop version "${TMPDIR}/module.prop")
# read the name from module.prop so the -inject build shows "[inject]" here too
NAME=$(grep_prop name "${TMPDIR}/module.prop")
install_file() { unzip -qqjo "$ZIPFILE" "$1" -d "$2" || abort "extract failed: $1"; }

ui_print "${NAME:-AlwaysStrong} $VERSION"
ui_print "Fork by @SUKISU_ULTR4 | upstream: @evokerr"
ui_print ""

_mp_chk=$(grep_prop author "${TMPDIR}/module.prop")
_v_ok=0; case "$_mp_chk" in *[Ee]vokerr*) _v_ok=1 ;; esac
if [ "$_v_ok" = "0" ]; then
  ui_print "⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️"
  ui_print ""
  ui_print "  WARNING: This is NOT an official build."
  ui_print "  The original author (Evokerr) has been"
  ui_print "  removed from module.prop."
  ui_print ""
  ui_print "  Official: gitlab.com/Evokerr/AlwaysStrong"
  ui_print "            t.me/keyboxstrong"
  ui_print ""
  ui_print "  This copy may be outdated or modified."
  ui_print ""
  ui_print "⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️"
  ui_print ""
  sleep 3
  echo "unofficial=1" >> "${TMPDIR}/module.prop"
fi

# --- conflict cleanup ----------------------------------------------------
# Keystore / TEE / target-list / prop modules always conflict with the
# attestation engine. The PIF-family (Build spoof) only conflicts with a line
# that bundles its own PlayIntegrityFork — the PIF-less "Lite" line ships none and
# is meant to run alongside the user's own PIF, so Lite does NOT remove them.
CONFLICT_LIST="tricky_store_v2 TrickyStore \
  tee_simulator TEESimulator TEESimulator-RS \
  safetynet-fix Universal_SafetyNet_Fix \
  MagiskHidePropsConf \
  TA_utl tricky_addon TA_enhanced tsupport-advance \
  Yurikey specter"
case "$NAME" in
  *"[Lite]"*) ui_print "- Lite build — keeping any standalone PlayIntegrityFork" ;;
  *) CONFLICT_LIST="$CONFLICT_LIST playintegrityfix playintegrityfork play_integrity_fix playcurl playcurlNEXT pif_strong pif_force" ;;
esac
CONFLICTS=""
for c in $CONFLICT_LIST; do
  [ ! -d "/data/adb/modules/$c" ] || [ -f "/data/adb/modules/$c/disable" ] || [ -f "/data/adb/modules/$c/remove" ] || CONFLICTS="$CONFLICTS $c"
  [ ! -d "/data/adb/modules_update/$c" ] || [ -f "/data/adb/modules_update/$c/disable" ] || [ -f "/data/adb/modules_update/$c/remove" ] || CONFLICTS="$CONFLICTS $c (pending)"
done
if [ -n "$CONFLICTS" ]; then
  abort "Conflicting modules:$CONFLICTS. Remove the conflict explicitly before installing."
fi

# Root managers stage updates for the next boot. Keep the live engine running
# while validating/extracting the new package; an aborted update must not stop it.

# --- extract our scripts + configs ---------------------------------------
# engine.sh first: it names the upstream files this build's Play Integrity
# engine needs ($ENGINE_FILES). Everything else here is engine-neutral.
install_file "engine.sh" "$MODPATH"
# shellcheck source=/dev/null
. "$MODPATH/engine.sh"

for f in module.prop service.sh post-fs-data.sh action.sh \
         uninstall.sh common_func.sh as_store.sh sepolicy.rule \
         keybox_fetch.sh keybox_validate.sh keybox_validate.awk keybox_manage.sh repair_init.sh repair_runtime.sh verdict_report.sh auto_repair.sh boot_safety.sh boot_prepare.sh attest_supervise.sh build_target_txt.sh status_fetch.sh description.txt \
         rom_spoof_block.sh conflict_scan.sh sync_patch.sh patch_resolve.sh beta_pif.sh \
         denylist.sh boot_props.sh soter_diagnose.sh \
         pif_native_fetch.sh prop_unify.sh logcat_cleanup.sh collect_logs.sh \
         import_pif.sh reapply_spoof.sh reset_defaults.sh \
         pif_fallback_1.prop pif_fallback_2.prop \
         target.txt daemon \
         $ENGINE_FILES ; do
  install_file "$f" "$MODPATH"
done

# lite_pif_sync.sh is only used on the Lite line (ENGINE=none), where the user's
# own standalone PIF provides the fingerprint/spoof flags. The Fork/inject lines
# bundle their own engine and never call it, so it ships in the Lite zip only.
[ "$ENGINE" = none ] && install_file "lite_pif_sync.sh" "$MODPATH"

# module banner shown by the root manager (module.prop -> banner=.../banner.png)
if unzip -l "$ZIPFILE" 2>/dev/null | grep -q "^.*banner\.png"; then
  install_file "banner.png" "$MODPATH"
  chmod 644 "$MODPATH/banner.png" 2>/dev/null
fi

# --- attestation engine (TEESimulator-RS | TrickyStoreOSS) ----------------
# The per-engine install steps live in attest.sh, which build.sh generates from
# attest/<engine>.sh. It runs with $ABI_DIR / $ARCH / $ZIPFILE / $MODPATH and
# install_file() + ui_print() in scope, and installs that engine's binaries.
install_file "attest.sh" "$MODPATH"
# shellcheck source=/dev/null
. "$MODPATH/attest.sh"
attest_install

# --- PIF zygisk + dex ----------------------------------------------------
# Ship whatever ABIs upstream built. PlayIntegrityFork covers all four;
# PlayIntegrityFix inject-s is ARM-only, so on x86 that build has no zygisk to
# install — the TEE half still runs, the Play Integrity spoof can't, and the
# install says so rather than half-working in silence.
#
# A PIF-less "Lite" line (engine.sh sets ENGINE=none) ships no zygisk and no
# classes.dex at all — only the TEE/TSOSS attestation + keybox fetcher. Skip the
# whole Play Integrity install for it.
if [ "$ENGINE" = "none" ]; then
  ui_print "PIF-less build — hardware attestation + keybox only"
  ui_print "no Play Integrity fingerprint spoof in this build"
else
mkdir -p "$MODPATH/zygisk"
ZN=0
for z in arm64-v8a armeabi-v7a x86 x86_64; do
  if unzip -l "$ZIPFILE" 2>/dev/null | grep -q "zygisk/$z.so"; then
    unzip -qqjo "$ZIPFILE" "zygisk/$z.so" -d "$MODPATH/zygisk" 2>/dev/null
    ZN=$((ZN+1))
  fi
done
install_file "classes.dex" "$MODPATH"

HAS_ZYGISK_SO=0
[ -f "$MODPATH/zygisk/$ABI_DIR.so" ] && HAS_ZYGISK_SO=1

if [ $HAS_ZYGISK_SO -eq 0 ]; then
  ui_print "⚠️ no PIF zygisk for $ABI_DIR ($ENGINE_NAME is ARM-only)"
  ui_print "⚠️ TEE works, Play Integrity spoof won't"
  ui_print "⚠️ use the default build for $ABI_DIR"
# --- Zygisk provider check — PIF's zygisk needs a Zygisk host --------------
# The common silent-failure setup is Zygisk-less KernelSU: KSU has NO built-in
# Zygisk, so without ZygiskNext / ReZygisk the PIF spoof never loads and STRONG
# quietly fails. Magisk / APatch ship (or host) Zygisk themselves. Warn only on
# the real footgun to avoid false alarms.
elif { [ "$KSU" = "true" ] || [ "$APATCH" = "true" ]; } \
     && [ ! -d /data/adb/modules/zygisksu ] && [ ! -d /data/adb/modules/rezygisk ] \
     && [ ! -d /data/adb/modules/neozygisk ]; then
  ui_print "⚠️ Root manager without Zygisk Next / ReZygisk / NeoZygisk"
  ui_print "⚠️ install one or PIF spoof won't load (no STRONG)"
else
  ui_print "zygisk found"
fi
fi

# --- aswatcher native binary (inotify target.txt + Xposed exclude + conflict)
mkdir -p "$MODPATH/bin/$ABI_DIR"
if unzip -l "$ZIPFILE" 2>/dev/null | grep -q "bin/$ABI_DIR/aswatcher"; then
  install_file "bin/$ABI_DIR/aswatcher" "$MODPATH/bin/$ABI_DIR"
  chmod 755 "$MODPATH/bin/$ABI_DIR/aswatcher"
else
  ui_print "warning: no aswatcher binary for $ABI_DIR"
fi

# --- asfetch native HTTPS fetcher (arm devices only; TLS fallback for CDNs)
if unzip -l "$ZIPFILE" 2>/dev/null | grep -q "bin/$ABI_DIR/asfetch"; then
  install_file "bin/$ABI_DIR/asfetch" "$MODPATH/bin/$ABI_DIR"
  chmod 755 "$MODPATH/bin/$ABI_DIR/asfetch"
else
  abort "Repair native runtime missing for $ABI_DIR; use an ARM64/ARMv7 Repair build."
fi
"$MODPATH/bin/$ABI_DIR/asfetch" lock-run "$TMPDIR/as-runtime-check.flock" 0 \
  "$MODPATH/bin/$ABI_DIR/asfetch" run-bounded 2 /system/bin/sh -c 'exit 0' \
  || abort "Repair native runtime cannot start; settings and keybox were not changed."

chmod 755 "$MODPATH/daemon" "$MODPATH/supervisor" "$MODPATH/inject" \
          "$MODPATH"/*.sh 2>/dev/null

# --- WebUI (KSU / APatch / MMRL) — local HTML, JavaScript and CSS
mkdir -p "$MODPATH/webroot"
if unzip -l "$ZIPFILE" 2>/dev/null | grep -q "webroot/index.html"; then
  for web_asset in index.html main.js app.css banner.png banner.mp4; do
    install_file "webroot/$web_asset" "$MODPATH/webroot"
    chmod 644 "$MODPATH/webroot/$web_asset"
  done
  # Magisk has no built-in WebUI host. The standalone WebUI app is fetched
  # from GitHub and installed on the first [Action] press (see action.sh).
  if [ "$KSU" != true ] && [ "$APATCH" != true ]; then
    ui_print "WebUI: use an installed compatible WebUI host"
  fi
else
  ui_print "warning: WebUI index.html missing from package"
fi

# --- /data/adb/tricky_store config ----------------------------------------
mkdir -p "$CONFIG_DIR"

# Everything of OURS (settings, state, logs) goes under one directory there;
# import it now so an upgrade from the old one-file-per-toggle layout keeps
# every setting, instead of silently reverting to defaults on first boot.
if [ -f "$MODPATH/as_store.sh" ]; then
  MODPATH="$MODPATH" sh "$MODPATH/as_store.sh" migrate 2>/dev/null
  ui_print "settings: $CONFIG_DIR/alwaysstrong/"
fi
AS_CFG_ROOT="$CONFIG_DIR" sh "$MODPATH/repair_init.sh"
if AS_CFG_ROOT="$CONFIG_DIR" sh "$MODPATH/keybox_manage.sh" recover; then
  ui_print "keybox: complete local file preserved/recovered"
else
  ui_print "keybox: no complete local file; import or fetch one after boot"
fi

# target.txt is (re)built on boot (service.sh) and on every [Action] tap — just
# drop a default seed here so TrickyStore has something to read on first boot.
[ -f "$CONFIG_DIR/target.txt" ] || install_file "target.txt" "$CONFIG_DIR"

if [ ! -f "$CONFIG_DIR/hbk" ]; then
  head -c 32 /dev/random > "$CONFIG_DIR/hbk"
  chmod 600 "$CONFIG_DIR/hbk"
fi
rm -f "$CONFIG_DIR/tee_status.txt" "$CONFIG_DIR/tee_status" 2>/dev/null

ui_print ""
ui_print "installed. reboot, then tap [Action] to refresh."
ui_print ""
