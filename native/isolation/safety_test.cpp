#include "safety.hpp"
#include <cassert>
#include <cstdlib>
#include <string>
#include <sys/wait.h>

void write_file(const std::string& path, const char* value) {
    FILE* f = fopen(path.c_str(), "w"); assert(f); fputs(value, f); fclose(f);
}
int main() {
    char dir[] = "/tmp/alwaysstrong-safety.XXXXXX";
    assert(mkdtemp(dir));
    std::string root(dir), config = root + "/config", boot = root + "/boot";
    assert(mkfifo(config.c_str(), 0600) == 0);
    auto started = isolation::monotonic_ms();
    assert(isolation::open_regular(config.c_str(), 64) == -1);
    assert(isolation::monotonic_ms() - started < 100);
    unlink(config.c_str());
    write_file(config, "normal");
    int fd = isolation::open_regular(config.c_str(), 64); assert(fd >= 0); close(fd);
    assert(isolation::open_regular(config.c_str(), 2) == -1);
    assert(symlink(config.c_str(), (root + "/symlink").c_str()) == 0);
    assert(isolation::open_regular((root + "/symlink").c_str(), 64) == -1);
    assert(isolation::open_regular(root.c_str(), 64) == -1);

    const char* id = "12345678-1234-1234-1234-123456789abc\n";
    write_file(boot, id);
    assert(!isolation::ready(dir, boot.c_str()));
    write_file(root + "/.boot-ready", "12345678-1234-1234-1234-123456789abd\n");
    assert(!isolation::ready(dir, boot.c_str()));
    write_file(root + "/.boot-ready", id);
    assert(isolation::ready(dir, boot.c_str()));
    for (const char* marker : {"disable", "remove"}) {
        write_file(root + "/" + marker, "");
        assert(!isolation::ready(dir, boot.c_str()));
        unlink((root + "/" + marker).c_str());
    }
    write_file(root + "/.boot-ready", "malformed");
    assert(!isolation::ready(dir, boot.c_str()));

    int pair[2]; assert(socketpair(AF_UNIX, SOCK_STREAM, 0, pair) == 0);
    pid_t child = fork(); assert(child >= 0);
    if (!child) {
        close(pair[0]);
        for (unsigned i = 0; i < 30; ++i) {
            unsigned char value = 1;
            if (send(pair[1], &value, 1, MSG_NOSIGNAL) != 1) break;
            usleep(20000);
        }
        close(pair[1]); _exit(0);
    }
    close(pair[1]);
    unsigned char request[256]{};
    started = isolation::monotonic_ms();
    assert(!isolation::transfer(pair[0], request, sizeof(request), false, started + 150));
    assert(isolation::monotonic_ms() - started < 500);
    close(pair[0]); waitpid(child, nullptr, 0);
    assert(socketpair(AF_UNIX, SOCK_STREAM, 0, pair) == 0);
    started = isolation::monotonic_ms();
    assert(isolation::transfer(pair[0], request, 1, true, started + 150));
    assert(isolation::transfer(pair[1], request, 1, false, started + 150));
    assert(!isolation::transfer(pair[0], request, 1, false, started - 1));
    close(pair[0]); close(pair[1]);
    for (const char* name : {"config", "boot", "symlink", ".boot-ready"}) unlink((root + "/" + name).c_str());
    rmdir(dir);
    puts("PASS: FIFO/symlink/oversized config rejection, current-boot gate, shared IPC deadline");
}
