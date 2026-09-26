#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
#include <sys/stat.h>

static const CGFloat kDefaultWindowSize = 896;
static const CGFloat kMinWindowWidth = 160;
static const CGFloat kMinWindowHeight = 103;
static const CGFloat kFitWindowMinHeight = 0;
static const CGFloat kCompactWindowWidth = 560;
static const CGFloat kMiniWindowWidth = 384;
static const CGFloat kMiniWindowHeight = 600;
static const CGFloat kMenuIconSize = 18;

@interface AWWindow : NSWindow
@end

@implementation AWWindow
- (BOOL)hasKeyAppearance { return YES; }
@end

@interface AWApp : NSObject <NSApplicationDelegate, NSWindowDelegate, WKScriptMessageHandlerWithReply, WKUIDelegate>
@property (strong) AWWindow *window;
@property (strong) WKWebView *webView;
@property (strong) NSGlassEffectView *glass;
@property CGFloat glassCornerRadius;
@end

static NSString *AgentBaseName(NSString *name) {
    NSString *lower = name.lowercaseString;
    NSRange dash = [lower rangeOfString:@"-" options:NSBackwardsSearch];
    if (dash.location == NSNotFound) return lower;
    NSString *suffix = [lower substringFromIndex:dash.location + 1];
    if (suffix.length == 0) return lower;
    NSCharacterSet *nonDigits = NSCharacterSet.decimalDigitCharacterSet.invertedSet;
    if ([suffix rangeOfCharacterFromSet:nonDigits].location != NSNotFound) return lower;
    return [lower substringToIndex:dash.location];
}

static NSString *ArrowKey(unichar key) {
    return [NSString stringWithCharacters:&key length:1];
}

static NSImage *MenuImage(NSImage *image) {
    image.size = NSMakeSize(kMenuIconSize, kMenuIconSize);
    return image;
}

static NSImage *RgbaImage(NSArray<NSNumber *> *rgba) {
    NSInteger side = (NSInteger)sqrt(rgba.count / 4);
    NSBitmapImageRep *rep = [[NSBitmapImageRep alloc]
        initWithBitmapDataPlanes:NULL pixelsWide:side pixelsHigh:side bitsPerSample:8 samplesPerPixel:4
        hasAlpha:YES isPlanar:NO colorSpaceName:NSDeviceRGBColorSpace
        bitmapFormat:NSBitmapFormatAlphaNonpremultiplied bytesPerRow:side * 4 bitsPerPixel:32];
    unsigned char *data = rep.bitmapData;
    for (NSUInteger i = 0; i < (NSUInteger)(side * side * 4); i++) data[i] = rgba[i].unsignedCharValue;
    NSImage *image = [[NSImage alloc] initWithSize:NSMakeSize(side, side)];
    [image addRepresentation:rep];
    return MenuImage(image);
}

@implementation AWApp

#pragma mark Menus

- (NSMenuItem *)item:(NSString *)title payload:(NSDictionary *)payload key:(NSString *)key mods:(NSEventModifierFlags)mods {
    NSMenuItem *item = [[NSMenuItem alloc] initWithTitle:title action:@selector(menuAction:) keyEquivalent:key ?: @""];
    item.keyEquivalentModifierMask = mods;
    item.target = self;
    item.representedObject = payload;
    return item;
}

- (NSMenuItem *)action:(NSString *)action title:(NSString *)title key:(NSString *)key mods:(NSEventModifierFlags)mods {
    return [self item:title payload:@{ @"action": action } key:key mods:mods];
}

- (NSMenuItem *)submenu:(NSString *)title items:(NSArray<NSMenuItem *> *)items {
    NSMenu *menu = [[NSMenu alloc] initWithTitle:title];
    menu.autoenablesItems = NO;
    for (NSMenuItem *item in items) [menu addItem:item];
    NSMenuItem *holder = [[NSMenuItem alloc] initWithTitle:title action:nil keyEquivalent:@""];
    holder.submenu = menu;
    return holder;
}

- (void)setImage:(NSImage *)image on:(NSMenuItem *)item {
    item.image = image;
    if (@available(macOS 27.0, *)) item.preferredImageVisibility = NSMenuItemImageVisibilityVisible;
}

- (void)popUp:(NSArray<NSMenuItem *> *)items at:(NSDictionary *)payload {
    NSMenu *menu = [[NSMenu alloc] initWithTitle:@""];
    menu.autoenablesItems = NO;
    for (NSMenuItem *item in items) [menu addItem:item];
    NSView *view = self.window.contentView;
    CGFloat x = [payload[@"x"] doubleValue];
    CGFloat y = [payload[@"y"] doubleValue];
    [menu popUpMenuPositioningItem:nil atLocation:NSMakePoint(x, view.frame.size.height - y) inView:view];
}

- (void)menuAction:(NSMenuItem *)sender {
    NSData *json = [NSJSONSerialization dataWithJSONObject:sender.representedObject options:0 error:nil];
    NSString *detail = [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding];
    NSString *script = [NSString stringWithFormat:@"window.dispatchEvent(new CustomEvent('native-menu-action', { detail: %@ }));", detail];
    [self.webView evaluateJavaScript:script completionHandler:nil];
}

