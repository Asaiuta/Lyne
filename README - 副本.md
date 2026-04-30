# Rust 音频重采样模块

本项目提供高性能的音频重采样和 DSP 处理功能。

## 构建说明

本项目使用 Rust 和 Cargo 进行构建，依赖 soxr 库进行高质量音频重采样。

### 编译命令 (Windows CMD)

```cmd
set RUSTFLAGS=-C target-cpu=native
cargo build --release
```

### 运行

编译完成后，二进制文件位于 `target/release/` 目录。

### 一键编译 (PowerShell)

```powershell
$env:RUSTFLAGS = "-C target-cpu=native"; cargo build --release
```


## 关键技术点

- **SIMD 加速**: 通过 `target-cpu=native` 开启，显著提升 FFT 卷积和噪声整形的性能。
- **Python 3.13**: 完美支持最新版 Python。
- **64-bit Pipeline**: 内部处理全程保持双精度浮点。
- **高精度相位时钟**: 启用 `QualityFlags::HighPrecisionClock`，提升无理数采样率比的精度。
- **极高品质**: 使用 `QualityRecipe::very_high()` (= Bits28) 配置。
- **多通道支持**: 1-2 通道使用 Stereo 格式高效处理，3+ 通道使用 Mono 逐通道处理。