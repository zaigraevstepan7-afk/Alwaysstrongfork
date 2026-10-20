// asfetch — AlwaysStrong native HTTPS fetcher.
//
// Why this exists: the module runs on devices that ship no `curl` and only
// busybox `wget`, whose built-in TLS stalls mid-stream on some CDNs. A
// statically-linked rustls client speaks TLS 1.2/1.3 correctly there.
//
// Why it's hand-rolled instead of using an HTTP crate: connectivity on real
// phones is lopsided in both directions — an IPv4-only data link that still
// advertises AAAA, and an IPv6-only / NAT64 link where the IPv4 addresses are the
// dead ones. We resolve every address ourselves and race IPv4 + IPv6 concurrently
// (Happy-Eyeballs), with IPv4 preferred: an IPv6 socket that wins the race is only
// used if no IPv4 address connects within a short grace window, because on some
// carriers the IPv6 handshake completes (a middlebox answers the SYN) but no data
// ever flows. If the request then dies on the chosen socket, it is retried once
// over the other address family, retaining TLS. A process-wide deadline ends the run
// no matter what, so a shell caller can never wait on this forever.
//
// Usage:  asfetch URL [-o|-O FILE] [-A USER_AGENT] [-H "Key: Value"]... [-T SECONDS]
//   no -o  -> body is written to stdout
//   -H may be repeated to send extra request headers (e.g. a Referer).
//   exit 0 on HTTP 2xx, non-zero otherwise (so callers can `|| fallback`).

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::process::exit;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

mod autopif;

// Put the whole child tree in its own process group. A boot-stage deadline
// must also stop a shell's foreground helper, not leave it writing after timeout.
#[cfg(unix)]
fn run_bounded(args: &[String]) -> i32 {
    use std::os::unix::process::{CommandExt, ExitStatusExt};
    unsafe extern "C" {
        fn setpgid(pid: i32, pgid: i32) -> i32;
        fn kill(pid: i32, signal: i32) -> i32;
    }
    if args.len() < 2 { eprintln!("run-bounded: SECONDS COMMAND [ARG...]"); return 2; }
    let seconds = match args[0].parse::<u64>() {
        Ok(v) if (1..=600).contains(&v) => v,
        _ => { eprintln!("run-bounded: invalid deadline"); return 2; }
    };
    let mut command = std::process::Command::new(&args[1]);
    command.args(&args[2..]);
    unsafe {
        command.pre_exec(|| {
            if setpgid(0, 0) != 0 { return Err(std::io::Error::last_os_error()); }
            Ok(())
        });
    }
    let mut child = match command.spawn() {
        Ok(c) => c,
        Err(e) => { eprintln!("run-bounded: command: {e}"); return 1; }
    };
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return status.code().unwrap_or_else(|| 128 + status.signal().unwrap_or(1)),
            Ok(None) => {},
            Err(e) => { eprintln!("run-bounded: wait: {e}"); unsafe { kill(-(child.id() as i32), 9); }
                let _ = child.try_wait(); return 1; }
        }
        if started.elapsed() >= Duration::from_secs(seconds) {
            unsafe { kill(-(child.id() as i32), 9); }
            // SIGKILL cannot interrupt uninterruptible kernel I/O. Never
            // wait() here: post-fs-data must return even if that child stays D.
            // The exiting helper leaves eventual reaping to the init process.
            let _ = child.try_wait();
            eprintln!("run-bounded: {seconds}s deadline exceeded");
            return 124;
        }
        std::thread::sleep(Duration::from_millis(25));
    }
}

