<template>
  <div class="comment_list">
    <div class="title">
      この記事へのコメント
    </div>
    <div class="comments_wrap">
      <template v-for="c in comments" :key="c.comment_ID">
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
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
const route = useRoute()
const appConfig = useAppConfig()

const slug = route.params.post as string

const { data } = await useFetch(`/mirumi/comments_per_post/${slug}`, {
  baseURL: appConfig.baseURL,
  parseResponse: JSON.parse,
})
const res = data.value as Record<string, any>[]
const comments: Record<string, any>[] = []
const used: number[] = []

// Max comment replies depth is 4, so firstly structure comments which depth is 4 or less
for (const [i, r] of res.entries()) {
  if (r.comment_parent === "0") {
    const _to = r
    _to.children = []
    comments.push(_to)
    used.push(i)
  }
  for (const [j, c] of comments.entries()) {
    if (r.comment_parent === c.comment_ID) {
      const _to = r
      _to.children = []
      comments[j].children.push(_to)
      used.push(i)
    }
    for (const [k, cc] of c.children.entries()) {
      if (r.comment_parent === cc.comment_ID) {
        const _to = r
        _to.children = []
        comments[j].children[k].children.push(_to)
        used.push(i)
      }
      for (const [l, ccc] of cc.children.entries()) {
        if (r.comment_parent === ccc.comment_ID) {
          const _to = r
          _to.children = []
          comments[j].children[k].children[l].children.push(_to)
          used.push(i)
        }
      }
    }
  }
}

// Compare the comment_ID of the `comments` with the comment_parent of the remaining comments
// This will always be depth 4, so put all in the parent found here (this would also limit indentation to 4 times)
const remainingIndecies: number[] = [...Array(res.length).keys()].filter(i => used.indexOf(i) == -1)
const remainingComments: Record<string, any>[] = []
for (const index of remainingIndecies) {
  remainingComments.push(res[index])
}

// The parent-child relationship between which lefts needs to be settled first
const _toDelete: number[] = []
for (const r of remainingComments) {
  for (const other of remainingComments) {
    if (r.comment_ID === other.comment_ID) continue
    
    if (r.comment_ID === other.comment_parent) {
      r.children = []
      r.children.push(other)
      _toDelete.push(other.comment_ID)
    }
  }
}
const cleanRemainingComments: Record<string, any>[] = remainingComments.filter(x => !_toDelete.includes(x.comment_ID))

// Merge them!
for (const [i, c] of comments.entries()) {
  for (const [j, cc] of c.children.entries()) {
    for (const [k, ccc] of cc.children.entries()) {
      for (const [l, cccc] of ccc.children.entries()) {
        for (const r of cleanRemainingComments) {
          if (r.comment_parent === cccc.comment_ID) {
            comments[i].children[j].children[k].children[l].children.push(r)
          }
        }
      }
    }
  }
}

// Testing
try {
  if (res.length !== count()) {
    throw Error("Comments could not be structured correctly")
  }
  function count(): number {
    return (JSON.stringify(comments).match(/"comment_ID":/g) ?? []).length
  }
} catch (err) {
  throw err
}
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
