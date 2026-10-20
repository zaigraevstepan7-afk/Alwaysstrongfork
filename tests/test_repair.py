"""Regression fixtures use fresh self-signed keys, never device credentials."""
import base64, concurrent.futures, fcntl, json, os, pathlib, shutil, signal, socket, subprocess, tempfile, threading, time, unittest
ROOT = pathlib.Path(__file__).resolve().parents[1]
MOD = ROOT / 'module'
HOST = ROOT / 'native/asfetch/target/debug/asfetch'

class RepairTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not HOST.exists(): raise RuntimeError('Build host asfetch with cargo build --locked before running tests')
        cls.fixture = tempfile.TemporaryDirectory()
        d = pathlib.Path(cls.fixture.name)
        subprocess.run(['openssl','ecparam','-name','prime256v1','-genkey','-noout','-out',str(d/'key')],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        subprocess.run(['openssl','req','-new','-x509','-key',str(d/'key'),'-out',str(d/'cert'),'-days','1','-subj','/CN=repair-fixture'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        cls.xml = ('<?xml version="1.0"?><AndroidAttestation><NumberOfKeyboxes>1</NumberOfKeyboxes><Keybox DeviceID="fixture"><Key algorithm="ecdsa"><PrivateKey format="pem">\n'+(d/'key').read_text()+'</PrivateKey><CertificateChain><NumberOfCertificates>1</NumberOfCertificates><Certificate format="pem">\n'+(d/'cert').read_text()+'</Certificate></CertificateChain></Key></Keybox></AndroidAttestation>').encode()
    @classmethod
    def tearDownClass(cls): cls.fixture.cleanup()
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.d = pathlib.Path(self.tmp.name)
        self.mod = self.d/'module'; shutil.copytree(MOD,self.mod)
        self.cfg = self.d/'config'; self.cfg.mkdir()
        self.env = dict(os.environ, AS_CFG_ROOT=str(self.cfg), TMPDIR=str(self.d), MODPATH=str(self.mod), AS_NATIVE_TOOL=str(HOST))
        self.good = self.d/'valid.xml'; self.good.write_bytes(self.xml)
    def tearDown(self): self.tmp.cleanup()
    def sh(self, script, *args, ok=None, **kw):
        r = subprocess.run(['sh',str(self.mod/script),*map(str,args)],env=self.env,capture_output=True,text=True,**kw)
        if ok is not None: self.assertEqual(r.returncode,ok,r.stdout+r.stderr)
        return r
    def setting(self, k,v): self.sh('as_store.sh','set',k,v,ok=0)
    def test_validation_rejects_corruption(self):
        self.sh('keybox_validate.sh',self.good,ok=0)
        variants=[self.xml[:954],self.xml.replace(b'</AndroidAttestation>',b''),self.xml.replace(b'<NumberOfCertificates>1',b'<NumberOfCertificates>2'),self.xml.replace(b'-----END CERTIFICATE-----',b''), b'<!DOCTYPE x>'+self.xml]
        for n,data in enumerate(variants):
            bad=self.d/f'bad{n}';bad.write_bytes(data)
            self.assertNotEqual(self.sh('keybox_validate.sh',bad).returncode,0)
    def test_der_truncation_with_valid_xml_and_pem_footers(self):
        import re
        match=re.search(rb'-----BEGIN CERTIFICATE-----\s*(.*?)-----END CERTIFICATE-----',self.xml,re.S)
        der=base64.b64decode(match.group(1))[:-12]
        data=self.xml[:match.start(1)]+base64.encodebytes(der)+self.xml[match.end(1):]
        bad=self.d/'truncated-der.xml';bad.write_bytes(data)
        self.sh('keybox_validate.sh',bad,ok=1)
    def test_algorithm_metadata_matches_upstream_derived_key_parser(self):
        branded=self.d/'branded.xml';branded.write_bytes(self.xml.replace(b'algorithm="ecdsa"',b'algorithm="@evokerr"'))
        self.sh('keybox_validate.sh',branded,ok=0)
        self.sh('keybox_manage.sh','install',branded,'custom',ok=0)
        self.assertEqual((self.cfg/'keybox.xml').read_bytes(),branded.read_bytes())
        branded.write_bytes(branded.read_bytes()[:954])
        self.sh('keybox_validate.sh',branded,ok=1)
    def test_outer_base64_envelope_is_strict(self):
        payload=self.d/'encoded'
        encoded=base64.b64encode(self.xml)
        for data,valid in [(encoded,True),(b' \n'+encoded+b'\n',True),(encoded+b'!',False),(encoded[:8]+b'='+encoded[9:],False),(encoded[:-1],False)]:
            payload.write_bytes(data)
            r=subprocess.run(['sh','-c','. "$1"; as_base64_check "$2"','fixture',str(self.mod/'repair_runtime.sh'),str(payload)],env=self.env,capture_output=True)
            self.assertEqual(r.returncode==0,valid)
    def test_reset_preserves_custom_keybox_and_download_pause(self):
        self.sh('keybox_manage.sh','install',self.good,'custom',ok=0)
        self.sh('repair_init.sh',ok=0)
        # Replace the hardware-touching Action with a fixture in our private copy.
        (self.mod/'action.sh').write_text('#!/bin/sh\nexit 0\n')
        self.setting('interval_sec','60')
        self.sh('reset_defaults.sh',ok=0)
        data=(self.cfg/'alwaysstrong/config').read_text()
        self.assertIn('custom_keybox=1',data);self.assertIn('auto_keybox=0',data)
        self.assertEqual((self.cfg/'keybox.xml').read_bytes(),self.xml)
        spoof=(self.cfg/'alwaysstrong/spoof.conf').read_text()
        for key in ['spoofProvider','spoofSignature','spoofVendingSdk']: self.assertIn(key+'=0\n',spoof)
    def test_failing_verdict_download_is_atomic_and_saves_previous(self):
        self.sh('keybox_manage.sh','install',self.good,'custom',ok=0)
        self.setting('auto_repair','1')
        new=self.xml.replace(b'DeviceID="fixture"',b'DeviceID="fixture-new"')
        payload=self.d/'payload';payload.write_bytes(base64.b64encode(new))
        bindir=self.d/'bin';bindir.mkdir()
        curl=bindir/'curl';curl.write_text('#!/bin/sh\nwhile [ "$#" -gt 0 ]; do if [ "$1" = -o ]; then shift; cp "$FIXTURE_PAYLOAD" "$1"; exit 0; fi; shift; done\nexit 1\n');curl.chmod(0o755)
        marker=self.d/'live-side-effect'
        (self.mod/'attest.sh').write_text('attest_notify() { touch "$SIDE_EFFECT_MARKER"; }\n')
        killall=bindir/'killall';killall.write_text('#!/bin/sh\ntouch "$SIDE_EFFECT_MARKER"\n');killall.chmod(0o755)
        self.env.update(PATH=str(bindir)+':'+self.env['PATH'],FIXTURE_PAYLOAD=str(payload),KEYBOX_BASE_URL='https://fixture.invalid',SIDE_EFFECT_MARKER=str(marker))
        (self.cfg/'alwaysstrong/verdict').write_text(f'timestamp={int(time.time())}\nbasic=1\ndevice=0\nstrong=0\n')
        self.sh('auto_repair.sh',ok=0)
        self.assertEqual((self.cfg/'keybox.xml').read_bytes(),new)
        self.assertEqual((self.cfg/'keybox.xml.good').read_bytes(),self.xml)
        self.assertIn('updated-check-again',(self.cfg/'alwaysstrong/state').read_text())
        self.sh('auto_repair.sh',ok=0)
        self.assertEqual((self.cfg/'keybox.xml.good').read_bytes(),self.xml)
        self.assertFalse(marker.exists(),'scratch-root test touched the live engine/processes')
    def test_bad_replacement_preserves_existing(self):
        self.sh('keybox_manage.sh','install',self.good,'custom','fixture.xml',ok=0)
        before=(self.cfg/'keybox.xml').read_bytes()
        bad=self.d/'broken';bad.write_bytes(self.xml[:954])
        self.assertEqual(self.sh('keybox_manage.sh','install',bad,'custom').returncode,1)
        self.assertEqual((self.cfg/'keybox.xml').read_bytes(),before)
        self.assertEqual((self.cfg/'keybox.xml').stat().st_mode & 0o777,0o600)
        self.sh('keybox_manage.sh','install',self.good,'custom',ok=2)
    def test_restore_truncated_file_from_backup(self):
        (self.cfg/'keybox.xml').write_bytes(self.xml[:954])
        (self.cfg/'keybox.xml.bak').write_bytes(self.xml)
        self.sh('keybox_manage.sh','recover',ok=0)
        self.assertEqual((self.cfg/'keybox.xml').read_bytes(),self.xml)
        self.assertEqual((self.cfg/'keybox.xml.rejected').read_bytes(),self.xml[:954])
        self.sh('keybox_manage.sh','health',ok=0)
    def test_invalid_good_backup_is_repaired_even_for_unchanged_install(self):
        self.sh('keybox_manage.sh','install',self.good,'custom',ok=0)
        backup=self.cfg/'keybox.xml.good';backup.write_bytes(self.xml[:954])
        self.sh('keybox_manage.sh','install',self.good,'custom',ok=2)
        self.assertEqual(backup.read_bytes(),self.xml)
        backup.write_bytes(self.xml[:954]);(self.cfg/'keybox.xml').write_bytes(self.xml[:954])
        self.sh('keybox_manage.sh','install',self.good,'custom',ok=0)
        self.assertEqual(backup.read_bytes(),self.xml)
    def test_custom_mode_and_explicit_delete(self):
        self.sh('keybox_manage.sh','install',self.good,'custom',ok=0)
        self.sh('keybox_manage.sh','install',self.good,'auto',ok=2)
        self.sh('keybox_manage.sh','clear',ok=0)
        self.sh('keybox_manage.sh','recover',ok=2)
        self.assertFalse((self.cfg/'keybox.xml').exists())
        self.sh('keybox_manage.sh','install',self.good,'custom',ok=0)
        self.assertFalse((self.cfg/'alwaysstrong/keybox-removed').exists())
    def test_live_writer_lock_is_respected(self):
        self.sh('keybox_manage.sh','health',ok=0)
        lock=self.cfg/'alwaysstrong/tmp/keybox.flock'
        with lock.open('w') as held:
            fcntl.flock(held,fcntl.LOCK_EX|fcntl.LOCK_NB)
            self.sh('keybox_manage.sh','install',self.good,'custom',ok=1)
        self.assertFalse((self.cfg/'keybox.xml').exists())
        self.sh('keybox_manage.sh','install',self.good,'custom',ok=0)
    def test_native_lock_survives_wrapper_kill_then_releases(self):
        lock=self.d/'writer.flock'; pidfile=self.d/'writer.pid'
        wrapper=subprocess.Popen([str(HOST),'lock-run',str(lock),'0','sh','-c',
            'echo $$ > "$1"; while :; do sleep 0.05; done','fixture',str(pidfile)],
            stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        child=None
        try:
            end=time.monotonic()+5
            while not pidfile.exists() and time.monotonic()<end:time.sleep(0.02)
            self.assertTrue(pidfile.exists());child=int(pidfile.read_text())
            wrapper.kill();wrapper.wait(timeout=5)
            blocked=subprocess.run([str(HOST),'lock-run',str(lock),'0','true'])
            self.assertEqual(blocked.returncode,75)
            os.kill(child,signal.SIGTERM);child=None
            end=time.monotonic()+5
            while time.monotonic()<end:
                result=subprocess.run([str(HOST),'lock-run',str(lock),'0','true'])
                if result.returncode==0:break
                time.sleep(0.05)
            self.assertEqual(result.returncode,0)
        finally:
            if wrapper.poll() is None:wrapper.kill();wrapper.wait(timeout=5)
            if child is not None:
                try:os.kill(child,signal.SIGKILL)
                except ProcessLookupError:pass
    def test_missing_native_helper_refuses_config_write(self):
        self.env['AS_NATIVE_TOOL']=str(self.d/'missing')
        self.sh('as_store.sh','set','auto_keybox','0',ok=1)
        self.assertFalse((self.cfg/'alwaysstrong/config').exists())
    def test_idempotent_state_write_keeps_inode(self):
        self.sh('as_store.sh','state-set','repair_status','checker-reports-three',ok=0)
        state=self.cfg/'alwaysstrong/state';before=state.stat()
        self.sh('as_store.sh','state-set','repair_status','checker-reports-three',ok=0)
        after=state.stat();self.assertEqual(before.st_ino,after.st_ino)
        self.assertEqual(before.st_mtime_ns,after.st_mtime_ns)
    def test_migration_idempotent_and_keeps_working_mode(self):
        self.setting('custom_keybox','1');self.setting('auto_keybox','0')
        spoof=self.cfg/'alwaysstrong/spoof.conf';spoof.write_text('spoofProvider=1\nspoofSignature=1\nspoofVendingSdk=1\nspoofBuild=1\n')
        self.sh('repair_init.sh',ok=0)
        first=spoof.read_text();self.sh('repair_init.sh',ok=0)
        self.assertEqual(first,spoof.read_text())
        for k in ['spoofProvider','spoofSignature','spoofVendingSdk']:self.assertIn(k+'=0',first)
        self.assertIn('custom_keybox=1',(self.cfg/'alwaysstrong/config').read_text())
        self.assertIn('auto_keybox=0',(self.cfg/'alwaysstrong/config').read_text())
    def test_concurrent_settings_do_not_lose_keys(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            results=list(pool.map(lambda i:self.sh('as_store.sh','state-set',f'test{i}',i),range(8)))
        for r in results:self.assertEqual(r.returncode,0,r.stderr)
        data=(self.cfg/'alwaysstrong/state').read_text()
        for i in range(8):self.assertIn(f'test{i}={i}\n',data)
    def test_concurrent_config_writes_and_seed(self):
        keys=['auto_repair','auto_fp','auto_keybox','status_indicator','rom_spoof_block','prop_unify','denylist_gms','auto_target']
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            results=list(pool.map(lambda k:self.sh('as_store.sh','set',k,0),keys))
        for r in results:self.assertEqual(r.returncode,0,r.stderr)
        data=(self.cfg/'alwaysstrong/config').read_text()
        for key in keys:self.assertIn(key+'=0\n',data)
    def test_invalid_download_does_not_replace_keybox(self):
        self.sh('keybox_manage.sh','install',self.good,'custom',ok=0)
        self.setting('custom_keybox','0')
        bindir=self.d/'bin';bindir.mkdir()
        payload=self.d/'payload';payload.write_bytes(base64.b64encode(self.xml[:954]))
        # All available external engines return the same truncated fixture.
        fake='#!/bin/sh\nout=""\nwhile [ "$#" -gt 0 ]; do case "$1" in -o|-O) shift; out=$1 ;; esac; shift; done\ncp "$FIXTURE_PAYLOAD" "$out"\n'
        for name in ['curl','wget']:
            p=bindir/name;p.write_text(fake);p.chmod(0o755)
        self.env.update(PATH=str(bindir)+':'+self.env['PATH'],FIXTURE_PAYLOAD=str(payload),KEYBOX_BASE_URL='https://fixture.invalid')
        self.sh('keybox_fetch.sh',ok=1)
        self.assertEqual((self.cfg/'keybox.xml').read_bytes(),self.xml)
    def test_fingerprint_fetch_rejects_failed_partial_engine_outputs(self):
        # Exercise the shipped fetch function without running Android's install
        # adapter or touching its fixed production config directory.
        source=(self.mod/'pif_native_fetch.sh').read_text()
        fetch=source[source.index('fetch() {'):source.index('# Prefer busybox grep/tac:')]
        bindir=self.d/'bin';bindir.mkdir()
        fake='#!/bin/sh\nwhile [ "$#" -gt 0 ]; do if [ "$1" = -o ]; then shift; printf "partial" > "$1"; break; fi; shift; done\nexit 28\n'
        for name in ['curl','asfetch']:
            exe=bindir/name;exe.write_text(fake);exe.chmod(0o755)
        script=self.d/'pif-fetch-test.sh'
        script.write_text('ABI=fixture\nASFETCH="$1"\nTIMEOUT=1\nCAP_EXTRA=1\nbounded() { shift; "$@"; }\n'+fetch+'\nfetch "$2" https://fixture.invalid/key ""\n')
        env=dict(self.env,PATH=str(bindir)+':'+self.env['PATH']);out=self.d/'partial.prop'
        r=subprocess.run(['sh',str(script),str(bindir/'asfetch'),str(out)],env=env,capture_output=True)
        self.assertEqual(r.returncode,1);self.assertFalse(out.exists())
    def test_incomplete_network_response_is_failure(self):
        if not HOST.exists():self.skipTest('host binary not built')
        listener=socket.socket();listener.bind(('127.0.0.1',0));listener.listen()
        def serve():
            c,_=listener.accept();c.recv(4096);c.sendall(b'HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\npartial');c.close();listener.close()
        t=threading.Thread(target=serve);t.start()
        out=self.d/'download';out.write_text('previous')
        r=subprocess.run([str(HOST),f'http://127.0.0.1:{listener.getsockname()[1]}/key','-o',str(out),'-T','1'],capture_output=True)
        t.join();self.assertNotEqual(r.returncode,0);self.assertEqual(out.read_text(),'previous')
    def test_fresh_checker_result_and_cooldown(self):
        if not HOST.exists():self.skipTest('host binary not built')
        self.env['AS_VERDICT_PARSER']=str(HOST)
        self.sh('keybox_manage.sh','install',self.good,'custom',ok=0)
        self.setting('auto_repair','0')
        result=self.d/'result.json';result.write_text(json.dumps({'requestDetails':{'timestampMillis':str(int(time.time()*1000))},'deviceIntegrity':{'deviceRecognitionVerdict':['MEETS_BASIC_INTEGRITY','MEETS_DEVICE_INTEGRITY','MEETS_STRONG_INTEGRITY']}}))
        self.sh('verdict_report.sh',result,ok=0)
        report=(self.cfg/'alwaysstrong/verdict').read_text()
        self.assertIn('strong=1',report);self.assertNotIn('token',report)
        self.setting('auto_repair','1');self.sh('auto_repair.sh',ok=0)
        self.assertFalse('repair_attempt=' in (self.cfg/'alwaysstrong/state').read_text())
        # A recently attempted failure must not start another network request.
        (self.cfg/'alwaysstrong/verdict').write_text(report.replace('strong=1','strong=0'))
        self.sh('as_store.sh','state-set','repair_attempt',int(time.time()),ok=0)
        self.sh('auto_repair.sh',ok=0)
        self.assertIn('repair_status=cooling-down',(self.cfg/'alwaysstrong/state').read_text())
    def test_bad_or_expired_json_keeps_previous_verdict(self):
        self.env['AS_VERDICT_PARSER']=str(HOST);self.setting('auto_repair','0')
        good=self.d/'result.json'
        good.write_text(json.dumps({'requestDetails':{'timestampMillis':str(int(time.time()*1000))},'deviceIntegrity':{}}))
        self.sh('verdict_report.sh',good,ok=0)
        previous=(self.cfg/'alwaysstrong/verdict').read_bytes()
        self.assertIn(b'basic=0\ndevice=0\nstrong=0',previous)
        variants=['{broken',json.dumps({'requestDetails':{'timestampMillis':'1'},'deviceIntegrity':{}}),
            json.dumps({'error':'API unavailable','requestDetails':{'timestampMillis':str(int(time.time()*1000))},'deviceIntegrity':{}})]
        for value in variants:
            good.write_text(value);self.sh('verdict_report.sh',good,ok=1)
            self.assertEqual((self.cfg/'alwaysstrong/verdict').read_bytes(),previous)
    def test_older_fresh_json_cannot_replace_newer_report(self):
        self.env['AS_VERDICT_PARSER']=str(HOST);self.setting('auto_repair','0')
        file=self.d/'result.json';now=int(time.time()*1000)
        file.write_text(json.dumps({'requestDetails':{'timestampMillis':str(now)},'deviceIntegrity':{'deviceRecognitionVerdict':['MEETS_BASIC_INTEGRITY','MEETS_DEVICE_INTEGRITY','MEETS_STRONG_INTEGRITY']}}))
        self.sh('verdict_report.sh',file,ok=0)
        previous=(self.cfg/'alwaysstrong/verdict').read_bytes()
        file.write_text(json.dumps({'requestDetails':{'timestampMillis':str(now-30000)},'deviceIntegrity':{}}))
        result=self.sh('verdict_report.sh',file,ok=0)
        self.assertIn('ignored',result.stdout)
        self.assertEqual((self.cfg/'alwaysstrong/verdict').read_bytes(),previous)
    def test_new_inbox_arriving_during_parse_is_not_removed(self):
        self.setting('auto_repair','0')
        ready=self.d/'parser-ready';release=self.d/'parser-release';parser=self.d/'slow-parser'
        parser.write_text('#!/bin/sh\ntouch "$PARSER_READY"\nwhile [ ! -f "$PARSER_RELEASE" ]; do sleep 0.02; done\nexec "$REAL_PARSER" "$@"\n');parser.chmod(0o755)
        self.env.update(AS_VERDICT_PARSER=str(parser),PARSER_READY=str(ready),PARSER_RELEASE=str(release),REAL_PARSER=str(HOST))
        now=int(time.time()*1000);inbox=self.cfg/'alwaysstrong/verdict-inbox.json'
        inbox.write_text(json.dumps({'requestDetails':{'timestampMillis':str(now-30000)},'deviceIntegrity':{}}))
        worker=subprocess.Popen(['sh',str(self.mod/'verdict_report.sh')],env=self.env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        try:
            end=time.monotonic()+5
            while not ready.exists() and time.monotonic()<end:time.sleep(0.02)
            self.assertTrue(ready.exists());self.assertFalse(inbox.exists())
            next_json=json.dumps({'requestDetails':{'timestampMillis':str(now)},'deviceIntegrity':{'deviceRecognitionVerdict':['MEETS_STRONG_INTEGRITY']}})
            pending=self.d/'new-inbox';pending.write_text(next_json);os.replace(pending,inbox)
            release.touch();stdout,stderr=worker.communicate(timeout=10)
            self.assertEqual(worker.returncode,0,stdout+stderr)
            self.assertEqual(inbox.read_text(),next_json)
            self.sh('verdict_report.sh',ok=0)
            self.assertFalse(inbox.exists());self.assertIn('strong=1',(self.cfg/'alwaysstrong/verdict').read_text())
        finally:
            release.touch()
            if worker.poll() is None:worker.kill();worker.communicate(timeout=5)

if __name__=='__main__':unittest.main(verbosity=2)
