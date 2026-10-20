#!/usr/bin/env python3
"""Check the independent mount-isolation module without treating it as TEE/PIF."""
import sys
import zipfile
for name in sys.argv[1:]:
    with zipfile.ZipFile(name) as z:
        assert z.testzip() is None
        required={'module.prop','customize.sh','service.sh','targets.sh','targets.list','private-fonts','webroot/index.html',
                  'webroot/main.js','zygisk/arm64-v8a.so','zygisk/armeabi-v7a.so',
                  'META-INF/com/google/android/update-binary','META-INF/com/google/android/updater-script'}
        assert required <= set(z.namelist())
        props=dict(x.split('=',1) for x in z.read('module.prop').decode().splitlines() if '=' in x)
        assert props['id']=='alwaysstrong_isolation'
        assert z.read('private-fonts').strip()==b'0'
        assert '.boot-ready' not in z.namelist()
        assert int(props['versionCode'])>0
        assert not {'tee_classes.dex','classes.dex','sepolicy.rule'} & set(z.namelist())
        for abi in ['arm64-v8a','armeabi-v7a']:
            data=z.read(f'zygisk/{abi}.so'); assert data.startswith(b'\x7fELF')
            assert b'mremap' not in data
            assert b'zygisk_module_entry' in data and b'zygisk_companion_entry' in data
        print('Validated optional isolation ZIP:',name)
