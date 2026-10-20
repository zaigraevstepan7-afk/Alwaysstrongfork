"""Session-property and Magisk CLI fixtures; never touch Android or device keys."""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class HardeningTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.mod = self.base / 'module'
        shutil.copytree(ROOT / 'module', self.mod)
        self.cfg = self.base / 'config'
        (self.cfg / 'alwaysstrong').mkdir(parents=True)
        self.tools = self.base / 'tools'
        self.tools.mkdir()
        self.props = self.base / 'props.json'
        self.props.write_text('{}')
        self.writes = self.base / 'writes'
        self.magisk_state = self.base / 'magisk.json'
        self.magisk_state.write_text('[]')
        self.env = dict(os.environ, AS_CFG_ROOT=str(self.cfg), MODPATH=str(self.mod),
                        PATH=str(self.tools) + ':' + os.environ['PATH'],
                        TEST_PROPS=str(self.props), TEST_WRITES=str(self.writes),
                        TEST_MAGISK=str(self.magisk_state))
        self.tool('resetprop', '''#!/usr/bin/env python3
import json,os,sys
p=os.environ['TEST_PROPS']; data=json.load(open(p)); a=sys.argv[1:]
if not a:
 for k,v in data.items(): print('['+k+']: ['+v+']')
elif a[0]=='-n':
 with open(os.environ['TEST_WRITES'],'a') as f: f.write(a[1]+'='+a[2]+'\\n')
 if os.environ.get('TEST_REJECT')==a[1]: sys.exit(1)
 if os.environ.get('TEST_IGNORE')!=a[1]: data[a[1]]=a[2]; json.dump(data,open(p,'w'))
else: print(data.get(a[0],''))
''')
        self.tool('getprop', '''#!/usr/bin/env python3
import json,os,sys
print(json.load(open(os.environ['TEST_PROPS'])).get(sys.argv[1],''))
''')
        self.tool('magisk', '''#!/usr/bin/env python3
import json,os,sys
p=os.environ['TEST_MAGISK']; data=json.load(open(p)); a=sys.argv[1:]
assert a[0]=='--denylist'
if a[1]=='status': sys.exit(0 if os.environ.get('TEST_ENFORCE')=='1' else 1)
if a[1]=='ls':
 for pkg,proc in data: print(pkg+'|'+proc)
elif a[1]=='add':
 assert len(a)==4
 if a[2:] not in data: data.append(a[2:]); json.dump(data,open(p,'w'))
else: raise RuntimeError('forbidden DenyList operation '+repr(a))
''')
        self.tool('ps', '#!/bin/sh\nprintf "%s\\n" NAME com.example.bank com.example.bank:worker com.example.banking:other /system/bin/sh\n')
        self.tool('log', '#!/bin/sh\nexit 0\n')

    def tool(self, name, body):
        p = self.tools / name
        p.write_text(body)
        p.chmod(0o755)

    def run_script(self, name, *args):
        return subprocess.run(['sh', str(self.mod / name), *args], env=self.env,
                              capture_output=True, text=True, timeout=10)

    def settings(self, **values):
        (self.cfg / 'alwaysstrong/config').write_text(''.join(f'{k}={v}\n' for k, v in values.items()))

    def test_policy_corrects_existing_aliases_without_inventing_or_touching_identity(self):
        original = {'ro.boot.verifiedbootstate':'orange', 'ro.vendor.boot.verifiedbootstate':'orange',
                    'vendor.boot.vbmeta.device_state':'unlocked', 'ro.vendor.boot.flash.locked':'0',
                    'ro.vendor.boot.veritymode':'logging', 'ro.debuggable':'1',
                    'ro.force.debuggable':'1', 'ro.secure':'0', 'ro.vendor.build.type':'userdebug',
                    'ro.system.build.tags':'test-keys', 'ro.product.model':'OnePlus',
                    'ro.crypto.state':'encrypted', 'ro.boot.vbmeta.digest':'0000',
                    'ro.build.fingerprint':'contains.ro.vendor.build.type',
                    'persist.example':'untouched'}
        self.props.write_text(json.dumps(original))
        r = self.run_script('boot_props.sh')
        self.assertEqual(r.returncode, 0, r.stdout+r.stderr)
        after = json.loads(self.props.read_text())
        self.assertEqual(set(after), set(original))
        for k, v in {'ro.boot.verifiedbootstate':'green','ro.vendor.boot.verifiedbootstate':'green',
                     'vendor.boot.vbmeta.device_state':'locked','ro.vendor.boot.flash.locked':'1',
                     'ro.vendor.boot.veritymode':'enforcing','ro.debuggable':'0',
                     'ro.force.debuggable':'0','ro.secure':'1', 'ro.vendor.build.type':'user',
                     'ro.system.build.tags':'release-keys'}.items(): self.assertEqual(after[k], v)
        for k in ['ro.product.model','ro.crypto.state','ro.boot.vbmeta.digest',
                  'ro.build.fingerprint','persist.example']: self.assertEqual(after[k], original[k])
        count = len(self.writes.read_text().splitlines())
        self.assertEqual(self.run_script('boot_props.sh').returncode, 0)
        self.assertEqual(len(self.writes.read_text().splitlines()), count)

    def test_check_is_read_only_and_reports_mismatches(self):
        self.props.write_text(json.dumps({'ro.boot.flash.locked':'0'}))
        r = self.run_script('boot_props.sh','check')
        self.assertEqual(r.returncode, 1)
        self.assertIn('ro.boot.flash.locked', r.stdout)
        self.assertFalse(self.writes.exists())

    def test_failed_and_silently_ignored_writes_are_detected(self):
        for kind in ['TEST_REJECT','TEST_IGNORE']:
            with self.subTest(kind=kind):
                self.props.write_text(json.dumps({'ro.debuggable':'1'}))
                self.env[kind] = 'ro.debuggable'
                self.assertEqual(self.run_script('boot_props.sh').returncode, 1)
                del self.env[kind]

    def test_recovery_is_untouched(self):
        for mode in ['recovery','charger','rescue','fastboot','fastbootd']:
            self.props.write_text(json.dumps({'ro.bootmode':mode,'ro.debuggable':'1'}))
            self.assertEqual(self.run_script('boot_props.sh').returncode, 0)
            self.assertFalse(self.writes.exists())

    def test_startup_gate_applies_policy_before_launch_and_blocks_failed_policy(self):
        source = (self.mod/'service.sh').read_text()
        function = re.search(r'^start_attestation\(\) \{.*?^\}',source,re.S|re.M).group()
        # Execute the real startup function with isolated keystore/boot stubs.
        for name in ['boot_safety.sh','keybox_manage.sh']:
            (self.mod/name).write_text('#!/bin/sh\nexit 0\n')
        gate = self.base/'gate.sh'
        marker = self.base/'launched'
        gate.write_text('''MODDIR="$MODPATH"
AS_LOGS="$AS_CFG_ROOT/alwaysstrong"
AS_DIR="$AS_LOGS"
AS_BOOT_CURRENT=fixture
as_bounded() { shift; "$@"; }
attest_start() { [ "$(resetprop ro.boot.flash.locked)" = 1 ] && touch "$TEST_LAUNCH"; }
'''+function+'\nstart_attestation\n')
        self.env['TEST_LAUNCH'] = str(marker)
        self.props.write_text(json.dumps({'ro.boot.flash.locked':'0'}))
        r = subprocess.run(['sh',str(gate)],env=self.env,capture_output=True,text=True,timeout=10)
        self.assertEqual(r.returncode,0,r.stderr)
        self.assertTrue(marker.exists())
        marker.unlink()
        self.props.write_text(json.dumps({'ro.boot.flash.locked':'0'}))
        self.env['TEST_REJECT']='ro.boot.flash.locked'
        r = subprocess.run(['sh',str(gate)],env=self.env,capture_output=True,text=True,timeout=10)
        self.assertEqual(r.returncode,1,r.stderr)
        self.assertFalse(marker.exists())

    def test_supervisor_does_not_spawn_daemon_when_property_policy_fails(self):
        for name in ['boot_safety.sh','keybox_manage.sh']:
            (self.mod/name).write_text('#!/bin/sh\nexit 0\n')
        helper=self.tools/'native-helper'
        helper.write_text('#!/bin/sh\n[ "$1" = run-bounded ] || exit 1\nshift 2\nexec "$@"\n')
        helper.chmod(0o755)
        self.env['AS_NATIVE_TOOL']=str(helper)
        self.env['TEST_REJECT']='ro.boot.flash.locked'
        self.props.write_text(json.dumps({'ro.boot.flash.locked':'0'}))
        marker=self.base/'daemon-started'
        self.env['TEST_LAUNCH']=str(marker)
        (self.mod/'daemon').write_text('#!/bin/sh\ntouch "$TEST_LAUNCH"\nexit 1\n')
        r=self.run_script('attest_supervise.sh','tee','__locked')
        self.assertEqual(r.returncode,0,r.stderr)
        self.assertFalse(marker.exists())
        self.assertIn('failed=1',(self.cfg/'alwaysstrong/logs/boot-props.log').read_text())

    def test_enforcement_on_never_changes_list(self):
        self.settings(denylist_targets=1)
        self.env['TEST_ENFORCE']='1'
        self.assertEqual(self.run_script('denylist.sh').returncode,0)
        self.assertEqual(json.loads(self.magisk_state.read_text()),[])

    def test_sync_preserves_user_entries_and_is_idempotent(self):
        keep=[['com.user.choice','com.user.choice:private']]
        self.magisk_state.write_text(json.dumps(keep))
        self.assertEqual(self.run_script('denylist.sh').returncode,0)
        once=json.loads(self.magisk_state.read_text())
        self.assertIn(keep[0],once)
        self.assertEqual(self.run_script('denylist.sh').returncode,0)
        self.assertEqual(json.loads(self.magisk_state.read_text()),once)

    def test_selected_targets_parse_modes_sections_and_running_processes_safely(self):
        self.settings(denylist_targets=1)
        (self.cfg/'target.txt').write_text('''# fixture
com.example.bank!
com.example.bank@10?
[secondary.xml]
com.example.other?
uid:12345
bad;touch /tmp/not-a-command
''')
        self.assertEqual(self.run_script('denylist.sh').returncode,0)
        entries=json.loads(self.magisk_state.read_text())
        self.assertIn(['com.example.bank','com.example.bank'],entries)
        self.assertIn(['com.example.bank','com.example.bank:worker'],entries)
        self.assertIn(['com.example.other','com.example.other'],entries)
        self.assertFalse(any('banking:other' in p[1] for p in entries))
        self.assertFalse(any(p[0].startswith(('uid:','[','bad')) for p in entries))

    def test_target_sync_is_opt_in_and_master_opt_out_wins(self):
        (self.cfg/'target.txt').write_text('com.example.bank!\n')
        self.assertEqual(self.run_script('denylist.sh').returncode,0)
        self.assertNotIn(['com.example.bank','com.example.bank'],json.loads(self.magisk_state.read_text()))
        self.magisk_state.write_text('[]')
        self.settings(denylist_gms=0,denylist_targets=1)
        self.assertEqual(self.run_script('denylist.sh').returncode,0)
        self.assertEqual(json.loads(self.magisk_state.read_text()),[])


if __name__=='__main__': unittest.main()
