#import <Cocoa/Cocoa.h>
#import "lifetime.h"
#include <stdio.h>
#include <stdlib.h>
#include <math.h>
#include <fcntl.h>
#include <signal.h>
#include <sys/file.h>
#include <unistd.h>

@interface MenubarAppDelegate : NSObject <NSApplicationDelegate>
@property (strong, nonatomic) dispatch_source_t stdinSource;
@property (assign, nonatomic) BOOL showIcon;
@property (assign, nonatomic) BOOL showTemp;
@property (assign, nonatomic) BOOL showLoad;
- (BOOL)acquireSingletonLock;
@end

@implementation MenubarAppDelegate {
    NSMutableData *_readBuffer;
    dispatch_source_t _telemetryFileSource;
    dispatch_source_t _parentProcessSource;
    dispatch_source_t _pluginLifetimeSource;
    NSString *_telemetryFilePath;
    NSData *_lastTelemetryPayload;
    NSMenu *_statusMenu;
    NSMutableDictionary<NSString *, NSStatusItem *> *_metricStatusItems;
    NSMutableDictionary<NSString *, NSMenuItem *> *_metricMenuItems;
    NSMutableDictionary<NSString *, NSImage *> *_symbolImages;
    int _singletonLockFd;
    pid_t _parentPid;
}

- (instancetype)init {
    self = [super init];
    if (self) {
        _singletonLockFd = -1;
        _parentPid = -1;
    }
    return self;
}

- (BOOL)acquireSingletonLock {
    const char *lockPath = getenv("HWINFOX_MENUBAR_LOCK_PATH");
    if (!lockPath || lockPath[0] == '\0') {
        return YES;
    }

    int lockFd = open(lockPath, O_CREAT | O_RDWR, 0600);
    if (lockFd < 0) {
        return NO;
    }

    if (flock(lockFd, LOCK_EX | LOCK_NB) != 0) {
        close(lockFd);
        return NO;
    }

    _singletonLockFd = lockFd;
    return YES;
}

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    (void)notification;
    // Set as accessory application (no Dock icon, status bar only)
    [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];

    self.showIcon = YES;
    self.showTemp = YES;
    self.showLoad = YES;
    _readBuffer = [NSMutableData data];
    _metricStatusItems = [NSMutableDictionary dictionary];
    _metricMenuItems = [NSMutableDictionary dictionary];
    _symbolImages = [NSMutableDictionary dictionary];

    [self setupMenu];
    [self setupParentProcessMonitor];
    [self setupPluginLifetimeMonitor];
    const char *telemetryPath = getenv("HWINFOX_MENUBAR_TELEMETRY_PATH");
    if (telemetryPath && telemetryPath[0] != '\0') {
        _telemetryFilePath = [NSString stringWithUTF8String:telemetryPath];
        [self setupTelemetryFileListener];
    } else {
        [self setupStdinListener];
    }
}

- (void)setupParentProcessMonitor {
    const char *parentPidText = getenv("HWINFOX_MENUBAR_PARENT_PID");
    if (!parentPidText || parentPidText[0] == '\0') {
        return;
    }

    char *end = NULL;
    long parsedPid = strtol(parentPidText, &end, 10);
    if (end == parentPidText || *end != '\0' || parsedPid <= 1) {
        return;
    }
    _parentPid = (pid_t)parsedPid;

    dispatch_queue_t queue = dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0);
    _parentProcessSource = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, queue);

    __weak typeof(self) weakSelf = self;
    dispatch_source_set_timer(
        _parentProcessSource,
        dispatch_time(DISPATCH_TIME_NOW, 1 * NSEC_PER_SEC),
        1 * NSEC_PER_SEC,
        100 * NSEC_PER_MSEC
    );
    dispatch_source_set_event_handler(_parentProcessSource, ^{
        MenubarAppDelegate *strongSelf = weakSelf;
        if (!strongSelf) {
            return;
        }

        const BOOL parentIsCurrent = getppid() == strongSelf->_parentPid;
        const BOOL parentIsAlive = kill(strongSelf->_parentPid, 0) == 0;
        if (parentIsCurrent || parentIsAlive) {
            return;
        }

        dispatch_async(dispatch_get_main_queue(), ^{
            MenubarAppDelegate *mainSelf = weakSelf;
            if (mainSelf) {
                [NSApp terminate:nil];
            }
        });
    });

    dispatch_resume(_parentProcessSource);
}

