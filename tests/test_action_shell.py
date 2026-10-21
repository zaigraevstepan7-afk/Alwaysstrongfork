"""Run the real Action header/body under Android's mksh and other host shells."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
MKSH = os.environ.get('AS_TEST_MKSH') or shutil.which('mksh')


class ActionShellTests(unittest.TestCase):
    def setUp(self):
        if not MKSH:
            raise RuntimeError('Install mksh or set AS_TEST_MKSH for Android shell regression tests')
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.mod = self.base / 'module'
        self.mod.mkdir()
        for name in ['action.sh', 'as_store.sh', 'repair_runtime.sh', 'module.prop']:
            shutil.copyfile(ROOT / 'module' / name, self.mod / name)
        self.cfg = self.base / 'config'
        self.bin = self.base / 'bin'
        self.bin.mkdir()
        self.env = dict(os.environ, AS_CFG_ROOT=str(self.cfg), AS_FAST='1',
                        AS_ACTION_LOCKED='1', AS_ASH='1',
                        PATH=str(self.bin) + os.pathsep + os.environ['PATH'])
        self.script('engine.sh', '''ENGINE=fork
ENGINE_NATIVE_TIMEOUT=2
ENGINE_AUTOPIF_TIMEOUT=2
engine_enforce_spoof() { return "${TEST_ENGINE_RC:-0}"; }
engine_install_pif() { return 0; }
engine_autopif() { return 1; }
''')
        self.script('build_target_txt.sh', 'echo com.example.fixture > "$1"; exit "${TEST_TARGET_RC:-0}"\n')
        self.script('keybox_manage.sh', 'exit "${TEST_KEYBOX_RC:-0}"\n')
        self.script('boot_props.sh', 'exit "${TEST_PROPS_RC:-0}"\n')
        self.script('sync_patch.sh', 'echo 2026-10-01; exit 0\n')
        self.script('status_fetch.sh', 'exit 0\n')
        self.cfg.joinpath('alwaysstrong').mkdir(parents=True)
        self.cfg.joinpath('alwaysstrong/config').write_text('custom_keybox=1\ncustom_pif=1\n')
        # Never signal actual host processes or invoke Android tools.
        for name in ['killall', 'getprop', 'resetprop']:
            self.tool(name, 'exit 0\n')
        self.tool('am', 'exit "${TEST_AM_RC:-0}"\n')

    def script(self, name, body):
        path = self.mod / name
        path.write_text(body)
        path.chmod(0o755)

    def tool(self, name, body):
        path = self.bin / name
        path.write_text('#!/bin/sh\n' + body)
        path.chmod(0o755)

    def run_action(self, **overrides):
        return subprocess.run([MKSH, str(self.mod / 'action.sh')],
                              env=dict(self.env, **overrides), capture_output=True,
                              text=True, timeout=5)

    def test_header_function_and_tagged_version_survive_mksh_parsing(self):
        # This is the complete real preamble up to the first progress row.
        # Before the fix mksh swallowed row() into the unquoted '(' pattern.
        source = (ROOT / 'module/action.sh').read_text().split('# --- Header ---')[0]
        self.script('action.sh', source + '\nrow test header-ok\nprintf "VER=%s\\n" "$VER"\n')
        props = self.mod / 'module.prop'
        props.write_text(props.read_text().replace(
            '\nversionCode=', ' (fixture-build)\nversionCode=', 1))
        shells = [[MKSH], ['bash'], ['sh']]
        if shutil.which('busybox'):
            shells.append(['busybox', 'sh'])
        for shell in shells:
            with self.subTest(shell=shell):
                result = subprocess.run(shell + [str(self.mod / 'action.sh')],
                                        env=self.env, capture_output=True, text=True, timeout=5)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn('test   header-ok', result.stdout)
                self.assertNotIn('fixture-build', result.stdout)
                self.assertNotIn('not found', result.stderr)

    def test_full_action_succeeds_in_mksh_without_busybox(self):
        result = self.run_action()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('AlwaysStrong', result.stdout)
        self.assertIn('done', result.stdout)
        self.assertNotIn('not found', result.stderr)

    def test_failed_steps_never_report_success(self):
        for key in ['TEST_TARGET_RC', 'TEST_KEYBOX_RC', 'TEST_ENGINE_RC', 'TEST_PROPS_RC']:
            with self.subTest(step=key):
                result = self.run_action(**{key: '1'})
                self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
                self.assertIn('finished with 1 error(s)', result.stdout)
                self.assertNotIn('✅', result.stdout)

    def test_warning_has_a_distinct_exit_status(self):
        result = self.run_action(TEST_AM_RC='1')
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertIn('finished with 1 warning(s)', result.stdout)
        self.assertNotIn('✅', result.stdout)

    def test_old_exported_ash_flag_cannot_skip_new_process_hop(self):
        # Emulate a manager BusyBox that execs a fresh shell, with the same PID.
        busybox = self.bin / 'manager-busybox'
        hop_log = self.base / 'hops'
        busybox.write_text('#!/bin/sh\necho hop >> "$TEST_HOP_LOG"\nshift\nexec /bin/sh "$@"\n')
        busybox.chmod(0o755)
        source = (self.mod / 'action.sh').read_text()
        self.script('action.sh', source.replace('/data/adb/magisk/busybox', str(busybox)))
        result = self.run_action(TEST_HOP_LOG=str(hop_log))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(hop_log.read_text(), 'hop\n')

    def test_missing_engine_function_fails_before_progress(self):
        self.script('engine.sh', 'ENGINE=fork\n')
        result = self.run_action()
        self.assertEqual(result.returncode, 1)
        self.assertIn('required function engine_enforce_spoof is unavailable', result.stderr)
        self.assertNotIn('✅', result.stdout)


if __name__ == '__main__':
    unittest.main(verbosity=2)
