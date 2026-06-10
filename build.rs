#[path = "crates/audio-engine-core/build.rs"]
mod audio_engine_core_build;

fn main() {
    println!("cargo:rerun-if-changed=crates/audio-engine-core/build.rs");
    audio_engine_core_build::run_build_script();
}
