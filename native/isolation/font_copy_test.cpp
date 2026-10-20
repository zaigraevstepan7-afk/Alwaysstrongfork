#include <initializer_list>
#include "font_copy.hpp"
#include <cassert>
#include <fcntl.h>
#include <unistd.h>
int main() {
    const char* path="/data/adb/modules/font_module/system/fonts/Roboto.ttf";
    assert(isolation::font_candidate(path,"r--p",4096));
    for (const char* mode : {"r-xp","rw-p","r--s"}) assert(!isolation::font_candidate(path,mode,4096));
    assert(!isolation::font_candidate("/system/fonts/Roboto.ttf","r--p",4096));
    assert(!isolation::font_candidate("/data/adb/modules/m/system/lib/library.so","r--p",4096));
    assert(!isolation::font_candidate(path,"r--p",isolation::kMappingLimit+1));
    char name[]="/tmp/alwaysstrong-font-test.XXXXXX";
    int fd=mkstemp(name); assert(fd>=0);
    const size_t size=static_cast<size_t>(sysconf(_SC_PAGESIZE));
    assert(ftruncate(fd,size)==0);
    unsigned char* data=static_cast<unsigned char*>(mmap(nullptr,size,PROT_READ|PROT_WRITE,MAP_PRIVATE,fd,0));
    assert(data!=MAP_FAILED);
    for (size_t i=0;i<size;++i) data[i]=static_cast<unsigned char>(i%251);
    assert(mprotect(data,size,PROT_READ)==0);
    assert(isolation::private_copy(data,size));
    for (size_t i=0;i<size;++i) assert(data[i]==i%251);
    FILE* maps=fopen("/proc/self/maps","r"); assert(maps);
    char line[2048]; bool found=false;
    while (fgets(line,sizeof(line),maps)) {
        unsigned long begin=0,end=0;
        if (sscanf(line,"%lx-%lx",&begin,&end)==2 && reinterpret_cast<uintptr_t>(data)>=begin && reinterpret_cast<uintptr_t>(data)<end) {
            assert(strstr(line,name)==nullptr); assert(strstr(line,"r--p")); found=true;
        }
    }
    fclose(maps); assert(found);
    assert(munmap(data,size)==0); close(fd); unlink(name);
    puts("PASS: immutable font selection, byte/address/permission preservation and anonymous replacement");
}