// Keep one kernel-owned lock for the lifetime of the writer, including when its
// wrapper is killed. Lock files are never unlinked: removing a locked inode
// would allow a second writer to acquire a different inode at the same path.
#[cfg(unix)]
fn lock_run(args: &[String]) -> i32 {
    use std::os::fd::AsRawFd;
    use std::os::unix::fs::OpenOptionsExt;
    use std::os::unix::process::ExitStatusExt;
    unsafe extern "C" {
        fn flock(fd: i32, operation: i32) -> i32;
        fn fcntl(fd: i32, command: i32, ...) -> i32;
    }
    if args.len() < 3 { eprintln!("lock-run: LOCK WAIT_MS COMMAND [ARG...]"); return 2; }
    let wait = match args[1].parse::<u64>() {
        Ok(v) if v <= 30000 => Duration::from_millis(v),
        _ => { eprintln!("lock-run: invalid wait"); return 2; }
    };
    let file = match std::fs::OpenOptions::new().read(true).write(true).create(true)
        .mode(0o600).open(&args[0]) {
        Ok(f) => f,
        Err(e) => { eprintln!("lock-run: open: {e}"); return 1; }
    };
    let fd = file.as_raw_fd();
    let started = Instant::now();
    loop {
        // LOCK_EX | LOCK_NB have the same values on Android/Linux and Darwin.
        if unsafe { flock(fd, 2 | 4) } == 0 { break; }
        let err = std::io::Error::last_os_error();
        if err.kind() == std::io::ErrorKind::Interrupted { continue; }
        if err.kind() != std::io::ErrorKind::WouldBlock {
            eprintln!("lock-run: flock: {err}"); return 1;
        }
        if started.elapsed() >= wait { return 75; }
        std::thread::sleep(std::cmp::min(Duration::from_millis(25), wait.saturating_sub(started.elapsed())));
    }
    // F_GETFD=1, F_SETFD=2, FD_CLOEXEC=1. The child must keep the lock even if
    // this supervising process is interrupted while the child is still writing.
    let flags = unsafe { fcntl(fd, 1) };
    if flags < 0 || unsafe { fcntl(fd, 2, flags & !1) } < 0 {
        eprintln!("lock-run: inherit fd: {}", std::io::Error::last_os_error()); return 1;
    }
    match std::process::Command::new(&args[2]).args(&args[3..]).status() {
        Ok(status) => status.code().unwrap_or_else(|| 128 + status.signal().unwrap_or(1)),
        Err(e) => { eprintln!("lock-run: command: {e}"); 1 }
    }
}

struct Url {
    https: bool,
    host: String,
    port: u16,
    path: String,
}

fn parse_url(u: &str) -> Option<Url> {
    let (scheme, rest) = match u.split_once("://") {
        Some((s, r)) => (s.to_ascii_lowercase(), r),
        None => ("http".to_string(), u),
    };
    if scheme != "http" && scheme != "https" { return None; }
    let https = scheme == "https";
    let (authority, path) = match rest.find('/') {
        Some(i) => (&rest[..i], &rest[i..]),
        None => (rest, "/"),
    };
    // strip any userinfo@ (not used by our endpoints, but be safe)
    let authority = authority.rsplit('@').next().unwrap_or(authority);
    let (host, port) = match authority.rsplit_once(':') {
        // guard against IPv6 literals like [::1] — our URLs never use them
        Some((h, p)) if !h.contains(':') && p.chars().all(|c| c.is_ascii_digit()) && !p.is_empty() => {
            (h.to_string(), p.parse().unwrap_or(if https { 443 } else { 80 }))
        }
        _ => (authority.to_string(), if https { 443 } else { 80 }),
    };
    if host.is_empty() {
        return None;
    }
    Some(Url { https, host, port, path: path.to_string() })
}

// Resolve host:port to every address, IPv4 and IPv6 interleaved so both families
// are represented up front. We used to return IPv4-only-first and connect
// sequentially; that fixed the "IPv4-only link that still advertises AAAA" hang
// but broke the mirror image of it — an IPv6-only / NAT64 mobile data connection,
// where the IPv4 addresses are the dead ones and burning their timeouts first
// could sink the whole fetch. Interleaving + the concurrent connect below make
// both directions work.
fn resolve_all(host: &str, port: u16) -> Vec<SocketAddr> {
    let mut v4 = Vec::new();
    let mut v6 = Vec::new();
    if let Ok(iter) = (host, port).to_socket_addrs() {
        for a in iter {
            if a.is_ipv4() {
                v4.push(a);
            } else {
                v6.push(a);
            }
        }
    }
    let mut out = Vec::with_capacity(v4.len() + v6.len());
    let (mut i, mut j) = (0usize, 0usize);
    while i < v4.len() || j < v6.len() {
        if i < v4.len() {
            out.push(v4[i]);
            i += 1;
        }
        if j < v6.len() {
            out.push(v6[j]);
            j += 1;
        }
    }
    out
}

