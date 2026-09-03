const crypto = require("crypto");
const { PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { parseBuffer } = require("music-metadata");
const { Readable } = require("stream");

const { client: s3, BUCKET } = require("../config/r2");
const Track = require("../models/Track");
const Album = require("../models/Album");
const { attachCoverUrl } = require("../utils/mediaUrl");

// Cho phép upload trực tiếp qua presigned URL, giới hạn độc lập với Vercel.
const MAX_DIRECT_UPLOAD_BYTES = 500 * 1024 * 1024; // 500MB

const ALLOWED_MIME = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/flac",
  "audio/x-flac",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/mp4",
  "audio/x-m4a",
  "audio/aac",
]);

const ALLOWED_EXT = [".mp3", ".flac", ".wav", ".m4a"];

function extFromFilename(name) {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "mp3";
}

function mimeFromExt(ext) {
  const map = {
    mp3: "audio/mpeg",
    flac: "audio/flac",
    wav: "audio/wav",
    m4a: "audio/mp4",
    aac: "audio/aac",
  };
  return map[ext] || "audio/mpeg";
}

/**
 * GET /api/tracks/upload-url
 * Body: { filename, mimeType?, sizeBytes? }
 * Trả về presigned URL để client upload thẳng lên R2.
 */
exports.getUploadUrl = async (req, res) => {
  const { filename, mimeType, sizeBytes } = req.body;

  if (!filename || typeof filename !== "string") {
    return res
      .status(400)
      .json({ success: false, message: "filename is required" });
  }

  const ext = extFromFilename(filename.toLowerCase());
  if (!ALLOWED_EXT.includes(`.${ext}`)) {
    return res.status(400).json({
      success: false,
      message: `Unsupported extension .${ext}. Allowed: ${ALLOWED_EXT.join(", ")}`,
    });
  }

  if (sizeBytes !== undefined && sizeBytes > MAX_DIRECT_UPLOAD_BYTES) {
    return res.status(400).json({
      success: false,
      message: `File too large. Maximum is ${MAX_DIRECT_UPLOAD_BYTES / 1024 / 1024}MB for direct upload.`,
    });
  }

  if (mimeType && !ALLOWED_MIME.has(mimeType)) {
    return res.status(400).json({
      success: false,
      message: `Unsupported mimeType ${mimeType}`,
    });
  }

  if (!BUCKET) {
    return res
      .status(500)
      .json({ success: false, message: "R2 bucket not configured" });
  }

  const fileUuid = crypto.randomUUID();
  const userId = req.userId;
  const resolvedMime = mimeType || mimeFromExt(ext);
  const fileKey = `tracks/${userId}/${fileUuid}.${ext}`;

  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: fileKey,
    ContentType: resolvedMime,
    ...(sizeBytes ? { ContentLength: sizeBytes } : {}),
  });

  // Presigned URL hợp lệ trong 15 phút.
  const expiresIn = 15 * 60;
  let uploadUrl;
  try {
    uploadUrl = await getSignedUrl(s3, command, { expiresIn });
  } catch (err) {
    console.error("[r2.getUploadUrl] sign failed:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to generate upload URL" });
  }

  return res.json({
    success: true,
    data: {
      uploadUrl,
      fileKey,
      expiresIn,
      // Client dùng URL này để PUT file lên R2.
      // Sau khi upload xong, gọi POST /api/tracks/finalize
    },
  });
};

/**
 * POST /api/tracks/finalize
 * Body: {
 *   fileKey: string,          // key đã upload lên R2
 *   title?: string,
 *   artist?: string,
 *   albumId?: string,
 *   sizeBytes?: number,
 * }
 * Đọc metadata từ file đã upload trên R2, tạo Track trong Mongo.
 */
