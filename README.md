<div align="center">
  <h1>Lyne</h1>
  <p>Rust 音频引擎驱动的高保真桌面音乐播放器</p>

[![Stars](https://img.shields.io/github/stars/Asaiuta/Lyne?style=flat)](https://github.com/Asaiuta/Lyne/stargazers)
[![Version](https://img.shields.io/github/v/release/Asaiuta/Lyne)](https://github.com/Asaiuta/Lyne/releases)
[![License](https://img.shields.io/github/license/Asaiuta/Lyne)](https://github.com/Asaiuta/Lyne/blob/master/LICENSE)
[![Issues](https://img.shields.io/github/issues/Asaiuta/Lyne)](https://github.com/Asaiuta/Lyne/issues)

> 项目正在积极开发中，功能、接口和数据结构仍可能调整。
</div>

## 介绍

Lyne 是一个桌面音乐播放器，后端采用 Rust 构建音频播放、DSP、媒体库扫描和本地 HTTP/WebSocket 服务，前端采用 Tauri 2 + SolidJS + TypeScript 构建桌面界面。

项目目标是提供一个本地音乐体验扎实、音频处理链路可控、同时具备在线音乐扩展能力的播放器。当前重点仍在能力补齐、性能边界和 SPlayer 风格体验对齐上。

## 功能状态

| 能力 | 状态 | 说明 |
|------|------|------|
| 本地音频播放 | 可用 | 支持 MP3、FLAC、WAV、AAC、OGG 等常见格式 |
| 高保真处理管道 | 可用 | 64-bit 浮点处理、SoX VHQ 重采样、响度测量与 DSP 链路 |
| 本地音乐库 | 可用 | 本地扫描、SQLite 索引、封面缓存、播放历史与队列管理 |
| 网易云音乐 | 部分可用 | 登录、歌单、搜索、云盘/在线播放等能力持续补齐中 |
| 歌词显示 | 部分可用 | 本地歌词、在线歌词和高级歌词能力仍在迭代 |
| 频谱/DSP 可视化 | 部分可用 | 频谱分析、动态主题色和全屏播放页持续打磨中 |
| AutoMix | 规划/实验中 | 智能混音、过渡分析和缓存策略仍处于任务规划阶段 |

## 技术栈

| 层级 | 技术 |
|------|------|
| 音频引擎 | Rust, symphonia, soxr, cpal, rustfft |
| 桌面框架 | Tauri 2.x |
| 前端 | SolidJS, TypeScript |
| 样式 | UnoCSS |
| 数据库 | SQLite, rusqlite |
| 服务端 | Actix-web, WebSocket |
| 异步运行时 | Tokio |
| 构建 | Cargo, Vite, npm |

## 项目结构

```text
Lyne/
├── src/                    # Rust 音频引擎、播放器运行时和本地服务
│   ├── player/             # 播放器核心、音频线程、回调和频谱
│   ├── processor/          # DSP 处理器、响度、重采样和限制器
│   ├── server/             # HTTP/WebSocket 服务、网易云代理和扫描任务
│   ├── app_database/       # SQLite 数据库访问与迁移辅助
│   └── main.rs             # audio_server 入口
├── apps/desktop/           # Tauri 桌面应用
│   ├── src/                # SolidJS 前端
│   └── src-tauri/          # Tauri 配置与桌面壳
├── crates/                 # Rust 子 crate
├── packages/               # 协议与共享定义
├── migrations/             # 数据库迁移
├── benches/                # 性能基准测试
└── scripts/                # 构建和维护脚本
```

## 开发环境

- Windows 10/11
- Rust stable，建议使用较新的 stable 工具链
- Node.js 18+
- npm
- soxr 运行库/开发库

### Windows soxr 安装

使用 vcpkg：

```powershell
git clone https://github.com/microsoft/vcpkg.git
cd vcpkg
.\bootstrap-vcpkg.bat
.\vcpkg install soxr:x64-windows-static-md
```

或使用 MSYS2：

```bash
pacman -S mingw-w64-x86_64-soxr
```

## 快速开始

```powershell
git clone https://github.com/Asaiuta/Lyne.git
cd Lyne
```

安装前端依赖：

```powershell
cd apps/desktop
npm install
```

启动 Tauri 桌面开发环境：

```powershell
npm run tauri dev
```

只启动 Web 前端预览：

```powershell
npm run dev
```

单独构建后端 sidecar：

```powershell
cd ../..
cargo build --release --bin audio_server
```

## 构建

完整桌面打包：

```powershell
cd apps/desktop
npm run tauri build
```

仅构建 Web 前端：

```powershell
cd apps/desktop
npm run build:web
```

构建前端与后端 sidecar：

```powershell
cd apps/desktop
npm run build:bundle
```

构建多版本音频引擎：

```powershell
# 在仓库根目录执行
.\scripts\build_all.ps1
```

## 验证

```powershell
# Rust 编译检查
cargo check --bin audio_server

# Rust 测试
cargo test

# 前端类型检查
cd apps/desktop
npm run typecheck

# 前端聚焦测试
npm test

# 性能基准
cd ../..
cargo bench
```

## 架构特点

### 音频引擎

- 模块化 DSP 处理管道
- 多格式解码与 gapless playback
- 响度测量、限制器、交叉馈送和重采样链路
- 面向实时音频线程的低分配、低阻塞设计
- 性能基准覆盖播放、扫描、WebSocket 和 DSP 热路径

### 本地服务

- HTTP API 供桌面前端调用
- WebSocket 推送播放、队列、扫描和分析状态
- SQLite 持久化媒体库、播放历史、封面缓存和网易云账户摘要
- 网易云音乐 API 代理与领域化客户端接口

### 桌面前端

- SolidJS 响应式状态和路由
- Tauri 桌面壳与 sidecar 后端协同
- SPlayer 风格的页面、设置、播放器和媒体列表体验
- 可复用的 NaiveUI-like Solid 组件门面

## 性能方向

- `target-cpu=native` 可用于本地优化构建
- 音频参数更新尽量使用 atomic/lock-free 模式
- 音频回调路径避免阻塞操作和不必要分配
- 本地扫描使用批量写入、文件封面引用和受控内存批次
- 关键路径通过 `benches/` 下的基准测试持续约束

### 真实曲库基准

在一组 594 个文件、约 23.14 GB 的真实本地曲库 warm-cache 基准中，Lyne 默认 2-worker 扫描用时约 1.18 秒，索引 593 个条目，峰值 RSS 约 33 MB。作为对照，SPlayer native scanner baseline 本轮用时约 2.18 秒，索引 590 个条目，峰值 RSS 约 93 MB。

这些数字只代表该语料与该环境，不等同于所有磁盘、冷缓存、WebDAV 或异常标签文件的通用结论。完整命令、数据和限制见 [Real Library Benchmark](docs/performance/real-library-benchmark.md)。

## 致谢

- [SPlayer](https://github.com/imsyy/SPlayer) - 前端体验与交互参考
- [NeteaseCloudMusicApi](https://github.com/neteasecloudmusicapienhanced/api-enhanced) - 网易云音乐 API 参考
- [applemusic-like-lyrics](https://github.com/Steve-xmh/applemusic-like-lyrics) - Apple Music 风格歌词显示

## 贡献

欢迎提交 issue 和 pull request。建议在提交前至少运行与改动相关的检查：

- Rust：`cargo fmt`、`cargo check --bin audio_server`、相关 `cargo test`
- 前端：`npm run typecheck`、`npm test`
- 提交信息：建议遵循 [Conventional Commits](https://www.conventionalcommits.org/)

## 常见问题

### 构建时找不到 soxr

请确认已通过 vcpkg 或 MSYS2 安装 soxr，并确保构建环境能找到对应库文件。桌面打包时还需要 `libsoxr.dll` 能被复制到 Tauri bundle 资源中。

### 音频播放卡顿

可以尝试使用本机 CPU 优化构建：

```powershell
$env:RUSTFLAGS = "-C target-cpu=native"
cargo build --release --bin audio_server
```

### 如何启用 AVX2 / AVX-512 构建

使用 PowerShell 构建脚本：

```powershell
# 在仓库根目录执行
.\scripts\build_all.ps1
```

## 免责声明

Lyne 的网易云音乐相关能力依赖第三方接口或协议行为，仅供个人学习、研究和互操作性探索。使用者需要自行确认所在地区、平台协议和使用场景的合法性，不得将本项目用于违法、侵权、绕过平台限制或损害第三方权益的用途。

本项目按现状提供，不对可用性、稳定性、数据准确性或第三方服务可访问性作出保证。因使用本项目产生的账号、数据、版权、服务条款或其他风险，由使用者自行承担。

## 开源许可

本项目基于 [GNU Affero General Public License v3.0](https://www.gnu.org/licenses/agpl-3.0.html) 开源。修改、分发、部署网络服务或派生项目时，请遵守 AGPL-3.0 的源代码提供、许可证保留和版权声明要求。

详情请阅读 [LICENSE](LICENSE)。
