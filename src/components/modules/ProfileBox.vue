<template>
  <div class="profile_box">
    <div class="left">
      <img loading="lazy" src="@/assets/images/mirumi.png" alt="みるみ" width="312" height="312">
    </div>
    <div class="right">
      <div class="author">
        みるみ
      </div>
      <div class="content">
        <p>ブロガー、ソフトウェアエンジニア。</p>
        <p v-html="contentBody"></p>
      </div>
      <div class="sns">
        <svg viewBox="0 0 27 27" width="15" height="15"><path :fill="gray" d="M23.1 8.7v.7c0 8-6.4 14.5-14.4 14.6h-.2C5.7 24 3 23.2.6 21.7c.4 0 .8.1 1.2.1 2.3 0 4.6-.8 6.3-2.1C6 19.6 4 18.2 3.3 16c.3.1.7.1 1 .1.5 0 .9-.1 1.4-.2-2.4-.5-4.1-2.6-4.1-5.1v-.1c.7.4 1.5.6 2.3.7-1.5-1-2.2-2.5-2.2-4.3 0-.9.2-1.8.7-2.6C5 7.8 8.8 9.7 13 9.9c-.1-.4-.1-.8-.1-1.2 0-2.8 2.2-5.2 5.2-5.2 1.5 0 2.8.6 3.8 1.7C23 5 24 4.6 25 4.1c-.4 1.2-1.2 2.1-2.2 2.8 1-.1 2-.4 2.9-.8-.8 1-1.7 1.8-2.6 2.6z"></path></svg>
        <a :href="`https://twitter.com/${appConfig.twitterName}`" target="_blank" rel="nofollow">@mirumi</a>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const p = defineProps<{
  category: string,
}>()

const appConfig = useAppConfig()

const gray = ref("var(--color-gray)")
const contentBody = ref("この「みるめも」というブログの筆者です。")

switch (p.category) {
  case "mobile":
    contentBody.value = "Android 2.3 の頃から 10 年以上カスタマイズオタクをやってます。2020 年からは iPhone も持っているので両 OS とも守備範囲になりました。"
    break
  case "game":
    contentBody.value = "1 歳でコントローラーを持つ。ここ数年はインディーズゲームにお熱。"
    break
  case "blog":
    contentBody.value = "雑記ブロガー。文章を書くのが好きです。サイトは全部自分でつくっています。"
    break
  case "car-navigation-system":
    contentBody.value = "数百人分の車/カーナビ/取り付け事情を見てきた元カーナビ販売員。どこよりも詳しいカーナビ情報を書いています。"
    break
  case "pillow":
    contentBody.value = "肩こりを治したくて枕に 15 万円以上も使ってしまったゆえにめちゃくちゃ詳しくなってしまった悲しい人。"
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
  .left, .right {
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
    }
  }
  .right {
    .author {

    }
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
}
</style>
