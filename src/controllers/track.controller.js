const crypto = require('crypto');
const { parseBuffer } = require('music-metadata');
const { PutObjectCommand, DeleteObjectCommand, HeadObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');

const { client: s3, BUCKET } = require('../config/r2');
const Track = require('../models/Track');
const Group = require('../models/Group');
const { attachCoverUrl, attachCoverUrls } = require('../utils/mediaUrl');

function extFromFilename(name) {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : 'mp3';
}

function mimeFromExt(ext) {
  const map = {
    mp3: 'audio/mpeg',
    flac: 'audio/flac',
    wav: 'audio/wav',
    m4a: 'audio/mp4',
    aac: 'audio/aac',
  };
  return map[ext] || 'audio/mpeg';
}

function mimeFromImageExt(ext) {
  const map = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
  };
  return map[ext] || 'image/jpeg';
}

/**
 * POST /api/tracks/upload
 * multipart/form-data: file=...
 * body: title?, artist?, album?  (optional override)
 */
exports.upload = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file uploaded' });
  }
  if (!BUCKET) {
    return res.status(500).json({ success: false, message: 'R2 bucket not configured' });
  }

  const ext = extFromFilename(req.file.originalname);
  const mimeType = mimeFromExt(ext);
  const fileUuid = crypto.randomUUID();
  const coverUuid = crypto.randomUUID();
  const userId = req.userId;

  const fileKey = `tracks/${userId}/${fileUuid}.${ext}`;
  const coverKey = `covers/${userId}/${coverUuid}.jpg`;

  // 1. Đọc metadata từ buffer (ID3 tags + cover art nếu có).
  let meta = { title: '', artist: '', album: '', durationSec: 0, picture: null };
  try {
    const parsed = await parseBuffer(req.file.buffer, { mimeType, size: req.file.size });
    meta.title = parsed.common.title || '';
    meta.artist = parsed.common.artist || '';
    meta.album = parsed.common.album || '';
    meta.durationSec = parsed.format.duration ? Math.round(parsed.format.duration) : 0;
    const pictures = parsed.common.picture || [];
    if (pictures.length > 0) meta.picture = pictures[0];
  } catch (err) {
    console.warn('[track.upload] metadata parse failed:', err.message);
  }

  // 2. Upload file gốc lên R2.
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: fileKey,
      Body: req.file.buffer,
      ContentType: mimeType,
      ContentLength: req.file.size,
    })
  );

  // 3. Upload cover nếu có.
  let uploadedCoverKey = '';
  if (meta.picture && meta.picture.data) {
    try {
      await s3.send(
        new PutObjectCommand({
          Bucket: BUCKET,
          Key: coverKey,
          Body: meta.picture.data,
          ContentType: meta.picture.format || 'image/jpeg',
        })
      );
      uploadedCoverKey = coverKey;
    } catch (err) {
      console.warn('[track.upload] cover upload failed:', err.message);
    }
  }

  // 4. Lưu metadata vào Mongo. Ưu tiên giá trị user gửi lên nếu có.
  const track = await Track.create({
    title: req.body.title || meta.title || req.file.originalname.replace(/\.[^.]+$/, ''),
    artist: req.body.artist || meta.artist || 'Unknown Artist',
    album: req.body.album || meta.album || '',
    durationSec: meta.durationSec,
    fileKey,
    coverKey: uploadedCoverKey,
    mimeType,
    sizeBytes: req.file.size,
    owner: userId,
  });

  return res.status(201).json({ success: true, data: attachCoverUrl(track.toObject()) });
};

/**
 * GET /api/tracks?search=&sort=&page=&limit=
 */
exports.list = async (req, res) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
  const skip = (page - 1) * limit;

  const filter = { owner: req.userId };

  if (req.query.search) {
    const re = new RegExp(req.query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ title: re }, { artist: re }];
  }

  const allowedSort = { createdAt: -1, title: 1, artist: 1 };
  const sortKey = req.query.sort in allowedSort ? req.query.sort : 'createdAt';
  const sort = { [sortKey]: allowedSort[sortKey] };

  const [items, total] = await Promise.all([
    Track.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    Track.countDocuments(filter),
  ]);

  attachCoverUrls(items);

  return res.json({
    success: true,
    data: items,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
};

exports.getOne = async (req, res) => {
  const track = await Track.findOne({ _id: req.params.id, owner: req.userId }).lean();
  if (!track) return res.status(404).json({ success: false, message: 'Track not found' });
  return res.json({ success: true, data: attachCoverUrl(track) });
};

/**
 * PATCH /api/tracks/:id  body: { title?, artist?, album? }
 */
exports.update = async (req, res) => {
  const allowed = ['title', 'artist', 'album'];
  const update = {};
  for (const k of allowed) {
    if (req.body[k] !== undefined) update[k] = req.body[k];
  }
  if (Object.keys(update).length === 0) {
    return res.status(400).json({ success: false, message: 'No updatable fields supplied' });
  }
  const track = await Track.findOneAndUpdate(
    { _id: req.params.id, owner: req.userId },
    update,
    { new: true }
  ).lean();
  if (!track) return res.status(404).json({ success: false, message: 'Track not found' });
  return res.json({ success: true, data: attachCoverUrl(track) });
};

/**
 * DELETE /api/tracks/:id
 * Xoá document, đồng thời xoá file + cover trong R2 và gỡ khỏi các group liên quan.
 */
exports.remove = async (req, res) => {
  const track = await Track.findOne({ _id: req.params.id, owner: req.userId });
  if (!track) return res.status(404).json({ success: false, message: 'Track not found' });

  // Gỡ khỏi các group của cùng user (không cần await — best effort).
  await Group.updateMany(
    { owner: req.userId, 'tracks.track': track._id },
    { $pull: { tracks: { track: track._id } } }
  );

  // Xoá R2 objects.
  const keys = [track.fileKey, track.coverKey].filter(Boolean);
  await Promise.all(
    keys.map((Key) =>
      s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key })).catch((err) =>
        console.warn(`[track.remove] R2 delete failed for ${Key}:`, err.message)
      )
    )
  );

  await track.deleteOne();
  return res.json({ success: true, data: { id: track._id } });
};

