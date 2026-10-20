# AlwaysStrong Repair: independent review

Date: 2026-10-19. Base: AlwaysStrong v1.0.5, commit `72309a7c5117f28f44a1cd72b89ff1c5302208bf`. Scope: the repair diff, new repair scripts, and integration with the installer, service, Fork adapter, and WebUI. The original AlwaysStrong directory was not modified.

This is a historical review. The test results, dependency versions, network responses, hashes, and installation reports below describe that review, not a new device test performed during documentation translation.

## Issues found and fixed

1. **Races and stale mkdir locks.** Removing a stale directory could delete another writer's newly acquired lock; `$$` in shell subprocesses could also refer to a live parent. PID-based lock directories were replaced with system `flock(2)` through `asfetch lock-run`. The writer inherits the descriptor, so killing the wrapper does not release the lock prematurely. Configuration/state waits are bounded at 15 seconds; keybox/automatic repair use nonblocking acquisition. Shared `.flock` files are not removed during operation. Code: `native/asfetch/src/main.rs:80`, `module/repair_runtime.sh:17`, `module/as_store.sh:91`, `module/keybox_manage.sh:46`, `module/auto_repair.sh:10`.

2. **Redundant state writes and non-atomic configuration resets.** Writing identical state now preserves inode/mtime. Reset preserves `custom_keybox` and `auto_keybox` in a single locked transaction. Repair spoofing flags are reapplied during explicit resets without repeating migration of original backups. Code: `module/as_store.sh:211`, `module/as_store.sh:229`, `module/reset_defaults.sh:35`, `module/repair_init.sh:7`.

