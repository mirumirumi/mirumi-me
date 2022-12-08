<template>
  <Transition name="fadedown" appear>
    <div class="category_menu" v-if="_isShown">
      <ul>
        <li v-for="category in categories" :class="{ 'others_li_wrap': category.slug === 'others' }" :key="category.name">
          <div v-if="category.slug === 'others'" class="others_wrap" @mouseenter="(isShownOthers = true)" @mouseleave="(isShownOthers = false)" @click.stop>
            <div class="others_title">
              <span>
                {{ category.name }}
              </span>
              <PartsSvgIcon :icon="'angle_down'" :color="'var(--color-gray)'" :class="{ 'rotate': isShownOthers }" />
            </div>
            <Transition name="fade" appear>
              <ul v-if="isShownOthers">
                <li v-for="other in others" :key="other.name">
                  <NuxtLink :to="`/category/${other.slug}`" :class="{ 'current': other.current }">
                    {{ other.name }}
                  </NuxtLink>
                </li>
              </ul>
            </Transition>
          </div>
          <NuxtLink v-else :to="`/category/${category.slug}`" :class="{ 'current': category.current }">
            {{ category.name }}
          </NuxtLink>
        </li>
      </ul>
      <Teleport to="body">
        <PartsTransparentBack @click="interruptChoose" />
      </Teleport>
    </div>
  </Transition>
</template>

<script setup lang="ts">
interface Category {
  name: string,
  slug: string,
  current?: boolean,
}

const p = defineProps<{
  isShown: boolean,
}>()

const emit = defineEmits<{
  (e: "interruptChoose" ): void,
}>()

const route = useRoute()
const appConfig = useAppConfig()

const _isShown = ref(p.isShown)
const isShownOthers = ref(false)

const categories: Category[] = [
  { name: "PC", slug: "pc" },
  { name: "スマートフォン", slug: "mobile" },
  { name: "ゲーム", slug: "game" },
  { name: "くらし", slug: "life" },
  { name: "テクノロジー", slug: "technology" },
  { name: "ブログ", slug: "blog" },
  { name: "雑記", slug: "notes" },
  { name: "その他", slug: "others" },
]
const others: Category[] = [
  { name: "音楽", slug: "music" },
  { name: "カーナビ", slug: "car-navigation-system" },
  { name: "枕", slug: "pillow" },
  { name: "明晰夢/体外離脱", slug: "dreaming" },
  { name: "Software Design", slug: "software-design" },
]

const { data } = await useFetch(`/pages`, {
  baseURL: appConfig.baseURL,
})
const pages = JSON.parse(data.value as string)  // included root(`/`) as `home`

checkCurrentCategory()

watch(p, () => {
  _isShown.value = p.isShown
})

watch(route, () => {
  checkCurrentCategory()
})

const interruptChoose = () => {
  _isShown.value = false
  isShownOthers.value = false
  emit("interruptChoose")
}

async function checkCurrentCategory(): Promise<void> {
  // This process is too long and heavy as there are no endpoints that meet needs I want,
  // but I accept them because this site is made with SSG.

  for (const category of categories) {
    if (await isBelongCategoryPage() && await matchCategory(category.slug)) {
      category.current = true
    } else {
      category.current = false
    }
  }
}

async function isBelongCategoryPage(): Promise<boolean> {
  let pageSlugs: string[] = Array()
  for (const page of (pages as Record<string, any>[])) {
    if (page.slug === "home") {
      pageSlugs.push("/")
      continue
    }
    pageSlugs.push("/" + page.slug)
  }

  return !pageSlugs.includes(route.path)
}

async function matchCategory(targetCategorySlug: string): Promise<boolean> {
  let categorySlug = ""

  if (route.path.includes("/category/")) {
    // In category page

    const { data: resCategories } = await useFetch(`/categories`, {
      baseURL: appConfig.baseURL,
      params: {
        slug: route.path.replace("/category/", ""),
      },
    })
    categorySlug = JSON.parse(resCategories.value as string)[0].slug
  } else {
    // In post page

    const { data: resPosts } = await useFetch(`/posts`, {
      baseURL: appConfig.baseURL,
      params: {
        slug: route.path.replace("/", ""),
      },
    })
    const postId = JSON.parse(resPosts.value as string)[0].id
    
    const { data } = await useFetch(`/categories`, {
      baseURL: appConfig.baseURL,
      params: {
        post: postId,
      },
    })
    categorySlug = JSON.parse(data.value as string)[0].slug
  }

  return targetCategorySlug === categorySlug
}
</script>

<style lang="scss" scoped>
.category_menu {
  position: absolute;
  top: 3.7em;
  left: -0.7em;
  width: 172px;
  padding: 7px 5px;
  color: var(--color-gray);
  border-radius: 13px;
  background-color: var(--color-background);
  box-shadow: 0px 2.9px 11px -4px rgb(0 0 0 / 23%);
  transition: none;
  z-index: 14;
  ul {
    li {
      padding: 0 0.9em;
      line-height: 2;
      text-align: left;
      border-radius: 7px;
      .others_wrap {
        cursor: default;
        .others_title {
          position: relative;
          svg {
            right: 0em;
            width: 0.7em;
            transition: 0.13s all ease-in-out;
            &.rotate {
              transform: rotate(-180deg);
            }
          }
        }
        ul {
          margin-top: 0.3em;
          li {
            a {
              color: var(--color-gray);
              font-size: 0.94em;
              line-height: 1.9;
              &:hover {
                color: var(--color-text);
              }
            }
          }
        }
      }
      a, span, .others_wrap > .others_title > span {
        display: block;
        color: var(--color-gray);
        text-decoration: none;
      }
      .current {
        color: var(--color-text);
      }
      &:hover {
        background-color: #f8f5f2;
        a {
          color: var(--color-text);
        }
        &.others_li_wrap {
          background-color: var(--color-background);
        }
      }
    }
  }
}
</style>
