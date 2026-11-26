#!/usr/bin/env python3
"""Validate the static GitHub Pages site without deploying it."""

from __future__ import annotations

import html.parser
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SITE = ROOT / "site"
REQUIRED_FILES = [
    "index.html",
    "styles.css",
    "script.js",
    "icon.svg",
    "favicon.ico",
]
REQUIRED_PHRASE = "Hashes disponíveis após o primeiro release"
REQUIRED_COMMANDS = ("sha256sum", "Get-FileHash")
DOWNLOAD_KINDS = {
    "dl-windows-exe": (".exe", "windows-exe"),
    "dl-windows-msi": (".msi", "windows-msi"),
    "dl-linux-appimage": (".appimage", "linux-appimage"),
    "dl-linux-deb": (".deb", "linux-deb"),
}
RELEASES_HOST = "https://github.com/gians-agents/tasktimer/releases"


class PageParser(html.parser.HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.errors: list[str] = []
        self.title_parts: list[str] = []
        self._in_title = False
        self.lang: str | None = None
        self.seen_ids: set[str] = set()
        self.links: list[tuple[str | None, str | None, str | None, str]] = []
        self.stylesheets: list[str] = []
        self.scripts: list[str] = []
        self.text_chunks: list[str] = []
        self._stack: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr = dict(attrs)
        self._stack.append(tag)
        if tag == "html":
            self.lang = (attr.get("lang") or "").strip()
        if tag == "title":
            self._in_title = True
        element_id = attr.get("id")
        if element_id:
            if element_id in self.seen_ids:
                self.errors.append(f"duplicate id: {element_id}")
            self.seen_ids.add(element_id)
        if tag == "a":
            self.links.append((element_id, attr.get("href"), attr.get("data-kind"), attr.get("class") or ""))
        if tag == "link" and (attr.get("rel") or "").lower() == "stylesheet":
            href = attr.get("href") or ""
            if href:
                self.stylesheets.append(href)
        if tag == "script":
            src = attr.get("src")
            if src:
                self.scripts.append(src)
        for key in ("href", "src"):
            value = attr.get(key)
            if value and value.startswith("/") and not value.startswith("//"):
                self.errors.append(
                    f"absolute site-root path {value!r} on <{tag}> would break under /tasktimer/"
                )

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._in_title = False
        if self._stack and self._stack[-1] == tag:
            self._stack.pop()

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title_parts.append(data)
        text = data.strip()
        if text:
            self.text_chunks.append(text)

    def error(self, message: str) -> None:  # pragma: no cover - HTMLParser hook
        self.errors.append(message)


def fail(errors: list[str]) -> None:
    print("Site validation failed:")
    for item in errors:
        print(f" - {item}")
    sys.exit(1)


def main() -> None:
    errors: list[str] = []
    if not SITE.is_dir():
        fail([f"missing site directory: {SITE}"])

    for name in REQUIRED_FILES:
        path = SITE / name
        if not path.is_file() or path.stat().st_size == 0:
            errors.append(f"missing or empty file: site/{name}")

    index = SITE / "index.html"
    if not index.is_file():
        fail(errors or ["site/index.html is missing"])

    html_text = index.read_text(encoding="utf-8")
    if "<!DOCTYPE html>" not in html_text and "<!doctype html>" not in html_text.lower():
        errors.append("index.html is missing a doctype")

    parser = PageParser()
    try:
        parser.feed(html_text)
        parser.close()
    except html.parser.HTMLParseError as exc:  # type: ignore[attr-defined]
        errors.append(f"HTML parse error: {exc}")
    errors.extend(parser.errors)

    title = "".join(parser.title_parts).strip()
    if title != "TaskTimer":
        errors.append(f"document title should be 'TaskTimer', got {title!r}")
    if (parser.lang or "").lower() != "pt-br":
        errors.append(f"html lang should be pt-BR, got {parser.lang!r}")

    body = "\n".join(parser.text_chunks)
    if REQUIRED_PHRASE not in body and REQUIRED_PHRASE not in html_text:
        errors.append(f"missing fallback phrase: {REQUIRED_PHRASE}")
    for command in REQUIRED_COMMANDS:
        if command not in html_text:
            errors.append(f"missing verification command: {command}")

    if "./styles.css" not in parser.stylesheets:
        errors.append("index.html must link to ./styles.css")
    if "./script.js" not in parser.scripts:
        errors.append("index.html must include ./script.js")

    links_by_id = {link_id: href for link_id, href, _kind, _cls in parser.links if link_id}
    fallback_hrefs = {
        RELEASES_HOST,
        RELEASES_HOST + "/",
        RELEASES_HOST + "/latest",
        RELEASES_HOST + "/latest/",
    }
    for element_id, (suffix, kind) in DOWNLOAD_KINDS.items():
        href = links_by_id.get(element_id)
        if not href:
            errors.append(f"missing download button #{element_id}")
            continue
        if not href.startswith(RELEASES_HOST):
            errors.append(f"{element_id} should point at GitHub Releases, got {href}")
            continue
        if href in fallback_hrefs:
            # Initial href may point at the releases page until a release exists.
            continue
        if suffix == ".appimage":
            if not href.lower().endswith(".appimage"):
                errors.append(f"{element_id} should point to an AppImage, got {href}")
        elif not href.lower().endswith(suffix):
            errors.append(f"{element_id} should point to a {suffix} file, got {href}")

    kinds = {kind for _id, _href, kind, cls in parser.links if "download-link" in cls.split()}
    missing_kinds = set(kind for _id, (_suffix, kind) in DOWNLOAD_KINDS.items()) - kinds
    if missing_kinds:
        errors.append(f"download links missing data-kind values: {sorted(missing_kinds)}")

    if "download" not in parser.seen_ids or "hashes" not in parser.seen_ids:
        errors.append("page must define #download and #hashes sections")

    script = (SITE / "script.js").read_text(encoding="utf-8") if (SITE / "script.js").is_file() else ""
    if "releases/latest" not in script and "releases/latest" not in html_text:
        errors.append("site should reference GitHub Releases latest URLs")
    if "setDownloadLinks(RELEASES_PAGE)" not in script:
        errors.append("script.js must point download buttons at the releases page when the API fails")
    if REQUIRED_PHRASE not in script and REQUIRED_PHRASE not in html_text:
        errors.append("script/html must keep the hash fallback text")

    if errors:
        fail(errors)

    print("Site validation passed:")
    print(f" - {index.relative_to(ROOT)} title={title!r} lang={parser.lang}")
    print(f" - required files: {', '.join(REQUIRED_FILES)}")
    print(" - download buttons for Windows .exe/.msi and Linux .AppImage/.deb")
    print(" - SHA256 fallback and sha256sum / Get-FileHash instructions")


if __name__ == "__main__":
    main()
