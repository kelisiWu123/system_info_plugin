#import <Foundation/Foundation.h>
#include <errno.h>
#include <limits.h>
#include <signal.h>

// Shared with the command-line lifecycle tests: no Cocoa UI is required to
// verify that a helper exits after its plugin (not the uTools host) is gone.
static inline NSDictionary *HWMenubarReadRecord(NSString *path) {
    NSData *data = [NSData dataWithContentsOfFile:path];
    if (!data) return nil;
    id value = [NSJSONSerialization JSONObjectWithData:data options:0 error:NULL];
    return [value isKindOfClass:[NSDictionary class]] ? value : nil;
}

static inline BOOL HWMenubarRuntimeShouldExit(NSString *schedulerPath,
                                             NSString *stopPath,
                                             NSTimeInterval now,
                                             NSTimeInterval grace,
                                             NSTimeInterval *lastAlive) {
    NSDictionary *stop = HWMenubarReadRecord(stopPath);
    if ([stop[@"stoppedAt"] isKindOfClass:[NSNumber class]] && [stop[@"stoppedAt"] doubleValue] > 0) {
        return YES;
    }

    NSDictionary *scheduler = HWMenubarReadRecord(schedulerPath);
    id pidValue = scheduler[@"pid"];
    long long candidate = [pidValue isKindOfClass:[NSNumber class]] ? [pidValue longLongValue] : 0;
    BOOL valid = candidate > 1 && candidate <= INT_MAX && [pidValue doubleValue] == candidate;
    if (valid && (kill((pid_t)candidate, 0) == 0 || errno == EPERM)) {
        // Process existence, not sample age: slow sensors and throttled hidden
        // renderers must not trigger an endless exit/restart loop.
        *lastAlive = now;
        return NO;
    }
    return now - *lastAlive >= grace;
}
