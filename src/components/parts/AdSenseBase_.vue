<template>
  <div class="adsense_base">
    <Adsbygoogle
      v-if="kind === '目次上'"
      :ad-slot="'5220077443'"
      :ad-format="'auto'"
      data-full-width-responsive="true"
    />
    <Adsbygoogle
      v-if="kind === 'h2'"
      :ad-slot="'2068327194'"
      :ad-format="'auto'"
      data-full-width-responsive="true"
    />
    <Adsbygoogle
      v-if="kind === '記事下ディスプレイ'"
      :ad-slot="'8302563051'"
      :ad-format="'auto'"
      data-full-width-responsive="true"
    />
    <Adsbygoogle
      v-if="kind === 'Multiplex'"
      :ad-slot="'4732944866'"
      :ad-format="'autorelaxed'"
    />
  </div>
</template>

<script setup lang="ts">
// @ts-nocheck

defineProps<{
  kind: "目次上" | "h2" | "記事下ディスプレイ" | "Multiplex",
}>()

// In `insert_toc_from_cocoon_code()` of endpoints.php
// <!-- 目次上 -->
// <ins
// class="adsbygoogle"
// style="display:block"
// data-ad-client="ca-pub-2873410957106428"
// data-ad-slot="5220077443"
// data-ad-format="auto"
// data-full-width-responsive="true"></ins>

// <!-- h2 -->
// <ins 
// class="adsbygoogle" 
// style="display:block" 
// data-ad-client="ca-pub-2873410957106428" 
// data-ad-slot="2068327194" 
// data-ad-format="auto" 
// data-full-width-responsive="true"></ins>

// <!-- 記事下ディスプレイ -->
// <ins
// class="adsbygoogle"
// style="display:block"
// data-ad-client="ca-pub-2873410957106428"
// data-ad-slot="8302563051"
// data-ad-format="auto"
// data-full-width-responsive="true"></ins>

// <!-- Multiplex -->
// <ins
// class="adsbygoogle" 
// style="display:block" 
// data-ad-format="autorelaxed" 
// data-ad-client="ca-pub-2873410957106428" 
// data-ad-slot="4732944866" 
// 公式ヘルプに「本カスタマイズはサポートを終了した」との記述があり、一度も表示されない問題と関連があるかも不明なので
// 念のためレンダリングからもなくしている。データは別で残っているとはいえテストした結果ではあるのでコード部分もコメント状態で保管。
// data-matched-content-ui-type="image_stacked,image_stacked" 
// data-matched-content-rows-num="4,2" 
// data-matched-content-columns-num="1,2"></ins> 
</script>

<style lang="scss" scoped>
.adsense_base {
  margin: 2.9em auto;
}
</style>
