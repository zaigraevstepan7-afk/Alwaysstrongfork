"""Native selection/remapping tests and the actual companion config writer."""
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
    def test_native_private_font_copy_preserves_bytes_addresses_and_permissions(self): self.native_test('font_copy_test.cpp')
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

if __name__=='__main__':unittest.main()
