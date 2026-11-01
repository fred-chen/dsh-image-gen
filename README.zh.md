# dsh-image-gen

DeepSeek Harness 图像插件：把 **文生图、图生图、图片编辑** 接进 DSH，让模型可以通过工具调用，也让用户在左侧栏有一个「图像」工作室页面。

- **三个工具**：`image_generate`、`image_to_image`、`image_edit`
- **左侧栏入口**：`图像` 面板（`sidebar.panellist` + `main`），含生成 / 图生图 / 编辑 / 设置四个页签
- **默认端点**：`http://ai4090:8080/v1`
- **默认模型**：`Qwen-Image-2.1-Turbo`
- **结果落盘**：PNG 写入会话工作目录（默认 `.dsh-image-gen/`），返回本地路径 + 浏览器预览 URL
- **可配置**：端点、模型、默认尺寸、默认张数、seed、输出目录、超时、API Key、是否保持输入尺寸

## 为什么是独立插件，而不是接管 dsh-video-gen / dsh-tts

当前选择：**新增 `dsh-image-gen`，与 `dsh-video-gen`、`dsh-tts` 并存**。这是更稳妥的方案：

| 维度 | 独立图像插件（当前） | 大一统媒体插件 |
|---|---|---|
| 升级风险 | 只影响图像能力；视频/TTS 保持原版本、原工具名 | 任一后端变更都要重发整个插件，回归面更大 |
| 后端差异 | 图像在 `ai4090:8080/v1`；视频默认在 `ai9700:8080/upstream/...`；TTS 在 `ai4090:8080/v1/audio` | 需要把三套端点、模型、参数、错误语义塞进一个配置对象 |
| 模型感知 | 三个图像工具语义清晰，LLM 容易选择 | 工具数量多、描述冗长时容易混淆 |
| 侧栏 | 一个「图像」入口，不挤占视频/TTS 的入口 | 一个「媒体」入口，但内部页签更多 |
| 维护 | 小仓库、独立发版、独立测试 | 代码体积大、发布耦合、依赖视频插件的 ffmpeg 等 |
| 迁移 | 无需迁移旧会话 | 要保留旧工具名/旧配置兼容层，否则会破坏现有会话 |

建议的演进路径：先让 `dsh-image-gen` 稳定；如果以后确实需要「一个入口管所有媒体」，再做一个薄的聚合插件（例如 `dsh-media`），把 `dsh-image-gen`、`dsh-video-gen`、`dsh-tts` 作为依赖组合进来，而不是把三套实现合并到一个大文件里。

## 工具

### `image_generate`

文生图。调用 `POST /v1/images/generations`。

```json
{
  "prompt": "a red apple on a wooden table",
  "size": "1024x1024",
  "n": 1,
  "seed": 42,
  "negativePrompt": "blurry"
}
```

上游行为：`n`、`size`、`seed` 生效；`output_format` 被忽略，始终返回 PNG；采样步数由模型 preset 固定（当前为 8 步）。

### `image_to_image`

图生图 / 局部重绘。调用 `POST /sdapi/v1/img2img`。

```json
{
  "image": "lighthouse.png",
  "prompt": "turn the scene into night",
  "strength": 0.6,
  "mask": "mask.png",
  "invertMask": false
}
```

`strength` 为 denoising strength（0–1，默认 0.75）；`mask` 白色区域为重绘区域；`invertMask` 反转。该端点是本插件里**唯一真正支持 mask** 的通道。

### `image_edit`

指令式图片编辑。调用 `POST /v1/images/edits`。

```json
{
  "image": "lighthouse.png",
  "prompt": "make the lighthouse red",
  "size": "512x512"
}
```

上游的 `mask` 字段在 `/v1/images/edits` 上**被接受但无效**。要限定编辑区域，请把输入图片做成 RGBA，并在目标区域设 `alpha=0`；模型会把透明区域当作编辑区域。

## 安装

### 从 GitHub 安装（推荐）

```bash
cd ~/.dsh/profiles/desktop
pnpm add github:fred-chen/dsh-image-gen#v0.1.0
```

