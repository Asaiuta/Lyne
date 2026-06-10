# audio-engine-core

Reusable decoder, DSP, loudness, resampling, and streaming pipeline primitives
extracted from the Lyne audio engine.

This crate is the app-agnostic core layer. It is intended for experiments and
integration work around high-quality local audio processing, not as a stable
1.0 SDK yet. The public API is versioned as `0.1.x` and may change while the
larger player continues to evolve.

## What Is Included

- Streaming decode helpers built on Symphonia.
- SoX VHQ resampling wrappers and streaming resampler utilities.
- DSP processors such as EQ, crossfeed, saturation, FFT convolution, dynamic
  loudness, volume smoothing, noise shaping, and spectrum analysis.
- EBU R128 loudness and true-peak measurement helpers.
- Lock-free DSP parameter snapshots and processor adapters for realtime audio
  callback integration.
- A small streaming pipeline/ring-buffer primitive.

## What Is Not Included

- Audio device ownership or CPAL/WASAPI output stream management.
- HTTP/WebSocket server routes.
- Desktop UI, Tauri integration, media-library scanning, playback queue logic,
  WebDAV, NetEase integration, or application runtime directories.
- A stable compatibility layer for every internal Lyne use case.

Those layers remain in the root Lyne application crate.

## Native Dependency: SoXR

The resampler depends on `soxr`, which requires the SoXR native library during
build/link.

On Windows, vcpkg is the recommended path:

```powershell
git clone https://github.com/microsoft/vcpkg.git
cd vcpkg
.\bootstrap-vcpkg.bat
.\vcpkg install soxr:x64-windows-static-md
```

On MSYS2:

```bash
pacman -S mingw-w64-x86_64-soxr
```

On Unix-like systems, install SoXR through your system package manager and make
sure `pkg-config` can locate it.

## Quick Example

```rust
use audio_engine_core::{LoudnessMeter, StreamingDecoder};

fn analyze_file(path: &str) -> Result<f64, Box<dyn std::error::Error>> {
    let mut decoder = StreamingDecoder::open(path)?;
    let mut meter = LoudnessMeter::new(decoder.info.channels, decoder.info.sample_rate);

    while let Some(samples) = decoder.decode_next()? {
        meter.process(&samples);
    }

    Ok(meter.integrated_loudness())
}
```

## Realtime Notes

The crate exposes lock-free parameter containers and processor adapters used by
Lyne's realtime callback path. Keep allocations, locks, file I/O, logging, and
network I/O out of an audio callback. Allocate and configure processors before
entering the realtime path, then update parameters through the provided atomic
snapshot types.

## License

This crate is licensed under AGPL-3.0-only, matching the Lyne repository.
