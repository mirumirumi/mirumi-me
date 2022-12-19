<template>
  <div class="share_buttons">
    <div class="share_button">
      <a :href="`https://twitter.com/intent/tweet?text=${encodeURI(title)} - みるめも @${encodeURI(appConfig.twitterName)}&amp;url=${encodeURI(appConfig.siteFullPath + '/' + slug)}`" target="_top" rel="nofollow noopener noreferrer">
        <svg style="width: 32px; height: 31.9px; transform: scale(1.3)"><path :fill="fillColor" d="M31.939 6.092c-1.18 0.519-2.44 0.872-3.767 1.033 1.352-0.815 2.392-2.099 2.884-3.631-1.268 0.74-2.673 1.279-4.169 1.579-1.195-1.279-2.897-2.079-4.788-2.079-3.623 0-6.56 2.937-6.56 6.556 0 0.52 0.060 1.020 0.169 1.499-5.453-0.257-10.287-2.876-13.521-6.835-0.569 0.963-0.888 2.081-0.888 3.3 0 2.28 1.16 4.284 2.917 5.461-1.076-0.035-2.088-0.331-2.971-0.821v0.081c0 3.18 2.257 5.832 5.261 6.436-0.551 0.148-1.132 0.228-1.728 0.228-0.419 0-0.82-0.040-1.221-0.115 0.841 2.604 3.26 4.503 6.139 4.556-2.24 1.759-5.079 2.807-8.136 2.807-0.52 0-1.039-0.031-1.56-0.089 2.919 1.859 6.357 2.945 10.076 2.945 12.072 0 18.665-9.995 18.665-18.648 0-0.279 0-0.56-0.020-0.84 1.281-0.919 2.4-2.080 3.28-3.397z"></path></svg>
      </a>
      <span class="snsbadge">
        {{ counts.twitter }}
      </span>
    </div>
    <div class="share_button">
      <a :href="`https://b.hatena.ne.jp/entry/s/${encodeURI(appConfig.siteDomain + '/' + slug)}`" target="_top" rel="nofollow noopener noreferrer">
        <svg style="width: 38px; height: 32px; transform: scale(1.13)"><path :fill="fillColor" d="M2.722 15.915v13.738l6.037-0.030c6.031-0.024 6.745-0.048 8.299-0.26 3.648-0.502 5.928-2.141 6.829-4.912 0.514-1.567 0.526-3.714 0.030-5.287-0.526-1.67-1.639-2.952-3.194-3.684-0.538-0.248-1.494-0.52-2.051-0.581-0.194-0.018-0.363-0.054-0.375-0.079s0.242-0.127 0.563-0.236c1.155-0.393 2.135-0.968 2.795-1.639 1.010-1.010 1.44-2.329 1.373-4.204-0.067-1.833-0.629-3.182-1.803-4.295-0.738-0.702-1.621-1.204-2.74-1.573-1.845-0.599-3.254-0.696-10.574-0.696h-5.19v13.738zM13.762 8.426c1.228 0.266 1.784 0.665 2.105 1.536 0.188 0.514 0.181 1.657-0.006 2.147-0.321 0.811-0.901 1.222-2.081 1.464-0.605 0.127-2.244 0.23-3.254 0.206l-0.817-0.018-0.018-2.746-0.012-2.74 1.827 0.030c1.295 0.024 1.954 0.054 2.256 0.121zM13.919 18.752c0.792 0.085 1.555 0.26 1.954 0.46 0.859 0.43 1.301 1.282 1.307 2.516 0.006 1.809-0.938 2.631-3.279 2.885-0.327 0.036-1.403 0.067-2.408 0.067h-1.815v-5.989h1.809c0.992 0 2.087 0.030 2.432 0.061z"></path><path :fill="fillColor" d="M29.217 11.342v9.164h6.049v-18.329h-6.049v9.164z"></path><path :fill="fillColor" d="M31.407 22.805c-0.653 0.175-1.131 0.448-1.621 0.938-0.69 0.69-0.992 1.428-0.992 2.42 0 1.022 0.296 1.73 1.022 2.456 0.708 0.708 1.464 1.022 2.468 1.022 1.149 0 2.202-0.563 2.849-1.53 0.411-0.617 0.587-1.192 0.581-1.918 0-1.016-0.315-1.76-1.047-2.48-0.901-0.895-2.069-1.216-3.261-0.907z"></path></svg>
      </a>
      <span class="snsbadge">
        {{ counts.hatebu }}
      </span>
    </div>
    <div class="share_button">
      <a :href="`https://feedly.com/i/discover/sources/search/feed/${encodeURI(appConfig.siteFullPath)}`" target="_top" rel="nofollow noopener noreferrer">
        <svg style="width: 32px; height: 33.45px; transform: scale(1.2)"><path :fill="fillColor" d="M18.48 2.652c-0.632-0.644-1.511-1.043-2.484-1.043s-1.852 0.399-2.483 1.043l-0.001 0.001-12.488 12.717c-0.633 0.654-1.024 1.546-1.024 2.53s0.39 1.876 1.024 2.531l-0.001-0.001 8.912 9.077c0.613 0.549 1.427 0.884 2.32 0.885h7.484c0.978-0.001 1.862-0.404 2.495-1.054l0.001-0.001 8.739-8.9c0.634-0.654 1.025-1.546 1.025-2.53s-0.391-1.877-1.026-2.531l0.001 0.001zM18.133 25.881l-1.247 1.267c-0.090 0.094-0.217 0.152-0.357 0.152 0 0 0 0 0 0h-1.067c-0.127-0.001-0.242-0.050-0.33-0.128l0 0-1.272-1.293c-0.090-0.093-0.146-0.221-0.146-0.361s0.056-0.268 0.146-0.361l-0 0 1.783-1.813c0.090-0.092 0.215-0.15 0.354-0.15s0.264 0.057 0.354 0.15l0 0 1.783 1.815c0.091 0.093 0.147 0.221 0.147 0.361s-0.056 0.269-0.148 0.363l0-0zM18.133 18.267l-4.983 5.077c-0.090 0.091-0.216 0.148-0.355 0.148-0.001 0-0.002 0-0.003 0h-1.065c-0.001 0-0.002 0-0.003 0-0.127 0-0.242-0.047-0.331-0.125l0.001 0-1.268-1.293c-0.091-0.094-0.147-0.222-0.147-0.363s0.056-0.269 0.147-0.363l-0 0 5.519-5.619c0.090-0.092 0.215-0.149 0.354-0.149s0.264 0.057 0.354 0.149l0 0 1.783 1.816c0.090 0.093 0.146 0.219 0.146 0.359 0 0.141-0.057 0.268-0.148 0.361l0-0zM18.133 10.657l-8.72 8.88c-0.090 0.093-0.216 0.151-0.356 0.151-0 0-0.001 0-0.001 0h-1.067c-0.001 0-0.001 0-0.002 0-0.127 0-0.243-0.048-0.331-0.126l0 0-1.271-1.296c-0.090-0.093-0.146-0.22-0.146-0.36s0.056-0.267 0.146-0.36l-0 0 9.257-9.427c0.090-0.092 0.215-0.149 0.354-0.149s0.264 0.057 0.354 0.149l0 0 1.783 1.813c0.091 0.093 0.147 0.221 0.147 0.361s-0.056 0.269-0.148 0.363l0-0z"></path></svg>
      </a>
      <span class="snsbadge">
        {{ counts.feedly }}
      </span>
    </div>
    <div class="share_button">
      <a :href="`https://getpocket.com/edit?url=${encodeURI(appConfig.siteFullPath + '/' + slug)}`" target="_top" rel="nofollow noopener noreferrer">
        <svg style="width: 32px; height: 31.8px; transform: scale(1.13)"><path :fill="fillColor" d="M25.084 13.679l-7.528 7.225c-0.427 0.407-0.973 0.611-1.521 0.611-0.547 0-1.095-0.204-1.521-0.611l-7.528-7.225c-0.876-0.837-0.903-2.228-0.065-3.101 0.84-0.876 2.228-0.905 3.1-0.067l6.015 5.763 6.023-5.763c0.88-0.841 2.263-0.809 3.101 0.065 0.841 0.86 0.82 2.26-0.060 3.101zM31.861 3.617c-0.399-1.144-1.5-1.915-2.721-1.915h-26.235c-1.2 0-2.289 0.752-2.716 1.873-0.125 0.333-0.189 0.681-0.189 1.032v9.66l0.112 1.921c0.464 4.369 2.729 8.189 6.243 10.852 0.060 0.048 0.125 0.093 0.191 0.14l0.040 0.031c1.881 1.373 3.985 2.304 6.259 2.763 1.048 0.211 2.121 0.32 3.185 0.32 0.985 0 1.975-0.089 2.945-0.272 0.117-0.039 0.235-0.060 0.352-0.080 0.031 0 0.065-0.020 0.099-0.039 2.177-0.48 4.197-1.381 6.011-2.7l0.039-0.041 0.18-0.14c3.503-2.66 5.765-6.483 6.248-10.864l0.097-1.921v-9.644c0-0.335-0.041-0.667-0.161-0.989z"></path></svg>
      </a>
      <span class="snsbadge">
        {{ counts.pocket }}
      </span>
    </div>
    <div class="share_button">
      <button class="like_button" aria-label="いいね" @click="onClickLike">
        <div class="heart_wrapper" ref="heartWrapper" >
          <div class="heart">
            <div class="tl"></div>
            <div class="tr"></div>
            <div class="bl"></div>
            <div class="br"></div>
          </div>
          <div class="ring"></div>
          <div class="circles"></div>
        </div>
      </button>
      <span class="snsbadge" :style="`color: ${likeCountColor}`">
        {{ likeCount }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useLocalStorage } from "@vueuse/core"

