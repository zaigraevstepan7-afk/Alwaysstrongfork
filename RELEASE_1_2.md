# AlwaysStrong Repair 1.2

An interface update, versionCode 109, based on Repair 1.1 / Repair 1.

- The Community and Support section contains one link: https://t.me/alwaysstrongfork.
- Both previous Telegram cards and the Buy Me a Coffee button were removed, along with their translation strings and coffee icon styling.
- The `support` field in `module.prop` and the channel in Action point to AlwaysStrong Fork. Donation metadata was removed.
- @SUKISU_ULTR4 remains first in the author list. The new banner, local video, and upstream credits are preserved.
- Engine behavior, keys, Play Integrity checks, and boot protection are unchanged.

Installation: install directly over Repair 1 or Repair 1.1 through your root manager, then reboot. Installing 1.1 first is unnecessary.

Checks: ZIP CRC, ZIP contents matching the build stage and sources, JavaScript/shell syntax, and the three existing installer/WebUI tests. A live 390×700 mobile preview showed exactly one community link with the correct URL, no coffee button, and no JavaScript errors. The engine, boot/service workers, key helpers, native libraries, DEX, and media are byte-for-byte identical to Repair 1.1. This ZIP was not tested on a physical Android device. It is an interface update, not a Soter fix or new Play Integrity evidence.

Source archive: `AlwaysStrong-Repair-1.2-source.zip`. Build: `bash build.sh --variant fork`. Original licenses and attribution are preserved. The next public versionCode must be greater than 109.
