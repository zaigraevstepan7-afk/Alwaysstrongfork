# Repair 1.4.2 boot safety review

Reviewed against Repair 1.4.1 (`5b25ec8f49584b228234c409c57e4603c654b366`). These are source-level failure modes, not reproductions of an Android bootloop. No physical phone or Android emulator was available.

## Scope

The review traced the blocking `post-fs-data` entry, service startup/background work, configuration and keybox paths, property policy, attestation adapters/supervisor, native deadline/lock helpers, native package watcher, optional Zygisk component, companion installer/WebUI settings, and release packaging. Host fixtures isolate Android commands, properties, files and credentials from the test machine.

Bundled upstream TEE/PIF libraries and DEX were **not rebuilt or fully reverse-engineered**. Their behavior inside keystore/zygote and the Zygisk provider's implementation cannot be certified by reviewing this repository's integration code. Additional TrickyStoreOSS/JingMatrix engine adapters are present in source, but standard releases use the pinned TEESimulator-RS payload.

## Findings and changes

| Risk | Failure mechanism in 1.4.1 | Change in 1.4.2 | Verification |
| --- | --- | --- | --- |
| High: app crash in native font replacement | Direct `memcpy` from an inherited file mapping can fault if the backing file becomes unreadable/truncated. Fixed-address replacement before specialization is not device-verified. | Remove the font mapping algorithm and its runtime call. Reject old enable requests; no `mremap` dependency may appear in the built companion. Font paths can remain visible. | ZIP ELF check; compatibility-setting rejection. |
| High: companion handler stalls app startup | Opening a FIFO blocks before `fstat`; each short IPC read previously renewed a 150 ms poll timeout. | Nonblocking/no-follow opens followed by regular-file and size checks; one monotonic deadline for the complete request/response. | Real FIFO/symlink/directory/size tests and a socket peer sending one byte every 20 ms. |
| High: experimental work during startup | Isolation was allowed as soon as a selected app specialized, without a settled-boot gate. | Return before IPC until boot completion; require a current-boot readiness token written only after 120 more seconds. Reject disable/remove markers, child zygotes and SDK sandbox UIDs. | Current/stale boot token tests; incomplete boot, recovery and disable-during-settle fixtures; native UID tests. |
| High: retry budget resets with supervisor | A crashed supervisor lost its in-memory rapid-exit counter, so the watchdog could start another budget. Wall-clock jumps could also distort windows. | Atomically persist unconfirmed launch attempts for the current boot; use `/proc/uptime`; keep one supervisor lock. Clear attempts only after a stable run. | Kill the supervisor's entire fixture process group, restart it, and verify that total unconfirmed launches stay at three. Existing keystore-churn and duplicate-owner tests remain. |
| High: partial target file consumed by engine | The watcher used `fs::write` on the live target file; concurrent builders shared `target.txt.tmp`. | One writer lock and a 45-second process-group deadline; unique temporary output and atomic rename. Exclude manager entries within that transaction; the watcher delegates instead of truncating. Reject unsafe cleanup basenames. | Hung PackageManager leaves the previous target intact; successful build publishes a complete filtered file and removes its temporary output. Both ARM helpers are rebuilt in release CI. |
| Medium: timeout path blocks despite SIGKILL | The deadline helper called blocking `wait()` after killing a process; uninterruptible kernel I/O may not exit immediately. | Use nonblocking `try_wait()` after termination. | Existing descendant termination/lock-release test and source/build verification. Kernel D-state cannot be reliably induced in an unprivileged host fixture. |
| Medium: malformed state bypasses guard | Arbitrarily long numeric boot counters can overflow shell arithmetic. Pending removal was not checked by the guard. | Accept only expected counters; treat corrupt values conservatively. Reject pending removal and include `fastbootd` in policy exclusions. | Corrupt-counter, pending-removal and non-normal boot tests. |
| Medium: unbounded pre-restart validation | Supervisor keybox checks had no per-call deadline, and validation did not require a regular non-symlink file. | Bound every supervisor check to eight seconds; reject nonregular/symlink keyboxes. | FIFO/symlink rejection and existing invalid-keybox no-launch tests. |

## Remaining limits

- No source audit proves that a particular vendor ROM, root manager, Zygisk provider or TEE/PIF payload cannot crash. A clean host/CI build is not an Android boot test.
- The 150 ms budget starts after the provider's `connectCompanion()` returns. This project cannot time out the provider's internal call from the specialization callback safely. Before boot completion, the call is skipped entirely.
- SIGKILL does not repair uninterruptible kernel I/O. The deadline helper now returns without blocking on reaping, but a stuck task may remain until the kernel operation completes. Command creation/provider calls and kernel stalls are not made universally interruptible by a userspace deadline.
- The main guard disables `tricky_store` after three distinct boots without its stable checkpoint. It does not control an unrelated module and cannot undo an already-loaded third-party hook in the current boot. The independent Isolation companion uses its own current-boot readiness gate; it has no pre-boot unmount work.
- Native keystore faults can happen between supervisor samples. The supervisor pause and boot-attempt guard reduce repeated attempts; they are not a guarantee that Android will remain running.
- The source tree retains native prebuilts for offline packaging. After native source changes, rebuild before local packaging. Standard release and nightly workflows rebuild ARM helpers from their exact checkout.
- Soter hardware keys, package visibility and detector verdicts are not repaired or guaranteed by this stability update.

## Updating and recovering

If both 1.4.1 ZIPs were installed, update **both** the main module and the separate Isolation companion to 1.4.2. Updating the main module alone leaves the older companion installed. Install one main variant and reboot; preserve the existing configuration directory.

If the device remains unstable, disable both modules in the root manager and reboot. When a working root shell is available, the corresponding disable markers are `/data/adb/modules/tricky_store/disable` and `/data/adb/modules/alwaysstrong_isolation/disable`. Do not erase keystore/vendor data or flash partitions to troubleshoot this module. If Android cannot reach a usable shell, use the recovery procedure supported by the installed root manager.