const p = defineProps<{
  slug: string,
  title: string,
  counts: {
    twitter: number,
    hatebu: number,
    feedly: number,
    pocket: number,
    like: number,
  },
}>()

const appConfig = useAppConfig()
const likeState = useLocalStorage("like", "")

const fillColor = ref("#cbbbb4")
/**
 * Old colors:
 *  - Twitter: #8cbadb
 *  - Hatebu:  #72bbe5
 *  - Feedly:  #9fcc95
 *  - Pocket:  #e88992
 */

const heartWrapper = ref()
const likeCount = ref(p.counts.like)
const likeCountColor = ref("#c4c1be")

onMounted(() => {
  if (isLikedThisSlug()) {
    likeCountColor.value = "#ed7e8e"
    heartWrapper.value.classList.add("active")
  }
})

const onClickLike = async () => {
  const _isLikedThisSlug = isLikedThisSlug()

  await useFetch(`${appConfig.siteFullPath}/wp-json/mirumi/upsert_like_count`, {
    method: "POST",
    params: {
      slug: p.slug,
      direction: _isLikedThisSlug ? "down" : "up",
    },
  })

  if (_isLikedThisSlug) {
    heartWrapper.value.classList.remove("active")
    likeCount.value -= 1
    likeCountColor.value = "#c4c1be"
    likeState.value = likeState.value.replace("," + p.slug, "")
  } else {
    heartWrapper.value.classList.add("active")
    likeCount.value += 1
    likeCountColor.value = "#ed7e8e"
    likeState.value += `,${p.slug}`
  }
}

