// dsh-image-gen — DeepSeek Harness host plugin
//
// Text-to-image, image-to-image and instruction-based image editing against the
// image services on http://ai4090:8080/v1.
//
// Defaults:
//   endpoint  http://ai4090:8080/v1
//   model     Qwen-Image-2.1-Turbo
//   tools     image_generate, image_to_image, image_edit
//
// Upstream quirks this plugin accounts for:
//   - all endpoints return Base64 PNG; output_format is ignored;
//   - image generation steps are pinned by the model preset;
//   - /v1/images/edits ignores the `mask` field — use RGBA alpha to mark an edit region;
//   - /sdapi/v1/img2img does honour mask + inpainting_mask_invert;
//   - one request at a time per model; concurrent calls return 429.

import { SettingsConflictError } from "@deepseek-ai/dsh-settings";
import { defineTool } from "@deepseek-ai/dsh-tools";
import z from "@deepseek-ai/schemastery";

import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";

import {
  DEFAULT_ENDPOINT,
  DEFAULT_MODEL,
  DEFAULT_SIZE,
  MAX_INPUT_BYTES,
  SIZE_LIMITS,
  SIZE_PRESETS,
  apiUrls,
  buildEditPayload,
  buildGenerationPayload,
  buildImg2imgPayload,
  formatApiError,
  imageDimensions,
  normalizeEndpoint,
  normalizeN,
  normalizeSeed,
  normalizeSize,
  normalizeStrength,
  outputFileName,
  stripDataUrlPrefix,
  toBase64,
} from "./core.js";

const PLUGIN_VERSION = "0.1.0";
const NS = "image-gen";
const BRIDGE_PREFIX = "/api/dsh-image-gen";
const ARTIFACT_PREFIX = "/api/dsh-image-gen/artifacts";
const DEFAULT_OUTPUT_DIR = ".dsh-image-gen";
const MAX_PROMPT_CHARS = 4000;

//#region 配置

function resolveConfig(config) {
  if (config === null || typeof config !== "object") return {};
  const out = {};
  for (const [key, value] of Object.entries(config)) {
    out[key] = value !== null && typeof value === "object" && typeof value.get === "function" ? value.get() : value;
  }
  return out;
}

function normalizeConfig(raw) {
  const cfg = raw && typeof raw === "object" ? raw : {};
  return {
    enabled: cfg.enabled !== false,
    endpoint: String(cfg.endpoint || DEFAULT_ENDPOINT).trim() || DEFAULT_ENDPOINT,
    apiKey: typeof cfg.apiKey === "string" ? cfg.apiKey : "",
    model: String(cfg.model ?? DEFAULT_MODEL).trim() || DEFAULT_MODEL,
    size: String(cfg.size || DEFAULT_SIZE).trim(),
    n: Number(cfg.n ?? 1),
    seed: cfg.seed === undefined || cfg.seed === null ? null : Number(cfg.seed),
    negativePrompt: typeof cfg.negativePrompt === "string" ? cfg.negativePrompt : "",
    outputDir: String(cfg.outputDir || DEFAULT_OUTPUT_DIR).trim() || DEFAULT_OUTPUT_DIR,
    timeoutSec: Number(cfg.timeoutSec ?? 300),
    preserveInputSize: cfg.preserveInputSize !== false,
  };
}

function publicConfig(cfg) {
  const { apiKey, ...rest } = cfg;
  return rest;
}

const Config = z.object({
  enabled: z.boolean().default(true).volatile(),
  endpoint: z.string().default(DEFAULT_ENDPOINT).volatile(),
  apiKey: z.string().role("secret").volatile(),
  model: z.string().default(DEFAULT_MODEL).volatile(),
  size: z.string().default(DEFAULT_SIZE).volatile(),
  n: z.number().default(1).volatile(),
  seed: z.number().volatile(),
  negativePrompt: z.string().default("").volatile(),
  outputDir: z.string().default(DEFAULT_OUTPUT_DIR).volatile(),
  timeoutSec: z.number().default(300).volatile(),
  preserveInputSize: z.boolean().default(true).volatile(),
});

//#endregion
//#region HTTP helpers

function writeJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    "cache-control": "no-store",
  });
  res.end(text);
}

async function readJsonBody(req, maxBytes = 32 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) return undefined;
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    return undefined;
  }
}

