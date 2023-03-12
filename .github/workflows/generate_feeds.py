from __future__ import annotations
from typing import Any, Final

import os
import httpx
from httpx import Response


def main() -> None:
    # Generate feed.xml
    print("Generating feed.xml\n")
    res_main: Final[Response] = httpx.get("https://mirumi.in/feed")
    save_file(".output/public/", "feed.xml", res_main.text[2:].replace("mirumi.in", "mirumi.me"))

    # Generate feed-comments.xml
    print("Generating feed-comments.xml\n")
    res_comment: Final[Response] = httpx.get("https://mirumi.in/comments/feed")
    save_file(".output/public/", "feed-comments.xml", res_comment.text[2:].replace("mirumi.in", "mirumi.me"))

    return


def save_file(dir_path: str, filename: str, file_content: Any) -> None:
    os.makedirs(dir_path, exist_ok=True)
    with open(os.path.join(dir_path, filename), "w") as f:
        f.write(file_content)
    return


if __name__ == "__main__":
    main()
