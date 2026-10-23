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

export default {
  id: "newApi" as const,
  label: "New API",
  icon: "",
  version: "1.0.0",
  apiUrl: "https://ai-proxy.pedoc.cn/v1",
  protocol: "openai-completions",
  readme: "连接自建 New API 网关。填写网关的 /v1 地址及其签发的调用令牌，然后获取文字模型。图片和视频请在媒体模型中配置 New API。",
  rules,
  models: [],
} satisfies ProviderDefinition<typeof rules>;
