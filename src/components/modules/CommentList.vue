<template>
  <div class="comment_list">
    <div class="title">
      この記事へのコメント
    </div>
    <div class="comments_wrap">
      <!-- <template v-for="c in comments" :key="c.comment_ID">
        <PartsCommentBase :c="c" :depth="1" />
        <template v-if="1 <= c.children.length">
          <template v-for="cc in c.children" :key="cc.comment_ID">
            <PartsCommentBase :c="cc" :depth="2" />
            <template v-if="1 <= cc.children.length">
              <template v-for="ccc in cc.children" :key="ccc.comment_ID">
                <PartsCommentBase :c="ccc" :depth="3" />
                <template v-if="1 <= ccc.children.length">
                  <template v-for="cccc in ccc.children" :key="cccc.comment_ID">
                    <PartsCommentBase :c="cccc" :depth="4" />
                  </template>
                </template>
              </template>
            </template>
          </template>
        </template>
      </template> -->
    </div>
  </div>
</template>

<script setup lang="ts">
const route = useRoute()
const appConfig = useAppConfig()

const slug = route.params.post as string

const { data } = await useFetch(`${appConfig.siteFullPath}/wp-json/mirumi/comments_per_post/${slug}`, {
  parseResponse: JSON.parse,
})
const res = data.value as Record<string, any>[]
const comments: Record<string, any>[] = []

for (const [i, r] of res.entries()) {
  if (r.comment_parent === "0") {
    const _to = r
    _to.children = []
    comments.push(_to)
  }
  for (const [j, c] of comments.entries()) {
    if (r.comment_parent === c.comment_ID) {
      const _to = r
      _to.children = []
      comments[j].children.push(_to)
    }
    for (const [k, cc] of c.children.entries()) {
      if (r.comment_parent === cc.comment_ID) {
        const _to = r
        _to.children = []
        comments[j].children[k].children.push(_to)
      }
      for (const [l, ccc] of cc.children.entries()) {
        if (r.comment_parent === ccc.comment_ID) {
          const _to = r
          _to.children = []
          comments[j].children[k].children[l].children.push(_to)
        }
      }
    }
  }
}


console.log(comments)
console.log(JSON.stringify(comments).match(/"comment_ID":/g).length)





</script>

<style lang="scss" scoped>
.comment_list {
  margin-top: 5em;
  .title {
    padding: 0 0 0.3em 0.3em;
    color: #6c6c6c;
    font-size: 1.09em;
    font-weight: bold;
    border-bottom: solid 1.3px #dedbd8;
  }
  .comments_wrap {
    margin: 1.7em 0 3em;
  }
}
</style>