exports.finalizeUpload = async (req, res) => {
  const { fileKey, title, artist, albumId, sizeBytes } = req.body;
  const userId = req.userId;

  if (!fileKey || typeof fileKey !== "string") {
    return res
      .status(400)
      .json({ success: false, message: "fileKey is required" });
  }

  // Validate: fileKey phải thuộc về user này.
  const expectedPrefix = `tracks/${userId}/`;
  if (!fileKey.startsWith(expectedPrefix)) {
    return res.status(403).json({ success: false, message: "Invalid fileKey" });
  }

  if (!BUCKET) {
    return res
      .status(500)
      .json({ success: false, message: "R2 bucket not configured" });
  }

  // 1. Đọc file từ R2 để parse metadata (ID3 tags + cover art).
  let buffer;
  let meta = {
    title: "",
    artist: "",
    album: "",
    durationSec: 0,
    picture: null,
  };
  let resolvedMime = "audio/mpeg";
  let resolvedSize = sizeBytes || 0;

  try {
    const obj = await s3.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: fileKey }),
    );
    resolvedMime = obj.ContentType || resolvedMime;
    resolvedSize = obj.ContentLength || resolvedSize;

    // Chuyển stream → buffer (file tối đa 500MB, vừa đủ RAM).
    buffer = await streamToBuffer(obj.Body);
  } catch (err) {
    console.error("[r2.finalize] R2 GetObject failed:", err);
    return res
      .status(404)
      .json({ success: false, message: "Uploaded file not found in storage" });
  }

  // 2. Parse metadata từ buffer.
  try {
    const parsed = await parseBuffer(buffer, {
      mimeType: resolvedMime,
      size: resolvedSize,
    });
    meta.title = parsed.common.title || "";
    meta.artist = parsed.common.artist || "";
    meta.album = parsed.common.album || "";
    meta.durationSec = parsed.format.duration
      ? Math.round(parsed.format.duration)
      : 0;
    const pictures = parsed.common.picture || [];
    if (pictures.length > 0) meta.picture = pictures[0];
  } catch (err) {
    console.warn("[r2.finalize] metadata parse failed:", err.message);
  }

  // 3. Upload cover art nếu có.
  let uploadedCoverKey = "";
  if (meta.picture && meta.picture.data) {
    const coverUuid = crypto.randomUUID();
    const coverKey = `covers/${userId}/${coverUuid}.jpg`;
    try {
      await s3.send(
        new PutObjectCommand({
          Bucket: BUCKET,
          Key: coverKey,
          Body: meta.picture.data,
          ContentType: meta.picture.format || "image/jpeg",
        }),
      );
      uploadedCoverKey = coverKey;
    } catch (err) {
      console.warn("[r2.finalize] cover upload failed:", err.message);
    }
  }

  // 4. Tạo Track trong Mongo.
  const track = await Track.create({
    title:
      title ||
      meta.title ||
      fileKey
        .split("/")
        .pop()
        .replace(/\.[^.]+$/, ""),
    artist: artist || meta.artist || "Unknown Artist",
    album: albumId || null,
    durationSec: meta.durationSec,
    fileKey,
    coverKey: uploadedCoverKey,
    mimeType: resolvedMime,
    sizeBytes: resolvedSize,
    owner: userId,
  });

  // 5. Auto-thêm track vào album nếu được chỉ định.
  if (albumId) {
    try {
      const album = await Album.findOne({ _id: albumId });
      if (album) {
        if (track.album && track.album.toString() !== album._id.toString()) {
          const oldAlbum = await Album.findById(track.album);
          if (oldAlbum) {
            oldAlbum.tracks = oldAlbum.tracks.filter(
              (t) => t.track.toString() !== track._id.toString(),
            );
            oldAlbum.tracks.forEach((t, i) => {
              t.position = i;
            });
            await oldAlbum.save();
          }
        }
        const exists = album.tracks.some(
          (t) => t.track.toString() === track._id.toString(),
        );
        if (!exists) {
          const nextPos =
            album.tracks.length > 0
              ? Math.max(...album.tracks.map((t) => t.position)) + 1
              : 0;
          album.tracks.push({ track: track._id, position: nextPos });
          await album.save();
        }
      }
    } catch (err) {
      console.warn("[r2.finalize] auto-add to album failed:", err.message);
    }
  }

  return res
    .status(201)
    .json({ success: true, data: attachCoverUrl(track.toObject()) });
};

/**
 * Helper: chuyển Node.js Readable stream thành Buffer.
 */
function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}
