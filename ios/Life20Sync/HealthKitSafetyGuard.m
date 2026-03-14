// ios/Life20Sync/HealthKitSafetyGuard.m
// Guard nativo che previene crash del modulo HealthKit su iPad.
//
// PROBLEMA: su iPad, il TurboModule di react-native-health viene inizializzato
// a livello nativo PRIMA che il JavaScript possa intervenire. Durante l'init,
// UIGraphicsImageRenderer tenta conversioni color space (ColorSync/vImage)
// che causano SIGABRT su iPad (wide gamut display).
//
// SOLUZIONE: +load viene eseguito prima di main(). Swizzliamo TUTTI i metodi
// critici di RCTAppleHealthKit per no-op su iPad, impedendo qualsiasi
// inizializzazione del modulo che possa triggerare UIGraphicsImageRenderer.

#import <Foundation/Foundation.h>
#import <objc/runtime.h>
#import <UIKit/UIKit.h>

@interface HealthKitSafetyGuard : NSObject
@end

@implementation HealthKitSafetyGuard

+ (void)load {
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        // Handler globale per eccezioni ObjC non catturate (safety net)
        NSSetUncaughtExceptionHandler(&handleUncaughtException);

        // Su iPad, disabilita completamente il modulo HealthKit
        if ([[UIDevice currentDevice] userInterfaceIdiom] == UIUserInterfaceIdiomPad) {
            NSLog(@"[HealthKitSafetyGuard] iPad detected - will disable HealthKit module");
            [self installIPadGuard];
        } else {
            // Su iPhone, installa solo protezione @try/@catch
            [self installIPhoneGuard];
        }
    });
}

static void handleUncaughtException(NSException *exception) {
    NSLog(@"[HealthKitSafetyGuard] Uncaught exception: %@ - %@", exception.name, exception.reason);
    NSLog(@"[HealthKitSafetyGuard] Stack: %@", exception.callStackSymbols);
}

#pragma mark - iPad: disabilita completamente il modulo

+ (void)installIPadGuard {
    // Prova subito, se la classe non e' ancora caricata riprova nel runloop
    Class healthKitClass = NSClassFromString(@"RCTAppleHealthKit");
    if (healthKitClass) {
        [self disableModuleOnIPad:healthKitClass];
    } else {
        NSLog(@"[HealthKitSafetyGuard] RCTAppleHealthKit not loaded yet, deferring...");
        dispatch_async(dispatch_get_main_queue(), ^{
            Class cls = NSClassFromString(@"RCTAppleHealthKit");
            if (cls) {
                [self disableModuleOnIPad:cls];
            } else {
                NSLog(@"[HealthKitSafetyGuard] RCTAppleHealthKit not found, skip");
            }
        });
    }
}

+ (void)disableModuleOnIPad:(Class)healthKitClass {
    // Swizzle _initializeHealthStore -> return nil
    [self swizzleToNoOp:healthKitClass selector:@"_initializeHealthStore" returnNil:YES];

    // Swizzle initializeHealthKit:callback: -> chiama callback con errore
    SEL initHKSel = NSSelectorFromString(@"initializeHealthKit:callback:");
    Method initHKMethod = class_getInstanceMethod(healthKitClass, initHKSel);
    if (initHKMethod) {
        IMP newIMP = imp_implementationWithBlock(^void(id self_arg, NSDictionary *input, void (^callback)(NSArray *)) {
            NSLog(@"[HealthKitSafetyGuard] initializeHealthKit blocked on iPad");
            if (callback) {
                NSDictionary *error = @{@"message": @"HealthKit is not available on iPad"};
                callback(@[error]);
            }
        });
        method_setImplementation(initHKMethod, newIMP);
        NSLog(@"[HealthKitSafetyGuard] initializeHealthKit:callback: disabled on iPad");
    }

    // Swizzle setBridge: per impedire qualsiasi setup del modulo
    SEL setBridgeSel = NSSelectorFromString(@"setBridge:");
    Method setBridgeMethod = class_getInstanceMethod(healthKitClass, setBridgeSel);
    if (setBridgeMethod) {
        IMP originalIMP = method_getImplementation(setBridgeMethod);
        IMP newIMP = imp_implementationWithBlock(^void(id self_arg, id bridge) {
            @try {
                typedef void (*SetBridgeFunc)(id, SEL, id);
                ((SetBridgeFunc)originalIMP)(self_arg, setBridgeSel, bridge);
            } @catch (NSException *exception) {
                NSLog(@"[HealthKitSafetyGuard] Exception in setBridge: %@ - %@",
                      exception.name, exception.reason);
            }
        });
        method_setImplementation(setBridgeMethod, newIMP);
    }

    // Swizzle setMethodQueue: con @try/@catch
    SEL setQueueSel = NSSelectorFromString(@"setMethodQueue:");
    Method setQueueMethod = class_getInstanceMethod(healthKitClass, setQueueSel);
    if (setQueueMethod) {
        IMP originalIMP = method_getImplementation(setQueueMethod);
        IMP newIMP = imp_implementationWithBlock(^void(id self_arg, dispatch_queue_t queue) {
            @try {
                typedef void (*SetQueueFunc)(id, SEL, dispatch_queue_t);
                ((SetQueueFunc)originalIMP)(self_arg, setQueueSel, queue);
            } @catch (NSException *exception) {
                NSLog(@"[HealthKitSafetyGuard] Exception in setMethodQueue: %@ - %@",
                      exception.name, exception.reason);
            }
        });
        method_setImplementation(setQueueMethod, newIMP);
    }

    // Disabilita tutti i metodi HealthKit data (getStepCount, etc.) con no-op
    NSArray *dataSelectors = @[
        @"getStepCount:callback:",
        @"getDailyStepCountSamples:callback:",
        @"getActiveEnergyBurned:callback:",
        @"getDistanceWalkingRunning:callback:",
        @"getFlightsClimbed:callback:",
        @"getSleepSamples:callback:",
        @"getHeartRateSamples:callback:",
        @"getBodyMassIndex:callback:",
        @"getBodyFatPercentage:callback:",
        @"getHeight:callback:",
        @"getWeight:callback:",
    ];

    for (NSString *selName in dataSelectors) {
        SEL sel = NSSelectorFromString(selName);
        Method method = class_getInstanceMethod(healthKitClass, sel);
        if (method) {
            IMP newIMP = imp_implementationWithBlock(^void(id self_arg, NSDictionary *input, void (^callback)(NSArray *)) {
                if (callback) {
                    NSDictionary *error = @{@"message": @"HealthKit not available on iPad"};
                    callback(@[error]);
                }
            });
            method_setImplementation(method, newIMP);
        }
    }

    NSLog(@"[HealthKitSafetyGuard] All HealthKit methods disabled on iPad");
}

