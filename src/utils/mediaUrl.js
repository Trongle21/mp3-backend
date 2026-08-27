const { PUBLIC_URL } = require('../config/r2');

function trimSlash(s) {
  if (!s) return '';
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

/**
 * Ghép key trong R2 với PUBLIC_URL (vd: r2.dev subdomain hoặc custom domain).
 * Nếu PUBLIC_URL không cấu hình hoặc key rỗng → trả về null.
 *
 * @param {string|null|undefined} key   key trong bucket, vd "covers/abc/uuid.jpg"
 * @returns {string|null}
 */
function buildPublicUrl(key) {
  if (!key) return null;
  const base = trimSlash(PUBLIC_URL);
  if (!base) return null;
  const normalized = key.startsWith('/') ? key.slice(1) : key;
  return `${base}/${normalized}`;
}

/**
 * Build coverUrl cho track. Ưu tiên dùng coverKey.
 */
function trackCoverUrl(trackOrKey) {
  const key = typeof trackOrKey === 'string' ? trackOrKey : trackOrKey?.coverKey;
  return buildPublicUrl(key);
}

/**
 * Build thumbnailUrl cho group.
 */
function groupThumbnailUrl(groupOrKey) {
  const key = typeof groupOrKey === 'string' ? groupOrKey : groupOrKey?.thumbnailKey;
  return buildPublicUrl(key);
}

/**
 * Gắn coverUrl vào một track object (đã lean hoặc document mongoose).
 * Mutate trực tiếp để tránh copy.
 */
function attachCoverUrl(track) {
  if (!track) return track;
  track.coverUrl = trackCoverUrl(track);
  return track;
}

function attachThumbnailUrl(group) {
  if (!group) return group;
  group.thumbnailUrl = groupThumbnailUrl(group);
  return group;
}

/**
 * Gắn URL cho mảng items.
 */
function attachCoverUrls(tracks) {
  if (!Array.isArray(tracks)) return tracks;
  for (const t of tracks) attachCoverUrl(t);
  return tracks;
}

function attachThumbnailUrls(groups) {
  if (!Array.isArray(groups)) return groups;
  for (const g of groups) attachThumbnailUrl(g);
  return groups;
}

module.exports = {
  buildPublicUrl,
  trackCoverUrl,
  groupThumbnailUrl,
  attachCoverUrl,
  attachThumbnailUrl,
  attachCoverUrls,
  attachThumbnailUrls,
};