// How long an IPv6 winner waits for an IPv4 address to connect before it is
// accepted. A live IPv4 path answers a SYN in well under this; a dead one (SYN
// silently dropped) costs exactly this much extra before IPv6 is used.
const IPV4_GRACE: Duration = Duration::from_millis(1000);

// Connect to whichever address answers first, racing IPv4 and IPv6 concurrently
// (Happy-Eyeballs style): every candidate dials in its own thread, so a dead
// address family never blocks the request behind a full per-address timeout.
// IPv4 is preferred — see the header comment — so an IPv6 socket only wins
// after IPV4_GRACE passes with no IPv4 success (or when there is no IPv4 at all).
fn connect(addrs: &[SocketAddr], per_timeout: Duration) -> std::io::Result<TcpStream> {
    use std::sync::mpsc::{channel, RecvTimeoutError};
    if addrs.is_empty() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::Other,
            "no addresses resolved",
        ));
    }
    let has_v4 = addrs.iter().any(|a| a.is_ipv4());
    let mut v4_pending = addrs.iter().filter(|a| a.is_ipv4()).count();
    let (tx, rx) = channel::<(SocketAddr, std::io::Result<TcpStream>)>();
    for a in addrs.iter().cloned() {
        let tx = tx.clone();
        std::thread::spawn(move || {
            let _ = tx.send((a, TcpStream::connect_timeout(&a, per_timeout)));
        });
    }
    drop(tx); // so rx closes once every dialer thread has reported
    let mut last = std::io::Error::new(std::io::ErrorKind::Other, "connect failed");
    let mut v6_winner: Option<TcpStream> = None;
    let mut grace_until: Option<Instant> = None;
    loop {
        let msg = match grace_until {
            Some(t) => match rx.recv_timeout(t.saturating_duration_since(Instant::now())) {
                Ok(m) => m,
                Err(RecvTimeoutError::Timeout) => break, // grace over: use the IPv6 socket
                Err(RecvTimeoutError::Disconnected) => break,
            },
            None => match rx.recv() {
                Ok(m) => m,
                Err(_) => break,
            },
        };
        let (a, r) = msg;
        if a.is_ipv4() {
            v4_pending = v4_pending.saturating_sub(1);
        }
        match r {
            Ok(s) => {
                if a.is_ipv4() || !has_v4 {
                    return Ok(s);
                }
                if v6_winner.is_none() {
                    v6_winner = Some(s);
                    grace_until = Some(Instant::now() + IPV4_GRACE);
                }
            }
            Err(e) => last = e,
        }
        // Every IPv4 candidate has answered (all failed) and IPv6 is up: no
        // point sitting out the rest of the grace window — IPv6-only networks
        // should not pay a second per request.
        if v6_winner.is_some() && v4_pending == 0 {
            break;
        }
    }
    match v6_winner {
        Some(s) => Ok(s),
        None => Err(last),
    }
}

// A timeout is a failed download, never a successful partial response.
const MAX_RESPONSE: usize = 32 * 1024 * 1024;
fn read_all<R: Read>(mut r: R) -> std::io::Result<(Vec<u8>, bool)> {
    let mut out = Vec::new();
    let mut buf = [0u8; 16384];
    loop {
        match r.read(&mut buf) {
            Ok(0) => return Ok((out, true)),
            Ok(n) => {
                if out.len() + n > MAX_RESPONSE {
                    return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "response too large"));
                }
                progress();
                out.extend_from_slice(&buf[..n]);
            }
            // Some TLS servers omit close_notify. Accept only a completely
            // framed HTTP response, checked below, in that case.
            Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok((out, false)),
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(e) => return Err(e),
        }
    }
}

fn tls_config() -> Arc<rustls::ClientConfig> {
    let mut roots = rustls::RootCertStore::empty();
    roots.add_trust_anchors(webpki_roots::TLS_SERVER_ROOTS.iter().map(|ta| {
        rustls::OwnedTrustAnchor::from_subject_spki_name_constraints(
            ta.subject,
            ta.spki,
            ta.name_constraints,
        )
    }));
    Arc::new(
        rustls::ClientConfig::builder()
            .with_safe_defaults()
            .with_root_certificates(roots)
            .with_no_client_auth(),
    )
}

