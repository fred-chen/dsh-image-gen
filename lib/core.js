// dsh-image-gen — pure logic core (no host dependency, unit-testable)
//
// Handles endpoint normalization, size validation, request payloads, error
// formatting, filename safety, and image-dimension sniffing.
// The actual HTTP flow lives in lib/index.js.

export const SIZE_PRESETS = [
  { value: "1024x1024", label: "1024×1024 · 1:1（默认）" },
  { value: "512x512", label: "512×512 · 1:1" },
  { value: "768x768", label: "768×768 · 1:1" },
  { value: "1024x768", label: "1024×768 · 4:3" },
  { value: "768x1024", label: "768×1024 · 3:4" },
  { value: "1344x768", label: "1344×768 · 16:9" },
  { value: "768x1344", label: "768×1344 · 9:16" },
  { value: "1536x1536", label: "1536×1536 · 1:1（较慢）" },
];

export const SIZE_LIMITS = {
  minSide: 256,
  maxSide: 2048,
  maxPixels: 2_359_296,
};

export const MAX_INPUT_BYTES = 20 * 1024 * 1024;

export const DEFAULT_ENDPOINT = "http://ai4090:8080/v1";
export const DEFAULT_MODEL = "Qwen-Image-2.1-Turbo";
export const DEFAULT_SIZE = "1024x1024";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Normalize a user-entered base endpoint to an OpenAI-style `/v1` base.
 * Accepts host:port, /v1, a full /v1/images/... URL, or a base path.
 */
