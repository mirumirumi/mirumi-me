from __future__ import annotations
from typing import Final

import re
import httpx
import argparse

PER_PAGE: Final[int] = 13


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--category", required=True)
    args = parser.parse_args()

    category_id = httpx.get(f"https://mirumi.in/wp-json/mirumi/category_id_with_category_slug/{args.category}").json()[
        "categoryId"
    ]

    page_count = httpx.get(
        "https://mirumi.in/wp-json/wp/v2/posts",
        params={
            "per_page": PER_PAGE,
            "type": "post",
            "subtype": "post",
            "status": ["publish"],
            "categories": int(category_id),
            "_fields": "id",
        },
    ).headers["x-wp-totalpages"]

    category_pages = f', "/category/{args.category}"'
    for x in range(1, int(page_count) + 1):
        category_pages += f', "/category/{args.category}/page/{x}"'

    # Replace `nitro.prerender.crawlLinks` to generate category pages that included a specific post
    with open("nuxt.config.ts", mode="r+") as f:
        to_write = f.read()
        f.seek(0)

        to_write = re.sub(
            r"(nitro: { prerender: { crawlLinks: false, routes: )\[(.*?)\]", f"\\1[\\2{category_pages}]", to_write
        )

        f.write(to_write)
        f.truncate()

    return


if __name__ == "__main__":
    main()