fn build_request(url: &Url, ua: &str, headers: &[(String, String)]) -> Vec<u8> {
    let host_hdr = if (url.https && url.port == 443) || (!url.https && url.port == 80) {
        url.host.clone()
    } else {
        format!("{}:{}", url.host, url.port)
    };
    let mut req = format!(
        "GET {} HTTP/1.1\r\nHost: {}\r\nUser-Agent: {}\r\nAccept: */*\r\nAccept-Encoding: identity\r\nConnection: close\r\n",
        url.path, host_hdr, ua
    );
    for (k, v) in headers {
        req.push_str(&format!("{k}: {v}\r\n"));
    }
    req.push_str("\r\n");
    req.into_bytes()
}

// Split raw response into (status_code, lowercased-header-block, body).
fn split_response(raw: &[u8]) -> Option<(u16, String, Vec<u8>)> {
    let sep = raw.windows(4).position(|w| w == b"\r\n\r\n")?;
    let head = String::from_utf8_lossy(&raw[..sep]);
    let body = raw[sep + 4..].to_vec();
    let mut lines = head.split("\r\n");
    let status_line = lines.next()?;
    let code: u16 = status_line.split_whitespace().nth(1)?.parse().ok()?;
    let headers = head.to_string();
    Some((code, headers, body))
}

fn header_value(headers_lower: &str, name: &str) -> Option<String> {
    for line in headers_lower.split("\r\n") {
        if let Some((k, v)) = line.split_once(':') {
            if k.trim().eq_ignore_ascii_case(name) {
                return Some(v.trim().to_string());
            }
        }
    }
    None
}

fn dechunk(body: &[u8]) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    let mut i = 0;
    loop {
        let end = body[i..].windows(2).position(|w| w == b"\r\n")
            .map(|p| i + p).ok_or("missing chunk header")?;
        let line = std::str::from_utf8(&body[i..end]).map_err(|_| "invalid chunk header")?;
        let size_hex = line.split(';').next().unwrap_or("");
        if size_hex.is_empty() || !size_hex.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err("invalid chunk size".into());
        }
        let size = usize::from_str_radix(size_hex, 16).map_err(|_| "chunk size overflow")?;
        i = end + 2;
        if size == 0 {
            // Consume optional trailers and the final empty line.
            loop {
                let end = body[i..].windows(2).position(|w| w == b"\r\n")
                    .map(|p| i + p).ok_or("missing chunk terminator")?;
                if end == i {
                    return if end + 2 == body.len() { Ok(out) } else { Err("bytes after chunk terminator".into()) };
                }
                if !body[i..end].contains(&b':') { return Err("invalid trailer".into()); }
                i = end + 2;
            }
        }
        let end = i.checked_add(size).ok_or("chunk size overflow")?;
        if end.checked_add(2).filter(|e| *e <= body.len()).is_none() || &body[end..end+2] != b"\r\n" {
            return Err("truncated chunk".into());
        }
        out.extend_from_slice(&body[i..end]);
        i = end + 2;
    }
}

fn complete_body(headers: &str, body: Vec<u8>, clean_eof: bool) -> Result<Vec<u8>, String> {
    let lengths: Vec<&str> = headers.split("\r\n").filter_map(|l| l.split_once(':'))
        .filter(|(k,_)| k.trim().eq_ignore_ascii_case("content-length")).map(|(_,v)| v.trim()).collect();
    let encodings: Vec<&str> = headers.split("\r\n").filter_map(|l| l.split_once(':'))
        .filter(|(k,_)| k.trim().eq_ignore_ascii_case("transfer-encoding")).map(|(_,v)| v.trim()).collect();
    if !encodings.is_empty() {
        if (encodings.len() != 1 || !encodings[0].eq_ignore_ascii_case("chunked")) || !lengths.is_empty() { return Err("ambiguous HTTP framing".into()); }
        return dechunk(&body);
    }
    if !lengths.is_empty() {
        if lengths.len() != 1 || lengths[0].is_empty() || !lengths[0].bytes().all(|b| b.is_ascii_digit()) {
            return Err("invalid Content-Length".into());
        }
        let length: usize = lengths[0].parse().map_err(|_| "invalid Content-Length")?;
        if length != body.len() { return Err("incomplete Content-Length body".into()); }
    } else if !clean_eof { return Err("unclean close without response length".into()); }
    Ok(body)
}

