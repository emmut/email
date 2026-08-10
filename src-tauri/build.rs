use std::env;
use std::path::PathBuf;
use std::process::Command;

fn main() {
    if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        link_sparkle();
    }
    tauri_build::build()
}

// Link Sparkle.framework (macOS auto-updates). The framework is fetched into
// src-tauri/frameworks/ by scripts/fetch-sparkle.sh and embedded into the app
// bundle via tauri.conf.json (bundle.macOS.frameworks).
fn link_sparkle() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let frameworks = manifest_dir.join("frameworks");

    if !frameworks.join("Sparkle.framework").exists() {
        let script = manifest_dir.join("..").join("scripts").join("fetch-sparkle.sh");
        let status = Command::new("bash")
            .arg(&script)
            .status()
            .expect("failed to run scripts/fetch-sparkle.sh");
        assert!(
            status.success(),
            "scripts/fetch-sparkle.sh failed; place Sparkle.framework in src-tauri/frameworks/ manually"
        );
    }

    println!("cargo:rustc-link-search=framework={}", frameworks.display());
    println!("cargo:rustc-link-lib=framework=Sparkle");
    // Bundled app: framework lives in Email.app/Contents/Frameworks.
    println!("cargo:rustc-link-arg=-Wl,-rpath,@executable_path/../Frameworks");
    // `tauri dev` runs the bare binary from target/, so also resolve the
    // framework from the checkout.
    println!("cargo:rustc-link-arg=-Wl,-rpath,{}", frameworks.display());
}
