# AlwaysStrong Repair 1

An unofficial repaired build of AlwaysStrong v1.0.5. Upstream base: `Evokerr/AlwaysStrong`, commit `72309a7c5117f28f44a1cd72b89ff1c5302208bf`.

## Fixes

The original issue was a truncated `keybox.xml`: 954 bytes, containing the beginning of a certificate without its ending or closing XML tags. After restoring a complete local copy and disabling three spoofing flags, the phone owner reported Basic / Device / Strong in a separate Play Integrity Checker.

This build provides:

- HTTP response completeness, Base64, XML, PEM, and DER length validation before keybox replacement;
- atomic replacement, preserving the previous complete copy;
- recovery of damaged files from a complete local backup;
- `spoofProvider`, `spoofSignature`, and `spoofVendingSdk` set to `0` for Fork during the first migration and explicit settings reset;
- preservation of custom keybox mode and disabled regular downloads during updates and resets;
- separate displays for file health and timestamped imported Play Integrity results;
- a bounded refresh attempt triggered by a fresh imported result below 3/3;
- explicit module conflicts, without automatically removing other modules in the modified installation and checking paths;
- diagnostic log suppression disabled by default.

Structural validation does not establish Google trust, certificate validity periods, revocation status, or Play Integrity. TEESimulator-RS and PlayIntegrityFork engines come from pinned upstream artifacts. The project's asfetch downloader was rebuilt from modified Rust sources for ARM64 and ARMv7.

## Installation

This build targets Magisk, KernelSU, and APatch on ARM64/ARMv7, Android 10+. PIF requires working Zygisk: Magisk's built-in implementation or a compatible provider for KernelSU/APatch. Open WebUI through a supporting manager or an already installed compatible host.

The bundled native helper also provides system write locks. The installer verifies that it starts before changing personal settings or the keybox; writes are rejected without a working helper. A staged update does not stop the currently running engine.

1. Copy the installation ZIP to the phone.
2. In the current root manager, install it **over the existing AlwaysStrong** module with ID `tricky_store`. Uninstalling first runs the normal uninstall procedure and may remove configuration.
3. Reboot the phone.
4. Open WebUI, check keybox health, and run a separate Play Integrity Checker.

Installation of the new build still needs verification on the user's phone. Host checks and successful ZIP packaging do not replace that test.

## Importing a checker result

Launching `gr.nikolasspyr.integritycheck/.MainActivity` is supported. The inspected app sources provide **JSON response → Copy JSON**. The app does not automatically export results to a root module.

After running a new check:

1. In the checker, open ⋮ → JSON response → Copy JSON.
2. In the module's WebUI, expand the checker result import section.
3. Paste the JSON and apply it within 15 minutes of the check.

The module reads the exact `MEETS_BASIC_INTEGRITY`, `MEETS_DEVICE_INTEGRITY`, and `MEETS_STRONG_INTEGRITY` labels and the original `requestDetails.timestampMillis`. Indicators represent a **saved checker result** and become unknown after one day. The module does not independently verify a Google signature in this JSON; the app and its server provide the result.

An empty `deviceIntegrity` with a valid, fresh timestamp means 0/3: Google may omit the verdict array for a negative result. API errors, malformed JSON, and missing required fields are not treated as failed integrity checks. An older or already processed timestamp does not replace the saved result.

When a fresh result is below 3/3 and automatic repair is enabled, one download attempt is permitted per result, at most once every six hours. This separate attempt can replace a custom keybox while preserving the previous complete copy. Custom keybox mode remains enabled, so regular hourly downloads stay disabled. Turn off automatic repair to prevent replacement triggered by checker results. After updating the file, run a new check: downloading alone does not confirm that Strong has returned.

External automation can supply `alwaysstrong/verdict-inbox.json` containing the complete, fresh JSON from a checking app/server. The service imports this file when present. Play Integrity Checker itself does not write it. Do not substitute a fabricated negative verdict for a network/API error.

## Verification on the phone

No test guarantees unchanged Strong results after future Google changes. Tests can establish that a specific fault is fixed and that the current build works with the phone's current state.

### 1. Version, keybox, and flags

Open a terminal in MT Manager and obtain root:

```sh
su
AS_MOD=/data/adb/modules/tricky_store
AS_CFG=/data/adb/tricky_store
grep -E '^(id|name|version|versionCode)=' "$AS_MOD/module.prop"
sh "$AS_MOD/keybox_manage.sh" health
sh "$AS_MOD/keybox_manage.sh" check
echo "keybox_check_rc=$?"
grep -E '^(spoofProvider|spoofSignature|spoofVendingSdk)=' "$AS_MOD/custom.pif.prop"
sh "$AS_MOD/as_store.sh" get custom_keybox
sh "$AS_MOD/as_store.sh" get auto_keybox
```

Expected: a Repair version, `complete`, `keybox_check_rc=0`, and all three specified flags set to `0`. For a previously restored custom keybox, expect `custom_keybox=1` and `auto_keybox=0` unless you changed them.