function requestHeaders(apiKey, json) {
  const headers = {};
  if (json) headers["content-type"] = "application/json";
  if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`;
    headers["x-api-key"] = apiKey;
  }
  return headers;
}

async function readJsonResponse(res) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function fetchWithTimeout(url, options, timeoutMs, signal) {
  if (signal?.aborted) throw signal.reason || new Error("aborted");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
  const onAbort = () => controller.abort(signal.reason || new Error("aborted"));
  if (signal) signal.addEventListener("abort", onAbort, { once: true });
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (signal?.aborted) throw signal.reason || new Error("aborted");
    if (controller.signal.aborted) throw new Error(`请求超时（${timeoutMs}ms）：${url}`);
    throw error;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onAbort);
  }
}

function decodePngItems(body) {
  const items = Array.isArray(body?.data) ? body.data : [];
  const buffers = [];
  for (const item of items) {
    if (item && typeof item.b64_json === "string" && item.b64_json) {
      buffers.push(Buffer.from(stripDataUrlPrefix(item.b64_json), "base64"));
    }
  }
  return buffers;
}

function decodeSdapiImages(body) {
  const list = Array.isArray(body?.images) ? body.images : [];
  return list
    .filter((value) => typeof value === "string" && value)
    .map((value) => Buffer.from(stripDataUrlPrefix(value), "base64"));
}

//#endregion
//#region 生成流程

function timeoutMs(cfg) {
  return Math.max(30, Math.min(900, Number(cfg.timeoutSec) || 300)) * 1000;
}

async function generateImages(cfg, { prompt, size, n, seed, negativePrompt, signal }) {
  const urls = apiUrls(cfg.endpoint);
  const payload = buildGenerationPayload({
    prompt,
    model: cfg.model,
    size,
    n,
    seed,
    negativePrompt,
  });
  const res = await fetchWithTimeout(
    urls.generations,
    { method: "POST", headers: requestHeaders(cfg.apiKey, true), body: JSON.stringify(payload) },
    timeoutMs(cfg),
    signal
  );
  const body = await readJsonResponse(res);
  if (!res.ok) throw new Error(`文生图失败：${formatApiError(res.status, body)}`);
  const buffers = decodePngItems(body);
  if (buffers.length === 0) throw new Error("文生图失败：服务端未返回图片数据");
  return { buffers, outputFormat: body.output_format || "png" };
}

async function editImage(cfg, { prompt, imageBase64, size, n, seed, signal }) {
  const urls = apiUrls(cfg.endpoint);
  const payload = buildEditPayload({ prompt, model: cfg.model, imageBase64, size, n, seed });
  const res = await fetchWithTimeout(
    urls.edits,
    { method: "POST", headers: requestHeaders(cfg.apiKey, true), body: JSON.stringify(payload) },
    timeoutMs(cfg),
    signal
  );
  const body = await readJsonResponse(res);
  if (!res.ok) throw new Error(`图片编辑失败：${formatApiError(res.status, body)}`);
  const buffers = decodePngItems(body);
  if (buffers.length === 0) throw new Error("图片编辑失败：服务端未返回图片数据");
  return { buffers, outputFormat: body.output_format || "png" };
}

async function img2img(cfg, {
  prompt,
  imageBase64,
  maskBase64,
  size,
  n,
  seed,
  strength,
  invertMask,
  negativePrompt,
  signal,
}) {
  const urls = apiUrls(cfg.endpoint);
  const payload = buildImg2imgPayload({
    prompt,
    model: cfg.model,
    imageBase64,
    maskBase64,
    size,
    n,
    seed,
    strength,
    invertMask,
    negativePrompt,
  });
  const res = await fetchWithTimeout(
    urls.img2img,
    { method: "POST", headers: requestHeaders(cfg.apiKey, true), body: JSON.stringify(payload) },
    timeoutMs(cfg),
    signal
  );
  const body = await readJsonResponse(res);
  if (!res.ok) throw new Error(`图生图失败：${formatApiError(res.status, body)}`);
  const buffers = decodeSdapiImages(body);
  if (buffers.length === 0) throw new Error("图生图失败：服务端未返回图片数据");
  return { buffers };
}

function assertInputImage(buffer, label) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error(`${label}为空`);
  if (buffer.length > MAX_INPUT_BYTES) {
    throw new Error(`${label}超过 ${Math.round(MAX_INPUT_BYTES / 1024 / 1024)}MB 上限`);
  }
  const dims = imageDimensions(buffer);
  if (!dims || !dims.width || !dims.height) {
    throw new Error(`${label}不是可识别的 PNG/JPEG/WebP 图片`);
  }
  return dims;
}

function resolveUserPath(raw, cwd) {
  const text = String(raw ?? "").trim();
  if (!text) throw new Error("image 路径不能为空");
  if (text.startsWith("~/")) return path.resolve(process.env.HOME || cwd, text.slice(2));
  return path.isAbsolute(text) ? text : path.resolve(cwd, text);
}

function sizeForSource(cfg, dims, explicit) {
  if (explicit) return normalizeSize(explicit);
  if (cfg.preserveInputSize && dims) {
    try {
      return normalizeSize(`${dims.width}x${dims.height}`);
    } catch {
      return ""; // let the upstream decide for oversized inputs
    }
  }
  return "";
}

async function pathExists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function uniqueOutputPath(dir, fileName) {
  const candidate = path.join(dir, fileName);
  if (!(await pathExists(candidate))) return candidate;
  const ext = path.extname(fileName);
  const stem = fileName.slice(0, fileName.length - ext.length);
  for (let index = 1; index < 1000; index += 1) {
    const next = path.join(dir, `${stem}-${index}${ext}`);
    if (!(await pathExists(next))) return next;
  }
  return path.join(dir, `${stem}-${Date.now()}${ext}`);
}

async function saveBuffers({ buffers, cfg, mode, prompt, fileName, cwd, registerArtifact, publicBase }) {
  const outputDir = path.resolve(cwd, cfg.outputDir || DEFAULT_OUTPUT_DIR);
  await mkdir(outputDir, { recursive: true });
  const saved = [];
  for (let index = 0; index < buffers.length; index += 1) {
    const buffer = buffers[index];
    const name = outputFileName({ mode, prompt, index, fileName });
    const filePath = await uniqueOutputPath(outputDir, name);
    await writeFile(filePath, buffer);
    const token = registerArtifact(filePath, path.basename(filePath));
    const dims = imageDimensions(buffer);
    saved.push({
      filePath,
      url: `${publicBase}${ARTIFACT_PREFIX}/${token}`,
      bytes: buffer.length,
      width: dims?.width,
      height: dims?.height,
    });
  }
  return saved;
}

//#endregion
//#region 设置桥与预览

function makeBridgeRoutes({ describe, save, test, preview }) {
  const wrap = (handler) => async (req, res) => {
    if (req.method !== "POST") {
      writeJson(res, 405, { ok: false, code: "method-not-allowed", message: "use POST" });
      return;
    }
    try {
      const body = await readJsonBody(req);
      if (body === undefined) {
        writeJson(res, 400, { ok: false, code: "bad-request", message: "malformed or oversized JSON body" });
        return;
      }
      writeJson(res, 200, await handler(body));
    } catch (error) {
      writeJson(res, 500, {
        ok: false,
        code: "internal",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };
  return [
    { kind: "exact", path: `${BRIDGE_PREFIX}/describe`, handler: wrap(describe) },
    { kind: "exact", path: `${BRIDGE_PREFIX}/save`, handler: wrap(save) },
    { kind: "exact", path: `${BRIDGE_PREFIX}/test`, handler: wrap(test) },
    { kind: "exact", path: `${BRIDGE_PREFIX}/preview`, handler: wrap(preview) },
  ];
}

function handleArtifactRequest(req, res, artifacts) {
  (async () => {
    try {
      if (req.method !== "GET" && req.method !== "HEAD") {
        writeJson(res, 405, { ok: false, code: "method-not-allowed", message: "use GET or HEAD" });
        return;
      }
      const url = new URL(req.url || "/", "http://127.0.0.1");
      if (!url.pathname.startsWith(`${ARTIFACT_PREFIX}/`)) {
        writeJson(res, 404, { ok: false, code: "not-found", message: "artifact not found" });
        return;
      }
      const token = url.pathname.slice(ARTIFACT_PREFIX.length + 1);
      if (!token || token.includes("/")) {
        writeJson(res, 404, { ok: false, code: "not-found", message: "artifact not found" });
        return;
      }
      const entry = artifacts.get(token);
      if (!entry) {
        writeJson(res, 404, { ok: false, code: "not-found", message: "artifact not found" });
        return;
      }
      const info = await stat(entry.path);
      if (!info.isFile()) {
        writeJson(res, 404, { ok: false, code: "not-found", message: "artifact file not found" });
        return;
      }
      res.writeHead(200, {
        "content-type": entry.mime || "image/png",
        "content-length": String(info.size),
        "cache-control": "private, max-age=86400",
        "content-disposition": `inline; filename="${String(entry.name || "image.png").replace(/["\\]/gu, "-")}"`,
      });
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      createReadStream(entry.path).pipe(res);
    } catch (error) {
      if (!res.headersSent) {
        writeJson(res, 500, {
          ok: false,
          code: "internal",
          message: error instanceof Error ? error.message : String(error),
        });
      } else {
        res.destroy();
      }
    }
  })().catch(() => {});
}

