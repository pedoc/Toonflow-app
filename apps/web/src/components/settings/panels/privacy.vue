<template>
  <div class="privacy">
    <section class="settingSection" aria-labelledby="privacyTitle">
      <h3 id="privacyTitle">数据与隐私</h3>
      <p>此自托管版本已关闭外部匿名统计。模型请求发送至你配置的供应商，项目和生成素材保存在服务器的数据目录中。</p>
    </section>
  </div>
</template>

<style lang="scss" scoped>
.privacy {
  padding: 0 4px 8px;

  .settingSection {
    h3 { margin: 0 0 12px; font-size: 14px; }
    p { margin: 0; color: var(--el-text-color-secondary); font-size: 13px; line-height: 1.6; }
  }
}
</style>
