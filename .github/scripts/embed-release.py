#!/usr/bin/env python3
"""Bake the newest published GitHub release into site/release.json for Pages."""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SITE = ROOT / "site"
OUTPUT = SITE / "release.json"
DEFAULT_REPO = "gians-agents/tasktimer"
GITHUB_DOWNLOAD_PREFIX = "/gians-agents/tasktimer/releases/download/"
API_ACCEPT = "application/vnd.github+json"
USER_AGENT = "tasktimer-pages-embed"
MAX_SUMS_BYTES = 1_000_000
EMPTY_RELEASE = {
    "tag_name": None,
    "name": None,
    "html_url": None,
    "prerelease": False,
    "draft": False,
    "assets": [],
    "sha256sums": None,
    "sha256sums_url": None,
}


def is_allowed_github_download_url(value: object) -> bool:
    """Mirror site/github-download-url.js (including URL pathname normalization)."""
    if not isinstance(value, str) or not value:
        return False
    try:
        parsed = urllib.parse.urlparse(value)
    except ValueError:
        return False
    if parsed.scheme != "https":
        return False
    if parsed.hostname != "github.com":
        return False
    if parsed.port is not None:
        return False
    if parsed.netloc != "github.com":
        return False
    if parsed.username or parsed.password:
        return False
    authority = re.match(r"https://([^/?#]+)", value, flags=re.IGNORECASE)
    if not authority or authority.group(1) != "github.com":
        return False
    # new URL() resolves "." / ".." before the pathname prefix check.
    path = urllib.parse.urljoin("https://github.com/", parsed.path)
    pathname = urllib.parse.urlparse(path).path
    if not pathname.startswith(GITHUB_DOWNLOAD_PREFIX):
        return False
    if len(pathname) <= len(GITHUB_DOWNLOAD_PREFIX):
        return False
    return True


def pick_first_published(releases: object) -> dict | None:
    if not isinstance(releases, list):
        return None
    for item in releases:
        if (
            isinstance(item, dict)
            and item.get("draft") is False
            and item.get("published_at")
        ):
            return item
    return None


def repo_name() -> str:
    return os.environ.get("GITHUB_REPOSITORY") or DEFAULT_REPO


def request_headers(accept: str | None = None) -> dict[str, str]:
    headers = {"User-Agent": USER_AGENT, "Accept": accept or API_ACCEPT}
    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def http_json(url: str) -> object:
    req = urllib.request.Request(url, headers=request_headers())
    with urllib.request.urlopen(req, timeout=30) as response:
        body = response.read()
        return json.loads(body.decode("utf-8"))


def http_text(url: str) -> str:
    headers = request_headers("application/octet-stream")
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as response:
        body = response.read(MAX_SUMS_BYTES + 1)
        if len(body) > MAX_SUMS_BYTES:
            raise RuntimeError(f"SHA256SUMS exceeds {MAX_SUMS_BYTES} bytes")
        return body.decode("utf-8")


def write_release(payload: dict) -> None:
    SITE.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {OUTPUT.relative_to(ROOT)} (tag={payload.get('tag_name')!r})")


def asset_list(release: dict) -> list[dict]:
    out: list[dict] = []
    for asset in release.get("assets") or []:
        if not isinstance(asset, dict):
            continue
        name = asset.get("name")
        url = asset.get("browser_download_url")
        if not isinstance(name, str) or not name:
            continue
        safe = url if is_allowed_github_download_url(url) else None
        out.append({"name": name, "browser_download_url": safe})
    return out


def sums_url_for(release: dict, assets: list[dict]) -> str | None:
    tag = release.get("tag_name") or ""
    direct = None
    for asset in assets:
        if asset["name"] == "SHA256SUMS":
            direct = asset.get("browser_download_url")
            break
    constructed = (
        f"https://github.com/{DEFAULT_REPO}/releases/download/{urllib.parse.quote(str(tag), safe='')}/SHA256SUMS"
        if tag
        else None
    )
    for candidate in (direct, constructed):
        if is_allowed_github_download_url(candidate):
            return candidate
    return None


def main() -> int:
    repo = repo_name()
    api = f"https://api.github.com/repos/{repo}/releases?per_page=20"
    try:
        releases = http_json(api)
    except urllib.error.HTTPError as exc:
        print(f"GitHub Releases API failed: HTTP {exc.code}", file=sys.stderr)
        return 1
    except Exception as exc:  # noqa: BLE001 — surface unexpected network errors
        print(f"GitHub Releases API failed: {exc}", file=sys.stderr)
        return 1

    release = pick_first_published(releases)
    if not release or not release.get("tag_name"):
        print("No published release (drafts ignored); writing empty site/release.json")
        write_release(dict(EMPTY_RELEASE))
        return 0

    assets = asset_list(release)
    sums_url = sums_url_for(release, assets)
    sha256sums = None
    if sums_url:
        try:
            sha256sums = http_text(sums_url).strip() or None
        except Exception as exc:  # noqa: BLE001
            print(f"Warning: could not download SHA256SUMS: {exc}", file=sys.stderr)

    html_url = release.get("html_url")
    if not isinstance(html_url, str) or not html_url.startswith(f"https://github.com/{DEFAULT_REPO}/releases"):
        html_url = f"https://github.com/{DEFAULT_REPO}/releases"

    write_release(
        {
            "tag_name": release.get("tag_name"),
            "name": release.get("name"),
            "html_url": html_url,
            "prerelease": bool(release.get("prerelease")),
            "draft": False,
            "assets": assets,
            "sha256sums": sha256sums,
            "sha256sums_url": sums_url,
        }
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
