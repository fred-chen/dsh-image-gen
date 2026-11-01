import assert from "node:assert/strict";
import {
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
  sanitizeFileName,
  stripDataUrlPrefix,
} from "../lib/core.js";

function test(name, fn) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const PNG_1x1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

test("endpoint: /v1 stays", () => {
  assert.equal(normalizeEndpoint("http://ai4090:8080/v1"), "http://ai4090:8080/v1");
});

test("endpoint: host:port gets /v1", () => {
  assert.equal(normalizeEndpoint("http://ai4090:8080"), "http://ai4090:8080/v1");
});

test("endpoint: full generations URL reduces to /v1", () => {
  assert.equal(
    normalizeEndpoint("http://ai4090:8080/v1/images/generations"),
    "http://ai4090:8080/v1"
  );
});

test("endpoint: full edits URL reduces to /v1", () => {
  assert.equal(normalizeEndpoint("http://ai4090:8080/v1/images/edits"), "http://ai4090:8080/v1");
});

test("endpoint: base path gets /v1 suffix", () => {
  assert.equal(normalizeEndpoint("http://host:8080/api"), "http://host:8080/api/v1");
});

test("endpoint: non-http rejected", () => {
  assert.throws(() => normalizeEndpoint("ftp://host/v1"), /http\/https/);
});

test("apiUrls: default gateway", () => {
  const urls = apiUrls("http://ai4090:8080/v1");
  assert.equal(urls.generations, "http://ai4090:8080/v1/images/generations");
  assert.equal(urls.edits, "http://ai4090:8080/v1/images/edits");
  assert.equal(urls.models, "http://ai4090:8080/v1/models");
  assert.equal(urls.img2img, "http://ai4090:8080/sdapi/v1/img2img");
  assert.equal(urls.txt2img, "http://ai4090:8080/sdapi/v1/txt2img");
  assert.equal(urls.health, "http://ai4090:8080/health");
});

test("size: square and non-square accepted", () => {
  assert.equal(normalizeSize("1024x1024"), "1024x1024");
  assert.equal(normalizeSize(" 768 × 512 "), "768x512");
});

test("size: empty means default", () => {
  assert.equal(normalizeSize(""), "");
});

test("size: bounds", () => {
  assert.throws(() => normalizeSize("200x200"), /至少 256/);
  assert.throws(() => normalizeSize("2049x1024"), /最多 2048/);
  assert.throws(() => normalizeSize("2048x2048"), /总像素/);
  assert.throws(() => normalizeSize("1000"), /WIDTHxHEIGHT/);
});

test("n / seed / strength validation", () => {
  assert.equal(normalizeN("3"), 3);
  assert.throws(() => normalizeN("0"), /1–4/);
  assert.throws(() => normalizeN("5"), /1–4/);
  assert.equal(normalizeSeed("42"), 42);
  assert.equal(normalizeSeed(""), null);
  assert.throws(() => normalizeSeed("1.5"), /整数/);
  assert.equal(normalizeStrength("0.6"), 0.6);
  assert.throws(() => normalizeStrength("1.5"), /0–1/);
});

test("generation payload", () => {
  const payload = buildGenerationPayload({
    prompt: "a red apple",
    model: "Qwen-Image-2.1-Turbo",
    size: "1024x1024",
    n: 2,
    seed: 42,
    negativePrompt: "blurry",
  });
  assert.deepEqual(payload, {
    model: "Qwen-Image-2.1-Turbo",
    prompt: "a red apple",
    n: 2,
    size: "1024x1024",
    seed: 42,
    negative_prompt: "blurry",
  });
});

test("edit payload uses image array", () => {
  const payload = buildEditPayload({
    prompt: "make it red",
    model: "Qwen-Image-2.1-Turbo",
    imageBase64: "abc",
    size: "512x512",
    n: 1,
    seed: 7,
  });
  assert.deepEqual(payload, {
    model: "Qwen-Image-2.1-Turbo",
    prompt: "make it red",
    n: 1,
    image: ["abc"],
    size: "512x512",
    seed: 7,
  });
});

test("img2img payload width/height/mask", () => {
  const payload = buildImg2imgPayload({
    prompt: "turn to night",
    model: "Qwen-Image-2.1-Turbo",
    imageBase64: "abc",
    maskBase64: "mask",
    size: "512x512",
    n: 2,
    seed: 5,
    strength: 0.6,
    invertMask: true,
    negativePrompt: "",
  });
  assert.equal(payload.width, 512);
  assert.equal(payload.height, 512);
  assert.equal(payload.batch_size, 2);
  assert.equal(payload.denoising_strength, 0.6);
  assert.equal(payload.mask, "mask");
  assert.equal(payload.inpainting_mask_invert, 1);
  assert.equal(payload.seed, 5);
});

test("imageDimensions: PNG", () => {
  const buffer = Buffer.from(PNG_1x1, "base64");
  assert.deepEqual(imageDimensions(buffer), { format: "png", width: 1, height: 1 });
});

test("imageDimensions: unknown bytes", () => {
  assert.equal(imageDimensions(Buffer.from("not an image")), null);
});

test("formatApiError", () => {
  assert.equal(
    formatApiError(400, { error: { message: "prompt required", type: "sd_shim_error" } }),
    "HTTP 400：prompt required"
  );
  assert.equal(formatApiError(404, { error: "no model id could be identified", src: "llama-swap" }), "HTTP 404：no model id could be identified");
});

test("filename safety", () => {
  assert.equal(sanitizeFileName("../../evil name.png"), "evil-name.png");
  assert.equal(outputFileName({ mode: "generate", prompt: "a red apple", index: 0 }), "generate-a-red-apple.png");
  assert.equal(outputFileName({ mode: "generate", prompt: "a red apple", index: 1 }), "generate-a-red-apple-2.png");
  assert.equal(outputFileName({ mode: "edit", prompt: "x", fileName: "custom.png" }), "custom.png");
});

test("data URL stripping", () => {
  assert.equal(stripDataUrlPrefix("data:image/png;base64,abc"), "abc");
  assert.equal(stripDataUrlPrefix("abc"), "abc");
});