### 2. Engine loaded

For the bundled TEESimulator-RS:

```sh
pidof TEESimulator
AS_KEYSTORE_PID=$(pidof keystore2)
grep -F libTEESimulator.so "/proc/$AS_KEYSTORE_PID/maps"
```

Expect a PID and a library entry. These confirm the process is running and the library is loaded; they do not prove a successful Google check.

### 3. Actual integrity results

Run a new check in `gr.nikolasspyr.integritycheck`. All three `MEETS_*_INTEGRITY` labels must come from that fresh request. Copy the JSON into WebUI and compare the date and three indicators. A 3/3 result does not require a replacement attempt.

Repeat after a reboot and after a complete automatic update interval. If the result holds, flags remain correct, the file stays complete, and no engine errors occur, this verifies the restart scenario as well as a single successful request.

### 4. Download without replacing the live file

Test downloads in a separate private directory using `AS_CFG_ROOT`. The following command is not intended to replace the active keybox:

```sh
umask 077
AS_MOD=/data/adb/modules/tricky_store
AS_CFG=/data/adb/tricky_store
AS_TEST_DIR=$(mktemp -d /data/local/tmp/as-nettest.XXXXXX) || exit 1
cp "$AS_CFG/keybox.xml" "$AS_TEST_DIR/keybox.xml" || exit 1
AS_BEFORE=$(sha256sum "$AS_CFG/keybox.xml" | cut -d' ' -f1)
AS_CFG_ROOT="$AS_TEST_DIR" MODPATH="$AS_MOD" sh "$AS_MOD/as_store.sh" set custom_keybox 0
AS_CFG_ROOT="$AS_TEST_DIR" MODPATH="$AS_MOD" sh "$AS_MOD/keybox_fetch.sh"
AS_DOWNLOAD_RC=$?
echo "download_rc=$AS_DOWNLOAD_RC"
AS_CFG_ROOT="$AS_TEST_DIR" MODPATH="$AS_MOD" sh "$AS_MOD/keybox_manage.sh" check
echo "scratch_keybox_rc=$?"
AS_AFTER=$(sha256sum "$AS_CFG/keybox.xml" | cut -d' ' -f1)
[ "$AS_BEFORE" = "$AS_AFTER" ] && echo 'LIVE_KEYBOX_UNCHANGED'
rm -rf "$AS_TEST_DIR"
```

`download_rc=0` means a new download was accepted in the test directory; `2` means the file was identical. `1` means download/validation failed: inspect the source and network; the active keybox should remain intact. `scratch_keybox_rc=0` confirms a complete test file, and `LIVE_KEYBOX_UNCHANGED` confirms the live file did not change. Do not report a download as successful when `download_rc=1`.

There is no need to damage the live keybox or clear Google Play data for testing. Corruption, interrupted transfers, preservation of previous files, backup recovery, and concurrent writes are tested with isolated data.

### 5. Verify recovery from truncation

This test truncates **only a separate test copy** to 954 bytes, then restores it from a complete copy. The live file is read only:

```sh
umask 077
AS_MOD=/data/adb/modules/tricky_store
AS_CFG=/data/adb/tricky_store
AS_TEST_DIR=$(mktemp -d /data/local/tmp/as-recoverytest.XXXXXX) || exit 1
cp "$AS_CFG/keybox.xml" "$AS_TEST_DIR/keybox.xml.bak" || exit 1
head -c 954 "$AS_CFG/keybox.xml" > "$AS_TEST_DIR/keybox.xml"
AS_CFG_ROOT="$AS_TEST_DIR" MODPATH="$AS_MOD" sh "$AS_MOD/keybox_manage.sh" health
AS_CFG_ROOT="$AS_TEST_DIR" MODPATH="$AS_MOD" sh "$AS_MOD/keybox_manage.sh" recover
echo "recovery_rc=$?"
AS_CFG_ROOT="$AS_TEST_DIR" MODPATH="$AS_MOD" sh "$AS_MOD/keybox_manage.sh" health
cmp -s "$AS_TEST_DIR/keybox.xml" "$AS_CFG/keybox.xml" && echo 'RESTORED_COPY_MATCHES'
rm -rf "$AS_TEST_DIR"
```

Expected sequence: `invalid`, a recovery message, `recovery_rc=0`, `complete`, and `RESTORED_COPY_MATCHES`. This exercises the validator, backup selection, system locking, and replacement on Android without damaging the active keybox.

### 6. If results differ

Collect a fresh log using the WebUI button or:

```sh
sh /data/adb/modules/tricky_store/collect_logs.sh
```

The resulting `.txt` is a file to read, not a command. Display it with `cat /sdcard/GENERATED_FILENAME.txt`. Diagnostic reports do not require publishing `keybox.xml`, `hbk`, or private key contents.

## Startup, bootloop protection, and rollback