- (void)setupPluginLifetimeMonitor {
    const char *schedulerPath = getenv("HWINFOX_MENUBAR_SCHEDULER_PATH");
    const char *stopPath = getenv("HWINFOX_MENUBAR_STOP_PATH");
    if (!schedulerPath || !stopPath) return;

    NSString *scheduler = [NSString stringWithUTF8String:schedulerPath];
    NSString *stop = [NSString stringWithUTF8String:stopPath];
    __block NSTimeInterval lastAlive = [NSProcessInfo processInfo].systemUptime;
    // The JS scheduler allows 10s for a starting ownership claim. Leave time
    // for its next 2s tick to finish a window-to-window handoff.
    const NSTimeInterval grace = 15.0;
    _pluginLifetimeSource = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, dispatch_get_main_queue());
    dispatch_source_set_timer(_pluginLifetimeSource, DISPATCH_TIME_NOW, 500 * NSEC_PER_MSEC, 50 * NSEC_PER_MSEC);
    dispatch_source_set_event_handler(_pluginLifetimeSource, ^{
        if (HWMenubarRuntimeShouldExit(scheduler, stop, [NSProcessInfo processInfo].systemUptime, grace, &lastAlive)) {
            [NSApp terminate:nil];
        }
    });
    dispatch_resume(_pluginLifetimeSource);
}

- (void)setupMenu {
    NSMenu *menu = [[NSMenu alloc] initWithTitle:@"HWInfoX Menubar"];
    _statusMenu = menu;

    NSMenuItem *headerItem = [[NSMenuItem alloc] initWithTitle:@"HWInfoX 硬件监控" action:nil keyEquivalent:@""];
    [headerItem setEnabled:NO];
    [menu addItem:headerItem];

    [menu addItem:[NSMenuItem separatorItem]];

    NSArray<NSString *> *metricKeys = @[
        @"cpuTemperature",
        @"cpuLoad",
        @"cpuFrequency",
        @"fanSpeed",
        @"memoryUsage",
        @"diskIo",
        @"networkIo",
    ];
    NSArray<NSString *> *metricLabels = @[
        @"CPU 温度: --",
        @"CPU 负载: --",
        @"CPU 频率: --",
        @"风扇转速: --",
        @"内存使用: --",
        @"磁盘 IO: 读取 -- · 写入 --",
        @"网络 IO: 下行 -- · 上行 --",
    ];
    for (NSUInteger i = 0; i < metricKeys.count; i++) {
        NSMenuItem *metricItem = [[NSMenuItem alloc] initWithTitle:metricLabels[i] action:nil keyEquivalent:@""];
        metricItem.enabled = NO;
        _metricMenuItems[metricKeys[i]] = metricItem;
        [menu addItem:metricItem];
    }

    [menu addItem:[NSMenuItem separatorItem]];

    NSMenuItem *openItem = [[NSMenuItem alloc] initWithTitle:@"打开主界面" action:@selector(openMainApp) keyEquivalent:@"o"];
    openItem.target = self;
    [menu addItem:openItem];

    [menu addItem:[NSMenuItem separatorItem]];

    NSMenuItem *quitItem = [[NSMenuItem alloc] initWithTitle:@"退出菜单栏" action:@selector(quitApp) keyEquivalent:@"q"];
    quitItem.target = self;
    [menu addItem:quitItem];

}

