# Changelog

## 0.1.0-beta.3

- 包内不再附带定位模型：`assisted` 只从 `licensedAssetsUrl` 加载客户专属的授权模型，未配置时按全帧解码；Worker 拒绝非授权模型。`scanops-assets --force` 升级会删除旧的 `scanops-locator.onnx` / `.json`。
- 新增 `scanops-engine.wasm`：授权模型的输入混合、推理、输出还原与候选区域提取全部在引擎内完成，模型密钥以密封形式随授权 token 下发，仅引擎可打开。需配合新版授权服务。
- 密封数据同时绑定 token 的过期时间与域名，引擎每次打开都重新核对：复制出的密封串只能在原域名、且未过期时使用；token 续期时 SDK 会重开引擎以延续会话。（纯客户端无法阻止在自建 worker 中伪造时间/域名，此举将门槛提高到需改动 worker。）
- 移除 ONNX Runtime Web（约 11 MiB）：定位推理改由引擎完成，单线程耗时与之持平。授权模型改为 `scanops-locator.weights`，需用新版 `export_licensed.py` 重新导出；升级工具会删除旧的 `scanops-inference.mjs` / `.wasm`。

- 新增 `maxCodes`（1–10，默认 1）、`codes` / `confirmedCodes` 和 `MultiCodeOverlay`，支持同画面多二维码及混合条码；保留单码 API。
- 多码扫描检查整个配置区域，独立确认不同内容并按位置合并补扫结果；同内容不同位置保留为多个检测，但业务确认按内容去重。
- 演示页设置新增单个 / 多个同时识别，视频和图片共用，显示多个位置框及可逐项复制的结果列表。
- 对外交付的 ESM、React、Worker、WASM、模型、清单和 CLI 文件统一为 ScanOps 命名；包导入与 API 保持兼容。
- 新增 `scanops-v1` 资源布局与完整性清单；显式配置推理加载路径，保留未修改的上游二进制、许可证和来源映射。
- SDK 与演示站同步采用新资源；升级工具只清理明确列出的旧运行文件。升级须同步部署 SDK / 资源，建议使用版本化目录。
- 相机优先请求更清晰画面，尝试设备支持的连续对焦；公开补光、变焦及能力信息，支持约束失败回退与取消。
- 快速扫描失败时进行限频、受预算约束的高清重试；去噪仍为可选失败兜底，不放大源图。
- 新增视频多帧确认、重复结果抑制与 `confirmed` / React `onConfirmed`；原始逐帧结果继续即时返回。
- 复用采集画布，按处理负载调整扫描调度，避免重复处理未更新的视频帧；记录本地会话诊断。
- 新增小尺寸二维码真实解码、相机生命周期与确认状态回归测试；尚未完成真机识别率对照验收。

## 0.1.0-beta.2

- 新增九种常见一维条码与混合 QR 扫描；默认启用全部支持的码制，支持 formats 筛选。
- 独立 ZXing WASM Worker 解码与条纹边界检测，复用局部重新检测和绿色平滑定位框。
- 结果新增 format，目标身份包含码制和内容，UPC 返回打印形式。
- 保留仅 QR 时的轻量解码路径；二维码模型不用于条码定位。
- 新增真实 Worker/WASM 条码、旋转、移动、丢失与重捕获测试。

## 0.1.0-beta.1

- Extract browser scanning, camera lifecycle and single-code tracking into ScanOps.
- Add optional model-assisted scanning with full-frame decoding fallback.
- Ship an optional React component and TypeScript declarations.
- Package same-origin decoder/model workers, locator-v2 and matching WASM assets.
- Add an asset-copy CLI and local tarball installation examples.
- Add an independent animation-frame overlay and fast local re-detection for live scanning; reacquire on a miss.

Experimental release. No QR-targeted autofocus, deblurring model, persistent
multi-object identity tracking, billing, domain binding or license-key enforcement is included.