3. **Validator incompatibility with a real source.** An actual HTTPS download returned complete XML with `ecdsa` and `@evokerr` algorithm labels. The initial validator accepted only literal `ecdsa|rsa` and incorrectly rejected it. Pinned TEESimulator-RS determines the algorithm from the parsed private key and uses the XML label for diagnostics. The validator now accepts a nonempty, well-formed label while retaining XML/PEM/Base64/DER checks and, when OpenSSL is available, actual key/X.509 parsing. Key contents are neither rewritten nor normalized. Code: `module/keybox_validate.awk:62`. Basis: [KeyBoxManager.kt at the pinned commit](https://github.com/Enginex0/TEESimulator-RS/blob/6d241e56d6e8146cd67ed4ac3dadc9c632969549/app/src/main/java/org/matrix/TEESimulator/pki/KeyBoxManager.kt#L213).

4. **Incomplete isolation through AS_CFG_ROOT.** A scratch download could previously notify the live TEE adapter, and scratch automatic repair could run `killall` against a Google process. These actions now run only for the normal `/data/adb/tricky_store` path. Verified with a fixture marker and an actual download into a separate directory. Code: `module/repair_runtime.sh:38`, `module/keybox_fetch.sh:182`, `module/auto_repair.sh:23`.

5. **Incomplete backups left unrepaired.** A nonempty but corrupt `.good` could previously survive installation of a complete file. Its completeness is now validated, and it is also repaired when installing an identical file. Code: `module/keybox_manage.sh:22`, `module/keybox_manage.sh:40`.

6. **Incorrect handling of a genuine 0/3 result.** Google may omit `deviceRecognitionVerdict` inside `deviceIntegrity` when no device label is satisfied. This object now produces `000` when the request timestamp is fresh. API errors, missing `deviceIntegrity`, wrong types, malformed JSON, and stale timestamps remain import errors. Code: `native/asfetch/src/main.rs:605`. Format reference: [Google documentation](https://developer.android.com/google/play/integrity/verdicts).

7. **JSON import races.** The inbox is first moved atomically into a private working directory. A new inbox arriving during parsing stays in place for the next pass. Publishing the normalized report uses a separate flock; older or already processed timestamps cannot replace a newer report. An invalid inbox is consumed without publishing; complete JSON/nonce data is not archived. Automatic repair reads one snapshot of normalized fields. Code: `module/verdict_report.sh:8`, `module/verdict_report.sh:29`, `module/auto_repair.sh:31`.

8. **Partial downloads accepted by fingerprint fallback.** The previous `pif_native_fetch.sh` accepted any nonempty file even after downloader failure and included a BusyBox `--no-check-certificate` fallback. It now accepts only successful HTTPS transfers through asfetch/curl, rejects redirect downgrades, and removes failed partial files. The keybox path adds independent strict Base64 envelope validation instead of relying on Android decoder tolerance. Code: `module/pif_native_fetch.sh:142`, `module/keybox_fetch.sh:107`, `module/repair_runtime.sh:38`.

9. **Failed installation could stop the old working engine.** The installer no longer terminates live processes during a staged update. Before modifying user configuration/keybox, it verifies that the native helper exists and starts. A missing or unusable helper aborts installation. ARM64/ARMv7 helpers are bundled; this Repair build does not claim x86 runtime support. Code: `module/customize.sh`, staged update and native runtime preflight sections.

## Verification performed

- **40 Python tests** (24 repair, 13 boot safety, 3 installer/WebUI) using disposable module copies and fresh self-signed fixtures. Coverage includes truncated XML/DER, atomic replacement/recovery, backups, custom mode and explicit deletion, concurrent writer exclusion, flock survival after parent termination, lock release after writer exit, concurrent configuration/state writes, reset, failed partial network/fingerprint responses, strict Base64, branded metadata, malformed/expired/API-error JSON, cooldown, older verdicts, and a new inbox arriving during parsing.
- **6 Rust unit tests** cover HTTP framing/chunk termination, Content-Length/Transfer-Encoding ambiguity, timeout, TLS downgrade, exact labels and freshness, empty negative device verdicts, and API-error rejection.
- `git diff --check`, shell syntax for modified paths, `bash -n` for build scripts, and `node --check module/webroot/main.js` passed.
- The native helper was rebuilt with NDK r30 for `aarch64-linux-android` and `armv7-linux-androideabi`, API 29. ELF inspection confirmed AArch64/ARM PIE, depending only on `libc.so` and `libdl.so`. This verifies build output and format, not execution of ARM binaries on a phone.

SHA256 of the rebuilt helpers:

| ABI | SHA256 |
| --- | --- |
| arm64-v8a | `bed7625826ef1bd8738e21e24e1a8f7f7f274d2efc9d866c16ea510190a3373c` |
| armeabi-v7a | `baa1005497bfeda0b737121b720f9b2bcbef065c0a76ee65b9944d22ae75d071` |

## Live network checks

These checks used a host build of the same Rust code. Keybox responses were stored only in temporary private directories and deleted; PEM contents and private keys were not printed.

- `https://evoker.qzz.io/key`: native HTTPS exit 0, 22588 encoded bytes, SHA256 `b078f3ee9a13e93ccd77b2fe20625ccd669a19b09e042b5f649f0ddbd545a4cd`.
- Complete `keybox_fetch.sh` in a separate module copy: exit 0, engine `asfetch`, Base64 → XML/PEM/DER/OpenSSL → atomic installation. Installed 16940 decoded bytes with mode `0600`, SHA256 `15a5128b81381604f5449c5571665e1c76a4f4a536923180a9f10924bdb74a02`. The live engine was not notified.
- `asfetch autopif --out <private> --module <private>`: exit 0, saved public Canary fingerprint `google/bluejay_beta/bluejay:CANARY/ZP11.260918.007/16484274:user/release-keys`.
- Active beta URL `Vagelis1608/get_the_canary_miner/main/devices/bluejay.pif.prop`: native HTTPS exit 0, 852 bytes, required identity fields present, SHA256 `1978382f8b19eb76460e1e392eb9b9e9fc2b55674eccc9b117b834672efdefac`.

Mirror contents can change; the sizes and hashes above apply only to that run.

## Separate boot safety review

The review covered post-fs-data, service startup, TEE, and persistent jobs. The following confirmed risks were addressed:

- Synchronous migration/seed, repair_init, recovery, and state locks of up to 15 seconds were removed from blocking post-fs. They run locally during service preparation with a 20-second deadline, once per boot ID. A repeated service launch during the same boot does not clear active temporary data.
- The early worker has a six-second deadline. Native `run-bounded` creates a separate process group and terminates child helpers on timeout. The official blocking-stage budgets cited at the time were [Magisk: 40 seconds](https://topjohnwu.github.io/Magisk/guides.html#boot-scripts), [KernelSU: 10 seconds](https://kernelsu.org/guide/module.html#boot-scripts), and [APatch: 10 seconds](https://apatch.dev/apm-guide.html#boot-scripts). Other modules share the budget; a host test does not rule out kernel I/O hangs.
- Boot completion waiting is limited to 180 seconds with an outer 185-second deadline. Failure prevents remaining jobs from starting. The first Action runs in the background after boot completion, with a 480-second deadline; its success marker is written only on exit 0. Networking is absent from the blocking stage.
- A nonblocking kernel flock protects the complete service. Background watchdog/hourly shells inherit the descriptor, preventing repeated service launches from creating duplicate persistent jobs. The attestation supervisor has a separate flock.
- The pinned upstream supervisor backs off for 0.5–32 seconds but retries exits without a final limit. Adapters now share `attest_supervise.sh`: 10/30-second backoff, then a pause until the next boot after three exits lasting less than a minute. Two observed keystore2 PID changes in 60 seconds also trigger a pause. Only the owned daemon is terminated, with Android process start-time checks; keystore2 is not killed. Observation occurs every 5 seconds for the first two minutes, then every 30 seconds.
- A missing or damaged keybox is not passed to TEE startup. The watchdog can retry once a complete file appears. Gate checks also have deadlines.
- The boot guard counts distinct boot IDs. A success checkpoint is written two minutes after boot completion. Three boots without a checkpoint create only the module's `tricky_store/disable` and `alwaysstrong/boot-safe` markers. Three intentionally rapid reboots can also trigger protection; user files and other modules are not removed.
- Legacy property-area dd patches, recovery property spoofing, `ro.crypto.state` spoofing, and SELinux interface chmod operations were removed. Recognized recovery/charger/rescue/fastboot modes exit before changes. `resetprop -n` is used; new ROM overrides operate only in memory. Broad deletion of persistent pihook/pixelprops was removed. Targeted repair_init migration still removes its own old `persist.log.tag` suppression values.
- Excessive/invalid refresh intervals are clamped to a safe range so a failed sleep cannot turn the hourly loop into a busy loop.
- The main review removed the unrelated Widevine provisioning script, demonstration XML, and WebUI button. This build does not offer DRM provisioning or include that demonstration private key.

All three boot helpers are listed in `customize.sh`. The build copies the entire `module/` directory, normalizes `*.sh` files, and makes them executable; the native helper comes from rebuilt ARM prebuilts. The final main review confirmed that sources, UI, and ABI binaries match the ZIP, HTML/JavaScript/CSS extract correctly, and no demo keybox or Widevine payload is included.

### Boot protection tests and limits

The 13 boot tests use disposable directories and mocked Android properties/pidof. They cover an occupied configuration flock without early repair, a stalled post-fs worker timeout, child process-group termination and flock release, recovery exit, once-per-boot preparation, bounded boot waiting, checkpoint handling, three unfinished boots without modifying another module, missing/corrupt keybox without daemon startup, rapid exits, a duplicate supervisor/service, observed keystore restarts, and invalid intervals.

Final test groups: **24 repair + 13 boot + 3 installer/WebUI = 40 Python PASS**, plus **6 Rust PASS**. The main run also confirmed syntax for all 41 shell scripts, Node syntax, and diff checks. This is not a measurement of APatch boot time on OnePlus.

A pause stops further attempts and the owned daemon. It **does not unload a library already injected into a running keystore2**. The boot guard also does not undo native Zygisk payloads in current processes. Complete disabling requires Disable + reboot. An incompatible native hook can fail on its first attempt, before script observation. Zero bootloop risk has not been established.

Boot scripts do not write boot/vbmeta partitions, lock the bootloader, or delete FBE/credential/keystore data. Rollback uses Disable + reboot: the upstream uninstall removes its own configuration and `persistent_keys`. Exact commands and rescue instructions are in the boot section of `REPAIR.md`.

Original verified package: 93 ZIP entries, SHA256 `6e256ef5943cd5d1bc9f778135bb80de4ab07bc207262f6ab83e7c861408ca37`. The owner later supplied installation evidence from OxygenOS 16: Action completed, keybox complete, TEESimulator PID 10660, and `attempts=0`. This supports reaching the boot checkpoint as reported by the user, but does not establish full hardware compatibility or a new Google verdict.

At the owner's request, @SUKISU_ULTR4 was added to `module.prop`, installer output, Action, and the WebUI footer. The rebuilt ZIP had SHA256 `a189ad055af26d8949b41cfa4d67dba2ebf7c42be2510ab94432bab08d5692fc`; only those four files changed, while native and boot safety components remained identical. The three installer/WebUI tests, shell syntax, and diff checks passed again. Reinstallation of the archive with the added author had not yet been confirmed.

## Evidence limits

No phone was connected through ADB. Installation of the original Repair 1 and reaching its boot checkpoint are supported only by the owner's supplied materials described above. SELinux and root-manager runtime were not separately examined; an injection map, repeat boot, and fresh Google verdict were not obtained. The main task built and checked the ZIP; file contents and checksums were recorded in the release manifest.

The validator checks a limited keybox format, PEM completeness, and outer DER length. When OpenSSL is available, it also checks key and X.509 parsing; without it, validation is not equivalent to full cryptographic certificate-chain verification. No local check establishes non-revocation, Google trust, or future Strong results.

Imported JSON is not a Google signature independently verified by the module. The module displays saved app/server fields with their original date. Automatic repair requires a fresh negative import, permits one attempt per result, and enforces a six-hour cooldown. It cannot independently request a Google verdict through a checker without export support. Run a new real checker request after installation, reboot, and a full update interval. Instructions are in `REPAIR.md`.
