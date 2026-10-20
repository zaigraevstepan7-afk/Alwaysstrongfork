#pragma once
#include <cstddef>
#include <cstring>
#include <cstdio>

namespace isolation {
constexpr size_t kNameLimit = 255;
inline bool package_name(const char* value) {
    if (!value || !*value || std::strlen(value) > kNameLimit) return false;
    bool dot = false, segment_start = true;
    for (const char* p = value; *p; ++p) {
        char c = *p;
        if (c == '.') { if (segment_start) return false; dot = true; segment_start = true; continue; }
        if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '_' ||
              (!segment_start && c >= '0' && c <= '9'))) return false;
        segment_start = false;
    }
    return dot && !segment_start;
}
inline bool process_package(const char* process, char (&package)[256]) {
    if (!process || std::strlen(process) > kNameLimit) return false;
    size_t n = std::strcspn(process, ":");
    if (!n || n > kNameLimit) return false;
    std::memcpy(package, process, n); package[n] = 0;
    return package_name(package);
}
inline bool protected_package(const char* p) {
    const char* protected_names[] = {
        "com.google.android.gms", "com.google.android.gsf", "com.android.vending",
        "com.tencent.soter.soterserver", "android", "com.android.systemui"
    };
    for (const char* entry : protected_names) if (!std::strcmp(p, entry)) return true;
    return false;
}
inline bool eligible(unsigned uid, bool granted_root, const char* process) {
    unsigned app_id = uid % 100000;
    if (granted_root || app_id < 10000 || app_id >= 90000) return false;
    char package[256]{};
    return process_package(process, package) && !protected_package(package);
}
// One exact package per line. No globs, shell expressions, UID rules or paths.
inline bool listed(FILE* file, const char* process) {
    char package[256]{};
    if (!file || !process_package(process, package) || protected_package(package)) return false;
    char line[258];
    for (unsigned count = 0; count < 512 && std::fgets(line, sizeof(line), file); ++count) {
        size_t n = std::strlen(line);
        if (n && line[n-1] != '\n' && !std::feof(file)) {
            int c; while ((c = std::fgetc(file)) != '\n' && c != EOF) {}
            continue;
        }
        while (n && (line[n-1] == '\n' || line[n-1] == '\r')) line[--n] = 0;
        if (package_name(line) && !std::strcmp(line, package)) return true;
    }
    return false;
}
}
