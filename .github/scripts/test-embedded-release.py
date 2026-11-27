#!/usr/bin/env python3
"""Serve site/ locally and confirm the page can load baked release.json."""

from __future__ import annotations

import json
import sys
import threading
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SITE = ROOT / "site"
RELEASE_JSON = SITE / "release.json"

FIXTURE = {
    "tag_name": "v0.1.0-alpha",
    "name": "TaskTimer v0.1.0-alpha",
    "html_url": "https://github.com/gians-agents/tasktimer/releases/tag/v0.1.0-alpha",
    "prerelease": True,
    "draft": False,
    "assets": [
        {
            "name": "TaskTimer_0.1.0_x64-setup.exe",
            "browser_download_url": "https://github.com/gians-agents/tasktimer/releases/download/v0.1.0-alpha/TaskTimer_0.1.0_x64-setup.exe",
        },
        {
            "name": "TaskTimer_0.1.0_x64_en-US.msi",
            "browser_download_url": "https://github.com/gians-agents/tasktimer/releases/download/v0.1.0-alpha/TaskTimer_0.1.0_x64_en-US.msi",
        },
        {
            "name": "TaskTimer_0.1.0_amd64.AppImage",
            "browser_download_url": "https://github.com/gians-agents/tasktimer/releases/download/v0.1.0-alpha/TaskTimer_0.1.0_amd64.AppImage",
        },
        {
            "name": "TaskTimer_0.1.0_amd64.deb",
            "browser_download_url": "https://github.com/gians-agents/tasktimer/releases/download/v0.1.0-alpha/TaskTimer_0.1.0_amd64.deb",
        },
        {
            "name": "SHA256SUMS",
            "browser_download_url": "https://github.com/gians-agents/tasktimer/releases/download/v0.1.0-alpha/SHA256SUMS",
        },
    ],
    "sha256sums": "abc123  TaskTimer_0.1.0_x64-setup.exe\ndef456  TaskTimer_0.1.0_amd64.deb",
    "sha256sums_url": "https://github.com/gians-agents/tasktimer/releases/download/v0.1.0-alpha/SHA256SUMS",
}


class SiteHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(SITE), **kwargs)

    def log_message(self, format: str, *args: object) -> None:  # noqa: A003
        pass


def fetch(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=5) as response:
        return response.read()


def main() -> int:
    existed = RELEASE_JSON.is_file()
    previous = RELEASE_JSON.read_bytes() if existed else None
    RELEASE_JSON.write_text(json.dumps(FIXTURE, indent=2) + "\n", encoding="utf-8")

    server = ThreadingHTTPServer(("127.0.0.1", 0), SiteHandler)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{port}"
    errors: list[str] = []
    try:
        index = fetch(f"{base}/index.html").decode("utf-8")
        if "TaskTimer" not in index or "Content-Security-Policy" not in index:
            errors.append("index.html did not load as expected")
        if "fonts.googleapis.com" in index:
            errors.append("served index.html still references Google Fonts")

        script = fetch(f"{base}/script.js").decode("utf-8")
        if "./release.json" not in script or "release-badge" not in script:
            errors.append("served script.js is missing embedded-release logic")

        payload = json.loads(fetch(f"{base}/release.json").decode("utf-8"))
        if payload.get("tag_name") != "v0.1.0-alpha":
            errors.append(f"unexpected tag in release.json: {payload.get('tag_name')!r}")
        if payload.get("prerelease") is not True:
            errors.append("fixture prerelease flag was not served")
        if "TaskTimer_0.1.0_x64-setup.exe" not in payload.get("sha256sums", ""):
            errors.append("embedded SHA256SUMS missing from served release.json")
        urls = {asset["browser_download_url"] for asset in payload["assets"]}
        expected = {asset["browser_download_url"] for asset in FIXTURE["assets"]}
        if urls != expected:
            errors.append("served asset URLs do not match the fixture")

        css = fetch(f"{base}/styles.css").decode("utf-8")
        if "@font-face" not in css or "ibm-plex-sans-latin-400.woff2" not in css:
            errors.append("served styles.css is missing self-hosted font faces")
        font = fetch(f"{base}/fonts/ibm-plex-sans-latin-400.woff2")
        if len(font) < 1000:
            errors.append("self-hosted font did not download from the local server")
    finally:
        server.shutdown()
        server.server_close()
        if existed and previous is not None:
            RELEASE_JSON.write_bytes(previous)
        elif RELEASE_JSON.is_file():
            RELEASE_JSON.unlink()

    if errors:
        print("Embedded release HTTP test failed:")
        for item in errors:
            print(f" - {item}")
        return 1

    print(f"Embedded release HTTP test passed on {base}")
    print(" - index.html, script.js, styles.css and fonts served")
    print(" - release.json loaded with v0.1.0-alpha, pré-release flag and SHA256SUMS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