- (NSArray<NSDictionary *> *)metricDefinitions {
    return @[
        @{ @"key": @"cpuTemperature", @"label": @"CPU 温度", @"symbol": @"thermometer.medium" },
        @{ @"key": @"cpuLoad", @"label": @"CPU 负载", @"symbol": @"gauge.with.needle" },
        @{ @"key": @"cpuFrequency", @"label": @"CPU 频率", @"symbol": @"speedometer" },
        @{ @"key": @"fanSpeed", @"label": @"风扇转速", @"symbol": @"fanblades" },
        @{ @"key": @"memoryUsage", @"label": @"内存使用", @"symbol": @"memorychip" },
        @{ @"key": @"diskIo", @"label": @"磁盘 IO", @"symbol": @"arrow.up.arrow.down.circle" },
        @{ @"key": @"networkIo", @"label": @"网络 IO", @"symbol": @"network" },
    ];
}

- (NSNumber *)numberFromDictionary:(NSDictionary *)dict key:(NSString *)key {
    id value = dict[key];
    return [value isKindOfClass:[NSNumber class]] ? (NSNumber *)value : nil;
}

- (NSString *)formatBytesPerSecond:(NSNumber *)value {
    if (!value) {
        return @"--";
    }

    double bytes = value.doubleValue;
    if (!isfinite(bytes) || bytes < 0) {
        return @"--";
    }

    NSArray<NSString *> *units = @[ @"B/s", @"KB/s", @"MB/s", @"GB/s", @"TB/s" ];
    NSUInteger unitIndex = 0;
    while (bytes >= 1024.0 && unitIndex < units.count - 1) {
        bytes /= 1024.0;
        unitIndex += 1;
    }

    if (unitIndex == 0) {
        return [NSString stringWithFormat:@"%.0f %@", bytes, units[unitIndex]];
    }
    if (bytes >= 100.0) {
        return [NSString stringWithFormat:@"%.0f %@", bytes, units[unitIndex]];
    }
    if (bytes >= 10.0) {
        return [NSString stringWithFormat:@"%.1f %@", bytes, units[unitIndex]];
    }
    return [NSString stringWithFormat:@"%.2f %@", bytes, units[unitIndex]];
}

- (NSString *)formatMemoryBytes:(NSNumber *)value {
    if (!value) {
        return @"--";
    }

    double bytes = value.doubleValue;
    if (!isfinite(bytes) || bytes < 0) {
        return @"--";
    }

    NSArray<NSString *> *units = @[ @"B", @"KB", @"MB", @"GB", @"TB" ];
    NSUInteger unitIndex = 0;
    while (bytes >= 1024.0 && unitIndex < units.count - 1) {
        bytes /= 1024.0;
        unitIndex += 1;
    }

    if (unitIndex == 0) {
        return [NSString stringWithFormat:@"%.0f %@", bytes, units[unitIndex]];
    }
    if (bytes >= 100.0) {
        return [NSString stringWithFormat:@"%.0f %@", bytes, units[unitIndex]];
    }
    if (bytes >= 10.0) {
        return [NSString stringWithFormat:@"%.1f %@", bytes, units[unitIndex]];
    }
    return [NSString stringWithFormat:@"%.2f %@", bytes, units[unitIndex]];
}