- (void)showChatHeaderMenu:(NSDictionary *)p {
    BOOL active = [p[@"sessionActive"] boolValue];
    NSDictionary *icons = p[@"agentIcons"] ?: @{};
    NSMenuItem *(^agentItem)(NSString *, NSString *) = ^NSMenuItem *(NSString *mode, NSString *agent) {
        NSMenuItem *item = [self item:agent payload:@{ @"action": @"agent", @"mode": mode, @"agent": agent } key:nil mods:0];
        NSArray *rgba = icons[AgentBaseName(agent)];
        [self setImage:(rgba ? RgbaImage(rgba) : MenuImage([NSImage imageNamed:NSImageNameUser])) on:item];
        return item;
    };
    NSMutableArray *add = [NSMutableArray array];
    for (NSString *agent in p[@"addAgents"]) [add addObject:agentItem(@"add", agent)];
    NSMutableArray *remove = [NSMutableArray array];
    for (NSString *agent in p[@"removeAgents"]) [remove addObject:agentItem(@"remove", agent)];
    NSMenuItem *addMenu = [self submenu:@"Add Agent" items:add];
    addMenu.enabled = active && add.count > 0;
    [self setImage:MenuImage([NSImage imageNamed:NSImageNameAddTemplate]) on:addMenu];
    NSMenuItem *removeMenu = [self submenu:@"Remove Agent" items:remove];
    removeMenu.enabled = active && remove.count > 0;
    [self setImage:MenuImage([NSImage imageNamed:NSImageNameRemoveTemplate]) on:removeMenu];

    NSEventModifierFlags cmd = NSEventModifierFlagCommand, opt = NSEventModifierFlagOption;
    NSMenuItem *shell = [self action:@"openShell" title:@"Terminal" key:@"t" mods:cmd];
    [self setImage:MenuImage([NSWorkspace.sharedWorkspace iconForFile:@"/System/Applications/Utilities/Terminal.app"]) on:shell];
    NSMenuItem *finder = [self action:@"openFinder" title:@"Finder" key:@"r" mods:cmd | opt];
    [self setImage:MenuImage([NSWorkspace.sharedWorkspace iconForFile:@"/System/Library/CoreServices/Finder.app"]) on:finder];

    [self popUp:@[
        addMenu, removeMenu, NSMenuItem.separatorItem,
        shell, finder, NSMenuItem.separatorItem,
        [self action:@"openTerminal" title:@"tmux window" key:@"t" mods:cmd | opt],
        [self action:@"revealLog" title:@"Reveal Log" key:@"l" mods:cmd | opt],
        [self action:@"openInBrowser" title:@"Open in Browser" key:@"o" mods:cmd | opt],
    ] at:p];
}

