window.__ModuleLoader__.load({
  id: "dsh-image-gen",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    const React = require("react");
    const h = React.createElement;
    const { useState, useEffect, useCallback } = React;

    const BRIDGE_PREFIX = "/api/dsh-image-gen";
    const PANEL_ID = "image-gen";
    const NS = "image-gen";
    const SIZE_PRESETS = [
      { value: "", label: "默认 / 保持输入尺寸" },
      { value: "1024x1024", label: "1024×1024 · 1:1（默认）" },
      { value: "512x512", label: "512×512 · 1:1" },
      { value: "768x768", label: "768×768 · 1:1" },
      { value: "1024x768", label: "1024×768 · 4:3" },
      { value: "768x1024", label: "768×1024 · 3:4" },
      { value: "1344x768", label: "1344×768 · 16:9" },
      { value: "768x1344", label: "768×1344 · 9:16" },
      { value: "1536x1536", label: "1536×1536 · 1:1（较慢）" },
    ];

    //#region styles
    const css = [
      ".dig-page{display:flex;flex-direction:column;gap:18px;min-height:100%;color:inherit;font-size:14px;line-height:1.55;padding:calc(var(--dsh-frame-top-clearance,48px) + 14px) 24px 40px;box-sizing:border-box;overflow:auto}",
      ".dig-header{display:flex;flex-direction:column;gap:8px}",
      ".dig-title{font-size:20px;font-weight:650;margin:0;letter-spacing:-.01em}",
      ".dig-sub{color:#6e6e73;font-size:12px;margin:0}",
      "@media (prefers-color-scheme: dark){.dig-sub{color:#a1a1a6}}",
      ".dig-chips{display:flex;gap:6px;flex-wrap:wrap}",
      ".dig-chip{font-size:11px;padding:2px 9px;border-radius:999px;background:rgba(0,0,0,.06);color:#3a3a3c;white-space:nowrap}",
      "@media (prefers-color-scheme: dark){.dig-chip{background:rgba(255,255,255,.08);color:#d1d1d6}}",
      ".dig-chipOk{background:rgba(22,163,74,.12);color:#15803d}",
      "@media (prefers-color-scheme: dark){.dig-chipOk{color:#4ade80}}",
      ".dig-chipWarn{background:rgba(245,158,11,.14);color:#b45309}",
      "@media (prefers-color-scheme: dark){.dig-chipWarn{color:#f59e0b}}",
      ".dig-tabs{display:flex;gap:4px;border-bottom:1px solid rgba(0,0,0,.09);padding-bottom:2px}",
      "@media (prefers-color-scheme: dark){.dig-tabs{border-color:rgba(255,255,255,.09)}}",
      ".dig-tab{border:none;background:transparent;color:#6e6e73;font:inherit;font-size:13px;padding:7px 12px;border-radius:8px 8px 0 0;cursor:pointer}",
      "@media (prefers-color-scheme: dark){.dig-tab{color:#a1a1a6}}",
      ".dig-tab:hover{background:rgba(0,0,0,.04)}",
      "@media (prefers-color-scheme: dark){.dig-tab:hover{background:rgba(255,255,255,.06)}}",
      ".dig-tabActive{color:inherit;font-weight:600;background:rgba(0,113,227,.09)}",
      "@media (prefers-color-scheme: dark){.dig-tabActive{background:rgba(0,113,227,.18)}}",
      ".dig-card{border:1px solid rgba(0,0,0,.08);border-radius:14px;background:rgba(255,255,255,.72);padding:16px 18px;display:flex;flex-direction:column;gap:12px}",
      "@media (prefers-color-scheme: dark){.dig-card{background:rgba(30,30,32,.7);border-color:rgba(255,255,255,.08)}}",
      ".dig-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px}",
      ".dig-field{display:flex;flex-direction:column;gap:5px;min-width:0}",
      ".dig-label{font-size:12px;font-weight:500;color:#3a3a3c;display:flex;gap:6px;align-items:center}",
      "@media (prefers-color-scheme: dark){.dig-label{color:#d1d1d6}}",
      ".dig-hint{color:#6e6e73;font-size:11px;margin:0}",
      "@media (prefers-color-scheme: dark){.dig-hint{color:#a1a1a6}}",
      ".dig-input,.dig-select,.dig-textarea{width:100%;box-sizing:border-box;border:1px solid rgba(0,0,0,.12);border-radius:9px;padding:7px 10px;font:inherit;font-size:13px;color:inherit;background:rgba(0,0,0,.03)}",
      ".dig-textarea{min-height:94px;resize:vertical;line-height:1.5}",
      "@media (prefers-color-scheme: dark){.dig-input,.dig-select,.dig-textarea{border-color:rgba(255,255,255,.12);background:rgba(255,255,255,.05)}}",
      ".dig-input:focus-visible,.dig-select:focus-visible,.dig-textarea:focus-visible{outline:none;border-color:#0071e3}",
      ".dig-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}",
      ".dig-btn{border:1px solid rgba(0,0,0,.14);border-radius:9px;padding:7px 14px;font:inherit;font-size:13px;cursor:pointer;background:transparent;color:inherit}",
      ".dig-btn:hover:not(:disabled){background:rgba(0,0,0,.05)}",
      "@media (prefers-color-scheme: dark){.dig-btn:hover:not(:disabled){background:rgba(255,255,255,.07)}}",
      ".dig-btnPrimary{background:#0071e3;border-color:#0071e3;color:#fff}",
      ".dig-btnPrimary:hover:not(:disabled){background:#0a84ff}",
      ".dig-btn:disabled{opacity:.5;cursor:default}",
      ".dig-toggle{display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer}",
      ".dig-error{color:#dc2626;font-size:12px;white-space:pre-wrap}",
      "@media (prefers-color-scheme: dark){.dig-error{color:#f87171}}",
      ".dig-ok{color:#16a34a;font-size:12px}",
      "@media (prefers-color-scheme: dark){.dig-ok{color:#4ade80}}",
      ".dig-result{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-top:4px}",
      ".dig-resultCard{border:1px solid rgba(0,0,0,.08);border-radius:12px;overflow:hidden;background:rgba(0,0,0,.03);display:flex;flex-direction:column}",
      "@media (prefers-color-scheme: dark){.dig-resultCard{border-color:rgba(255,255,255,.08);background:rgba(255,255,255,.04)}}",
      ".dig-resultImg{display:block;width:100%;height:auto;max-height:360px;object-fit:contain;background:#000}",
      ".dig-resultMeta{display:flex;gap:6px;flex-wrap:wrap;padding:8px 10px;align-items:center}",
      ".dig-link{font:inherit;font-size:12px;padding:4px 10px;border-radius:8px;cursor:pointer;text-decoration:none;border:1px solid rgba(0,113,227,.35);color:#0071e3;background:rgba(0,113,227,.06)}",
      ".dig-empty{color:#6e6e73;font-size:12px;padding:12px 0}",
      "@media (prefers-color-scheme: dark){.dig-empty{color:#a1a1a6}}",
      ".dig-pending{display:flex;flex-direction:column;gap:4px;padding:4px 0}",
      ".dig-pendingTitle{font-weight:600;font-size:13px}",
      ".dig-cardView{display:flex;flex-direction:column;gap:10px;padding:8px 0 4px;max-width:760px}",
      ".dig-path{font-family:monospace;font-size:11px;color:#6e6e73;overflow-wrap:anywhere}",
      "@media (prefers-color-scheme: dark){.dig-path{color:#a1a1a6}}",
      ".dig-iconBtn{border:1px solid rgba(0,0,0,.14);border-radius:8px;padding:4px 10px;font:inherit;font-size:12px;cursor:pointer;background:transparent;color:inherit}",
      "@media (prefers-color-scheme: dark){.dig-iconBtn{border-color:rgba(255,255,255,.14)}}",
    ];
    (function injectCss() {
      if (typeof document === "undefined") return;
      if (document.getElementById("dig-styles")) return;
      const style = document.createElement("style");
      style.id = "dig-styles";
      style.textContent = css.join("\n");
      document.head.appendChild(style);
    })();
    //#endregion

    //#region bridge
    async function bridgeCall(path, payload) {
      let response;
      try {
        response = await fetch(`${BRIDGE_PREFIX}${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload ?? {}),
        });
      } catch (error) {
        return {
          ok: false,
          code: "network",
          message: "无法连接宿主接口：" + (error && error.message ? error.message : String(error)),
        };
      }
      let body = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      if (!response.ok) {
        const detail = body && (body.message || body.error);
        return {
          ok: false,
          code: "http-" + response.status,
          message: `接口返回 ${response.status}${detail ? "：" + detail : ""}`,
        };
      }
      if (body === null || typeof body !== "object") {
        return {
          ok: false,
          code: "bad-response",
          message: "接口返回了无法解析的内容（宿主插件版本与页面不一致，请重载后重试）",
        };
      }
      return body;
    }
    const bridgeDescribe = () => bridgeCall("/describe", {});
    const bridgeSave = (payload) => bridgeCall("/save", payload);
    const bridgeTest = (payload) => bridgeCall("/test", payload);
    const bridgePreview = (payload) => bridgeCall("/preview", payload);
    //#endregion

    function clone(value) {
      return JSON.parse(JSON.stringify(value));
    }

    function Field(props) {
      return h(
        "label",
        { className: "dig-field" },
        h("span", { className: "dig-label" }, props.label),
        props.children,
        props.hint ? h("span", { className: "dig-hint" }, props.hint) : null
      );
    }

    function TextInput(props) {
      return h("input", {
        className: "dig-input",
        type: props.type || "text",
        value: props.value ?? "",
        placeholder: props.placeholder || "",
        autoComplete: props.type === "password" ? "off" : undefined,
        onChange: (event) => props.onChange(event.target.value),
      });
    }

    function NumberInput(props) {
      return h("input", {
        className: "dig-input",
        type: "number",
        min: props.min ?? 0,
        max: props.max ?? undefined,
        step: props.step ?? 1,
        value: props.value ?? "",
        onChange: (event) => props.onChange(event.target.value),
      });
    }

    function Select(props) {
      return h(
        "select",
        {
          className: "dig-select",
          value: props.value ?? "",
          onChange: (event) => props.onChange(event.target.value),
        },
        (props.options || []).map((option) =>
          h("option", { key: option.value, value: option.value }, option.label)
        )
      );
    }

    function Toggle(props) {
      return h(
        "label",
        { className: "dig-toggle" },
        h("input", {
          type: "checkbox",
          checked: props.checked === true,
          onChange: (event) => props.onChange(event.target.checked),
        }),
        props.label
      );
    }

    function readFileBase64(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const text = String(reader.result || "");
          const comma = text.indexOf(",");
          resolve(comma >= 0 ? text.slice(comma + 1) : text);
        };
        reader.onerror = () => reject(reader.error || new Error("read failed"));
        reader.readAsDataURL(file);
      });
    }

    //#region settings card
    function SettingsCard(props) {
      const [data, setData] = useState(null);
      const [draft, setDraft] = useState(null);
      const [loading, setLoading] = useState(true);
      const [saving, setSaving] = useState(false);
      const [error, setError] = useState("");
      const [saved, setSaved] = useState(false);
      const [testResult, setTestResult] = useState(null);
      const [testing, setTesting] = useState(false);

      const load = useCallback(async () => {
        const result = await bridgeDescribe();
        if (result && result.ok) {
          const value = result.value;
          const config = clone(value.config || {});
          const apiKeySet = Array.isArray(value.secrets)
            ? value.secrets.some(
                (secret) =>
                  Array.isArray(secret.path) &&
                  secret.path.join(".") === "apiKey" &&
                  secret.set
              )
            : false;
          config.apiKey = "";
          config.apiKeySet = apiKeySet;
          config.clearApiKey = false;
          config.expectedRevision = value.revision || 0;
          setData(value);
          setDraft(config);
          setError("");
          setLoading(false);
        } else {
          setError(result && result.message ? result.message : "读取设置失败");
          setLoading(false);
        }
      }, []);

      useEffect(() => {
        void load();
      }, [load]);

      const update = (key, value) => {
        setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
        setSaved(false);
      };

      const save = async () => {
        if (!draft) return;
        setSaving(true);
        setError("");
        const result = await bridgeSave(draft);
        setSaving(false);
        if (result && result.ok) {
          setSaved(true);
          if (props.onSaved && typeof props.onSaved === "function") props.onSaved();
          void load();
        } else {
          setError(result && result.message ? result.message : "保存失败");
        }
      };

      const test = async () => {
        if (!draft) return;
        setTesting(true);
        setError("");
        const result = await bridgeTest({
          endpoint: draft.endpoint,
          apiKey: draft.apiKey && draft.apiKey.trim() ? draft.apiKey.trim() : undefined,
        });
        setTesting(false);
        if (result && result.ok) setTestResult(result.value);
        else setError(result && result.message ? result.message : "连接测试失败");
      };

      if (loading) return h("div", { className: "dig-empty" }, "加载设置…");
      if (!draft) return h("div", { className: "dig-error" }, error || "设置不可用");

      return h(
        "div",
        { className: "dig-card" },
        h("div", { className: "dig-row" }, h("strong", null, "端点与模型"), h("span", { className: "dig-chip" }, `v${data?.version || "?"}`)),
        h(
          "div",
          { className: "dig-grid" },
          h(
            Field,
            { label: "API 端点", hint: "默认 http://ai4090:8080/v1；插件会补 /images/... 与 /sdapi/..." },
            h(TextInput, {
              value: draft.endpoint,
              placeholder: "http://ai4090:8080/v1",
              onChange: (value) => update("endpoint", value),
            })
          ),
          h(
            Field,
            { label: "模型 ID" },
            h(TextInput, {
              value: draft.model,
              placeholder: "Qwen-Image-2.1-Turbo",
              onChange: (value) => update("model", value),
            })
          ),
          h(
            Field,
            { label: "API Key", hint: draft.apiKeySet ? "已保存；留空表示不修改，勾选清除可删除" : "可选；仅当网关需要鉴权时填写" },
            h(TextInput, {
              type: "password",
              value: draft.apiKey,
              placeholder: draft.apiKeySet ? "已保存（留空不修改）" : "（可选）",
              onChange: (value) => update("apiKey", value),
            })
          ),
          h(
            Field,
            { label: "默认输出尺寸", hint: "WIDTHxHEIGHT，256–2048/边" },
            h(Select, {
              value: draft.size,
              options: SIZE_PRESETS.filter((preset) => preset.value !== ""),
              onChange: (value) => update("size", value),
            })
          ),
          h(
            Field,
            { label: "默认张数" },
            h(NumberInput, {
              value: draft.n,
              min: 1,
              max: 4,
              onChange: (value) => update("n", value),
            })
          ),
          h(
            Field,
            { label: "默认 seed", hint: "留空 = 服务端默认/随机" },
            h(NumberInput, {
              value: draft.seed ?? "",
              onChange: (value) => update("seed", value),
            })
          ),
          h(
            Field,
            { label: "输出目录", hint: "相对当前会话工作目录" },
            h(TextInput, {
              value: draft.outputDir,
              onChange: (value) => update("outputDir", value),
            })
          ),
          h(
            Field,
            { label: "超时（秒）", hint: "30–900；大图可能较慢" },
            h(NumberInput, {
              value: draft.timeoutSec,
              min: 30,
              max: 900,
              onChange: (value) => update("timeoutSec", value),
            })
          ),
          h(
            Field,
            { label: "默认负向提示词" },
            h(TextInput, {
              value: draft.negativePrompt,
              placeholder: "（可选）blurry, low quality",
              onChange: (value) => update("negativePrompt", value),
            })
          ),
        ),
        h(
          "div",
          { className: "dig-row" },
          h(Toggle, {
            checked: draft.enabled !== false,
            label: "启用插件工具",
            onChange: (value) => update("enabled", value),
          }),
          h(Toggle, {
            checked: draft.preserveInputSize !== false,
            label: "编辑/图生图默认保持输入尺寸",
            onChange: (value) => update("preserveInputSize", value),
          }),
          h(Toggle, {
            checked: draft.clearApiKey === true,
            label: "清除已保存的 API Key",
            onChange: (value) => update("clearApiKey", value),
          })
        ),
        h(
          "div",
          { className: "dig-row" },
          h(
            "button",
            { className: "dig-btn dig-btnPrimary", type: "button", disabled: saving, onClick: () => void save() },
            saving ? "保存中…" : "保存"
          ),
          h(
            "button",
            { className: "dig-btn", type: "button", disabled: testing, onClick: () => void test() },
            testing ? "测试中…" : "连接测试"
          ),
          h(
            "button",
            { className: "dig-btn", type: "button", disabled: saving, onClick: () => void load() },
            "放弃修改并重新加载"
          )
        ),
        saved ? h("p", { className: "dig-ok" }, "已保存") : null,
        error ? h("p", { className: "dig-error" }, error) : null,
        testResult
          ? h(
              "div",
              { className: "dig-card", style: { background: "rgba(0,0,0,.02)" } },
              h("div", { className: "dig-chips" },
                h("span", { className: `dig-chip ${testResult.reachable ? "dig-chipOk" : "dig-chipWarn"}` },
                  testResult.reachable ? "可访问" : "不可访问"),
                testResult.modelFound
                  ? h("span", { className: "dig-chip dig-chipOk" }, "模型存在")
                  : h("span", { className: "dig-chip dig-chipWarn" }, "模型未找到")
              ),
              h("p", { className: "dig-hint" }, `models: ${testResult.modelsUrl}`),
              h("p", { className: "dig-hint" }, `health: ${testResult.healthUrl}`),
              testResult.modelsError ? h("p", { className: "dig-error" }, "models: " + testResult.modelsError) : null,
              testResult.healthError ? h("p", { className: "dig-error" }, "health: " + testResult.healthError) : null,
              testResult.model
                ? h("p", { className: "dig-hint" }, `模型 ${testResult.model.id} · 状态 ${JSON.stringify(testResult.model.status || "?")}`)
                : null
            )
          : null
      );
    }
    //#endregion

    //#region studio
    function StudioForm({ mode }) {
      const isGenerate = mode === "generate";
      const needsImage = mode === "edit" || mode === "img2img";
      const [prompt, setPrompt] = useState("");
      const [negativePrompt, setNegativePrompt] = useState("");
      const [size, setSize] = useState("");
      const [n, setN] = useState(1);
      const [seed, setSeed] = useState("");
      const [strength, setStrength] = useState(0.75);
      const [file, setFile] = useState(null);
      const [maskFile, setMaskFile] = useState(null);
      const [invertMask, setInvertMask] = useState(false);
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState("");
      const [result, setResult] = useState(null);

      const submit = async () => {
        if (!prompt.trim()) {
          setError("prompt 不能为空");
          return;
        }
        if (needsImage && !file) {
          setError("请选择一张图片");
          return;
        }
        setBusy(true);
        setError("");
        setResult(null);
        try {
          let imageBase64 = "";
          let maskBase64 = "";
          if (file) imageBase64 = await readFileBase64(file);
          if (maskFile) maskBase64 = await readFileBase64(maskFile);
          const payload = {
            mode,
            prompt: prompt.trim(),
            size: size || "",
            n: Number(n) || 1,
            seed: seed === "" ? undefined : Number(seed),
            negativePrompt: negativePrompt.trim() || undefined,
            strength: Number(strength) || 0.75,
            invertMask,
            imageBase64: imageBase64 || undefined,
            maskBase64: maskBase64 || undefined,
          };
          const response = await bridgePreview(payload);
          if (response && response.ok) {
            setResult(response.value);
          } else {
            setError(response && response.message ? response.message : "生成失败");
          }
        } catch (err) {
          setError(err && err.message ? err.message : String(err));
        } finally {
          setBusy(false);
        }
      };

      return h(
        "div",
        { className: "dig-card" },
        h(
          "div",
          { className: "dig-grid" },
          h(
            Field,
            { label: "提示词", hint: isGenerate ? "描述画面；最多 4000 字符" : mode === "edit" ? "描述要改什么，例如 make the lighthouse red" : "描述目标画面，例如 turn the scene into night" },
            h("textarea", {
              className: "dig-textarea",
              value: prompt,
              placeholder: isGenerate ? "a red apple on a wooden table" : "make the lighthouse red",
              onChange: (event) => setPrompt(event.target.value),
            })
          ),
          isGenerate
            ? h(
                Field,
                { label: "负向提示词" },
                h("textarea", {
                  className: "dig-textarea",
                  style: { minHeight: 62 },
                  value: negativePrompt,
                  placeholder: "（可选）blurry, low quality",
                  onChange: (event) => setNegativePrompt(event.target.value),
                })
              )
            : null,
          needsImage
            ? h(
                Field,
                { label: "输入图片", hint: "PNG / JPEG / WebP；编辑时可用 RGBA 透明区域限定改动范围" },
                h("input", {
                  className: "dig-input",
                  type: "file",
                  accept: "image/png,image/jpeg,image/webp",
                  onChange: (event) => setFile(event.target.files && event.target.files[0] ? event.target.files[0] : null),
                })
              )
            : null,
          mode === "img2img"
            ? h(
                Field,
                { label: "Mask（可选）", hint: "白色区域 = 重绘区域；仅 /sdapi/v1/img2img 生效" },
                h("input", {
                  className: "dig-input",
                  type: "file",
                  accept: "image/png,image/jpeg,image/webp",
                  onChange: (event) => setMaskFile(event.target.files && event.target.files[0] ? event.target.files[0] : null),
                })
              )
            : null,
          h(
            Field,
            { label: "输出尺寸", hint: "留空：生成用默认尺寸；编辑/图生图保持输入尺寸" },
            h(Select, {
              value: size,
              options: SIZE_PRESETS,
              onChange: (value) => setSize(value),
            })
          ),
          h(
            Field,
            { label: "张数" },
            h(NumberInput, { value: n, min: 1, max: 4, onChange: (value) => setN(value) })
          ),
          h(
            Field,
            { label: "seed", hint: "留空 = 默认/随机" },
            h(NumberInput, { value: seed, onChange: (value) => setSeed(value) })
          ),
          mode === "img2img"
            ? h(
                Field,
                { label: "Denoising strength", hint: "0–1，默认 0.75" },
                h(NumberInput, {
                  value: strength,
                  min: 0,
                  max: 1,
                  step: 0.05,
                  onChange: (value) => setStrength(value),
                })
              )
            : null,
        ),
        mode === "img2img"
          ? h(Toggle, {
              checked: invertMask,
              label: "反转 mask（重绘白色区域之外）",
              onChange: (value) => setInvertMask(value),
            })
          : null,
        h(
          "div",
          { className: "dig-row" },
          h(
            "button",
            { className: "dig-btn dig-btnPrimary", type: "button", disabled: busy, onClick: () => void submit() },
            busy ? "生成中…" : "生成"
          ),
          h("span", { className: "dig-hint" }, "同一模型一次只能跑一个请求；并发会返回 429")
        ),
        error ? h("p", { className: "dig-error" }, error) : null,
        result
          ? h(
              "div",
              null,
              h(
                "div",
                { className: "dig-chips" },
                h("span", { className: "dig-chip dig-chipOk" }, `${result.images.length} 张`),
                h("span", { className: "dig-chip" }, `${result.elapsedSeconds}s`),
                result.size ? h("span", { className: "dig-chip" }, result.size) : null,
                h("span", { className: "dig-chip" }, result.model)
              ),
              h(
                "div",
                { className: "dig-result" },
                result.images.map((image, index) =>
                  h(
                    "div",
                    { className: "dig-resultCard", key: index },
                    h("img", { className: "dig-resultImg", src: image.dataUrl, alt: `result ${index + 1}` }),
                    h(
                      "div",
                      { className: "dig-resultMeta" },
                      h("span", { className: "dig-chip" }, `${image.width || "?"}×${image.height || "?"}`),
                      h("span", { className: "dig-chip" }, `${Math.round(image.bytes / 1024)} KB`),
                      h("a", { className: "dig-link", href: image.dataUrl, download: `image-${index + 1}.png` }, "下载 PNG")
                    )
                  )
                )
              )
            )
          : null
      );
    }

    function ImageStudioPage() {
      const [tab, setTab] = useState("generate");
      const [info, setInfo] = useState(null);

      const refreshInfo = useCallback(async () => {
        const response = await bridgeDescribe();
        if (response && response.ok) setInfo(response.value);
      }, []);

      useEffect(() => {
        void refreshInfo();
      }, [refreshInfo]);

      const tabBtn = (id, label) =>
        h(
          "button",
          {
            className: `dig-tab ${tab === id ? "dig-tabActive" : ""}`,
            type: "button",
            onClick: () => setTab(id),
          },
          label
        );

      return h(
        "div",
        { className: "dig-page" },
        h(
          "div",
          { className: "dig-header" },
          h("h1", { className: "dig-title" }, "图像工作室"),
          h(
            "p",
            { className: "dig-sub" },
            "文生图、图生图与图片编辑；默认端点 http://ai4090:8080/v1，模型 Qwen-Image-2.1-Turbo。"
          ),
          info
            ? h(
                "div",
                { className: "dig-chips" },
                h("span", { className: `dig-chip ${info.config.enabled !== false ? "dig-chipOk" : "dig-chipWarn"}` },
                  info.config.enabled !== false ? "已启用" : "已禁用"),
                h("span", { className: "dig-chip" }, info.config.endpoint),
                h("span", { className: "dig-chip" }, info.config.model),
                h("span", { className: "dig-chip" }, `默认 ${info.config.size}`),
                info.toolRegistered
                  ? h("span", { className: "dig-chip dig-chipOk" }, "3 个工具已注册")
                  : h("span", { className: "dig-chip dig-chipWarn" }, "工具未完全注册")
              )
            : null
        ),
        h(
          "div",
          { className: "dig-tabs" },
          tabBtn("generate", "文生图"),
          tabBtn("img2img", "图生图"),
          tabBtn("edit", "图片编辑"),
          tabBtn("settings", "设置")
        ),
        tab === "generate"
          ? h(StudioForm, { mode: "generate" })
          : tab === "img2img"
            ? h(StudioForm, { mode: "img2img" })
            : tab === "edit"
              ? h(StudioForm, { mode: "edit" })
              : h(SettingsCard, { onSaved: refreshInfo })
      );
    }
    //#endregion

    //#region tool view
    function flattenText(block) {
      if (!block || !Array.isArray(block.content)) return "";
      return block.content
        .filter((part) => part && part.type === "text" && typeof part.text === "string")
        .map((part) => part.text)
        .join("\n");
    }

    function ImageToolView(props) {
      const { phase, block, openFile } = props;
      if (phase !== "result") {
        const args = block && block.args && typeof block.args === "object" ? block.args : {};
        const prompt = typeof args.prompt === "string" ? args.prompt : "";
        return h(
          "div",
          { className: "dig-pending" },
          h("div", { className: "dig-pendingTitle" }, "生成图像"),
          prompt ? h("div", { className: "dig-hint" }, prompt.slice(0, 220)) : null,
          h("div", { className: "dig-hint" }, "正在调用图像服务…")
        );
      }
      if (block && block.isError) {
        return h(
          "div",
          { className: "dig-pending" },
          h("div", { className: "dig-pendingTitle" }, "图像生成失败"),
          h("div", { className: "dig-error" }, flattenText(block) || "unknown error")
        );
      }
      const meta = block && block.meta && typeof block.meta === "object" ? block.meta : null;
      const images = meta && Array.isArray(meta.images) ? meta.images : [];
      if (!meta || images.length === 0) {
        return h(
          "div",
          { className: "dig-pending" },
          h("div", { className: "dig-pendingTitle" }, "图像结果"),
          h("div", { className: "dig-hint" }, flattenText(block) || "结果不可用")
        );
      }
      return h(
        "div",
        { className: "dig-cardView" },
        h(
          "div",
          { className: "dig-result" },
          images.map((image, index) =>
            h(
              "div",
              { className: "dig-resultCard", key: index },
              typeof image.url === "string"
                ? h("img", { className: "dig-resultImg", src: image.url, alt: `image ${index + 1}` })
                : null,
              h(
                "div",
                { className: "dig-resultMeta" },
                meta.size ? h("span", { className: "dig-chip" }, meta.size) : null,
                image.width ? h("span", { className: "dig-chip" }, `${image.width}×${image.height}`) : null,
                h("span", { className: "dig-chip dig-chipOk" }, "完成"),
                typeof image.url === "string"
                  ? h("a", { className: "dig-link", href: image.url, download: true }, "下载 PNG")
                  : null,
                typeof openFile === "function" && image.filePath
                  ? h(
                      "button",
                      { className: "dig-iconBtn", type: "button", onClick: () => openFile(image.filePath) },
                      "打开文件"
                    )
                  : null
              )
            )
          )
        ),
        meta.prompt ? h("div", { className: "dig-hint" }, meta.prompt) : null
      );
    }
    //#endregion

    function ImagePanelIcon({ size = 16 } = {}) {
      return h(
        "svg",
        {
          width: size,
          height: size,
          viewBox: "0 0 24 24",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 1.7,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          "aria-hidden": "true",
        },
        h("rect", { x: 3, y: 4, width: 18, height: 16, rx: 3 }),
        h("circle", { cx: 8.5, cy: 9.5, r: 1.6 }),
        h("path", { d: "M4 17l5.2-5.2 3.1 3.1 3.2-3.2L20 17" })
      );
    }

    function summaryText() {
      return "文生图 · 图生图 · 图片编辑 · 端点与默认尺寸可配置";
    }

    const inject = ["slots"];

    function apply(ctx) {
      ctx.slots.inject("main", () =>
        ctx.slots.register(
          {
            name: "main",
            key: PANEL_ID,
          },
          ImageStudioPage
        )
      );

      ctx.slots.inject("sidebar.panellist", () =>
        ctx.slots.register(
          {
            name: "sidebar.panellist",
            id: PANEL_ID,
            order: 2,
            label: () => "图像",
          },
          ImagePanelIcon
        )
      );

      ctx.slots.inject("plugins.row.config", () =>
        ctx.slots.register(
          {
            name: "plugins.row.config",
            key: "dsh-image-gen#image-gen",
          },
          (slotProps) =>
            slotProps && slotProps.view === "summary" ? summaryText() : h(SettingsCard, null)
        )
      );

      for (const toolName of ["image_generate", "image_to_image", "image_edit"]) {
        ctx.slots.inject("tool.call.toolview", () =>
          ctx.slots.register(
            {
              name: "tool.call.toolview",
              key: toolName,
              priority: -10,
            },
            ImageToolView
          )
        );
      }
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