// Resolve a redirect Location against the current URL.
fn redirect_target(cur: &Url, loc: &str) -> Option<String> {
    if cur.https && loc.starts_with("http://") {
        None
    } else if loc.starts_with("http://") || loc.starts_with("https://") {
        Some(loc.to_string())
    } else if let Some(rest) = loc.strip_prefix('/') {
        let scheme = if cur.https { "https" } else { "http" };
        Some(format!("{scheme}://{}:{}/{rest}", cur.host, cur.port))
    } else {
        None
    }
}

// ---- No-progress watchdog -------------------------------------------------
// A fetcher that never returns freezes every shell caller that waits on it — in
// the module that was an Action screen stuck without "done". But a plain
// wall-clock deadline would also kill a slow 2G link that is still delivering
// bytes. So the watchdog measures PROGRESS, not time: DNS finishing, a socket
// connecting, every chunk of body read and every redirect hop all mark
// progress, and only `stall` seconds with none of that ends the process. A very
// large absolute cap (`hard`) remains so a byte-a-minute trickle can't run
// forever either. Exit 124 (the `timeout` convention) so callers treat it as a
// failed fetch and fall through to their next engine.
static START: OnceLock<Instant> = OnceLock::new();
static LAST_PROGRESS_MS: AtomicU64 = AtomicU64::new(0);

fn now_ms() -> u64 {
    START.get_or_init(Instant::now).elapsed().as_millis() as u64
}

pub(crate) fn progress() {
    LAST_PROGRESS_MS.store(now_ms(), Ordering::Relaxed);
}

fn arm_watchdog(stall: u64, hard: u64) {
    progress();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(1));
        let now = now_ms();
        let idle = now.saturating_sub(LAST_PROGRESS_MS.load(Ordering::Relaxed)) / 1000;
        if idle >= stall {
            eprintln!("asfetch: no progress for {idle}s, giving up");
            exit(124);
        }
        if now / 1000 >= hard {
            eprintln!("asfetch: {hard}s hard cap exceeded, giving up");
            exit(124);
        }
    });
}

// Why one request failed, for the caller's retry decision.
enum Fail {
    // No address connected — nothing to retry within this URL.
    Connect(String),
    // A socket connected but the request died on it (TLS/write error, empty or
    // malformed reply). `used_v4` says which family it was, so the caller can
    // retry once over the other one.
    Transport { used_v4: bool, msg: String },
    // The server answered with a non-2xx status — a real answer, never retried.
    Http(String),
}

impl Fail {
    fn msg(self) -> String {
        match self {
            Fail::Connect(m) | Fail::Http(m) => m,
            Fail::Transport { msg, .. } => msg,
        }
    }
}

// One HTTP exchange over the given candidate addresses: connect, send, read to
// EOF. Ok carries (status, lowercased headers, body).
fn transact(
    url: &Url,
    addrs: &[SocketAddr],
    ua: &str,
    headers: &[(String, String)],
    timeout: Duration,
) -> Result<(u16, String, Vec<u8>), Fail> {
    let per_connect = std::cmp::min(timeout, Duration::from_secs(6));
    let tcp = connect(addrs, per_connect).map_err(|e| Fail::Connect(format!("{}: {e}", url.host)))?;
    progress(); // a socket is up
    let used_v4 = tcp.peer_addr().map(|a| a.is_ipv4()).unwrap_or(true);
    let transport = |msg: String| Fail::Transport { used_v4, msg };
    let _ = tcp.set_read_timeout(Some(timeout));
    let _ = tcp.set_write_timeout(Some(timeout));
    let req = build_request(url, ua, headers);

    let (raw, clean_eof) = if url.https {
        let sni = rustls::ServerName::try_from(url.host.as_str())
            .map_err(|_| Fail::Connect(format!("{}: bad TLS name", url.host)))?;
        let conn = rustls::ClientConnection::new(tls_config(), sni)
            .map_err(|e| Fail::Connect(format!("tls init: {e}")))?;
        let mut tls = rustls::StreamOwned::new(conn, tcp);
        tls.write_all(&req).map_err(|e| transport(format!("write: {e}")))?;
        let _ = tls.flush();
        read_all(&mut tls)
    } else {
        let mut s = tcp;
        s.write_all(&req).map_err(|e| transport(format!("write: {e}")))?;
        let _ = s.flush();
        read_all(&mut s)
    }.map_err(|e| transport(format!("read: {e}")))?;

    let (code, headers_lower, body) = split_response(&raw).ok_or_else(|| {
        transport(if raw.is_empty() {
            "no response (socket connected but no data arrived)".to_string()
        } else {
            "malformed HTTP response".to_string()
        })
    })?;
    let body = complete_body(&headers_lower, body, clean_eof).map_err(transport)?;
    Ok((code, headers_lower, body))
}

