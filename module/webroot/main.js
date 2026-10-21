(function(){
  "use strict";
  // ============================================================
  //  AlwaysStrong WebUI engine, wired under the new design.
  //  Element selection is by the mock's own data-k / id / class, so
  //  the markup stays pixel-identical; only behaviour is added.
  // ============================================================
  var MOD="/data/adb/modules/tricky_store";
  var CFG="/data/adb/tricky_store";
  var KEYBOX=CFG+"/keybox.xml";
  var AS=CFG+"/alwaysstrong";
  var AS_CONF=AS+"/config";
  var STORE=MOD+"/as_store.sh";
  var SPOOF_CONF=AS+"/spoof.conf";
  function shq(s){ return "'"+String(s).replace(/'/g,"'\\''")+"'"; }
  function q(sel,root){ return (root||document).querySelector(sel); }
  function qa(sel,root){ return Array.prototype.slice.call((root||document).querySelectorAll(sel)); }
  // input inside the row carrying this data-k
  function dkInput(dk){ var r=q('[data-k="'+dk+'"]'); return r?r.querySelector('input[type=checkbox]'):null; }
  function dkRow(dk){ return q('[data-k="'+dk+'"]'); }

  // ---- KSU/APatch/Magisk root bridge ----
  function ksuExec(cmd,timeoutMs){
    return new Promise(function(resolve){
      if(typeof ksu==="undefined"||!ksu.exec){ resolve({errno:-1,stdout:"",stderr:"no bridge"}); return; }
      var cb="__cb"+Date.now()+Math.floor(Math.random()*1e6);
      var timer;
      function finish(errno,stdout,stderr){ clearTimeout(timer); delete window[cb]; resolve({errno:errno,stdout:stdout||"",stderr:stderr||""}); }
      window[cb]=finish;
      if(timeoutMs) timer=setTimeout(function(){ finish(-2,"","root bridge timeout"); },timeoutMs);
      try{ ksu.exec(cmd,"{}",cb); }catch(e){ finish(-1,"",String(e)); }
    });
  }
  function ksuBg(cmd){ return ksuExec("({ "+cmd+" ; } >/dev/null 2>&1 &) ; echo ok"); }
  function deferBg(cmd){ setTimeout(function(){ ksuBg(cmd); },0); }

  // ---- debounced config writes (one shell for a burst of toggles) ----
  var _pend={}, _timer=null;
  function flush(){ _timer=null; var parts=[],k; for(k in _pend) parts.push("sh "+shq(STORE)+" set "+shq(k)+" "+shq(_pend[k])); for(k in _pend) delete _pend[k]; if(parts.length) ksuBg(parts.join("; ")); }
  function setting(k,v){ _pend[k]=String(v); if(!_timer) _timer=setTimeout(flush,180); }
  function settingOn(k,on){ setting(k,on?1:0); }
  function flushNow(){ if(_timer){ clearTimeout(_timer); flush(); } }
  document.addEventListener("visibilitychange",function(){ if(document.hidden) flushNow(); });
  window.addEventListener("pagehide",flushNow);

  var DEFAULTS={auto_fp:"1",auto_keybox:"1",status_indicator:"1",rom_spoof_block:"1",
    spoof_patch_props:"1",custom_keybox:"0",custom_pif:"0",interval_sec:"3600",hide_rom_markers:"0",auto_target:"1",denylist_targets:"0"};
  function conf(S,k){ return (S[k]!==undefined&&S[k]!=="")?S[k]:DEFAULTS[k]; }

  // ---- toast (mock element) ----
  var toastEl=document.getElementById("toast"),tt;
  function toast(m,ms){ if(!toastEl) return; toastEl.textContent=m; toastEl.classList.add("show"); clearTimeout(tt); tt=setTimeout(function(){ toastEl.classList.remove("show"); }, ms||1900); }

  // ---- external links open through the host (am-intent) ----
  function openExternal(url){ var safe=String(url).replace(/'/g,"'\\''"); if(typeof ksu!=="undefined"&&ksu.exec){ ksuExec("am start -a android.intent.action.VIEW -d '"+safe+"' >/dev/null 2>&1"); return true; } return false; }
  qa("a.linkrow").forEach(function(a){ a.addEventListener("click",function(e){ if(openExternal(a.href)) e.preventDefault(); }); });

  // ---- one shell for the whole first paint ----
  function readAll(){
    var cmd=[
      'echo "ver=$(grep -m1 \'^version=\' "'+MOD+'/module.prop" 2>/dev/null | cut -d= -f2-)"',
      'echo "eng=$(grep -m1 \'^ENGINE=\' "'+MOD+'/engine.sh" 2>/dev/null | cut -d= -f2-)"',
      'echo "att=$(grep -m1 \'^ATTEST=\' "'+MOD+'/attest.sh" 2>/dev/null | cut -d= -f2-)"',
      'echo "desc=$(grep -m1 \'^description=\' "'+MOD+'/module.prop" 2>/dev/null | sed -e \'s/^description=//\' | awk \'{print $1}\')"',
      'echo "health=$(sh "'+MOD+'/keybox_manage.sh" health 2>/dev/null)"',
      'cat "'+AS_CONF+'" 2>/dev/null',
      'sed "s/^/v_/" "'+AS+'/verdict" 2>/dev/null',
      'echo "repair_status=$(sed -n \'s/^repair_status=//p\' "'+AS+'/state" 2>/dev/null | head -1)"',
      '[ -s "'+KEYBOX+'" ] && echo "kb=$(wc -c < "'+KEYBOX+'")|$(stat -c %Y "'+KEYBOX+'" 2>/dev/null)" || echo "kb=0|"',
      'echo "keybox_name=$(sed -n \'s/^keybox_name=//p\' "'+AS+'/state" 2>/dev/null | head -1)"',
      'echo "pif_name=$(sed -n \'s/^pif_name=//p\' "'+AS+'/state" 2>/dev/null | head -1)"',
      'echo "pif_model=$(sed -n \'s/^pif_model=//p\' "'+AS+'/state" 2>/dev/null | head -1)"',
      'echo "fm_path=$(sed -n \'s/^fm_path=//p\' "'+AS+'/state" 2>/dev/null | head -1)"',
      'echo "model=$(for f in "'+MOD+'/custom.pif.prop" "'+MOD+'/pif.prop" "'+CFG+'/custom.pif.prop" "'+CFG+'/pif.prop"; do [ -s "$f" ] && { v=$(grep -m1 \'^MODEL=\' "$f" | cut -d= -f2- | tr -d \'"\r\'); [ -n "$v" ] && { echo "$v"; break; }; }; done)"',
      'echo "--spoof--"',
      'for f in "'+MOD+'/custom.pif.prop" "'+CFG+'/custom.pif.prop" "'+MOD+'/pif.prop" "'+CFG+'/pif.prop"; do [ -s "$f" ] && grep -qiE \'^(spoof|DEBUG)\' "$f" && { grep -iE \'^(spoof|DEBUG)\' "$f"; break; }; done'
    ].join("; ");
    return ksuExec(cmd).then(function(r){
      var o={spoof:[]}, inSpoof=false;
      (r.stdout||"").split("\n").forEach(function(l){
        if(l.trim()==="--spoof--"){ inSpoof=true; return; }
        if(inSpoof){ if(l.trim()) o.spoof.push(l); return; }
        var i=l.indexOf("="); if(i>0) o[l.slice(0,i).trim()]=l.slice(i+1).trim();
      });
      return o;
    });
  }

  // ---- auto keybox name from the server mirror (/meta.json), like v1.0.4 ----
  // The status card shows WHICH keybox the server currently serves, independent
  // of any custom keybox the user picked (the custom name shows in its own row).
  // Fetched once; engines are tried in turn since no one downloader works on all.
  var metaKeyName="";
  function fetchMetaName(){ return Promise.resolve(""); }
  function applyMetaName(){
    if(!metaKeyName) return;
    var kbEl=q(".statusbar .lab small"); if(kbEl) kbEl.textContent=metaKeyName;
    var kbRowS=q('[data-k="keybox auto check"] .s'); if(kbRowS) kbRowS.textContent=tr("kb_auto","Auto check")+" · "+metaKeyName;
  }

  // ---- status card: binary verdict checks + keybox name ----
  var RING="M24,44q-4.1,0 -7.75,-1.575 -3.65,-1.575 -6.375,-4.3 -2.725,-2.725 -4.3,-6.375Q4,28.1 4,24q0,-4.15 1.575,-7.8 1.575,-3.65 4.3,-6.35 2.725,-2.7 6.375,-4.275Q19.9,4 24,4q4.15,0 7.8,1.575 3.65,1.575 6.35,4.275 2.7,2.7 4.275,6.35Q44,19.85 44,24q0,4.1 -1.575,7.75 -1.575,3.65 -4.275,6.375t-6.35,4.3Q28.15,44 24,44Z";
  // pass: disk with a check-shaped hole (green). fail: disk with an X-shaped hole (red).
  var CHK='<path fill-rule="evenodd" d="M21.05,33.1 L35.2,18.95l-2.3,-2.25 -11.85,11.85 -6,-6 -2.25,2.25Z'+RING+'"/>';
  var CROSS='<path fill-rule="evenodd" d="M28.81,16.08 L31.92,19.19 L27.11,24 L31.92,28.81 L28.81,31.92 L24,27.11 L19.19,31.92 L16.08,28.81 L20.89,24 L16.08,19.19 L19.19,16.08 L24,20.89 Z'+RING+'"/>';
  function renderChecks(s){
    var checks=q(".statusbar .checks"); if(!checks) return;
    var labels={complete:"Файл проверен",invalid:"Файл повреждён",missing:"Файл отсутствует"};
    checks.textContent=labels[s]||"Не проверен";
    checks.title="XML/PEM/DER completeness only. Google Play Integrity verdict not checked.";
    checks.style.color=s==="complete"?"var(--good)":s==="invalid"?"var(--danger)":"var(--sub)";
    var name=q(".statusbar .lab small"); if(name) name.textContent="Целостность XML / PEM / DER";
  }

  // ---- paint everything from one state object ----
  var curModel="";
  // Set the spoofed model everywhere it shows. The Configuration tab's data-sub
  // is what the tab-switch handler writes back into the hero, so keep it in sync
  // or switching tabs reverts the hero to the mock's static "Spoofing Pixel 6a".
  function setHeroModel(m){ m=(m||"").trim(); if(!m) return; curModel=m;
    var mainTab=q('.tab[data-pg="pgMain"]'); if(mainTab) mainTab.dataset.sub=tr("spoofing","Spoofing")+" "+m;
    var hs=document.getElementById("heroState");
    if(hs && mainTab && mainTab.classList.contains("on")) hs.textContent=tr("spoofing","Spoofing")+" "+m; }
  function setToggle(dk,on){ var i=dkInput(dk); if(i) i.checked=!!on; }
  function paint(S){
    var versionLabel=q("#moduleVersion"); if(versionLabel && S.ver) versionLabel.textContent=S.ver;
    // hero: spoofed device
    setHeroModel((S.pif_model||S.model||"").trim());
    // status
    renderChecks(S.health||"");
    paintVerdict(S);
    var kbn=S.keybox_name||"";
    var kbEl=q(".statusbar .lab small"); if(kbEl && metaKeyName) kbEl.textContent=metaKeyName; var kbRowS=q('[data-k="keybox auto check"] .s'); if(kbRowS) kbRowS.textContent=tr("kb_auto","Auto check")+" · "+(metaKeyName||kbn||"keybox.xml");
    // Automatic
    var pifCustom=conf(S,"custom_pif")==="1";
    setToggle("fingerprint pixel refresh", !pifCustom && conf(S,"auto_fp")==="1");
    setToggle("keybox auto check", conf(S,"auto_keybox")==="1");
    setToggle("status indicator prefix", conf(S,"status_indicator")==="1");
    // Keybox
    var ckSw=document.getElementById("ckSw"); if(ckSw){ ckSw.checked=conf(S,"custom_keybox")==="1"; var cp=document.getElementById("ckPick"); if(cp) cp.classList.toggle("reveal",ckSw.checked); }
    // keybox file row label
    var ckn=q('#ckPick .txt .h'), cks=q('#ckPick .txt .s');
    var bytes=parseInt(String(S.kb||"0|").split("|")[0],10)||0;
    if(ckn && cks){ if(bytes>0){ ckn.textContent=(kbn||"keybox.xml").replace(/\.xml$/i,""); cks.textContent=tr("ck_selk","Selected keybox"); } }
    // custom keybox overwrites the auto-fetched one, so grey out auto-keybox
    setAutoKbDisabled(!!(ckSw && ckSw.checked));
    var ckDelEl=document.getElementById("ckDel"); if(ckDelEl) ckDelEl.hidden=!(ckSw && ckSw.checked && bytes>0);
    var impDelEl=document.getElementById("impDel"); if(impDelEl) impDelEl.hidden=!pifCustom;
    if(pifCustom) setImpRowSel(S.pif_model,S.pif_name); else setImpRowSel("","");
    // Settings: interval value
    var sec=parseInt(conf(S,"interval_sec"),10); var mins=(isFinite(sec)&&sec>=60)?Math.round(sec/60):60;
    var iv=q('[data-k="check every interval"] .val'); if(iv) iv.textContent=fmtMins(mins);
    curInterval=mins;
    // Advanced: ROM + targeting
    setToggle("block rom spoof pixelprops pihooks", conf(S,"rom_spoof_block")==="1");
    setToggle("hide rom identity version", conf(S,"hide_rom_markers")==="1");
    setToggle("denylist selected target apps", conf(S,"denylist_targets")==="1");
    setToggle("auto targeting target list", conf(S,"auto_target")==="1");
    // spoof flags (Advanced): value from the active pif's prop lines
    paintSpoof(S.spoof||[]);
    // security patch modal: spp toggle + fields
    var sppT=q('#patchModal .srow input[type=checkbox]'); if(sppT) sppT.checked=conf(S,"spoof_patch_props")==="1";
    var inps=qa('#patchModal .inp');
    if(inps[0]) inps[0].value=(S.patch_system||"")||AUTO_STR;
    if(inps[1]) inps[1].value=(S.patch_vendor||"")||AUTO_STR;
    if(inps[2]) inps[2].value=(S.patch_boot||"")||AUTO_STR;
    // beta selection reflect
    var bm=(pifCustom&&S.pif_name)?String(S.pif_name).match(/^([A-Za-z0-9_]+)\.pif\.prop$/):null;
    if(bm){ qa("#betaAcc .beta").forEach(function(b){ b.classList.toggle("sel", b.dataset.c===bm[1]); }); }
  }
  // spoof flags: the mock shows a fixed set; reflect the real on/off from the prop
  function isFalseVal(v){ v=String(v).trim().toLowerCase(); return v==="0"||v==="false"||v==="off"||v==="no"; }
  var FLAG_ON={spoofVendingFinger:1,spoofBuild:1,spoofProps:1,spoofVendingBuild:1};
  function paintSpoof(lines){
    var cur={};
    lines.forEach(function(l){ l=String(l).trim(); var i=l.indexOf("="); if(i<1) return; cur[l.slice(0,i).trim().toLowerCase()]=!isFalseVal(l.slice(i+1).trim()); });
    qa("#pgAdv .flag[data-k]").forEach(function(f){
      var code=(f.querySelector("code")?f.querySelector("code").textContent:"").trim();
      var inp=f.querySelector("input[type=checkbox]"); if(!inp) return;
      var key=code.toLowerCase();
      inp.checked = (key in cur) ? cur[key] : !!FLAG_ON[code];
    });
  }
  // The spoof flags differ by Play Integrity engine, so the Advanced rows follow
  // the active engine: Fork uses numeric 1/0 + spoofVendingFinger; inject-s uses
  // true/false + spoofVendingBuild and an extra DEBUG flag. The Lite line has no
  // bundled engine, so it mirrors whichever PIF the user installed (fork|inject).
  var SPOOF_DIALECT="fork";
  var SPOOF_SETS={
    fork:["spoofBuild","spoofProps","spoofProvider","spoofVendingFinger","spoofSignature","spoofVendingSdk"],
    inject:["spoofBuild","spoofProps","spoofProvider","spoofSignature","spoofVendingBuild","spoofVendingSdk","DEBUG"]
  };
  function spoofFmt(on){ return SPOOF_DIALECT==="inject" ? (on?"true":"false") : (on?"1":"0"); }
  function spoofRowHtml(code){ return '<div class="flag" data-k="'+code.toLowerCase()+'"><code>'+code+'</code><label class="sw"><input type="checkbox"><span class="sl"></span></label></div>'; }
  function adaptSpoofFlags(dialect){
    var grp=document.getElementById("spoofGrp"), card=document.getElementById("spoofCard");
    if(!grp||!card) return;
    if(!dialect){ grp.hidden=true; return; }   // Lite with no PIF: nothing to spoof
    grp.hidden=false;
    var set=SPOOF_SETS[dialect]||SPOOF_SETS.fork;
    var cur=qa(".flag[data-k] code",card).map(function(c){ return c.textContent.trim(); });
    // only rebuild when the set actually changed, so Fork stays byte-identical to the mock
    if(cur.join(",")!==set.join(",")) card.innerHTML=set.map(spoofRowHtml).join("");
  }
  // Lite only: read the installed PIF's own spoof/DEBUG lines so the toggles reflect it
  function fetchExtSpoof(){
    var P="/data/adb/modules/playintegrityfix";
    var cmd='for f in "'+P+'/custom.pif.prop" "'+P+'/pif.prop"; do [ -s "$f" ] && grep -qiE "^(spoof|DEBUG)" "$f" && { grep -iE "^(spoof|DEBUG)" "$f"; break; }; done';
    return ksuExec(cmd).then(function(r){ return (r.stdout||"").split("\n").filter(Boolean); });
  }

  // ======================= bindings =======================
  // Automatic
  // Return to automatic fingerprint: the exact reset the Import-row trash does
  // (clear custom pif, drop the imported/beta name, reset the Import row, hide the
  // trash), so turning the Fingerprint toggle back ON also deletes the selected pif.
  function pifClear(){ setting("auto_fp",1); setting("custom_pif",0);
    deferBg("sh "+shq(STORE)+" state-del pif_name; sh "+shq(STORE)+" state-del pif_model");
    qa("#betaAcc .beta").forEach(function(x){ x.classList.remove("sel"); });
    setImpRowSel("",""); var id=document.getElementById("impDel"); if(id) id.hidden=true; }
  var fpI=dkInput("fingerprint pixel refresh");
  if(fpI) fpI.addEventListener("change",function(e){ if(e.target.checked){ pifClear(); toast(tr("t_back_fp","Back to automatic fingerprint"),2500); } else setting("auto_fp",0); });
  var kbI=dkInput("keybox auto check");
  if(kbI) kbI.addEventListener("change",function(e){ settingOn("auto_keybox",e.target.checked); });
  var indI=dkInput("status indicator prefix");
  if(indI) indI.addEventListener("change",function(e){
    settingOn("status_indicator",e.target.checked);
    if(!e.target.checked){ deferBg('sh "'+MOD+'/status_fetch.sh" strip'); setTimeout(function(){ refreshStatus(); },1500); }
    else { toast(tr("ind_fetch","Fetching status…"),3000); deferBg('sh "'+MOD+'/status_fetch.sh" manual'); setTimeout(function(){ refreshStatus(); },4000); }
  });
  // Keybox
  var ckSwEl=document.getElementById("ckSw");
  if(ckSwEl) ckSwEl.addEventListener("change",function(e){ settingOn("custom_keybox",e.target.checked);
    var cp=document.getElementById("ckPick"); if(cp) cp.classList.toggle("reveal",e.target.checked);
    setAutoKbDisabled(e.target.checked);
    var cd=document.getElementById("ckDel"); if(cd && !e.target.checked) cd.hidden=true;
    if(e.target.checked) ckRefresh(); });
  // Advanced toggles
  var rsI=dkInput("block rom spoof pixelprops pihooks");
  if(rsI) rsI.addEventListener("change",function(e){ settingOn("rom_spoof_block",e.target.checked); });
  var hrI=dkInput("hide rom identity version");
  if(hrI) hrI.addEventListener("change",function(e){ settingOn("hide_rom_markers",e.target.checked); toast(tr("t_applied_next","Applied on next refresh"),2200); });
  var dlI=dkInput("denylist selected target apps");
  if(dlI) dlI.addEventListener("change",function(e){
    settingOn("denylist_targets",e.target.checked);
    toast("Run Action to sync. Existing DenyList entries are preserved.",3500);
  });
  var atI=dkInput("auto targeting target list");
  if(atI) atI.addEventListener("change",function(e){ settingOn("auto_target",e.target.checked); });
  // spoof flags: per-key override in spoof.conf, written in the active engine's
  // dialect (Fork 1/0, inject-s true/false), then re-enforce. Delegated so rows
  // re-rendered for a different engine keep working without re-binding.
  var spoofCardEl=document.getElementById("spoofCard");
  if(spoofCardEl) spoofCardEl.addEventListener("change",function(e){
    var inp=e.target; if(!inp||inp.type!=="checkbox") return;
    var row=inp.closest?inp.closest(".flag[data-k]"):null; if(!row) return;
    var code=(row.querySelector("code")?row.querySelector("code").textContent:"").trim();
    var k=code.replace(/[^A-Za-z0-9_]/g,""); if(!k) return;
    var val=spoofFmt(inp.checked);
    deferBg('mkdir -p "'+AS+'"; f="'+SPOOF_CONF+'"; touch "$f"; grep -v "^'+k+'=" "$f" 2>/dev/null > "$f.tmp"; mv "$f.tmp" "$f"; printf \'%s=%s\n\' "'+k+'" "'+val+'" >> "$f"; sh "'+MOD+'/reapply_spoof.sh"');
    toast(tr("applied","Applied, restarting Play Integrity"),2500);
  });

  // ---- security patch modal fields ----
  function normPatch(v){ var d=(v||"").replace(/[^0-9]/g,""); if(!d) return ""; if(d.length===6) return d.slice(0,4)+"-"+d.slice(4,6)+"-05"; if(d.length===8) return d.slice(0,4)+"-"+d.slice(4,6)+"-"+d.slice(6,8); return null; }
  var patchKeys=["patch_system","patch_vendor","patch_boot"];
  function savePatch(key,el){ var raw=el.value.trim(); if(raw===AUTO_STR) raw=""; var n=normPatch(raw);
    if(n===null){ toast(tr("patch_bad","Use YYYY-MM-DD, or auto"),3500); return; } el.value=n||AUTO_STR;
    deferBg('sh '+shq(STORE)+' set '+shq(key)+' '+shq(n)+'; sh '+shq(MOD+"/sync_patch.sh")+' boot'); }
  qa('#patchModal .inp').forEach(function(el,i){
    el.addEventListener("focus",function(){ if(el.value===AUTO_STR) el.value=""; });
    el.addEventListener("blur",function(){ savePatch(patchKeys[i],el); });
    el.addEventListener("keydown",function(e){ if(e.key==="Enter") e.target.blur(); });
  });
  var sppToggle=q('#patchModal .srow input[type=checkbox]');
  if(sppToggle) sppToggle.addEventListener("change",function(e){
    if(e.target.checked) deferBg('sh '+shq(STORE)+' set spoof_patch_props 1; sh "'+MOD+'/sync_patch.sh" boot');
    else settingOn("spoof_patch_props",0);
  });

  // ---- Collect logs ----
  var logRow=dkRow("collect logs diagnostic");
  if(logRow){ var logBusy=false; logRow.addEventListener("click",function(){
    if(logBusy) return; logBusy=true; toast(tr("logs_run","Collecting logs…"),3000);
    ksuExec("sh "+shq(STORE)+" state-del last_log; (sh "+MOD+"/collect_logs.sh >/dev/null 2>&1 &) ; echo ok").then(function(){
      var tries=0; (function poll(){ ksuExec("sh "+shq(STORE)+" state-get last_log").then(function(r){
        var p=(r.stdout||"").trim(); if(p){ logBusy=false; toast(tr("logs_done","Saved:")+" "+p,5000); }
        else if(++tries<20) setTimeout(poll,800); else { logBusy=false; toast(tr("t_log_timeout","Log collection timed out"),3000); } }); })();
    });
  }); }

  // ======================= visual behaviours (kept from the mock) =======================
  var bar=document.getElementById("bar"),hStateEl=document.getElementById("heroState");
  window.addEventListener("scroll",function(){ bar.classList.toggle("stuck",window.scrollY>58); },{passive:true});

  qa(".tab").forEach(function(t){ t.addEventListener("click",function(){
    qa(".tab").forEach(function(x){ x.classList.remove("on"); }); t.classList.add("on");
    document.getElementById("pgMain").hidden=t.dataset.pg!=="pgMain"; document.getElementById("pgAdv").hidden=t.dataset.pg!=="pgAdv";
    if(hStateEl) hStateEl.textContent=t.dataset.sub; window.scrollTo(0,0);
  }); });

  // ================= Stage 2: fingerprints, target apps, pickers =================
  var curInterval=60;
  function esc(s){ return String(s).replace(/[&<>"]/g,function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]; }); }
  function isPkg(s){ return /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/.test(s); }
  var CHK2='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5L20 7"/></svg>';
  function openM(m){
    if(!m) return; clearTimeout(m._closeTimer); m.hidden=false;
    requestAnimationFrame(function(){ if(!m.hidden) m.classList.add("show"); });
  }
  function closeM(m){
    if(!m) return; clearTimeout(m._closeTimer); m.classList.remove("show");
    m._closeTimer=setTimeout(function(){ if(!m.classList.contains("show")) m.hidden=true; },220);
  }
  // custom keybox overwrites the auto-fetched one, so auto-keybox is greyed out
  // (disabled) while a custom keybox is in use.
  function setAutoKbDisabled(d){ var row=dkRow("keybox auto check"), inp=dkInput("keybox auto check"); if(inp) inp.disabled=!!d; if(row) row.classList.toggle("off",!!d); }
  // Import fingerprint row subtitle: show the active fingerprint (model · name)
  // when one is imported/applied, else the default hint.
  function prettyPif(n){ return String(n||"").replace(/\.(pif\.)?prop$/i,"").replace(/\.json$/i,""); }
  function setImpRowSel(model,name){ var r=dkRow("import fingerprint pif json prop"); if(!r) return; var is=r.querySelector(".txt .s"); if(!is) return;
    var pn=prettyPif(name), pm=(model||"").trim();
    is.textContent=(pm||pn) ? (pm?(pm+(pn?" · "+pn:"")):pn) : tr("imp_s","Load a pif.json or pif.prop file"); }
  var impDel=document.getElementById("impDel"), ckDel=document.getElementById("ckDel");
  // trash: drop the current custom keybox -> back to the auto-fetched one
  // trash: delete only the selected keybox file. Custom-keybox mode stays ON
  // (toggle checked, picker open, auto-keybox still disabled) so the user can
  // pick a different keybox without re-enabling the setting.
  if(ckDel) ckDel.addEventListener("click",function(e){ e.stopPropagation();
    deferBg("sh "+shq(MOD+"/keybox_manage.sh")+" clear");
    var h=q('#ckPick .txt .h'), s=q('#ckPick .txt .s'); if(h) h.textContent=tr("ck_pick","Select keybox file"); if(s) s.textContent=tr("ck_none","No file selected");
    ckDel.hidden=true; toast(tr("t_kb_deleted","Keybox deleted"),3000);
  });
  // trash: drop the imported / beta fingerprint -> back to automatic
  if(impDel) impDel.addEventListener("click",function(e){ e.stopPropagation();
    var fp=dkInput("fingerprint pixel refresh"); if(fp) fp.checked=true;
    pifClear(); toast(tr("t_back_fp","Back to automatic fingerprint"),3000);
  });
  function pifPoll(name,tries){
    ksuExec('echo "n=$(sh '+shq(STORE)+' state-get pif_name)"; echo "m=$(sh '+shq(STORE)+' state-get pif_model)"').then(function(r){
      var o={}; (r.stdout||"").split("\n").forEach(function(l){ var i=l.indexOf("="); if(i>0) o[l.slice(0,i)]=l.slice(i+1).trim(); });
      if(o.n){ if(o.m) setHeroModel(o.m); setImpRowSel(o.m,o.n); toast(tr("t_applied","Applied ✅"),4000); if(impDel) impDel.hidden=false; }
      else if(tries>0) setTimeout(function(){ pifPoll(name,tries-1); },1200);
      else { toast(tr("t_applied","Applied ✅"),3000); if(impDel) impDel.hidden=false; }
    });
  }

  // ---- Beta Pixel fingerprints (Advanced accordion) ----
  // The list is fetched live from the canary-miner repo (beta_pif.sh list) on the
  // first open, so new devices appear automatically; it falls back to the full
  // known set when offline. Picking one imports it as a custom pif.
  var BETA_MODELS={akita:"Pixel 8a",blazer:"Pixel 10 Pro",bluejay:"Pixel 6a",caiman:"Pixel 9 Pro",cheetah:"Pixel 7 Pro",comet:"Pixel 9 Pro Fold",felix:"Pixel Fold",frankel:"Pixel 10",husky:"Pixel 8 Pro",komodo:"Pixel 9 Pro XL",lynx:"Pixel 7a",mustang:"Pixel 10 Pro XL",oriole:"Pixel 6",panther:"Pixel 7",rango:"Pixel 10 Pro Fold",raven:"Pixel 6 Pro",shiba:"Pixel 8",stallion:"Pixel 10a",tangorpro:"Pixel Tablet",tegu:"Pixel 9a",tokay:"Pixel 9"};
  // Only Android 12-launch Pixels (the 6 series) still reach STRONG via keybox attestation.
  var BETA_STRONG={bluejay:1,oriole:1,raven:1};
  var betaHead=document.getElementById("betaHead"),betaAcc=document.getElementById("betaAcc");
  var betaBusy=false, betaLoaded=false;
  function betaCurCode(){ var pn=(__lastS&&__lastS.pif_name)||""; var m=pn.match(/^([A-Za-z0-9_]+)\.pif\.prop$/); return m?m[1]:""; }
  function betaRow(code){ var m=BETA_MODELS[code]||code, sel=betaCurCode()===code;
    return '<div class="beta'+(sel?" sel":"")+'" data-c="'+esc(code)+'"><div class="bn"><div class="m">'+esc(m)+'</div><div class="c">'+esc(code)+'</div></div>'+(BETA_STRONG[code]?'<span class="badge">STRONG</span>':'')+'<span class="ck">'+CHK2+'</span></div>'; }
  function betaRender(codes){ if(!betaAcc) return; betaAcc.innerHTML=codes.map(betaRow).join("");
    if(betaHead&&betaHead.classList.contains("open")) betaAcc.style.maxHeight=betaAcc.scrollHeight+"px"; }
  function betaLoad(){ if(betaLoaded) return; betaLoaded=true;
    ksuExec("sh "+shq(MOD+"/beta_pif.sh")+" list").then(function(r){
      var codes=(r.stdout||"").split("\n").map(function(s){ return s.trim(); }).filter(function(c){ return /^[A-Za-z0-9_]+$/.test(c); });
      if(!codes.length){ betaLoaded=false; codes=Object.keys(BETA_MODELS); }
      else codes.sort(function(a,b){ return (BETA_MODELS[a]||a).localeCompare(BETA_MODELS[b]||b); });
      betaRender(codes);
    }); }
  if(betaHead&&betaAcc){
    betaHead.addEventListener("click",function(){ var o=betaHead.classList.toggle("open"); if(o) betaLoad(); betaAcc.style.maxHeight=o?betaAcc.scrollHeight+"px":"0px"; });
    // delegated: the rows are rendered dynamically after the list fetch
    betaAcc.addEventListener("click",function(e){ var b=e.target&&e.target.closest?e.target.closest(".beta[data-c]"):null; if(!b) return;
      if(betaBusy) return; var code=b.dataset.c; if(!code) return; betaBusy=true;
      qa(".beta",betaAcc).forEach(function(x){ x.classList.remove("sel"); }); b.classList.add("sel");
      deferBg("sh "+shq(MOD+"/beta_pif.sh")+" get "+shq(code));
      setting("auto_fp",0); setting("custom_pif",1);
      var fp=dkInput("fingerprint pixel refresh"); if(fp) fp.checked=false;
      var label=BETA_MODELS[code]||code; setHeroModel(label);
      if(impDel) impDel.hidden=false; setImpRowSel(label,code+".pif.prop");
      toast(tr("t_applying","Applying")+" "+label+"…",3500);
      setTimeout(function(){ betaBusy=false; },1200);
    });
  }

  // ---- Target apps: real installed list, per-app tick + mode + keybox ----
  var appsModal=document.getElementById("appsModal");
  var patchModal=document.getElementById("patchModal");
  var menu=document.getElementById("appsMenu");
  var appsList=document.getElementById("appsList");
  var appq=document.getElementById("appq");
  var FORCED={"com.android.vending":1,"com.google.android.gms":1,"com.google.android.gsf":1};
  var EXCLUDE={}; ["com.topjohnwu.magisk","io.github.vvb2060.magisk","io.github.huskydg.magisk","me.weishu.kernelsu","com.rifsxd.ksunext","com.sukisu.ultra","me.bmax.apatch","me.garfieldhan.apatch.next","org.lsposed.manager","com.termux","bin.mt.plus","bin.mt.plus.canary","xzr.konabess","io.github.a13e300.ksuwebui","moe.shizuku.privileged.api","com.dergoogler.mmrl","com.dergoogler.mmrl.wx","org.swiftapps.swiftbackup","com.google.android.apps.maps","com.google.android.apps.translate","com.google.android.apps.youtube.music","com.google.android.keep","com.google.android.youtube","com.google.earth","org.zwanoo.android.speedtest","com.android.chrome"].forEach(function(p){ EXCLUDE[p]=1; });
  var MAPF=AS+"/apps.map", PKGS=AS+"/packages";
  var apps=[], labels={}, appMap={};
  // real app icon via the KSU-Next WebUI scheme ksu://icon/<pkg>: the manager serves it as a
  // 512px PNG, lazy-loaded by the browser and LRU-cached (no base64, no blocking), like
  // Tricky-Addon. On a manager without the scheme the image fails and onerror swaps in the
  // first-letter avatar.
  function avatarHtml(p){ var l=esc(avatarFor(p,labels[p]));
    return '<span class="appav" data-ltr="'+l+'"><img src="ksu://icon/'+encodeURIComponent(p)+'" alt="" loading="lazy" onerror="this.parentNode.textContent=this.parentNode.getAttribute(\'data-ltr\')"></span>'; }
  function specOf(pkg){ var v=appMap[pkg]; if(v==="off") return {off:true}; if(!v) return {kb:"-",mode:FORCED[pkg]?"gen":"auto"}; var b=v.split("|"); return {kb:b[0]||"-",mode:b[1]||"auto"}; }
  function avatarFor(pkg,lbl){ var src=lbl; if(!src){ var parts=String(pkg||"").split("."); src=(parts.length>1?parts[1]:parts[0])||pkg; } src=String(src).replace(/^[^A-Za-z0-9]+/,""); return (src.charAt(0)||"?").toUpperCase(); }
  function loadMap(){ return ksuExec("cat "+shq(MAPF)+" 2>/dev/null").then(function(r){ appMap={}; (r.stdout||"").split("\n").forEach(function(l){ if(!l) return; var i=l.indexOf("\t"); if(i<1) return; appMap[l.slice(0,i).trim()]=l.slice(i+1).trim(); }); }); }
  function saveMap(){ var body=""; Object.keys(appMap).sort().forEach(function(p){ if(appMap[p]) body+=p+"\t"+appMap[p]+"\n"; }); deferBg("mkdir -p "+shq(AS)+" && printf %s "+shq(body)+" > "+shq(MAPF)+"; sh "+shq(MOD+"/build_target_txt.sh")+" "+shq(CFG+"/target.txt")); }
  function loadApps(){ return ksuExec("{ pm list packages -3; echo com.google.android.gms; echo com.google.android.gsf; echo com.android.vending; cat "+shq(PKGS)+" 2>/dev/null; } 2>/dev/null | sed 's/^package://' | sort -u").then(function(r){ apps=(r.stdout||"").split("\n").map(function(s){ return s.trim(); }).filter(Boolean); labels={};
    try{ if(typeof ksu!=="undefined"&&ksu.getPackagesInfo){ var info=JSON.parse(ksu.getPackagesInfo(JSON.stringify(apps))); (info||[]).forEach(function(x){ if(x&&x.packageName) labels[x.packageName]=x.appLabel||""; }); } }catch(e){}
    }); }
  // mode is shown by the tick colour (like Tricky-Addon), so the badge carries
  // only a non-default keybox name, never the mode.
  function appBadge(pkg){ var s=specOf(pkg); if(s.off||!s.kb||s.kb==="-") return ""; return '<span class="badge">'+esc(s.kb.replace(/\.xml$/i,""))+'</span>'; }
  function renderApps(){
    if(!appsList) return;
    var raw=((appq&&appq.value)||"").trim(), ql=raw.toLowerCase();
    var list=ql?apps.filter(function(p){ return p.toLowerCase().indexOf(ql)>=0 || (labels[p]||"").toLowerCase().indexOf(ql)>=0; }):apps;
    var html="";
    if(raw&&isPkg(raw)&&!apps.some(function(p){ return p.toLowerCase()===ql; })){
      html+='<div class="appitem" data-add="'+esc(raw)+'"><span class="appav">+</span><span class="an"><span class="n">'+esc(tr("pak_add","Add package"))+'</span><span class="p">'+esc(raw)+'</span></span></div>';
    }
    if(!list.length&&!html){ appsList.innerHTML='<div class="card"><div class="empty" style="display:block">'+esc(tr("t_no_apps","No apps"))+'</div></div>'; return; }
    list.forEach(function(p){ var s=specOf(p); var lbl=labels[p]||p; var cls="appitem"; if(!s.off){ cls+=" on"; if(s.mode==="gen") cls+=" gen"; else if(s.mode==="hack") cls+=" hack"; }
      html+='<div class="'+cls+'" data-pkg="'+esc(p)+'">'+avatarHtml(p)+'<span class="an"><span class="n">'+esc(lbl)+'</span><span class="p">'+esc(p)+'</span></span>'+appBadge(p)+'<span class="cb">'+CHK2+'</span></div>';
    });
    appsList.innerHTML='<div class="card">'+html+'</div>';
  }
  function appsOpen(){ openM(appsModal); if(appq) appq.value=""; if(appsList) appsList.innerHTML='<div class="card"><div class="empty" style="display:block">…</div></div>';
    Promise.all([loadMap(),loadApps()]).then(function(){ renderApps(); }); }
  function toggleTick(pkg){ if(appMap[pkg]==="off") delete appMap[pkg]; else appMap[pkg]="off"; renderApps(); saveMap(); }
  function addCustomPkg(pkg){ pkg=(pkg||"").trim(); if(!isPkg(pkg)){ toast(tr("pak_add_bad","Enter a valid package name"),3000); return; }
    ksuExec("mkdir -p "+shq(AS)+" && ( grep -qxF "+shq(pkg)+" "+shq(PKGS)+" 2>/dev/null || printf '%s\\n' "+shq(pkg)+" >> "+shq(PKGS)+" )");
    if(!apps.some(function(p){ return p.toLowerCase()===pkg.toLowerCase(); })){ apps.push(pkg); apps.sort(); }
    delete appMap[pkg]; if(appq) appq.value=""; renderApps(); saveMap(); toast("+ "+pkg,2500); }
  var targetRow=document.getElementById("targetRow"); if(targetRow) targetRow.addEventListener("click",appsOpen);
  var appsClose=document.getElementById("appsClose"); if(appsClose) appsClose.addEventListener("click",function(){ if(menu) menu.hidden=true; closeM(appsModal); });
  if(appq) appq.addEventListener("input",renderApps);
  // tap = toggle tick; long-press = per-app config. click is the reliable tap
  // event on every WebUI host (the basic KSU host predates Pointer Events).
  var lpTimer=null, downPkg=null, dX=0, dY=0, lpFired=false, SLOP=12;
  function pkgOfEl(t){ var it=t&&t.closest?t.closest(".appitem"):null; return it?it.getAttribute("data-pkg"):null; }
  if(appsList){
    appsList.addEventListener("pointerdown",function(e){ lpFired=false; downPkg=pkgOfEl(e.target); if(!downPkg) return; dX=e.clientX; dY=e.clientY; lpTimer=setTimeout(function(){ lpTimer=null; lpFired=true; openCfg(downPkg); },420); });
    appsList.addEventListener("pointermove",function(e){ if(!lpTimer) return; if(Math.abs(e.clientX-dX)>SLOP||Math.abs(e.clientY-dY)>SLOP){ clearTimeout(lpTimer); lpTimer=null; } });
    appsList.addEventListener("pointercancel",function(){ if(lpTimer){ clearTimeout(lpTimer); lpTimer=null; } });
    appsList.addEventListener("pointerup",function(){ if(lpTimer){ clearTimeout(lpTimer); lpTimer=null; } });
    appsList.addEventListener("click",function(e){ var add=e.target.closest(".appitem[data-add]"); if(add){ addCustomPkg(add.getAttribute("data-add")); return; } if(lpFired) return; var pkg=pkgOfEl(e.target); if(pkg) toggleTick(pkg); });
  }
  // kebab: security patch / select all / deselect unnecessary / add package
  var kebab=document.getElementById("kebab"); if(kebab) kebab.addEventListener("click",function(e){ e.stopPropagation(); if(menu) menu.hidden=!menu.hidden; });
  document.addEventListener("click",function(e){ if(menu&&!menu.hidden&&!e.target.closest("#appsMenu")&&!e.target.closest("#kebab")) menu.hidden=true; });
  if(menu) qa("button",menu).forEach(function(b){ b.addEventListener("click",function(){ menu.hidden=true; var m=b.dataset.m;
    if(m==="patch"){ openM(patchModal); }
    else if(m==="all"){ apps.forEach(function(p){ if(appMap[p]==="off") delete appMap[p]; }); renderApps(); saveMap(); toast(tr("pak_selall_done","All apps selected"),2000); }
    else if(m==="unnec"){ var n=0; apps.forEach(function(p){ if(EXCLUDE[p]&&!FORCED[p]&&appMap[p]!=="off"){ appMap[p]="off"; n++; } }); renderApps(); saveMap(); toast(tr("pak_unnec_done","Deselected unnecessary")+(n?" ("+n+")":""),2500); }
    else if(m==="add"){ if(pkgInput) pkgInput.value=""; openM(pkgModal); setTimeout(function(){ if(pkgInput) pkgInput.focus(); },80); }
  }); });

  // ---- per-app config dialog (mode + keybox) ----
  var cfgModal=document.getElementById("cfgModal"),cfgModes=document.getElementById("cfgModes"),cfgKbName=document.getElementById("cfgKbName");
  var cfgPkg=null,cfgMode="auto",cfgKb="-";
  function cfgSetMode(m){ cfgMode=m; if(cfgModes) qa(".appitem",cfgModes).forEach(function(x){ var on=x.dataset.m===m; x.classList.toggle("on",on); x.classList.toggle("gen",on&&x.dataset.m==="gen"); x.classList.toggle("hack",on&&x.dataset.m==="hack"); }); }
  function cfgUpdKb(){ if(cfgKbName) cfgKbName.textContent=(cfgKb==="-")?tr("cfg_default","Default"):cfgKb.replace(/\.xml$/i,""); }
  function openCfg(pkg){ cfgPkg=pkg; var s=specOf(pkg); cfgMode=s.off?"auto":(s.mode||"auto"); cfgKb=(s.off||!s.kb)?"-":s.kb;
    document.getElementById("cfgName").textContent=labels[pkg]||pkg; document.getElementById("cfgPkg").textContent=pkg;
    cfgSetMode(cfgMode); cfgUpdKb(); openM(cfgModal); }
  if(cfgModes) qa(".appitem",cfgModes).forEach(function(x){ x.addEventListener("click",function(){ cfgSetMode(x.dataset.m); }); });
  document.getElementById("cfgClose").addEventListener("click",function(){ closeM(cfgModal); });
  cfgModal.addEventListener("click",function(e){ if(e.target===cfgModal) closeM(cfgModal); });
  document.getElementById("cfgApply").addEventListener("click",function(){ var spec=(cfgKb==="-"&&cfgMode==="auto")?null:(cfgKb+"|"+cfgMode); if(spec) appMap[cfgPkg]=spec; else delete appMap[cfgPkg]; closeM(cfgModal); renderApps(); saveMap(); });
  document.getElementById("cfgKbRow").addEventListener("click",function(){ openKbp(); });

  // ---- keybox picker (within per-app config) ----
  var kbpModal=document.getElementById("kbpModal"),kbpList=document.getElementById("kbpList"),kbpSel="-",kbpFiles=[];
  function availKeyboxes(){ return ksuExec("ls -1 "+shq(CFG)+" 2>/dev/null | grep -i '\\.xml$'").then(function(r){ return (r.stdout||"").split("\n").map(function(s){ return s.trim(); }).filter(function(f){ return f&&f.toLowerCase()!=="keybox.xml"; }); }); }
  function kbpRow(v,t,sub){ var sel=kbpSel===v; return '<div class="appitem'+(sel?" on":"")+'" data-v="'+esc(v)+'"><span class="appav"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="15" r="4"/><path d="M10.8 12.2 20 3"/><path d="m17 6 2 2"/><path d="m14.5 8.5 2 2"/></svg></span><span class="an"><span class="n">'+esc(t)+'</span>'+(sub?'<span class="p">'+esc(sub)+'</span>':'')+'</span><span class="cb">'+CHK2+'</span></div>'; }
  function renderKbp(){ var html=kbpRow("-",tr("pak_default","Default keybox"),"keybox.xml"); kbpFiles.forEach(function(f){ html+=kbpRow(f,f.replace(/\.xml$/i,""),f); });
    html+='<div class="appitem" data-v="__import"><span class="appav">+</span><span class="an"><span class="n">'+esc(tr("pak_import","Import keybox file…"))+'</span></span></div>';
    kbpList.innerHTML='<div class="card">'+html+'</div>'; }
  function openKbp(){ kbpSel=cfgKb; availKeyboxes().then(function(f){ kbpFiles=f; renderKbp(); openM(kbpModal); }); }
  document.getElementById("kbpClose").addEventListener("click",function(){ closeM(kbpModal); });
  document.getElementById("kbpCancel").addEventListener("click",function(){ closeM(kbpModal); });
  document.getElementById("kbpOk").addEventListener("click",function(){ cfgKb=kbpSel; cfgUpdKb(); closeM(kbpModal); });
  kbpModal.addEventListener("click",function(e){ if(e.target===kbpModal) closeM(kbpModal); });
  kbpList.addEventListener("click",function(e){ var it=e.target.closest(".appitem"); if(!it) return; var v=it.getAttribute("data-v");
    if(v==="__import"){ fmImportCb=function(fn){ availKeyboxes().then(function(f){ kbpFiles=f; kbpSel=fn; renderKbp(); }); }; fmOpen("import"); return; }
    kbpSel=v; renderKbp(); });

  // ---- add-package dialog ----
  var pkgModal=document.getElementById("pkgModal"),pkgInput=document.getElementById("pkgInput");
  function pkgSubmit(){ var v=(pkgInput.value||"").trim(); if(!isPkg(v)){ toast(tr("pak_add_bad","Enter a valid package name"),3000); return; } closeM(pkgModal); addCustomPkg(v); }
  document.getElementById("pkgClose").addEventListener("click",function(){ closeM(pkgModal); });
  document.getElementById("pkgCancel").addEventListener("click",function(){ closeM(pkgModal); });
  document.getElementById("pkgOk").addEventListener("click",pkgSubmit);
  pkgModal.addEventListener("click",function(e){ if(e.target===pkgModal) closeM(pkgModal); });
  pkgInput.addEventListener("keydown",function(e){ if(e.key==="Enter") pkgSubmit(); });

  // ---- security patch modal (kept) ----
  var patchClose=document.getElementById("patchClose"); if(patchClose) patchClose.addEventListener("click",function(){ closeM(patchModal); });
  var patchDone=document.getElementById("patchDone"); if(patchDone) patchDone.addEventListener("click",function(){ closeM(patchModal); });
  var patchFill=document.getElementById("patchFill"); if(patchFill) patchFill.addEventListener("click",function(){
    ksuExec('for f in '+shq(MOD+"/custom.pif.prop")+' '+shq(MOD+"/pif.prop")+' '+shq(CFG+"/custom.pif.prop")+' '+shq(CFG+"/pif.prop")+'; do [ -s "$f" ] && { v=$(grep -m1 \'^SECURITY_PATCH=\' "$f" | cut -d= -f2-); [ -n "$v" ] && { echo "$v"; break; }; }; done').then(function(r){
      var n=normPatch((r.stdout||"").trim()); if(!n){ toast(tr("getp_none","No patch in the active fingerprint"),3500); return; }
      qa('#patchModal .inp').forEach(function(i){ i.value=n; });
      deferBg('sh '+shq(STORE)+' set patch_system '+shq(n)+'; sh '+shq(STORE)+' set patch_vendor '+shq(n)+'; sh '+shq(STORE)+' set patch_boot '+shq(n)+'; sh '+shq(MOD+"/sync_patch.sh")+' boot');
      toast(tr("getp_ok","Security patch set:")+" "+n,3500);
    });
  });
  [appsModal,patchModal].forEach(function(md){ if(md) md.addEventListener("click",function(e){ if(e.target===md){ if(menu) menu.hidden=true; closeM(md); } }); });

  // ---- check interval editor ----
  var ivModal=document.getElementById("ivModal"),ivInput=document.getElementById("ivInput");
  var ivRow=dkRow("check every interval"); if(ivRow) ivRow.addEventListener("click",function(){ if(ivInput) ivInput.value=curInterval; openM(ivModal); });
  document.getElementById("ivClose").addEventListener("click",function(){ closeM(ivModal); });
  ivModal.addEventListener("click",function(e){ if(e.target===ivModal) closeM(ivModal); });
  qa("#ivPresets .pill").forEach(function(b){ b.addEventListener("click",function(){ ivInput.value=b.dataset.min; }); });
  function ivSave(){ var m=parseInt(ivInput.value,10); if(!isFinite(m)||m<1) m=60; curInterval=m; ivInput.value=m;
    var iv=q('[data-k="check every interval"] .val'); if(iv) iv.textContent=fmtMins(m);
    setting("interval_sec",m*60); flushNow(); }
  document.getElementById("ivDone").addEventListener("click",function(){ ivSave(); closeM(ivModal); });
  ivInput.addEventListener("keydown",function(e){ if(e.key==="Enter"){ ivSave(); closeM(ivModal); } });

  // ---- file picker (keybox / fingerprint import) ----
  var fmModal=document.getElementById("fmModal"),fmList=document.getElementById("fmList"),fmPathEl=document.getElementById("fmPath"),fmTitle=document.getElementById("fmTitle");
  var FM_START="/storage/emulated/0",fmPath=FM_START,fmMode="ck",fmImportCb=null;
  // last folder (survives reboots: stored in the module state file, loaded on init)
  var fmSaved="", fmItems=[];
  // sort field + direction + .xml-only filter, remembered per viewer in localStorage
  var fmSortKey=(function(){ try{ var s=localStorage.getItem("fm_skey"); return /^(name|date|size|type)$/.test(s||"")?s:"name"; }catch(e){ return "name"; } })();
  var fmSortDir=(function(){ try{ var s=localStorage.getItem("fm_sdir"); return (s==="asc"||s==="desc")?s:"asc"; }catch(e){ return "asc"; } })();
  var fmXml=(function(){ try{ return localStorage.getItem("fm_xml")!=="0"; }catch(e){ return true; } })();
  function fmExts(){ return (fmMode==="pif")?[".json",".prop"]:[".xml"]; }
  function fmMatchExt(nm){ nm=String(nm).toLowerCase(); var e=fmExts(); for(var i=0;i<e.length;i++){ if(nm.slice(-e[i].length)===e[i]) return true; } return false; }
  function fmExtOf(n){ n=String(n); var i=n.lastIndexOf("."); return i>0?n.slice(i+1).toLowerCase():""; }
  function fmCmp(a,b){ var r;
    if(fmSortKey==="date") r=a.mtime-b.mtime;
    else if(fmSortKey==="size") r=a.size-b.size;
    else if(fmSortKey==="type") r=fmExtOf(a.name).localeCompare(fmExtOf(b.name));
    else r=a.name.localeCompare(b.name);
    if(!r && fmSortKey!=="name") r=a.name.localeCompare(b.name);
    return fmSortDir==="desc"?-r:r; }
  var DIR_SVG='<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1h-8l-2-2H4a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1z"/></svg>';
  var FILE_SVG='<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z"/></svg>';
  function fmtSize(n){ if(n<1024) return n+" B"; if(n<1048576) return Math.round(n/1024)+" KB"; return (n/1048576).toFixed(1)+" MB"; }
  function fmtDate(t){ if(!t) return ""; try{ return new Date(t*1000).toISOString().slice(0,10); }catch(e){ return ""; } }
  function fmCrumb(){ var parts=fmPath.split("/").filter(Boolean),acc=""; var segs=parts.map(function(seg){ acc+="/"+seg; return '<span class="fmseg" data-p="'+esc(acc)+'" style="cursor:pointer">'+esc(seg)+'</span>'; }); fmPathEl.innerHTML=segs.length?segs.join(' <span style="opacity:.45">&rsaquo;</span> '):'<span class="fmseg" data-p="/">/</span>'; fmPathEl.scrollLeft=fmPathEl.scrollWidth; }
  function fetchDir(path){ return ksuExec("cd "+shq(path)+" 2>/dev/null && stat -c '%F\t%s\t%Y\t%n' * 2>/dev/null").then(function(r){ var items=[]; (r.stdout||"").split("\n").forEach(function(l){ if(!l) return; var p=l.split("\t"); if(p.length<4) return; var isDir=p[0]==="directory"; if(!isDir&&p[0].indexOf("regular")<0) return; items.push({dir:isDir,size:parseInt(p[1],10)||0,mtime:parseInt(p[2],10)||0,name:p.slice(3).join("\t")}); }); return items; }); }
  function fmRender(items){ fmCrumb(); var dirs=items.filter(function(i){ return i.dir; }).sort(fmCmp); var files=items.filter(function(i){ return !i.dir && (!fmXml || fmMatchExt(i.name)); }).sort(fmCmp); var html=""; if(fmPath!=="/") html+='<div class="appitem" data-dir="1" data-name=".."><span class="appav">'+DIR_SVG+'</span><span class="an"><span class="n">..</span><span class="p">'+esc(tr("fm_parent","Parent folder"))+'</span></span></div>'; dirs.concat(files).forEach(function(it){ var sub=it.dir?fmtDate(it.mtime):(fmtSize(it.size)+" · "+fmtDate(it.mtime)); html+='<div class="appitem" data-dir="'+(it.dir?1:0)+'" data-name="'+esc(it.name)+'"><span class="appav">'+(it.dir?DIR_SVG:FILE_SVG)+'</span><span class="an"><span class="n">'+esc(it.name)+'</span><span class="p">'+esc(sub)+'</span></span></div>'; }); if(!dirs.length&&!files.length) html='<div class="empty" style="display:block">'+esc(tr("fm_empty","Empty folder"))+'</div>'; fmList.innerHTML='<div class="card">'+html+'</div>'; fmList.scrollTop=0; }
  // remember the folder across reboots (debounced; detached root write)
  var _fmPathT=null;
  function fmSavePath(){ if(_fmPathT) clearTimeout(_fmPathT); _fmPathT=setTimeout(function(){ fmSaved=fmPath; deferBg("sh "+shq(STORE)+" state-set fm_path "+shq(fmPath)); },300); }
  function fmNav(){ fmSavePath(); fetchDir(fmPath).then(function(items){ fmItems=items; fmRender(items); }); }
  function fmBack(){ if(fmPath==="/") return; fmPath=fmPath.replace(/\/[^/]*$/,"")||"/"; fmNav(); }
  // ---- sort + filter popups (dropdowns) ----
  var FM_ASC='<path d="M7 20V7m0 0-4 4m4-4 4 4"/><path d="M14 8h6M14 13h4M14 18h2"/>';
  var FM_DESC='<path d="M7 4v13m0 0-4-4m4 4 4-4"/><path d="M14 8h6M14 13h4M14 18h2"/>';
  var CARET_UP='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 15 6-6 6 6"/></svg>';
  var CARET_DN='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
  var fmSortMenu=document.getElementById("fmSortMenu"), fmFilterMenu=document.getElementById("fmFilterMenu");
  function fmSyncSort(){ var ico=document.getElementById("fmSortIco"); if(ico) ico.innerHTML=(fmSortDir==="asc")?FM_ASC:FM_DESC;
    qa("button[data-k]",fmSortMenu).forEach(function(b){ var on=b.dataset.k===fmSortKey; b.classList.toggle("on",on);
      var d=b.querySelector(".fmdir"); if(d) d.innerHTML=on?((fmSortDir==="asc")?CARET_UP:CARET_DN):""; }); }
  function fmSyncFilter(){ var lb=document.getElementById("fmFLbl"); if(lb) lb.textContent=fmExts().join("/");
    var fb=document.getElementById("fmFilterBtn"); if(fb) fb.style.color=fmXml?"var(--accent)":"";
    qa("button[data-f]",fmFilterMenu).forEach(function(b){ var on=(b.dataset.f==="ext")===fmXml; b.classList.toggle("on",on);
      var c=b.querySelector(".fmck"); if(c) c.innerHTML=on?CHK2:""; }); }
  function fmCloseMenus(){ if(fmSortMenu) fmSortMenu.hidden=true; if(fmFilterMenu) fmFilterMenu.hidden=true; }
  function fmOpen(mode){ fmMode=(typeof mode==="string")?mode:"ck"; fmTitle.textContent=(fmMode==="pif")?tr("fm_sel_fp","Select fingerprint"):tr("fm_sel_kb","Select keybox"); fmCloseMenus(); fmSyncSort(); fmSyncFilter(); fmPath=fmSaved||FM_START; openM(fmModal); fmList.innerHTML='<div class="card"><div class="empty" style="display:block">…</div></div>'; fmNav(); }
  // header icons: tap to drop each popup (only one open at a time)
  var fmSortBtn=document.getElementById("fmSortBtn"); if(fmSortBtn) fmSortBtn.addEventListener("click",function(e){ e.stopPropagation(); if(fmFilterMenu) fmFilterMenu.hidden=true; if(fmSortMenu) fmSortMenu.hidden=!fmSortMenu.hidden; });
  var fmFilterBtn=document.getElementById("fmFilterBtn"); if(fmFilterBtn) fmFilterBtn.addEventListener("click",function(e){ e.stopPropagation(); if(fmSortMenu) fmSortMenu.hidden=true; if(fmFilterMenu) fmFilterMenu.hidden=!fmFilterMenu.hidden; });
  // sort: tap a field to sort by it; tap the active field again to flip direction
  if(fmSortMenu) qa("button[data-k]",fmSortMenu).forEach(function(b){ b.addEventListener("click",function(){
    var k=b.dataset.k; if(k===fmSortKey) fmSortDir=(fmSortDir==="asc")?"desc":"asc"; else fmSortKey=k;
    try{ localStorage.setItem("fm_skey",fmSortKey); localStorage.setItem("fm_sdir",fmSortDir); }catch(e){}
    fmSyncSort(); fmRender(fmItems); }); });
  // filter: only this mode's extension, or all files
  if(fmFilterMenu) qa("button[data-f]",fmFilterMenu).forEach(function(b){ b.addEventListener("click",function(){
    fmXml=(b.dataset.f==="ext"); try{ localStorage.setItem("fm_xml",fmXml?"1":"0"); }catch(e){}
    fmSyncFilter(); fmFilterMenu.hidden=true; fmRender(fmItems); }); });
  document.addEventListener("click",function(e){ if((fmSortMenu&&!fmSortMenu.hidden)||(fmFilterMenu&&!fmFilterMenu.hidden)){ if(!e.target.closest("#fmSortMenu")&&!e.target.closest("#fmFilterMenu")&&!e.target.closest("#fmSortBtn")&&!e.target.closest("#fmFilterBtn")) fmCloseMenus(); } });
  document.getElementById("fmUp").addEventListener("click",fmBack);
  document.getElementById("fmClose").addEventListener("click",function(){ closeM(fmModal); });
  fmModal.addEventListener("click",function(e){ if(e.target===fmModal) closeM(fmModal); });
  fmPathEl.addEventListener("click",function(e){ var s=e.target.closest(".fmseg"); if(s&&s.getAttribute("data-p")!==fmPath){ fmPath=s.getAttribute("data-p"); fmNav(); } });
  fmList.addEventListener("click",function(e){ var it=e.target.closest(".appitem"); if(!it) return; var name=it.getAttribute("data-name"); if(name===".."){ fmBack(); return; } var np=(fmPath==="/"?"":fmPath)+"/"+name; if(it.getAttribute("data-dir")==="1"){ fmPath=np; fmNav(); } else fmChoose(np,name); });
  function fmChoose(path,name){
    if(fmMode==="pif"){
      ksuExec("head -c 256 "+shq(path)+" 2>/dev/null | tr -d ' \\t\\r\\n' | cut -c1").then(function(a){ var first=(a.stdout||"").trim();
        ksuExec("grep -q '^FINGERPRINT=' "+shq(path)+" && echo 1 || echo 0").then(function(b){ var hasFp=(b.stdout||"").trim()==="1";
          if(first!=="{"&&!hasFp){ toast(tr("imp_none","Not a pif.json / pif.prop file"),4000); closeM(fmModal); return; }
          closeM(fmModal);
          ksuExec("grep -m1 '^MODEL=' "+shq(path)+" 2>/dev/null | cut -d= -f2- | tr -d '\"\\r'").then(function(mr){ var mdl=(mr.stdout||"").trim(); setHeroModel(mdl); setImpRowSel(mdl,name); });
          setting("custom_pif",1); setting("auto_fp",0); var fp=dkInput("fingerprint pixel refresh"); if(fp) fp.checked=false;
          if(impDel) impDel.hidden=false;
          toast(tr("t_applying","Applying")+" "+name+"…",6000);
          deferBg("sh "+shq(STORE)+" state-del pif_name; sh "+shq(STORE)+" state-del pif_model; sh "+shq(MOD+"/import_pif.sh")+" "+shq(path));
          pifPoll(name,14);
        }); });
      return;
    }
    ksuExec("sh "+shq(MOD+"/keybox_manage.sh")+" check "+shq(path)+" && echo ok || echo bad").then(function(c){
      if((c.stdout||"").trim()!=="ok"){ toast(tr("ck_bad","Not a valid keybox"),3500); closeM(fmModal); return; }
      if(fmMode==="import"){
        var fn=name.replace(/[^A-Za-z0-9._-]/g,"_"); if(!/\.xml$/i.test(fn)) fn+=".xml"; if(fn.toLowerCase()==="keybox.xml") fn="imported_"+fn;
        var MAN=AS+"/imported";
        ksuExec("sh "+shq(MOD+"/keybox_manage.sh")+" import "+shq(path)+" "+shq(fn)+" && ( grep -qxF "+shq(fn)+" "+shq(MAN)+" 2>/dev/null || printf '%s\\n' "+shq(fn)+" >> "+shq(MAN)+" )").then(function(r){ if(r.errno!==0){ toast("Keybox import rejected",3500); return; } closeM(fmModal); var cb=fmImportCb; fmImportCb=null; if(cb) cb(fn); toast(tr("t_kb_imported","Keybox imported:")+" "+fn.replace(/\.xml$/i,""),3000); });
        return;
      }
      ksuExec("sh "+shq(MOD+"/keybox_manage.sh")+" install "+shq(path)+" custom "+shq(name)).then(function(r){ if(r.errno!==0 && r.errno!==2){ toast("Keybox import rejected; previous file kept",3500); return; } closeM(fmModal); refreshStatus();
        var h=q('#ckPick .txt .h'), s=q('#ckPick .txt .s'); if(h) h.textContent=name.replace(/\.xml$/i,""); if(s) s.textContent=tr("ck_selk","Selected keybox");
        if(ckDel) ckDel.hidden=false; ckRefresh(); toast(tr("t_kb_selected","Keybox selected:")+" "+name,3000); });
    });
  }
  function ckRefresh(){ ksuExec("if [ -s "+shq(KEYBOX)+" ]; then echo \"$(wc -c < "+shq(KEYBOX)+")|$(sed -n 's/^keybox_name=//p' "+shq(AS+"/state")+" 2>/dev/null | head -1)\"; else echo '0|'; fi").then(function(r){ var parts=(r.stdout||"0|").trim().split("|"); var bytes=parseInt(parts[0],10)||0; var nm=parts[1]||""; var s=q('#ckPick .txt .s'),h=q('#ckPick .txt .h'); if(bytes>0&&h&&s){ h.textContent=(nm||"keybox.xml").replace(/\.xml$/i,""); s.textContent=tr("ck_selk","Selected keybox"); } if(bytes>0&&ckDel) ckDel.hidden=false; }); }

  // custom-keybox file pick (Keybox card row)
  var ckPickRow=document.getElementById("ckPick"); if(ckPickRow) ckPickRow.addEventListener("click",function(){ fmOpen("ck"); });

  // import fingerprint (Advanced)
  var importRow=dkRow("import fingerprint pif json prop"); if(importRow) importRow.addEventListener("click",function(){ fmOpen("pif"); });

  // reset to defaults (Advanced)
  var rstModal=document.getElementById("rstModal");
  var resetRow=dkRow("reset defaults"); if(resetRow) resetRow.addEventListener("click",function(){ openM(rstModal); });
  document.getElementById("rstClose").addEventListener("click",function(){ closeM(rstModal); });
  document.getElementById("rstCancel").addEventListener("click",function(){ closeM(rstModal); });
  rstModal.addEventListener("click",function(e){ if(e.target===rstModal) closeM(rstModal); });
  document.getElementById("rstOk").addEventListener("click",function(){ var ok=document.getElementById("rstOk"); ok.disabled=true;
    ksuExec('sh '+shq(MOD+"/reset_defaults.sh")+' 2>&1').then(function(r){ closeM(rstModal); ok.disabled=false;
      if(r.errno===0&&/OK/.test(r.stdout||"")){ toast(tr("rst_done","Defaults restored, Action running"),2500); setTimeout(function(){ location.reload(); },1200); }
      else toast(tr("rst_fail","Reset failed, run reset_defaults.sh via root shell"),3500); }); });


  // ---- i18n: translate the UI labels; English keeps the mock text ----
  var AS_I={
    en:{t_kb_deleted:"Keybox deleted",fm_s_name:"Name",fm_s_date:"Date",fm_s_size:"Size",fm_s_type:"Type",fm_all:"All files",u_min:"min",u_h:"h",v_auto:"auto",spoofing:"Spoofing",kb_auto:"Auto check",t_applied:"Applied ✅",t_applying:"Applying",t_back_kb:"Back to automatic keybox",t_back_fp:"Back to automatic fingerprint",t_applied_next:"Applied on next refresh",t_log_timeout:"Log collection timed out",t_kb_imported:"Keybox imported:",t_kb_selected:"Keybox selected:",ck_selk:"Selected keybox",t_no_apps:"No apps",fm_sel_fp:"Select fingerprint",fm_sel_kb:"Select keybox",wv_run:"Run",wv_running:"Running…",wv_tap_again:"Tap again",wv_perm:"PERMANENT and cannot be reverted. Tap again to confirm.",wv_installed:"L1 keybox installed. Reinstall Netflix to apply.",wv_failed:"Failed, see logs",wv_ok:"Widevine L1 keybox installed",wv_fail_toast:"Widevine fix failed",wv_unsup:"Not supported on this device",wv_unsup2:"KmInstallKeybox not present, this device is not supported",sec_auto:"Automatic",sec_set:"Settings",sec_comm:"Community & support",sec_fpsrc:"Fingerprint source",sec_media:"Media",sec_target:"Targeting",wv_t:"Widevine L1 fix",wv_s:"Qualcomm only · tap to restore L1",at_t:"Auto targeting",at_s:"Add newly installed apps to the target list automatically",iv_title:"Check interval",iv_desc:"How often AlwaysStrong re-checks the keybox and fingerprint.",iv_min:"Minutes",done:"Done",cfg_mode:"Attestation mode",cfg_auto_s:"Let the keystore decide",cfg_gen_s:"Build the whole certificate chain",cfg_hack_s:"Patch only the leaf certificate",cfg_default:"Default",kbp_sel:"Select",add:"Add",pkg_desc:"Add a package that isn't listed, by its application id.",fm_title:"Select file",beta_t:"Beta fingerprints",beta_s:"Only Pixel 6a (bluejay) passes STRONG",patch_fill:"Fill from fingerprint",patch_desc:"The attested patch follows the fingerprint. Override a partition only if an app needs it.",spp_s2:"Match attestation to the fingerprint",tgt_s:"Apps, mode, keybox & security patch",logs_s:"Save a diagnostic bundle",lang_title:"Language",auto:"Configuration",fp_t:"Fingerprint",fp_s:"Automatic Pixel Canary refresh",kb_t:"Keybox",kb_s:"Auto check, writes only if newer",status:"Keybox status",ind_t:"Status indicator",ind_s:"Show status prefix in description",rs_t:"Block ROM spoof",rs_s:"Disable PixelProps / pihooks engines",int_t:"Check every",ckbx:"Custom keybox",ck_t:"Custom keybox",ck_s:"Use your own keybox, auto-fetch off",ck_pick:"Select keybox file",ck_none:"No file selected",ck_have:"keybox.xml",ck_bad:"Not a valid keybox",ck_sel:"Selected keybox:",fm_new:"Newest",fm_old:"Oldest",fm_empty:"Empty folder",fm_cancel:"Cancel",pak:"Target apps",pak_t:"Target apps",pak_s:"Choose apps, mode & keybox",pak_search:"Search apps",pak_default:"Default keybox",pak_import:"Import keybox file…",pak_mode:"Mode",pak_auto:"Auto",pak_auto_s:"Let AlwaysStrong decide",pak_gen:"Generate",pak_gen_s:"Generate the full cert chain (!)",pak_hack:"Hack",pak_hack_s:"Hack the leaf cert (?)",pak_keybox:"Keybox",pak_apply:"Apply",pak_ok:"OK",logs:"Collect logs",logs_run:"Collecting…",logs_done:"Saved:",logs_fail:"Failed, run via root shell",logs_slow:"Still running, check /sdcard",tab_main:"Configuration",tab_adv:"Advanced",adv:"Advanced",spoofvars:"Spoof variables",pak_menu:"Menu",pak_selall:"Select all",pak_unnec:"Deselect unnecessary",pak_add_dlg:"Add custom package",pak_add_ph2:"package.name",pak_selall_done:"All apps selected",pak_unnec_done:"Deselected unnecessary apps",adv_note:"These are for edge cases. Leave them default unless an app needs it, the defaults are what pass STRONG.",theme:"Theme",th_sys:"System",th_light:"Light",th_dark:"Dark",ind_fetch:"Fetching status…",ind_ok:"Status indicator restored",ind_fail:"Status not fetched, no connection? The hourly check adds it back",spf_t:"Spoof system props",spf_s:"Turn off if a wallet/bank app fails",imp_t:"Import fingerprint",imp_s:"Load a pif.json or pif.prop file",hrm_t:"Hide ROM identity",hrm_s:"Also hides ROM version & fast-charge toggle",spp_t:"Spoof security patch",spp_s:"Also write the patch to the device props (Settings & apps); off keeps the real date",patch:"Security patch",psys_t:"System",pven_t:"Vendor",pboot_t:"Boot",patch_note:"Leave a field empty for the automatic latest date. Format YYYY-MM-DD.",patch_bad:"Use YYYY-MM-DD, or leave empty for automatic",getp_t:"Get security patch",getp_s:"Fill the fields from the active fingerprint",getp_ok:"Security patch set:",getp_none:"No patch in the active fingerprint, set one first",applied:"Applied, restarting Play Integrity",imp_run:"Importing…",imp_ok:"Fingerprint imported",imp_bad:"Import failed",imp_none:"Not a pif.json / pif.prop file",pak_add:"Add custom package",pak_add_ph:"com.example.app",pak_add_bad:"Enter a valid package name",rst:"Reset",rst_t:"Reset to defaults",rst_s:"Undo every toggle here and re-run Action",rst_dlg:"Reset to defaults?",rst_body:"All toggles, spoof variables, the check interval and custom packages go back to the fresh-install defaults, and the fetched fingerprint replaces an imported one. Your keybox and per-app keybox assignments are kept. Action then runs again.",rst_ok:"Reset",rst_done:"Defaults restored, Action running",rst_fail:"Reset failed, run reset_defaults.sh via root shell"},
    tr:{t_kb_deleted:"Keybox silindi",fm_s_name:"Ad",fm_s_date:"Tarih",fm_s_size:"Boyut",fm_s_type:"Tür",fm_all:"Tüm dosyalar",u_min:"dk",u_h:"sa",v_auto:"oto",spoofing:"Taklit",kb_auto:"Otomatik kontrol",t_applied:"Uygulandı ✅",t_applying:"Uygulanıyor",t_back_kb:"Otomatik keybox'a dönüldü",t_back_fp:"Otomatik fingerprint'e dönüldü",t_applied_next:"Sonraki yenilemede uygulanır",t_log_timeout:"Log toplama zaman aşımına uğradı",t_kb_imported:"Keybox içe aktarıldı:",t_kb_selected:"Keybox seçildi:",ck_selk:"Seçili keybox",t_no_apps:"Uygulama yok",fm_sel_fp:"Fingerprint seç",fm_sel_kb:"Keybox seç",wv_run:"Çalıştır",wv_running:"Çalışıyor…",wv_tap_again:"Tekrar dokun",wv_perm:"KALICIDIR ve geri alınamaz. Onaylamak için tekrar dokun.",wv_installed:"L1 keybox kuruldu. Uygulamak için Netflix'i yeniden kur.",wv_failed:"Başarısız, loglara bak",wv_ok:"Widevine L1 keybox kuruldu",wv_fail_toast:"Widevine düzeltmesi başarısız",wv_unsup:"Bu cihazda desteklenmiyor",wv_unsup2:"KmInstallKeybox yok, bu cihaz desteklenmiyor",sec_auto:"Otomatik",sec_set:"Ayarlar",sec_comm:"Topluluk & destek",sec_fpsrc:"Fingerprint kaynağı",sec_media:"Medya",sec_target:"Hedefleme",wv_t:"Widevine L1 düzeltmesi",wv_s:"Yalnızca Qualcomm · L1 için dokun",at_t:"Otomatik hedefleme",at_s:"Yeni kurulan uygulamaları hedef listesine otomatik ekle",iv_title:"Kontrol aralığı",iv_desc:"AlwaysStrong'un keybox ve fingerprint'i ne sıklıkla yeniden kontrol edeceği.",iv_min:"Dakika",done:"Tamam",cfg_mode:"Attestation modu",cfg_auto_s:"Kararı keystore versin",cfg_gen_s:"Tüm sertifika zincirini oluştur",cfg_hack_s:"Yalnızca leaf sertifikayı yamala",cfg_default:"Varsayılan",kbp_sel:"Seç",add:"Ekle",pkg_desc:"Listede olmayan bir paketi uygulama kimliğiyle ekle.",fm_title:"Dosya seç",beta_t:"Beta fingerprint'ler",beta_s:"Yalnızca Pixel 6a (bluejay) STRONG'u geçer",patch_fill:"Fingerprint'ten doldur",patch_desc:"Doğrulanan yama fingerprint'i izler. Bir bölümü yalnızca bir uygulama gerektirirse geçersiz kıl.",spp_s2:"Attestation'ı fingerprint'e eşitle",tgt_s:"Uygulama, mod, keybox & güvenlik yaması",logs_s:"Tanılama paketi kaydet",lang_title:"Dil",auto:"Yapılandırma",fp_t:"Fingerprint",fp_s:"Otomatik Pixel Canary yenileme",kb_t:"Keybox",kb_s:"Otomatik kontrol, sadece yeniyse yazar",status:"Keybox durumu",ind_t:"Durum göstergesi",ind_s:"Açıklamada durum öneki göster",rs_t:"ROM spoofunu engelle",rs_s:"PixelProps / pihooks motorlarını kapat",int_t:"Kontrol aralığı",ckbx:"Özel keybox",ck_t:"Özel keybox",ck_s:"Kendi keyboxını kullan, oto çekme kapalı",ck_pick:"Keybox dosyası seç",ck_none:"Dosya seçilmedi",ck_have:"keybox.xml",ck_bad:"Geçerli keybox değil",ck_sel:"Seçili keybox:",fm_new:"En yeni",fm_old:"En eski",fm_empty:"Boş klasör",fm_cancel:"İptal",pak:"Hedef uygulamalar",pak_t:"Hedef uygulamalar",pak_s:"Uygulama, mod & keybox seç",pak_search:"Uygulama ara",pak_default:"Varsayılan keybox",pak_import:"Keybox dosyası içe aktar…",pak_mode:"Mod",pak_auto:"Oto",pak_auto_s:"AlwaysStrong karar versin",pak_gen:"Üret (Generate)",pak_gen_s:"Tüm sertifika zincirini üret (!)",pak_hack:"Hack",pak_hack_s:"Leaf sertifikayı değiştir (?)",pak_keybox:"Keybox",pak_apply:"Uygula",pak_ok:"Tamam",logs:"Log topla",logs_run:"Toplanıyor…",logs_done:"Kaydedildi:",logs_fail:"Başarısız, root shell'den çalıştır",logs_slow:"Hâlâ çalışıyor, /sdcard klasörüne bak",tab_main:"Yapılandırma",tab_adv:"Gelişmiş",adv:"Gelişmiş",spoofvars:"Spoof değişkenleri",pak_menu:"Menü",pak_selall:"Tümünü seç",pak_unnec:"Gereksizleri kaldır",pak_add_dlg:"Özel paket ekle",pak_add_ph2:"paket.adi",pak_selall_done:"Tüm uygulamalar seçildi",pak_unnec_done:"Gereksiz uygulamalar kaldırıldı",adv_note:"Bunlar istisnai durumlar içindir. Bir uygulama gerektirmedikçe varsayılan bırakın, STRONG'u geçiren varsayılanlardır.",theme:"Tema",th_sys:"Sistem",th_light:"Açık",th_dark:"Koyu",ind_fetch:"Durum alınıyor…",ind_ok:"Durum göstergesi geri geldi",ind_fail:"Durum alınamadı, internet yok mu? Saatlik kontrol geri ekler",spf_t:"Sistem proplarını spoofla",spf_s:"Cüzdan/banka uygulaman çalışmıyorsa kapat",imp_t:"Fingerprint içe aktar",imp_s:"pif.json veya pif.prop dosyası yükle",hrm_t:"ROM kimliğini gizle",hrm_s:"ROM sürümünü ve hızlı şarj anahtarını da gizler",spp_t:"Güvenlik yamasını spoofla",spp_s:"Yamayı cihaz özelliklerine de yazar (Ayarlar & uygulamalar); kapalıyken gerçek tarih kalır",patch:"Güvenlik yaması",psys_t:"System",pven_t:"Vendor",pboot_t:"Boot",patch_note:"Otomatik en güncel tarih için alanı boş bırakın. Biçim: YYYY-AA-GG.",patch_bad:"YYYY-AA-GG kullanın veya otomatik için boş bırakın",getp_t:"Güvenlik yamasını al",getp_s:"Alanları aktif fingerprint'ten doldur",getp_ok:"Güvenlik yaması:",getp_none:"Aktif fingerprint'te yama yok, önce fingerprint ayarla",applied:"Uygulandı, Play Integrity yeniden başlatılıyor",imp_run:"İçe aktarılıyor…",imp_ok:"Fingerprint içe aktarıldı",imp_bad:"İçe aktarma başarısız",imp_none:"pif.json / pif.prop dosyası değil",pak_add:"Özel paket ekle",pak_add_ph:"com.example.app",pak_add_bad:"Geçerli bir paket adı gir",rst:"Sıfırla",rst_t:"Varsayılanlara dön",rst_s:"Buradaki tüm ayarları geri al ve Action'ı yeniden çalıştır",rst_dlg:"Varsayılanlara dönülsün mü?",rst_body:"Tüm anahtarlar, spoof değişkenleri, kontrol aralığı ve özel paketler ilk kurulum değerlerine döner; indirilen fingerprint içe aktarılanın yerini alır. Keybox'ın ve uygulama başına keybox atamaların korunur. Ardından Action yeniden çalışır.",rst_ok:"Sıfırla",rst_done:"Varsayılanlar geri yüklendi, Action çalışıyor",rst_fail:"Sıfırlama başarısız, reset_defaults.sh'ı root kabuğundan çalıştır"},
    ru:{t_kb_deleted:"Keybox удалён",fm_s_name:"Имя",fm_s_date:"Дата",fm_s_size:"Размер",fm_s_type:"Тип",fm_all:"Все файлы",u_min:"мин",u_h:"ч",v_auto:"авто",spoofing:"Подмена",kb_auto:"Автопроверка",t_applied:"Применено ✅",t_applying:"Применение",t_back_kb:"Возврат к автоматическому keybox",t_back_fp:"Возврат к автоматическому fingerprint",t_applied_next:"Применится при следующем обновлении",t_log_timeout:"Сбор логов превысил время ожидания",t_kb_imported:"Keybox импортирован:",t_kb_selected:"Keybox выбран:",ck_selk:"Выбранный keybox",t_no_apps:"Нет приложений",fm_sel_fp:"Выбрать fingerprint",fm_sel_kb:"Выбрать keybox",wv_run:"Запустить",wv_running:"Выполняется…",wv_tap_again:"Нажмите ещё раз",wv_perm:"НЕОБРАТИМО, отменить нельзя. Нажмите ещё раз для подтверждения.",wv_installed:"L1 keybox установлен. Переустановите Netflix для применения.",wv_failed:"Ошибка, см. логи",wv_ok:"Widevine L1 keybox установлен",wv_fail_toast:"Исправление Widevine не удалось",wv_unsup:"Не поддерживается на этом устройстве",wv_unsup2:"KmInstallKeybox отсутствует, устройство не поддерживается",sec_auto:"Автоматически",sec_set:"Настройки",sec_comm:"Сообщество и поддержка",sec_fpsrc:"Источник fingerprint",sec_media:"Медиа",sec_target:"Таргетинг",wv_t:"Исправление Widevine L1",wv_s:"Только Qualcomm · нажмите для восстановления L1",at_t:"Авто-таргетинг",at_s:"Автоматически добавлять новые приложения в список целей",iv_title:"Интервал проверки",iv_desc:"Как часто AlwaysStrong перепроверяет keybox и fingerprint.",iv_min:"Минуты",done:"Готово",cfg_mode:"Режим аттестации",cfg_auto_s:"Пусть решает keystore",cfg_gen_s:"Построить всю цепочку сертификатов",cfg_hack_s:"Патчить только листовой сертификат",cfg_default:"По умолчанию",kbp_sel:"Выбрать",add:"Добавить",pkg_desc:"Добавьте пакет, которого нет в списке, по его app id.",fm_title:"Выбрать файл",beta_t:"Бета-fingerprint'ы",beta_s:"Только Pixel 6a (bluejay) проходит STRONG",patch_fill:"Заполнить из fingerprint",patch_desc:"Аттестованный патч следует за fingerprint. Переопределяйте раздел только если это нужно приложению.",spp_s2:"Согласовать аттестацию с fingerprint",tgt_s:"Приложения, режим, keybox и патч",logs_s:"Сохранить диагностический пакет",lang_title:"Язык",auto:"Автообновление",fp_t:"Fingerprint",fp_s:"Ежечасно с Pixel Canary",kb_t:"Keybox",kb_s:"Ежечасно проверка, запись только если новее",status:"Статус keybox",ind_t:"Индикатор",ind_s:"Показывать префикс в описании",rs_t:"Блок ROM-спуфа",rs_s:"Отключить PixelProps / pihooks",int_t:"Интервал",ckbx:"Свой keybox",ck_t:"Свой keybox",ck_s:"Использовать свой keybox, автозагрузка выключена",ck_pick:"Выбрать файл keybox",ck_none:"Файл не выбран",ck_have:"keybox.xml",ck_bad:"Недействительный keybox",ck_sel:"Выбранный keybox:",fm_new:"Сначала новые",fm_old:"Сначала старые",fm_empty:"Пустая папка",fm_cancel:"Отмена",pak:"Целевые приложения",pak_t:"Целевые приложения",pak_s:"Приложения, режим и keybox",pak_search:"Поиск приложений",pak_default:"Keybox по умолчанию",pak_import:"Импорт файла keybox…",pak_mode:"Режим",pak_auto:"Авто",pak_auto_s:"Пусть решает AlwaysStrong",pak_gen:"Генерация",pak_gen_s:"Сгенерировать всю цепочку сертификатов (!)",pak_hack:"Hack",pak_hack_s:"Подменить листовой сертификат (?)",pak_keybox:"Keybox",pak_apply:"Применить",pak_ok:"ОК",logs:"Собрать логи",logs_run:"Сбор…",logs_done:"Сохранено:",logs_fail:"Ошибка, запустите через root shell",logs_slow:"Ещё выполняется, см. /sdcard",tab_main:"Настройки",tab_adv:"Дополнительно",adv:"Дополнительно",spoofvars:"Переменные spoof",pak_menu:"Меню",pak_selall:"Выбрать все",pak_unnec:"Снять ненужные",pak_add_dlg:"Добавить пакет",pak_add_ph2:"имя.пакета",pak_selall_done:"Все приложения выбраны",pak_unnec_done:"Ненужные приложения сняты",adv_note:"Это для особых случаев. Оставьте значения по умолчанию, пока приложению не нужно иное, именно они дают STRONG.",theme:"Тема",th_sys:"Системная",th_light:"Светлая",th_dark:"Тёмная",ind_fetch:"Получение статуса…",ind_ok:"Индикатор статуса восстановлен",ind_fail:"Статус не получен, нет сети? Ежечасная проверка вернёт его",spf_t:"Подменять системные props",spf_s:"Выключите, если кошелёк или банк не работает",imp_t:"Импорт fingerprint",imp_s:"Загрузить файл pif.json или pif.prop",hrm_t:"Скрыть идентичность ROM",hrm_s:"Также скрывает версию ROM и переключатель быстрой зарядки",spp_t:"Подменять патч безопасности",spp_s:"Держит дату системного патча равной аттестованной, при выключении после перезагрузки вернётся реальная",applied:"Применено, перезапуск Play Integrity",imp_run:"Импорт…",imp_ok:"Fingerprint импортирован",imp_bad:"Импорт не удался",imp_none:"Это не файл pif.json / pif.prop",pak_add:"Добавить пакет",pak_add_ph:"com.example.app",pak_add_bad:"Введите корректное имя пакета",rst:"Сброс",rst_t:"Сбросить настройки",rst_s:"Отменить все переключатели и снова запустить Action",rst_dlg:"Сбросить настройки?",rst_body:"Все переключатели, spoof-переменные, интервал проверки и пользовательские пакеты вернутся к значениям по умолчанию, а загруженный fingerprint заменит импортированный. Keybox и назначения keybox для приложений сохраняются. Затем Action запустится снова.",rst_ok:"Сбросить",rst_done:"Настройки сброшены, Action выполняется",rst_fail:"Сброс не удался, запустите reset_defaults.sh из root-shell"},
    es:{t_kb_deleted:"Keybox eliminado",fm_s_name:"Nombre",fm_s_date:"Fecha",fm_s_size:"Tamaño",fm_s_type:"Tipo",fm_all:"Todos los archivos",u_min:"min",u_h:"h",v_auto:"auto",spoofing:"Simulando",kb_auto:"Comprobación automática",t_applied:"Aplicado ✅",t_applying:"Aplicando",t_back_kb:"Vuelta al keybox automático",t_back_fp:"Vuelta al fingerprint automático",t_applied_next:"Se aplica en la próxima actualización",t_log_timeout:"La recogida de registros expiró",t_kb_imported:"Keybox importado:",t_kb_selected:"Keybox seleccionado:",ck_selk:"Keybox seleccionado",t_no_apps:"Sin apps",fm_sel_fp:"Seleccionar fingerprint",fm_sel_kb:"Seleccionar keybox",wv_run:"Ejecutar",wv_running:"Ejecutando…",wv_tap_again:"Toca otra vez",wv_perm:"PERMANENTE y no se puede revertir. Toca otra vez para confirmar.",wv_installed:"Keybox L1 instalado. Reinstala Netflix para aplicar.",wv_failed:"Falló, mira los registros",wv_ok:"Keybox Widevine L1 instalado",wv_fail_toast:"El arreglo de Widevine falló",wv_unsup:"No compatible con este dispositivo",wv_unsup2:"KmInstallKeybox no está presente; este dispositivo no es compatible",sec_auto:"Automático",sec_set:"Ajustes",sec_comm:"Comunidad y soporte",sec_fpsrc:"Fuente del fingerprint",sec_media:"Multimedia",sec_target:"Segmentación",wv_t:"Arreglo de Widevine L1",wv_s:"Solo Qualcomm · toca para restaurar L1",at_t:"Segmentación automática",at_s:"Añadir automáticamente las apps recién instaladas a la lista de objetivos",iv_title:"Intervalo de comprobación",iv_desc:"Con qué frecuencia AlwaysStrong revisa el keybox y el fingerprint.",iv_min:"Minutos",done:"Hecho",cfg_mode:"Modo de atestación",cfg_auto_s:"Deja que decida el keystore",cfg_gen_s:"Construir toda la cadena de certificados",cfg_hack_s:"Parchear solo el certificado hoja",cfg_default:"Predeterminado",kbp_sel:"Seleccionar",add:"Añadir",pkg_desc:"Añade un paquete que no esté en la lista, por su id de aplicación.",fm_title:"Seleccionar archivo",beta_t:"Fingerprints beta",beta_s:"Solo Pixel 6a (bluejay) pasa STRONG",patch_fill:"Rellenar desde el fingerprint",patch_desc:"El parche atestiguado sigue al fingerprint. Anula una partición solo si una app lo necesita.",spp_s2:"Igualar la atestación al fingerprint",tgt_s:"Apps, modo, keybox y parche",logs_s:"Guardar un paquete de diagnóstico",lang_title:"Idioma",auto:"Actualización automática",fp_t:"Fingerprint",fp_s:"Refresco horario desde Pixel Canary",kb_t:"Keybox",kb_s:"Comprobación horaria, escribe solo si es nuevo",status:"Estado del keybox",ind_t:"Indicador",ind_s:"Mostrar prefijo de estado en la descripción",rs_t:"Bloquear ROM spoof",rs_s:"Desactivar PixelProps / pihooks",int_t:"Intervalo",ckbx:"Keybox propio",ck_t:"Keybox propio",ck_s:"Usa tu propio keybox, descarga automática desactivada",ck_pick:"Elegir archivo keybox",ck_none:"Ningún archivo seleccionado",ck_have:"keybox.xml",ck_bad:"No es un keybox válido",ck_sel:"Keybox seleccionado:",fm_new:"Más nuevos",fm_old:"Más antiguos",fm_empty:"Carpeta vacía",fm_cancel:"Cancelar",pak:"Apps objetivo",pak_t:"Apps objetivo",pak_s:"Elige apps, modo y keybox",pak_search:"Buscar apps",pak_default:"Keybox predeterminado",pak_import:"Importar archivo keybox…",pak_mode:"Modo",pak_auto:"Auto",pak_auto_s:"Que decida AlwaysStrong",pak_gen:"Generar",pak_gen_s:"Generar toda la cadena de certificados (!)",pak_hack:"Hack",pak_hack_s:"Modificar el certificado hoja (?)",pak_keybox:"Keybox",pak_apply:"Aplicar",pak_ok:"OK",logs:"Recoger registros",logs_run:"Recogiendo…",logs_done:"Guardado:",logs_fail:"Falló, ejecuta desde una shell root",logs_slow:"Aún en curso, mira en /sdcard",tab_main:"Configuración",tab_adv:"Avanzado",adv:"Avanzado",spoofvars:"Variables de spoof",pak_menu:"Menú",pak_selall:"Seleccionar todo",pak_unnec:"Quitar las innecesarias",pak_add_dlg:"Añadir paquete",pak_add_ph2:"nombre.paquete",pak_selall_done:"Todas las apps seleccionadas",pak_unnec_done:"Apps innecesarias deseleccionadas",adv_note:"Esto es para casos límite. Déjalo como está salvo que una app lo necesite, los valores predeterminados son los que pasan STRONG.",theme:"Tema",th_sys:"Sistema",th_light:"Claro",th_dark:"Oscuro",ind_fetch:"Obteniendo estado…",ind_ok:"Indicador de estado restaurado",ind_fail:"Estado no obtenido, ¿sin conexión? La comprobación horaria lo devuelve",spf_t:"Falsear props del sistema",spf_s:"Desactívalo si falla una app de banco o cartera",imp_t:"Importar fingerprint",imp_s:"Carga un archivo pif.json o pif.prop",hrm_t:"Ocultar identidad de la ROM",hrm_s:"También oculta la versión de la ROM y la carga rápida",spp_t:"Falsear parche de seguridad",spp_s:"Mantiene la fecha del parche igual a la atestiguada, al desactivarlo vuelve la real tras reiniciar",applied:"Aplicado, reiniciando Play Integrity",imp_run:"Importando…",imp_ok:"Fingerprint importado",imp_bad:"Fallo al importar",imp_none:"No es un archivo pif.json / pif.prop",pak_add:"Añadir paquete",pak_add_ph:"com.example.app",pak_add_bad:"Escribe un nombre de paquete válido",rst:"Restablecer",rst_t:"Restablecer valores predeterminados",rst_s:"Deshacer todos los ajustes de aquí y volver a ejecutar Action",rst_dlg:"¿Restablecer valores predeterminados?",rst_body:"Todos los interruptores, las variables de spoof, el intervalo de comprobación y los paquetes personalizados vuelven a los valores de instalación, y el fingerprint descargado reemplaza al importado. Tu keybox y las asignaciones por app se conservan. Después Action se ejecuta de nuevo.",rst_ok:"Restablecer",rst_done:"Valores restablecidos, Action en marcha",rst_fail:"Fallo al restablecer, ejecuta reset_defaults.sh desde una shell root"},
    pt:{t_kb_deleted:"Keybox excluído",fm_s_name:"Nome",fm_s_date:"Data",fm_s_size:"Tamanho",fm_s_type:"Tipo",fm_all:"Todos os arquivos",u_min:"min",u_h:"h",v_auto:"auto",spoofing:"A simular",kb_auto:"Verificação automática",t_applied:"Aplicado ✅",t_applying:"A aplicar",t_back_kb:"De volta ao keybox automático",t_back_fp:"De volta ao fingerprint automático",t_applied_next:"Aplicado na próxima atualização",t_log_timeout:"A recolha de logs expirou",t_kb_imported:"Keybox importado:",t_kb_selected:"Keybox selecionado:",ck_selk:"Keybox selecionado",t_no_apps:"Sem apps",fm_sel_fp:"Selecionar fingerprint",fm_sel_kb:"Selecionar keybox",wv_run:"Executar",wv_running:"A executar…",wv_tap_again:"Toque de novo",wv_perm:"PERMANENTE e não pode ser revertido. Toque de novo para confirmar.",wv_installed:"Keybox L1 instalado. Reinstala o Netflix para aplicar.",wv_failed:"Falhou, veja os logs",wv_ok:"Keybox Widevine L1 instalado",wv_fail_toast:"A correção do Widevine falhou",wv_unsup:"Não suportado neste dispositivo",wv_unsup2:"KmInstallKeybox ausente; este dispositivo não é suportado",sec_auto:"Automático",sec_set:"Definições",sec_comm:"Comunidade e suporte",sec_fpsrc:"Fonte do fingerprint",sec_media:"Multimédia",sec_target:"Segmentação",wv_t:"Correção Widevine L1",wv_s:"Apenas Qualcomm · toque para restaurar L1",at_t:"Segmentação automática",at_s:"Adicionar automaticamente apps recém-instaladas à lista de alvos",iv_title:"Intervalo de verificação",iv_desc:"Com que frequência o AlwaysStrong verifica o keybox e o fingerprint.",iv_min:"Minutos",done:"Concluído",cfg_mode:"Modo de atestação",cfg_auto_s:"Deixe o keystore decidir",cfg_gen_s:"Construir toda a cadeia de certificados",cfg_hack_s:"Corrigir apenas o certificado folha",cfg_default:"Padrão",kbp_sel:"Selecionar",add:"Adicionar",pkg_desc:"Adicione um pacote que não está na lista, pelo seu id de aplicação.",fm_title:"Selecionar ficheiro",beta_t:"Fingerprints beta",beta_s:"Só o Pixel 6a (bluejay) passa STRONG",patch_fill:"Preencher a partir do fingerprint",patch_desc:"O patch atestado segue o fingerprint. Substitua uma partição só se uma app precisar.",spp_s2:"Igualar a atestação ao fingerprint",tgt_s:"Apps, modo, keybox e patch",logs_s:"Guardar um pacote de diagnóstico",lang_title:"Idioma",auto:"Atualização automática",fp_t:"Fingerprint",fp_s:"Atualização horária do Pixel Canary",kb_t:"Keybox",kb_s:"Verificação horária, grava só se for novo",status:"Status do keybox",ind_t:"Indicador",ind_s:"Mostrar prefixo de status na descrição",rs_t:"Bloquear ROM spoof",rs_s:"Desativar PixelProps / pihooks",int_t:"Intervalo",ckbx:"Keybox próprio",ck_t:"Keybox próprio",ck_s:"Usa o teu keybox, download automático desligado",ck_pick:"Escolher ficheiro keybox",ck_none:"Nenhum ficheiro selecionado",ck_have:"keybox.xml",ck_bad:"Keybox inválido",ck_sel:"Keybox selecionado:",fm_new:"Mais recentes",fm_old:"Mais antigos",fm_empty:"Pasta vazia",fm_cancel:"Cancelar",pak:"Apps alvo",pak_t:"Apps alvo",pak_s:"Escolhe apps, modo e keybox",pak_search:"Procurar apps",pak_default:"Keybox padrão",pak_import:"Importar ficheiro keybox…",pak_mode:"Modo",pak_auto:"Auto",pak_auto_s:"Deixa o AlwaysStrong decidir",pak_gen:"Gerar",pak_gen_s:"Gerar toda a cadeia de certificados (!)",pak_hack:"Hack",pak_hack_s:"Alterar o certificado folha (?)",pak_keybox:"Keybox",pak_apply:"Aplicar",pak_ok:"OK",logs:"Coletar logs",logs_run:"Coletando…",logs_done:"Salvo:",logs_fail:"Falhou, execute via shell root",logs_slow:"Ainda em execução, veja /sdcard",tab_main:"Configuração",tab_adv:"Avançado",adv:"Avançado",spoofvars:"Variáveis de spoof",pak_menu:"Menu",pak_selall:"Selecionar tudo",pak_unnec:"Remover as desnecessárias",pak_add_dlg:"Adicionar pacote",pak_add_ph2:"nome.pacote",pak_selall_done:"Todas as apps selecionadas",pak_unnec_done:"Apps desnecessárias removidas",adv_note:"Isto é para casos raros. Deixa nos valores padrão a não ser que uma app precise, são os padrões que passam STRONG.",theme:"Tema",th_sys:"Sistema",th_light:"Claro",th_dark:"Escuro",ind_fetch:"A obter estado…",ind_ok:"Indicador de estado reposto",ind_fail:"Estado não obtido, sem ligação? A verificação horária repõe-o",spf_t:"Falsificar props do sistema",spf_s:"Desliga se uma app de banco ou carteira falhar",imp_t:"Importar fingerprint",imp_s:"Carrega um ficheiro pif.json ou pif.prop",hrm_t:"Ocultar identidade da ROM",hrm_s:"Oculta também a versão da ROM e o carregamento rápido",spp_t:"Falsificar patch de segurança",spp_s:"Mantém a data do patch igual à atestada, desligado mostra a real após reiniciar",applied:"Aplicado, a reiniciar o Play Integrity",imp_run:"A importar…",imp_ok:"Fingerprint importado",imp_bad:"Falha ao importar",imp_none:"Não é um ficheiro pif.json / pif.prop",pak_add:"Adicionar pacote",pak_add_ph:"com.example.app",pak_add_bad:"Escreve um nome de pacote válido",rst:"Redefinir",rst_t:"Restaurar padrões",rst_s:"Desfazer todos os ajustes daqui e executar o Action novamente",rst_dlg:"Restaurar padrões?",rst_body:"Todos os interruptores, variáveis de spoof, o intervalo de verificação e os pacotes personalizados voltam aos padrões de instalação, e o fingerprint baixado substitui um importado. Seu keybox e as atribuições por app são mantidos. Em seguida o Action roda de novo.",rst_ok:"Redefinir",rst_done:"Padrões restaurados, Action em execução",rst_fail:"Falha ao redefinir, execute reset_defaults.sh em um shell root"},
    de:{t_kb_deleted:"Keybox gelöscht",fm_s_name:"Name",fm_s_date:"Datum",fm_s_size:"Größe",fm_s_type:"Typ",fm_all:"Alle Dateien",u_min:"Min",u_h:"Std",v_auto:"auto",spoofing:"Tarnt als",kb_auto:"Auto-Prüfung",t_applied:"Übernommen ✅",t_applying:"Wird übernommen",t_back_kb:"Zurück zur automatischen Keybox",t_back_fp:"Zurück zum automatischen Fingerprint",t_applied_next:"Wird bei der nächsten Aktualisierung übernommen",t_log_timeout:"Log-Sammlung hat das Zeitlimit überschritten",t_kb_imported:"Keybox importiert:",t_kb_selected:"Keybox ausgewählt:",ck_selk:"Gewählte Keybox",t_no_apps:"Keine Apps",fm_sel_fp:"Fingerprint wählen",fm_sel_kb:"Keybox wählen",wv_run:"Ausführen",wv_running:"Läuft…",wv_tap_again:"Nochmal tippen",wv_perm:"DAUERHAFT und nicht umkehrbar. Zum Bestätigen nochmal tippen.",wv_installed:"L1-Keybox installiert. Netflix neu installieren, um es anzuwenden.",wv_failed:"Fehlgeschlagen, siehe Logs",wv_ok:"Widevine-L1-Keybox installiert",wv_fail_toast:"Widevine-Fix fehlgeschlagen",wv_unsup:"Auf diesem Gerät nicht unterstützt",wv_unsup2:"KmInstallKeybox nicht vorhanden, dieses Gerät wird nicht unterstützt",sec_auto:"Automatisch",sec_set:"Einstellungen",sec_comm:"Community & Support",sec_fpsrc:"Fingerprint-Quelle",sec_media:"Medien",sec_target:"Zielauswahl",wv_t:"Widevine-L1-Fix",wv_s:"Nur Qualcomm · zum Wiederherstellen von L1 tippen",at_t:"Auto-Zielauswahl",at_s:"Neu installierte Apps automatisch zur Zielliste hinzufügen",iv_title:"Prüfintervall",iv_desc:"Wie oft AlwaysStrong Keybox und Fingerprint erneut prüft.",iv_min:"Minuten",done:"Fertig",cfg_mode:"Attestierungsmodus",cfg_auto_s:"Den Keystore entscheiden lassen",cfg_gen_s:"Ganze Zertifikatskette erstellen",cfg_hack_s:"Nur das Leaf-Zertifikat patchen",cfg_default:"Standard",kbp_sel:"Auswählen",add:"Hinzufügen",pkg_desc:"Ein nicht gelistetes Paket über seine App-ID hinzufügen.",fm_title:"Datei wählen",beta_t:"Beta-Fingerprints",beta_s:"Nur Pixel 6a (bluejay) besteht STRONG",patch_fill:"Aus Fingerprint füllen",patch_desc:"Der attestierte Patch folgt dem Fingerprint. Eine Partition nur überschreiben, wenn eine App es braucht.",spp_s2:"Attestierung an den Fingerprint angleichen",tgt_s:"Apps, Modus, Keybox & Patch",logs_s:"Ein Diagnosepaket speichern",lang_title:"Sprache",auto:"Auto-Update",fp_t:"Fingerprint",fp_s:"Stündliche Pixel-Canary-Aktualisierung",kb_t:"Keybox",kb_s:"Stündlich prüfen, nur bei Neuerem schreiben",status:"Keybox-Status",ind_t:"Statusanzeige",ind_s:"Statuspräfix in der Beschreibung",rs_t:"ROM-Spoof blockieren",rs_s:"PixelProps / pihooks deaktivieren",int_t:"Intervall",ckbx:"Eigene Keybox",ck_t:"Eigene Keybox",ck_s:"Eigene Keybox verwenden, Auto-Download aus",ck_pick:"Keybox-Datei wählen",ck_none:"Keine Datei gewählt",ck_have:"keybox.xml",ck_bad:"Keine gültige Keybox",ck_sel:"Gewählte Keybox:",fm_new:"Neueste",fm_old:"Älteste",fm_empty:"Leerer Ordner",fm_cancel:"Abbrechen",pak:"Ziel-Apps",pak_t:"Ziel-Apps",pak_s:"Apps, Modus & Keybox wählen",pak_search:"Apps suchen",pak_default:"Standard-Keybox",pak_import:"Keybox-Datei importieren…",pak_mode:"Modus",pak_auto:"Auto",pak_auto_s:"AlwaysStrong entscheiden lassen",pak_gen:"Erzeugen",pak_gen_s:"Ganze Zertifikatskette erzeugen (!)",pak_hack:"Hack",pak_hack_s:"Leaf-Zertifikat verändern (?)",pak_keybox:"Keybox",pak_apply:"Übernehmen",pak_ok:"OK",logs:"Logs sammeln",logs_run:"Sammle…",logs_done:"Gespeichert:",logs_fail:"Fehlgeschlagen, per Root-Shell ausführen",logs_slow:"Läuft noch, siehe /sdcard",tab_main:"Konfiguration",tab_adv:"Erweitert",adv:"Erweitert",spoofvars:"Spoof-Variablen",pak_menu:"Menü",pak_selall:"Alle auswählen",pak_unnec:"Unnötige abwählen",pak_add_dlg:"Paket hinzufügen",pak_add_ph2:"paket.name",pak_selall_done:"Alle Apps ausgewählt",pak_unnec_done:"Unnötige Apps abgewählt",adv_note:"Das ist für Sonderfälle. Lass die Standardwerte, solange keine App etwas anderes braucht, sie sind es, die STRONG bestehen.",theme:"Design",th_sys:"System",th_light:"Hell",th_dark:"Dunkel",ind_fetch:"Status wird geholt…",ind_ok:"Statusanzeige wiederhergestellt",ind_fail:"Status nicht geholt, keine Verbindung? Die stündliche Prüfung holt ihn nach",spf_t:"System-Props spoofen",spf_s:"Aus, wenn eine Wallet- oder Banking-App streikt",imp_t:"Fingerprint importieren",imp_s:"Eine pif.json- oder pif.prop-Datei laden",hrm_t:"ROM-Identität verbergen",hrm_s:"Verbirgt auch ROM-Version und Schnellladeschalter",spp_t:"Sicherheitspatch spoofen",spp_s:"Hält das System-Patchdatum gleich dem attestierten, aus zeigt nach einem Neustart das echte",applied:"Übernommen, Play Integrity wird neu gestartet",imp_run:"Importiere…",imp_ok:"Fingerprint importiert",imp_bad:"Import fehlgeschlagen",imp_none:"Keine pif.json- / pif.prop-Datei",pak_add:"Paket hinzufügen",pak_add_ph:"com.example.app",pak_add_bad:"Gib einen gültigen Paketnamen ein",rst:"Zurücksetzen",rst_t:"Auf Standard zurücksetzen",rst_s:"Alle Schalter hier zurücknehmen und Action erneut ausführen",rst_dlg:"Auf Standard zurücksetzen?",rst_body:"Alle Schalter, Spoof-Variablen, das Prüfintervall und eigene Pakete kehren zu den Installationsstandards zurück, der geladene Fingerprint ersetzt einen importierten. Deine Keybox und die Keybox-Zuweisungen pro App bleiben erhalten. Danach läuft Action erneut.",rst_ok:"Zurücksetzen",rst_done:"Standards wiederhergestellt, Action läuft",rst_fail:"Zurücksetzen fehlgeschlagen, reset_defaults.sh in einer Root-Shell ausführen"},
    fr:{t_kb_deleted:"Keybox supprimé",fm_s_name:"Nom",fm_s_date:"Date",fm_s_size:"Taille",fm_s_type:"Type",fm_all:"Tous les fichiers",u_min:"min",u_h:"h",v_auto:"auto",spoofing:"Imitation",kb_auto:"Vérif. auto",t_applied:"Appliqué ✅",t_applying:"Application",t_back_kb:"Retour au keybox automatique",t_back_fp:"Retour au fingerprint automatique",t_applied_next:"Appliqué à la prochaine actualisation",t_log_timeout:"La collecte des journaux a expiré",t_kb_imported:"Keybox importé :",t_kb_selected:"Keybox sélectionné :",ck_selk:"Keybox sélectionné",t_no_apps:"Aucune appli",fm_sel_fp:"Choisir un fingerprint",fm_sel_kb:"Choisir un keybox",wv_run:"Lancer",wv_running:"En cours…",wv_tap_again:"Touchez encore",wv_perm:"PERMANENT et irréversible. Touchez encore pour confirmer.",wv_installed:"Keybox L1 installé. Réinstallez Netflix pour appliquer.",wv_failed:"Échec, voir les journaux",wv_ok:"Keybox Widevine L1 installé",wv_fail_toast:"Le correctif Widevine a échoué",wv_unsup:"Non pris en charge sur cet appareil",wv_unsup2:"KmInstallKeybox absent, cet appareil n'est pas pris en charge",sec_auto:"Automatique",sec_set:"Paramètres",sec_comm:"Communauté & support",sec_fpsrc:"Source du fingerprint",sec_media:"Média",sec_target:"Ciblage",wv_t:"Correctif Widevine L1",wv_s:"Qualcomm uniquement · touchez pour restaurer L1",at_t:"Ciblage automatique",at_s:"Ajouter automatiquement les applis nouvellement installées à la liste des cibles",iv_title:"Intervalle de vérification",iv_desc:"À quelle fréquence AlwaysStrong revérifie le keybox et le fingerprint.",iv_min:"Minutes",done:"Terminé",cfg_mode:"Mode d'attestation",cfg_auto_s:"Laisser le keystore décider",cfg_gen_s:"Construire toute la chaîne de certificats",cfg_hack_s:"Modifier seulement le certificat feuille",cfg_default:"Par défaut",kbp_sel:"Sélectionner",add:"Ajouter",pkg_desc:"Ajoutez un paquet absent de la liste, par son id d'application.",fm_title:"Choisir un fichier",beta_t:"Fingerprints beta",beta_s:"Seul le Pixel 6a (bluejay) passe STRONG",patch_fill:"Remplir depuis le fingerprint",patch_desc:"Le correctif attesté suit le fingerprint. Ne remplacez une partition que si une appli l'exige.",spp_s2:"Aligner l'attestation sur le fingerprint",tgt_s:"Applis, mode, keybox & correctif",logs_s:"Enregistrer un lot de diagnostic",lang_title:"Langue",auto:"Mise à jour auto",fp_t:"Fingerprint",fp_s:"Rafraîchissement horaire depuis Pixel Canary",kb_t:"Keybox",kb_s:"Vérification horaire, écrit seulement si plus récent",status:"Statut keybox",ind_t:"Indicateur",ind_s:"Afficher le préfixe d'état",rs_t:"Bloquer le spoof ROM",rs_s:"Désactiver PixelProps / pihooks",int_t:"Intervalle",ckbx:"Keybox personnelle",ck_t:"Keybox personnelle",ck_s:"Utiliser votre keybox, téléchargement auto désactivé",ck_pick:"Choisir un fichier keybox",ck_none:"Aucun fichier sélectionné",ck_have:"keybox.xml",ck_bad:"Keybox invalide",ck_sel:"Keybox sélectionnée :",fm_new:"Plus récents",fm_old:"Plus anciens",fm_empty:"Dossier vide",fm_cancel:"Annuler",pak:"Applis ciblées",pak_t:"Applis ciblées",pak_s:"Choisir applis, mode et keybox",pak_search:"Rechercher des applis",pak_default:"Keybox par défaut",pak_import:"Importer un fichier keybox…",pak_mode:"Mode",pak_auto:"Auto",pak_auto_s:"Laisser AlwaysStrong décider",pak_gen:"Générer",pak_gen_s:"Générer toute la chaîne de certificats (!)",pak_hack:"Hack",pak_hack_s:"Modifier le certificat feuille (?)",pak_keybox:"Keybox",pak_apply:"Appliquer",pak_ok:"OK",logs:"Collecter les journaux",logs_run:"Collecte…",logs_done:"Enregistré :",logs_fail:"Échec, lancez via un shell root",logs_slow:"Toujours en cours, voir /sdcard",tab_main:"Configuration",tab_adv:"Avancé",adv:"Avancé",spoofvars:"Variables de spoof",pak_menu:"Menu",pak_selall:"Tout sélectionner",pak_unnec:"Décocher les inutiles",pak_add_dlg:"Ajouter un paquet",pak_add_ph2:"nom.du.paquet",pak_selall_done:"Toutes les applis sélectionnées",pak_unnec_done:"Applis inutiles décochées",adv_note:"C'est pour les cas particuliers. Laissez les valeurs par défaut sauf si une appli l'exige, ce sont elles qui passent STRONG.",theme:"Thème",th_sys:"Système",th_light:"Clair",th_dark:"Sombre",ind_fetch:"Récupération du statut…",ind_ok:"Indicateur de statut rétabli",ind_fail:"Statut non récupéré, pas de connexion ? La vérification horaire le remet",spf_t:"Falsifier les props système",spf_s:"Désactivez si une appli bancaire ou de paiement échoue",imp_t:"Importer un fingerprint",imp_s:"Charger un fichier pif.json ou pif.prop",hrm_t:"Masquer l'identité de la ROM",hrm_s:"Masque aussi la version de la ROM et la charge rapide",spp_t:"Falsifier le correctif de sécurité",spp_s:"Garde la date du correctif égale à celle attestée, désactivé, la vraie revient après un redémarrage",applied:"Appliqué, redémarrage de Play Integrity",imp_run:"Importation…",imp_ok:"Fingerprint importé",imp_bad:"Échec de l'import",imp_none:"Ce n'est pas un fichier pif.json / pif.prop",pak_add:"Ajouter un paquet",pak_add_ph:"com.example.app",pak_add_bad:"Saisissez un nom de paquet valide",rst:"Réinitialiser",rst_t:"Rétablir les valeurs par défaut",rst_s:"Annuler tous les réglages ici et relancer Action",rst_dlg:"Rétablir les valeurs par défaut ?",rst_body:"Tous les interrupteurs, les variables de spoof, l'intervalle de vérification et les paquets personnalisés reviennent aux valeurs d'installation, et le fingerprint téléchargé remplace celui importé. Votre keybox et les attributions par application sont conservées. Action est ensuite relancé.",rst_ok:"Réinitialiser",rst_done:"Valeurs rétablies, Action en cours",rst_fail:"Échec, lancez reset_defaults.sh depuis un shell root"},
    it:{t_kb_deleted:"Keybox eliminato",fm_s_name:"Nome",fm_s_date:"Data",fm_s_size:"Dimensione",fm_s_type:"Tipo",fm_all:"Tutti i file",u_min:"min",u_h:"h",v_auto:"auto",spoofing:"Spoofing",kb_auto:"Controllo automatico",t_applied:"Applicato ✅",t_applying:"Applicazione",t_back_kb:"Tornato al keybox automatico",t_back_fp:"Tornato al fingerprint automatico",t_applied_next:"Applicato al prossimo aggiornamento",t_log_timeout:"Raccolta log scaduta",t_kb_imported:"Keybox importato:",t_kb_selected:"Keybox selezionato:",ck_selk:"Keybox selezionata",t_no_apps:"Nessuna app",fm_sel_fp:"Seleziona fingerprint",fm_sel_kb:"Seleziona keybox",wv_run:"Esegui",wv_running:"In esecuzione…",wv_tap_again:"Tocca di nuovo",wv_perm:"PERMANENTE e non reversibile. Tocca di nuovo per confermare.",wv_installed:"Keybox L1 installato. Reinstalla Netflix per applicare.",wv_failed:"Non riuscito, vedi i log",wv_ok:"Keybox Widevine L1 installato",wv_fail_toast:"Correzione Widevine non riuscita",wv_unsup:"Non supportato su questo dispositivo",wv_unsup2:"KmInstallKeybox assente, dispositivo non supportato",sec_auto:"Automatico",sec_set:"Impostazioni",sec_comm:"Community e supporto",sec_fpsrc:"Origine del fingerprint",sec_media:"Media",sec_target:"Targeting",wv_t:"Correzione Widevine L1",wv_s:"Solo Qualcomm · tocca per ripristinare L1",at_t:"Targeting automatico",at_s:"Aggiungi automaticamente le app appena installate alla lista dei bersagli",iv_title:"Intervallo di controllo",iv_desc:"Con quale frequenza AlwaysStrong ricontrolla keybox e fingerprint.",iv_min:"Minuti",done:"Fatto",cfg_mode:"Modalità di attestazione",cfg_auto_s:"Lascia decidere al keystore",cfg_gen_s:"Costruisci l'intera catena di certificati",cfg_hack_s:"Modifica solo il certificato foglia",cfg_default:"Predefinito",kbp_sel:"Seleziona",add:"Aggiungi",pkg_desc:"Aggiungi un pacchetto non elencato tramite il suo id applicazione.",fm_title:"Seleziona file",beta_t:"Fingerprint beta",beta_s:"Solo Pixel 6a (bluejay) supera STRONG",patch_fill:"Compila dal fingerprint",patch_desc:"La patch attestata segue il fingerprint. Sovrascrivi una partizione solo se un'app lo richiede.",spp_s2:"Allinea l'attestazione al fingerprint",tgt_s:"App, modalità, keybox e patch",logs_s:"Salva un pacchetto diagnostico",lang_title:"Lingua",auto:"Aggiornamento automatico",fp_t:"Fingerprint",fp_s:"Aggiornamento orario da Pixel Canary",kb_t:"Keybox",kb_s:"Controllo orario, scrive solo se più recente",status:"Stato keybox",ind_t:"Indicatore",ind_s:"Mostra prefisso di stato",rs_t:"Blocca spoof ROM",rs_s:"Disattiva PixelProps / pihooks",int_t:"Intervallo",ckbx:"Keybox personale",ck_t:"Keybox personale",ck_s:"Usa la tua keybox, download automatico disattivato",ck_pick:"Scegli file keybox",ck_none:"Nessun file selezionato",ck_have:"keybox.xml",ck_bad:"Keybox non valida",ck_sel:"Keybox selezionata:",fm_new:"Più recenti",fm_old:"Più vecchi",fm_empty:"Cartella vuota",fm_cancel:"Annulla",pak:"App bersaglio",pak_t:"App bersaglio",pak_s:"Scegli app, modo e keybox",pak_search:"Cerca app",pak_default:"Keybox predefinita",pak_import:"Importa file keybox…",pak_mode:"Modo",pak_auto:"Auto",pak_auto_s:"Lascia decidere ad AlwaysStrong",pak_gen:"Genera",pak_gen_s:"Genera l'intera catena di certificati (!)",pak_hack:"Hack",pak_hack_s:"Modifica il certificato foglia (?)",pak_keybox:"Keybox",pak_apply:"Applica",pak_ok:"OK",logs:"Raccogli log",logs_run:"Raccolta…",logs_done:"Salvato:",logs_fail:"Non riuscito, esegui da shell root",logs_slow:"Ancora in corso, controlla /sdcard",tab_main:"Configurazione",tab_adv:"Avanzate",adv:"Avanzate",spoofvars:"Variabili di spoof",pak_menu:"Menu",pak_selall:"Seleziona tutto",pak_unnec:"Deseleziona le superflue",pak_add_dlg:"Aggiungi pacchetto",pak_add_ph2:"nome.pacchetto",pak_selall_done:"Tutte le app selezionate",pak_unnec_done:"App superflue deselezionate",adv_note:"Sono per casi particolari. Lasciale ai valori predefiniti finché un'app non richiede altro, sono i predefiniti a passare STRONG.",theme:"Tema",th_sys:"Sistema",th_light:"Chiaro",th_dark:"Scuro",ind_fetch:"Recupero stato…",ind_ok:"Indicatore di stato ripristinato",ind_fail:"Stato non recuperato, nessuna connessione? Il controllo orario lo rimette",spf_t:"Falsifica le props di sistema",spf_s:"Disattiva se un'app bancaria o wallet non funziona",imp_t:"Importa fingerprint",imp_s:"Carica un file pif.json o pif.prop",hrm_t:"Nascondi identità ROM",hrm_s:"Nasconde anche versione ROM e ricarica rapida",spp_t:"Falsifica la patch di sicurezza",spp_s:"Tiene la data della patch di sistema uguale a quella attestata, disattivata mostra quella reale dopo un riavvio",applied:"Applicato, riavvio di Play Integrity",imp_run:"Importazione…",imp_ok:"Fingerprint importato",imp_bad:"Importazione non riuscita",imp_none:"Non è un file pif.json / pif.prop",pak_add:"Aggiungi pacchetto",pak_add_ph:"com.example.app",pak_add_bad:"Inserisci un nome pacchetto valido",rst:"Ripristino",rst_t:"Ripristina predefiniti",rst_s:"Annulla tutte le impostazioni qui e riesegui Action",rst_dlg:"Ripristinare i predefiniti?",rst_body:"Tutti gli interruttori, le variabili spoof, l'intervallo di controllo e i pacchetti personalizzati tornano ai valori di installazione e il fingerprint scaricato sostituisce quello importato. La keybox e le assegnazioni per app restano. Poi Action viene rieseguito.",rst_ok:"Ripristina",rst_done:"Predefiniti ripristinati, Action in esecuzione",rst_fail:"Ripristino fallito, esegui reset_defaults.sh da una shell root"},
    id:{t_kb_deleted:"Keybox dihapus",fm_s_name:"Nama",fm_s_date:"Tanggal",fm_s_size:"Ukuran",fm_s_type:"Tipe",fm_all:"Semua file",u_min:"mnt",u_h:"jam",v_auto:"otomatis",spoofing:"Menyamar",kb_auto:"Cek otomatis",t_applied:"Diterapkan ✅",t_applying:"Menerapkan",t_back_kb:"Kembali ke keybox otomatis",t_back_fp:"Kembali ke fingerprint otomatis",t_applied_next:"Diterapkan saat penyegaran berikutnya",t_log_timeout:"Pengumpulan log kehabisan waktu",t_kb_imported:"Keybox diimpor:",t_kb_selected:"Keybox dipilih:",ck_selk:"Keybox terpilih",t_no_apps:"Tidak ada aplikasi",fm_sel_fp:"Pilih fingerprint",fm_sel_kb:"Pilih keybox",wv_run:"Jalankan",wv_running:"Berjalan…",wv_tap_again:"Ketuk lagi",wv_perm:"PERMANEN dan tidak bisa dibatalkan. Ketuk lagi untuk konfirmasi.",wv_installed:"Keybox L1 terpasang. Pasang ulang Netflix untuk menerapkan.",wv_failed:"Gagal, lihat log",wv_ok:"Keybox Widevine L1 terpasang",wv_fail_toast:"Perbaikan Widevine gagal",wv_unsup:"Tidak didukung di perangkat ini",wv_unsup2:"KmInstallKeybox tidak ada, perangkat ini tidak didukung",sec_auto:"Otomatis",sec_set:"Pengaturan",sec_comm:"Komunitas & dukungan",sec_fpsrc:"Sumber fingerprint",sec_media:"Media",sec_target:"Penargetan",wv_t:"Perbaikan Widevine L1",wv_s:"Hanya Qualcomm · ketuk untuk memulihkan L1",at_t:"Penargetan otomatis",at_s:"Tambahkan aplikasi yang baru dipasang ke daftar target secara otomatis",iv_title:"Interval pemeriksaan",iv_desc:"Seberapa sering AlwaysStrong memeriksa ulang keybox dan fingerprint.",iv_min:"Menit",done:"Selesai",cfg_mode:"Mode atestasi",cfg_auto_s:"Biar keystore yang memutuskan",cfg_gen_s:"Bangun seluruh rantai sertifikat",cfg_hack_s:"Tambal hanya sertifikat leaf",cfg_default:"Bawaan",kbp_sel:"Pilih",add:"Tambah",pkg_desc:"Tambahkan paket yang tidak terdaftar lewat id aplikasinya.",fm_title:"Pilih berkas",beta_t:"Fingerprint beta",beta_s:"Hanya Pixel 6a (bluejay) yang lolos STRONG",patch_fill:"Isi dari fingerprint",patch_desc:"Patch yang diatestasi mengikuti fingerprint. Timpa partisi hanya jika ada aplikasi yang memerlukannya.",spp_s2:"Samakan atestasi dengan fingerprint",tgt_s:"Aplikasi, mode, keybox & patch",logs_s:"Simpan paket diagnostik",lang_title:"Bahasa",auto:"Pembaruan otomatis",fp_t:"Fingerprint",fp_s:"Penyegaran tiap jam dari Pixel Canary",kb_t:"Keybox",kb_s:"Cek tiap jam, hanya tulis jika lebih baru",status:"Status keybox",ind_t:"Indikator",ind_s:"Tampilkan awalan status di deskripsi",rs_t:"Blokir spoof ROM",rs_s:"Nonaktifkan PixelProps / pihooks",int_t:"Interval",ckbx:"Keybox sendiri",ck_t:"Keybox sendiri",ck_s:"Pakai keybox milikmu, unduh otomatis mati",ck_pick:"Pilih berkas keybox",ck_none:"Belum ada berkas dipilih",ck_have:"keybox.xml",ck_bad:"Bukan keybox yang valid",ck_sel:"Keybox terpilih:",fm_new:"Terbaru",fm_old:"Terlama",fm_empty:"Folder kosong",fm_cancel:"Batal",pak:"Aplikasi target",pak_t:"Aplikasi target",pak_s:"Pilih aplikasi, mode & keybox",pak_search:"Cari aplikasi",pak_default:"Keybox bawaan",pak_import:"Impor berkas keybox…",pak_mode:"Mode",pak_auto:"Otomatis",pak_auto_s:"Biar AlwaysStrong yang memutuskan",pak_gen:"Generate",pak_gen_s:"Bangun seluruh rantai sertifikat (!)",pak_hack:"Hack",pak_hack_s:"Ubah sertifikat leaf (?)",pak_keybox:"Keybox",pak_apply:"Terapkan",pak_ok:"OK",logs:"Kumpulkan log",logs_run:"Mengumpulkan…",logs_done:"Disimpan:",logs_fail:"Gagal, jalankan lewat root shell",logs_slow:"Masih berjalan, cek /sdcard",tab_main:"Konfigurasi",tab_adv:"Lanjutan",adv:"Lanjutan",spoofvars:"Variabel spoof",pak_menu:"Menu",pak_selall:"Pilih semua",pak_unnec:"Hapus yang tak perlu",pak_add_dlg:"Tambah paket",pak_add_ph2:"nama.paket",pak_selall_done:"Semua aplikasi dipilih",pak_unnec_done:"Aplikasi yang tak perlu dilepas",adv_note:"Ini untuk kasus khusus. Biarkan bawaannya kecuali ada aplikasi yang butuh, nilai bawaan itulah yang lolos STRONG.",theme:"Tema",th_sys:"Sistem",th_light:"Terang",th_dark:"Gelap",ind_fetch:"Mengambil status…",ind_ok:"Indikator status dipulihkan",ind_fail:"Status gagal diambil, tidak ada koneksi? Pemeriksaan tiap jam akan mengembalikannya",spf_t:"Spoof props sistem",spf_s:"Matikan jika aplikasi dompet/bank gagal",imp_t:"Impor fingerprint",imp_s:"Muat berkas pif.json atau pif.prop",hrm_t:"Sembunyikan identitas ROM",hrm_s:"Menyembunyikan juga versi ROM dan sakelar pengisian cepat",spp_t:"Spoof patch keamanan",spp_s:"Menjaga tanggal patch sistem sama dengan yang diatestasi, jika mati, tanggal asli kembali setelah reboot",applied:"Diterapkan, memulai ulang Play Integrity",imp_run:"Mengimpor…",imp_ok:"Fingerprint diimpor",imp_bad:"Impor gagal",imp_none:"Bukan berkas pif.json / pif.prop",pak_add:"Tambah paket",pak_add_ph:"com.example.app",pak_add_bad:"Masukkan nama paket yang valid",rst:"Reset",rst_t:"Kembalikan ke bawaan",rst_s:"Batalkan semua pengaturan di sini dan jalankan Action lagi",rst_dlg:"Kembalikan ke bawaan?",rst_body:"Semua sakelar, variabel spoof, interval pemeriksaan dan paket kustom kembali ke nilai bawaan instalasi, dan fingerprint yang diunduh menggantikan yang diimpor. Keybox dan penetapan keybox per aplikasi tetap dipertahankan. Setelah itu Action dijalankan lagi.",rst_ok:"Reset",rst_done:"Bawaan dipulihkan, Action berjalan",rst_fail:"Reset gagal, jalankan reset_defaults.sh lewat shell root"},
    vi:{t_kb_deleted:"Đã xóa keybox",fm_s_name:"Tên",fm_s_date:"Ngày",fm_s_size:"Kích thước",fm_s_type:"Loại",fm_all:"Tất cả tệp",u_min:"phút",u_h:"giờ",v_auto:"tự động",spoofing:"Giả lập",kb_auto:"Tự kiểm tra",t_applied:"Đã áp dụng ✅",t_applying:"Đang áp dụng",t_back_kb:"Trở lại keybox tự động",t_back_fp:"Trở lại fingerprint tự động",t_applied_next:"Áp dụng ở lần làm mới sau",t_log_timeout:"Thu thập nhật ký đã hết thời gian",t_kb_imported:"Đã nhập keybox:",t_kb_selected:"Đã chọn keybox:",ck_selk:"Keybox đã chọn",t_no_apps:"Không có ứng dụng",fm_sel_fp:"Chọn fingerprint",fm_sel_kb:"Chọn keybox",wv_run:"Chạy",wv_running:"Đang chạy…",wv_tap_again:"Chạm lần nữa",wv_perm:"VĨNH VIỄN và không thể hoàn tác. Chạm lần nữa để xác nhận.",wv_installed:"Đã cài keybox L1. Cài lại Netflix để áp dụng.",wv_failed:"Thất bại, xem nhật ký",wv_ok:"Đã cài keybox Widevine L1",wv_fail_toast:"Sửa Widevine thất bại",wv_unsup:"Không hỗ trợ trên thiết bị này",wv_unsup2:"Không có KmInstallKeybox, thiết bị này không được hỗ trợ",sec_auto:"Tự động",sec_set:"Cài đặt",sec_comm:"Cộng đồng & hỗ trợ",sec_fpsrc:"Nguồn fingerprint",sec_media:"Phương tiện",sec_target:"Nhắm mục tiêu",wv_t:"Sửa Widevine L1",wv_s:"Chỉ Qualcomm · chạm để khôi phục L1",at_t:"Tự động nhắm mục tiêu",at_s:"Tự động thêm ứng dụng mới cài vào danh sách mục tiêu",iv_title:"Khoảng kiểm tra",iv_desc:"Tần suất AlwaysStrong kiểm tra lại keybox và fingerprint.",iv_min:"Phút",done:"Xong",cfg_mode:"Chế độ chứng thực",cfg_auto_s:"Để keystore quyết định",cfg_gen_s:"Dựng toàn bộ chuỗi chứng chỉ",cfg_hack_s:"Chỉ vá chứng chỉ lá",cfg_default:"Mặc định",kbp_sel:"Chọn",add:"Thêm",pkg_desc:"Thêm gói không có trong danh sách bằng app id của nó.",fm_title:"Chọn tệp",beta_t:"Fingerprint beta",beta_s:"Chỉ Pixel 6a (bluejay) đạt STRONG",patch_fill:"Điền từ fingerprint",patch_desc:"Bản vá được chứng thực theo fingerprint. Chỉ ghi đè một phân vùng khi ứng dụng cần.",spp_s2:"Khớp chứng thực với fingerprint",tgt_s:"Ứng dụng, chế độ, keybox & bản vá",logs_s:"Lưu gói chẩn đoán",lang_title:"Ngôn ngữ",auto:"Tự cập nhật",fp_t:"Fingerprint",fp_s:"Làm mới mỗi giờ từ Pixel Canary",kb_t:"Keybox",kb_s:"Kiểm tra mỗi giờ, chỉ ghi khi mới hơn",status:"Trạng thái keybox",ind_t:"Chỉ báo",ind_s:"Hiện tiền tố trạng thái trong mô tả",rs_t:"Chặn giả mạo ROM",rs_s:"Vô hiệu hóa PixelProps / pihooks",int_t:"Khoảng kiểm tra",ckbx:"Keybox riêng",ck_t:"Keybox riêng",ck_s:"Dùng keybox của bạn, tắt tải tự động",ck_pick:"Chọn tệp keybox",ck_none:"Chưa chọn tệp",ck_have:"keybox.xml",ck_bad:"Không phải keybox hợp lệ",ck_sel:"Keybox đã chọn:",fm_new:"Mới nhất",fm_old:"Cũ nhất",fm_empty:"Thư mục trống",fm_cancel:"Hủy",pak:"Ứng dụng mục tiêu",pak_t:"Ứng dụng mục tiêu",pak_s:"Chọn ứng dụng, chế độ & keybox",pak_search:"Tìm ứng dụng",pak_default:"Keybox mặc định",pak_import:"Nhập tệp keybox…",pak_mode:"Chế độ",pak_auto:"Tự động",pak_auto_s:"Để AlwaysStrong quyết định",pak_gen:"Tạo mới",pak_gen_s:"Tạo toàn bộ chuỗi chứng chỉ (!)",pak_hack:"Hack",pak_hack_s:"Sửa chứng chỉ lá (?)",pak_keybox:"Keybox",pak_apply:"Áp dụng",pak_ok:"OK",logs:"Thu thập nhật ký",logs_run:"Đang thu thập…",logs_done:"Đã lưu:",logs_fail:"Thất bại, chạy qua root shell",logs_slow:"Vẫn đang chạy, kiểm tra /sdcard",tab_main:"Cấu hình",tab_adv:"Nâng cao",adv:"Nâng cao",spoofvars:"Biến spoof",pak_menu:"Menu",pak_selall:"Chọn tất cả",pak_unnec:"Bỏ chọn ứng dụng không cần",pak_add_dlg:"Thêm gói",pak_add_ph2:"ten.goi",pak_selall_done:"Đã chọn tất cả ứng dụng",pak_unnec_done:"Đã bỏ chọn ứng dụng không cần",adv_note:"Dành cho trường hợp đặc biệt. Cứ để mặc định trừ khi một ứng dụng cần khác, chính mặc định mới đạt STRONG.",theme:"Giao diện",th_sys:"Hệ thống",th_light:"Sáng",th_dark:"Tối",ind_fetch:"Đang lấy trạng thái…",ind_ok:"Đã khôi phục chỉ báo trạng thái",ind_fail:"Không lấy được trạng thái, mất mạng? Lần kiểm tra mỗi giờ sẽ thêm lại",spf_t:"Giả mạo props hệ thống",spf_s:"Tắt nếu ứng dụng ví/ngân hàng lỗi",imp_t:"Nhập fingerprint",imp_s:"Tải tệp pif.json hoặc pif.prop",hrm_t:"Ẩn danh tính ROM",hrm_s:"Ẩn cả phiên bản ROM và công tắc sạc nhanh",spp_t:"Giả mạo bản vá bảo mật",spp_s:"Giữ ngày bản vá hệ thống bằng ngày được chứng thực, tắt thì ngày thật trở lại sau khi khởi động lại",applied:"Đã áp dụng, khởi động lại Play Integrity",imp_run:"Đang nhập…",imp_ok:"Đã nhập fingerprint",imp_bad:"Nhập thất bại",imp_none:"Không phải tệp pif.json / pif.prop",pak_add:"Thêm gói",pak_add_ph:"com.example.app",pak_add_bad:"Nhập tên gói hợp lệ",rst:"Đặt lại",rst_t:"Khôi phục mặc định",rst_s:"Hoàn tác mọi cài đặt ở đây và chạy lại Action",rst_dlg:"Khôi phục mặc định?",rst_body:"Mọi công tắc, biến spoof, khoảng kiểm tra và gói tùy chỉnh trở về giá trị cài đặt ban đầu, fingerprint tải về thay cho bản đã nhập. Keybox và gán keybox theo ứng dụng được giữ lại. Sau đó Action chạy lại.",rst_ok:"Đặt lại",rst_done:"Đã khôi phục mặc định, Action đang chạy",rst_fail:"Đặt lại thất bại, chạy reset_defaults.sh bằng shell root"},
    ar:{t_kb_deleted:"تم حذف الـ keybox",fm_s_name:"الاسم",fm_s_date:"التاريخ",fm_s_size:"الحجم",fm_s_type:"النوع",fm_all:"كل الملفات",u_min:"د",u_h:"س",v_auto:"تلقائي",spoofing:"انتحال",kb_auto:"فحص تلقائي",t_applied:"تم التطبيق ✅",t_applying:"جارٍ التطبيق",t_back_kb:"العودة إلى keybox التلقائي",t_back_fp:"العودة إلى fingerprint التلقائي",t_applied_next:"يُطبَّق عند التحديث التالي",t_log_timeout:"انتهت مهلة جمع السجلات",t_kb_imported:"تم استيراد keybox:",t_kb_selected:"تم اختيار keybox:",ck_selk:"الـ keybox المختار",t_no_apps:"لا توجد تطبيقات",fm_sel_fp:"اختر fingerprint",fm_sel_kb:"اختر keybox",wv_run:"تشغيل",wv_running:"يعمل…",wv_tap_again:"اضغط مجددًا",wv_perm:"دائم ولا يمكن التراجع عنه. اضغط مجددًا للتأكيد.",wv_installed:"تم تثبيت keybox L1. أعد تثبيت Netflix للتطبيق.",wv_failed:"فشل، راجع السجلات",wv_ok:"تم تثبيت keybox لـ Widevine L1",wv_fail_toast:"فشل إصلاح Widevine",wv_unsup:"غير مدعوم على هذا الجهاز",wv_unsup2:"KmInstallKeybox غير موجود، هذا الجهاز غير مدعوم",sec_auto:"تلقائي",sec_set:"الإعدادات",sec_comm:"المجتمع والدعم",sec_fpsrc:"مصدر fingerprint",sec_media:"الوسائط",sec_target:"الاستهداف",wv_t:"إصلاح Widevine L1",wv_s:"Qualcomm فقط · اضغط لاستعادة L1",at_t:"استهداف تلقائي",at_s:"إضافة التطبيقات المثبّتة حديثًا إلى قائمة الأهداف تلقائيًا",iv_title:"فترة الفحص",iv_desc:"كم مرة يعيد AlwaysStrong فحص keybox وfingerprint.",iv_min:"دقائق",done:"تم",cfg_mode:"وضع الإثبات",cfg_auto_s:"دع المخزن (keystore) يقرر",cfg_gen_s:"بناء سلسلة الشهادات كاملة",cfg_hack_s:"ترقيع الشهادة الطرفية فقط",cfg_default:"الافتراضي",kbp_sel:"اختيار",add:"إضافة",pkg_desc:"أضف حزمة غير مدرجة عبر معرّف تطبيقها.",fm_title:"اختر ملفًا",beta_t:"fingerprint التجريبية",beta_s:"Pixel 6a (bluejay) فقط يجتاز STRONG",patch_fill:"املأ من fingerprint",patch_desc:"الترقيع المُصدَّق يتبع fingerprint. تجاوز قسمًا فقط إذا احتاج تطبيق ذلك.",spp_s2:"طابق الإثبات مع fingerprint",tgt_s:"التطبيقات والوضع وkeybox والترقيع",logs_s:"احفظ حزمة تشخيص",lang_title:"اللغة",auto:"تحديث تلقائي",fp_t:"البصمة",fp_s:"تحديث كل ساعة من Pixel Canary",kb_t:"Keybox",kb_s:"فحص كل ساعة، يكتب فقط إذا كان أحدث",status:"حالة keybox",ind_t:"مؤشر الحالة",ind_s:"عرض بادئة الحالة في الوصف",rs_t:"حظر انتحال ROM",rs_s:"تعطيل PixelProps / pihooks",int_t:"التحقق كل",ckbx:"keybox خاص",ck_t:"keybox خاص",ck_s:"استخدم keybox الخاص بك, التنزيل التلقائي متوقف",ck_pick:"اختر ملف keybox",ck_none:"لم يتم اختيار ملف",ck_have:"keybox.xml",ck_bad:"ليس keybox صالحًا",ck_sel:"الـ keybox المختار:",fm_new:"الأحدث",fm_old:"الأقدم",fm_empty:"مجلد فارغ",fm_cancel:"إلغاء",pak:"التطبيقات المستهدفة",pak_t:"التطبيقات المستهدفة",pak_s:"اختر التطبيقات والوضع وkeybox",pak_search:"ابحث عن تطبيق",pak_default:"keybox الافتراضي",pak_import:"استيراد ملف keybox…",pak_mode:"الوضع",pak_auto:"تلقائي",pak_auto_s:"دع AlwaysStrong يقرر",pak_gen:"توليد",pak_gen_s:"توليد سلسلة الشهادات كاملة (!)",pak_hack:"Hack",pak_hack_s:"تعديل الشهادة الطرفية (?)",pak_keybox:"Keybox",pak_apply:"تطبيق",pak_ok:"موافق",logs:"جمع السجلات",logs_run:"يجري الجمع…",logs_done:"تم الحفظ:",logs_fail:"فشل, شغّله عبر صدفة الجذر",logs_slow:"لا يزال يعمل, راجع /sdcard",tab_main:"الإعدادات",tab_adv:"متقدم",adv:"متقدم",spoofvars:"متغيرات spoof",pak_menu:"القائمة",pak_selall:"تحديد الكل",pak_unnec:"إلغاء غير الضروري",pak_add_dlg:"إضافة حزمة",pak_add_ph2:"اسم.الحزمة",pak_selall_done:"تم تحديد كل التطبيقات",pak_unnec_done:"تم إلغاء التطبيقات غير الضرورية",adv_note:"هذه لحالات خاصة. اتركها على الوضع الافتراضي ما لم يحتج تطبيق غير ذلك, الإعدادات الافتراضية هي التي تجتاز STRONG.",theme:"المظهر",th_sys:"النظام",th_light:"فاتح",th_dark:"داكن",ind_fetch:"جارٍ جلب الحالة…",ind_ok:"تمت استعادة مؤشر الحالة",ind_fail:"تعذر جلب الحالة, لا يوجد اتصال؟ الفحص كل ساعة سيعيدها",spf_t:"انتحال خصائص النظام",spf_s:"أوقفه إذا فشل تطبيق محفظة أو بنك",imp_t:"استيراد fingerprint",imp_s:"حمّل ملف pif.json أو pif.prop",hrm_t:"إخفاء هوية الروم",hrm_s:"يخفي أيضًا إصدار الروم ومفتاح الشحن السريع",spp_t:"انتحال ترقيع الأمان",spp_s:"يبقي تاريخ ترقيع النظام مطابقًا للمُصدَّق, عند الإيقاف يعود التاريخ الحقيقي بعد إعادة التشغيل",applied:"تم التطبيق, إعادة تشغيل Play Integrity",imp_run:"جارٍ الاستيراد…",imp_ok:"تم استيراد fingerprint",imp_bad:"فشل الاستيراد",imp_none:"ليس ملف pif.json / pif.prop",pak_add:"إضافة حزمة",pak_add_ph:"com.example.app",pak_add_bad:"أدخل اسم حزمة صالحًا",rst:"إعادة تعيين",rst_t:"استعادة الإعدادات الافتراضية",rst_s:"التراجع عن كل الإعدادات هنا وإعادة تشغيل Action",rst_dlg:"استعادة الإعدادات الافتراضية؟",rst_body:"تعود كل المفاتيح ومتغيرات spoof وفترة الفحص والحزم المخصصة إلى قيم التثبيت الأولى، ويحل fingerprint المُنزَّل محل المستورد. يُحتفظ بـ keybox وتعيينات keybox لكل تطبيق. ثم يعمل Action مجددًا.",rst_ok:"إعادة تعيين",rst_done:"تمت الاستعادة, Action يعمل",rst_fail:"فشلت الاستعادة, شغّل reset_defaults.sh من صدفة root"},
    zh:{t_kb_deleted:"已删除 keybox",fm_s_name:"名称",fm_s_date:"日期",fm_s_size:"大小",fm_s_type:"类型",fm_all:"所有文件",u_min:"分钟",u_h:"小时",v_auto:"自动",spoofing:"伪装为",kb_auto:"自动检查",t_applied:"已应用 ✅",t_applying:"正在应用",t_back_kb:"已恢复自动 keybox",t_back_fp:"已恢复自动指纹",t_applied_next:"将在下次刷新时应用",t_log_timeout:"日志收集超时",t_kb_imported:"已导入 keybox：",t_kb_selected:"已选择 keybox：",ck_selk:"已选 keybox",t_no_apps:"没有应用",fm_sel_fp:"选择指纹",fm_sel_kb:"选择 keybox",wv_run:"运行",wv_running:"运行中…",wv_tap_again:"再次点按",wv_perm:"永久且无法撤销。再次点按以确认。",wv_installed:"已安装 L1 keybox。重新安装 Netflix 以生效。",wv_failed:"失败，请查看日志",wv_ok:"已安装 Widevine L1 keybox",wv_fail_toast:"Widevine 修复失败",wv_unsup:"此设备不支持",wv_unsup2:"没有 KmInstallKeybox，此设备不受支持",sec_auto:"自动",sec_set:"设置",sec_comm:"社区与支持",sec_fpsrc:"指纹来源",sec_media:"媒体",sec_target:"目标选择",wv_t:"Widevine L1 修复",wv_s:"仅限 Qualcomm · 点按以恢复 L1",at_t:"自动目标",at_s:"自动将新安装的应用加入目标列表",iv_title:"检查间隔",iv_desc:"AlwaysStrong 重新检查 keybox 和指纹的频率。",iv_min:"分钟",done:"完成",cfg_mode:"认证模式",cfg_auto_s:"交给 keystore 决定",cfg_gen_s:"构建完整证书链",cfg_hack_s:"仅修补叶证书",cfg_default:"默认",kbp_sel:"选择",add:"添加",pkg_desc:"通过应用 id 添加未列出的包。",fm_title:"选择文件",beta_t:"Beta 指纹",beta_s:"仅 Pixel 6a (bluejay) 能通过 STRONG",patch_fill:"从指纹填充",patch_desc:"认证的补丁随指纹而定。仅在应用需要时才覆盖某个分区。",spp_s2:"让认证与指纹一致",tgt_s:"应用、模式、keybox 和补丁",logs_s:"保存诊断包",lang_title:"语言",auto:"自动更新",fp_t:"指纹",fp_s:"每小时从 Pixel Canary 刷新",kb_t:"Keybox",kb_s:"每小时检查，仅在更新时写入",status:"Keybox 状态",ind_t:"状态指示",ind_s:"在描述中显示状态前缀",rs_t:"屏蔽 ROM 伪装",rs_s:"禁用 PixelProps / pihooks",int_t:"检查间隔",ckbx:"自定义 keybox",ck_t:"自定义 keybox",ck_s:"使用你自己的 keybox, 关闭自动获取",ck_pick:"选择 keybox 文件",ck_none:"未选择文件",ck_have:"keybox.xml",ck_bad:"不是有效的 keybox",ck_sel:"已选 keybox：",fm_new:"最新",fm_old:"最旧",fm_empty:"文件夹为空",fm_cancel:"取消",pak:"目标应用",pak_t:"目标应用",pak_s:"选择应用、模式与 keybox",pak_search:"搜索应用",pak_default:"默认 keybox",pak_import:"导入 keybox 文件…",pak_mode:"模式",pak_auto:"自动",pak_auto_s:"交给 AlwaysStrong 决定",pak_gen:"生成",pak_gen_s:"生成完整证书链 (!)",pak_hack:"Hack",pak_hack_s:"修改叶证书 (?)",pak_keybox:"Keybox",pak_apply:"应用",pak_ok:"确定",logs:"收集日志",logs_run:"收集中…",logs_done:"已保存：",logs_fail:"失败, 请通过 root shell 运行",logs_slow:"仍在运行, 请查看 /sdcard",tab_main:"配置",tab_adv:"高级",adv:"高级",spoofvars:"Spoof 变量",pak_menu:"菜单",pak_selall:"全选",pak_unnec:"取消不必要的",pak_add_dlg:"添加自定义包名",pak_add_ph2:"包名",pak_selall_done:"已选择全部应用",pak_unnec_done:"已取消不必要的应用",adv_note:"这些用于特殊情况。除非某个应用需要，否则保持默认, 通过 STRONG 的正是默认值。",theme:"主题",th_sys:"跟随系统",th_light:"浅色",th_dark:"深色",ind_fetch:"正在获取状态…",ind_ok:"状态指示已恢复",ind_fail:"未获取到状态, 没有网络？每小时检查会补回来",spf_t:"伪装系统 props",spf_s:"若钱包/银行应用异常请关闭",imp_t:"导入指纹",imp_s:"加载 pif.json 或 pif.prop 文件",hrm_t:"隐藏 ROM 标识",hrm_s:"同时隐藏 ROM 版本与快充开关",spp_t:"伪装安全补丁",spp_s:"让系统补丁日期与认证值一致, 关闭后重启会显示真实日期",applied:"已应用, 正在重启 Play Integrity",imp_run:"正在导入…",imp_ok:"指纹已导入",imp_bad:"导入失败",imp_none:"不是 pif.json / pif.prop 文件",pak_add:"添加自定义包名",pak_add_ph:"com.example.app",pak_add_bad:"请输入有效的包名",rst:"重置",rst_t:"恢复默认设置",rst_s:"撤销此处所有设置并重新运行 Action",rst_dlg:"恢复默认设置？",rst_body:"所有开关、spoof 变量、检查间隔和自定义包都会恢复到初始安装值，下载的 fingerprint 会替换导入的。你的 keybox 和按应用的 keybox 分配会保留。随后 Action 会重新运行。",rst_ok:"重置",rst_done:"已恢复默认, Action 正在运行",rst_fail:"重置失败, 请在 root shell 中运行 reset_defaults.sh"},
    ja:{t_kb_deleted:"keybox を削除しました",fm_s_name:"名前",fm_s_date:"日付",fm_s_size:"サイズ",fm_s_type:"種類",fm_all:"すべてのファイル",u_min:"分",u_h:"時間",v_auto:"自動",spoofing:"偽装中",kb_auto:"自動チェック",t_applied:"適用しました ✅",t_applying:"適用中",t_back_kb:"自動 keybox に戻しました",t_back_fp:"自動フィンガープリントに戻しました",t_applied_next:"次回の更新で適用されます",t_log_timeout:"ログ収集がタイムアウトしました",t_kb_imported:"keybox を取り込みました:",t_kb_selected:"keybox を選択:",ck_selk:"選択中の keybox",t_no_apps:"アプリなし",fm_sel_fp:"フィンガープリントを選択",fm_sel_kb:"keybox を選択",wv_run:"実行",wv_running:"実行中…",wv_tap_again:"もう一度タップ",wv_perm:"永続的で元に戻せません。確認するにはもう一度タップ。",wv_installed:"L1 keybox をインストールしました。適用するには Netflix を再インストール。",wv_failed:"失敗、ログを確認",wv_ok:"Widevine L1 keybox をインストールしました",wv_fail_toast:"Widevine 修正に失敗",wv_unsup:"この端末では非対応",wv_unsup2:"KmInstallKeybox がなく、この端末は非対応です",sec_auto:"自動",sec_set:"設定",sec_comm:"コミュニティとサポート",sec_fpsrc:"フィンガープリントのソース",sec_media:"メディア",sec_target:"ターゲット",wv_t:"Widevine L1 修正",wv_s:"Qualcomm のみ · タップして L1 を復元",at_t:"自動ターゲット",at_s:"新しくインストールしたアプリを自動でターゲットに追加",iv_title:"チェック間隔",iv_desc:"AlwaysStrong が keybox と指紋を再確認する頻度。",iv_min:"分",done:"完了",cfg_mode:"アテステーションモード",cfg_auto_s:"keystore に任せる",cfg_gen_s:"証明書チェーン全体を構築",cfg_hack_s:"リーフ証明書のみを修正",cfg_default:"既定",kbp_sel:"選択",add:"追加",pkg_desc:"一覧にないパッケージをアプリ ID で追加します。",fm_title:"ファイルを選択",beta_t:"ベータのフィンガープリント",beta_s:"Pixel 6a (bluejay) のみ STRONG を通過",patch_fill:"フィンガープリントから入力",patch_desc:"認証されたパッチはフィンガープリントに従います。アプリが必要とする場合のみパーティションを上書きします。",spp_s2:"アテステーションをフィンガープリントに合わせる",tgt_s:"アプリ・モード・keybox・パッチ",logs_s:"診断バンドルを保存",lang_title:"言語",auto:"自動更新",fp_t:"フィンガープリント",fp_s:"Pixel Canaryから毎時更新",kb_t:"Keybox",kb_s:"毎時チェック、新しい場合のみ書き込み",status:"Keybox の状態",ind_t:"ステータス表示",ind_s:"説明にステータスプレフィックスを表示",rs_t:"ROM 偽装をブロック",rs_s:"PixelProps / pihooks を無効化",int_t:"チェック間隔",ckbx:"独自のkeybox",ck_t:"独自のkeybox",ck_s:"自分のkeyboxを使う, 自動取得はオフ",ck_pick:"keyboxファイルを選択",ck_none:"ファイル未選択",ck_have:"keybox.xml",ck_bad:"有効なkeyboxではありません",ck_sel:"選択中のkeybox:",fm_new:"新しい順",fm_old:"古い順",fm_empty:"空のフォルダ",fm_cancel:"キャンセル",pak:"対象アプリ",pak_t:"対象アプリ",pak_s:"アプリ・モード・keyboxを選ぶ",pak_search:"アプリを検索",pak_default:"既定のkeybox",pak_import:"keyboxファイルを取り込む…",pak_mode:"モード",pak_auto:"自動",pak_auto_s:"AlwaysStrongに任せる",pak_gen:"生成",pak_gen_s:"証明書チェーン全体を生成 (!)",pak_hack:"Hack",pak_hack_s:"リーフ証明書を書き換える (?)",pak_keybox:"Keybox",pak_apply:"適用",pak_ok:"OK",logs:"ログを収集",logs_run:"収集中…",logs_done:"保存しました:",logs_fail:"失敗, root シェルで実行してください",logs_slow:"実行中, /sdcard を確認",tab_main:"設定",tab_adv:"詳細設定",adv:"詳細設定",spoofvars:"spoof 変数",pak_menu:"メニュー",pak_selall:"すべて選択",pak_unnec:"不要なものを解除",pak_add_dlg:"パッケージを追加",pak_add_ph2:"パッケージ名",pak_selall_done:"すべてのアプリを選択しました",pak_unnec_done:"不要なアプリを解除しました",adv_note:"これは例外的なケース向けです。アプリが必要としない限り既定のままに, STRONG を通すのは既定値です。",theme:"テーマ",th_sys:"システム",th_light:"ライト",th_dark:"ダーク",ind_fetch:"状態を取得中…",ind_ok:"ステータス表示を復元しました",ind_fail:"状態を取得できません, 接続なし？毎時のチェックで戻ります",spf_t:"システムpropsを偽装",spf_s:"ウォレット/銀行アプリが失敗する場合はオフに",imp_t:"フィンガープリントを取り込む",imp_s:"pif.json または pif.prop を読み込む",hrm_t:"ROMの身元を隠す",hrm_s:"ROMバージョンと急速充電スイッチも隠します",spp_t:"セキュリティパッチを偽装",spp_s:"システムのパッチ日付を認証済みの値に合わせます, オフなら再起動後に実際の日付に戻ります",applied:"適用しました, Play Integrity を再起動中",imp_run:"取り込み中…",imp_ok:"フィンガープリントを取り込みました",imp_bad:"取り込みに失敗しました",imp_none:"pif.json / pif.prop ファイルではありません",pak_add:"パッケージを追加",pak_add_ph:"com.example.app",pak_add_bad:"有効なパッケージ名を入力してください",rst:"リセット",rst_t:"初期設定に戻す",rst_s:"ここでの設定をすべて元に戻し、Action を再実行",rst_dlg:"初期設定に戻しますか？",rst_body:"すべてのスイッチ、spoof 変数、チェック間隔、カスタムパッケージがインストール時の初期値に戻り、取得した fingerprint がインポート済みのものを置き換えます。keybox とアプリ別 keybox 割り当ては保持されます。その後 Action が再実行されます。",rst_ok:"リセット",rst_done:"初期設定に戻しました, Action 実行中",rst_fail:"リセット失敗, root シェルで reset_defaults.sh を実行してください"},
    ko:{t_kb_deleted:"keybox 삭제됨",fm_s_name:"이름",fm_s_date:"날짜",fm_s_size:"크기",fm_s_type:"유형",fm_all:"모든 파일",u_min:"분",u_h:"시간",v_auto:"자동",spoofing:"위장 중",kb_auto:"자동 확인",t_applied:"적용됨 ✅",t_applying:"적용 중",t_back_kb:"자동 keybox로 되돌림",t_back_fp:"자동 지문으로 되돌림",t_applied_next:"다음 새로고침에 적용됨",t_log_timeout:"로그 수집 시간 초과",t_kb_imported:"keybox 가져옴:",t_kb_selected:"keybox 선택됨:",ck_selk:"선택된 keybox",t_no_apps:"앱 없음",fm_sel_fp:"지문 선택",fm_sel_kb:"keybox 선택",wv_run:"실행",wv_running:"실행 중…",wv_tap_again:"다시 탭",wv_perm:"영구적이며 되돌릴 수 없습니다. 확인하려면 다시 탭하세요.",wv_installed:"L1 keybox 설치됨. 적용하려면 Netflix를 재설치하세요.",wv_failed:"실패, 로그 확인",wv_ok:"Widevine L1 keybox 설치됨",wv_fail_toast:"Widevine 수정 실패",wv_unsup:"이 기기에서 지원되지 않음",wv_unsup2:"KmInstallKeybox 없음, 이 기기는 지원되지 않음",sec_auto:"자동",sec_set:"설정",sec_comm:"커뮤니티 및 지원",sec_fpsrc:"지문 소스",sec_media:"미디어",sec_target:"대상 지정",wv_t:"Widevine L1 수정",wv_s:"Qualcomm 전용 · 탭하여 L1 복원",at_t:"자동 대상 지정",at_s:"새로 설치된 앱을 대상 목록에 자동 추가",iv_title:"확인 간격",iv_desc:"AlwaysStrong이 keybox와 지문을 다시 확인하는 주기.",iv_min:"분",done:"완료",cfg_mode:"증명 모드",cfg_auto_s:"keystore가 결정하도록",cfg_gen_s:"전체 인증서 체인 구성",cfg_hack_s:"리프 인증서만 패치",cfg_default:"기본값",kbp_sel:"선택",add:"추가",pkg_desc:"목록에 없는 패키지를 앱 ID로 추가합니다.",fm_title:"파일 선택",beta_t:"베타 지문",beta_s:"Pixel 6a (bluejay)만 STRONG 통과",patch_fill:"지문에서 채우기",patch_desc:"증명된 패치는 지문을 따릅니다. 앱이 필요할 때만 파티션을 재정의하세요.",spp_s2:"증명을 지문에 맞추기",tgt_s:"앱, 모드, keybox 및 패치",logs_s:"진단 번들 저장",lang_title:"언어",auto:"자동 업데이트",fp_t:"지문",fp_s:"매시간 Pixel Canary에서 새로고침",kb_t:"Keybox",kb_s:"매시간 확인, 새 것일 때만 기록",status:"Keybox 상태",ind_t:"상태 표시",ind_s:"설명에 상태 접두사 표시",rs_t:"ROM 스푸핑 차단",rs_s:"PixelProps / pihooks 비활성화",int_t:"확인 간격",ckbx:"사용자 keybox",ck_t:"사용자 keybox",ck_s:"내 keybox 사용, 자동 내려받기 끔",ck_pick:"keybox 파일 선택",ck_none:"선택된 파일 없음",ck_have:"keybox.xml",ck_bad:"유효한 keybox가 아님",ck_sel:"선택된 keybox:",fm_new:"최신순",fm_old:"오래된순",fm_empty:"빈 폴더",fm_cancel:"취소",pak:"대상 앱",pak_t:"대상 앱",pak_s:"앱, 모드, keybox 선택",pak_search:"앱 검색",pak_default:"기본 keybox",pak_import:"keybox 파일 가져오기…",pak_mode:"모드",pak_auto:"자동",pak_auto_s:"AlwaysStrong에 맡기기",pak_gen:"생성",pak_gen_s:"인증서 체인 전체 생성 (!)",pak_hack:"Hack",pak_hack_s:"리프 인증서 변조 (?)",pak_keybox:"Keybox",pak_apply:"적용",pak_ok:"확인",logs:"로그 수집",logs_run:"수집 중…",logs_done:"저장됨:",logs_fail:"실패, 루트 셸에서 실행하세요",logs_slow:"실행 중, /sdcard 확인",tab_main:"설정",tab_adv:"고급",adv:"고급",spoofvars:"spoof 변수",pak_menu:"메뉴",pak_selall:"전체 선택",pak_unnec:"불필요한 항목 해제",pak_add_dlg:"패키지 추가",pak_add_ph2:"패키지.이름",pak_selall_done:"모든 앱을 선택했습니다",pak_unnec_done:"불필요한 앱을 해제했습니다",adv_note:"예외적인 경우를 위한 설정입니다. 앱이 요구하지 않는 한 기본값으로 두세요, STRONG을 통과시키는 것이 기본값입니다.",theme:"테마",th_sys:"시스템",th_light:"밝게",th_dark:"어둡게",ind_fetch:"상태 가져오는 중…",ind_ok:"상태 표시를 복원했습니다",ind_fail:"상태를 가져오지 못했습니다, 연결이 없나요? 매시간 확인이 다시 채웁니다",spf_t:"시스템 props 스푸핑",spf_s:"지갑/은행 앱이 실패하면 끄세요",imp_t:"지문 가져오기",imp_s:"pif.json 또는 pif.prop 파일 불러오기",hrm_t:"ROM 정체 숨기기",hrm_s:"ROM 버전과 고속 충전 스위치도 숨깁니다",spp_t:"보안 패치 스푸핑",spp_s:"시스템 패치 날짜를 인증된 값과 같게 유지, 끄면 재부팅 후 실제 날짜가 보입니다",applied:"적용됨, Play Integrity 재시작 중",imp_run:"가져오는 중…",imp_ok:"지문을 가져왔습니다",imp_bad:"가져오기 실패",imp_none:"pif.json / pif.prop 파일이 아닙니다",pak_add:"패키지 추가",pak_add_ph:"com.example.app",pak_add_bad:"올바른 패키지 이름을 입력하세요",rst:"초기화",rst_t:"기본값으로 되돌리기",rst_s:"여기의 모든 설정을 되돌리고 Action을 다시 실행",rst_dlg:"기본값으로 되돌릴까요?",rst_body:"모든 스위치, spoof 변수, 확인 간격, 사용자 패키지가 설치 초기값으로 돌아가고, 내려받은 fingerprint가 가져온 것을 대체합니다. keybox와 앱별 keybox 지정은 유지됩니다. 이후 Action이 다시 실행됩니다.",rst_ok:"초기화",rst_done:"기본값 복원됨, Action 실행 중",rst_fail:"초기화 실패, root 셸에서 reset_defaults.sh를 실행하세요"},
    hi:{t_kb_deleted:"keybox हटाया गया",fm_s_name:"नाम",fm_s_date:"तिथि",fm_s_size:"आकार",fm_s_type:"प्रकार",fm_all:"सभी फ़ाइलें",u_min:"मि",u_h:"घं",v_auto:"स्वतः",spoofing:"स्पूफ़िंग",kb_auto:"स्वतः जाँच",t_applied:"लागू हुआ ✅",t_applying:"लागू हो रहा",t_back_kb:"स्वचालित keybox पर वापस",t_back_fp:"स्वचालित fingerprint पर वापस",t_applied_next:"अगली रिफ़्रेश पर लागू",t_log_timeout:"लॉग संग्रह का समय समाप्त",t_kb_imported:"keybox आयात हुआ:",t_kb_selected:"keybox चुना गया:",ck_selk:"चुना गया keybox",t_no_apps:"कोई ऐप नहीं",fm_sel_fp:"fingerprint चुनें",fm_sel_kb:"keybox चुनें",wv_run:"चलाएँ",wv_running:"चल रहा…",wv_tap_again:"फिर टैप करें",wv_perm:"स्थायी है और वापस नहीं लिया जा सकता। पुष्टि के लिए फिर टैप करें।",wv_installed:"L1 keybox इंस्टॉल हुआ। लागू करने के लिए Netflix फिर इंस्टॉल करें।",wv_failed:"विफल, लॉग देखें",wv_ok:"Widevine L1 keybox इंस्टॉल हुआ",wv_fail_toast:"Widevine सुधार विफल",wv_unsup:"इस डिवाइस पर समर्थित नहीं",wv_unsup2:"KmInstallKeybox मौजूद नहीं, यह डिवाइस समर्थित नहीं",sec_auto:"स्वचालित",sec_set:"सेटिंग्स",sec_comm:"समुदाय और सहायता",sec_fpsrc:"फिंगरप्रिंट स्रोत",sec_media:"मीडिया",sec_target:"लक्ष्यीकरण",wv_t:"Widevine L1 सुधार",wv_s:"केवल Qualcomm · L1 बहाल करने के लिए टैप करें",at_t:"स्वतः लक्ष्यीकरण",at_s:"नई इंस्टॉल ऐप्स को लक्ष्य सूची में स्वतः जोड़ें",iv_title:"जाँच अंतराल",iv_desc:"AlwaysStrong keybox और fingerprint को कितनी बार दोबारा जाँचता है।",iv_min:"मिनट",done:"हो गया",cfg_mode:"अटेस्टेशन मोड",cfg_auto_s:"keystore को तय करने दें",cfg_gen_s:"पूरी सर्टिफ़िकेट चेन बनाएँ",cfg_hack_s:"केवल लीफ़ सर्टिफ़िकेट पैच करें",cfg_default:"डिफ़ॉल्ट",kbp_sel:"चुनें",add:"जोड़ें",pkg_desc:"सूची में न होने वाला पैकेज उसकी ऐप आईडी से जोड़ें।",fm_title:"फ़ाइल चुनें",beta_t:"बीटा फिंगरप्रिंट",beta_s:"केवल Pixel 6a (bluejay) STRONG पास करता है",patch_fill:"fingerprint से भरें",patch_desc:"अटेस्टेड पैच fingerprint का अनुसरण करता है। किसी ऐप को ज़रूरत हो तभी किसी पार्टिशन को ओवरराइड करें।",spp_s2:"अटेस्टेशन को fingerprint से मिलाएँ",tgt_s:"ऐप्स, मोड, keybox और पैच",logs_s:"डायग्नॉस्टिक बंडल सहेजें",lang_title:"भाषा",auto:"स्वतः अपडेट",fp_t:"फिंगरप्रिंट",fp_s:"हर घंटे Pixel Canary से ताज़ा",kb_t:"Keybox",kb_s:"हर घंटे जाँच, नया होने पर ही लिखें",status:"Keybox स्थिति",ind_t:"स्थिति संकेतक",ind_s:"विवरण में स्थिति उपसर्ग दिखाएं",rs_t:"ROM स्पूफ ब्लॉक करें",rs_s:"PixelProps / pihooks बंद करें",int_t:"हर बार जाँच",ckbx:"अपना keybox",ck_t:"अपना keybox",ck_s:"अपना keybox इस्तेमाल करें, ऑटो-डाउनलोड बंद",ck_pick:"keybox फ़ाइल चुनें",ck_none:"कोई फ़ाइल नहीं चुनी",ck_have:"keybox.xml",ck_bad:"यह वैध keybox नहीं है",ck_sel:"चुना गया keybox:",fm_new:"नए पहले",fm_old:"पुराने पहले",fm_empty:"खाली फ़ोल्डर",fm_cancel:"रद्द करें",pak:"लक्ष्य ऐप्स",pak_t:"लक्ष्य ऐप्स",pak_s:"ऐप, मोड और keybox चुनें",pak_search:"ऐप खोजें",pak_default:"डिफ़ॉल्ट keybox",pak_import:"keybox फ़ाइल आयात करें…",pak_mode:"मोड",pak_auto:"ऑटो",pak_auto_s:"AlwaysStrong को तय करने दें",pak_gen:"जनरेट",pak_gen_s:"पूरी सर्टिफ़िकेट चेन बनाएँ (!)",pak_hack:"Hack",pak_hack_s:"लीफ़ सर्टिफ़िकेट बदलें (?)",pak_keybox:"Keybox",pak_apply:"लागू करें",pak_ok:"ठीक है",logs:"लॉग एकत्र करें",logs_run:"एकत्र हो रहा…",logs_done:"सहेजा गया:",logs_fail:"विफल, रूट शेल से चलाएँ",logs_slow:"अभी भी चल रहा, /sdcard देखें",tab_main:"कॉन्फ़िगरेशन",tab_adv:"उन्नत",adv:"उन्नत",spoofvars:"spoof वेरिएबल",pak_menu:"मेन्यू",pak_selall:"सभी चुनें",pak_unnec:"अनावश्यक हटाएँ",pak_add_dlg:"पैकेज जोड़ें",pak_add_ph2:"पैकेज.नाम",pak_selall_done:"सभी ऐप चुने गए",pak_unnec_done:"अनावश्यक ऐप हटाए गए",adv_note:"ये विशेष स्थितियों के लिए हैं। जब तक कोई ऐप न कहे, डिफ़ॉल्ट ही रहने दें, STRONG डिफ़ॉल्ट मानों से ही पास होता है।",theme:"थीम",th_sys:"सिस्टम",th_light:"हल्का",th_dark:"गहरा",ind_fetch:"स्थिति ली जा रही…",ind_ok:"स्थिति संकेतक वापस आ गया",ind_fail:"स्थिति नहीं मिली, कनेक्शन नहीं? हर घंटे की जाँच इसे वापस जोड़ देगी",spf_t:"सिस्टम props स्पूफ़ करें",spf_s:"वॉलेट/बैंक ऐप फेल हो तो बंद करें",imp_t:"फिंगरप्रिंट आयात करें",imp_s:"pif.json या pif.prop फ़ाइल लोड करें",hrm_t:"ROM पहचान छिपाएँ",hrm_s:"ROM संस्करण और फ़ास्ट-चार्ज स्विच भी छिपाता है",spp_t:"सुरक्षा पैच स्पूफ़ करें",spp_s:"सिस्टम पैच तिथि को अटेस्टेड तिथि के बराबर रखता है, बंद करने पर रीबूट के बाद असली तिथि दिखेगी",applied:"लागू हुआ, Play Integrity पुनः चालू हो रहा है",imp_run:"आयात हो रहा…",imp_ok:"फिंगरप्रिंट आयात हुआ",imp_bad:"आयात विफल",imp_none:"यह pif.json / pif.prop फ़ाइल नहीं है",pak_add:"पैकेज जोड़ें",pak_add_ph:"com.example.app",pak_add_bad:"मान्य पैकेज नाम दर्ज करें",rst:"रीसेट",rst_t:"डिफ़ॉल्ट पर लौटें",rst_s:"यहाँ की सभी सेटिंग वापस लें और Action फिर चलाएँ",rst_dlg:"डिफ़ॉल्ट पर लौटें?",rst_body:"सभी स्विच, spoof वेरिएबल, जाँच अंतराल और कस्टम पैकेज इंस्टॉल के डिफ़ॉल्ट पर लौट जाते हैं, और डाउनलोड किया fingerprint आयातित की जगह लेता है। आपका keybox और प्रति-ऐप keybox असाइनमेंट बने रहते हैं। फिर Action दोबारा चलता है।",rst_ok:"रीसेट",rst_done:"डिफ़ॉल्ट बहाल, Action चल रहा है",rst_fail:"रीसेट विफल, root शेल से reset_defaults.sh चलाएँ"},
  };
  var AS_RTL={ar:1,he:1,fa:1,ur:1};
  var AS_NAMES={en:"English",tr:"Türkçe",ru:"Русский",es:"Español",pt:"Português",de:"Deutsch",fr:"Français",it:"Italiano",id:"Bahasa Indonesia",vi:"Tiếng Việt",ar:"العربية",zh:"中文",ja:"日本語",ko:"한국어",hi:"हिन्दी"};
  function i18nPick(){ try{ var s=localStorage.getItem("as_lang"); if(s&&AS_I[s]) return s; }catch(e){}
    var ls=[navigator.language].concat(navigator.languages||[]);
    for(var i=0;i<ls.length;i++){ var b=(ls[i]||"").toLowerCase().split("-")[0]; if(AS_I[b]) return b; }
    return "en"; }
  function i18nApply(code){ var T=AS_I[code]||{}, r=document.documentElement; r.lang=code; r.dir=AS_RTL[code]?"rtl":"ltr";
    qa("[data-i]").forEach(function(el){ var k=el.getAttribute("data-i"), o=el.getAttribute("data-i0");
      if(o===null){ o=el.textContent; el.setAttribute("data-i0",o); }
      el.textContent=(code!=="en"&&T[k])?T[k]:o; });
    qa("[data-iph]").forEach(function(el){ var k=el.getAttribute("data-iph"), o=el.getAttribute("data-iph0"); if(o===null){ o=el.getAttribute("placeholder")||""; el.setAttribute("data-iph0",o); } el.setAttribute("placeholder",(code!=="en"&&T[k])?T[k]:o); }); }
  // auto-detect from the device locale (no saved preference = system default)
  function i18nAuto(){ var ls=[navigator.language].concat(navigator.languages||[]); for(var i=0;i<ls.length;i++){ var b=(ls[i]||"").toLowerCase().split("-")[0]; if(AS_I[b]) return b; } return "en"; }
  var SAVED_LANG=(function(){ try{ var s=localStorage.getItem("as_lang"); return (s&&AS_I[s])?s:""; }catch(e){ return ""; } })();
  var CUR_LANG=SAVED_LANG||i18nAuto();
  var __lastS=null; // last state object, so the language can switch live
  var SYS_LABEL={en:"System default",tr:"Sistem varsayılanı",ru:"Системный язык",es:"Predeterminado del sistema",pt:"Padrão do sistema",de:"Systemstandard",fr:"Langue du système",it:"Predefinito di sistema",id:"Default sistem",vi:"Mặc định hệ thống",ar:"لغة النظام",zh:"跟随系统",ja:"システムの既定",ko:"시스템 기본값",hi:"सिस्टम डिफ़ॉल्ट"};
  // translate a dynamic string built in JS (English stays the mock source)
  function tr(k,fb){ var t=AS_I[CUR_LANG]; return (CUR_LANG!=="en"&&t&&t[k])?t[k]:fb; }
  // the Advanced tab's hero subtitle is a data-sub attribute, not a [data-i] node
  var ADV_SUB={en:"Edge cases, defaults already pass",tr:"İstisnai durumlar, varsayılanlar zaten geçiyor",ru:"Особые случаи, значения по умолчанию уже проходят",es:"Casos límite, los valores por defecto ya pasan",pt:"Casos limite, os padrões já passam",de:"Sonderfälle, die Standardwerte bestehen bereits",fr:"Cas limites, les valeurs par défaut passent déjà",it:"Casi limite, i predefiniti passano già",id:"Kasus khusus, nilai bawaan sudah lolos",vi:"Trường hợp đặc biệt, mặc định đã đạt",ar:"حالات خاصة، الإعدادات الافتراضية تجتاز بالفعل",zh:"特殊情况，默认值已通过",ja:"特殊なケース、既定値で既に通過",ko:"예외 상황, 기본값으로 이미 통과",hi:"विशेष स्थितियाँ, डिफ़ॉल्ट पहले से पास हैं"};
  (function(){ var at=q('.tab[data-pg="pgAdv"]'); if(at&&ADV_SUB[CUR_LANG]) at.dataset.sub=ADV_SUB[CUR_LANG]; })();
  i18nApply(CUR_LANG);
  var AUTO_STR=tr("v_auto","auto");
  function fmtMins(m){ return (m>=60&&m%60===0)?((m/60)+" "+tr("u_h","h")):(m+" "+tr("u_min","min")); }
  qa("#ivPresets .pill").forEach(function(b){ var mn=parseInt(b.dataset.min,10); if(isFinite(mn)) b.textContent=fmtMins(mn); });
  var langModal=document.getElementById("langModal"), langList=document.getElementById("langList");
  var FLAGS={en:"🇬🇧",tr:"🇹🇷",ru:"🇷🇺",es:"🇪🇸",pt:"🇵🇹",de:"🇩🇪",fr:"🇫🇷",it:"🇮🇹",id:"🇮🇩",vi:"🇻🇳",ar:"🇸🇦",zh:"🇨🇳",ja:"🇯🇵",ko:"🇰🇷",hi:"🇮🇳"};
  var GLOBE_SVG='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.7 2.6 15.3 0 18M12 3c-2.6 2.7-2.6 15.3 0 18"/></svg>';
  function buildLangList(){ if(!langList) return; var h='<div class="card">';
    // system default: follow the device locale (ticked when nothing is saved)
    h+='<div class="appitem'+(SAVED_LANG?"":" on")+'" data-lang="__sys"><span class="appav">'+GLOBE_SVG+'</span><span class="an"><span class="n">'+esc(SYS_LABEL[CUR_LANG]||SYS_LABEL.en)+'</span><span class="p">'+esc(AS_NAMES[i18nAuto()]||"")+'</span></span><span class="cb">'+CHK2+'</span></div>';
    Object.keys(AS_NAMES).forEach(function(code){ if(!AS_I[code]) return; var on=SAVED_LANG===code;
      h+='<div class="appitem'+(on?" on":"")+'" data-lang="'+code+'"><span class="appav"'+(FLAGS[code]?' style="font-size:22px"':'')+'>'+(FLAGS[code]||esc(code.toUpperCase()))+'</span><span class="an"><span class="n">'+esc(AS_NAMES[code])+'</span><span class="p">'+esc(code)+'</span></span><span class="cb">'+CHK2+'</span></div>'; });
    h+='</div>'; langList.innerHTML=h; }
  // switch language live, without closing the dialog or reloading the page
  function applyLangLive(code){
    SAVED_LANG=code||""; CUR_LANG=SAVED_LANG||i18nAuto();
    AUTO_STR=tr("v_auto","auto");
    i18nApply(CUR_LANG);
    qa("#ivPresets .pill").forEach(function(b){ var mn=parseInt(b.dataset.min,10); if(isFinite(mn)) b.textContent=fmtMins(mn); });
    var at=q('.tab[data-pg="pgAdv"]'); if(at&&ADV_SUB[CUR_LANG]) at.dataset.sub=ADV_SUB[CUR_LANG];
    if(__lastS){ try{ paint(__lastS); }catch(e){} }
    // if the Advanced tab is the active one, its hero subtitle is not model-driven
    if(at&&at.classList.contains("on")){ var hs=document.getElementById("heroState"); if(hs&&ADV_SUB[CUR_LANG]) hs.textContent=ADV_SUB[CUR_LANG]; }
    buildLangList();
  }
  if(langList) langList.addEventListener("click",function(e){ var it=e.target&&e.target.closest?e.target.closest("[data-lang]"):null; if(!it) return;
    var code=it.getAttribute("data-lang"); var lv=(code==="__sys")?"":code;
    try{ if(code==="__sys") localStorage.removeItem("as_lang"); else localStorage.setItem("as_lang",code); }catch(err){}
    applyLangLive(lv); });
  var langCloseBtn=document.getElementById("langClose"); if(langCloseBtn) langCloseBtn.addEventListener("click",function(){ closeM(langModal); });
  if(langModal) langModal.addEventListener("click",function(e){ if(e.target===langModal) closeM(langModal); });

  // ---- theme cycle ----
  var root=document.documentElement,order=["system","light","dark"],ti=0;
  try{ var sv=localStorage.getItem("theme"); if(sv==="light"||sv==="dark") ti=order.indexOf(sv); }catch(e){}
  var icon=document.getElementById("themeIcon");
  var SUN='<circle cx="12" cy="12" r="4.3"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>';
  var MOON='<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/>';
  function applyTheme(){ var m=order[ti]; if(m==="system") root.removeAttribute("data-theme"); else root.setAttribute("data-theme",m);
    var d=m==="dark"||(m==="system"&&matchMedia("(prefers-color-scheme:dark)").matches); if(icon) icon.innerHTML=d?SUN:MOON;
    try{ if(m==="system") localStorage.removeItem("theme"); else localStorage.setItem("theme",m); }catch(e){} }
  var themeBtn=document.getElementById("themeBtn"); if(themeBtn) themeBtn.addEventListener("click",function(){ ti=(ti+1)%order.length; applyTheme(); toast(tr("theme","Theme")+": "+tr("th_"+({system:"sys",light:"light",dark:"dark"}[order[ti]]),order[ti])); });
  var langBtn=document.getElementById("langBtn"); if(langBtn) langBtn.addEventListener("click",function(){ buildLangList(); openM(langModal); });
  applyTheme();

  // The checker keeps its decoded response in memory and offers Copy JSON.
  // Imported results are explicitly labelled, with their original timestamp.
  function paintVerdict(S){
    var ts=Number(S.v_timestamp||0), age=Date.now()/1000-ts;
    var fresh=ts>0 && age>=-60 && age<=86400;
    ["Basic","Device","Strong"].forEach(function(label){
      var el=document.getElementById("v"+label), flag=S["v_"+label.toLowerCase()];
      if(!el) return;
      el.className="verdict-pill"+(fresh?(flag==="1"?" pass":" fail"):"");
      el.querySelector("b").textContent=fresh?(flag==="1"?"✓":"×"):"?";
    });
    var info=document.getElementById("verdictInfo");
    if(info) info.textContent=ts?("Последний импорт из чекера: "+new Date(ts*1000).toLocaleString()+
      (fresh?". Это сохранённый результат.":". Результат устарел, запустите новую проверку.")):
      "Нет результата. Выполните проверку в Play Integrity Checker.";
    var statuses={"checker-reports-three":"Чекер сообщил 3/3. Замена не требуется.","local-copy-restored":"Рабочая локальная копия восстановлена. Повторите проверку.","no-complete-local-copy":"Полной резервной копии нет. Нужен новый keybox.","downloading":"Загружается и проверяется кандидат…", "cooling-down":"Пауза между попытками: 6 часов.","updated-check-again":"Файл обновлён. Повторите проверку в чекере.","unchanged-check-again":"Сервер вернул тот же файл. Повторите проверку позже.","download-failed-current-kept":"Загрузка не прошла проверку. Текущий файл сохранён."};
    var ri=document.getElementById("repairInfo"); if(ri) ri.textContent=statuses[S.repair_status]||"Полная копия keybox сохраняется перед заменой.";
    var sw=document.getElementById("autoRepairSw"); if(sw) sw.checked=(S.auto_repair||"1")==="1";
  }
  var arSw=document.getElementById("autoRepairSw");
  if(arSw) arSw.addEventListener("change",function(){ settingOn("auto_repair",arSw.checked); });
  var checkerButton=document.getElementById("launchChecker");
  if(checkerButton) checkerButton.addEventListener("click",function(){
    ksuExec("am start -n gr.nikolasspyr.integritycheck/.MainActivity").then(function(r){
      if(r.errno!==0) toast("Play Integrity Checker не найден",3500);
    });
  });
  var localButton=document.getElementById("repairLocal");
  if(localButton) localButton.addEventListener("click",function(){
    toast("Проверка файлов…",2000);
    ksuExec("sh "+shq(MOD+"/keybox_manage.sh")+" recover").then(function(){
      readAll().then(function(S){ paint(S); });
    });
  });
  // ---- Manual Action: short bridge calls, persistent output and reconnect ----
  var actionButton=document.getElementById("runAction"), actionModal=q("#actionModal");
  var actionOutput=q("#actionOutput"), actionStatus=q("#actionStatus"), actionSummary=q("#actionSummary");
  var actionTimer=null, actionPending=false, actionRunning=false;
  function actionRequest(command){ return ksuExec("sh "+shq(MOD+"/webui_action.sh")+" "+command+" 2>&1",10000); }
  function actionMessage(message){ actionStatus.textContent=message; actionSummary.textContent=message; }
  function pollAction(){
    clearTimeout(actionTimer);
    if(actionPending || document.hidden) return;
    actionPending=true; actionButton.disabled=true;
    actionRequest("status").then(function(r){
      actionPending=false;
      if(Number(r.errno)!==0){
        // The worker may still be running: never claim that a bridge error
        // cancelled it. A fresh status request is safe even after a lost reply.
        actionButton.disabled=false;
        actionMessage("Нет связи с root-мостом. Откройте лог повторно для проверки статуса.");
        return;
      }
      var output=r.stdout||"", split=output.indexOf("--log--\n");
      if(split<0){ actionButton.disabled=false; actionMessage("Не удалось прочитать статус Action."); return; }
      var header=output.slice(0,split), state=(header.match(/^state=(.*)$/m)||[])[1];
      var code=(header.match(/^code=(.*)$/m)||[])[1], wasRunning=actionRunning;
      actionRunning=state==="running";
      var nearBottom=actionOutput.scrollHeight-actionOutput.scrollTop-actionOutput.clientHeight<48;
      // Shell output is untrusted text, never HTML.
      actionOutput.textContent=output.slice(split+8)||"Лог пока пуст.";
      if(nearBottom) actionOutput.scrollTop=actionOutput.scrollHeight;
      var message=actionRunning?"Action выполняется… Можно закрыть это окно.":
        state==="idle"?"Ещё не запускался из WebUI.":
        state==="interrupted"?"Запуск прерван. Смотрите сохранённый лог.":
        code==="0"?"Action завершён. Повторите проверку в чекере.":
        code==="2"?"Action завершён с предупреждениями. Смотрите лог.":
        code==="75"?"Другой Action уже работает. Повторите запуск после его завершения.":
        code==="124"?"Превышено время выполнения (8 минут). Смотрите лог.":
        "Action завершился с ошибкой (код "+code+"). Смотрите лог.";
      actionMessage(message);
      actionButton.disabled=actionRunning;
      actionButton.textContent=actionRunning?"Action выполняется…":"▶ Action";
      if(actionRunning) actionTimer=setTimeout(pollAction,1000);
      else if(wasRunning) readAll().then(function(S){ paint(S); });
    });
  }
  if(actionButton && actionModal){
    actionButton.disabled=true;
    actionButton.addEventListener("click",function(){
      if(actionPending || actionRunning) return;
      clearTimeout(actionTimer); actionPending=true; actionButton.disabled=true;
      openM(actionModal); actionMessage("Запуск Action…");
      actionRequest("start").then(function(r){
        actionPending=false;
        if(Number(r.errno)!==0){
          actionButton.disabled=false;
          actionMessage("Запуск не подтверждён. Обновите лог, чтобы проверить статус.");
          return;
        }
        pollAction();
      });
    });
    q("#viewActionLog").addEventListener("click",function(){ openM(actionModal); pollAction(); });
    q("#actionRefresh").addEventListener("click",pollAction);
    q("#actionClose").addEventListener("click",function(){ closeM(actionModal); });
    actionModal.addEventListener("click",function(e){ if(e.target===actionModal) closeM(actionModal); });
    document.addEventListener("visibilitychange",function(){
      if(document.hidden) clearTimeout(actionTimer); else pollAction();
    });
    window.addEventListener("pagehide",function(){ clearTimeout(actionTimer); });
    window.addEventListener("pageshow",pollAction);
    pollAction();
  }
  var importButton=document.getElementById("importVerdict");
  if(importButton) importButton.addEventListener("click",function(){
    var box=document.getElementById("verdictJson"), text=box.value.trim();
    try{ if(text.length>65536) throw new Error(); JSON.parse(text); }
    catch(e){ toast("Вставьте JSON из меню чекера",3000); return; }
    importButton.disabled=true;
    var path=AS+"/tmp/ui-verdict.json";
    var cmd="umask 077; mkdir -p "+shq(AS+"/tmp")+"; printf %s "+shq(text)+" > "+shq(path)+
      "; sh "+shq(MOD+"/verdict_report.sh")+" "+shq(path)+"; rc=$?; rm -f "+shq(path)+"; exit $rc";
    ksuExec(cmd).then(function(r){ importButton.disabled=false;
      if(r.errno!==0){ toast("Нужен полный JSON проверки за последние 15 минут",4000); return; }
      box.value=""; toast((r.stdout||"").indexOf("Older checker result ignored")>=0?"В модуле уже есть более новый результат":"Результат сохранён",2500);
      [3000,15000,45000].forEach(function(ms){ setTimeout(function(){ readAll().then(function(S){ paint(S); }); },ms); });
      readAll().then(function(S){ paint(S); });
    });
  });
  document.addEventListener("visibilitychange",function(){ if(!document.hidden){ readAll().then(function(S){ paint(S); }); } });

  // ---- status refresh helper ----
  function refreshStatus(){ ksuExec("sh "+shq(MOD+"/keybox_manage.sh")+" health").then(function(r){ renderChecks((r.stdout||"").trim()); }); }

  // ---- go ----
  readAll().then(function(S){ __lastS=S;
    // spoof dialect follows the engine; the Lite line resolves it from the PIF below
    SPOOF_DIALECT=(S.eng==="inject")?"inject":"fork";
    if(S.eng==="none"){ var g=document.getElementById("spoofGrp"); if(g) g.hidden=true; }
    else adaptSpoofFlags(SPOOF_DIALECT);
    try{ paint(S); }catch(e){}
    if(S.fm_path) fmSaved=S.fm_path;
    if(S.eng==="none"){
      // Lite: show the spoof flags of whichever PIF the user installed, synced live
      ksuExec("sh "+shq(MOD+"/lite_pif_sync.sh")+" --detect").then(function(r){
        var k=(r.stdout||"").trim(); SPOOF_DIALECT=(k==="inject"||k==="fork")?k:"";
        adaptSpoofFlags(SPOOF_DIALECT);
        if(SPOOF_DIALECT) fetchExtSpoof().then(function(lines){ __lastS.spoof=lines; paintSpoof(lines); });
      });
    }
  });
  fetchMetaName().then(function(n){ if(n){ metaKeyName=n; applyMetaName(); } });
})();

// Local banner playback follows page visibility and the user's motion preference.
(function(){
  var video=document.getElementById("forkBanner");
  if(!video) return;
  var motion=window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  var visible=true, failed=false;
  video.muted=true;
  function syncBanner(){
    if(failed || document.hidden || !visible || (motion && motion.matches)){
      video.pause(); return;
    }
    var playing=video.play();
    if(playing && playing.catch) playing.catch(function(){ /* Keep the poster. */ });
  }
  video.addEventListener("error",function(){
    failed=true; video.pause(); video.style.display="none";
    var poster=document.querySelector(".hero-banner .banner-still");
    if(poster) poster.style.display="block";
  });
  document.addEventListener("visibilitychange",syncBanner);
  window.addEventListener("pagehide",function(){ video.pause(); });
  window.addEventListener("pageshow",syncBanner);
  if(motion){
    if(motion.addEventListener) motion.addEventListener("change",syncBanner);
    else if(motion.addListener) motion.addListener(syncBanner);
  }
  if(window.IntersectionObserver){
    new IntersectionObserver(function(entries){
      visible=entries.some(function(entry){ return entry.isIntersecting; });
      syncBanner();
    },{threshold:0.01}).observe(video.parentElement);
  }
  syncBanner();
})();

// Presentation only: modal focus, scroll locking, menus that fit the visual viewport.
(function(){
  var modals=Array.prototype.slice.call(document.querySelectorAll(".modal"));
  var menus=[];
  [["appsMenu","kebab"],["fmSortMenu","fmSortBtn"],["fmFilterMenu","fmFilterBtn"]].forEach(function(pair){
    var menu=document.getElementById(pair[0]), anchor=document.getElementById(pair[1]);
    if(!menu || !anchor) return;
    var owner=menu.closest(".modal");
    if(!owner) return;
    owner.appendChild(menu); // Outside the animated/clipped dialog, inside its overlay.
    var dialog=owner.querySelector(".dialog");
    if(dialog) dialog.setAttribute("aria-owns",((dialog.getAttribute("aria-owns")||"")+" "+menu.id).trim());
    var entry={menu:menu,anchor:anchor,owner:owner}; menus.push(entry);
    new MutationObserver(function(){ if(!menu.hidden) placeMenu(entry); }).observe(menu,{attributes:true,attributeFilter:["hidden"]});
  });
  function placeMenu(entry){
    var menu=entry.menu, r=entry.anchor.getBoundingClientRect();
    var width=Math.min(250,window.innerWidth-32);
    var viewHeight=window.visualViewport?Math.min(window.innerHeight,window.visualViewport.height):window.innerHeight;
    var below=Math.max(0,viewHeight-r.bottom-20), above=Math.max(0,r.top-20);
    var downward=below>=Math.min(menu.scrollHeight,280) || below>=above;
    var available=Math.max(40,Math.min(360,downward?below:above));
    menu.style.width=width+"px"; menu.style.maxHeight=available+"px";
    var height=Math.min(menu.scrollHeight,available);
    menu.style.left=Math.max(16,Math.min(window.innerWidth-width-16,r.right-width))+"px";
    menu.style.top=Math.max(8,downward?r.bottom+8:r.top-height-8)+"px";
  }
  var active=null, returnFocus=null;
  function topModal(){
    return modals.filter(function(m){return !m.hidden&&m.classList.contains("show");}).sort(function(a,b){
      return (Number(getComputedStyle(a).zIndex)||0)-(Number(getComputedStyle(b).zIndex)||0) || modals.indexOf(a)-modals.indexOf(b);
    }).pop();
  }
  function syncModals(){
    var top=topModal();
    document.documentElement.classList.toggle("modal-open",!!top);
    modals.forEach(function(m){
      var shown=!m.hidden&&m.classList.contains("show");
      m.setAttribute("aria-hidden",shown&&m===top?"false":"true");
      if(!shown) menus.forEach(function(entry){if(entry.owner===m) entry.menu.hidden=true;});
    });
    if(top!==active){
      if(top){
        if(!active) returnFocus=document.activeElement;
        var dialog=top.querySelector(".dialog");
        if(dialog) dialog.focus({preventScroll:true});
      } else if(returnFocus && returnFocus.isConnected){ returnFocus.focus({preventScroll:true}); returnFocus=null; }
      active=top;
    }
  }
  modals.forEach(function(m){
    var dialog=m.querySelector(".dialog"), title=m.querySelector(".dt");
    if(dialog){dialog.setAttribute("role","dialog");dialog.setAttribute("aria-modal","true");dialog.tabIndex=-1;}
    if(dialog&&title){if(!title.id) title.id=m.id+"Title";dialog.setAttribute("aria-labelledby",title.id);}
    new MutationObserver(syncModals).observe(m,{attributes:true,attributeFilter:["hidden","class"]});
  });
  document.addEventListener("keydown",function(e){
    var top=topModal(); if(!top) return;
    if(e.key==="Escape"){
      var openMenu=menus.filter(function(x){return x.owner===top&&!x.menu.hidden;}).pop();
      if(openMenu){openMenu.menu.hidden=true; e.preventDefault();return;}
      var close=top.querySelector('button[aria-label="Close"]');
      if(close){close.click();e.preventDefault();} return;
    }
    if(e.key!=="Tab") return;
    var controls=Array.prototype.slice.call(top.querySelectorAll('button,a[href],input,textarea,summary,[tabindex="0"]')).filter(function(el){return !el.disabled&&el.getClientRects().length>0;});
    if(!controls.length){e.preventDefault();return;}
    var index=controls.indexOf(document.activeElement), next=index+(e.shiftKey?-1:1);
    if(index<0 || next<0 || next>=controls.length){e.preventDefault();controls[e.shiftKey?controls.length-1:0].focus();}
  });
  var pending=false;
  function resized(){
    if(pending) return; pending=true;
    requestAnimationFrame(function(){
      pending=false;
      menus.forEach(function(entry){if(!entry.menu.hidden) placeMenu(entry);});
      var beta=document.getElementById("betaAcc"), head=document.getElementById("betaHead");
      if(beta&&head&&head.classList.contains("open")) beta.style.maxHeight=beta.scrollHeight+"px";
    });
  }
  window.addEventListener("resize",resized,{passive:true});
  if(window.visualViewport) window.visualViewport.addEventListener("resize",resized,{passive:true});
  document.querySelectorAll(".tab").forEach(function(t){
    t.setAttribute("aria-pressed",t.classList.contains("on")?"true":"false");
    t.addEventListener("click",function(){document.querySelectorAll(".tab").forEach(function(x){x.setAttribute("aria-pressed",x.classList.contains("on")?"true":"false");});});
  });
  syncModals();
})();
