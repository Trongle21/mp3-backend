const multer = require("multer");

const ALLOWED_MIME = new Set([
  "audio/mpeg", // .mp3
  "audio/mp3",
  "audio/flac", // .flac
  "audio/x-flac",
  "audio/wav", // .wav
  "audio/x-wav",
  "audio/wave",
  "audio/mp4", // .m4a
  "audio/x-m4a",
  "audio/aac",
]);

const ALLOWED_EXT = [".mp3", ".flac", ".wav", ".m4a"];

const MAX_SIZE = 200 * 1024 * 1024; // 200MB

const storage = multer.memoryStorage();

function fileFilter(_req, file, cb) {
  const lower = file.originalname.toLowerCase();
  const ext = lower.slice(lower.lastIndexOf("."));

  if (!ALLOWED_EXT.includes(ext)) {
    return cb(
      new Error(
        `Unsupported file extension ${ext}. Allowed: ${ALLOWED_EXT.join(", ")}`,
      ),
    );
  }
  if (!ALLOWED_MIME.has(file.mimetype)) {
    // Một số client/browser gửi mimetype lạ (vd octet-stream) — chấp nhận nếu ext hợp lệ.
    if (file.mimetype !== "application/octet-stream") {
      return cb(new Error(`Unsupported mimetype ${file.mimetype}`));
    }
  }
  cb(null, true);
}

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_SIZE,
    files: 1,
  },
});

// ---- Image upload (cover art / group thumbnail) ----------------------------

const ALLOWED_IMAGE_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const ALLOWED_IMAGE_EXT = [".jpg", ".jpeg", ".png", ".webp", ".gif"];
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB

function imageFileFilter(_req, file, cb) {
  const lower = file.originalname.toLowerCase();
  const ext = lower.slice(lower.lastIndexOf("."));

  if (!ALLOWED_IMAGE_EXT.includes(ext)) {
    const err = new Error(
      `Unsupported image extension ${ext}. Allowed: ${ALLOWED_IMAGE_EXT.join(", ")}`,
    );
    err.status = 400;
    return cb(err);
  }
  if (!ALLOWED_IMAGE_MIME.has(file.mimetype)) {
    if (file.mimetype !== "application/octet-stream") {
      const err = new Error(`Unsupported image mimetype ${file.mimetype}`);
      err.status = 400;
      return cb(err);
    }
  }
  cb(null, true);
}

const uploadImage = multer({
  storage,
  fileFilter: imageFileFilter,
  limits: {
    fileSize: MAX_IMAGE_SIZE,
    files: 1,
  },
});

module.exports = upload;
module.exports.uploadImage = uploadImage;
module.exports.MAX_SIZE = MAX_SIZE;
module.exports.MAX_IMAGE_SIZE = MAX_IMAGE_SIZE;
module.exports.ALLOWED_IMAGE_EXT = ALLOWED_IMAGE_EXT;
module.exports.ALLOWED_IMAGE_MIME = ALLOWED_IMAGE_MIME;
