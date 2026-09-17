# ScanOps Browser SDK

独立的浏览器二维码与一维条码扫描库。普通 H5 / Vue 可以直接调用 `ScanOps`；React 可使用可选的 `ScanOpsView` 组件。

当前版本：`0.1.0-beta.2`。包名 `@scanops/browser-sdk` 暂定，**尚未发布到 npm registry**。下面包名安装命令用于正式发布后；现在请安装交付的 `.tgz` 文件。

源码仓库：[vicalogs/ScanOps](https://github.com/vicalogs/ScanOps)。源码提交与 npm 发布流程见仓库根目录的 `PUBLISH.md`。

品牌与新接口名已统一为 ScanOps：`ScanOps`、`ScanOpsView`、`scanops-assets`。旧的 `SmartScanner`、`SmartScannerView` 和 React 类型别名暂时保留兼容；新集成请使用本文的新名称。默认资源路径改为 `/scanops/`，也可通过 `assetBaseUrl` 继续指定旧目录。

## 安装

本地交付包（三选一，用实际文件路径替换）：

```sh
npm install ./scanops-browser-sdk-0.1.0-beta.2.tgz
yarn add ./scanops-browser-sdk-0.1.0-beta.2.tgz
pnpm add ./scanops-browser-sdk-0.1.0-beta.2.tgz
```

正式发布且账户拥有访问权限后：

```sh
npm install @scanops/browser-sdk
yarn add @scanops/browser-sdk
pnpm add @scanops/browser-sdk
```

ESM 库，附带 TypeScript 类型。核心入口不依赖 React，Node 服务端可安全导入，但实例必须在浏览器挂载后创建。React 入口需要宿主安装 React 18.2 或 19；不提供 CommonJS `require()` 入口。

## 部署运行文件

安装后运行一次（三选一）：

```sh
npx scanops-assets public/scanops
yarn scanops-assets public/scanops
pnpm exec scanops-assets public/scanops
```

将该目录作为静态资源与应用一起发布。升级包后重新复制：`npx scanops-assets public/scanops --force`。只对工具创建的专用目录允许覆盖；更新时会清理已知的旧版运行文件，不会递归删除目录或删除许可证、自定义文件。

### ScanOps 交付文件

ESM 主文件为 `dist/scanops.js`，React 入口为 `dist/scanops-react.js`，类型入口分别为 `scanops.d.ts` / `scanops-react.d.ts`。应用仍通过 `@scanops/browser-sdk` 和 `@scanops/browser-sdk/react` 导入，无需修改调用代码。


## 支持的码制与定位

默认同时识别 `QRCode`、`Code128`、`Code39`、`Code93`、`EAN13`、`EAN8`、`UPCA`、`UPCE`、`ITF`、`Codabar`。通过 `formats` 数组限制业务需要的格式；空数组和未知名称会报错。`SUPPORTED_FORMATS` / `DEFAULT_FORMATS` 与 `BarcodeFormat` 类型可直接导入。

`code` 返回 `{ format, data, cornerPoints }`，类型为 `DetectedCode`（旧名 `QrCode` 暂作兼容别名）。UPC-A 返回 12 位，UPC-E 返回原始 8 位；EAN 包含校验位，Codabar 保留起止字符。Code39 与 ITF 不自动判断可选业务校验位。UPC-A 与以 0 开头的 EAN-13 图案等价，同时启用两者时优先归为 UPC-A；需要固定规则时限定 `formats`。

二维码保留解码器四角坐标；一维条码在已解码扫描线两侧匹配条纹，估计可见条纹区域，不包含下方印刷文字。低对比度、强透视、遮挡时边界可能不完整。绿色填充及平滑跟随适用于两类码，`QrOverlay` 名称保留兼容。

`assisted` 中的神经网络仍只定位二维码候选区域，一维条码使用 ZXing-C++ WASM 算法，不使用该二维码模型。仅启用一维条码时不加载模型。

定位模型不随 npm 包附带：每个客户使用专属的授权模型，由授权服务在 `licensedAssetsUrl` 下发，模型密钥以密封形式放在授权 token 中，只有 `scanops-engine.wasm` 能打开。未配置 `licensedAssetsUrl` 时 `assisted` 等同全帧解码（`path: 'full-frame'`、`candidates` 为空）。Worker 拒绝加载非授权模型。未支持 Data Matrix、PDF417 等其他二维格式。

## 普通 H5 / Vue

### 单码与多码

`maxCodes` 为每帧返回数量上限（1–10 的整数，默认 1），不是累计扫描次数。演示页的“设置 → 识别数量”对应 1 / 10，视频和图片均生效，切换后会清除旧结果并重新准备识别。

```ts
const scanner = new ScanOps({ formats: ['QRCode'], maxCodes: 10 });
scanner.on('result', frame => {
  console.log(frame.codes); // 当前帧全部检测结果，未识别到时为 []
  console.log(frame.confirmedCodes); // 视频中已通过独立多帧确认的结果
});
```

`code` 保留为第一项或 `null`，原有单码接入方式不变；新代码应读取 `codes`。多码尊重 `formats` 和 `scanRegion`，每次检查整个配置区域，不使用单目标局部追踪或定位模型提前结束。预算允许时会对未达上限的画面进行高清 / 可选去噪补扫，合并重复检测；上限不保证画面中所有码都能被识别，速度和成功率仍取决于尺寸、清晰度与设备。

多码视频按“码制 + 内容”独立确认，每帧相同内容仅计一次；结果数组和位置框保留不同位置的同内容码，但 `confirmed` 事件对同一内容只通知一次，不能据此计算同内容实物的唯一数量。`confirmed` 布尔值对应 `code`；`track` 仍仅表示第一项，不是多目标 ID 接口。

需同时绘制多个框时使用 `MultiCodeOverlay`，向 `update(frame)` 传入完整结果；它按内容与临近位置匹配并平滑绘制，空结果清除所有框。`ScanOpsView` 已使用该覆盖层，并在 `options.maxCodes` 变化后重建扫描器。原有 `QrOverlay` 继续绘制 `code` 的单个框。

### 启动与停止

```ts
import { ScanOps } from '@scanops/browser-sdk';

const scanner = new ScanOps({
  assetBaseUrl: '/scanops/',
  mode: 'baseline',
  formats: ['QRCode', 'Code128', 'EAN13'], // 省略时启用全部支持的码制
  maxScansPerSecond: 10,
});

const off = scanner.on('result', result => {
  if (result.code) {
    console.log(result.code.format, result.code.data, result.code.cornerPoints);
    // 坐标对应 result.width / result.height，绘制时映射到预览尺寸。
  }
});
scanner.on('error', error => console.error(error));
scanner.on('confirmed', result => {
  // 视频业务结果：默认连续两帧码制和内容一致才触发，同次展示不重复触发。
  console.log('已确认', result.code.format, result.code.data);
});
scanner.on('track', track => {
  // 每次成功解码刷新位置；null 表示离开、超时或停止。
  console.log(track?.id, track?.code.cornerPoints);
});

// 放在用户点击事件中；video 是 <video muted playsinline>。
await scanner.start(document.querySelector('video')!, 'environment');

// 可选：获得权限后列出摄像头，再以真实 device id 切换。
const cameras = await scanner.listCameras();
if (cameras.length > 1) await scanner.switchCamera(cameras[1].id);

// 停止；可以重新 start。
scanner.stop();
// 组件卸载时：释放 worker、摄像头、计时器和事件监听；之后不可复用。
off();
scanner.destroy();
```

Vue 在 `onMounted` 创建实例，在 `onBeforeUnmount` 调用 `destroy()`。示例中的启动/停止/销毁是分步 API 演示，不要在挂载时连续执行。

需要跟随框时，可以把一个绝对定位的 SVG 覆盖在 video 上，两者使用同样的 `contain` 显示方式：

```ts
import { QrOverlay } from '@scanops/browser-sdk';
const overlay = new QrOverlay(document.querySelector('svg')!, { smoothingMs: 35 });
scanner.on('result', result => { if (result.code) overlay.update(result); });
scanner.on('track', track => { if (!track) overlay.clear(); });
// 卸载时同时调用 scanner.destroy() 和 overlay.destroy()。
```

React 组件已自动接入这套跟随框。绘制使用独立 `requestAnimationFrame`，不让识别频率决定 UI 更新频率；短插值缓和跳动，大位移、切换目标、横竖屏变化直接贴到新位置。它不外推未知位置，也不保证固定 60 FPS；减少动态效果的系统设置会关闭插值。

图片识别（等待图片加载后，在摄像头停止时调用）：

```ts
const scanner = new ScanOps({ mode: 'assisted' });
try {
  const image = new Image();
  image.src = '/sample.png';
  await image.decode();
  const result = await scanner.scanImage(image);
  console.log(result.code?.data);
} finally {
  scanner.destroy();
}
```

也支持已经准备好的 canvas、video 当前帧和 ImageBitmap。跨域图像必须允许 CORS，调用方负责设置 `crossOrigin`。同一实例不排队处理并发任务：连续识别需等待前一次完成，不能在摄像头运行时调用 `scanImage()`。

## React 组件

```tsx
'use client';
import { useRef, useState } from 'react';
import { ScanOpsView } from '@scanops/browser-sdk/react';
import type { ScanOpsHandle } from '@scanops/browser-sdk/react';

export function Scanner() {
  const ref = useRef<ScanOpsHandle>(null);
  const [text, setText] = useState('');
  return <>
    <ScanOpsView
      ref={ref}
      options={{ mode: 'assisted', assetBaseUrl: '/scanops/' }}
      labels={{ start: '开启摄像头', stop: '停止', starting: '正在启动…', video: '摄像头预览' }}
      onConfirmed={result => setText(result.code.data)}
      onError={console.error}
      style={{ maxWidth: 720 }}
    />
    <pre>{text}</pre>
  </>;
}
```

组件包含预览、跟随框、启动/停止按钮和错误提示，卸载自动释放资源。通过 `controls={false}` 隐藏默认按钮，用 ref 的 `start()` / `stop()` / `switchCamera()` 接入自己的界面。更改 options 中的配置会销毁当前实例，需再次点击启动；仅更换回调函数不会重启摄像头。不会自动打开二维码中的链接。

## API

| 方法/属性 | 行为 |
| --- | --- |
| `start(video, camera?)` | 开启摄像头，默认后置；同实例重复调用取消上次启动；返回 Promise |
| `switchCamera(camera)` | 用 `user`、`environment` 或真实 device id 切换运行中的摄像头 |
| `stop()` | 立即取消当前任务、关闭摄像头、释放 worker；未完成 Promise 拒绝 |
| `destroy()` | 最终释放，可重复调用，之后不能再启动 |
| `scanImage(source)` | 返回一次识别结果，没有识别到码时 `code: null` |
| `listCameras()` | 枚举视频输入，不额外弹出权限请求；未授权时名称/id 可能为空 |
| `setTorch(enabled)` / `setZoom(value)` | 调整运行中相机的补光/变焦；不支持、越界或被设备拒绝时 Promise 拒绝 |
| `setAutoZoom(enabled)` / `autoZoomInfo` | 开关当前会话的自动变焦、读取状态；手动 `setZoom()` 接管后可重新开启 |
| `cameraInfo` | 实际分辨率、帧率、连续对焦状态及支持的补光/变焦范围；无相机时为 null |
| `diagnostics` | 当前或最近一次视频会话的诊断快照；下次启动重置，不上传 |
| `on(event, callback)` | 订阅 `state`、`startup`、`result`、`confirmed`、`camera`、`autoZoom`、`track`、`error`；返回取消订阅函数 |
| `state` / `cameraId` / `track` | 当前状态、当前摄像头 id、最近的追踪状态 |

状态：`idle` / `starting` / `running` / `destroyed`。图片任务期间 state 保持 idle，但重复任务会以 busy 错误拒绝。

结果：`code`、`codes`、`candidates`、`fallback`、`path`、`durationMs`、`width`、`height`、`timestamp`，以及 `recovery` 和视频的 `confirmed` / `confirmedCodes`。`path` 区分 `tracked-region`、`model-region`、`candidate-region`、`full-frame`。候选区域来自结构检测或模型预测，**不等于成功识别**；`score` 不是校准后的概率。`candidateSampled` 表示本帧实际测量过候选区域（可为空），缺省或 false 不表示目标消失。`timestamp` 是处理开始时间，追踪的 `lastSeen` 是该次解码完成时间，均属于 `performance.now()` 时间轴而非 Unix 时间。每个处理帧都触发 `result`（包括未识别帧），用于即时画框；视频业务动作建议订阅 `confirmed`。

默认连续两帧码制和内容一致、相邻成功观测间隔不超过 650 ms 才确认；未识别帧会打断连续计数。同一码持续展示不会重复触发 `confirmed`，离开超过确认窗口后重新出现，且距离上次触发至少 1500 ms 才可再次触发。不同内容可独立确认；业务确认不区分相同内容的两个实物。`confirmationFrames: 1` 可改为单帧确认。它减少瞬时误读的影响，但不能保证消除连续一致的误读；业务校验仍需调用方处理。单张图片不做多帧确认，直接使用 `scanImage()` 返回值。

`track` 的单目标追踪基于连续成功解码，默认 450 ms 未成功解码后失去目标；不预测遮挡期间的位置，不保证区分内容相同的两个同码制条码。多码结果通过 `codes` 返回，覆盖层逐帧匹配位置，但尚无跨遮挡的多目标身份追踪。

配置默认值：`mode='baseline'`、`maxCodes=1`、`maxScansPerSecond=30`、`maxFrameSize=1920`、`maxDecodeSize=960`、`lostAfterMs=450`、`stopOnHidden=true`。视频逐帧串行处理，不累积待处理帧；实际频率受设备性能限制。单码已识别后先在上次目标附近扩大区域快速重新解码，成功时跳过全图定位模型；失败时同帧回到完整流程。多码始终检查整个配置区域；图片单次扫描不使用前一帧位置。这仍然是局部重新检测，尚非光流追踪。

### 相机与失败重试

- `adaptiveCamera=true`：优先请求最长宽度 1920（不超过 `maxFrameSize`）的 16:9 画面，连续对焦仅在设备声明支持时尝试；分辨率约束失败时最多降至 1280 重试一次，不更换指定相机、不重试权限拒绝。实际尺寸以 `cameraInfo` 为准，不能保证每台设备达到 1080p。
- `maxRetryDecodeSize=1920`：快速扫描失败后，在同一采集帧上尝试更高解码分辨率；不放大源图，也不突破扫描区域。视频额外重试间隔 `retryIntervalMs=300`，每帧在 `retryBudgetMs=120` 以内才允许开始下一次额外尝试；该预算不能中断已开始的解码。`retryBudgetMs: 0` 关闭额外尝试。
- `denoise=false`：开启后，只在原图与可用的高清重试仍失败、预算仍有余量时尝试中值去噪；不是去模糊模型。大图增强有成本，默认不启用。
- `scanRegion`：传入归一化 `{ x, y, width, height }` 或返回该对象的函数，`null` 扫描全帧。返回坐标恢复至完整采集画面。动态区域与去噪可使用回调修改而不重开相机。
- 相机控制按能力显示：先读 `cameraInfo.torch.supported` / `cameraInfo.zoom` 再调用补光或变焦；订阅 `camera` 获取应用设置后的实际状态。不支持这些能力的浏览器仍可扫描。
- 采集画布复用；处理耗时升高时降低扫描调度频率，不排队。视频时间戳未变化时不重复解码或确认；连续 5 秒未更新会停止并触发错误，宿主可提供重新启动操作。

诊断字段：`startupMs` 包含引擎准备、等待用户授权和相机就绪；`firstDecodeMs` / `firstConfirmedMs` 从相机就绪算起，包含目标尚未入镜的时间，未发生时为 null。`frames` / `decodedFrames` 是处理帧/解码帧计数，`confirmedResults` 是去重确认事件数，`highResolutionAttempts` / `recoverySuccesses` 是高清尝试/额外重试成功次数。`processingP95Ms` 是最近最多 120 帧采集加扫描的 P95，不含初始化。这些是运行观测，**不是有真值的识别率或误报率**。

### 小码恢复与自动变焦

SDK 通过 `new ScanOps({ license, autoZoom: true })` 启用；SDK 默认关闭，网站 `/demo` 默认开启，可在「设置 → 画面调整 → 自动变焦」关闭。无需新训练模型。基础模式也能在尚未解码时寻找二维码的三个定位图形、或跨行重复的一维条码纹理；这是一套保守的启发式定位器，尚未完成真实远距离场景验证。

- 单码快速解码失败后，独立 `scanops-candidate.worker.js` 在最长边不超过 960 像素的采样上定位。视频间隔至少 `max(300, retryIntervalMs)` 毫秒，受 `retryBudgetMs` 约束；无预算时不增加恢复工作。
- 候选位置映射回完整采集帧，保留周边留白，先裁剪再以 `maxRetryDecodeSize` 上限解码，不放大源图。`candidate-region` 表示该路径读出内容；候选的 `decodeAttempted` 表示局部解码已完成，只有尝试过仍未读出的候选才能触发放大。采集帧仍受 `maxFrameSize` 限制。
- 已启用并配置好授权模型的辅助模式，在无候选且预算允许时每轮额外检查一个重叠分块；轮换中央和四角，保持模型原有的 192×192 输入。不会因为打开自动变焦而要求加载授权模型。
- 同一个居中的小目标至少三次有效观测、稳定至少 400 毫秒后，每次最多增加约 15%；按设备步长向下取整，最多达到启用时倍率的三倍，并服从设备上限。步长过大时保持倍率。
- 每次调整后至少等待 500 毫秒重新观察。首次读出后保持倍率至少 1500 毫秒；持续读出时一直保持。目标丢失超过 1200 毫秒时退回上次倍率，持续丢失可恢复初始视野。两次观测的相对锐度明显下降也会回退，并降低本次自动上限以避免反复尝试。锐度是图像指标，不等于设备对焦状态。
- 倍率计算使用完整源画面坐标；偏离中心或放大后接近边缘时提示对准。多码模式不自动选择一个目标放大。候选框不会写入已识别结果、不会触发业务确认。
- `setZoom()` 立即暂停当前会话的自动策略；相机设置串行执行，手动请求会排在已经发出的设置之后。`setAutoZoom(true)` 从当前倍率重新启用。无法撤回已交给浏览器的原生设置请求，但不会继续发出过期自动请求。
- 每次设置后回读倍率。设备拒绝、静默忽略或超时只暂停自动变焦，扫码继续；超时后需重启摄像头才能再次调整相机设置，以免叠加尚未完成的请求。停止、切换设备和页面隐藏会取消本会话后续控制。
- 无变焦能力时仍尝试局部高清解码，并提示靠近。浏览器提供 `zoom` 不代表已验证光学细节提升；严重模糊、反光、倾斜、反色或小到看不清定位特征的码可能没有候选。正式效果须按 [真机验收流程](../../AUTO_ZOOM_VALIDATION.md) 验证。

`autoZoomInfo.status`：`off`、`unsupported`、`multi-code`、`searching`、`stabilizing`、`centering`、`zooming`、`holding`、`limit`、`recovering`、`manual`、`error`。`autoZoom` 事件只在状态改变时触发；`camera` 事件提供实际倍率。辅助定位资源故障通过结果的 `candidateError` 标记，普通解码继续。
