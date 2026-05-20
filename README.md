<div align="center">
<h2> AudioPlayer </h2>
<p> 高性能音频播放器 - Rust 音频引擎 + Tauri 桌面应用 </p>

[![Stars](https://img.shields.io/github/stars/Asaiuta/AudioPlayer?style=flat)](https://github.com/Asaiuta/AudioPlayer/stargazers)
[![Version](https://img.shields.io/github/v/release/Asaiuta/AudioPlayer)](https://github.com/Asaiuta/AudioPlayer/releases)
[![License](https://img.shields.io/github/license/Asaiuta/AudioPlayer)](https://github.com/Asaiuta/AudioPlayer/blob/master/LICENSE)
[![Issues](https://img.shields.io/github/issues/Asaiuta/AudioPlayer)](https://github.com/Asaiuta/AudioPlayer/issues)

> ⚠️ **项目正在积极开发中，API 和功能可能会发生变化**

</div>

## 说明

> [!IMPORTANT]
>
> ### 严肃警告
>
> - 请务必遵守 [GNU Affero General Public License (AGPL-3.0)](https://www.gnu.org/licenses/agpl-3.0.html) 许可协议
> - 在您的修改、演绎、分发或派生项目中，必须同样采用 **AGPL-3.0** 许可协议，**并在适当的位置包含本项目的许可和版权信息**
> - 若您用于售卖或其他盈利用途，**必须提供本项目的源代码及原项目链接**。另外由于本项目涉及第三方，**售卖后可能遭受法律或诉讼风险**。如若发现违反许可协议，作者保留追究法律责任的权利
> - 禁止在二开项目中修改程序原版权信息（ 您可以添加二开作者信息 ）
> - 感谢您的尊重与理解

> [!NOTE]
>
> - 本项目采用 [Rust](https://www.rust-lang.org/) + [Tauri](https://tauri.app/) + [SolidJS](https://www.solidjs.com/) + [TypeScript](https://www.typescriptlang.org/) 开发
> - 音频引擎使用 [symphonia](https://github.com/pdeljanov/symphonia) 解码、[soxr](https://github.com/pegasus-audio/soxr-rs) 重采样、[cpal](https://github.com/RustAudio/cpal) 音频输出
> - 支持网易云音乐集成（登录、歌单、搜索、播放）
> - 采用 64-bit 浮点处理管道，实现高保真音频播放
> - 支持实时音频频谱分析和 DSP 效果处理

## 技术栈

| 层级 | 技术 |
|------|------|
| 音频引擎 | Rust (symphonia, soxr, cpal, rustfft) |
| 桌面框架 | Tauri |
| 前端 | SolidJS + TypeScript |
| 样式 | UnoCSS |
| 数据库 | SQLite (rusqlite) |
| 构建 | Vite + Cargo |

## 项目结构

```
AudioPlayer/
├── src/                    # Rust 音频引擎
│   ├── player/             # 播放器核心（音频线程、回调、频谱）
│   ├── processor/          # DSP 处理器（均衡器、响度、重采样）
│   ├── server/             # HTTP/WebSocket 服务器
│   └── app_database/       # SQLite 数据库操作
├── apps/desktop/           # Tauri 桌面应用
│   ├── src/                # SolidJS 前端
│   └── src-tauri/          # Tauri 配置
├── crates/                 # Rust 子 crate
└── migrations/             # 数据库迁移
```

## 开发

### 环境要求

- Rust 1.70+
- Node.js 18+
- soxr 库

### 快速开始

1. 克隆仓库

   ```bash
   git clone https://github.com/Asaiuta/AudioPlayer.git
   cd AudioPlayer
   ```

2. 构建后端

   ```bash
   set RUSTFLAGS=-C target-cpu=native
   cargo build --release
   ```

3. 启动前端开发

   ```bash
   cd apps/desktop
   npm install
   npm run dev
   ```

4. 构建桌面应用

   ```bash
   cd apps/desktop
   npm run tauri build
   ```

## 功能

- ✨ 高保真音频播放（64-bit 浮点处理）
- 🎵 实时音频频谱分析
- 🎛️ 均衡器和 DSP 效果（响度标准化、限幅器、交叉馈送）
- 📁 本地音乐库管理
- ☁️ 网易云音乐集成
  - 扫码/手机号登录
  - 歌单同步
  - 音乐搜索
  - 在线播放
- 📝 歌词显示
- 🎨 封面主题色自适应
- 🌚 Light / Dark 模式切换
- 🔄 播放队列管理
- 📊 响度测量（EBU R128）

## 性能优化

- **SIMD 加速**：通过 `target-cpu=native` 开启，提升 FFT 卷积和噪声整形性能
- **锁无关参数更新**：使用 atomic 操作实现音频参数的实时安全更新
- **实时安全音频线程**：避免音频回调中的内存分配和阻塞操作
- **高效缓冲区管理**：复用音频缓冲区，减少内存分配开销
- **并行处理**：使用 rayon 进行并行 DSP 处理

## 架构特点

### 音频引擎

- 模块化 DSP 处理管道
- 支持多种音频格式（MP3, FLAC, WAV, AAC, OGG 等）
- 无缝播放（gapless playback）
- 动态响度标准化
- 实时频谱分析

### 服务器

- HTTP API 供前端调用
- WebSocket 实时状态推送
- 网易云音乐 API 代理
- 路径安全验证

### 前端

- SolidJS 响应式框架
- UnoCSS 原子化 CSS
- Tauri IPC 通信
- 响应式播放状态管理

## 😘 鸣谢

特此感谢为本项目提供支持与灵感的项目：

- [SPlayer](https://github.com/imsyy/SPlayer) - 简约的音乐播放器，本项目前端设计参考
- [NeteaseCloudMusicApi](https://github.com/neteasecloudmusicapienhanced/api-enhanced) - 网易云音乐 API 服务
- [applemusic-like-lyrics](https://github.com/Steve-xmh/applemusic-like-lyrics) - Apple Music 风格歌词显示

## 📢 免责声明

本项目部分功能使用了网易云音乐的第三方 API 服务，**仅供个人学习研究使用，禁止用于商业及非法用途**

同时，本项目开发者承诺 **严格遵守相关法律法规和网易云音乐 API 使用协议，不会利用本项目进行任何违法活动。** 如因使用本项目而引起的任何纠纷或责任，均由使用者自行承担。**本项目开发者不承担任何因使用本项目而导致的任何直接或间接责任，并保留追究使用者违法行为的权利**

请使用者在使用本项目时遵守相关法律法规，**不要将本项目用于任何商业及非法用途。如有违反，一切后果由使用者自负。** 同时，使用者应该自行承担因使用本项目而带来的风险和责任。本项目开发者不对本项目所提供的服务和内容做出任何保证

感谢您的理解

## 📜 开源许可

- **本项目仅供个人学习研究使用，禁止用于商业及非法用途**
- 本项目基于 [GNU Affero General Public License (AGPL-3.0)](https://www.gnu.org/licenses/agpl-3.0.html) 许可进行开源
  1. **修改和分发：** 任何对本项目的修改和分发都必须基于 AGPL-3.0 进行，源代码必须一并提供
  2. **派生作品：** 任何派生作品必须同样采用 AGPL-3.0，并在适当的地方注明原始项目的许可证
  3. **注明原作者：** 在任何修改、派生作品或其他分发中，必须在适当的位置明确注明原作者及其贡献
  4. **免责声明：** 根据 AGPL-3.0，本项目不提供任何明示或暗示的担保。请详细阅读 [GNU Affero General Public License (AGPL-3.0)](https://www.gnu.org/licenses/agpl-3.0.html) 以了解完整的免责声明内容
  5. **社区参与：** 欢迎社区的参与和贡献，我们鼓励开发者一同改进和维护本项目
  6. **许可证链接：** 请阅读 [GNU Affero General Public License (AGPL-3.0)](https://www.gnu.org/licenses/agpl-3.0.html) 了解更多详情