- (NSString *)statusTitleForMetricKey:(NSString *)key dictionary:(NSDictionary *)dict {
    if ([key isEqualToString:@"cpuTemperature"]) {
        NSNumber *value = [self numberFromDictionary:dict key:@"temp"];
        return value ? [NSString stringWithFormat:@"%.0f°C", value.doubleValue] : @"--";
    }
    if ([key isEqualToString:@"cpuLoad"]) {
        NSNumber *value = [self numberFromDictionary:dict key:@"load"];
        return value ? [NSString stringWithFormat:@"%.0f%%", value.doubleValue] : @"--";
    }
    if ([key isEqualToString:@"cpuFrequency"]) {
        NSNumber *value = [self numberFromDictionary:dict key:@"speed"];
        return value ? [NSString stringWithFormat:@"%.2f GHz", value.doubleValue] : @"--";
    }
    if ([key isEqualToString:@"fanSpeed"]) {
        NSNumber *value = [self numberFromDictionary:dict key:@"fanSpeed"];
        return value ? [NSString stringWithFormat:@"%.0f RPM", value.doubleValue] : @"--";
    }
    if ([key isEqualToString:@"memoryUsage"]) {
        NSNumber *value = [self numberFromDictionary:dict key:@"memoryPercent"];
        return value ? [NSString stringWithFormat:@"%.1f%%", value.doubleValue] : @"--";
    }
    if ([key isEqualToString:@"diskIo"]) {
        NSString *read = [self formatBytesPerSecond:[self numberFromDictionary:dict key:@"diskReadBytesPerSec"]];
        NSString *write = [self formatBytesPerSecond:[self numberFromDictionary:dict key:@"diskWriteBytesPerSec"]];
        return [NSString stringWithFormat:@"↓ %@ ↑ %@", read, write];
    }
    if ([key isEqualToString:@"networkIo"]) {
        NSString *download = [self formatBytesPerSecond:[self numberFromDictionary:dict key:@"networkDownloadBytesPerSec"]];
        NSString *upload = [self formatBytesPerSecond:[self numberFromDictionary:dict key:@"networkUploadBytesPerSec"]];
        return [NSString stringWithFormat:@"↓ %@ ↑ %@", download, upload];
    }
    return @"--";
}

- (NSString *)menuTitleForMetricKey:(NSString *)key dictionary:(NSDictionary *)dict {
    NSString *label = nil;
    for (NSDictionary *definition in [self metricDefinitions]) {
        if ([definition[@"key"] isEqualToString:key]) {
            label = definition[@"label"];
            break;
        }
    }
    if (!label) {
        return @"--";
    }

    if ([key isEqualToString:@"memoryUsage"]) {
        NSString *used = [self formatMemoryBytes:[self numberFromDictionary:dict key:@"memoryUsedBytes"]];
        NSString *total = [self formatMemoryBytes:[self numberFromDictionary:dict key:@"memoryTotalBytes"]];
        NSString *percent = [self statusTitleForMetricKey:key dictionary:dict];
        return [NSString stringWithFormat:@"%@：%@ / %@（%@）", label, used, total, percent];
    }

    if ([key isEqualToString:@"diskIo"]) {
        NSString *read = [self formatBytesPerSecond:[self numberFromDictionary:dict key:@"diskReadBytesPerSec"]];
        NSString *write = [self formatBytesPerSecond:[self numberFromDictionary:dict key:@"diskWriteBytesPerSec"]];
        return [NSString stringWithFormat:@"%@：读取 %@ · 写入 %@", label, read, write];
    }

    if ([key isEqualToString:@"networkIo"]) {
        NSString *download = [self formatBytesPerSecond:[self numberFromDictionary:dict key:@"networkDownloadBytesPerSec"]];
        NSString *upload = [self formatBytesPerSecond:[self numberFromDictionary:dict key:@"networkUploadBytesPerSec"]];
        return [NSString stringWithFormat:@"%@：下行 %@ · 上行 %@", label, download, upload];
    }

    return [NSString stringWithFormat:@"%@：%@", label, [self statusTitleForMetricKey:key dictionary:dict]];
}

- (NSImage *)templateSymbolNamed:(NSString *)symbolName accessibilityDescription:(NSString *)description {
    if (!self.showIcon) {
        return nil;
    }

    NSImage *image = _symbolImages[symbolName];
    if (image) return image;
    if (@available(macOS 11.0, *)) {
        image = [NSImage imageWithSystemSymbolName:symbolName accessibilityDescription:description];
        image.template = YES;
        if (image) _symbolImages[symbolName] = image;
    }
    return image;
}

