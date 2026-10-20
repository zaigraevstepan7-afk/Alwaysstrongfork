"""Native selection/IPC safety tests and the actual companion config writer."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
ROOT=Path(__file__).resolve().parents[1]

class IsolationTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.base=Path(self.tmp.name)
    def native_test(self,name):
        binary=self.base/'test'
        subprocess.run(['g++','-std=c++17','-Wall','-Wextra','-Werror',str(ROOT/'native/isolation'/name),'-o',str(binary)],check=True,capture_output=True)
        r=subprocess.run([str(binary)],capture_output=True,text=True,timeout=10)
        self.assertEqual(r.returncode,0,r.stdout+r.stderr)
    def test_native_package_uid_and_protected_process_policy(self): self.native_test('policy_test.cpp')
    def test_native_config_and_slow_peer_fail_without_blocking(self): self.native_test('safety_test.cpp')
    def test_invalid_package_edit_preserves_previous_list(self):
        mod=self.base/'module';shutil.copytree(ROOT/'isolation-module',mod)
        old=(mod/'targets.list').read_bytes()
        for value in ['com.example.app; touch /tmp/oops','/data/adb/modules/foo','com..app','com.app\nnot a package']:
            r=subprocess.run(['sh',str(mod/'targets.sh'),'set',value],capture_output=True)
            self.assertNotEqual(r.returncode,0)
            self.assertEqual((mod/'targets.list').read_bytes(),old)
    def test_valid_edit_and_font_toggle(self):
        mod=self.base/'module';shutil.copytree(ROOT/'isolation-module',mod)
        for args in [('set','com.example.app\ncom.example.other'),('fonts-set','0')]:
            r=subprocess.run(['sh',str(mod/'targets.sh'),*args],capture_output=True)
            self.assertEqual(r.returncode,0,r.stderr)
        self.assertEqual((mod/'targets.list').read_text(),'com.example.app\ncom.example.other\n')
        self.assertEqual((mod/'private-fonts').read_text(),'0\n')
        self.assertEqual((mod/'targets.list').stat().st_mode&0o777,0o600)
        r=subprocess.run(['sh',str(mod/'targets.sh'),'fonts-set','2'],capture_output=True)
        self.assertNotEqual(r.returncode,0)
        self.assertEqual((mod/'private-fonts').read_text(),'0\n')

    def test_retired_font_memory_option_cannot_be_reenabled(self):
        mod=self.base/'module';shutil.copytree(ROOT/'isolation-module',mod)
        (mod/'private-fonts').write_text('1\n')
        result=subprocess.run(['sh',str(mod/'targets.sh'),'fonts-set','1'],capture_output=True)
        self.assertNotEqual(result.returncode,0)
        result=subprocess.run(['sh',str(mod/'targets.sh'),'fonts-get'],capture_output=True,text=True)
        self.assertEqual(result.stdout,'0\n')

    def service_fixture(self,completed='1',mode='normal'):
        mod=self.base/'module';shutil.copytree(ROOT/'isolation-module',mod)
        boot=self.base/'boot';boot.write_text('12345678-1234-1234-1234-123456789abc\n')
        state=self.base/'completed';state.write_text(completed)
        tools=self.base/'tools';tools.mkdir()
        getprop=tools/'getprop';getprop.write_text('#!/bin/sh\ncase "$1" in sys.boot_completed) cat "$TEST_COMPLETED" ;; *) echo "$TEST_MODE" ;; esac\n');getprop.chmod(0o755)
        sleep=tools/'sleep';sleep.write_text('#!/bin/sh\n[ "$1" != 120 ] || echo settled >> "$TEST_SETTLED"\n[ "$TEST_DISABLE" != 1 ] || touch "$TEST_MODULE/disable"\n');sleep.chmod(0o755)
        self.service_mod=mod
        env=dict(os.environ,AS_BOOT_ID_FILE=str(boot),TEST_COMPLETED=str(state),TEST_MODE=mode,
                 TEST_SETTLED=str(self.base/'settled'),TEST_MODULE=str(mod),TEST_DISABLE='0',PATH=str(tools)+':'+os.environ['PATH'])
        return mod,env,boot

    def test_service_enables_only_settled_current_boot(self):
        mod,env,boot=self.service_fixture()
        r=subprocess.run(['sh',str(mod/'service.sh')],env=env,capture_output=True,timeout=4)
        self.assertEqual(r.returncode,0,r.stderr)
        self.assertTrue((self.base/'settled').exists())
        self.assertEqual((mod/'.boot-ready').read_text(),boot.read_text())

    def test_service_cannot_activate_after_disable_during_settle(self):
        mod,env,boot=self.service_fixture();env['TEST_DISABLE']='1'
        subprocess.run(['sh',str(mod/'service.sh')],env=env,check=True,timeout=4)
        self.assertFalse((mod/'.boot-ready').exists())

    def test_service_recovery_or_incomplete_boot_stays_inactive(self):
        mod,env,boot=self.service_fixture(completed='0')
        for mode in ['recovery','fastbootd','normal']:
            env['TEST_MODE']=mode
            subprocess.run(['sh',str(mod/'service.sh')],env=env,check=True,timeout=5)
            self.assertFalse((mod/'.boot-ready').exists())
            self.assertFalse((self.base/'settled').exists())

if __name__=='__main__':unittest.main()
