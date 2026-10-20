# Optional Zygisk mount isolation

This independent companion avoids replacing the PIF Zygisk library in the main module. It requests Magisk's documented per-process unmount operation for exact selected package names, then unloads its own library. It installs no persistent hooks, rewrites no detector output, and changes no hardware or package inventory.

The initial target is `com.eltavine.duckdetector`, matching the supplied report. Additional apps are configured through the companion's WebUI. Root-granted UIDs, system UIDs, isolated UIDs, Google Play components, and the Soter service are excluded. No selection falls back to no action.

The companion reads a bounded regular package-list file in its root handler and returns only a selection flag. FIFOs, symlinks, directories and oversized files are rejected before reading. Each full IPC request/response shares a 150 ms monotonic deadline after connection; interrupted syscalls and short reads do not renew it. The provider owns `connectCompanion()` timing and companion-side connection lifetime.

**Font memory copying/remapping was removed in Repair 1.4.2.** The old `memcpy` could fault on a stale/truncated file mapping, and replacing inherited mappings in a pre-specialization callback is not Android-device-verified. Prior `private-fonts=1` values are ignored; the compatibility command refuses to enable the retired feature. There are no `mmap`/`mremap` writes in this component.

Before boot completion, the app callback returns without contacting the companion. The non-blocking module service waits up to 180 seconds for boot completion, then 120 seconds for settling, and atomically writes a token for the current boot. The root handler accepts that token only while no disable/remove marker exists. Tokens from earlier boots do not enable anything. Child zygotes and SDK sandbox UIDs are excluded alongside the existing protected processes. A failed preparation stays inactive rather than retrying changes during boot.

Runtime effects remain untested on a physical Android device. An inherited font mapping may still expose its original path. Package inventory and vendor Soter key failures are separate issues; no clean detector verdict is promised.

Requires Android 10+, ARM64/ARMv7, and a compatible Zygisk API v5 provider (Magisk 27000+ or a provider implementing that API). Install the separate ZIP through the root manager, reboot, and restart selected apps. Disable the companion and reboot to undo it. KernelSU/APatch compatibility depends on their installed Zygisk provider and is not device-verified.

`vendor/zygisk.hpp` is the official 0BSD API header from `topjohnwu/zygisk-module-sample`, commit `8ce26128f81baaed0b969aaf7f52f886b61af4ab`. Its license notice is retained. Other companion sources are GPL-3.0-or-later under the repository license.
