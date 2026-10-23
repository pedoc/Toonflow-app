const rules = [
  {
    type: "input",
    field: "apiUrl" as const,
    title: "New API 地址",
    value: "https://ai-proxy.pedoc.cn/v1",
    props: { placeholder: "https://your-new-api.example/v1" },
    validate: [{ required: true, message: "请填写 New API 地址" }],
  },
  {
    type: "input",
    field: "apiKey" as const,
    title: "API Key",
    value: "",
    props: { type: "password", showPassword: true, autocomplete: "off" },
  },
];

function connection(context: ProviderContext) {
  const address = typeof context.config.apiUrl === "string" ? context.config.apiUrl.trim() : "";
  if (!URL.canParse(address)) throw new Error("请填写有效的 New API 地址");
  const url = new URL(address);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("New API 地址须为不含凭据、查询参数或片段的 HTTP URL");
  }
  if (url.pathname === "/") url.pathname = "/v1";
  const apiKey = typeof context.config.apiKey === "string" ? context.config.apiKey.trim().replace(/^Bearer\s+/i, "").trim() : "";
  if (!apiKey) throw new Error("请填写 New API 签发的 API Key");
  return { apiUrl: url.href.replace(/\/+$/, ""), apiKey };
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("New API 响应格式错误");
  return value as Record<string, unknown>;
}

async function request(context: ProviderContext, path: string, signal: AbortSignal, body?: Record<string, unknown> | FormData) {
  const { apiUrl, apiKey } = connection(context);
  const form = body instanceof FormData;
  const response = await context.tool.fetch(`${apiUrl}/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${apiKey}`, ...(!form && body ? { "Content-Type": "application/json" } : {}) },
    body: body === undefined ? undefined : form ? body : JSON.stringify(body),
    signal,
    redirect: "error",
  });
  if (!response.ok) {
    const detail = context.tool.errorMessage(await response.text());
    throw new Error(`New API 请求失败（HTTP ${response.status}）${detail ? `：${detail}` : ""}`);
  }
  return response;
}

function signal(context: ProviderContext) {
  return AbortSignal.any([AbortSignal.timeout(30 * 60_000), ...(context.signal ? [context.signal] : [])]);
}

function validateRequest(value: MediaRequest & { prompt: string }) {
  if (!value.model?.trim()) throw new Error("请选择 New API 模型");
  if (!value.prompt?.trim()) throw new Error("请填写生成提示词");
}

function mediaUrl(input: MediaInput) {
  if (input.type === "url") {
    const url = new URL(input.url);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("参考媒体须为 HTTP URL");
    return url.href;
  }
  const data = input.type === "binary" ? Buffer.from(input.data).toString("base64") : input.data;
  return data.startsWith("data:") ? data : `data:${input.mimeType};base64,${data}`;
}

async function imageBlob(context: ProviderContext, input: MediaInput, requestSignal: AbortSignal) {
  if (input.type === "url") {
    const response = await context.tool.fetch(mediaUrl(input), { signal: requestSignal, redirect: "error" });
    if (!response.ok) throw new Error(`读取参考图片失败（HTTP ${response.status}）`);
    const blob = await response.blob();
    if (!blob.type.startsWith("image/")) throw new Error("参考文件必须是图片");
    return blob;
  }
  const url = mediaUrl(input);
  const match = /^data:(image\/[^;,]+);base64,([\s\S]+)$/.exec(url);
  if (!match) throw new Error("参考图片必须包含有效的 MIME 类型和 base64 内容");
  return new Blob([new Uint8Array(Buffer.from(match[2], "base64"))], { type: match[1] });
}

function imageSize(value?: string, ratio?: string) {
  if (value && !/^[124]k$/i.test(value)) return value;
  const side = value ? Number(value[0]) * 1024 : 1024;
  if (!ratio || ratio === "1:1") return `${side}x${side}`;
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(ratio);
  if (!match || Number(match[1]) <= 0 || Number(match[2]) <= 0) throw new Error("图片宽高比无效");
  const aspect = Number(match[1]) / Number(match[2]);
  return `${Math.max(64, Math.round(side * Math.sqrt(aspect) / 64) * 64)}x${Math.max(64, Math.round(side / Math.sqrt(aspect) / 64) * 64)}`;
}

