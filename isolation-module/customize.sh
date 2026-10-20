[ "$BOOTMODE" = true ] || abort "Install from a root manager, not recovery."
[ "$API" -ge 29 ] || abort "Android 10+ required."
case "$ARCH" in arm64|arm) ;; *) abort "ARM64/ARMv7 only." ;; esac
if [ "$KSU" != true ] && [ "$APATCH" != true ]; then
    [ "${MAGISK_VER_CODE:-0}" -ge 27000 ] || abort "Magisk-compatible version 27000+ required."
fi
old=/data/adb/modules/alwaysstrong_isolation/targets.list
if [ -f "$old" ] && [ "$old" != "$MODPATH/targets.list" ]; then
    cp -f "$old" "$MODPATH/targets.list" || abort "Could not preserve selected apps."
fi
if [ -f /data/adb/modules/alwaysstrong_isolation/private-fonts ]; then
    cp -f /data/adb/modules/alwaysstrong_isolation/private-fonts "$MODPATH/private-fonts" || abort "Could not preserve font option."
fi
set_perm_recursive "$MODPATH" 0 0 0755 0644
set_perm "$MODPATH/targets.sh" 0 0 0755
ui_print "Experimental mount isolation; requires a Zygisk API v5 provider."
ui_print "Initial target: Duck Detector; private font copies enabled. Edit targets in this module's WebUI."
ui_print "Google Play, Soter, system, root-granted and isolated UIDs are excluded."
ui_print "Reboot after installation; no kernel or keystore keys are modified."
