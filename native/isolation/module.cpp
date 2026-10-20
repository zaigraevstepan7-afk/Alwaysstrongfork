// Copyright 2026 AlwaysStrongFork contributors. GPL-3.0-or-later.
#ifndef _GNU_SOURCE
#define _GNU_SOURCE 1
#endif
#include <sys/types.h>
#include "vendor/zygisk.hpp"
#include "policy.hpp"
#include "font_copy.hpp"
#include <unistd.h>
#include <fcntl.h>
#include <poll.h>
#include <sys/stat.h>
#include <sys/socket.h>
#include <cerrno>

namespace {
constexpr const char* kDirectory = "/data/adb/modules/alwaysstrong_isolation";
bool transfer(int fd, void* data, size_t size, bool sending) {
    auto* bytes = static_cast<unsigned char*>(data);
    while (size) {
        pollfd pfd{fd, static_cast<short>(sending ? POLLOUT : POLLIN), 0};
        if (poll(&pfd, 1, 150) <= 0) return false;
        ssize_t n = sending ? send(fd, bytes, size, MSG_NOSIGNAL | MSG_DONTWAIT)
                            : recv(fd, bytes, size, MSG_DONTWAIT);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) return false;
        bytes += n; size -= static_cast<size_t>(n);
    }
    return true;
}
void companion(int client) {
    char process[256]{};
    if (!transfer(client, process, sizeof(process), false) || process[255] != 0) return;
    unsigned char selected = 0;
    char path[160];
    std::snprintf(path, sizeof(path), "%s/disable", kDirectory);
    if (access(path, F_OK) != 0) {
        std::snprintf(path, sizeof(path), "%s/targets.list", kDirectory);
        int fd = open(path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
        if (fd >= 0) {
            struct stat info{};
            if (!fstat(fd, &info) && S_ISREG(info.st_mode) && info.st_size <= 65536) {
                FILE* file = fdopen(fd, "r");
                if (file) { selected = isolation::listed(file, process) ? 1 : 0; fclose(file); fd = -1;
                    if (selected) {
                        std::snprintf(path, sizeof(path), "%s/private-fonts", kDirectory);
                        int option = open(path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
                        char value=0;
                        if (option>=0) { if (read(option,&value,1)==1 && value=='1') selected|=2; close(option); }
                    } }
            }
            if (fd >= 0) close(fd);
        }
    }
    transfer(client, &selected, 1, true);
}
class Module final : public zygisk::ModuleBase {
    zygisk::Api* api_ = nullptr;
    JNIEnv* env_ = nullptr;
public:
    void onLoad(zygisk::Api* api, JNIEnv* env) override { api_ = api; env_ = env; }
    void preAppSpecialize(zygisk::AppSpecializeArgs* args) override {
        // No function hooks survive specialization; unloading is safe here.
        api_->setOption(zygisk::DLCLOSE_MODULE_LIBRARY);
        if (!args->nice_name) return;
        const char* name = env_->GetStringUTFChars(args->nice_name, nullptr);
        if (!name) { env_->ExceptionClear(); return; }
        char process[256]{};
        bool allowed = isolation::eligible(args->uid,
            (api_->getFlags() & zygisk::PROCESS_GRANTED_ROOT) != 0, name);
        if (allowed) std::memcpy(process, name, std::strlen(name));
        env_->ReleaseStringUTFChars(args->nice_name, name);
        if (!allowed) return;
        int fd = api_->connectCompanion();
        if (fd < 0) return;
        unsigned char selected = 0;
        bool ok = transfer(fd, process, sizeof(process), true) && transfer(fd, &selected, 1, false);
        close(fd);
        if (ok && (selected & 1)) {
            // The child has not started application code. Copy only immutable,
            // private module font mappings; code/shared mappings are excluded.
            if (selected & 2) isolation::private_module_fonts();
            api_->setOption(zygisk::FORCE_DENYLIST_UNMOUNT);
        }
    }
    void preServerSpecialize(zygisk::ServerSpecializeArgs*) override {
        api_->setOption(zygisk::DLCLOSE_MODULE_LIBRARY);
    }
};
}
REGISTER_ZYGISK_MODULE(Module)
REGISTER_ZYGISK_COMPANION(companion)