function wait(requestSignal: AbortSignal) {
  requestSignal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(requestSignal.reason); };
    const timer = setTimeout(() => { requestSignal.removeEventListener("abort", abort); resolve(); }, 3000);
    requestSignal.addEventListener("abort", abort, { once: true });
  });
}

export default {
  id: "newApi" as const,
  label: "New API",
  icon: "",
  version: "1.0.0",
  modelsUrl: "/models",
  readme: "连接 New API 的统一图片、视频和语音接口。填写 /v1 地址及调用令牌，再点击获取模型。视频在本供应商内轮询并下载结果，文件不会发往其他网关。上游是否开通及价格以 New API 配置为准。缺少类型信息的自定义模型可在编辑模型中手动添加。",
  rules,
  models: [],

  async generateImage(this: ProviderContext, value: ImageRequest): Promise<MediaAsset[]> {
    validateRequest(value);
    if (value.n !== undefined && (!Number.isInteger(value.n) || value.n < 1)) throw new Error("图片数量须为正整数");
    if (value.mask && !value.images?.length) throw new Error("使用蒙版时必须提供参考图片");
    const requestSignal = signal(this);
    const body: Record<string, unknown> = {
      ...value.other, model: value.model, prompt: value.prompt, n: value.n ?? 1,
      ...(value.size || value.ratio ? { size: imageSize(value.size, value.ratio) } : {}),
      ...(value.quality ? { quality: value.quality } : {}),
      ...(value.outputFormat ? { output_format: value.outputFormat } : {}),
    };
    let response: Response;
    if (value.images?.length) {
      const form = new FormData();
      for (const [key, field] of Object.entries(body)) if (field !== undefined) form.append(key, typeof field === "object" ? JSON.stringify(field) : String(field));
      for (const [index, input] of value.images.entries()) {
        const blob = await imageBlob(this, input, requestSignal);
        form.append(value.images.length === 1 ? "image" : "image[]", blob, input.name || `reference${index}.${blob.type.split("/")[1]}`);
      }
      if (value.mask) form.append("mask", await imageBlob(this, value.mask, requestSignal), "mask.png");
      response = await request(this, "images/edits", requestSignal, form);
    } else response = await request(this, "images/generations", requestSignal, body);
    const result = object(await response.json());
    if (!Array.isArray(result.data) || !result.data.length) throw new Error("New API 未返回图片结果");
    return result.data.map(item => {
      const entry = object(item);
      if (typeof entry.b64_json === "string" && entry.b64_json) {
        return { mediaType: "image", type: "base64", data: entry.b64_json, mimeType: `image/${value.outputFormat || "png"}` };
      }
      if (typeof entry.url !== "string" || !/^https?:\/\//i.test(entry.url)) throw new Error("New API 返回的图片地址无效");
      return { mediaType: "image", type: "url", url: entry.url };
    });
  },

  async generateVideo(this: ProviderContext, value: VideoRequest): Promise<MediaAsset[]> {
    validateRequest(value);
    if (value.duration !== undefined && (!Number.isInteger(value.duration) || value.duration <= 0)) throw new Error("视频时长须为正整数秒");
    const requestSignal = signal(this);
    const other = { ...value.other };
    const metadata = { ...(other.metadata === undefined ? {} : object(other.metadata)) };
    delete other.metadata;
    if (value.resolution) metadata.resolution = value.resolution;
    if (value.ratio) metadata.ratio = value.ratio;
    if (value.generateAudio !== undefined) metadata.generate_audio = value.generateAudio;
    if (value.watermark !== undefined) metadata.watermark = value.watermark;
    const images = value.images ?? [];
    const videos = value.videos ?? [];
    const audios = value.audios ?? [];
    const seedance = /seedance/i.test(value.model);
    if (seedance) {
      const content = metadata.content === undefined ? [] : metadata.content;
      if (!Array.isArray(content)) throw new Error("视频 metadata.content 须为数组");
      const references: Record<string, unknown>[] = [];
      const useFirstImage = !value.firstFrame && !Array.isArray(value.mode) && images.length === 1;
      for (const [input, role] of [[value.firstFrame ?? (useFirstImage ? images[0] : undefined), "first_frame"], [value.lastFrame, "last_frame"]] as const) {
        if (input) references.push({ type: "image_url", image_url: { url: mediaUrl(input) }, role });
      }
      for (const input of useFirstImage ? [] : images) references.push({ type: "image_url", image_url: { url: mediaUrl(input) }, role: "reference_image" });
      for (const input of videos) references.push({ type: "video_url", video_url: { url: mediaUrl(input) }, role: "reference_video" });
      for (const input of audios) references.push({ type: "audio_url", audio_url: { url: mediaUrl(input) }, role: "reference_audio" });
      if (references.length || content.length) metadata.content = [...content, ...references];
    } else if (value.lastFrame || videos.length || audios.length || images.length > 1 || (value.firstFrame && images.length)) {
      throw new Error("此统一视频接口仅映射单张参考图；多参考视频请使用 Seedance，或通过自定义参数填写上游支持的 metadata");
    }
    const body: Record<string, unknown> = {
      ...other, model: value.model, prompt: value.prompt,
      ...(value.duration !== undefined ? { seconds: value.duration } : {}),
      metadata,
    };
    const reference = value.firstFrame ?? images[0];
    if (!seedance && reference) body.input_reference = mediaUrl(reference);
    let task = object(await (await request(this, "videos", requestSignal, body)).json());
    if (typeof task.id !== "string" || !task.id.trim()) throw new Error("New API 未返回视频任务 ID");
    const path = `videos/${encodeURIComponent(task.id)}`;
    while (true) {
      const status = String(task.status ?? "").toLowerCase();
      if (status === "completed") {
        const response = await request(this, `${path}/content`, requestSignal);
        return [{ mediaType: "video", type: "binary", data: new Uint8Array(await response.arrayBuffer()), mimeType: response.headers.get("Content-Type")?.split(";")[0] || "video/mp4" }];
      }
      if (["failed", "cancelled", "canceled", "expired"].includes(status)) throw new Error(this.tool.errorMessage(task.error) || `视频任务${status}`);
      if (!["queued", "in_progress", "pending", "processing"].includes(status)) throw new Error(`New API 返回未知视频状态：${status}`);
      await wait(requestSignal);
      task = object(await (await request(this, path, requestSignal)).json());
    }
  },

  async generateAudio(this: ProviderContext, value: AudioRequest): Promise<MediaAsset[]> {
    const input = value.text || value.prompt;
    if (!value.model?.trim() || !input?.trim()) throw new Error("请选择语音模型并填写文本");
    if (value.images?.length || value.audios?.length || [value.volume, value.pitch, value.emotion, value.language, value.normalizeText, value.sampleRate, value.bitrateKbps].some(item => item !== undefined)) {
      throw new Error("统一语音接口支持文本、音色、语速和输出格式；其他参数请通过自定义参数填写");
    }
    const format = value.format || "mp3";
    if (!["mp3", "wav", "opus", "aac", "flac", "pcm"].includes(format)) throw new Error("语音输出格式无效");
    const response = await request(this, "audio/speech", signal(this), {
      ...value.other, model: value.model, input, voice: value.voice || "alloy", response_format: format,
      ...(value.speed !== undefined ? { speed: value.speed } : {}),
    });
    return [{ mediaType: "audio", type: "binary", data: new Uint8Array(await response.arrayBuffer()), mimeType: response.headers.get("Content-Type")?.split(";")[0] || ({ mp3: "audio/mpeg", wav: "audio/wav", opus: "audio/ogg", aac: "audio/aac", flac: "audio/flac", pcm: "audio/pcm" }[format] ?? "audio/mpeg") }];
  },
} satisfies ProviderDefinition<typeof rules>;
