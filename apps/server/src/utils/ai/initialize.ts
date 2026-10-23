import newApi from "@toonflow/providers/language/newApi";
import conf from "@/utils/conf";
import { fetchProviderModels } from "@/utils/ai/models";
import { getMediaProviderApiKey, refreshMediaProviderModels } from "@/utils/media/provider";

let initialization: Promise<void> | undefined;

function normalizeApiKey(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/^Bearer(?:\s+|$)/i, "").trim() : "";
}

function getLanguageProvider(settings: Record<string, unknown>) {
  const providers = settings.customProviders;
  if (!Array.isArray(providers)) return;
  return providers.find(item => item?.id === newApi.id && typeof item.apiUrl === "string" && URL.canParse(item.apiUrl));
}

async function refreshLanguageModels(previousSettings?: Record<string, unknown>) {
  const provider = getLanguageProvider(conf.get("settings", {}));
  const apiKey = normalizeApiKey(provider?.apiKey);
  const previous = previousSettings && getLanguageProvider(previousSettings);
  if (!apiKey || (previous && apiKey === normalizeApiKey(previous.apiKey) && provider.apiUrl === previous.apiUrl && provider.protocol === previous.protocol)) return;
  const models = await fetchProviderModels({ apiUrl: provider.apiUrl, protocol: provider.protocol, apiKey });
  if (!models.length) throw new Error("未获取到文本模型，保留原有列表");
  const current = conf.get("settings.customProviders");
  if (!Array.isArray(current)) return;
  const index = current.findIndex(item => item?.id === provider.id && item.apiUrl === provider.apiUrl
    && item.protocol === provider.protocol && item.apiKey === provider.apiKey);
  if (index === -1) return;
  const providers = current.map((item, itemIndex) => itemIndex === index ? { ...item, models: models.map(model => {
    const saved = Array.isArray(item.models) ? item.models.find((existing: { id?: string; reasoningEfforts?: unknown }) => existing?.id === model.id) : undefined;
    return saved?.reasoningEfforts === undefined ? model : { ...model, reasoningEfforts: saved.reasoningEfforts };
  }) } : item);
  conf.set("settings.customProviders", providers);
  return providers;
}

async function refreshMediaModels(previousSettings?: Record<string, unknown>) {
  const apiKey = getMediaProviderApiKey(newApi.id);
  const configs = previousSettings?.mediaProviderConfigs as Record<string, { apiKey?: unknown }> | undefined;
  const current = (conf.get("settings", {}).mediaProviderConfigs as typeof configs)?.[newApi.id];
  if (!apiKey || (previousSettings && JSON.stringify(current) === JSON.stringify(configs?.[newApi.id]))) return;
  return refreshMediaProviderModels(`${newApi.id}.ts`, undefined, undefined, apiKey);
}

export async function refreshProviderModels(previousSettings?: Record<string, unknown>) {
  const errors: string[] = [];
  const [language, media] = await Promise.allSettled([refreshLanguageModels(previousSettings), refreshMediaModels(previousSettings)]);
  for (const [result, label] of [[language, "文本"], [media, "媒体"]] as const) {
    if (result.status === "rejected") errors.push(`New API ${label}模型更新失败：${result.reason instanceof Error ? result.reason.message : "未知错误"}`);
  }
  return {
    ...(language.status === "fulfilled" && language.value ? { customProviders: conf.get("settings.customProviders") as typeof language.value } : {}),
    ...(media.status === "fulfilled" && media.value ? { mediaProvider: media.value } : {}),
    ...(errors.length ? { modelRefreshErrors: errors } : {}),
  };
}

export default function initializeProviderModels() {
  // ACT: 每个进程启动时仅尝试一次；失败保留已有模型，下次启动再更新。
  return initialization ??= refreshProviderModels().then(result => {
    result.modelRefreshErrors?.forEach(error => console.warn(error));
  });
}