fn fetch(
    start_url: &str,
    ua: &str,
    headers: &[(String, String)],
    timeout: Duration,
) -> Result<Vec<u8>, String> {
    fetch_inner(start_url, ua, headers, timeout).map_err(Fail::msg)
}

fn fetch_inner(
    start_url: &str,
    ua: &str,
    headers: &[(String, String)],
    timeout: Duration,
) -> Result<Vec<u8>, Fail> {
    let mut current = start_url.to_string();
    for _ in 0..8 {
        let url = parse_url(&current).ok_or_else(|| Fail::Connect(format!("bad url: {current}")))?;
        let addrs = resolve_all(&url.host, url.port);
        progress(); // DNS answered (even if empty)
        if addrs.is_empty() {
            return Err(Fail::Connect(format!("{}: could not resolve", url.host)));
        }

        let (code, headers_lower, body) = match transact(&url, &addrs, ua, headers, timeout) {
            Ok(r) => r,
            Err(Fail::Transport { used_v4, msg }) => {
                // The socket that won the race connected but the request died on
                // it — the signature of a broken path in one address family (an
                // IPv6 SYN answered by a middlebox, no data behind it). Retry once
                // restricted to the other family, if the host has one.
                let other: Vec<SocketAddr> =
                    addrs.iter().cloned().filter(|a| a.is_ipv4() != used_v4).collect();
                if other.is_empty() {
                    return Err(Fail::Transport { used_v4, msg });
                }
                eprintln!(
                    "asfetch: {}: {msg} over {}; retrying over {}",
                    url.host,
                    if used_v4 { "IPv4" } else { "IPv6" },
                    if used_v4 { "IPv6" } else { "IPv4" }
                );
                transact(&url, &other, ua, headers, timeout)?
            }
            Err(e) => return Err(e),
        };

        if (300..400).contains(&code) {
            if let Some(loc) = header_value(&headers_lower, "location") {
                if let Some(next) = redirect_target(&url, &loc) {
                    current = next;
                    progress();
                    continue;
                }
            }
            return Err(Fail::Http(format!("HTTP {code} (unfollowable redirect)")));
        }
        if !(200..300).contains(&code) {
            return Err(Fail::Http(format!("HTTP {code}")));
        }

        return Ok(body);
    }
    Err(Fail::Http("too many redirects".to_string()))
}

// --diag URL : isolate DNS vs raw TCP connect (std only) for debugging a device.
fn diag(url: &str) {
    use std::time::Instant;
    let u = match parse_url(url) {
        Some(u) => u,
        None => {
            eprintln!("diag: bad url");
            return;
        }
    };
    eprintln!("diag: target {}:{}", u.host, u.port);
    let t = Instant::now();
    let addrs = resolve_all(&u.host, u.port);
    eprintln!("diag: resolve in {:?} -> {:?}", t.elapsed(), addrs);
    for a in addrs {
        let t2 = Instant::now();
        match TcpStream::connect_timeout(&a, Duration::from_secs(6)) {
            Ok(_) => eprintln!("diag: connect {a} OK in {:?}", t2.elapsed()),
            Err(e) => eprintln!("diag: connect {a} ERR in {:?}: {e}", t2.elapsed()),
        }
    }
}

