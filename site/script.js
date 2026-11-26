const REPO = "gians-agents/tasktimer";
const RELEASES_PAGE = `https://github.com/${REPO}/releases`;
const LATEST_PAGE = `${RELEASES_PAGE}/latest`;
const LATEST_API = `https://api.github.com/repos/${REPO}/releases/latest`;

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

async function loadLatestRelease() {
  const status = document.getElementById("release-status");
  const links = Array.from(document.querySelectorAll(".download-link"));

  let release;
  try {
    const response = await fetch(LATEST_API, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    release = await response.json();
  } catch {
    // Sem release (404), rede ou rate limit: não deixar o clique em 404 de /download/.
    setDownloadLinks(RELEASES_PAGE);
    renderHashes({});
    return;
  }

  const tag = release.tag_name || "";
  const assets = Array.isArray(release.assets) ? release.assets : [];
  if (status) {
    status.textContent = tag
      ? `Release mais recente: ${tag}${release.name ? ` (${release.name})` : ""}.`
      : "Release mais recente encontrado no GitHub.";
  }

  for (const link of links) {
    const asset = pickAsset(assets, link.dataset.kind);
    if (asset?.browser_download_url) {
      link.href = asset.browser_download_url;
    } else {
      link.href = release.html_url || RELEASES_PAGE;
    }
  }

  const sumsAsset = pickChecksumAsset(assets);
  const sumsUrl =
    sumsAsset?.browser_download_url ||
    (tag ? `https://github.com/${REPO}/releases/download/${encodeURIComponent(tag)}/SHA256SUMS` : null);

  if (!sumsUrl) {
    renderHashes({ releaseUrl: release.html_url || LATEST_PAGE });
    return;
  }

  try {
    const text = await tryReadSums(sumsUrl);
    renderHashes({ text, fileUrl: sumsUrl, releaseUrl: release.html_url });
  } catch {
    renderHashes({ fileUrl: sumsUrl, releaseUrl: release.html_url || LATEST_PAGE });
    const fallback = document.getElementById("hash-fallback");
    fallback.textContent =
      "Não foi possível carregar o SHA256SUMS neste navegador. Abra o arquivo no release para conferir os hashes.";
    show(fallback, true);
  }
}

loadLatestRelease();