export function normalizeEndpoint(raw) {
  const text = String(raw ?? "").trim();
  if (!text) throw new Error("API 端点不能为空");
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error(`API 端点不是合法 URL：${text}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("API 端点只支持 http/https");
  }
  let pathname = url.pathname.replace(/\/+$/u, "");
  pathname = pathname.replace(/\/images\/(generations|edits)$/u, "");
  if (!pathname) pathname = "/v1";
  else if (!pathname.endsWith("/v1")) pathname = `${pathname}/v1`;
  url.pathname = pathname;
  url.search = "";
  url.hash = "";
  return url.toString();
}

/** Derive every endpoint this plugin needs from one base URL. */
export function apiUrls(raw) {
  const base = new URL(normalizeEndpoint(raw));
  const v1Path = base.pathname;
  const rootPath = v1Path.slice(0, -3); // remove "/v1"
  const at = (pathname) => {
    const url = new URL(base.toString());
    url.pathname = pathname || "/";
    return url.toString();
  };
  return {
    base: base.toString(),
    generations: at(`${v1Path}/images/generations`),
    edits: at(`${v1Path}/images/edits`),
    models: at(`${v1Path}/models`),
    root: at(rootPath || "/"),
    txt2img: at(`${rootPath}/sdapi/v1/txt2img`),
    img2img: at(`${rootPath}/sdapi/v1/img2img`),
    health: at(`${rootPath}/health`),
  };
}

export function normalizeSize(raw) {
  const value = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[×*]/gu, "x")
    .replace(/\s+/gu, "");
  if (!value) return "";
  const match = /^(\d+)x(\d+)$/u.exec(value);
  if (!match) throw new Error(`分辨率必须是 WIDTHxHEIGHT，例如 1024x1024；收到：${value}`);
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error("分辨率宽高必须是正整数");
  }
  if (width < SIZE_LIMITS.minSide || height < SIZE_LIMITS.minSide) {
    throw new Error(`分辨率每边至少 ${SIZE_LIMITS.minSide} 像素`);
  }
  if (width > SIZE_LIMITS.maxSide || height > SIZE_LIMITS.maxSide) {
    throw new Error(`分辨率每边最多 ${SIZE_LIMITS.maxSide} 像素`);
  }
  if (width * height > SIZE_LIMITS.maxPixels) {
    throw new Error(`分辨率总像素不能超过 ${SIZE_LIMITS.maxPixels}`);
  }
  return `${width}x${height}`;
}

export function normalizeN(raw, fallback = 1) {
  const value = raw === undefined || raw === null || raw === "" ? Number(fallback) : Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > 4) {
    throw new Error("n（图片张数）必须是 1–4 的整数");
  }
  return value;
}

export function normalizeSeed(raw, fallback = null) {
  const source = raw === undefined || raw === null || raw === "" ? fallback : raw;
  if (source === undefined || source === null || source === "") return null;
  const value = Number(source);
  if (!Number.isSafeInteger(value)) throw new Error("seed 必须是整数（或留空随机）");
  return value;
}

export function normalizeStrength(raw, fallback = 0.75) {
  const value = raw === undefined || raw === null || raw === "" ? Number(fallback) : Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error("denoising strength 必须在 0–1 之间");
  }
  return Math.round(value * 1000) / 1000;
}

export function buildGenerationPayload({ prompt, model, size, n, seed, negativePrompt }) {
  const payload = { model, prompt, n, size };
  if (seed !== null && seed !== undefined) payload.seed = seed;
  if (negativePrompt) payload.negative_prompt = negativePrompt;
  return payload;
}

export function buildEditPayload({ prompt, model, imageBase64, size, n, seed }) {
  const payload = { model, prompt, n, image: [imageBase64] };
  if (size) payload.size = size;
  if (seed !== null && seed !== undefined) payload.seed = seed;
  return payload;
}

export function buildImg2imgPayload({
  prompt,
  model,
  imageBase64,
  maskBase64,
  size,
  n,
  seed,
  strength,
  invertMask,
  negativePrompt,
}) {
  const payload = {
    model,
    prompt,
    init_images: [imageBase64],
    denoising_strength: strength,
    batch_size: n,
  };
  if (size) {
    const [width, height] = size.split("x").map(Number);
    payload.width = width;
    payload.height = height;
  }
  if (maskBase64) {
    payload.mask = maskBase64;
    payload.inpainting_mask_invert = invertMask ? 1 : 0;
  }
  if (seed !== null && seed !== undefined) payload.seed = seed;
  if (negativePrompt) payload.negative_prompt = negativePrompt;
  return payload;
}

export function formatApiError(status, body) {
  const error = body && typeof body === "object" ? body.error : undefined;
  const raw =
    (error && typeof error === "object" && (error.message || error.detail || error.code)) ||
    (typeof error === "string" ? error : "") ||
    (body && typeof body === "object" && (body.detail || body.message)) ||
    (typeof body === "string" ? body : "");
  const message = typeof raw === "string" ? raw : JSON.stringify(raw);
  return `HTTP ${status}${message ? `：${message}` : ""}`;
}

export function sanitizeFileName(raw) {
  let value = String(raw ?? "").trim();
  if (!value) return "";
  value = value.replace(/^.*[\\/]/u, "");
  value = value.replace(/[<>:"|?*\u0000-\u001f]/gu, "-");
  value = value.replace(/[^\p{L}\p{N}._-]+/gu, "-");
  value = value.replace(/^-+|-+$/gu, "");
  if (value.length > 80) value = value.slice(0, 80);
  return value;
}

export function promptSlug(prompt, maxLength = 40) {
  const slug = String(prompt ?? "")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return (slug || "image").slice(0, maxLength);
}

export function outputFileName({ mode, prompt, index = 0, fileName }) {
  let base = sanitizeFileName(fileName);
  if (!base) base = `${mode}-${promptSlug(prompt)}`;
  if (index > 0) {
    const ext = /\.png$/iu.test(base) ? base.slice(-4) : "";
    const stem = ext ? base.slice(0, -4) : base;
    base = `${stem}-${index + 1}${ext || ".png"}`;
  }
  if (!/\.png$/iu.test(base)) base += ".png";
  return base;
}

/** Read width/height from PNG, JPEG, or WebP bytes; null when unknown. */
export function imageDimensions(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 16) return null;

  if (buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return {
      format: "png",
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
    };
  }

  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      let marker = buffer[offset + 1];
      if (marker === 0xff) {
        offset += 1;
        continue;
      }
      if (marker === 0xd8 || marker === 0xd9) {
        offset += 2;
        continue;
      }
      if (marker === 0xda) break; // start of scan data
      const length = buffer.readUInt16BE(offset + 2);
      if (length < 2) break;
      const isSof =
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf);
      if (isSof) {
        return {
          format: "jpeg",
          width: buffer.readUInt16BE(offset + 7),
          height: buffer.readUInt16BE(offset + 5),
        };
      }
      offset += 2 + length;
    }
    return null;
  }

  if (
    buffer.length >= 30 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    const chunk = buffer.toString("ascii", 12, 16);
    if (chunk === "VP8X") {
      return {
        format: "webp",
        width: 1 + buffer.readUIntLE(24, 3),
        height: 1 + buffer.readUIntLE(27, 3),
      };
    }
    if (chunk === "VP8L") {
      const bits = buffer.readUInt32LE(21);
      return {
        format: "webp",
        width: 1 + (bits & 0x3fff),
        height: 1 + ((bits >>> 14) & 0x3fff),
      };
    }
    if (chunk === "VP8 ") {
      return {
        format: "webp",
        width: buffer.readUInt16LE(26) & 0x3fff,
        height: buffer.readUInt16LE(28) & 0x3fff,
      };
    }
  }

  return null;
}

export function toBase64(buffer) {
  return Buffer.from(buffer).toString("base64");
}

export function stripDataUrlPrefix(value) {
  const text = String(value ?? "").trim();
  const match = /^data:[^;]+;base64,(.*)$/su.exec(text);
  return match ? match[1] : text;
}
