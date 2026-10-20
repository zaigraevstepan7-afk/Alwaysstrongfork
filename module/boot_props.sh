#!/system/bin/sh
# Apply one session-only boot property policy before any new TEE daemon starts.
# This changes property views, not the bootloader, AVB chain or hardware trust.
MODPATH=$(cd "${0%/*}" && pwd) || exit 1
MODE=${1:-apply}
case "$MODE" in apply|check) ;; *) echo 'Usage: boot_props.sh [apply|check]' >&2; exit 2 ;; esac
command -v resetprop >/dev/null 2>&1 || { echo 'resetprop unavailable'; exit 1; }
for name in ro.bootmode ro.boot.mode ro.boot.bootmode vendor.bootmode; do
    case "$(getprop "$name" 2>/dev/null)" in
        recovery|charger|rescue|fastboot) echo 'Non-normal boot: property policy skipped'; exit 0 ;;
    esac
done
changed=0; checked=0; failed=0
# Existing properties only: do not invent OEM namespaces on a different ROM.
# Read back writes so startup never silently assumes the policy was applied.
expect() {
    current=$(resetprop "$1" 2>/dev/null) || return 0
    [ -n "$current" ] || return 0
    checked=$((checked + 1))
    [ "$current" != "$2" ] || return 0
    if [ "$MODE" = apply ] && resetprop -n "$1" "$2" 2>/dev/null && \
       [ "$(resetprop "$1" 2>/dev/null)" = "$2" ]; then
        changed=$((changed + 1))
    else
        echo "Property mismatch: $1 (expected $2)"
        failed=$((failed + 1))
    fi
}
for name in ro.boot.verifiedbootstate vendor.boot.verifiedbootstate ro.vendor.boot.verifiedbootstate; do expect "$name" green; done
for name in ro.boot.vbmeta.device_state vendor.boot.vbmeta.device_state ro.vendor.boot.vbmeta.device_state ro.secureboot.lockstate; do expect "$name" locked; done
for name in ro.boot.flash.locked vendor.boot.flash.locked ro.vendor.boot.flash.locked ro.boot.realme.lockstate; do expect "$name" 1; done
for name in ro.boot.veritymode vendor.boot.veritymode ro.vendor.boot.veritymode; do expect "$name" enforcing; done
for name in ro.boot.warranty_bit ro.vendor.boot.warranty_bit ro.vendor.warranty_bit ro.warranty_bit ro.is_ever_orange; do expect "$name" 0; done
for name in ro.debuggable ro.force.debuggable service.adb.root sys.oem_unlock_allowed; do expect "$name" 0; done
for name in ro.secure ro.adb.secure; do expect "$name" 1; done
expect ro.boot.realmebootstate green
expect ro.boot.vbmeta.invalidate_on_error yes
# Strict property names avoid the old loose grep accidentally matching a
# fingerprint or arbitrary value that happens to contain '.build.type'.
build_props=$(resetprop 2>/dev/null | sed -n 's/^\[\([^]]*\)\]:.*/\1/p' | \
    grep -E '^ro(\.[a-z0-9_]+)*\.build\.(tags|type)$')
for name in $build_props; do
    case "$name" in *.tags) expect "$name" release-keys ;; *.type) expect "$name" user ;; esac
done
echo "Boot property policy: checked=$checked changed=$changed failed=$failed mode=$MODE"
[ "$failed" -eq 0 ]
