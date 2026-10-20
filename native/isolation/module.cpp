// Copyright 2026 AlwaysStrongFork contributors. GPL-3.0-or-later.
#ifndef _GNU_SOURCE
#define _GNU_SOURCE 1
#endif
#include <sys/types.h>
#include "vendor/zygisk.hpp"
#include "policy.hpp"
#include "safety.hpp"
#include <sys/system_properties.h>
#include <unistd.h>
#include <fcntl.h>
#include <poll.h>
#include <sys/stat.h>
#include <sys/socket.h>
#include <cerrno>

namespace {
constexpr const char* kDirectory = "/data/adb/modules/alwaysstrong_isolation";
void companion(int client) {
    char process[256]{};
    const long long deadline = isolation::monotonic_ms() + 150;
    if (!isolation::transfer(client, process, sizeof(process), false, deadline) || process[255] != 0) return;
    unsigned char selected = 0;
    if (isolation::ready(kDirectory)) {
        char path[160];
        std::snprintf(path, sizeof(path), "%s/targets.list", kDirectory);
        int fd = isolation::open_regular(path, 65536);
        if (fd >= 0) {
            FILE* file = fdopen(fd, "r");
            if (file) { selected = isolation::listed(file, process) ? 1 : 0; fclose(file); }
            else close(fd);
        }
    }
    isolation::transfer(client, &selected, 1, true, deadline);
}
class Module final : public zygisk::ModuleBase {
    zygisk::Api* api_ = nullptr;
    JNIEnv* env_ = nullptr;
public:
    void onLoad(zygisk::Api* api, JNIEnv* env) override { api_ = api; env_ = env; }
    void preAppSpecialize(zygisk::AppSpecializeArgs* args) override {
        // No function hooks survive specialization; unloading is safe here.
        api_->setOption(zygisk::DLCLOSE_MODULE_LIBRARY);
        // No companion IPC or unmount operation during Android startup.
        char completed[PROP_VALUE_MAX]{};
        if (__system_property_get("sys.boot_completed", completed) != 1 || completed[0] != '1') return;
        if (!args->nice_name || (args->is_child_zygote && *args->is_child_zygote)) return;
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
        const long long deadline = isolation::monotonic_ms() + 150;
        bool ok = isolation::transfer(fd, process, sizeof(process), true, deadline) &&
                  isolation::transfer(fd, &selected, 1, false, deadline);
        close(fd);
        if (ok && selected == 1) api_->setOption(zygisk::FORCE_DENYLIST_UNMOUNT);
    }
    void preServerSpecialize(zygisk::ServerSpecializeArgs*) override {
        api_->setOption(zygisk::DLCLOSE_MODULE_LIBRARY);
    }
};
}
REGISTER_ZYGISK_MODULE(Module)
REGISTER_ZYGISK_COMPANION(companion)