// Parse an externally decoded Play Integrity result. This does not decrypt or
// authenticate a Google token; provenance belongs to the checker/backend.
fn verdict_fields(v: &serde_json::Value, now: u64) -> Result<String, String> {
    if v.get("error").is_some() { return Err("checker/backend returned an error".into()); }
    let p = v.get("tokenPayloadExternal").unwrap_or(v);
    if p.get("error").is_some() { return Err("checker/backend returned an error".into()); }
    let device = p.get("deviceIntegrity").and_then(|v| v.as_object())
        .ok_or("deviceIntegrity object missing")?;
    // Google omits deviceRecognitionVerdict when no device labels are met.
    // The containing deviceIntegrity object and a fresh request remain required.
    let labels: &[serde_json::Value] = match device.get("deviceRecognitionVerdict") {
        None => &[],
        Some(v) => v.as_array().map(|v| v.as_slice()).ok_or("invalid deviceRecognitionVerdict")?,
    };
    let ts = p.pointer("/requestDetails/timestampMillis").ok_or("timestampMillis missing")?;
    let millis = ts.as_u64().or_else(|| ts.as_str().and_then(|s| s.parse().ok()))
        .ok_or("invalid timestampMillis")?;
    let seconds = millis / 1000;
    if seconds > now + 60 || now.saturating_sub(seconds) > 900 {
        return Err("result must be from the last 15 minutes".into());
    }
    if labels.iter().any(|v| !v.is_string()) { return Err("invalid verdict label".into()); }
    let has = |label: &str| if labels.iter().any(|v| v.as_str() == Some(label)) { 1 } else { 0 };
    Ok(format!("timestamp={}\nbasic={}\ndevice={}\nstrong={}\n",
        seconds, has("MEETS_BASIC_INTEGRITY"), has("MEETS_DEVICE_INTEGRITY"), has("MEETS_STRONG_INTEGRITY")))
}

fn read_verdict(path: &str) -> Result<String, String> {
    let mut data = Vec::new();
    std::fs::File::open(path).map_err(|e| e.to_string())?.take(65537)
        .read_to_end(&mut data).map_err(|e| e.to_string())?;
    if data.len() > 65536 { return Err("verdict exceeds 64 KiB".into()); }
    let v: serde_json::Value = serde_json::from_slice(&data).map_err(|e| e.to_string())?;
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?.as_secs();
    verdict_fields(&v, now)
}

fn main() {
    let args: Vec<String> = std::env::args().collect();

    #[cfg(unix)]
    if args.len() >= 2 && args[1] == "lock-run" {
        exit(lock_run(&args[2..]));
    }
    #[cfg(unix)]
    if args.len() >= 2 && args[1] == "run-bounded" {
        exit(run_bounded(&args[2..]));
    }

    if args.len() == 3 && args[1] == "verdict" {
        match read_verdict(&args[2]) {
            Ok(fields) => { print!("{fields}"); return; }
            Err(e) => { eprintln!("verdict: {e}"); exit(1); }
        }
    }

    if args.len() >= 2 && args[1] == "autopif" {
        // Each call inside is bounded by its own idle timeout; the watchdog only
        // has to catch a call that makes no progress at all.
        arm_watchdog(45, 600);
        exit(autopif::run(&args[2..]));
    }

    if args.len() >= 3 && args[1] == "--diag" {
        diag(&args[2]);
        return;
    }

    let mut url: Option<String> = None;
    let mut out: Option<String> = None;
    let mut ua = String::from("Mozilla/5.0 (Linux; Android) asfetch/1.0");
    let mut headers: Vec<(String, String)> = Vec::new();
    let mut timeout: u64 = 30;

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "-o" | "-O" => {
                i += 1;
                out = args.get(i).cloned();
            }
            "-H" | "--header" => {
                i += 1;
                if let Some(v) = args.get(i) {
                    if let Some((k, val)) = v.split_once(':') {
                        headers.push((k.trim().to_string(), val.trim().to_string()));
                    }
                }
            }
            "-A" | "-U" => {
                i += 1;
                if let Some(v) = args.get(i) {
                    ua = v.clone();
                }
            }
            "-T" | "-t" => {
                i += 1;
                if let Some(v) = args.get(i) {
                    timeout = v.parse().unwrap_or(30);
                }
            }
            "-h" | "--help" => {
                eprintln!("usage: asfetch URL [-o|-O FILE] [-A USER_AGENT] [-H \"Key: Value\"]... [-T SECONDS]");
                exit(2);
            }
            s if !s.starts_with('-') => url = Some(s.to_string()),
            _ => { /* ignore unknown flags */ }
        }
        i += 1;
    }

    let url = match url {
        Some(u) => u,
        None => {
            eprintln!("asfetch: no URL given");
            exit(2);
        }
    };

    // -T is the idle timeout for one read; the stall limit sits above it so a
    // legitimately slow reply (DNS on a bad link can take 20-30 s, a connect race
    // up to 6 s, then T of silence) is never cut short, while a fetch that makes
    // no progress at all is. The hard cap is only a ceiling for a trickle.
    arm_watchdog(timeout * 2 + 25, timeout * 10 + 120);

    let body = match fetch_inner(&url, &ua, &headers, Duration::from_secs(timeout)) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("asfetch: {url}: {}", e.msg());
            exit(1);
        }
    };

    match out {
        Some(path) => {
            if let Err(e) = std::fs::write(&path, &body) {
                eprintln!("asfetch: write {path}: {e}");
                exit(1);
            }
        }
        None => {
            let _ = std::io::stdout().write_all(&body);
        }
    }
    exit(0);
}