- (void)showAppearanceMenu:(NSDictionary *)p {
    NSEventModifierFlags cmd = NSEventModifierFlagCommand, opt = NSEventModifierFlagOption, shift = NSEventModifierFlagShift;
    NSString *theme = p[@"themeDesktop"];
    NSMutableArray *themes = [NSMutableArray array];
    for (NSArray *pair in @[ @[ @"system", @"System" ], @[ @"light", @"Light" ], @[ @"dark", @"Dark" ] ]) {
        NSMenuItem *item = [self item:pair[1] payload:@{ @"action": @"theme", @"theme": pair[0] } key:nil mods:0];
        item.state = [theme isEqualToString:pair[0]] ? NSControlStateValueOn : NSControlStateValueOff;
        [themes addObject:item];
    }
    NSMenuItem *actualSize = [self item:@"Actual Size" payload:@{ @"action": @"textSize", @"mode": @"actual" } key:@"0" mods:cmd];
    actualSize.enabled = [p[@"textSize"] integerValue] != [p[@"textSizeDefault"] integerValue];
    BOOL rightPane = [p[@"rightPaneAvailable"] boolValue];
    NSMenuItem *rightPaneItem = [self action:@"toggleRightPane" title:@"Toggle Right Pane" key:@"e" mods:cmd];
    rightPaneItem.enabled = rightPane;
    NSMenuItem *rightPaneOutward = [self action:@"toggleRightPaneOutward" title:@"Toggle Right Pane Outward" key:@"e" mods:cmd | opt];
    rightPaneOutward.enabled = rightPane;
    NSMenuItem *alwaysOnTop = [self action:@"toggleAlwaysOnTop" title:@"Always on Top" key:@"p" mods:cmd | opt];
    alwaysOnTop.state = [p[@"alwaysOnTop"] boolValue] ? NSControlStateValueOn : NSControlStateValueOff;
    BOOL fit = [p[@"autoWindowHeight"] boolValue];
    NSMenuItem *fitHeight = [self action:@"toggleAutoWindowHeight" title:@"Fit Height to Message" key:@"h" mods:cmd | opt];
    fitHeight.state = fit ? NSControlStateValueOn : NSControlStateValueOff;
    NSMenuItem *fitCollapsed = [self action:@"toggleFitCollapsed" title:@"Collapse Fit Window" key:@"m" mods:cmd | opt];
    fitCollapsed.state = [p[@"fitCollapsed"] boolValue] ? NSControlStateValueOn : NSControlStateValueOff;
    fitCollapsed.enabled = fit;

    [self popUp:@[
        [self submenu:@"Theme" items:themes],
        NSMenuItem.separatorItem,
        actualSize,
        [self item:@"Zoom In" payload:@{ @"action": @"textSize", @"mode": @"increase" } key:@"=" mods:cmd],
        [self item:@"Zoom Out" payload:@{ @"action": @"textSize", @"mode": @"decrease" } key:@"-" mods:cmd],
        NSMenuItem.separatorItem,
        [self submenu:@"Window Presets" items:@[
            [self action:@"resetWindow" title:@"Default Window" key:@"0" mods:cmd | opt],
            [self action:@"compactWindow" title:@"Compact Window" key:@"9" mods:cmd | opt],
            [self action:@"miniWindow" title:@"Mini Window" key:@"8" mods:cmd | opt],
        ]],
        [self submenu:@"Move Window" items:@[
            [self action:@"moveWindowTop" title:@"Move to Top" key:ArrowKey(NSUpArrowFunctionKey) mods:cmd | opt],
            [self action:@"moveWindowTopLeft" title:@"Move to Left" key:ArrowKey(NSLeftArrowFunctionKey) mods:cmd | opt],
            [self action:@"moveWindowTopRight" title:@"Move to Right" key:ArrowKey(NSRightArrowFunctionKey) mods:cmd | opt],
            [self action:@"moveWindowCenter" title:@"Move to Center" key:ArrowKey(NSDownArrowFunctionKey) mods:cmd | opt],
        ]],
        [self submenu:@"Side Panels" items:@[
            [self action:@"toggleHubSidebar" title:@"Toggle Hub Sidebar" key:@"b" mods:cmd],
            rightPaneItem,
            [self action:@"toggleHubSidebarOutward" title:@"Toggle Hub Sidebar Outward" key:@"b" mods:cmd | opt],
            rightPaneOutward,
        ]],
        [self submenu:@"Messages" items:@[
            [self action:@"messagePrevious" title:@"Previous Message" key:ArrowKey(NSUpArrowFunctionKey) mods:opt],
            [self action:@"messageNext" title:@"Next Message" key:ArrowKey(NSDownArrowFunctionKey) mods:opt],
            [self action:@"messageJumpTop" title:@"Jump to Top" key:ArrowKey(NSUpArrowFunctionKey) mods:cmd],
            [self action:@"messageJumpBottom" title:@"Jump to Bottom" key:ArrowKey(NSDownArrowFunctionKey) mods:cmd],
        ]],
        alwaysOnTop, fitHeight, fitCollapsed,
        NSMenuItem.separatorItem,
        [self action:@"openHubInBrowser" title:@"Open in Browser" key:@"o" mods:cmd | opt | shift],
    ] at:p];
}

- (void)showListMenu:(NSDictionary *)p action:(NSString *)action checks:(BOOL)checks {
    NSMutableArray *items = [NSMutableArray array];
    [p[@"items"] enumerateObjectsUsingBlock:^(NSDictionary *entry, NSUInteger index, BOOL *stop) {
        if ([entry[@"section"] boolValue]) {
            NSMenuItem *label = [[NSMenuItem alloc] initWithTitle:entry[@"label"] action:nil keyEquivalent:@""];
            label.enabled = NO;
            [items addObject:label];
            return;
        }
        NSMenuItem *item = [self item:entry[@"label"] payload:@{ @"action": action, @"mode": [NSString stringWithFormat:@"%lu", (unsigned long)index] } key:nil mods:0];
        if (checks && [entry[@"current"] boolValue]) item.state = NSControlStateValueOn;
        [items addObject:item];
    }];
    [self popUp:items at:p];
}

- (void)showFileContextMenu:(NSDictionary *)p {
    NSEventModifierFlags cmd = NSEventModifierFlagCommand, opt = NSEventModifierFlagOption, shift = NSEventModifierFlagShift;
    NSMutableArray *items = [NSMutableArray array];
    if ([p[@"openFile"] boolValue]) [items addObject:[self action:@"openFile" title:@"Open Current File" key:@"o" mods:cmd]];
    [items addObjectsFromArray:@[
        [self action:@"quickLook" title:@"Quick Look" key:@"y" mods:cmd],
        [self action:@"revealFileInFinder" title:@"Reveal in Finder" key:@"r" mods:cmd | opt],
        NSMenuItem.separatorItem,
        [self action:@"copyFiles" title:@"Copy" key:@"c" mods:cmd],
        [self action:@"copyAbsoluteFilePath" title:@"Copy Absolute Path" key:@"c" mods:cmd | opt],
        [self action:@"copyRelativeFilePath" title:@"Copy Relative Path" key:@"c" mods:cmd | opt | shift],
    ]];
    [self popUp:items at:p];
}

- (void)showCommitContextMenu:(NSDictionary *)p {
    [self popUp:@[
        [self action:@"copyCommitHash" title:@"Copy Commit Hash" key:nil mods:0],
        [self action:@"copyCommitMessage" title:@"Copy Commit Message" key:nil mods:0],
    ] at:p];
}