/**
 * POST /api/tracks/:id/cover
 * multipart/form-data: file=...
 * Upload (hoặc thay thế) cover art cho track.
 */
exports.uploadCover = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file uploaded' });
  }
  if (!BUCKET) {
    return res.status(500).json({ success: false, message: 'R2 bucket not configured' });
  }

  const track = await Track.findOne({ _id: req.params.id, owner: req.userId });
  if (!track) return res.status(404).json({ success: false, message: 'Track not found' });

  const ext = extFromFilename(req.file.originalname) || 'jpg';
  const mime = req.file.mimetype && req.file.mimetype !== 'application/octet-stream'
    ? req.file.mimetype
    : mimeFromImageExt(ext);
  const coverUuid = crypto.randomUUID();
  const coverKey = `covers/${req.userId}/${coverUuid}.${ext}`;

  // Xoá cover cũ nếu có (best effort).
  if (track.coverKey) {
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: track.coverKey }));
    } catch (err) {
      console.warn('[track.uploadCover] delete old cover failed:', err.message);
    }
  }

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: coverKey,
      Body: req.file.buffer,
      ContentType: mime,
      ContentLength: req.file.size,
    })
  );

  track.coverKey = coverKey;
  await track.save();

  return res.json({ success: true, data: attachCoverUrl(track.toObject()) });
};

/**
 * GET /api/tracks/:id/cover
 * Trả binary ảnh cover. Hỗ trợ Range request để browser cache/zoom.
 */
exports.getCover = async (req, res) => {
  const track = await Track.findOne({ _id: req.params.id, owner: req.userId }).lean();
  if (!track) return res.status(404).json({ success: false, message: 'Track not found' });
  if (!track.coverKey) return res.status(404).json({ success: false, message: 'No cover art' });

  let head;
  try {
    head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: track.coverKey }));
  } catch (err) {
    if (err.$metadata && err.$metadata.httpStatusCode === 404) {
      return res.status(404).json({ success: false, message: 'Cover not found in storage' });
    }
    console.error('[track.getCover] HeadObject failed:', err);
    return res.status(500).json({ success: false, message: 'Failed to read cover metadata' });
  }

  const fileSize = head.ContentLength;
  const mime = head.ContentType || 'image/jpeg';

  res.setHeader('Content-Type', mime);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'private, max-age=3600');

  const range = req.headers.range;
  if (range) {
    const match = range.match(/^bytes=(\d*)-(\d*)$/);
    if (!match) {
      res.setHeader('Content-Length', fileSize);
      return res.status(416).json({ success: false, message: 'Invalid Range header' });
    }
    let start = match[1] === '' ? null : parseInt(match[1], 10);
    let end = match[2] === '' ? null : parseInt(match[2], 10);

    if (start === null && end === null) {
      return res.status(416).json({ success: false, message: 'Invalid Range' });
    }
    if (start === null) {
      start = Math.max(0, fileSize - end);
      end = fileSize - 1;
    } else if (end === null) {
      end = fileSize - 1;
    } else {
      end = Math.min(end, fileSize - 1);
    }

    if (start >= fileSize || end < start) {
      res.setHeader('Content-Range', `bytes */${fileSize}`);
      return res.status(416).end();
    }

    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
    res.setHeader('Content-Length', end - start + 1);

    try {
      const obj = await s3.send(
        new GetObjectCommand({ Bucket: BUCKET, Key: track.coverKey, Range: `bytes=${start}-${end}` })
      );
      obj.Body.on('error', (err) => {
        console.error('[track.getCover] stream error:', err);
        if (!res.headersSent) res.status(500).end();
        else res.destroy(err);
      });
      obj.Body.pipe(res);
    } catch (err) {
      console.error('[track.getCover] GetObject failed:', err);
      if (!res.headersSent) res.status(500).json({ success: false, message: 'Failed to fetch cover' });
    }
    return;
  }

  res.setHeader('Content-Length', fileSize);
  try {
    const obj = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: track.coverKey }));
    obj.Body.on('error', (err) => {
      console.error('[track.getCover] stream error:', err);
      if (!res.headersSent) res.status(500).end();
      else res.destroy(err);
    });
    obj.Body.pipe(res);
  } catch (err) {
    console.error('[track.getCover] GetObject failed:', err);
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Failed to fetch cover' });
  }
};