- (void)configureStatusItem:(NSStatusItem *)statusItem definition:(NSDictionary *)definition title:(NSString *)title {
    NSStatusBarButton *button = statusItem.button;
    if (!button) {
        return;
    }

    NSString *label = definition[@"label"];
    NSString *symbolName = definition[@"symbol"];
    if (![button.title isEqualToString:title]) button.title = title;
    button.imagePosition = NSImageLeft;
    button.imageScaling = NSImageScaleProportionallyDown;
    NSImage *image = [self templateSymbolNamed:symbolName accessibilityDescription:label];
    if (button.image != image) button.image = image;
    button.toolTip = [NSString stringWithFormat:@"HWInfoX %@", label];
}

- (void)refreshMetricStatusItemsWithDictionary:(NSDictionary *)dict {
    NSDictionary *payloadMetrics = [dict[@"metrics"] isKindOfClass:[NSDictionary class]] ? dict[@"metrics"] : nil;
    NSDictionary *metrics = payloadMetrics ?: @{
        @"cpuTemperature": @(self.showTemp),
        @"cpuLoad": @(self.showLoad),
    };

    for (NSDictionary *definition in [self metricDefinitions]) {
        NSString *key = definition[@"key"];
        BOOL enabled = [metrics[key] boolValue];
        NSStatusItem *statusItem = _metricStatusItems[key];
        NSMenuItem *menuItem = _metricMenuItems[key];

        if (enabled) {
            if (!statusItem) {
                statusItem = [[NSStatusBar systemStatusBar] statusItemWithLength:NSVariableStatusItemLength];
                statusItem.menu = _statusMenu;
                if (@available(macOS 10.12, *)) {
                    statusItem.autosaveName = [NSString stringWithFormat:@"com.hwinfox.menubar.%@", key];
                    statusItem.visible = YES;
                }
                _metricStatusItems[key] = statusItem;
            }

            [self configureStatusItem:statusItem
                           definition:definition
                                title:[self statusTitleForMetricKey:key dictionary:dict]];
            menuItem.hidden = NO;
            menuItem.title = [self menuTitleForMetricKey:key dictionary:dict];
        } else {
            menuItem.hidden = YES;
            if (statusItem) {
                [[NSStatusBar systemStatusBar] removeStatusItem:statusItem];
                [_metricStatusItems removeObjectForKey:key];
            }
        }
    }
}

- (void)openMainApp {
    // Open this plugin's hardware feature through uTools' external protocol.
    NSURL *url = [NSURL URLWithString:@"utools://HWInfoX%20%E7%A1%AC%E4%BB%B6%E4%BF%A1%E6%81%AF/%E7%A1%AC%E4%BB%B6%E4%BF%A1%E6%81%AF"];
    [[NSWorkspace sharedWorkspace] openURL:url];
}

- (void)quitApp {
    [NSApp terminate:nil];
}

- (void)setupStdinListener {
    dispatch_queue_t queue = dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0);
    self.stdinSource = dispatch_source_create(DISPATCH_SOURCE_TYPE_READ, STDIN_FILENO, 0, queue);

    __weak typeof(self) weakSelf = self;
    dispatch_source_set_event_handler(self.stdinSource, ^{
        char tempBuf[1024];
        ssize_t bytesRead = read(STDIN_FILENO, tempBuf, sizeof(tempBuf));
        if (bytesRead <= 0) {
            // EOF or broken pipe -> parent process exited or closed channel
            dispatch_async(dispatch_get_main_queue(), ^{
                [NSApp terminate:nil];
            });
            return;
        }

        NSData *chunk = [NSData dataWithBytes:tempBuf length:(NSUInteger)bytesRead];
        dispatch_async(dispatch_get_main_queue(), ^{
            MenubarAppDelegate *strongSelf = weakSelf;
            if (strongSelf) {
                [strongSelf handleIncomingBytes:chunk.bytes length:chunk.length];
            }
        });
    });

    dispatch_source_set_cancel_handler(self.stdinSource, ^{
        close(STDIN_FILENO);
    });

    dispatch_resume(self.stdinSource);
}

