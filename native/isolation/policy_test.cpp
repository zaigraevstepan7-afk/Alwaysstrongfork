#include "policy.hpp"
#include <cassert>
#include <string>
FILE* fixture(const char* contents) {
    FILE* file = tmpfile(); assert(file); fputs(contents,file); rewind(file); return file;
}
int main() {
    assert(isolation::eligible(10480,false,"com.example.app"));
    assert(isolation::eligible(1010480,false,"com.example.app:worker"));
    assert(!isolation::eligible(10480,true,"com.example.app"));
    assert(!isolation::eligible(1000,false,"com.example.app"));
    assert(!isolation::eligible(99007,false,"com.example.app"));
    assert(!isolation::eligible(10480,false,"com.google.android.gms:unstable"));
    assert(!isolation::eligible(10480,false,"com.tencent.soter.soterserver"));
    assert(!isolation::eligible(10480,false,"/system/bin/sh"));
    for (const char* invalid : {"", "a..b", ".a.b", "a.b.", "a.b;id", "*", "a/b", "a.1b"})
        assert(!isolation::package_name(invalid));
    FILE* file=fixture("# comment\r\ncom.example.app\r\ncom.example.other\n");
    assert(isolation::listed(file,"com.example.app:worker")); rewind(file);
    assert(!isolation::listed(file,"com.example.application")); fclose(file);
    file=fixture("com.google.android.gms\n");
    assert(!isolation::listed(file,"com.google.android.gms")); fclose(file);
    std::string oversized="com.example.app"+std::string(300,'x')+"\n";
    file=fixture(oversized.c_str()); assert(!isolation::listed(file,"com.example.app")); fclose(file);
    puts("PASS: isolation package selection, protected/root/isolated UIDs, exact matching and bounded input");
}