/**
 * DELETE /api/tracks/:id/cover
 */
exports.removeCover = async (req, res) => {
  const track = await Track.findOne({ _id: req.params.id, owner: req.userId });
  if (!track) return res.status(404).json({ success: false, message: 'Track not found' });
  if (!track.coverKey) {
    return res.json({ success: true, data: track, message: 'No cover to remove' });
  }

  const oldKey = track.coverKey;
  track.coverKey = '';
  await track.save();

  try {
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: oldKey }));
  } catch (err) {
    console.warn('[track.removeCover] R2 delete failed:', err.message);
  }

  return res.json({ success: true, data: track });
};

/**
 * GET /api/tracks/:id/stream
 * H� trợ HTTP Range request để tua nhạc mượt.
 *
 * Flow:
 *  1. Tìm track trong Mongo (filter theo owner).
 *  2. HeadObject để biết ContentLength.
 *  3. Đọc Range header, parse thành [start, end].
 *  4. Nếu có Range → GetObject với Range, status 206, set Content-Range.
 *  5. Pipe body trực tiếp về res — KHÔNG buffer.
 */
exports.stream = async (req, res) => {
  const track = await Track.findOne({ _id: req.params.id, owner: req.userId }).lean();
  if (!track) return res.status(404).json({ success: false, message: 'Track not found' });

  // 1. Lấy ContentLength qua HeadObject.
  let head;
  try {
    head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: track.fileKey }));
  } catch (err) {
    if (err.$metadata && err.$metadata.httpStatusCode === 404) {
      return res.status(404).json({ success: false, message: 'Audio file not found in storage' });
    }
    console.error('[track.stream] HeadObject failed:', err);
    return res.status(500).json({ success: false, message: 'Failed to read file metadata' });
  }

  const fileSize = head.ContentLength;
  const mime = track.mimeType || head.ContentType || 'audio/mpeg';

  // Headers chung — đặt trước khi pipe.
  res.setHeader('Content-Type', mime);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'private, max-age=3600');

  const range = req.headers.range;
  if (range) {
    // 2. Parse "bytes=start-end"
    const match = range.match(/^bytes=(\d*)-(\d*)$/);
    if (!match) {
      res.setHeader('Content-Length', fileSize);
      return res.status(416).json({ success: false, message: 'Invalid Range header' });
    }
    let start = match[1] === '' ? null : parseInt(match[1], 10);
    let end = match[2] === '' ? null : parseInt(match[2], 10);

    if (start === null && end === null) {
      return res.status(416).json({ success: false, message: 'Invalid Range' });
    }

    // Hỗ tr� suffix range: bytes=-N → N bytes cuối
    if (start === null) {
      start = Math.max(0, fileSize - end);
      end = fileSize - 1;
    } else if (end === null) {
      end = fileSize - 1;
    } else {
      end = Math.min(end, fileSize - 1);
    }

    if (start >= fileSize || end < start) {
      res.setHeader('Content-Range', `bytes */${fileSize}`);
      return res.status(416).end();
    }

    const chunkSize = end - start + 1;

    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
    res.setHeader('Content-Length', chunkSize);

    // 3. Lấy phần range từ R2 và pipe về client.
    try {
      const obj = await s3.send(
        new GetObjectCommand({
          Bucket: BUCKET,
          Key: track.fileKey,
          Range: `bytes=${start}-${end}`,
        })
      );
      // obj.Body là stream (Node Readable).
      obj.Body.on('error', (err) => {
        console.error('[track.stream] R2 stream error:', err);
        if (!res.headersSent) res.status(500).end();
        else res.destroy(err);
      });
      obj.Body.pipe(res);
    } catch (err) {
      console.error('[track.stream] GetObject failed:', err);
      if (!res.headersSent) res.status(500).json({ success: false, message: 'Failed to stream file' });
    }
    return;
  }

  // Không có Range header — trả toàn bộ file (status 200).
  res.setHeader('Content-Length', fileSize);
  try {
    const obj = await s3.send(
      new GetObjectCommand({
        Bucket: BUCKET,
        Key: track.fileKey,
      })
    );
    obj.Body.on('error', (err) => {
      console.error('[track.stream] R2 stream error:', err);
      if (!res.headersSent) res.status(500).end();
      else res.destroy(err);
    });
    obj.Body.pipe(res);
  } catch (err) {
    console.error('[track.stream] GetObject failed:', err);
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Failed to stream file' });
  }
};
