# dsh-image-gen

A DeepSeek Harness plugin that brings **text-to-image**, **image-to-image** and **instruction-based image editing** into DSH conversations, with a left-sidebar studio page and three model-callable tools.

- **Tools**: `image_generate`, `image_to_image`, `image_edit`
- **Sidebar entry**: `图像` (Images) panel with Generate / Image-to-image / Edit / Settings tabs
- **Default endpoint**: `http://ai4090:8080/v1`
- **Default model**: `Qwen-Image-2.1-Turbo`
- **Outputs**: PNG files saved to the session workspace (default `.dsh-image-gen/`), returned as local paths plus browser-playable URLs
- **Configurable**: endpoint, model, default size, image count, seed, output dir, timeout, API key, preserve-input-size

## Why a separate image plugin?

This plugin is intentionally **added alongside** `dsh-video-gen` and `dsh-tts`, not as a replacement for them.

- Image, video and TTS live on different backends and endpoints (`ai4090:8080/v1`, `ai9700:8080/upstream/...`, `ai4090:8080/v1/audio`).
- Keeping the video and TTS plugins untouched avoids regressions and preserves their existing tool names/config in old sessions.
- Three well-named image tools are easier for an LLM to select than one giant media tool with overlapping parameters.
- A future aggregation plugin (e.g. `dsh-media`) can compose the three without merging their implementations.

## Tools

### `image_generate`

`POST /v1/images/generations`

```json
{ "prompt": "a red apple on a wooden table", "size": "1024x1024", "n": 1, "seed": 42 }
```

The upstream ignores `output_format` (always PNG) and pins sampling steps to the model preset.

### `image_to_image`

`POST /sdapi/v1/img2img`

```json
{ "image": "lighthouse.png", "prompt": "turn the scene into night", "strength": 0.6 }
```

`strength` is denoising strength (0–1, default 0.75). `mask` marks the repaint region and `invertMask` reverses it — this is the only endpoint where mask works.

### `image_edit`

`POST /v1/images/edits`

```json
{ "image": "lighthouse.png", "prompt": "make the lighthouse red", "size": "512x512" }
```

The upstream `mask` field is accepted but ignored here. To restrict the edit region, supply an RGBA image with `alpha=0` in that region.

## Install

```bash
cd ~/.dsh/profiles/desktop
pnpm add github:fred-chen/dsh-image-gen#v0.1.1
```

Add `dsh-image-gen` to `dsh.profile.bundles` in the profile `package.json`, and add the insert row from this package's `cordis.patch.yml` to the profile patch. Restart DSH and hard-refresh the browser.

## Configuration

| Field | Default | Notes |
|---|---|---|
| `enabled` | `true` | Disabling removes the tools |
| `endpoint` | `http://ai4090:8080/v1` | Normalized to a `/v1` base |
| `model` | `Qwen-Image-2.1-Turbo` | Sent to all image endpoints |
| `size` | `1024x1024` | 256–2048 per side, total pixels ≤ 2,359,296 |
| `n` | `1` | 1–4 |
| `seed` | empty | Empty = server default/random |
| `negativePrompt` | empty | Default negative prompt |
| `outputDir` | `.dsh-image-gen` | Relative to the session workspace |
| `timeoutSec` | `300` | 30–900 |
| `preserveInputSize` | `true` | Edit/img2img use input dimensions when `size` is omitted |
| `apiKey` | empty | Secret; only for gateways that require auth |

## Upstream quirks

1. One request at a time per model; concurrent calls return `429`.
2. `steps` cannot be changed — the Turbo preset fixes 8 steps.
3. `output_format` is ignored — always PNG.
4. `/v1/images/edits` ignores `mask`; use RGBA alpha instead.
5. Edits default to a 1024×1024 canvas; the plugin preserves input size by default for speed.
6. JSON edits require `image` to be an array of raw base64 strings.
7. No auth on the default gateway.
8. Native `/sdcpp/v1/*` async APIs are not forwarded by the gateway.

## Development

```bash
node test/core.test.mjs
node --check lib/index.js
node --check lib/client.js
```

MIT licensed.
