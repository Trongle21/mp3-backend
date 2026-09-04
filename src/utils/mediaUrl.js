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

function conversationAvatarUrl(convOrKey) {
  const key = typeof convOrKey === 'string' ? convOrKey : convOrKey?.avatarKey;
  return buildPublicUrl(key);
}

function attachConversationAvatarUrl(conv) {
  if (!conv) return conv;
  conv.avatarUrl = conversationAvatarUrl(conv);
  return conv;
}

function attachConversationAvatarUrls(convs) {
  if (!Array.isArray(convs)) return convs;
  for (const c of convs) attachConversationAvatarUrl(c);
  return convs;
}

function attachMessageMediaUrl(msg) {
  if (!msg) return msg;
  if (['image', 'gif', 'audio'].includes(msg.type) && msg.content) {
    msg.mediaUrl = buildPublicUrl(msg.content);
  } else {
    msg.mediaUrl = null;
  }
  return msg;
}

function attachMessagesMediaUrls(msgs) {
  if (!Array.isArray(msgs)) return msgs;
  for (const m of msgs) attachMessageMediaUrl(m);
  return msgs;
}

module.exports = {
  buildPublicUrl,
  trackCoverUrl,
  groupThumbnailUrl,
  conversationAvatarUrl,
  attachCoverUrl,
  attachThumbnailUrl,
  attachConversationAvatarUrl,
  attachCoverUrls,
  attachThumbnailUrls,
  attachConversationAvatarUrls,
  attachMessageMediaUrl,
  attachMessagesMediaUrls,
};