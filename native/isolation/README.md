# Optional Zygisk mount isolation

This independent companion avoids replacing the PIF Zygisk library in the main module. It requests Magisk's documented per-process unmount operation for exact selected package names, then unloads its own library. It installs no persistent hooks, rewrites no detector output, and changes no hardware or package inventory.

The initial target is `com.eltavine.duckdetector`, matching the supplied report. Additional apps are configured through the companion's WebUI. Root-granted UIDs, system UIDs, isolated UIDs, Google Play components, and the Soter service are excluded. No selection falls back to no action.

The companion reads a bounded package list in its root handler and returns only selection flags. IPC waits are bounded; all client descriptors are closed before specialization. It does not delete app files. The optional font step enumerates only its own process mappings. The Zygisk runtime owns the companion-side connection lifetime.

The unmount operation affects the selected process namespace. Module font paths already inherited from zygote are handled by private read-only copies when enabled. Only `.ttf`/`.otf` mappings with `r--p` permissions under module `system/fonts` paths qualify; mappings are capped at 16 MiB each and 64 MiB in total. `mremap` preserves virtual addresses, bytes, and read-only permissions without modifying source files. If the operation fails, the original mapping remains. Other mappings are unchanged. A host test verifies these properties against a disposable mapped file. Android behavior is not device-verified; private copies can increase memory use. The option defaults to on for selected packages and can be disabled in WebUI. PackageManager inventory and vendor Soter key failures are separate issues. Runtime effect has not been tested on a physical device; no detector verdict is guaranteed.

Requires Android 10+, ARM64/ARMv7, and a compatible Zygisk API v5 provider (Magisk 27000+ or a provider implementing that API). Install the separate ZIP through the root manager, reboot, and restart selected apps. Disable the companion and reboot to undo it. KernelSU/APatch compatibility depends on their installed Zygisk provider and is not device-verified.

`vendor/zygisk.hpp` is the official 0BSD API header from `topjohnwu/zygisk-module-sample`, commit `8ce26128f81baaed0b969aaf7f52f886b61af4ab`. Its license notice is retained. Other companion sources are GPL-3.0-or-later under the repository license.
