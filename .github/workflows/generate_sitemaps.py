from __future__ import annotations
from typing import Any, cast, Final

import os
import re
import httpx
from httpx import Response
from xml.etree import ElementTree

# 記事が更新された場合には <lastmod> も書き換わるため事実上再生成する必要がある
# ただし今回の記事がどの月に含まれているかを受け取らないといけないため、手間が増える
# もともと全体再生成で特にデメリットはなかったため（わずかに時間がかかる程度）、何も変えない
# 記事が作成された場合には、当然今月分のサイトマップは再生成すべきなので同じく全体再生成でカバーできる


def main() -> None:
    # Generate sitemap.xml
    res_main: Final[Response] = httpx.get("https://mirumi.in/sitemap.xml")
    save_file(".output/public/", "sitemap.xml", res_main.text)

    # Generate sitemap-misc.xml
    res_misc: Final[Response] = httpx.get("https://mirumi.in/sitemap-misc.xml")
    save_file(".output/public/", "sitemap-misc.xml", res_misc.text)

    # Generate for each post
    xml = ElementTree.fromstring(res_main.text)
    for sitemap in xml:
        for node in sitemap:
            if not node.tag.endswith("loc"):
                continue
            fullpath = cast(str, node.text)
            res_post: Final[Response] = httpx.get(fullpath)
            save_file(".output/public/", url_to_filename(fullpath), res_post.text)

    # Exec to do
    format_xmls()

    return


def save_file(dir_path: str, filename: str, file_content: Any) -> None:
    os.makedirs(dir_path, exist_ok=True)
    with open(os.path.join(dir_path, filename), "w") as f:
        f.write(file_content)
    return


def format_xmls() -> None:
    sitemap_files = os.listdir(".output/public/")
    for filename in sitemap_files:
        if not filename.startswith("sitemap"):
            continue
        with open(".output/public/" + filename, mode="r+") as f:
            to_write = f.read()
            f.seek(0)

            # Replace `mirumi.in` -> `mirumi.me`
            to_write = to_write.replace("mirumi.in", "mirumi.me")

            # Add trailing slash
            if re.match("sitemap-.{2}-post-.*?$", filename):
                xml = ElementTree.fromstring(to_write)
                for url in xml:
                    for node in url:
                        if not node.tag.endswith("loc"):
                            continue
                        url = cast(str, node.text)
                        to_write = to_write.replace(url, url + "/")

            # Remove an invalid style spcecification
            to_write = re.sub(r"<\?xml-stylesheet.*?\?>", "", to_write)

            f.write(to_write)
            f.truncate()

    return


def url_to_filename(url: str) -> str:
    return url[url.rfind("/") + 1 :]


if __name__ == "__main__":
    main()