+ (void)swizzleToNoOp:(Class)cls selector:(NSString *)selName returnNil:(BOOL)returnNil {
    SEL sel = NSSelectorFromString(selName);
    Method method = class_getInstanceMethod(cls, sel);
    if (!method) return;

    IMP newIMP;
    if (returnNil) {
        newIMP = imp_implementationWithBlock(^id(id self_arg) {
            NSLog(@"[HealthKitSafetyGuard] %@ blocked on iPad", selName);
            return nil;
        });
    } else {
        newIMP = imp_implementationWithBlock(^void(id self_arg) {
            NSLog(@"[HealthKitSafetyGuard] %@ blocked on iPad", selName);
        });
    }
    method_setImplementation(method, newIMP);
    NSLog(@"[HealthKitSafetyGuard] %@ disabled on iPad", selName);
}

#pragma mark - iPhone: protezione @try/@catch

+ (void)installIPhoneGuard {
    Class healthKitClass = NSClassFromString(@"RCTAppleHealthKit");
    if (!healthKitClass) {
        dispatch_async(dispatch_get_main_queue(), ^{
            Class cls = NSClassFromString(@"RCTAppleHealthKit");
            if (cls) {
                [self wrapWithTryCatch:cls];
            }
        });
        return;
    }
    [self wrapWithTryCatch:healthKitClass];
}

+ (void)wrapWithTryCatch:(Class)healthKitClass {
    // Wrappa _initializeHealthStore con @try/@catch
    SEL initStoreSel = NSSelectorFromString(@"_initializeHealthStore");
    Method initStoreMethod = class_getInstanceMethod(healthKitClass, initStoreSel);
    if (initStoreMethod) {
        IMP originalIMP = method_getImplementation(initStoreMethod);
        IMP newIMP = imp_implementationWithBlock(^id(id self_arg) {
            @try {
                typedef id (*OrigFunc)(id, SEL);
                return ((OrigFunc)originalIMP)(self_arg, initStoreSel);
            } @catch (NSException *exception) {
                NSLog(@"[HealthKitSafetyGuard] Exception in _initializeHealthStore: %@ - %@",
                      exception.name, exception.reason);
                return nil;
            }
        });
        method_setImplementation(initStoreMethod, newIMP);
        NSLog(@"[HealthKitSafetyGuard] iPhone safety guard installed for _initializeHealthStore");
    }

    // Wrappa initializeHealthKit:callback: con @try/@catch
    SEL initHKSel = NSSelectorFromString(@"initializeHealthKit:callback:");
    Method initHKMethod = class_getInstanceMethod(healthKitClass, initHKSel);
    if (initHKMethod) {
        IMP originalIMP = method_getImplementation(initHKMethod);
        IMP newIMP = imp_implementationWithBlock(^void(id self_arg, NSDictionary *input, void (^callback)(NSArray *)) {
            @try {
                typedef void (*InitHKFunc)(id, SEL, NSDictionary *, void (^)(NSArray *));
                ((InitHKFunc)originalIMP)(self_arg, initHKSel, input, callback);
            } @catch (NSException *exception) {
                NSLog(@"[HealthKitSafetyGuard] Exception in initializeHealthKit: %@ - %@",
                      exception.name, exception.reason);
                if (callback) {
                    NSDictionary *error = @{@"message": [NSString stringWithFormat:@"HealthKit init failed: %@", exception.reason]};
                    callback(@[error]);
                }
            }
        });
        method_setImplementation(initHKMethod, newIMP);
        NSLog(@"[HealthKitSafetyGuard] iPhone safety guard installed for initializeHealthKit");
    }
}

@end
