"""Exercise detached Action requests with the actual native lock/deadline helper."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
HOST = ROOT / 'native/asfetch/target/debug/asfetch'


class WebUIActionTests(unittest.TestCase):
    def setUp(self):
        if not HOST.exists():
            raise RuntimeError('Build host asfetch with cargo build --locked before running tests')
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.mod = self.base / 'module'
        self.mod.mkdir()
        for name in ['as_store.sh', 'repair_runtime.sh', 'webui_action.sh', 'module.prop']:
            shutil.copyfile(ROOT / 'module' / name, self.mod / name)
        self.cfg = self.base / 'config'
        self.logs = self.cfg / 'alwaysstrong/logs'
        self.env = dict(os.environ, AS_CFG_ROOT=str(self.cfg), AS_NATIVE_TOOL=str(HOST))
        # Keep the real manager/global-lock prologue, replace only Android work.
        self.prefix = (ROOT / 'module/action.sh').read_text().split('LINE="')[0]
        self.worker('echo first; command sleep 0.5; echo last; echo warning >&2; exit 0\n')

    def worker(self, body):
        (self.mod / 'action.sh').write_text(self.prefix + body)

    def request(self, command):
        result = subprocess.run(['sh', str(self.mod / 'webui_action.sh'), command],
                                env=self.env, capture_output=True, text=True, timeout=3)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout

    def wait_status(self, expected):
        until = time.monotonic() + 5
        output = ''
        while time.monotonic() < until:
            output = self.request('status')
            if expected in output:
                return output
            time.sleep(0.03)
        self.fail('Status never reached ' + expected + ': ' + output)

    def test_live_output_duplicate_start_and_reconnect(self):
        self.assertIn('state=idle', self.request('status'))
        self.assertIn('started', self.request('start'))
        partial = self.wait_status('first')
        self.assertIn('state=running', partial)
        self.assertNotIn('last', partial)
        self.assertIn('running', self.request('start'))
        done = self.wait_status('state=finished')
        self.assertIn('code=0', done)
        self.assertIn('first\nlast\nwarning', done)
        # A fresh process sees the same saved log and exit status.
        self.assertEqual(done, self.request('status'))

    def test_nonzero_exit_and_new_run(self):
        self.worker('echo failed >&2; exit 7\n')
        self.request('start')
        self.assertIn('code=7', self.wait_status('state=finished'))
        self.worker('echo replacement; exit 0\n')
        self.request('start')
        done = self.wait_status('code=0')
        self.assertIn('replacement', done)
        self.assertNotIn('failed', done)

    def test_abandoned_run_is_marked_interrupted(self):
        self.logs.mkdir(parents=True)
        (self.logs / 'action-webui.status').write_text('state=running\ncode=\n')
        (self.logs / 'action-webui.log').write_text('preserved\n')
        result = self.request('status')
        self.assertIn('state=interrupted\ncode=143', result)
        self.assertIn('preserved', result)

    def test_native_deadline_stops_worker(self):
        runner = self.mod / 'webui_action.sh'
        runner.write_text(runner.read_text().replace('as_bounded 480', 'as_bounded 1'))
        self.worker('echo waiting; command sleep 2; echo escaped > "$AS_DIR/escaped"\n')
        self.request('start')
        self.assertIn('code=124', self.wait_status('state=finished'))
        time.sleep(1.2)
        self.assertFalse((self.cfg / 'alwaysstrong/escaped').exists())

    def test_manager_and_webui_share_global_action_lock(self):
        self.worker('echo owned > "$AS_DIR/owned"; command sleep 1\n')
        manager = subprocess.Popen(['sh', str(self.mod / 'action.sh')], env=self.env,
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            until = time.monotonic() + 2
            while not (self.cfg / 'alwaysstrong/owned').exists() and time.monotonic() < until:
                time.sleep(0.02)
            self.assertTrue((self.cfg / 'alwaysstrong/owned').exists())
            self.request('start')
            done = self.wait_status('state=finished')
            self.assertIn('code=75', done)
            self.assertIn('already running', done)
        finally:
            manager.wait(timeout=3)

    def test_bridge_output_is_bounded_full_log_is_kept(self):
        self.logs.mkdir(parents=True)
        (self.logs / 'action-webui.status').write_text('state=finished\ncode=0\n')
        (self.logs / 'action-webui.log').write_text('x' * 100000)
        self.assertEqual(len(self.request('status').split('--log--\n')[1]), 65536)
        self.assertEqual((self.logs / 'action-webui.log').stat().st_size, 100000)

    def test_installer_includes_backend(self):
        self.assertIn('action.sh webui_action.sh', (ROOT / 'module/customize.sh').read_text())


if __name__ == '__main__':
    unittest.main(verbosity=2)