- (void)setupTelemetryFileListener {
    if (_telemetryFilePath.length == 0) {
        return;
    }

    dispatch_queue_t queue = dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0);
    _telemetryFileSource = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, queue);

    __weak typeof(self) weakSelf = self;
    dispatch_source_set_timer(
        _telemetryFileSource,
        dispatch_time(DISPATCH_TIME_NOW, 0),
        250 * NSEC_PER_MSEC,
        50 * NSEC_PER_MSEC
    );
    dispatch_source_set_event_handler(_telemetryFileSource, ^{
        MenubarAppDelegate *strongSelf = weakSelf;
        if (!strongSelf) {
            return;
        }

        NSData *payload = [NSData dataWithContentsOfFile:strongSelf->_telemetryFilePath];
        if (payload.length == 0 || [payload isEqualToData:strongSelf->_lastTelemetryPayload]) {
            return;
        }

        strongSelf->_lastTelemetryPayload = payload;
        dispatch_async(dispatch_get_main_queue(), ^{
            MenubarAppDelegate *mainSelf = weakSelf;
            if (mainSelf) {
                [mainSelf processCommandLineData:payload];
            }
        });
    });

    dispatch_resume(_telemetryFileSource);
}

- (void)handleIncomingBytes:(const char *)bytes length:(NSUInteger)length {
    [_readBuffer appendBytes:bytes length:length];

    const char *bufferBytes = (const char *)_readBuffer.bytes;
    NSUInteger bufferLength = _readBuffer.length;
    NSUInteger lineStart = 0;

    for (NSUInteger i = 0; i < bufferLength; i++) {
        if (bufferBytes[i] == '\n') {
            NSUInteger lineLength = i - lineStart;
            if (lineLength > 0) {
                NSData *lineData = [NSData dataWithBytes:(bufferBytes + lineStart) length:lineLength];
                [self processCommandLineData:lineData];
            }
            lineStart = i + 1;
        }
    }

    if (lineStart > 0) {
        if (lineStart >= bufferLength) {
            _readBuffer.length = 0;
        } else {
            NSData *remaining = [NSData dataWithBytes:(bufferBytes + lineStart) length:(bufferLength - lineStart)];
            _readBuffer = [remaining mutableCopy];
        }
    }
}

- (void)processCommandLineData:(NSData *)lineData {
    NSError *error = nil;
    id json = [NSJSONSerialization JSONObjectWithData:lineData options:0 error:&error];
    if (error || ![json isKindOfClass:[NSDictionary class]]) {
        NSString *raw = [[NSString alloc] initWithData:lineData encoding:NSUTF8StringEncoding];
        if ([raw.lowercaseString isEqualToString:@"quit"]) {
            [NSApp terminate:nil];
        }
        return;
    }

    NSDictionary *dict = (NSDictionary *)json;
    if (dict[@"showIcon"]) {
        self.showIcon = [dict[@"showIcon"] boolValue];
    }
    if (dict[@"showTemp"]) {
        self.showTemp = [dict[@"showTemp"] boolValue];
    }
    if (dict[@"showLoad"]) {
        self.showLoad = [dict[@"showLoad"] boolValue];
    }

    [self refreshMetricStatusItemsWithDictionary:dict];
}

@end

int main(int argc, const char * argv[]) {
    (void)argc;
    (void)argv;
    @autoreleasepool {
        MenubarAppDelegate *delegate = [[MenubarAppDelegate alloc] init];
        if (![delegate acquireSingletonLock]) {
            return 0;
        }

        NSApplication *app = [NSApplication sharedApplication];
        app.delegate = delegate;
        [app run];
    }
    return 0;
}
