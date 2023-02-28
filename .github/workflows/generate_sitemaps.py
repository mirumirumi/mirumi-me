from __future__ import annotations
from typing import Any, cast, Final

import os
import re
import httpx
from httpx import Response
from xml.etree import ElementTree


def main() -> None:
    # sitemap.xml
    res_main: Final[Response] = httpx.get("https://mirumi.in/sitemap.xml")
    save_file(".output/public/", "sitemap.xml", res_main.text[2:])

    # sitemap-misc.xml
    res_misc: Final[Response] = httpx.get("https://mirumi.in/sitemap-misc.xml")
    save_file(".output/public/", "sitemap-misc.xml", res_misc.text[2:])

    # each post sitemap
    xml = ElementTree.fromstring(res_main.text[2:])
    for sitemap in xml:
        for node in sitemap:
            if not node.tag.endswith("loc"):
                continue
            fullpath = cast(str, node.text).replace("mirumi.me", "mirumi.in")
            res_post: Final[Response] = httpx.get(fullpath)
            save_file(".output/public/", url_to_filename(fullpath), res_post.text[2:])

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
            content = f.read()
            f.seek(0)
            f.write(re.sub(r"<\?xml-stylesheet.*?\?>", "", content))
            f.truncate()

    return


def url_to_filename(url: str) -> str:
    return url[url.rfind("/") + 1 :]


if __name__ == "__main__":
    main()
