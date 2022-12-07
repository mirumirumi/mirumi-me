<template>
  <Transition name="fadedown" appear>
    <div class="category_menu" v-if="_isShown">
      <ul>
        <li v-for="category in categories" :key="category.name">
          <NuxtLink :to="`/category/${category.slug}`" :class="{ 'current': category.current }">{{ category.name }}</NuxtLink>
        </li>
      </ul>
      <Teleport to="body">
        <PartsTransparentBack @click="closeSelections" />
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
  (e: "close" ): void,
}>()

const route = useRoute()
const appConfig = useAppConfig()

const _isShown = ref(p.isShown)

// TODO: APIで取る
const categories: Category[] = [
  { name: "PC", slug: "pc" },
  { name: "スマートフォン", slug: "mobile" },
  { name: "ゲーム", slug: "game" },
  { name: "くらし", slug: "life" },
  { name: "テクノロジー", slug: "technology" },
  { name: "ブログ", slug: "blog" },
  { name: "雑記", slug: "notes" },
  { name: "その他", slug: "" },
]
const others: Category[] = [
  { name: "音楽", slug: "music" },
  { name: "カーナビ", slug: "car-navigation-system" },
  { name: "枕", slug: "pillow" },
  { name: "明晰夢/体外離脱", slug: "dreaming" },
  { name: "Software Design", slug: "software-design" },
]

checkCurrentCategory()

watch(p, () => {
  _isShown.value = p.isShown
})

watch(route, () => {
  checkCurrentCategory()
})

const closeSelections = () => {
  _isShown.value = false
  emit("close")
}

async function checkCurrentCategory(): Promise<void> {
  for (const category of categories) {
    if (isBelongCategoryPage() && await matchCategory(category.slug)) {
      category.current = true
    } else {
      category.current = false
    }
  }
}

// TODO: 固定ページの一覧をAPIで取得してまとめる
function isBelongCategoryPage(): boolean {
  if (
    route.path === "/"
    || route.path.includes("/all-entries")
    || route.path.includes("/new-entries")
    || route.path.includes("/about")
    || route.path.includes("/contact")
    || route.path.includes("/nice-to-meet-you-10")
    || route.path.includes("/privacy-policy")
    || route.path.includes("/profile")
    || route.path.includes("/what-is-this-blog")
  ) {
    return false
  } else {
    return true
  }
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
  width: 150px;
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
      a, span {
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
      }
    }
  }
}
</style>