The owner's screenshot and terminal output reported installation of the original Repair 1: Action completed, keybox health was complete, TEESimulator was running, and the counter reached `attempts=0`. The subsequent ZIP also includes @SUKISU_ULTR4 attribution; its reinstallation was not yet confirmed in this historical report. Host checks passed 40 Python and 6 Rust tests, including a stalled early worker, daemon crashes, occupied locks, and a damaged keybox. This does not guarantee OxygenOS startup: native PIF/TEE libraries remain dependent on the ROM and Zygisk.

The early blocking worker has a six-second deadline. Migration and recovery run in the service with a separate 20-second limit. Android startup waiting is bounded at 180 seconds. Network Action runs after boot and has a 480-second limit. Repeated service or TEE supervisor launches do not create duplicate process sets.

Three rapid TEE exits or two observed keystore2 PID changes within a minute pause TEE until the next boot. Three distinct Android boots without a stable checkpoint disable only this module. The checkpoint is set two minutes after `sys.boot_completed=1`; three intentionally rapid reboots can also trigger protection.

A damaged keybox is not passed to TEE startup. This build's boot path does not write boot/vbmeta partitions, lock the bootloader, delete screen-lock keys, or perform Widevine provisioning.

### Post-installation checks

Install the ZIP over the current `tricky_store` without uninstalling first. After boot, wait at least two minutes after the launcher appears, then run in a root terminal:

```sh
sh /data/adb/modules/tricky_store/boot_safety.sh status
cat /data/adb/tricky_store/alwaysstrong/logs/boot-prepare.log
cat /data/adb/tricky_store/alwaysstrong/logs/attest-safety.log 2>/dev/null
```

Normal state: `attempts=0`, without `safe=1` or `attestation_paused=1`. A missing `attest-safety.log` is acceptable: it is created when protection triggers. Then check the keybox, engine, and actual verdict as described above. Repeat after another normal reboot and a full update interval. If the device hangs, unlocking, biometrics, or Wi-Fi stops working, or apps crash, disable the module and reboot first.

### Emergency disable while preserving files

Disable AlwaysStrong in the root manager and reboot. With a root terminal available, the equivalent is:

```sh
su
for AS_D in /data/adb/modules/tricky_store /data/adb/modules_update/tricky_store; do
  [ ! -d "$AS_D" ] || touch "$AS_D/disable"
done
reboot
```

If Android does not boot, use your manager's module rescue mode: [KernelSU](https://kernelsu.org/guide/rescue-from-bootloop.html), [APatch](https://apatch.dev/rescue-bootloop.html). The KernelSU instructions cited in the original review require pressing and releasing Volume Down more than three times after the first boot screen and before the boot animation. The manager's rescue mode disables all its modules, whereas AlwaysStrong's own guard disables only `tricky_store`. Refer to the linked manager documentation for current rescue instructions.

If ADB and working root are already available, run from a computer:

```sh
adb shell su -c 'touch /data/adb/modules/tricky_store/disable'
adb reboot
```

ADB was not connected during this review, and these commands were not run on the owner's phone. In recovery, the same `disable` file can be created only when `/data` is accessible and decrypted.

Use **Disable + reboot** for rollback. The upstream uninstall procedure removes its configuration and `persistent_keys`. Pausing the daemon does not unload a library already injected into keystore2; a reboot is also required for complete disabling.

### If the module's guard triggers

After booting successfully with the module disabled, read `alwaysstrong/logs/boot-safety.log` and `attest-safety.log`. Do not automatically re-enable the module after protection triggers. Once the cause is resolved, an intentional retry can be prepared with the module still disabled by removing only the counters/markers in a root terminal:

```sh
rm -f /data/adb/tricky_store/alwaysstrong/boot-safe \
      /data/adb/tricky_store/alwaysstrong/boot-state \
      /data/adb/tricky_store/alwaysstrong/attest-paused
```

Then enable the module in the root manager and reboot. Do not delete `keybox.xml`, `hbk`, `persistent_keys`, or app data for this procedure.

## Checks and reproducible builds

The independent review is recorded in `REPAIR_REVIEW.md`. Final hashes and build contents are recorded in the release manifest.

Modifying the native downloader requires Rust with Android targets and the Android NDK. Rebuild and test with:

```sh
rustup target add aarch64-linux-android armv7-linux-androideabi
# ANDROID_NDK_HOME must point to the installed NDK.
bash scripts/build-repair-native.sh
cargo test --locked --manifest-path native/asfetch/Cargo.toml
cargo build --locked --manifest-path native/asfetch/Cargo.toml
python3 -m unittest discover -s tests -v
bash build.sh --variant fork
```

The installation ZIP must not contain a demonstration keybox with a private key. The phone's personal configuration and keys are not included in the source archive.

## Result format references

- [Google: Play Integrity verdict format and values](https://developer.android.com/google/play/integrity/verdicts).
- [Play Integrity Checker: response handling and Copy JSON](https://github.com/1nikolas/play-integrity-checker-app/blob/ee6316e906c7fa948fe688e534c6499f74a919a6/app/src/main/java/gr/nikolasspyr/integritycheck/MainActivity.java).