#[cfg(test)]
mod repair_tests {
    use super::*;
    #[test]
    fn framing_rejects_partial_and_ambiguous() {
        assert!(complete_body("content-length: 5", b"abc".to_vec(), true).is_err());
        assert!(complete_body("content-length: 3\r\ncontent-length: 3", b"abc".to_vec(), true).is_err());
        assert!(complete_body("transfer-encoding: chunked\r\ncontent-length: 3", b"abc".to_vec(), true).is_err());
        assert!(complete_body("", b"abc".to_vec(), false).is_err());
        assert_eq!(complete_body("content-length: 3", b"abc".to_vec(), false).unwrap(), b"abc");
    }
    #[test]
    fn chunked_requires_final_terminator() {
        assert_eq!(dechunk(b"3\r\nabc\r\n0\r\n\r\n").unwrap(), b"abc");
        for v in [b"3\r\nab".as_slice(), b"3\r\nabc\r\n", b"0\r\n", b"z\r\n", b"0\r\n\r\nextra"] {
            assert!(dechunk(v).is_err());
        }
        assert_eq!(dechunk(b"3;ext=x\r\nabc\r\n0\r\nx: y\r\n\r\n").unwrap(), b"abc");
    }
    #[test]
    fn transport_never_downgrades_tls() {
        let u = parse_url("https://example.com/key").unwrap();
        assert!(redirect_target(&u, "http://example.com/key").is_none());
        assert!(parse_url("ftp://example.com/key").is_none());
        assert!(redirect_target(&u, "/new").unwrap().starts_with("https://"));
    }
    #[test]
    fn timeout_is_not_success() {
        struct Timeout;
        impl Read for Timeout {
            fn read(&mut self, _: &mut [u8]) -> std::io::Result<usize> {
                Err(std::io::Error::new(std::io::ErrorKind::TimedOut, "fixture"))
            }
        }
        assert!(read_all(Timeout).is_err());
    }
    #[test]
    fn verdict_requires_fresh_timestamp_and_exact_labels() {
        let mut v = serde_json::json!({"requestDetails":{"timestampMillis":"1000000"},
            "deviceIntegrity":{"deviceRecognitionVerdict":["MEETS_BASIC_INTEGRITY","MEETS_DEVICE_INTEGRITY","MEETS_STRONG_INTEGRITY"]}});
        assert!(verdict_fields(&v, 1000).unwrap().contains("strong=1"));
        assert!(verdict_fields(&v, 2000).is_err());
        v["deviceIntegrity"]["deviceRecognitionVerdict"] = serde_json::json!(["FAKE_MEETS_STRONG_INTEGRITY"]);
        assert!(verdict_fields(&v, 1000).unwrap().contains("strong=0"));
        v["requestDetails"] = serde_json::json!({});
        assert!(verdict_fields(&v, 1000).is_err());
    }
    #[test]
    fn empty_device_verdict_is_zero_but_errors_are_not_verdicts() {
        let v = serde_json::json!({"requestDetails":{"timestampMillis":"1000000"}, "deviceIntegrity":{}});
        assert_eq!(verdict_fields(&v, 1000).unwrap(), "timestamp=1000\nbasic=0\ndevice=0\nstrong=0\n");
        assert!(verdict_fields(&serde_json::json!({"tokenPayloadExternal":v.clone()}),1000).is_ok());
        for value in [serde_json::json!({"requestDetails":{"timestampMillis":"1000000"}}),
            serde_json::json!({"error":"backend failed","requestDetails":{"timestampMillis":"1000000"},"deviceIntegrity":{}}),
            serde_json::json!({"requestDetails":{"timestampMillis":"1000000"},"deviceIntegrity":{"deviceRecognitionVerdict":null}})] {
            assert!(verdict_fields(&value,1000).is_err());
        }
    }
}