- (void)showSessionContextMenu:(NSDictionary *)p {
    NSMenuItem *(^gated)(NSString *, NSString *, NSString *) = ^NSMenuItem *(NSString *action, NSString *title, NSString *flag) {
        NSMenuItem *item = [self action:action title:title key:nil mods:0];
        item.enabled = [p[flag] boolValue];
        return item;
    };
    [self popUp:@[
        [self action:@"renameSession" title:@"Rename" key:nil mods:0],
        NSMenuItem.separatorItem,
        [self action:@"copyWorkspacePath" title:@"Copy Workspace Path" key:nil mods:0],
        NSMenuItem.separatorItem,
        gated(@"changeWorkspace", @"Change Workspace", @"changeWorkspaceEnabled"),
        gated(@"resetAgents", @"Reset Agents", @"resetAgentsEnabled"),
        NSMenuItem.separatorItem,
        gated(@"archiveSession", @"Archive", @"archiveEnabled"),
        gated(@"reviveSession", @"Revive", @"reviveEnabled"),
        gated(@"deleteSession", @"Delete", @"deleteEnabled"),
    ] at:p];
}

#pragma mark Window geometry

- (NSRect)screenFrame {
    return (self.window.screen ?: NSScreen.mainScreen).frame;
}

- (NSString *)placeCentered:(CGFloat)width height:(CGFloat)height scale:(double)scale {
    if (!isfinite(scale) || scale <= 0) return @"preset scale must be positive and finite";
    width *= scale;
    height *= scale;
    NSRect screen = [self screenFrame];
    NSRect frame = NSMakeRect(screen.origin.x + MAX(0, (screen.size.width - width) / 2),
                              screen.origin.y + MAX(0, (screen.size.height - height) / 2), width, height);
    [self.window setFrame:frame display:YES];
    return nil;
}

- (NSString *)setWindowHeight:(double)height compactWidthScale:(NSNumber *)compact {
    NSRect screen = [self screenFrame];
    NSRect frame = self.window.frame;
    CGFloat top = NSMaxY(frame);
    CGFloat h = MIN(MAX(height, kFitWindowMinHeight), screen.size.height);
    if (compact) {
        double scale = compact.doubleValue;
        if (!isfinite(scale) || scale <= 0) return @"preset scale must be positive and finite";
        frame.size.width = MIN(kCompactWindowWidth * scale, screen.size.width);
        frame.origin.x = screen.origin.x + MAX(0, (screen.size.width - frame.size.width) / 2);
    }
    top = MIN(top, NSMaxY(screen));
    top = MAX(top, NSMinY(screen) + h);
    frame.size.height = h;
    frame.origin.y = top - h;
    [self.window setFrame:frame display:YES];
    return nil;
}

- (NSString *)resizeFromEdge:(NSString *)edge delta:(double)delta {
    if (!isfinite(delta) || delta == 0) return @"window width delta must be a non-zero finite number";
    NSRect frame = self.window.frame;
    CGFloat next = frame.size.width + delta;
    if (next < kMinWindowWidth) return [NSString stringWithFormat:@"window width would fall below the minimum (%g)", kMinWindowWidth];
    if ([edge isEqualToString:@"left"]) frame.origin.x -= delta;
    else if (![edge isEqualToString:@"right"]) return [NSString stringWithFormat:@"unsupported window edge: %@", edge];
    frame.size.width = next;
    [self.window setFrame:frame display:YES];
    return nil;
}

- (NSString *)scaleFromTopCenter:(double)scale cornerRadius:(double)radius {
    if (!isfinite(scale) || scale <= 0) return @"window scale must be a positive finite number";
    NSRect frame = self.window.frame;
    CGFloat width = frame.size.width * scale, height = frame.size.height * scale;
    NSSize minimum = self.window.contentMinSize;
    if (width < minimum.width || height < minimum.height)
        return [NSString stringWithFormat:@"scaled window would fall below the minimum (%g x %g)", minimum.width, minimum.height];
    frame.origin.x -= (width - frame.size.width) / 2;
    frame.origin.y -= height - frame.size.height;
    frame.size = NSMakeSize(width, height);
    [NSAnimationContext runAnimationGroup:^(NSAnimationContext *context) {
        context.duration = [self.window animationResizeTime:frame];
        [self.window.animator setFrame:frame display:YES];
    }];
    if (isfinite(radius) && radius > 0) {
        self.glassCornerRadius = MIN(MAX(round(radius), 4), 80);
        [self applyGlass];
    }
    return nil;
}

- (void)moveTo:(NSString *)spot {
    NSScreen *screen = self.window.screen ?: NSScreen.mainScreen;
    NSRect full = screen.frame;
    NSRect frame = self.window.frame;
    if ([spot isEqualToString:@"top"]) frame.origin.y = NSMaxY(screen.visibleFrame) - frame.size.height;
    else if ([spot isEqualToString:@"left"]) frame.origin.x = full.origin.x;
    else if ([spot isEqualToString:@"right"]) frame.origin.x = full.origin.x + MAX(0, full.size.width - frame.size.width);
    else {
        frame.origin.x = full.origin.x + MAX(0, (full.size.width - frame.size.width) / 2);
        frame.origin.y = full.origin.y + MAX(0, (full.size.height - frame.size.height) / 2);
    }
    [self.window setFrameOrigin:frame.origin];
}