然后把 `dsh-image-gen` 加入该 profile `package.json` 的 `dsh.profile.bundles`，并把 `cordis.patch.yml` 的 insert 行加入 profile patch。示例：

```json
{
  "dsh": {
    "profile": {
      "bundles": [
        "...",
        "dsh-image-gen"
      ]
    }
  }
}
```

```yaml
- insert:
    - id: image-gen
      name: dsh-image-gen
      config:
        enabled: true
        endpoint: http://ai4090:8080/v1
        model: Qwen-Image-2.1-Turbo
        size: 1024x1024
        n: 1
        outputDir: .dsh-image-gen
        timeoutSec: 300
        preserveInputSize: true
        negativePrompt: ""
```

重启 `dsh web` / DSH 桌面应用，然后浏览器硬刷新（Cmd/Ctrl+Shift+R）。

### 本地源码安装

```bash
cd ~/.dsh/profiles/desktop
mkdir -p node_modules
cp -R /path/to/dsh-image-gen node_modules/dsh-image-gen
```

再按上面的方式修改 `package.json` 和 `cordis.patch.yml`。

## 配置

设置页有三个入口：左侧栏「图像」→「设置」、插件管理页 `dsh-image-gen` 行的 Configure、`/api/dsh-image-gen/describe`。

| 字段 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 禁用后三个工具不再注册 |
| `endpoint` | `http://ai4090:8080/v1` | 可填 `host:port`、`/v1` 或完整 `/v1/images/...` URL，插件会归一化 |
| `model` | `Qwen-Image-2.1-Turbo` | 传给三个端点 |
| `size` | `1024x1024` | 默认生成尺寸；每边 256–2048，总像素 ≤ 2,359,296 |
| `n` | `1` | 默认张数（1–4） |
| `seed` | 空 | 空 = 服务端默认/随机 |
| `negativePrompt` | 空 | 默认负向提示词 |
| `outputDir` | `.dsh-image-gen` | 相对会话工作目录 |
| `timeoutSec` | `300` | 30–900 秒 |
| `preserveInputSize` | `true` | 编辑/图生图未传 `size` 时用输入图片尺寸 |
| `apiKey` | 空 | secret；仅当网关要求鉴权 |

## 端点约定

插件由同一个 base URL 派生：

| 能力 | 方法 + 路径 |
|---|---|
| 文生图 | `POST {base}/images/generations` |
| 图片编辑 | `POST {base}/images/edits` |
| 图生图 | `POST {root}/sdapi/v1/img2img` |
| 模型列表 | `GET {base}/models` |
| 健康检查 | `GET {root}/health` |

其中 `root` 是去掉 `/v1` 的网关根路径。

## 已知上游坑（已在插件里处理/提示）

1. **一次只能一个请求**：同一模型并发会 `429 Too many requests`；工具和 UI 都按串行使用。
2. **`steps` 不可调**：当前 Turbo 模型固定 8 步，传 steps 不改变结果。
3. **`output_format` 无效**：所有端点只返回 PNG；不支持 `jpeg` / `webp`。
4. **`/v1/images/edits` 的 `mask` 无效**：用 RGBA alpha 通道表达编辑区域。
5. **edits 默认画布 1024×1024**：不传 size 会按 1024 生成；插件默认保持输入尺寸以提速。
6. **JSON edits 的 `image` 必须是数组**：元素为 raw base64，不接受 `data:` 前缀或外部 URL。
7. **无鉴权**：默认网关不需要 `Authorization`；部署侧应自行加访问控制。
8. **`/sdcpp/v1/*` 原生异步 API 不可达**：网关只转发兼容端点。

## 目录结构

```
dsh-image-gen/
├── lib/
│   ├── index.js     宿主：配置、设置桥、artifact 路由、三个工具
│   ├── core.js      纯逻辑：端点/尺寸/载荷/图片尺寸解析
│   └── client.js    浏览器：侧栏入口 + 图像工作室 + 设置页 + 工具卡片
├── test/core.test.mjs
├── cordis.patch.yml
├── package.json
└── README*.md
```

## 开发

```bash
node test/core.test.mjs
node --check lib/index.js
node --check lib/client.js
```

## License

MIT
