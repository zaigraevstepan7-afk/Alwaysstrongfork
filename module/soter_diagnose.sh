#!/system/bin/sh
# Read-only environment checks. Never generates/removes vendor keys or changes services.
MODPATH=$(cd "${0%/*}" && pwd)
. "$MODPATH/repair_runtime.sh"
echo 'Soter environment (not a key-generation or trust test)'
echo "API: $(getprop ro.build.version.sdk 2>/dev/null)"
echo 'Package path:'
as_bounded 3 pm path com.tencent.soter.soterserver 2>/dev/null || echo 'Package query unavailable or package absent'
echo "Process: $(pidof com.tencent.soter.soterserver 2>/dev/null || :)"
echo 'Declared service states:'
getprop 2>/dev/null | grep -i soter | grep -E '^\[init\.svc\.' || :
echo 'Bundled policy rule (not a live SELinux access check):'
grep -E '^allow crash_dump platform_app process' "$MODPATH/sepolicy.rule" 2>/dev/null || echo 'No extra platform_app injector permission bundled'
echo 'An available service does not prove ASK/AuthKey generation works.'
echo 'No hardware repair or successful attestation is established by this report.'