#pragma mark Native commands

- (NSString *)openExternalURL:(NSString *)raw {
    NSURL *url = [NSURL URLWithString:raw];
    NSString *scheme = url.scheme.lowercaseString;
    if (!url || !([scheme isEqualToString:@"http"] || [scheme isEqualToString:@"https"]) || url.host.length == 0)
        return @"external URL must be an absolute http or https URL";
    return [NSWorkspace.sharedWorkspace openURL:url] ? nil : @"macOS URL opener failed";
}

- (NSString *)copyFiles:(NSArray<NSString *> *)paths {
    if (paths.count == 0) return @"No files selected";
    NSMutableArray *urls = [NSMutableArray array];
    for (NSString *path in paths) {
        if (!path.isAbsolutePath) return [NSString stringWithFormat:@"Not an absolute file path: %@", path];
        struct stat info;
        if (lstat(path.fileSystemRepresentation, &info) != 0)
            return [NSString stringWithFormat:@"Cannot copy %@: %s", path, strerror(errno)];
        [urls addObject:[NSURL fileURLWithPath:path]];
    }
    NSPasteboard *pasteboard = NSPasteboard.generalPasteboard;
    [pasteboard clearContents];
    return [pasteboard writeObjects:urls] ? nil : @"Failed to copy files to clipboard";
}

- (NSString *)run:(NSString *)cmd args:(NSDictionary *)a {
    NSDictionary *p = a[@"payload"];
    if ([cmd isEqualToString:@"open_external_url"]) return [self openExternalURL:a[@"url"]];
    if ([cmd isEqualToString:@"copy_files_to_clipboard"]) return [self copyFiles:a[@"paths"]];
    if ([cmd isEqualToString:@"show_chat_header_menu"]) { [self showChatHeaderMenu:p]; return nil; }
    if ([cmd isEqualToString:@"show_appearance_menu"]) { [self showAppearanceMenu:p]; return nil; }
    if ([cmd isEqualToString:@"show_session_switcher_menu"]) { [self showListMenu:p action:@"switchSession" checks:YES]; return nil; }
    if ([cmd isEqualToString:@"show_git_changes_menu"]) { [self showListMenu:p action:@"gitChange" checks:NO]; return nil; }
    if ([cmd isEqualToString:@"show_file_context_menu"]) { [self showFileContextMenu:p]; return nil; }
    if ([cmd isEqualToString:@"show_commit_context_menu"]) { [self showCommitContextMenu:p]; return nil; }
    if ([cmd isEqualToString:@"show_session_context_menu"]) { [self showSessionContextMenu:p]; return nil; }
    if ([cmd isEqualToString:@"reset_window_geometry"]) return [self placeCentered:kDefaultWindowSize height:kDefaultWindowSize scale:[a[@"scale"] doubleValue]];
    if ([cmd isEqualToString:@"compact_window_geometry"]) return [self placeCentered:kCompactWindowWidth height:kDefaultWindowSize scale:[a[@"scale"] doubleValue]];
    if ([cmd isEqualToString:@"mini_window_geometry"]) return [self placeCentered:kMiniWindowWidth height:kMiniWindowHeight scale:[a[@"scale"] doubleValue]];
    if ([cmd isEqualToString:@"set_window_height"]) {
        NSNumber *compact = a[@"compactWidthScale"] == NSNull.null ? nil : a[@"compactWidthScale"];
        return [self setWindowHeight:[a[@"height"] doubleValue] compactWidthScale:compact];
    }
    if ([cmd isEqualToString:@"resize_window_from_edge"]) return [self resizeFromEdge:a[@"edge"] delta:[a[@"delta"] doubleValue]];
    if ([cmd isEqualToString:@"scale_window_from_top_center"]) return [self scaleFromTopCenter:[a[@"scale"] doubleValue] cornerRadius:[a[@"cornerRadius"] doubleValue]];
    if ([cmd isEqualToString:@"move_window_top"]) { [self moveTo:@"top"]; return nil; }
    if ([cmd isEqualToString:@"move_window_top_left"]) { [self moveTo:@"left"]; return nil; }
    if ([cmd isEqualToString:@"move_window_top_right"]) { [self moveTo:@"right"]; return nil; }
    if ([cmd isEqualToString:@"move_window_center"]) { [self moveTo:@"center"]; return nil; }
    if ([cmd isEqualToString:@"set_always_on_top"]) { self.window.level = [a[@"on"] boolValue] ? NSFloatingWindowLevel : NSNormalWindowLevel; return nil; }
    if ([cmd isEqualToString:@"set_fit_height_min"]) {
        self.window.contentMinSize = NSMakeSize(kMinWindowWidth, [a[@"enabled"] boolValue] ? kFitWindowMinHeight : kMinWindowHeight);
        return nil;
    }
    if ([cmd isEqualToString:@"start_dragging"]) { [self.window performWindowDragWithEvent:NSApp.currentEvent]; return nil; }
    if ([cmd isEqualToString:@"close_window"]) { [self hideApp]; return nil; }
    if ([cmd isEqualToString:@"minimize_window"]) { [self.window miniaturize:nil]; return nil; }
    if ([cmd isEqualToString:@"toggle_maximize_window"]) { [self.window zoom:nil]; return nil; }
    return [NSString stringWithFormat:@"unknown native command: %@", cmd];
}

