const mongoose = require('mongoose');
const crypto = require('crypto');
const { PutObjectCommand, DeleteObjectCommand, HeadObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { client: s3, BUCKET } = require('../config/r2');
const Group = require('../models/Group');
const Track = require('../models/Track');

function ensureObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

function extFromFilename(name) {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : 'jpg';
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

exports.create = async (req, res) => {
  const group = await Group.create({ name: req.body.name, owner: req.userId, tracks: [] });
  return res.status(201).json({ success: true, data: group });
};

/**
 * GET /api/groups
 * Trả danh sách group + số lượng track mỗi group (không populate để nhẹ response).
 */
exports.list = async (req, res) => {
  const groups = await Group.aggregate([
    { $match: { owner: new mongoose.Types.ObjectId(req.userId) } },
    { $project: { name: 1, createdAt: 1, updatedAt: 1, trackCount: { $size: '$tracks' } } },
    { $sort: { updatedAt: -1 } },
  ]);
  return res.json({ success: true, data: groups });
};

/**
 * GET /api/groups/:id — chi tiết kèm populate track.
 */
exports.getOne = async (req, res) => {
  if (!ensureObjectId(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Invalid id' });
  }
  const group = await Group.findOne({ _id: req.params.id, owner: req.userId }).populate({
    path: 'tracks.track',
    select: 'title artist album durationSec fileKey coverKey mimeType',
  });
  if (!group) return res.status(404).json({ success: false, message: 'Group not found' });

  // Sắp xếp theo position tăng dần.
  group.tracks.sort((a, b) => a.position - b.position);
  return res.json({ success: true, data: group });
};

exports.rename = async (req, res) => {
  if (!req.body.name || typeof req.body.name !== 'string') {
    return res.status(400).json({ success: false, message: 'name is required' });
  }
  const group = await Group.findOneAndUpdate(
    { _id: req.params.id, owner: req.userId },
    { name: req.body.name },
    { new: true }
  );
  if (!group) return res.status(404).json({ success: false, message: 'Group not found' });
  return res.json({ success: true, data: group });
};

exports.remove = async (req, res) => {
  const group = await Group.findOneAndDelete({ _id: req.params.id, owner: req.userId });
  if (!group) return res.status(404).json({ success: false, message: 'Group not found' });
  return res.json({ success: true, data: { id: group._id } });
};

/**
 * POST /api/groups/:id/tracks  body: { trackId }
 */
exports.addTrack = async (req, res) => {
  const { trackId } = req.body;
  if (!trackId || !ensureObjectId(trackId)) {
    return res.status(400).json({ success: false, message: 'Invalid trackId' });
  }

  // Verify track thuộc user.
  const track = await Track.findOne({ _id: trackId, owner: req.userId }).select('_id').lean();
  if (!track) return res.status(404).json({ success: false, message: 'Track not found' });

  const group = await Group.findOne({ _id: req.params.id, owner: req.userId });
  if (!group) return res.status(404).json({ success: false, message: 'Group not found' });

  // Tránh trùng — không thêm nếu track đã có.
  const exists = group.tracks.some((t) => t.track.toString() === trackId);
  if (exists) {
    return res.json({ success: true, data: group, message: 'Track already in group' });
  }

  const nextPosition = group.tracks.length > 0
    ? Math.max(...group.tracks.map((t) => t.position)) + 1
    : 0;

  group.tracks.push({ track: trackId, position: nextPosition });
  await group.save();

  return res.json({ success: true, data: group });
};

/**
 * DELETE /api/groups/:id/tracks/:trackId
 */
exports.removeTrack = async (req, res) => {
  const group = await Group.findOne({ _id: req.params.id, owner: req.userId });
  if (!group) return res.status(404).json({ success: false, message: 'Group not found' });

  const before = group.tracks.length;
  group.tracks = group.tracks.filter((t) => t.track.toString() !== req.params.trackId);
  if (group.tracks.length === before) {
    return res.status(404).json({ success: false, message: 'Track not in group' });
  }

  // Re-position để không có gap.
  group.tracks.forEach((t, i) => { t.position = i; });
  await group.save();

  return res.json({ success: true, data: group });
};

/**
 * POST /api/groups/:id/thumbnail
 * multipart/form-data: file=...
 */
exports.uploadThumbnail = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file uploaded' });
  }
  if (!BUCKET) {
    return res.status(500).json({ success: false, message: 'R2 bucket not configured' });
  }

  const group = await Group.findOne({ _id: req.params.id, owner: req.userId });
  if (!group) return res.status(404).json({ success: false, message: 'Group not found' });

  const ext = extFromFilename(req.file.originalname) || 'jpg';
  const mime = req.file.mimetype && req.file.mimetype !== 'application/octet-stream'
    ? req.file.mimetype
    : mimeFromImageExt(ext);
  const uuid = crypto.randomUUID();
  const thumbnailKey = `group-thumbnails/${req.userId}/${uuid}.${ext}`;

  if (group.thumbnailKey) {
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: group.thumbnailKey }));
    } catch (err) {
      console.warn('[group.uploadThumbnail] delete old thumbnail failed:', err.message);
    }
  }

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: thumbnailKey,
      Body: req.file.buffer,
      ContentType: mime,
      ContentLength: req.file.size,
    })
  );

  group.thumbnailKey = thumbnailKey;
  await group.save();

  return res.json({ success: true, data: group });
};

