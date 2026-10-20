#pragma once
#include <sys/mman.h>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <cstdlib>
namespace isolation {
constexpr size_t kMappingLimit = 16 * 1024 * 1024;
inline bool font_candidate(const char* path, const char* perms, size_t size) {
    if (!path || !perms || std::strcmp(perms,"r--p") || !size || size > kMappingLimit) return false;
    if (std::strncmp(path,"/data/adb/modules/",18) || !std::strstr(path,"/system/fonts/")) return false;
    size_t n=std::strlen(path);
    return n>=4 && (!std::strcmp(path+n-4,".ttf") || !std::strcmp(path+n-4,".otf"));
}
inline bool private_copy(void* address, size_t size) {
    if (!size || size > kMappingLimit) return false;
    void* copy=mmap(nullptr,size,PROT_READ|PROT_WRITE,MAP_PRIVATE|MAP_ANONYMOUS,-1,0);
    if (copy==MAP_FAILED) return false;
    std::memcpy(copy,address,size);
    if (mprotect(copy,size,PROT_READ)) { munmap(copy,size); return false; }
    // A failed mremap leaves the old mapping untouched. Never unmap it first.
    void* moved=mremap(copy,size,size,MREMAP_MAYMOVE|MREMAP_FIXED,address);
    if (moved==MAP_FAILED) { munmap(copy,size); return false; }
    return moved==address;
}
inline unsigned private_module_fonts() {
    FILE* maps=std::fopen("/proc/self/maps","r");
    if (!maps) return 0;
    struct Mapping { uintptr_t begin; size_t size; } candidates[128];
    unsigned count=0;
    size_t total=0;
    char line[2048];
    while (count<128 && std::fgets(line,sizeof(line),maps)) {
        unsigned long begin=0,end=0; char perms[5]{}; int offset=0;
        if (std::sscanf(line,"%lx-%lx %4s %*s %*s %*s %n",&begin,&end,perms,&offset)!=3 || offset<=0 || end<=begin) continue;
        char* path=line+offset;
        path[std::strcspn(path,"\r\n")]=0;
        size_t size=end-begin;
        if (!font_candidate(path,perms,size) || total+size>64*1024*1024) continue;
        candidates[count++]={static_cast<uintptr_t>(begin),size}; total+=size;
    }
    std::fclose(maps);
    unsigned copied=0;
    for (unsigned i=0;i<count;++i)
        if (private_copy(reinterpret_cast<void*>(candidates[i].begin),candidates[i].size)) ++copied;
    return copied;
}
}
