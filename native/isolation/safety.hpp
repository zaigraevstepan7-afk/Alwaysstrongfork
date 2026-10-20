#pragma once
#include <sys/stat.h>
#include <sys/socket.h>
#include <fcntl.h>
#include <poll.h>
#include <unistd.h>
#include <time.h>
#include <cerrno>
#include <cstddef>
#include <initializer_list>
#include <cstdio>
#include <cstring>

namespace isolation {
inline long long monotonic_ms() {
    timespec now{};
    if (clock_gettime(CLOCK_MONOTONIC, &now)) return -1;
    return static_cast<long long>(now.tv_sec) * 1000 + now.tv_nsec / 1000000;
}
// One deadline is shared by the complete request/response, including short
// reads, EAGAIN and interrupted syscalls. A slow peer cannot renew the budget.
inline bool transfer(int fd, void* data, size_t size, bool sending, long long deadline) {
    auto* bytes = static_cast<unsigned char*>(data);
    while (size) {
        long long now = monotonic_ms();
        if (now < 0 || now >= deadline || deadline - now > 150) return false;
        pollfd pfd{fd, static_cast<short>(sending ? POLLOUT : POLLIN), 0};
        int result = poll(&pfd, 1, static_cast<int>(deadline - now));
        if (result < 0 && errno == EINTR) continue;
        if (result <= 0 || (pfd.revents & (POLLERR | POLLNVAL))) return false;
        ssize_t n = sending ? send(fd, bytes, size, MSG_NOSIGNAL | MSG_DONTWAIT)
                            : recv(fd, bytes, size, MSG_DONTWAIT);
        if (n < 0 && (errno == EINTR || errno == EAGAIN || errno == EWOULDBLOCK)) continue;
        if (n <= 0) return false;
        bytes += n; size -= static_cast<size_t>(n);
    }
    return true;
}
inline int open_regular(const char* path, size_t limit) {
    // O_NONBLOCK precedes fstat: opening a FIFO must never block the companion.
    int fd = open(path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW | O_NONBLOCK);
    if (fd < 0) return -1;
    struct stat info{};
    if (fstat(fd, &info) || !S_ISREG(info.st_mode) || info.st_size < 0 ||
        static_cast<unsigned long long>(info.st_size) > limit) {
        close(fd); return -1;
    }
    return fd;
}
inline bool boot_id(const char* path, char (&out)[64]) {
    int fd = open_regular(path, 63);
    if (fd < 0) return false;
    ssize_t n = read(fd, out, sizeof(out) - 1);
    close(fd);
    if (n != 36 && n != 37) return false;
    if (n == 37 && out[36] != '\n') return false;
    out[36] = 0;
    for (unsigned i = 0; i < 36; ++i) {
        if (i == 8 || i == 13 || i == 18 || i == 23) { if (out[i] != '-') return false; }
        else if (!((out[i] >= '0' && out[i] <= '9') || (out[i] >= 'a' && out[i] <= 'f'))) return false;
    }
    return true;
}
inline bool ready(const char* directory, const char* current_boot = "/proc/sys/kernel/random/boot_id") {
    char path[256]; struct stat info{};
    for (const char* marker : {"disable", "remove"}) {
        std::snprintf(path, sizeof(path), "%s/%s", directory, marker);
        if (!lstat(path, &info) || errno != ENOENT) return false;
    }
    char current[64]{}, settled[64]{};
    std::snprintf(path, sizeof(path), "%s/.boot-ready", directory);
    return boot_id(current_boot, current) && boot_id(path, settled) && !std::strcmp(current, settled);
}
}
