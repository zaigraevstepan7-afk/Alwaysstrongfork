"""Exercise the actual installer WebUI block against real ZIP contents."""
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]

class WebUIInstallTests(unittest.TestCase):
    def run_install(self, omit=None):
        text = (ROOT/'module/customize.sh').read_text()
        block = text[text.index('# --- WebUI'):text.index('# --- /data/adb/tricky_store')]
        install_function = re.search(r'^install_file\(\).*$',text,re.M).group()
        script = 'set -e\nui_print() { :; }\nabort() { echo "$*" >&2; exit 1; }\n'+install_function+'\n'+block
        with tempfile.TemporaryDirectory() as td:
            base=Path(td); archive=base/'module.zip'
            with zipfile.ZipFile(archive,'w') as z:
                for p in (ROOT/'module/webroot').iterdir():
                    if p.is_file() and p.name != omit:z.write(p,'webroot/'+p.name)
            results=[]
            for manager,ksu,apatch in [('Magisk','false','false'),('KernelSU','true','false'),('APatch','false','true')]:
                dest=base/manager
                env=dict(os.environ,MODPATH=str(dest),ZIPFILE=str(archive),KSU=ksu,APATCH=apatch)
                r=subprocess.run(['sh','-c',script],env=env,capture_output=True,text=True)
                results.append(r)
                if omit is None:
                    self.assertEqual(r.returncode,0,r.stderr)
                    for name in ['index.html','main.js','app.css']:
                        self.assertEqual((dest/'webroot'/name).read_bytes(),(ROOT/'module/webroot'/name).read_bytes())
                        self.assertEqual((dest/'webroot'/name).stat().st_mode & 0o777,0o644)
                else:self.assertNotEqual(r.returncode,0)
            return results
    def test_all_webui_files_installed_for_each_manager(self):self.run_install()
    def test_missing_javascript_aborts_installation(self):self.run_install('main.js')
    def test_unrelated_widevine_provisioning_is_not_offered_or_bundled(self):
        self.assertNotIn('id="wvRow"',(ROOT/'module/webroot/index.html').read_text())
        self.assertNotIn('widevine_l1.sh',(ROOT/'module/webroot/main.js').read_text())
        self.assertFalse((ROOT/'module/widevine_l1.sh').exists())
        self.assertFalse((ROOT/'module/widevine_l1_attestation.xml').exists())

if __name__=='__main__':unittest.main(verbosity=2)
