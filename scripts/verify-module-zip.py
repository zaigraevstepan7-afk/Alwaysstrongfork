#!/usr/bin/env python3
"""Fail CI if a built archive cannot be installed as the expected module."""
import sys
import zipfile


def verify(path):
    required = {
        'module.prop', 'customize.sh', 'service.sh', 'post-fs-data.sh', 'webui_action.sh',
        'boot_safety.sh',
        'META-INF/com/google/android/update-binary',
        'META-INF/com/google/android/updater-script',
        'webroot/index.html', 'webroot/main.js', 'webroot/app.css',
        'attest.sh', 'engine.sh', 'boot_props.sh', 'denylist.sh', 'soter_diagnose.sh',
        'tee_classes.dex',
        'lib/arm64-v8a/libTEESimulator.so', 'lib/arm64-v8a/libinject.so',
        'lib/armeabi-v7a/libTEESimulator.so', 'lib/armeabi-v7a/libinject.so',
        'bin/arm64-v8a/asfetch', 'bin/armeabi-v7a/asfetch',
        'bin/arm64-v8a/aswatcher', 'bin/armeabi-v7a/aswatcher',
    }
    with zipfile.ZipFile(path) as archive:
        assert archive.testzip() is None, f'{path}: corrupt ZIP entry'
        engine = archive.read('engine.sh').decode()
        if 'ENGINE=none' in engine.splitlines():
            assert 'classes.dex' not in archive.namelist(), f'{path}: Lite contains PIF dex'
            assert not any(n.startswith('zygisk/') and n.endswith('.so') for n in archive.namelist()), f'{path}: Lite contains PIF libraries'
        else:
            required.update({'classes.dex', 'zygisk/arm64-v8a.so', 'zygisk/armeabi-v7a.so'})
        missing = required - set(archive.namelist())
        assert not missing, f'{path}: missing {sorted(missing)}'
        props = dict(line.split('=', 1) for line in archive.read('module.prop').decode().splitlines()
                     if '=' in line and not line.startswith('#'))
        assert props.get('id') == 'tricky_store', f'{path}: wrong module id'
        assert props.get('version') and int(props['versionCode']) > 0
        for name in required:
            assert archive.getinfo(name).file_size > 0, f'{path}: empty {name}'
        for name in required:
            if name.endswith('.sh') or name.endswith('update-binary'):
                assert b'\r\n' not in archive.read(name), f'{path}: CRLF in {name}'
        for name in required:
            if '/asfetch' in name or '/aswatcher' in name or name.endswith('.so'):
                assert archive.read(name).startswith(b'\x7fELF'), f'{path}: invalid ELF {name}'
    print(f'Validated installable module ZIP: {path}')


if __name__ == '__main__':
    if len(sys.argv) < 2:
        raise SystemExit('Usage: verify-module-zip.py MODULE.zip [...]')
    for filename in sys.argv[1:]:
        verify(filename)