- (void)userContentController:(WKUserContentController *)controller didReceiveScriptMessage:(WKScriptMessage *)message
                 replyHandler:(void (^)(id, NSString *))replyHandler {
    NSString *host = message.frameInfo.securityOrigin.host;
    if (!message.frameInfo.isMainFrame || !([host isEqualToString:@"127.0.0.1"] || [host isEqualToString:@"localhost"])) {
        replyHandler(nil, @"native commands are only accepted from the Hub page");
        return;
    }
    NSDictionary *body = message.body;
    replyHandler(nil, [self run:body[@"cmd"] args:body[@"args"] ?: @{}]);
}

#pragma mark Web view

- (void)webView:(WKWebView *)webView runOpenPanelWithParameters:(WKOpenPanelParameters *)parameters
    initiatedByFrame:(WKFrameInfo *)frame completionHandler:(void (^)(NSArray<NSURL *> *))completionHandler {
    NSOpenPanel *panel = NSOpenPanel.openPanel;
    panel.allowsMultipleSelection = parameters.allowsMultipleSelection;
    panel.canChooseDirectories = parameters.allowsDirectories;
    [panel beginSheetModalForWindow:self.window completionHandler:^(NSModalResponse result) {
        completionHandler(result == NSModalResponseOK ? panel.URLs : nil);
    }];
}

- (void)showHubError:(NSString *)message {
    NSData *json = [NSJSONSerialization dataWithJSONObject:@[ message ] options:0 error:nil];
    NSString *quoted = [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding];
    NSString *script = [NSString stringWithFormat:
        @"document.body.style.cssText='background:transparent;color:#fff;text-shadow:0 1px 4px rgba(0,0,0,0.9);box-sizing:border-box;height:100%%;display:flex;align-items:center;justify-content:center;padding:40px;font:13px ui-monospace,monospace;white-space:pre-wrap;overflow:auto';document.body.textContent=%@[0];",
        quoted];
    [self.webView evaluateJavaScript:script completionHandler:nil];
    [self.window makeKeyAndOrderFront:nil];
}

#pragma mark Glass

- (void)applyGlass {
    BOOL light = [self.window.effectiveAppearance bestMatchFromAppearancesWithNames:@[ NSAppearanceNameAqua, NSAppearanceNameDarkAqua ]] == NSAppearanceNameAqua;
    self.glass.cornerRadius = self.glassCornerRadius;
    self.glass.tintColor = light ? nil : [NSColor colorWithRed:0 green:0 blue:0 alpha:97.0 / 255.0];
}

- (void)observeValueForKeyPath:(NSString *)keyPath ofObject:(id)object change:(NSDictionary *)change context:(void *)context {
    [self applyGlass];
}

#pragma mark Hub startup

static BOOL WaitForExit(NSTask *task, NSTimeInterval timeout) {
    NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:timeout];
    while (task.running) {
        if (deadline.timeIntervalSinceNow <= 0) {
            [task terminate];
            return NO;
        }
        [NSThread sleepForTimeInterval:0.05];
    }
    return task.terminationStatus == 0;
}

