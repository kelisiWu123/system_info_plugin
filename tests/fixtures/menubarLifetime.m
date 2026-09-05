#import "../../native/macos-menubar-helper/lifetime.h"
#include <stdio.h>
#include <unistd.h>

int main(int argc, const char *argv[]) {
    if (argc != 3) return 2;
    @autoreleasepool {
        NSString *scheduler = [NSString stringWithUTF8String:argv[1]];
        NSString *stop = [NSString stringWithUTF8String:argv[2]];
        NSTimeInterval lastAlive = [NSProcessInfo processInfo].systemUptime;
        puts("ready");
        fflush(stdout);
        while (YES) {
            @autoreleasepool {
                if (HWMenubarRuntimeShouldExit(scheduler, stop, [NSProcessInfo processInfo].systemUptime, 0.7, &lastAlive)) return 0;
            }
            usleep(50000);
        }
    }
}