/**
 * GET /api/groups/:id/thumbnail
 */
exports.getThumbnail = async (req, res) => {
  const group = await Group.findOne({ _id: req.params.id, owner: req.userId }).lean();
  if (!group) return res.status(404).json({ success: false, message: 'Group not found' });
  if (!group.thumbnailKey) return res.status(404).json({ success: false, message: 'No thumbnail' });

  let head;
  try {
    head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: group.thumbnailKey }));
  } catch (err) {
    if (err.$metadata && err.$metadata.httpStatusCode === 404) {
      return res.status(404).json({ success: false, message: 'Thumbnail not found in storage' });
    }
    console.error('[group.getThumbnail] HeadObject failed:', err);
    return res.status(500).json({ success: false, message: 'Failed to read thumbnail metadata' });
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
        new GetObjectCommand({ Bucket: BUCKET, Key: group.thumbnailKey, Range: `bytes=${start}-${end}` })
      );
      obj.Body.on('error', (err) => {
        console.error('[group.getThumbnail] stream error:', err);
        if (!res.headersSent) res.status(500).end();
        else res.destroy(err);
      });
      obj.Body.pipe(res);
    } catch (err) {
      console.error('[group.getThumbnail] GetObject failed:', err);
      if (!res.headersSent) res.status(500).json({ success: false, message: 'Failed to fetch thumbnail' });
    }
    return;
  }

  res.setHeader('Content-Length', fileSize);
  try {
    const obj = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: group.thumbnailKey }));
    obj.Body.on('error', (err) => {
      console.error('[group.getThumbnail] stream error:', err);
      if (!res.headersSent) res.status(500).end();
      else res.destroy(err);
    });
    obj.Body.pipe(res);
  } catch (err) {
    console.error('[group.getThumbnail] GetObject failed:', err);
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Failed to fetch thumbnail' });
  }
};

/**
 * DELETE /api/groups/:id/thumbnail
 */
exports.removeThumbnail = async (req, res) => {
  const group = await Group.findOne({ _id: req.params.id, owner: req.userId });
  if (!group) return res.status(404).json({ success: false, message: 'Group not found' });
  if (!group.thumbnailKey) {
    return res.json({ success: true, data: group, message: 'No thumbnail to remove' });
  }

  const oldKey = group.thumbnailKey;
  group.thumbnailKey = '';
  await group.save();

  try {
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: oldKey }));
  } catch (err) {
    console.warn('[group.removeThumbnail] R2 delete failed:', err.message);
  }

  return res.json({ success: true, data: group });
};

/**
 * PATCH /api/groups/:id/reorder  body: { trackIds: [...] }
 */
exports.reorder = async (req, res) => {
  const { trackIds } = req.body;
  if (!Array.isArray(trackIds)) {
    return res.status(400).json({ success: false, message: 'trackIds must be an array' });
  }

  const group = await Group.findOne({ _id: req.params.id, owner: req.userId });
  if (!group) return res.status(404).json({ success: false, message: 'Group not found' });

  if (trackIds.length !== group.tracks.length) {
    return res.status(400).json({
      success: false,
      message: `trackIds length (${trackIds.length}) must match group tracks count (${group.tracks.length})`,
    });
  }

  // Kiểm tra trackIds đầy đủ và thuộc user.
  const existingIds = new Set(group.tracks.map((t) => t.track.toString()));
  for (const tid of trackIds) {
    if (!existingIds.has(String(tid))) {
      return res.status(400).json({ success: false, message: `trackId ${tid} not in group` });
    }
  }

  // Map theo id để gán position mới.
  const posById = new Map(trackIds.map((tid, idx) => [String(tid), idx]));
  group.tracks.sort((a, b) => posById.get(a.track.toString()) - posById.get(b.track.toString()));
  group.tracks.forEach((t, idx) => { t.position = idx; });

  await group.save();
  return res.json({ success: true, data: group });
};
