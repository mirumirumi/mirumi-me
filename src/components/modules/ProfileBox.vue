<template>
  <div
    class="profile_box"
    itemprop="editor author creator copyrightHolder"
    itemscope
    itemtype="https://schema.org/Person"
  >
    <meta itemprop="url" :content="appConfig.siteFullPath" />
    <div
      class="left"
      itemprop="photo"
      itemscope
      itemtype="https://schema.org/ImageObject"
    >
      <img
        src="@/assets/images/mirumi.png"
        alt="みるみ"
        loading="lazy"
        width="78"
        height="78"
      />
    </div>
    <div class="right">
      <div class="author" itemprop="name"> みるみ </div>
      <div class="content">
        <p>ブロガー、ソフトウェアエンジニア。</p>
        <p v-html="contentBody"></p>
      </div>
      <div class="sns">
        <a :href="`https://x.com/${appConfig.twitterName}`" target="_blank" rel="nofollow"
          >@__mirumi__</a
        >
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const p = defineProps<{
  category: string
}>()

const appConfig = useAppConfig()

const gray = ref("var(--color-gray)")
const contentBody = ref("この「みるめも」というブログの筆者です。")

switch (p.category) {
  case "game":
    contentBody.value = "1 歳でコントローラーを持つ。ここ数年はインディーズゲームにお熱。"
    break
  case "computer-science":
    contentBody.value = "暗号資産業界で働いています。"
    break
  case "blog":
    contentBody.value = "文章を書くのが好きです。サイトは全部自分でつくっています。"
    break
  case "mobile":
    contentBody.value =
      "Android 2.3 の頃から 10 年以上カスタマイズオタクをやっています。2020 年からは iPhone も持って両刀使いに。"
    break
  case "pillow":
    contentBody.value =
      "肩こりを治したくて枕に 15 万円以上も使ってしまったゆえにめちゃくちゃ詳しくなってしまった悲しい人。"
    break
  case "car-navigation-system":
    contentBody.value =
      "数百人分の車/カーナビ/取り付け事情を見てきた元カーナビ販売員。どこよりも詳しいカーナビ情報を書いています。"
    break
  case "dreaming":
    contentBody.value = "趣味で夢や睡眠の研究をしている人。体外離脱が得意です。"
    break
}
</script>

<style lang="scss" scoped>
.profile_box {
  display: table;
  margin: 4.9em auto 4.5em;
  padding: 1.5em 1.3em 1.7em 0.5em;
  width: 77.7%;
  font-size: 0.82em;
  border-radius: 11px;
  border: solid 2.3px #f5f1ee;
  .left,
  .right {
    display: table-cell;
    vertical-align: middle;
  }
  .left {
    width: 25%;
    img {
      display: block;
      margin: 0 auto 0.3em;
      width: 77.7px;
      height: auto;
      aspect-ratio: 312/312;
      border: solid 2.3px #f8f5f2;
      border-radius: 50%;
      @include mobile {
        width: 55.5px;
      }
    }
  }
  .right {
    .content {
      margin: 1.1em auto;
      font-size: 0.97em;
      line-height: 1.3;
      p {
        margin: 0.5em auto;
      }
    }
    .sns {
      display: flex;
      align-items: flex-end;
      gap: 0.3em;
      padding-left: 0.1em;
      font-size: 0.92em;
      svg {
        margin-bottom: 0.05em;
      }
      a {
        color: v-bind(gray);
        text-decoration: none;
        &:hover {
          text-decoration: underline;
        }
      }
    }
  }
  @include mobile {
    width: 99%;
    margin-top: 3.7em;
    padding: 1em 1em 1.3em 0.5em;
  }
}
.dark {
  .profile_box {
    border-color: #6c6a67;
  }
}
</style>
