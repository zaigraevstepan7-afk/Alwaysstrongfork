# Analysis of the supplied Duck Detector report

The supplied report was produced on **2026-10-19** by Duck Detector build **1036**, commit `d3a085e3eaed`, on a device reporting Android 16 / API 36. It predates AlwaysStrongFork 1.4.0 and 1.4.1. It does not establish the behavior of either new release, and does not identify the installed AlwaysStrong version. The private report and complete app inventory are not included in this repository.

| Finding | Evidence | Response in 1.4.1 | Remaining limit |
| --- | --- | --- | --- |
| TEE / Soter danger | Service reachable; ASK/AuthKey preparation failed, `finalErr=4`; signing skipped | Add read-only Soter environment output to collected logs | Not repaired or verified on the device. The report does not identify the cause of the vendor key failure. |
| Memory warning | 20 font paths under a separate font module's `system/fonts` directory | 1.4.1 introduced optional font remapping; 1.4.2 removes it for stability, retaining only optional per-process mount isolation after boot | Font-path finding is unresolved; no phone test or clean follow-up report. |
| Dangerous Apps / LSPosed warnings | Installed packages and Xposed module metadata were visible | No automatic uninstall, metadata rewriting, or PackageManager filtering | Package visibility remains a separate source of warnings. |
| Root Managers warning | A manager was identified through its certificate/payload/class metadata | No APK or signature tampering | Renaming a package does not remove those identifiers. |
| Zygisk, mounts, kernel, bootloader | Reported clear within the scan's coverage | Preserve existing behavior; isolation is optional | A clear card does not prove an entirely stock device. |

## Soter investigation

Inspection used the detector source at report commit `d3a085e3eaed` and TEESimulator-RS source at pinned tag `v6.0.1-307` (`6d241e56d6e8146cd67ed4ac3dadc9c632969549`).

The detector's `SoterCapabilityProbe` retries ASK preparation, reads ASK/AuthKey models, and opens a signing session. In this report, preparation failed before signing. A working general AndroidKeyStore or a valid keybox does not demonstrate a working vendor Soter service.

The pinned upstream TEE sources contain `SoterProcessSupervisor` and `SoterServiceInterceptor`. The latter uses placeholder identity/signature payloads rather than restoring the vendor's factory attestation keys. The upstream module also includes a `crash_dump -> platform_app` injection rule that the original AlwaysStrong packaging does not copy. Adding that permission alone would enable an interception path; it would not establish genuine Soter repair or valid cryptographic signatures. This release does **not** add that broad permission or advertise placeholder replies as a repair.

To collect a read-only environment snapshot:

```sh
su -c 'sh /data/adb/modules/tricky_store/soter_diagnose.sh'
```

It queries package/process/service presence and bundled policy text. It creates or deletes no ASK/AuthKey, clears no vendor data, and does not toggle Soter services. A real vendor Soter repair requires device-side evidence and a successful key-generation/signing test; that has not been performed here.

## Evaluating the optional isolation companion

1. Install the main module normally. Install the separate isolation ZIP only if you want its experimental behavior.
2. Reboot. Check the companion's WebUI selection; the initial package is Duck Detector.
3. Ensure the target app has no root grant, then fully stop and reopen it. Settings apply to new app processes.
4. Run the same detector checks and compare font-path findings, not only the overall badge. The current report cannot serve as an after-test.
5. If app rendering or stability changes, disable the companion and reboot. Font memory remapping is removed in 1.4.2 and cannot be enabled.

The current companion tests check config rejection, exact selection, current-boot gating and a slow-peer IPC deadline. Font mapping replacement is no longer performed. The Android libraries are cross-compiled and checked for ABI/export validity in CI. Neither test establishes runtime success on the reported phone. Package warnings and Soter failures are explicitly unresolved by this mechanism.

Sources: [detector at the report commit](https://github.com/eltavine/Duck-Detector-Refactoring/tree/d3a085e3eaed), [pinned TEE source](https://github.com/Enginex0/TEESimulator-RS/tree/6d241e56d6e8146cd67ed4ac3dadc9c632969549), [official Zygisk API](https://github.com/topjohnwu/zygisk-module-sample/blob/8ce26128f81baaed0b969aaf7f52f886b61af4ab/module/jni/zygisk.hpp).
