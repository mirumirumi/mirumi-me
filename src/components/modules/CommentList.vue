<template>
  <div class="comment_list">
    <div class="title">この記事へのコメント</div>
    <div v-if="allComments.length === 0" class="no_contents">
      コメントはまだひとつもありません :)
    </div>
    <div v-else class="comments_wrap">
      <template v-for="c in leading5Comments" :key="c.comment_ID">
        <ModulesCommentBase :c="c" :depth="1" />
        <template v-if="1 <= c.children.length">
          <template v-for="cc in c.children" :key="cc.comment_ID">
            <ModulesCommentBase :c="cc" :depth="2" />
            <template v-if="1 <= cc.children.length">
              <template v-for="ccc in cc.children" :key="ccc.comment_ID">
                <ModulesCommentBase :c="ccc" :depth="3" />
                <template v-if="1 <= ccc.children.length">
                  <template v-for="cccc in ccc.children" :key="cccc.comment_ID">
                    <ModulesCommentBase :c="cccc" :depth="4" />
                  </template>
                </template>
              </template>
            </template>
          </template>
        </template>
      </template>
      <div v-if="5 <= allComments.length" class="load_more" @click="loadMore()">
        <PartsBaseButton
          v-if="loadMoreStatus !== 'completed'"
          :type="'text'"
          :isSubmitting="loadMoreStatus === 'loading'"
          :spinner-color="'var(--color-text)'"
          >すべて読み込む ({{
            remainingAllComments.flat(Infinity).length
          }}
          件)</PartsBaseButton
        >
      </div>
      <div v-show="loadMoreStatus === 'completed'">
        <template v-for="c in remainingAllComments" :key="c.comment_ID">
          <ModulesCommentBase :c="c" :depth="1" />
          <template v-if="1 <= c.children.length">
            <template v-for="cc in c.children" :key="cc.comment_ID">
              <ModulesCommentBase :c="cc" :depth="2" />
              <template v-if="1 <= cc.children.length">
                <template v-for="ccc in cc.children" :key="ccc.comment_ID">
                  <ModulesCommentBase :c="ccc" :depth="3" />
                  <template v-if="1 <= ccc.children.length">
                    <template v-for="cccc in ccc.children" :key="cccc.comment_ID">
                      <ModulesCommentBase :c="cccc" :depth="4" />
                    </template>
                  </template>
                </template>
              </template>
            </template>
          </template>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const route = useRoute()
const appConfig = useAppConfig()

const slug = route.params.post as string
const loadMoreStatus = ref<"none" | "loading" | "completed">("none")

const { data } = await useFetch(`/mirumi/comments_per_post/${slug}`, {
  baseURL: appConfig.baseURL,
})

// Hack for JSON parse error (unexpected token)
const res = JSON.parse(JSON.stringify(data.value as any))

const allComments: Record<string, any>[] = []
const used: number[] = []

// Max comment replies depth is 4, so firstly structure comments which depth is 4 or less
for (const [i, r] of res.entries()) {
  if (r.comment_parent === "0") {
    const _to = r
    _to.children = []
    allComments.push(_to)
    used.push(i)
  }
  for (const [j, c] of allComments.entries()) {
    if (r.comment_parent === c.comment_ID) {
      const _to = r
      _to.children = []
      allComments[j].children.push(_to)
      used.push(i)
    }
    for (const [k, cc] of c.children.entries()) {
      if (r.comment_parent === cc.comment_ID) {
        const _to = r
        _to.children = []
        allComments[j].children[k].children.push(_to)
        used.push(i)
      }
      for (const [l, ccc] of cc.children.entries()) {
        if (r.comment_parent === ccc.comment_ID) {
          const _to = r
          _to.children = []
          allComments[j].children[k].children[l].children.push(_to)
          used.push(i)
        }
      }
    }
  }
}

// Compare the comment_ID of the `comments` with the comment_parent of the remaining comments
// This will always be depth 4, so put all in the parent found here (this would also limit indentation to 4 times)
const remainingIndecies: number[] = [...Array(res.length).keys()].filter(
  (i) => used.indexOf(i) === -1
)
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
const cleanRemainingComments: Record<string, any>[] = remainingComments.filter(
  (x) => !_toDelete.includes(x.comment_ID)
)

// Merge them!
for (const [i, c] of allComments.entries()) {
  for (const [j, cc] of c.children.entries()) {
    for (const [k, ccc] of cc.children.entries()) {
      for (const [l, cccc] of ccc.children.entries()) {
        for (const r of cleanRemainingComments) {
          if (r.comment_parent === cccc.comment_ID) {
            allComments[i].children[j].children[k].children[l].children.push(r)
          }
        }
      }
    }
  }
}

const leading5Comments = allComments.slice(0, 5)
const remainingAllComments = allComments.slice(5)
const loadMore = async () => {
  loadMoreStatus.value = "loading"
  await delay(Math.floor(Math.random() * 600) + 100) // 0.1s ~ 0.7s
  loadMoreStatus.value = "completed"
}

// Testing
if (res.length !== (JSON.stringify(allComments).match(/"comment_ID":/g) ?? []).length) {
  throw Error("Comments could not be structured correctly")
}
</script>

<style lang="scss" scoped>
.comment_list {
  margin-top: 5em;
  .title {
    padding-bottom: 0.3em;
    color: #6c6c6c;
    font-size: 1.09em;
    font-weight: bold;
    border-bottom: solid 1.3px #dedbd8;
  }
  .no_contents {
    margin: 1.5em 1.3em 1em;
    font-size: 0.95em;
  }
  .comments_wrap {
    margin: 1.7em 0 3em;
    .load_more {
      margin: 2.9em auto 1em;
      text-align: center;
      button {
        width: 100%;
        padding: 0.5em 1.5em 0.59em;
        background-color: #f1ede9;
        &:hover {
          opacity: 0.7;
          filter: contrast(0.9);
        }
      }
    }
  }
}
.dark {
  .comment_list {
    .title {
      color: #c8c8c8;
    }
    .comments_wrap {
      .load_more {
        button {
          background-color: #3e3e3e;
          &:hover {
            filter: contrast(0.8);
          }
        }
      }
    }
  }
}
</style>
