#import <Cocoa/Cocoa.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

@interface MenubarAppDelegate : NSObject <NSApplicationDelegate>
@property (strong, nonatomic) NSStatusItem *statusItem;
@property (strong, nonatomic) dispatch_source_t stdinSource;
@property (strong, nonatomic) NSMenuItem *tempMenuItem;
@property (strong, nonatomic) NSMenuItem *loadMenuItem;
@property (strong, nonatomic) NSMenuItem *speedMenuItem;
@property (assign, nonatomic) BOOL showIcon;
@property (assign, nonatomic) BOOL showTemp;
@property (assign, nonatomic) BOOL showLoad;
@end

@implementation MenubarAppDelegate {
    NSMutableData *_readBuffer;
}

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    (void)notification;
    // Set as accessory application (no Dock icon, status bar only)
    [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];

    self.showIcon = YES;
    self.showTemp = YES;
    self.showLoad = YES;
    _readBuffer = [NSMutableData data];

    self.statusItem = [[NSStatusBar systemStatusBar] statusItemWithLength:NSVariableStatusItemLength];
    if (self.statusItem.button) {
        self.statusItem.button.title = @"HWInfoX";
    }

    [self setupMenu];
    [self setupStdinListener];
}

- (void)setupMenu {
    NSMenu *menu = [[NSMenu alloc] initWithTitle:@"HWInfoX Menubar"];

    NSMenuItem *headerItem = [[NSMenuItem alloc] initWithTitle:@"HWInfoX 硬件监控" action:nil keyEquivalent:@""];
    [headerItem setEnabled:NO];
    [menu addItem:headerItem];

    [menu addItem:[NSMenuItem separatorItem]];

    self.tempMenuItem = [[NSMenuItem alloc] initWithTitle:@"CPU 温度: --" action:nil keyEquivalent:@""];
    [self.tempMenuItem setEnabled:NO];
    [menu addItem:self.tempMenuItem];

    self.loadMenuItem = [[NSMenuItem alloc] initWithTitle:@"CPU 负载: --" action:nil keyEquivalent:@""];
    [self.loadMenuItem setEnabled:NO];
    [menu addItem:self.loadMenuItem];

    self.speedMenuItem = [[NSMenuItem alloc] initWithTitle:@"CPU 频率: --" action:nil keyEquivalent:@""];
    [self.speedMenuItem setEnabled:NO];
    [menu addItem:self.speedMenuItem];

    [menu addItem:[NSMenuItem separatorItem]];

    NSMenuItem *openItem = [[NSMenuItem alloc] initWithTitle:@"打开主界面" action:@selector(openMainApp) keyEquivalent:@"o"];
    openItem.target = self;
    [menu addItem:openItem];

    [menu addItem:[NSMenuItem separatorItem]];

    NSMenuItem *quitItem = [[NSMenuItem alloc] initWithTitle:@"退出菜单栏" action:@selector(quitApp) keyEquivalent:@"q"];
    quitItem.target = self;
    [menu addItem:quitItem];

    self.statusItem.menu = menu;
}

- (void)openMainApp {
    // Bring uTools or system default handler to front
    NSURL *url = [NSURL URLWithString:@"utools://"];
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

        dispatch_async(dispatch_get_main_queue(), ^{
            [weakSelf handleIncomingBytes:tempBuf length:(NSUInteger)bytesRead];
        });
    });

    dispatch_source_set_cancel_handler(self.stdinSource, ^{
        close(STDIN_FILENO);
    });

    dispatch_resume(self.stdinSource);
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

    NSNumber *tempNum = dict[@"temp"];
    NSNumber *loadNum = dict[@"load"];
    NSNumber *speedNum = dict[@"speed"];

    NSMutableArray<NSString *> *titleParts = [NSMutableArray array];

    if (self.showIcon) {
        [titleParts addObject:@"🔥"];
    }

    if (self.showTemp && tempNum && ![tempNum isKindOfClass:[NSNull class]]) {
        double temp = [tempNum doubleValue];
        [titleParts addObject:[NSString stringWithFormat:@"%.0f°C", temp]];
        self.tempMenuItem.title = [NSString stringWithFormat:@"CPU 温度: %.1f°C", temp];
    }

    if (self.showLoad && loadNum && ![loadNum isKindOfClass:[NSNull class]]) {
        double load = [loadNum doubleValue];
        [titleParts addObject:[NSString stringWithFormat:@"%.0f%%", load]];
        self.loadMenuItem.title = [NSString stringWithFormat:@"CPU 负载: %.1f%%", load];
    }

    if (speedNum && ![speedNum isKindOfClass:[NSNull class]]) {
        double speed = [speedNum doubleValue];
        self.speedMenuItem.title = [NSString stringWithFormat:@"CPU 频率: %.2f GHz", speed];
    }

    if (self.statusItem.button) {
        if (titleParts.count > 0) {
            self.statusItem.button.title = [titleParts componentsJoinedByString:@" "];
        } else {
            self.statusItem.button.title = @"HWInfoX";
        }
    }
}

@end

int main(int argc, const char * argv[]) {
    (void)argc;
    (void)argv;
    @autoreleasepool {
        NSApplication *app = [NSApplication sharedApplication];
        MenubarAppDelegate *delegate = [[MenubarAppDelegate alloc] init];
        app.delegate = delegate;
        [app run];
    }
    return 0;
}
