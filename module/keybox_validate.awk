# Restricted Android keybox XML + PEM parser. Emits only type/base64 records
# into a private scratch file; never send its stdout to a user-facing log.
function fail() { bad=1; exit 1 }
function trim(s) { sub(/^[[:space:]]+/,"",s); sub(/[[:space:]]+$/,"",s); return s }
function number(s) { s=trim(s); if(s !~ /^[0-9]+$/ || s+0<1 || s+0>32) fail(); return s+0 }
function pem(s,kind, b,e,p,z,body,last) {
  s=trim(s)
  if(kind=="C") b="-----BEGIN CERTIFICATE-----"
  else if(index(s,"-----BEGIN EC PRIVATE KEY-----")==1) b="-----BEGIN EC PRIVATE KEY-----"
  else if(index(s,"-----BEGIN RSA PRIVATE KEY-----")==1) b="-----BEGIN RSA PRIVATE KEY-----"
  else b="-----BEGIN PRIVATE KEY-----"
  e=b; sub(/BEGIN/,"END",e)
  if(index(s,b)!=1) fail()
  p=index(s,e); if(!p || trim(substr(s,p+length(e)))!="") fail()
  body=substr(s,length(b)+1,p-length(b)-1); gsub(/[[:space:]]/,"",body)
  if(length(body)<16 || length(body)%4 || body ~ /[^A-Za-z0-9+\/=]/) fail()
  z=body; sub(/==?$/,"",z); if(index(z,"=")) fail()
  if(emit) print kind ":" body
}
{ xml=xml $0 "\n"; if(length(xml)>524288) fail() }
END {
  if(bad) exit 1
  rest=xml; depth=0; roots=0; boxes=0; rootn=0
  while(length(rest)) {
    p=index(rest,"<")
    if(!p) { if(trim(rest)!="") fail(); break }
    text=substr(rest,1,p-1); rest=substr(rest,p)
    if(depth) content[depth]=content[depth] text
    else if(trim(text)!="") fail()
    if(substr(rest,1,4)=="<!--") {
      q=index(rest,"-->"); if(!q) fail(); rest=substr(rest,q+3); continue
    }
    if(substr(rest,1,5)=="<?xml") {
      q=index(rest,"?>"); if(!q || depth || roots) fail(); rest=substr(rest,q+2); continue
    }
    if(substr(rest,1,2)=="<!" || substr(rest,1,2)=="<?") fail()
    q=index(rest,">"); if(!q) fail()
    token=trim(substr(rest,2,q-2)); rest=substr(rest,q+1)
    if(index(token,"<") || substr(token,length(token),1)=="/") fail()
    closing=(substr(token,1,1)=="/")
    if(closing) {
      tag=substr(token,2)
      if(!depth || tag!=stack[depth] || tag ~ /[[:space:]]/) fail()
      text=content[depth]
      if(tag=="NumberOfKeyboxes") { if(rootn) fail(); rootn=number(text) }
      else if(tag=="NumberOfCertificates") { if(chainn) fail(); chainn=number(text) }
      else if(tag=="PrivateKey") { pem(text,"K"); keypem++ }
      else if(tag=="Certificate") { pem(text,"C"); certs++ }
      else {
        if(trim(text)!="") fail()
        if(tag=="CertificateChain" && (chainn!=certs || certs<1)) fail()
        if(tag=="Key" && (keypem!=1 || chains!=1)) fail()
        if(tag=="Keybox" && keys<1) fail()
        if(tag=="AndroidAttestation" && (rootn!=boxes || !boxes)) fail()
      }
      delete content[depth]; delete stack[depth]; depth--
      continue
    }
    tag=token; sub(/[[:space:]].*/,"",tag)
    attrs=trim(substr(token,length(tag)+1))
    if(tag !~ /^(AndroidAttestation|NumberOfKeyboxes|Keybox|Key|PrivateKey|CertificateChain|NumberOfCertificates|Certificate)$/) fail()
    # TEESimulator derives EC/RSA from the parsed key itself. Public mirrors
    # also use branded algorithm metadata, so it is not a type discriminator.
    if(tag=="Key") { if(attrs !~ /^algorithm="[^"<>&]+"$/) fail() }
    else if(tag=="PrivateKey" || tag=="Certificate") { if(attrs!="format=\"pem\"") fail() }
    else if(tag=="Keybox") { if(attrs!="" && attrs !~ /^DeviceID="[^"<>]*"$/) fail() }
    else if(attrs!="") fail()
    parent=depth?stack[depth]:""
    if(tag=="AndroidAttestation") { if(depth || roots++) fail() }
    else if(tag=="NumberOfKeyboxes") { if(parent!="AndroidAttestation" || boxes) fail() }
    else if(tag=="Keybox") { if(parent!="AndroidAttestation" || !rootn) fail(); boxes++; keys=0 }
    else if(tag=="Key") { if(parent!="Keybox") fail(); keys++; keypem=0; chains=0 }
    else if(tag=="PrivateKey") { if(parent!="Key" || keypem || chains) fail() }
    else if(tag=="CertificateChain") { if(parent!="Key" || !keypem || chains++) fail(); chainn=0; certs=0 }
    else if(tag=="NumberOfCertificates") { if(parent!="CertificateChain" || certs) fail() }
    else if(tag=="Certificate") { if(parent!="CertificateChain" || !chainn) fail() }
    if(depth && trim(content[depth])!="") fail()
    stack[++depth]=tag; content[depth]=""
    if(depth>8) fail()
  }
  if(depth || roots!=1 || rootn!=boxes || !boxes) fail()
}
