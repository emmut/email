//! macOS auto-updates via Sparkle (https://sparkle-project.org).
//!
//! Sparkle.framework is linked by build.rs and embedded in the bundle by
//! tauri.conf.json; the appcast the updater polls is published to each GitHub
//! release by CI (see scripts/generate-appcast.sh) and fetched from the
//! stable `releases/latest/download/appcast.xml` URL in Info.plist
//! (`SUFeedURL`). Update archives are EdDSA-signed (`SUPublicEDKey`), which
//! is what lets Sparkle install them even though the app has no Developer ID
//! signature.
//!
//! The bindings talk to the Objective-C runtime directly rather than through
//! a crate: only three messages are needed (`alloc`, the designated
//! initializer, `checkForUpdates:`), all with pointer-sized arguments, so
//! plain `objc_msgSend` casts are sufficient on both arm64 and x86_64.

use std::ffi::{c_char, c_void, CString};
use std::ptr;
use std::sync::atomic::{AtomicPtr, Ordering};

type Id = *mut c_void;

#[repr(C)]
struct OpaqueClass {
    _priv: [u8; 0],
}

#[link(name = "objc")]
extern "C" {
    fn objc_msgSend();
    fn sel_registerName(name: *const c_char) -> Id;
}

extern "C" {
    // Referencing the class symbol (instead of objc_getClass) also guarantees
    // the linker keeps the Sparkle framework load command.
    #[link_name = "OBJC_CLASS_$_SPUStandardUpdaterController"]
    static SPU_STANDARD_UPDATER_CONTROLLER: OpaqueClass;
}

// The controller is created once on the main thread and only messaged from
// the main thread afterwards; the atomic just hands the pointer around.
static CONTROLLER: AtomicPtr<c_void> = AtomicPtr::new(ptr::null_mut());

fn sel(name: &str) -> Id {
    let cname = CString::new(name).expect("selector contains NUL");
    unsafe { sel_registerName(cname.as_ptr()) }
}

/// Start the Sparkle updater (scheduled background checks + standard UI).
/// Must be called on the main thread. No-op outside an .app bundle, where
/// Sparkle has no Info.plist to read (`tauri dev`).
pub fn init() {
    if !running_from_bundle() {
        return;
    }
    unsafe {
        let cls = &SPU_STANDARD_UPDATER_CONTROLLER as *const OpaqueClass as Id;
        let msg_alloc: unsafe extern "C" fn(Id, Id) -> Id =
            std::mem::transmute(objc_msgSend as *const ());
        let msg_init: unsafe extern "C" fn(Id, Id, bool, Id, Id) -> Id =
            std::mem::transmute(objc_msgSend as *const ());

        let obj = msg_alloc(cls, sel("alloc"));
        // -[SPUStandardUpdaterController initWithStartingUpdater:updaterDelegate:userDriverDelegate:]
        let controller = msg_init(
            obj,
            sel("initWithStartingUpdater:updaterDelegate:userDriverDelegate:"),
            true,
            ptr::null_mut(),
            ptr::null_mut(),
        );
        // Intentionally never released: lives for the whole app.
        CONTROLLER.store(controller, Ordering::Release);
    }
}

/// User-initiated update check ("Check for Updates…" menu item).
/// Must be called on the main thread.
pub fn check_for_updates() {
    let controller = CONTROLLER.load(Ordering::Acquire);
    if controller.is_null() {
        eprintln!("updater: Sparkle not running (not launched from an .app bundle?)");
        return;
    }
    unsafe {
        let msg_check: unsafe extern "C" fn(Id, Id, Id) =
            std::mem::transmute(objc_msgSend as *const ());
        msg_check(controller, sel("checkForUpdates:"), ptr::null_mut());
    }
}

fn running_from_bundle() -> bool {
    std::env::current_exe()
        .map(|p| p.to_string_lossy().contains(".app/Contents/MacOS"))
        .unwrap_or(false)
}
