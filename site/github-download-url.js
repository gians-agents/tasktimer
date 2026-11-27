// Accept only github.com release-asset download URLs from the API.
export const GITHUB_DOWNLOAD_PREFIX = "/gians-agents/tasktimer/releases/download/";

export function isAllowedGitHubDownloadUrl(value) {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (url.protocol !== "https:") {
    return false;
  }
  if (url.hostname !== "github.com") {
    return false;
  }
  // url.port is "" for the default port, including an explicit :443.
  // Reject any host/authority other than exactly "github.com" (ports, credentials).
  if (url.port !== "") {
    return false;
  }
  if (url.host !== "github.com") {
    return false;
  }
  if (url.username !== "" || url.password !== "") {
    return false;
  }
  const authority = /^https:\/\/([^/?#]+)/i.exec(value);
  if (!authority || authority[1] !== "github.com") {
    return false;
  }
  if (!url.pathname.startsWith(GITHUB_DOWNLOAD_PREFIX)) {
    return false;
  }
  if (url.pathname.length <= GITHUB_DOWNLOAD_PREFIX.length) {
    return false;
  }
  return true;
}