static NSString *LoginShellPath(NSString **error) {
    NSTask *task = [NSTask new];
    task.executableURL = [NSURL fileURLWithPath:@"/bin/zsh"];
    task.arguments = @[ @"-lic", @"print -r -- $PATH" ];
    NSPipe *pipe = [NSPipe pipe];
    task.standardInput = NSFileHandle.fileHandleWithNullDevice;
    task.standardOutput = pipe;
    task.standardError = NSFileHandle.fileHandleWithNullDevice;
    if (![task launchAndReturnError:nil] || !WaitForExit(task, 5)) {
        *error = @"Failed to read shell PATH.";
        return nil;
    }
    NSData *data = [pipe.fileHandleForReading readDataToEndOfFile];
    NSString *path = [[[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding]
        stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
    if (path.length == 0 || [path containsString:@"\n"]) {
        *error = @"Failed to read shell PATH.";
        return nil;
    }
    return path;
}

static BOOL HubReady(NSInteger port) {
    NSTask *task = [NSTask new];
    task.executableURL = [NSURL fileURLWithPath:@"/usr/bin/curl"];
    task.arguments = @[ @"-sf", @"--max-time", @"1", [NSString stringWithFormat:@"http://127.0.0.1:%ld/hub.webmanifest", (long)port] ];
    NSPipe *pipe = [NSPipe pipe];
    task.standardOutput = pipe;
    task.standardError = NSFileHandle.fileHandleWithNullDevice;
    if (![task launchAndReturnError:nil]) return NO;
    NSData *data = [pipe.fileHandleForReading readDataToEndOfFile];
    [task waitUntilExit];
    if (task.terminationStatus != 0) return NO;
    NSString *body = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    return [body containsString:@"\"name\": \"Agent Window\""];
}

- (void)startHub {
    void (^fail)(NSString *) = ^(NSString *message) {
        dispatch_async(dispatch_get_main_queue(), ^{ [self showHubError:message]; });
    };
    NSString *root = @AW_REPO_ROOT;
    if (![NSFileManager.defaultManager fileExistsAtPath:[root stringByAppendingPathComponent:@"bin/hub"]]) {
        fail(@"Could not find the Agent Window repo.");
        return;
    }
    NSString *portFile = [root stringByAppendingPathComponent:@"hub-port"];
    NSError *readError = nil;
    NSString *raw = [NSString stringWithContentsOfFile:portFile encoding:NSUTF8StringEncoding error:&readError];
    if (!raw) {
        fail([NSString stringWithFormat:@"Could not read %@: %@", portFile, readError.localizedDescription]);
        return;
    }
    NSString *trimmed = [raw stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
    NSInteger port = trimmed.integerValue;
    if (port <= 0 || port > 65535 || ![[NSString stringWithFormat:@"%ld", (long)port] isEqualToString:trimmed]) {
        fail([NSString stringWithFormat:@"%@ does not contain a valid port", portFile]);
        return;
    }
    if (!HubReady(port)) {
        NSString *pathError = nil;
        NSString *path = LoginShellPath(&pathError);
        if (!path) {
            fail(pathError);
            return;
        }
        NSTask *hub = [NSTask new];
        hub.executableURL = [NSURL fileURLWithPath:[root stringByAppendingPathComponent:@"bin/hub"]];
        hub.currentDirectoryURL = [NSURL fileURLWithPath:root];
        NSMutableDictionary *env = [NSProcessInfo.processInfo.environment mutableCopy];
        env[@"PATH"] = path;
        env[@"PYTHONPATH"] = root;
        hub.environment = env;
        hub.standardOutput = NSFileHandle.fileHandleWithNullDevice;
        NSPipe *stderrPipe = [NSPipe pipe];
        hub.standardError = stderrPipe;
        NSError *launchError = nil;
        if (![hub launchAndReturnError:&launchError]) {
            fail([NSString stringWithFormat:@"Failed to start Hub: %@", launchError.localizedDescription]);
            return;
        }
        if (!WaitForExit(hub, 8)) {
            NSData *detail = [stderrPipe.fileHandleForReading readDataToEndOfFile];
            NSString *text = [[[NSString alloc] initWithData:detail encoding:NSUTF8StringEncoding]
                stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
            fail([NSString stringWithFormat:@"Hub failed to start on port %ld\n\n%@", (long)port, text]);
            return;
        }
    }
    NSURL *url = [NSURL URLWithString:[NSString stringWithFormat:@"http://127.0.0.1:%ld/", (long)port]];
    dispatch_async(dispatch_get_main_queue(), ^{
        [self.webView loadRequest:[NSURLRequest requestWithURL:url]];
        [self.window makeKeyAndOrderFront:nil];
    });
}

#pragma mark App lifecycle

- (void)hideApp {
    [self.window orderOut:nil];
    [NSApp hide:nil];
}

- (BOOL)windowShouldClose:(NSWindow *)sender {
    [self hideApp];
    return NO;
}

- (void)windowDidBecomeKey:(NSNotification *)notification {
    [self.glass setNeedsDisplay:YES];
}

- (BOOL)applicationShouldHandleReopen:(NSApplication *)sender hasVisibleWindows:(BOOL)visible {
    if (!visible) {
        [NSApp unhide:nil];
        if (self.window.miniaturized) [self.window deminiaturize:nil];
        [self.window makeKeyAndOrderFront:nil];
        [NSApp activate];
    }
    return YES;
}

- (void)buildMainMenu {
    NSString *name = @"Agent Window";
    NSEventModifierFlags cmd = NSEventModifierFlagCommand;
    NSMenu *bar = [NSMenu new];

    NSMenu *app = [[NSMenu alloc] initWithTitle:name];
    [app addItemWithTitle:[@"About " stringByAppendingString:name] action:@selector(orderFrontStandardAboutPanel:) keyEquivalent:@""];
    [app addItem:NSMenuItem.separatorItem];
    NSMenuItem *services = [app addItemWithTitle:@"Services" action:nil keyEquivalent:@""];
    services.submenu = [NSMenu new];
    NSApp.servicesMenu = services.submenu;
    [app addItem:NSMenuItem.separatorItem];
    [app addItemWithTitle:[@"Hide " stringByAppendingString:name] action:@selector(hide:) keyEquivalent:@"h"];
    [app addItemWithTitle:@"Hide Others" action:@selector(hideOtherApplications:) keyEquivalent:@"h"].keyEquivalentModifierMask = cmd | NSEventModifierFlagOption;
    [app addItem:NSMenuItem.separatorItem];
    [app addItemWithTitle:[@"Quit " stringByAppendingString:name] action:@selector(terminate:) keyEquivalent:@"q"];

    NSMenu *file = [[NSMenu alloc] initWithTitle:@"File"];
    [file addItemWithTitle:@"Close Window" action:@selector(performClose:) keyEquivalent:@"w"];

    NSMenu *edit = [[NSMenu alloc] initWithTitle:@"Edit"];
    [edit addItemWithTitle:@"Undo" action:@selector(undo:) keyEquivalent:@"z"];
    [edit addItemWithTitle:@"Redo" action:@selector(redo:) keyEquivalent:@"z"].keyEquivalentModifierMask = cmd | NSEventModifierFlagShift;
    [edit addItem:NSMenuItem.separatorItem];
    [edit addItemWithTitle:@"Cut" action:@selector(cut:) keyEquivalent:@"x"];
    [edit addItemWithTitle:@"Copy" action:@selector(copy:) keyEquivalent:@"c"];
    [edit addItemWithTitle:@"Paste" action:@selector(paste:) keyEquivalent:@"v"];
    [edit addItemWithTitle:@"Select All" action:@selector(selectAll:) keyEquivalent:@"a"];

    NSMenu *view = [[NSMenu alloc] initWithTitle:@"View"];
    [view addItemWithTitle:@"Enter Full Screen" action:@selector(toggleFullScreen:) keyEquivalent:@"f"].keyEquivalentModifierMask = cmd | NSEventModifierFlagControl;

    NSMenu *window = [[NSMenu alloc] initWithTitle:@"Window"];
    [window addItemWithTitle:@"Minimize" action:@selector(performMiniaturize:) keyEquivalent:@"m"];
    [window addItemWithTitle:@"Zoom" action:@selector(performZoom:) keyEquivalent:@""];
    [window addItem:NSMenuItem.separatorItem];
    [window addItemWithTitle:@"Close Window" action:@selector(performClose:) keyEquivalent:@"w"];
    NSApp.windowsMenu = window;

    NSMenu *help = [[NSMenu alloc] initWithTitle:@"Help"];
    NSApp.helpMenu = help;

    for (NSMenu *menu in @[ app, file, edit, view, window, help ]) {
        NSMenuItem *holder = [bar addItemWithTitle:menu.title action:nil keyEquivalent:@""];
        holder.submenu = menu;
    }
    NSApp.mainMenu = bar;
}

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    [self buildMainMenu];

    NSRect screen = NSScreen.mainScreen.frame;
    NSRect frame = NSMakeRect(screen.origin.x + (screen.size.width - kDefaultWindowSize) / 2,
                              screen.origin.y + (screen.size.height - kDefaultWindowSize) / 2,
                              kDefaultWindowSize, kDefaultWindowSize);
    self.window = [[AWWindow alloc] initWithContentRect:frame
        styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskMiniaturizable |
                  NSWindowStyleMaskResizable | NSWindowStyleMaskFullSizeContentView
        backing:NSBackingStoreBuffered defer:NO];
    self.window.title = @"Agent Window";
    self.window.titleVisibility = NSWindowTitleHidden;
    self.window.titlebarAppearsTransparent = YES;
    self.window.opaque = NO;
    self.window.backgroundColor = NSColor.clearColor;
    self.window.contentMinSize = NSMakeSize(kMinWindowWidth, kMinWindowHeight);
    self.window.releasedWhenClosed = NO;
    self.window.delegate = self;
    for (NSNumber *kind in @[ @(NSWindowCloseButton), @(NSWindowMiniaturizeButton), @(NSWindowZoomButton) ])
        [self.window standardWindowButton:kind.integerValue].hidden = YES;

    NSView *content = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, frame.size.width, frame.size.height)];
    self.window.contentView = content;

    self.glass = [[NSGlassEffectView alloc] initWithFrame:content.bounds];
    self.glass.style = NSGlassEffectViewStyleClear;
    self.glass.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    self.glassCornerRadius = 26;
    [content addSubview:self.glass];

    WKWebViewConfiguration *config = [WKWebViewConfiguration new];
    [config.preferences setValue:@YES forKey:@"developerExtrasEnabled"];
    NSString *inject = [NSString stringWithContentsOfURL:[NSBundle.mainBundle URLForResource:@"inject" withExtension:@"js"]
                                                encoding:NSUTF8StringEncoding error:nil];
    [config.userContentController addUserScript:[[WKUserScript alloc] initWithSource:inject
        injectionTime:WKUserScriptInjectionTimeAtDocumentStart forMainFrameOnly:NO]];
    [config.userContentController addScriptMessageHandlerWithReply:self contentWorld:WKContentWorld.pageWorld name:@"agentWindow"];

    self.webView = [[WKWebView alloc] initWithFrame:content.bounds configuration:config];
    self.webView.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    self.webView.inspectable = YES;
    self.webView.UIDelegate = self;
    [self.webView setValue:@NO forKey:@"drawsBackground"];
    self.webView.underPageBackgroundColor = NSColor.clearColor;
    [content addSubview:self.webView];
    [self.webView loadHTMLString:@"<!DOCTYPE html><html><head><style>*{margin:0;padding:0}html,body{height:100%;background:transparent;-webkit-user-select:none;user-select:none}</style></head><body></body></html>" baseURL:nil];

    [self applyGlass];
    [self.window addObserver:self forKeyPath:@"effectiveAppearance" options:0 context:NULL];
    [self.window makeKeyAndOrderFront:nil];
    [self.window makeFirstResponder:self.webView];
    [NSApp activate];

    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{ [self startHub]; });
}

@end

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        NSApplication *app = NSApplication.sharedApplication;
        AWApp *delegate = [AWApp new];
        app.delegate = delegate;
        app.activationPolicy = NSApplicationActivationPolicyRegular;
        [app run];
    }
    return 0;
}