//#endregion
//#region 工具

const IMAGE_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    mode: { type: "string" },
    model: { type: "string" },
    prompt: { type: "string" },
    size: { type: "string" },
    seed: { type: "number" },
    elapsedSeconds: { type: "number" },
    images: {
      type: "array",
      items: {
        type: "object",
        properties: {
          filePath: { type: "string" },
          url: { type: "string" },
          bytes: { type: "number" },
          width: { type: "number" },
          height: { type: "number" },
        },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
};

function renderImages(modeLabel, value) {
  const lines = [`图像${modeLabel}完成：${value.images.length} 张`];
  for (const image of value.images) {
    lines.push(`- ${image.filePath}`);
  }
  if (value.images[0]) lines.push(`浏览器预览：${value.images[0].url}`);
  lines.push(
    `分辨率 ${value.size || "服务端默认"} · 模型 ${value.model}` +
      (Number.isFinite(value.seed) ? ` · seed ${value.seed}` : "")
  );
  lines.push(
    `结果 JSON：${JSON.stringify({
      mode: value.mode,
      model: value.model,
      prompt: value.prompt,
      size: value.size,
      seed: value.seed,
      images: value.images.map((image) => ({
        filePath: image.filePath,
        bytes: image.bytes,
        width: image.width,
        height: image.height,
      })),
      elapsedSeconds: value.elapsedSeconds,
    })}`
  );
  return [{ type: "text", text: lines.join("\n") }];
}

function imagePresentationMeta(value) {
  return {
    mode: value.mode,
    prompt: value.prompt,
    model: value.model,
    size: value.size,
    images: value.images,
  };
}

function buildImageTool({ kind, current, publicBase, registerArtifact, logger }) {
  const isGenerate = kind === "image_generate";
  const isEdit = kind === "image_edit";
  const mode = isGenerate ? "generate" : isEdit ? "edit" : "img2img";
  const modeLabel = isGenerate ? "生成" : isEdit ? "编辑" : "图生图";

  const parameters = isGenerate
    ? {
        prompt: {
          type: "string",
          required: true,
          description: "Image prompt, up to 4000 characters.",
        },
        size: {
          type: "string",
          description: "Output size WIDTHxHEIGHT (256–2048 per side), e.g. 1024x1024. Defaults to the plugin setting.",
        },
        n: {
          type: "integer",
          description: "Number of images, 1–4. Defaults to the plugin setting.",
        },
        seed: {
          type: "integer",
          description: "Seed for reproducibility; omit for the plugin/default seed.",
        },
        negativePrompt: {
          type: "string",
          description: "Optional negative prompt (forwarded as negative_prompt).",
        },
        fileName: {
          type: "string",
          description: "Optional output basename; .png is added automatically.",
        },
      }
    : isEdit
      ? {
          image: {
            type: "string",
            required: true,
            description: "Path to an existing PNG/JPEG/WebP, relative to the session workspace or absolute.",
          },
          prompt: {
            type: "string",
            required: true,
            description: "Editing instruction, e.g. 'make the lighthouse red'.",
          },
          size: {
            type: "string",
            description: "Output size WIDTHxHEIGHT. Omit to preserve the input size (plugin default).",
          },
          n: {
            type: "integer",
            description: "Number of edited images, 1–4.",
          },
          seed: {
            type: "integer",
            description: "Seed for reproducibility.",
          },
          fileName: {
            type: "string",
            description: "Optional output basename; .png is added automatically.",
          },
        }
      : {
          image: {
            type: "string",
            required: true,
            description: "Path to the init image (PNG/JPEG/WebP), relative to the session workspace or absolute.",
          },
          prompt: {
            type: "string",
            required: true,
            description: "Image-to-image prompt, e.g. 'turn the scene into night'.",
          },
          size: {
            type: "string",
            description: "Output size WIDTHxHEIGHT. Omit to preserve the input size.",
          },
          strength: {
            type: "number",
            description: "Denoising strength, 0–1 (default 0.75).",
          },
          mask: {
            type: "string",
            description: "Optional mask image path (white = repaint region). Works on this endpoint.",
          },
          invertMask: {
            type: "boolean",
            description: "Invert the mask (repaint outside the white region).",
          },
          n: {
            type: "integer",
            description: "Number of images, 1–4.",
          },
          seed: {
            type: "integer",
            description: "Seed for reproducibility.",
          },
          fileName: {
            type: "string",
            description: "Optional output basename; .png is added automatically.",
          },
        };

  const description = isGenerate
    ? "Generate image(s) from text with the configured OpenAI-compatible /v1/images/generations endpoint (default http://ai4090:8080/v1, model Qwen-Image-2.1-Turbo). Returns Base64 PNG images, saves them to the session workspace, and returns local paths plus browser-playable URLs. output_format is ignored by the upstream (always PNG); sampling steps are pinned by the model preset."
    : isEdit
      ? "Edit an existing image with a natural-language instruction using the OpenAI-compatible /v1/images/edits endpoint (default http://ai4090:8080/v1). Saves PNG output to the session workspace and returns local paths plus browser URLs. To restrict the edited region, supply an RGBA input with alpha=0 there; the upstream `mask` field is ignored on this endpoint."
      : "Image-to-image / inpainting with the A1111-compatible /sdapi/v1/img2img endpoint (default http://ai4090:8080). `strength` controls denoising, an optional `mask` marks the repaint region, and `invertMask` reverses it. Saves PNG output to the session workspace and returns local paths plus browser URLs.";

  return defineTool({
    name: kind,
    description,
    parameters,
    output: {
      schema: IMAGE_OUTPUT_SCHEMA,
      render(args, value) {
        return renderImages(modeLabel, value);
      },
      presentationMeta(args, value) {
        return imagePresentationMeta(value);
      },
    },
    presentCall(args) {
      return {
        card: "generic",
        kind: "other",
        title: `${modeLabel}图像`,
        rawInput: isGenerate
          ? { prompt: args.prompt, size: args.size, n: args.n }
          : { image: args.image, prompt: args.prompt, size: args.size, strength: args.strength },
      };
    },
    async execute(args, exec) {
      const cfg = current();
      if (!cfg.enabled) throw new Error(`${kind} 已在插件设置中禁用`);

      const prompt = String(args.prompt ?? "").trim();
      if (!prompt) throw new Error("prompt 不能为空");
      if (prompt.length > MAX_PROMPT_CHARS) {
        throw new Error(`prompt 不能超过 ${MAX_PROMPT_CHARS} 个字符（当前 ${prompt.length}）`);
      }

      const n = normalizeN(args.n ?? cfg.n, cfg.n);
      const seed = normalizeSeed(args.seed, cfg.seed);
      const started = Date.now();
      const cwd = exec.agent?.session?.header?.cwd || process.cwd();

      let buffers;
      let size = "";

      if (isGenerate) {
        size = normalizeSize(args.size ?? cfg.size);
        const negativePrompt = args.negativePrompt ?? cfg.negativePrompt;
        logger?.info?.(`image-gen: generate prompt chars=${prompt.length} size=${size} n=${n}`);
        ({ buffers } = await generateImages(cfg, { prompt, size, n, seed, negativePrompt, signal: exec.signal }));
      } else {
        const imagePath = resolveUserPath(args.image, cwd);
        const inputBuffer = await readFile(imagePath);
        const dims = assertInputImage(inputBuffer, `输入图片 ${imagePath}`);
        size = sizeForSource(cfg, dims, args.size);

        if (isEdit) {
          logger?.info?.(`image-gen: edit ${imagePath} size=${size} n=${n}`);
          ({ buffers } = await editImage(cfg, {
            prompt,
            imageBase64: toBase64(inputBuffer),
            size,
            n,
            seed,
            signal: exec.signal,
          }));
        } else {
          let maskBase64 = "";
          if (args.mask) {
            const maskPath = resolveUserPath(args.mask, cwd);
            const maskBuffer = await readFile(maskPath);
            assertInputImage(maskBuffer, `mask ${maskPath}`);
            maskBase64 = toBase64(maskBuffer);
          }
          const strength = normalizeStrength(args.strength, 0.75);
          logger?.info?.(`image-gen: img2img ${imagePath} size=${size} strength=${strength} n=${n}`);
          ({ buffers } = await img2img(cfg, {
            prompt,
            imageBase64: toBase64(inputBuffer),
            maskBase64,
            size,
            n,
            seed,
            strength,
            invertMask: args.invertMask === true,
            negativePrompt: cfg.negativePrompt,
            signal: exec.signal,
          }));
        }
      }

      const images = await saveBuffers({
        buffers,
        cfg,
        mode,
        prompt,
        fileName: args.fileName,
        cwd,
        registerArtifact,
        publicBase,
      });
      const elapsedSeconds = Math.round((Date.now() - started) / 100) / 10;
      const result = {
        mode,
        model: cfg.model,
        prompt,
        size,
        elapsedSeconds,
        images,
      };
      if (Number.isFinite(seed)) result.seed = seed;
      return result;
    },
  });
}

//#endregion
//#region 插件

function apply(ctx, config) {
  const logger = ctx.logger;
  const current = () => normalizeConfig(resolveConfig(config));
  const artifacts = new Map();

  const registerArtifact = (filePath, name) => {
    const token = randomBytes(18).toString("base64url");
    artifacts.set(token, {
      path: path.resolve(filePath),
      name,
      mime: "image/png",
    });
    while (artifacts.size > 500) {
      const oldest = artifacts.keys().next().value;
      artifacts.delete(oldest);
    }
    return token;
  };

  const getDescriptor = () => {
    let settings;
    try {
      settings = ctx.get("settings");
    } catch {
      settings = undefined;
    }
    if (!settings || typeof settings.describe !== "function") return undefined;
    try {
      return settings.describe({ redactSecrets: true }).find((candidate) => String(candidate.ns) === NS);
    } catch {
      return undefined;
    }
  };

  const describe = async () => {
    const descriptor = getDescriptor();
    let toolNames = [];
    let toolError = "";
    try {
      const toolRuntime = ctx.get("tools");
      toolNames = toolRuntime && typeof toolRuntime.schemas === "function"
        ? toolRuntime.schemas().map((schema) => schema.name)
        : [];
    } catch (error) {
      toolError = error instanceof Error ? error.message : String(error);
    }
    return {
      ok: true,
      value: {
        ns: NS,
        version: PLUGIN_VERSION,
        revision: descriptor ? descriptor.revision : 0,
        config: descriptor ? descriptor.value : publicConfig(current()),
        secrets: descriptor && Array.isArray(descriptor.secrets) ? descriptor.secrets : [],
        presets: SIZE_PRESETS,
        limits: SIZE_LIMITS,
        defaultEndpoint: DEFAULT_ENDPOINT,
        defaultModel: DEFAULT_MODEL,
        capabilities: ["text-to-image", "image-to-image", "image-edit"],
        toolRegistered: ["image_generate", "image_to_image", "image_edit"].every((name) => toolNames.includes(name)),
        toolNames,
        toolError,
      },
    };
  };

  const save = async (body) => {
    if (body === null || typeof body !== "object") {
      return { ok: false, code: "bad-request", message: "malformed save request" };
    }
    let endpoint;
    let size;
    let n;
    let seed;
    try {
      endpoint = normalizeEndpoint(body.endpoint ?? current().endpoint);
      size = normalizeSize(body.size ?? current().size);
      n = normalizeN(body.n ?? current().n, current().n);
      seed = normalizeSeed(body.seed, null);
    } catch (error) {
      return { ok: false, code: "invalid-config", message: error instanceof Error ? error.message : String(error) };
    }

    const timeoutSec = Number(body.timeoutSec ?? current().timeoutSec);
    if (!Number.isInteger(timeoutSec) || timeoutSec < 30 || timeoutSec > 900) {
      return { ok: false, code: "invalid-config", message: "timeoutSec 必须是 30–900 的整数" };
    }
    const outputDir = String(body.outputDir ?? current().outputDir).trim();
    if (!outputDir) return { ok: false, code: "invalid-config", message: "outputDir 不能为空" };
    const model = String(body.model ?? current().model).trim();
    if (!model) return { ok: false, code: "invalid-config", message: "model 不能为空" };
    const negativePrompt = String(body.negativePrompt ?? current().negativePrompt).slice(0, MAX_PROMPT_CHARS);

    const ops = [
      { op: "set", path: ["enabled"], value: body.enabled !== false },
      { op: "set", path: ["endpoint"], value: endpoint },
      { op: "set", path: ["model"], value: model },
      { op: "set", path: ["size"], value: size },
      { op: "set", path: ["n"], value: n },
      { op: "set", path: ["outputDir"], value: outputDir },
      { op: "set", path: ["timeoutSec"], value: timeoutSec },
      { op: "set", path: ["preserveInputSize"], value: body.preserveInputSize !== false },
      { op: "set", path: ["negativePrompt"], value: negativePrompt },
    ];
    if (seed === null) ops.push({ op: "unset", path: ["seed"] });
    else ops.push({ op: "set", path: ["seed"], value: seed });

    if (typeof body.apiKey === "string" && body.apiKey.trim()) {
      ops.push({ op: "set", path: ["apiKey"], value: body.apiKey.trim() });
    } else if (body.clearApiKey === true) {
      ops.push({ op: "unset", path: ["apiKey"] });
    }

    const expectedRevision = typeof body.expectedRevision === "number" ? body.expectedRevision : undefined;
    try {
      await ctx.get("settings").mutate(NS, ops, expectedRevision);
    } catch (error) {
      if (error instanceof SettingsConflictError) {
        return { ok: false, code: "settings-conflict", message: error.message };
      }
      return { ok: false, code: "internal", message: error instanceof Error ? error.message : String(error) };
    }
    return describe();
  };

  const test = async (body) => {
    const cfg = current();
    let endpoint;
    try {
      endpoint = normalizeEndpoint(body.endpoint ?? cfg.endpoint);
    } catch (error) {
      return { ok: false, code: "invalid-endpoint", message: error instanceof Error ? error.message : String(error) };
    }
    const apiKey = typeof body.apiKey === "string" && body.apiKey.trim() ? body.apiKey.trim() : cfg.apiKey;
    const urls = apiUrls(endpoint);
    const headers = requestHeaders(apiKey, false);
    const TEST_TIMEOUT_MS = 5_000;

    let models = [];
    let modelsError = "";
    try {
      const res = await fetchWithTimeout(urls.models, { headers }, TEST_TIMEOUT_MS);
      const payload = await readJsonResponse(res);
      if (res.ok && payload && Array.isArray(payload.data)) models = payload.data;
      else modelsError = formatApiError(res.status, payload);
    } catch (error) {
      modelsError = error instanceof Error ? error.message : String(error);
    }

    let health = null;
    let healthError = "";
    try {
      const res = await fetchWithTimeout(urls.health, { headers }, TEST_TIMEOUT_MS);
      const payload = await readJsonResponse(res);
      if (res.ok) health = payload;
      else healthError = formatApiError(res.status, payload);
    } catch (error) {
      healthError = error instanceof Error ? error.message : String(error);
    }

    const model = models.find((entry) => entry && String(entry.id) === cfg.model);
    return {
      ok: true,
      value: {
        endpoint,
        modelsUrl: urls.models,
        healthUrl: urls.health,
        reachable: models.length > 0 || health !== null || modelsError === "",
        modelFound: Boolean(model),
        model: model
          ? {
              id: model.id,
              status: model.status,
              architecture: model.architecture,
              capabilities: model.capabilities,
            }
          : null,
        models,
        modelsError,
        health,
        healthError,
      },
    };
  };

  const preview = async (body) => {
    const cfg = current();
    if (!cfg.enabled) return { ok: false, code: "disabled", message: "插件已在设置中禁用" };

    const mode = String(body.mode ?? "generate");
    const prompt = String(body.prompt ?? "").trim();
    if (!prompt) return { ok: false, code: "invalid-prompt", message: "prompt 不能为空" };
    if (prompt.length > MAX_PROMPT_CHARS) {
      return { ok: false, code: "invalid-prompt", message: `prompt 不能超过 ${MAX_PROMPT_CHARS} 个字符` };
    }

    let n;
    let seed;
    let size;
    let strength;
    try {
      n = normalizeN(body.n ?? cfg.n, cfg.n);
      seed = normalizeSeed(body.seed, cfg.seed);
      size = body.size ? normalizeSize(body.size) : "";
      strength = normalizeStrength(body.strength, 0.75);
    } catch (error) {
      return { ok: false, code: "invalid-config", message: error instanceof Error ? error.message : String(error) };
    }

    let imageBuffer = null;
    let maskBuffer = null;
    let dims = null;
    if (mode === "edit" || mode === "img2img") {
      if (!body.imageBase64) return { ok: false, code: "missing-image", message: "请上传一张图片" };
      try {
        imageBuffer = Buffer.from(stripDataUrlPrefix(body.imageBase64), "base64");
        dims = assertInputImage(imageBuffer, "上传图片");
      } catch (error) {
        return { ok: false, code: "invalid-image", message: error instanceof Error ? error.message : String(error) };
      }
      if (body.maskBase64) {
        try {
          maskBuffer = Buffer.from(stripDataUrlPrefix(body.maskBase64), "base64");
          assertInputImage(maskBuffer, "mask");
        } catch (error) {
          return { ok: false, code: "invalid-mask", message: error instanceof Error ? error.message : String(error) };
        }
      }
    }

    if (mode === "generate") {
      if (!size) size = normalizeSize(cfg.size);
    } else if (!size) {
      size = sizeForSource(cfg, dims, "");
    }

    const started = Date.now();
    try {
      let buffers;
      if (mode === "generate") {
        ({ buffers } = await generateImages(cfg, {
          prompt,
          size,
          n,
          seed,
          negativePrompt: body.negativePrompt ?? cfg.negativePrompt,
          signal: undefined,
        }));
      } else if (mode === "edit") {
        ({ buffers } = await editImage(cfg, {
          prompt,
          imageBase64: toBase64(imageBuffer),
          size,
          n,
          seed,
          signal: undefined,
        }));
      } else if (mode === "img2img") {
        ({ buffers } = await img2img(cfg, {
          prompt,
          imageBase64: toBase64(imageBuffer),
          maskBase64: maskBuffer ? toBase64(maskBuffer) : "",
          size,
          n,
          seed,
          strength,
          invertMask: body.invertMask === true,
          negativePrompt: cfg.negativePrompt,
          signal: undefined,
        }));
      } else {
        return { ok: false, code: "invalid-mode", message: "mode 只能是 generate / edit / img2img" };
      }

      const images = buffers.map((buffer) => {
        const info = imageDimensions(buffer);
        return {
          dataUrl: `data:image/png;base64,${buffer.toString("base64")}`,
          bytes: buffer.length,
          width: info?.width,
          height: info?.height,
        };
      });
      return {
        ok: true,
        value: {
          mode,
          model: cfg.model,
          prompt,
          size,
          n,
          seed,
          images,
          elapsedSeconds: Math.round((Date.now() - started) / 100) / 10,
        },
      };
    } catch (error) {
      return { ok: false, code: "upstream", message: error instanceof Error ? error.message : String(error) };
    }
  };

  ctx.inject(["webServer", "settings"], (sctx) => {
    sctx.effect(() => sctx.settings.configure({ auto: false }, ctx.fiber), "image-gen: settings page policy");

    sctx.effect(() => {
      const disposers = makeBridgeRoutes({ describe, save, test, preview }).map((route) => sctx.webServer.register(route));
      disposers.push(
        sctx.webServer.register({
          kind: "prefix",
          path: ARTIFACT_PREFIX,
          handler: (req, res) => handleArtifactRequest(req, res, artifacts),
        })
      );
      return () => {
        for (const dispose of disposers) dispose();
      };
    }, "image-gen: bridge and artifact routes");

    logger.info(`image-gen: bridge ready at ${BRIDGE_PREFIX} (${PLUGIN_VERSION})`);
  });

  ctx.inject(["tools", "webServer", "settings"], (sctx) => {
    let disposers = [];
    const refresh = () => {
      for (const dispose of disposers) dispose();
      disposers = [];
      if (!current().enabled) return;
      const publicBase = `http://127.0.0.1:${sctx.webServer.port}`;
      for (const kind of ["image_generate", "image_to_image", "image_edit"]) {
        disposers.push(
          sctx.tools.register(
            buildImageTool({ kind, current, publicBase, registerArtifact, logger })
          )
        );
      }
    };

    sctx.effect(() => {
      refresh();
      return () => {
        for (const dispose of disposers) dispose();
        disposers = [];
      };
    }, "image-gen: image tools");

    sctx.on("settings/document-updated", (ns) => {
      if (String(ns) === NS) refresh();
    });
  });

  logger.info(
    `image-gen: ready (${PLUGIN_VERSION}) — configure at Plugins → dsh-image-gen → image-gen; tools: image_generate, image_to_image, image_edit`
  );
}

export { Config, apply, PLUGIN_VERSION, NS, BRIDGE_PREFIX, ARTIFACT_PREFIX };
