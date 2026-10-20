(function(){
  "use strict";
  var path="/data/adb/modules/alwaysstrong_isolation/targets.sh";
  var field=document.getElementById("targets"),status=document.getElementById("status"),button=document.getElementById("save");
  function quote(s){return "'"+String(s).replace(/'/g,"'\\''")+"'";}
  function run(cmd){return new Promise(function(resolve,reject){
    if(!window.ksu||!ksu.exec){reject(new Error("Open this page in a compatible root WebUI host."));return;}
    var cb="__isolation"+Date.now()+Math.floor(Math.random()*10000),timer;
    timer=setTimeout(function(){delete window[cb];reject(new Error("Root host timed out."));},10000);
    window[cb]=function(errno,out,err){clearTimeout(timer);delete window[cb];if(Number(errno)!==0)reject(new Error(err||"Invalid package list or write failed."));else resolve(out||"");};
    try{ksu.exec(cmd,"{}",cb);}catch(e){clearTimeout(timer);delete window[cb];reject(e);}
  });}
  run("sh "+quote(path)+" get").then(function(out){field.value=out;button.disabled=false;status.textContent="Selection loaded.";}).catch(function(e){status.textContent=e.message;});
  button.onclick=function(){button.disabled=true;run("sh "+quote(path)+" set "+quote(field.value)).then(function(){status.textContent="Saved. Restart the selected apps. Existing mappings require a new process.";}).catch(function(e){status.textContent=e.message;}).then(function(){button.disabled=false;});};
})();