function isLikedThisSlug(): boolean {
  let result = false
  const slugs = likeState.value.split(",")
  for (const slug of slugs) {
    if (slug === p.slug) result = true
  }
  return result
}
</script>

<style lang="scss" scoped>
.share_buttons {
  display: flex;
  justify-content: center;
  align-items: center;
  flex-wrap: nowrap;
  margin: 1.3em auto 3.7em;
  .share_button {
    margin: auto 0.35em;
    a, .like_button {
      position: relative;
      display: inline-flex;
      justify-content: center;
      align-items: center;
      width: 66.6px;
      height: 64.26px;
      margin-bottom: -5px;
      border-radius: 50%;
      border-color: transparent;
      background-color: transparent;
      transition: 0.47s all cubic-bezier(0.24, 0.35, 0.57, 0.89);
    }
    .like_button {
      padding-bottom: 1.5px;
      &:hover .heart > *::after {
        background-color: #f4b9c5;
        transition: 0.11s all cubic-bezier(0.41, 0.15, 0.58, 1);
      }
    }
    .snsbadge {
      display: block;
      font-weight: bold;
      color: v-bind(fillColor);
      font-size: 0.85em;
      font-family: Arial, Roboto, sans-serif;
      text-align: center;
      line-height: 1.8;
      user-select: none;
    }
  }
}
.heart_wrapper {
  position: relative;
  cursor: pointer;
  .heart {
    position: absolute;
    margin-top: -14px;
    margin-left: -18px;
    left: 50%;
    display: block;
    width: 36px;
    height: 32px;
    z-index: 0;
    > * {
      position: absolute;
      overflow: hidden;
      &::after {
        position: absolute;
        display: block;
        content: "";
        background: #c4c1be;
        transition: 0.13s all cubic-bezier(0.24, 0.35, 0.57, 0.89);
      }
    }
    .tl {
      height: 25%;
      width: 50.25%;
      top: 0;
      left: 0;
      &::after {
        top: 0;
        left: 0;
        height: 200%;
        width: 104%;
        border-top-left-radius: 70% 80%;
        border-top-right-radius: 80% 80%;
        border-bottom-right-radius: 50% 50%;
        border-bottom-left-radius: 50% 50%;
      }
    }
    .tr {
      height: 25%;
      width: 50.25%;
      top: 0;
      right: 0;
      &::after {
        top: 0;
        right: 0;
        height: 200%;
        width: 104%;
        border-top-left-radius: 80% 80%;
        border-top-right-radius: 70% 80%;
        border-bottom-right-radius: 50% 50%;
        border-bottom-left-radius: 50% 50%;
      }
    }
    .bl {
      height: 75.5%;
      width: 50.25%;
      bottom: 0;
      left: 0;
      &::after {
        top: 0;
        left: 0;
        height: 95%;
        width: 160%;
        border-top-left-radius: 0 0;
        border-top-right-radius: 0 0;
        border-bottom-right-radius: 0 0;
        border-bottom-left-radius: 100% 100%;
      }
    }
    .br {
      height: 75.5%;
      width: 50.25%;
      bottom: 0;
      right: 0;
      &::after {
        top: 0;
        right: 0;
        height: 95%;
        width: 160%;
        border-top: none;
        border-right: none;
        border-bottom-right-radius: 100% 100%;
        border-bottom-left-radius: 0 0;
      }
    }
  }
  .ring {
    display: block;
    position: absolute;
    border-width: 0;
    border-style: solid;
    top: 50%;
    left: 50%;
    border-radius: 50%;
    z-index: 1;
  }
  .circles {
    display: block;
    position: absolute;
    height: 5.333px;
    width: 6px;
    top: 50%;
    left: 50%;
    margin-top: -2.666666px;
    margin-left: -3px;
    z-index: 2;
    border-radius: 50%;
  }
  &.active {
    .heart {
      animation-name: heart;
      animation-duration: 0.8s;
      animation-timing-function: ease-in;
      animation-iteration-count: 1;
      .tl::after,
      .tr::after,
      .bl::after,
      .br::after {
        background: #ed7e8e;
      }
    }
    .ring {
      animation-name: ring;
      animation-duration: 0.8s;
      animation-timing-function: ease-in;
      animation-iteration-count: 1;
    }
    .circles {
      animation-name: circles;
      animation-duration: 0.8s;
      animation-timing-function: ease-in;
      animation-iteration-count: 1;
    }
  }
}
@keyframes heart {
  0%,
  18.51852% {
    height: 0;
    width: 0;
    top: 50%;
    margin-top: 0;
    margin-left: 0;
  }
  44.44444% {
    height: 40px;
    width: 45px;
    top: 54%;
    margin-top: -17.5px;
    margin-left: -22.5px;
  }
  62.96296% {
    height: 32px;
    width: 36px;
    top: 54%;
    margin-top: -14px;
    margin-left: -18px;
  }
  81.48148% {
    height: 32.8px;
    width: 36.9px;
    top: 54%;
    margin-top: -14.25px;
    margin-left: -18.45px;
  }
  100% {
    height: 32px;
    width: 36px;
    top: 54%;
    margin-top: -14px;
    margin-left: -18px;
  }
}
@keyframes ring {
  0% {
    height: 0;
    width: 0;
    border-width: 0;
    margin-top: 0;
    margin-left: 0;
  }
  3.7037% {
    height: 0;
    width: 0;
    border-width: 3.4px;
    margin-top: -3.2px;
    margin-left: -3.6px;
    border-color: #e2264d;
  }
  7.40741% {
    height: 0;
    width: 0;
    border-width: 23.8px;
    margin-top: -22.4px;
    margin-left: -25.2px;
  }
  11.11111% {
    height: 0;
    width: 0;
    border-width: 27.2px;
    margin-top: -25.6px;
    margin-left: -28.8px;
  }
  14.81481% {
    height: 0;
    width: 0;
    border-width: 28.9px;
    margin-top: -26.2px;
    margin-left: -29.6px;
  }
  18.51852% {
    width: 43.2px;
    height: 38.4px;
    border-width: 8.5px;
    border-color: #cc8ef5;
    margin-top: -19.2px;
    margin-left: -21.6px;
  }
  22.22222% {
    width: 57.6px;
    height: 51.2px;
    border-width: 1.7px;
    margin-top: -25.6px;
    margin-left: -28.8px;
  }
  25.92593%,
  100% {
    width: 61.2px;
    height: 54.4px;
    border-width: 0;
    margin-top: -27.2px;
    margin-left: -30.6px;
  }
}
@keyframes circles {
  0%,
  18.51852% {
    box-shadow: -18.03122px -18.03122px 0 -2.83333px #8ce8c3, -19.53413px -16.39108px 0 -2.83333px #8be7c2, 2.85509px -25.33966px 0 -2.83333px #959ff3, 0.63573px -25.49207px 0 -2.83333px #f582cc, 21.59147px -13.56682px 0 -2.83333px #cc8ef5, 20.32688px -15.39701px 0 -2.83333px #cb8df4, 24.06902px 8.42212px 0 -2.83333px #8ce8c3, 24.71147px 6.29231px 0 -2.83333px #8ce8c3, 8.42212px 24.06902px 0 -2.83333px #f58ea7, 10.48782px 23.2434px 0 -2.83333px #f48da6, -13.56682px 21.59147px 0 -2.83333px #91d2fa, -11.63337px 22.69173px 0 -2.83333px #91d2fa, -25.33966px 2.85509px 0 -2.83333px #92d3fc, -24.9944px 5.05273px 0 -2.83333px #cb8df4;
  }
  22.22222% {
    box-shadow: -19.2333px -19.2333px 0 -1.13333px #8ce8c3, -22.13868px -18.57656px 0 -1.13333px #8be7c2, 3.04543px -27.02897px 0 -1.13333px #959ff3, 0.7205px -28.89102px 0 -1.13333px #f582cc, 23.0309px -14.47127px 0 -1.13333px #cc8ef5, 23.03713px -17.44995px 0 -1.13333px #cb8df4, 25.67363px 8.98359px 0 -1.13333px #8ce8c3, 28.00633px 7.13129px 0 -1.13333px #8ce8c3, 8.98359px 25.67363px 0 -1.13333px #f58ea7, 11.8862px 26.34252px 0 -1.13333px #f48da6, -14.47127px 23.0309px 0 -1.13333px #91d2fa, -13.18449px 25.7173px 0 -1.13333px #91d2fa, -27.02897px 3.04543px 0 -1.13333px #92d3fc, -28.32698px 5.72642px 0 -1.13333px #cb8df4;
  }
  51.85185% {
    box-shadow: -28.84996px -28.84996px 0 -0.56667px #9b88cb, -28.5148px -18.51773px 0 -1.98333px #ac77d9, 4.56815px -40.54346px 0 -0.56667px #8ed6cf, -3.30094px -33.83938px 0 -1.98333px #f58bb0, 34.54635px -21.70691px 0 -0.56667px #d1dbaa, 24.39859px -23.67929px 0 -1.98333px #d8ce9f, 38.51044px 13.47539px 0 -0.56667px #66cc9e, 33.72549px 4.31179px 0 -1.98333px #70d4a8, 13.47539px 38.51044px 0 -0.56667px #d5a5bf, 17.65641px 29.056px 0 -1.98333px #ad9be0, -21.70691px 34.54635px 0 -0.56667px #bc7be1, -11.70831px 31.92046px 0 -1.98333px #a38cdb, -40.54346px 4.56815px 0 -0.56667px #b77bdc, -32.25643px 10.74815px 0 -1.98333px #9fcbcc;
  }
  81.48148%,
  100% {
    box-shadow: -28.84996px -28.84996px 0 -2.83333px #a068ce, -28.5148px -18.51773px 0 -2.83333px #b752e1, 4.56815px -40.54346px 0 -2.83333px #8ce8c3, -3.30094px -33.83938px 0 -2.83333px #f58ea7, 34.54635px -21.70691px 0 -2.83333px #d3f491, 24.39859px -23.67929px 0 -2.83333px #dce483, 38.51044px 13.47539px 0 -2.83333px #59c392, 33.72549px 4.31179px 0 -2.83333px #67cd9f, 13.47539px 38.51044px 0 -2.83333px #caadc7, 17.65641px 29.056px 0 -2.83333px #959ff3, -21.70691px 34.54635px 0 -2.83333px #ca5ed8, -11.70831px 31.92046px 0 -2.83333px #a975d1, -40.54346px 4.56815px 0 -2.83333px #c35dd1, -32.25643px 10.74815px 0 -2.83333px #90e0be;
  }
}
</style>
