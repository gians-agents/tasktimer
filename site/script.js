import { isAllowedGitHubDownloadUrl } from "./github-download-url.js";

const REPO = "gians-agents/tasktimer";
const RELEASES_PAGE = `https://github.com/${REPO}/releases`;
const RELEASES_API = `https://api.github.com/repos/${REPO}/releases?per_page=20`;

const KIND_MATCHERS = {
  "windows-exe": (name) => name.toLowerCase().endsWith("-setup.exe"),
  "windows-msi": (name) => name.toLowerCase().endsWith(".msi"),
  "linux-appimage": (name) => name.toLowerCase().endsWith(".appimage"),
  "linux-deb": (name) => name.toLowerCase().endsWith(".deb"),
};

const FALLBACK_TEXT = "Hashes disponíveis após o primeiro release";

function isChecksumName(name) {
  const lower = name.toLowerCase();
  return lower.endsWith(".sha256") || lower.startsWith("sha256sums");
}

function pickAsset(assets, kind) {
  const match = KIND_MATCHERS[kind];
  return assets.find((asset) => match(asset.name) && !isChecksumName(asset.name));
}

function pickChecksumAsset(assets) {
  return (
    assets.find((asset) => asset.name === "SHA256SUMS") ||
    assets.find((asset) => /^SHA256SUMS$/i.test(asset.name))
  );
}

export function pickFirstPublishedRelease(releases) {
  if (!Array.isArray(releases)) {
    return null;
  }
  return releases.find((release) => release && release.draft === false) || null;
}

export function isUsableRelease(release) {
  return Boolean(release && release.tag_name && release.draft !== true);
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function show(el, visible) {
  if (!el) return;
  el.hidden = !visible;
}

function setDownloadLinks(url) {
  for (const link of document.querySelectorAll(".download-link")) {
    link.href = url;
  }
}

async function tryReadSums(url) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const text = (await response.text()).trim();
  if (!text) {
    throw new Error("empty checksum file");
  }
  return text;
}

function renderHashes({ text, fileUrl, releaseUrl }) {
  const fallback = document.getElementById("hash-fallback");
  const contents = document.getElementById("hash-contents");
  const linkWrap = document.getElementById("hash-link-wrap");
  const fileLink = document.getElementById("hash-file-link");

  if (text) {
    show(fallback, false);
    contents.textContent = text.endsWith("\n") ? text : `${text}\n`;
    show(contents, true);
  } else {
    fallback.textContent = FALLBACK_TEXT;
    show(fallback, true);
    show(contents, false);
  }

  if (fileUrl || releaseUrl) {
    fileLink.href = fileUrl || releaseUrl;
    fileLink.textContent = fileUrl
      ? "Abrir SHA256SUMS no GitHub Releases"
      : "Ver hashes no GitHub Releases";
    show(linkWrap, true);
  } else {
    show(linkWrap, false);
  }
}

function renderStatus(release) {
  const status = document.getElementById("release-status");
  const badge = document.getElementById("release-badge");
  const tag = release.tag_name || "";
  const name = release.name && release.name !== tag ? ` (${release.name})` : "";
  if (status) {
    // Keep the badge as a sibling; set only the leading text node.
    const label = tag
      ? `Release mais recente: ${tag}${name}.`
      : "Release mais recente encontrado no GitHub.";
    const first = status.firstChild;
    if (first && first.nodeType === Node.TEXT_NODE) {
      first.textContent = `${label} `;
    } else {
      status.insertBefore(document.createTextNode(`${label} `), status.firstChild);
    }
  }
  show(badge, Boolean(release.prerelease));
}

async function applyRelease(release) {
  renderStatus(release);

  const assets = Array.isArray(release.assets) ? release.assets : [];
  const links = Array.from(document.querySelectorAll(".download-link"));
  for (const link of links) {
    const asset = pickAsset(assets, link.dataset.kind);
    const safeUrl = isAllowedGitHubDownloadUrl(asset?.browser_download_url)
      ? asset.browser_download_url
      : null;
    link.href = safeUrl || RELEASES_PAGE;
  }

  const tag = release.tag_name || "";
  const sumsAsset = pickChecksumAsset(assets);
  const constructedSums = tag
    ? `https://github.com/${REPO}/releases/download/${encodeURIComponent(tag)}/SHA256SUMS`
    : null;
  const sumsUrl = [
    release.sha256sums_url,
    sumsAsset?.browser_download_url,
    constructedSums,
  ].find(isAllowedGitHubDownloadUrl);
  const releasePage =
    typeof release.html_url === "string" && release.html_url.startsWith(RELEASES_PAGE)
      ? release.html_url
      : RELEASES_PAGE;

  const embeddedSums =
    typeof release.sha256sums === "string" && release.sha256sums.trim()
      ? release.sha256sums.trim()
      : null;
  if (embeddedSums) {
    renderHashes({ text: embeddedSums, fileUrl: sumsUrl, releaseUrl: releasePage });
    return;
  }

  if (!sumsUrl) {
    renderHashes({ releaseUrl: RELEASES_PAGE });
    return;
  }

  try {
    const text = await tryReadSums(sumsUrl);
    renderHashes({ text, fileUrl: sumsUrl, releaseUrl: RELEASES_PAGE });
  } catch {
    renderHashes({ fileUrl: sumsUrl, releaseUrl: RELEASES_PAGE });
    const fallback = document.getElementById("hash-fallback");
    fallback.textContent =
      "Não foi possível carregar o SHA256SUMS neste navegador. Abra o arquivo no release para conferir os hashes.";
    show(fallback, true);
  }
}

async function loadEmbeddedRelease() {
  const url = new URL("./release.json", import.meta.url);
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    return null;
  }
  const data = await response.json();
  return isUsableRelease(data) ? data : null;
}

async function loadReleaseFromApi() {
  const response = await fetch(RELEASES_API, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return pickFirstPublishedRelease(await response.json());
}

export async function loadRelease() {
  try {
    const embedded = await loadEmbeddedRelease();
    if (embedded) {
      await applyRelease(embedded);
      return "embedded";
    }
  } catch {
    // Arquivo ausente ou inválido: tenta a API.
  }

  try {
    const api = await loadReleaseFromApi();
    if (api) {
      await applyRelease(api);
      return "api";
    }
  } catch {
    // Sem release publicado, rede ou rate limit: não deixar o clique em 404 de /download/.
  }

  setDownloadLinks(RELEASES_PAGE);
  renderHashes({});
  const badge = document.getElementById("release-badge");
  show(badge, false);
  return "fallback";
}

if (typeof document !== "undefined") {
  loadRelease();
}
