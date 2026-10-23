"""Boot-path fixtures never access Android properties, devices or keystore."""
import fcntl, os, pathlib, signal, subprocess, time, unittest
import test_repair as repair_fixture
HOST = repair_fixture.HOST

class BootSafetyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls): repair_fixture.RepairTests.setUpClass.__func__(cls)
    @classmethod
    def tearDownClass(cls): repair_fixture.RepairTests.tearDownClass.__func__(cls)
    sh = repair_fixture.RepairTests.sh
    setting = repair_fixture.RepairTests.setting
    def setUp(self):
        repair_fixture.RepairTests.setUp(self)
        self.boot=self.d/'boot-id';self.boot.write_text('boot-a')
        self.completed=self.d/'completed';self.completed.write_text('1')
        self.mode=self.d/'mode';self.mode.write_text('normal')
        self.tools=self.d/'tools';self.tools.mkdir()
        getprop=self.tools/'getprop'
        getprop.write_text('#!/bin/sh\ncase "$1" in sys.boot_completed) cat "$AS_BOOT_COMPLETED_FILE" ;; ro.bootmode|ro.boot.mode|ro.boot.bootmode|vendor.bootmode) cat "$AS_BOOT_MODE_FILE" ;; esac\n')
        getprop.chmod(0o755)
        for name in ['log','resetprop']:
            f=self.tools/name;f.write_text('#!/bin/sh\nexit 0\n');f.chmod(0o755)
        pidof=self.tools/'pidof';pidof.write_text('#!/bin/sh\n[ "$1" = keystore2 ] && echo 100\n');pidof.chmod(0o755)
        self.env.update(AS_BOOT_ID_FILE=str(self.boot),AS_BOOT_COMPLETED_FILE=str(self.completed),AS_BOOT_MODE_FILE=str(self.mode),PATH=str(self.tools)+':'+self.env['PATH'])
    def tearDown(self): repair_fixture.RepairTests.tearDown(self)
    def fast_sleep(self):
        f=self.tools/'sleep';f.write_text('#!/bin/sh\n/bin/sleep 0.03\n');f.chmod(0o755)
    def daemon(self, body):
        p=self.mod/'daemon';p.write_text('#!/bin/sh\n'+body);p.chmod(0o755)
    def safe_early_fixtures(self):
        (self.mod/'common_func.sh').write_text('SKIPDELPROP=false\nresetprop_if_diff() { :; }\nresetprop_if_match() { :; }\ndelprop_if_exist() { :; }\n')
        for name in ['sync_patch.sh','rom_spoof_block.sh']:(self.mod/name).write_text('#!/bin/sh\nexit 0\n')
    def test_post_fs_does_not_take_config_locks_or_run_repair(self):
        self.safe_early_fixtures();self.setting('custom_keybox','1')
        touched=self.d/'early-repair';self.env['EARLY_REPAIR_MARKER']=str(touched)
        for name in ['repair_init.sh','keybox_manage.sh']:
            (self.mod/name).write_text('#!/bin/sh\ntouch "$EARLY_REPAIR_MARKER"\nsleep 30\n')
        lock=self.cfg/'alwaysstrong/config.flock'
        with lock.open('w') as held:
            fcntl.flock(held,fcntl.LOCK_EX|fcntl.LOCK_NB)
            start=time.monotonic();self.sh('post-fs-data.sh',ok=0,timeout=8)
        self.assertLess(time.monotonic()-start,3)
        self.assertFalse(touched.exists())
    def test_post_fs_hung_worker_is_stopped_within_stage_budget(self):
        self.safe_early_fixtures()
        (self.mod/'sync_patch.sh').write_text('#!/bin/sh\nsleep 30\n')
        start=time.monotonic();self.sh('post-fs-data.sh',ok=0,timeout=9)
        self.assertLess(time.monotonic()-start,8)
    def test_three_unfinished_boots_disable_only_this_module(self):
        other=self.d/'other-module';other.mkdir();(other/'keep').write_text('untouched')
        libs=self.mod/'zygisk';libs.mkdir()
        for abi in ['arm64-v8a','armeabi-v7a','x86','x86_64']:(libs/(abi+'.so')).write_bytes(abi.encode())
        self.sh('boot_safety.sh','begin',ok=0);self.sh('boot_safety.sh','begin',ok=0)
        self.assertIn('attempts=1',(self.cfg/'alwaysstrong/boot-state').read_text())
        self.assertTrue((libs/'arm64-v8a.so').exists())
        self.boot.write_text('boot-b');self.sh('boot_safety.sh','begin',ok=0)
        self.boot.write_text('boot-c');self.sh('boot_safety.sh','begin',ok=1)
        self.assertTrue((self.mod/'disable').exists());self.assertTrue((self.cfg/'alwaysstrong/boot-safe').exists())
        self.assertEqual((other/'keep').read_text(),'untouched');self.assertFalse((other/'disable').exists())
        self.assertFalse(libs.exists())
        for abi in ['arm64-v8a','armeabi-v7a','x86','x86_64']:
            self.assertEqual((self.mod/'.boot-safe-zygisk'/(abi+'.so')).read_bytes(),abi.encode())
        # A manager enable removes disable, but must not restore a loadable ABI.
        for command in ['begin','allow']:
            (self.mod/'disable').unlink();self.boot.write_text('boot-reenabled')
            self.sh('boot_safety.sh',command,ok=1)
            self.assertTrue((self.mod/'disable').exists());self.assertFalse(libs.exists())

    def latch_guard(self):
        (self.cfg/'alwaysstrong').mkdir(exist_ok=True)
        (self.cfg/'alwaysstrong/boot-safe').touch()
        libs=self.mod/'zygisk';libs.mkdir()
        (libs/'arm64-v8a.so').write_bytes(b'PIF fixture')

    def test_legacy_latch_quarantines_before_missing_native_runtime(self):
        for entry in ['post-fs-data.sh','service.sh']:
            with self.subTest(entry=entry):
                self.latch_guard()
                self.env['AS_NATIVE_TOOL']=str(self.d/'missing')
                self.sh(entry,ok=0,timeout=3)
                self.assertTrue((self.mod/'disable').exists())
                self.assertFalse((self.mod/'zygisk').exists())
                self.assertEqual((self.mod/'.boot-safe-zygisk/arm64-v8a.so').read_bytes(),b'PIF fixture')
                (self.mod/'.boot-safe-zygisk/arm64-v8a.so').unlink()
                (self.mod/'.boot-safe-zygisk').rmdir()
                (self.mod/'disable').unlink()

    def test_recreated_payload_is_quarantined_without_nested_directory(self):
        self.latch_guard();self.sh('boot_safety.sh','enforce',ok=1)
        (self.mod/'disable').unlink();(self.mod/'zygisk').mkdir()
        (self.mod/'zygisk/arm64-v8a.so').write_bytes(b'new staged PIF')
        (self.mod/'zygisk/armeabi-v7a.so').write_bytes(b'new 32-bit PIF')
        self.sh('boot_safety.sh','enforce',ok=1)
        self.assertFalse((self.mod/'zygisk').exists())
        self.assertFalse((self.mod/'.boot-safe-zygisk/zygisk').exists())
        self.assertEqual((self.mod/'.boot-safe-zygisk/arm64-v8a.so').read_bytes(),b'new staged PIF')
        self.assertEqual((self.mod/'.boot-safe-zygisk/armeabi-v7a.so').read_bytes(),b'new 32-bit PIF')

    def test_recovery_restores_payload_only_explicitly_and_keeps_disabled(self):
        self.latch_guard();self.sh('boot_safety.sh','enforce',ok=1)
        (self.cfg/'alwaysstrong/boot-state').write_text('boot_id=old\nattempts=3\n')
        self.sh('boot_safety.sh','recover',ok=0)
        self.assertTrue((self.mod/'disable').exists())
        self.assertFalse((self.cfg/'alwaysstrong/boot-safe').exists())
        self.assertFalse((self.cfg/'alwaysstrong/boot-state').exists())
        self.assertEqual((self.mod/'zygisk/arm64-v8a.so').read_bytes(),b'PIF fixture')
        self.sh('boot_safety.sh','begin',ok=1)
        (self.mod/'disable').unlink();self.boot.write_text('boot-recovered')
        self.sh('boot_safety.sh','begin',ok=0)
        self.assertIn('attempts=1',(self.cfg/'alwaysstrong/boot-state').read_text())

    def test_recovery_refuses_incomplete_boot_removal_or_missing_lock_helper(self):
        self.latch_guard();self.sh('boot_safety.sh','enforce',ok=1)
        self.completed.write_text('0');self.sh('boot_safety.sh','recover',ok=1)
        self.completed.write_text('1');self.mode.write_text('recovery')
        self.sh('boot_safety.sh','recover',ok=1);self.mode.write_text('normal')
        (self.mod/'remove').touch()
        self.sh('boot_safety.sh','recover',ok=1);(self.mod/'remove').unlink()
        self.env['AS_NATIVE_TOOL']=str(self.d/'missing')
        self.sh('boot_safety.sh','recover',ok=1)
        self.assertTrue((self.cfg/'alwaysstrong/boot-safe').exists())
        self.assertTrue((self.mod/'disable').exists());self.assertFalse((self.mod/'zygisk').exists())

    def test_lite_recovery_does_not_create_a_zygisk_payload(self):
        (self.cfg/'alwaysstrong').mkdir();(self.cfg/'alwaysstrong/boot-safe').touch()
        self.sh('boot_safety.sh','enforce',ok=1)
        self.sh('boot_safety.sh','recover',ok=0)
        self.assertTrue((self.mod/'disable').exists());self.assertFalse((self.mod/'zygisk').exists())

    def test_installer_preserves_latch_for_staged_payload(self):
        self.latch_guard()
        text=(self.mod/'customize.sh').read_text()
        block=text[text.index('# --- Preserve boot-safe'):text.index('# --- WebUI')]
        script='set -e\nui_print() { :; }\nabort() { echo "$*" >&2; exit 1; }\n'+block
        self.env['CONFIG_DIR']=str(self.cfg)
        r=subprocess.run(['sh','-c',script],env=self.env,capture_output=True,text=True,timeout=3)
        self.assertEqual(r.returncode,0,r.stderr)
        self.assertTrue((self.mod/'disable').exists());self.assertFalse((self.mod/'zygisk').exists())
        self.assertTrue((self.cfg/'alwaysstrong/boot-safe').exists())

    def test_installer_refuses_update_when_payload_cannot_be_quarantined(self):
        self.latch_guard()
        (self.tools/'mv').write_text('#!/bin/sh\nexit 1\n');(self.tools/'mv').chmod(0o755)
        text=(self.mod/'customize.sh').read_text()
        block=text[text.index('# --- Preserve boot-safe'):text.index('# --- WebUI')]
        script='set -e\nui_print() { :; }\nabort() { echo "$*" >&2; exit 1; }\n'+block
        self.env['CONFIG_DIR']=str(self.cfg)
        r=subprocess.run(['sh','-c',script],env=self.env,capture_output=True,text=True,timeout=3)
        self.assertEqual(r.returncode,1)
        self.assertIn('cannot quarantine Zygisk payload',r.stderr)
        self.assertTrue((self.mod/'disable').exists())
        self.assertTrue((self.cfg/'alwaysstrong/boot-safe').exists())

    def test_wait_rejects_latch_even_when_android_is_already_booted(self):
        self.latch_guard()
        self.sh('boot_safety.sh','wait','1',ok=1,timeout=3)
        self.assertTrue((self.mod/'disable').exists());self.assertFalse((self.mod/'zygisk').exists())
    def test_success_checkpoint_resets_attempts_and_wait_is_bounded(self):
        self.sh('boot_safety.sh','begin',ok=0);self.sh('boot_safety.sh','complete',ok=0)
        self.assertIn('attempts=0',(self.cfg/'alwaysstrong/boot-state').read_text())
        self.boot.write_text('boot-b');self.sh('boot_safety.sh','begin',ok=0)
        self.completed.write_text('0');self.fast_sleep()
        self.sh('boot_safety.sh','wait','2',ok=1,timeout=3)
        self.sh('boot_safety.sh','complete',ok=1)
    def test_malformed_refresh_interval_cannot_busy_spin_sleep(self):
        for value,expected in [('9'*64,'86400'),('0','60'),('000060','60'),('-1','3600')]:
            self.setting('interval_sec',value)
            result=self.sh('as_store.sh','int','interval_sec','60',ok=0)
            self.assertEqual(result.stdout.strip(),expected)
    def test_recovery_mode_skips_service_before_any_startup(self):
        self.mode.write_text('recovery')
        marker=self.d/'prepare-called';self.env['PREPARE_MARKER']=str(marker)
        (self.mod/'boot_prepare.sh').write_text('#!/bin/sh\ntouch "$PREPARE_MARKER"\n')
        self.sh('service.sh',ok=0,timeout=3)
        self.assertFalse(marker.exists());self.assertFalse((self.cfg/'alwaysstrong/boot-state').exists())
    def test_duplicate_service_returns_before_starting_any_jobs(self):
        marker=self.d/'duplicate-started';self.env['DUPLICATE_MARKER']=str(marker)
        (self.mod/'boot_safety.sh').write_text('#!/bin/sh\n[ "${1:-}" != enforce ] || exit 0\ntouch "$DUPLICATE_MARKER"\nexit 1\n')
        with (self.mod/'.service.flock').open('w') as held:
            fcntl.flock(held,fcntl.LOCK_EX|fcntl.LOCK_NB)
            self.sh('service.sh',ok=0,timeout=3)
        self.assertFalse(marker.exists())
    def test_prepare_is_local_and_once_per_boot(self):
        self.sh('keybox_manage.sh','install',self.good,'custom',ok=0)
        self.sh('boot_prepare.sh',ok=0,timeout=10)
        active=self.cfg/'alwaysstrong/tmp/inflight';active.write_text('keep')
        self.sh('boot_prepare.sh',ok=0,timeout=3)
        self.assertEqual(active.read_text(),'keep')
        self.assertEqual((self.cfg/'keybox.xml').read_bytes(),self.xml)
        self.assertIn('custom_keybox=1',(self.cfg/'alwaysstrong/config').read_text())
    def test_deadline_kills_descendants_and_releases_locks(self):
        marker=self.d/'survived';lock=self.d/'deadline.flock'
        cmd=['sh','-c','(sleep 2; touch "$1") & wait','fixture',str(marker)]
        r=subprocess.run([str(HOST),'run-bounded','1',str(HOST),'lock-run',str(lock),'0',*cmd],capture_output=True,timeout=4)
        self.assertEqual(r.returncode,124)
        time.sleep(1.1);self.assertFalse(marker.exists())
        unlocked=subprocess.run([str(HOST),'lock-run',str(lock),'0','true'])
        self.assertEqual(unlocked.returncode,0)
    def test_missing_or_corrupt_keybox_never_starts_daemon(self):
        marker=self.d/'daemon-started';self.env['DAEMON_MARKER']=str(marker)
        self.daemon('touch "$DAEMON_MARKER"\nexit 1\n')
        self.sh('attest_supervise.sh','tee',ok=0,timeout=3)
        (self.cfg/'keybox.xml').write_bytes(self.xml[:954])
        self.sh('attest_supervise.sh','tee',ok=0,timeout=3)
        self.assertFalse(marker.exists())
    def test_three_rapid_daemon_exits_pause_rest_of_boot(self):
        self.fast_sleep();self.sh('keybox_manage.sh','install',self.good,'custom',ok=0)
        attempts=self.d/'attempts';self.env['DAEMON_ATTEMPTS']=str(attempts)
        self.daemon('echo attempt >> "$DAEMON_ATTEMPTS"\nexit 1\n')
        self.sh('attest_supervise.sh','tee',ok=0,timeout=8)
        self.assertEqual(len(attempts.read_text().splitlines()),3)
        self.sh('attest_supervise.sh','tee',ok=0,timeout=3)
        self.assertEqual(len(attempts.read_text().splitlines()),3)
        self.assertIn('rapid',(self.cfg/'alwaysstrong/logs/attest-safety.log').read_text())
    def test_duplicate_supervisor_cannot_start_second_daemon(self):
        self.fast_sleep();self.sh('keybox_manage.sh','install',self.good,'custom',ok=0)
        ready=self.d/'daemon-ready';self.env['DAEMON_READY']=str(ready)
        self.daemon('touch "$DAEMON_READY"\nexec /bin/sleep 30\n')
        worker=subprocess.Popen(['sh',str(self.mod/'attest_supervise.sh'),'tee'],env=self.env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        try:
            end=time.monotonic()+4
            while not ready.exists() and time.monotonic()<end:time.sleep(0.02)
            self.assertTrue(ready.exists());self.sh('attest_supervise.sh','tee',ok=75,timeout=3)
        finally:
            (self.mod/'disable').touch();worker.communicate(timeout=5)
    def test_observed_keystore_restart_churn_pauses_owned_daemon(self):
        self.fast_sleep();self.sh('keybox_manage.sh','install',self.good,'custom',ok=0)
        counter=self.d/'keystore-count';self.env['KEYSTORE_COUNTER']=str(counter)
        f=self.tools/'pidof';f.write_text('#!/bin/sh\n[ "$1" = keystore2 ] || exit 1\nn=$(cat "$KEYSTORE_COUNTER" 2>/dev/null || echo 100)\nn=$((n+1)); echo "$n" > "$KEYSTORE_COUNTER"; echo "$n"\n');f.chmod(0o755)
        self.daemon('exec /bin/sleep 30\n')
        self.sh('attest_supervise.sh','tee',ok=0,timeout=5)
        self.assertIn('keystore2',(self.cfg/'alwaysstrong/logs/attest-safety.log').read_text())

    def test_corrupted_boot_counter_cannot_overflow_and_bypass_guard(self):
        (self.cfg/'alwaysstrong').mkdir()
        (self.cfg/'alwaysstrong/boot-state').write_text('boot_id=older\nattempts='+'9'*80+'\n')
        self.sh('boot_safety.sh','begin',ok=1)
        self.assertTrue((self.mod/'disable').exists())

    def test_pending_removal_refuses_startup(self):
        (self.mod/'remove').touch()
        self.sh('boot_safety.sh','allow',ok=1)
        self.sh('boot_safety.sh','begin',ok=1)
        self.assertFalse((self.cfg/'alwaysstrong/boot-state').exists())

    def test_supervisor_crash_does_not_reset_launch_budget(self):
        self.fast_sleep();self.sh('keybox_manage.sh','install',self.good,'custom',ok=0)
        attempts=self.d/'attempts';self.env['DAEMON_ATTEMPTS']=str(attempts)
        self.daemon('echo attempt >> "$DAEMON_ATTEMPTS"\nexec /bin/sleep 30\n')
        worker=subprocess.Popen(['sh',str(self.mod/'attest_supervise.sh'),'tee'],env=self.env,
                                stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
        try:
            end=time.monotonic()+4
            while not attempts.exists() and time.monotonic()<end:time.sleep(0.02)
            self.assertTrue(attempts.exists())
        finally:
            os.killpg(worker.pid,signal.SIGKILL);worker.wait(timeout=3)
        self.daemon('echo attempt >> "$DAEMON_ATTEMPTS"\nexit 1\n')
        self.sh('attest_supervise.sh','tee',ok=0,timeout=8)
        self.assertEqual(len(attempts.read_text().splitlines()),3)
        self.assertTrue((self.cfg/'alwaysstrong/attest-paused').exists())

    def test_nonregular_or_symlink_keybox_is_rejected_without_waiting(self):
        fifo=self.d/'fifo';os.mkfifo(fifo)
        link=self.d/'keybox-link';link.symlink_to(self.good)
        for path in [fifo,link]:
            self.sh('keybox_validate.sh',path,ok=1,timeout=2)

    def test_atomic_target_writer_keeps_old_file_when_package_manager_hangs(self):
        target=self.cfg/'target.txt';target.write_text('com.previous.app\n')
        f=self.tools/'pm';f.write_text('#!/bin/sh\nexec /bin/sleep 30\n');f.chmod(0o755)
        # Exercise the real builder under a shorter outer boot-task budget.
        r=subprocess.run([str(HOST),'run-bounded','1','sh',str(self.mod/'build_target_txt.sh'),str(target)],
                         env=self.env,capture_output=True,timeout=4)
        self.assertEqual(r.returncode,124)
        self.assertEqual(target.read_text(),'com.previous.app\n')

    def test_target_writer_publishes_complete_filtered_list(self):
        (self.cfg/'alwaysstrong').mkdir()
        target=self.cfg/'target.txt'
        f=self.tools/'pm';f.write_text('#!/bin/sh\nprintf "%s\\n" package:com.google.android.gms package:com.example.app package:org.lsposed.manager\n');f.chmod(0o755)
        (self.cfg/'alwaysstrong/apps.map').write_text('org.lsposed.manager\tother.xml|gen\n')
        self.sh('build_target_txt.sh',target,ok=0,timeout=6)
        content=target.read_text()
        self.assertIn('com.example.app',content);self.assertIn('com.google.android.gms!',content)
        self.assertNotIn('org.lsposed.manager',content)
        self.assertFalse(list(self.cfg.glob('target.txt.write.*')))

if __name__=='__main__':unittest.main(verbosity=2)
