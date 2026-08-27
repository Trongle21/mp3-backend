const mongoose = require('mongoose');
const crypto = require('crypto');
const { PutObjectCommand, DeleteObjectCommand, HeadObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { client: s3, BUCKET } = require('../config/r2');
const Album = require('../models/Album');
const Track = require('../models/Track');
const {
  attachThumbnailUrl,
  attachThumbnailUrls,
} = require('../utils/mediaUrl');

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

// ─── CREATE ─────────────────────────────────────────────────────────────────

/**
 * POST /api/albums
 * Body: { title, artist?, description?, year?, genre? }
 */
exports.create = async (req, res) => {
  const { title, artist, description, year, genre } = req.body;
  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ success: false, message: 'title is required' });
  }

  const album = await Album.create({
    title: title.trim(),
    artist: artist ? String(artist).trim() : '',
    description: description ? String(description).trim() : '',
    year: year ? parseInt(year, 10) : null,
    genre: genre ? String(genre).trim() : '',
    owner: req.userId,
    tracks: [],
  });

  return res.status(201).json({ success: true, data: attachThumbnailUrl(album.toObject()) });
};

// ─── LIST ───────────────────────────────────────────────────────────────────

/**
 * GET /api/albums?search=&page=&limit=
 */
exports.list = async (req, res) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
  const skip = (page - 1) * limit;

  const filter = {};

  if (req.query.search) {
    const re = new RegExp(req.query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [
      { title: re },
      { artist: re },
      { description: re },
    ];
  }

  if (req.query.artist) {
    const re = new RegExp(req.query.artist.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.artist = re;
  }

  if (req.query.genre) {
    filter.genre = new RegExp(`^${req.query.genre.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
  }

  const [albums, total] = await Promise.all([
    Album.aggregate([
      { $match: filter },
      {
        $project: {
          title: 1,
          artist: 1,
          description: 1,
          year: 1,
          genre: 1,
          thumbnailKey: 1,
          owner: 1,
          createdAt: 1,
          updatedAt: 1,
          trackCount: { $size: '$tracks' },
          totalDuration: {
            $reduce: {
              input: '$tracks',
              initialValue: 0,
              in: {
                $add: [
                  '$$value',
                  { $ifNull: [{ $toDouble: '$$this.durationSec' }, 0] },
                ],
              },
            },
          },
        },
      },
      { $sort: { updatedAt: -1 } },
      { $skip: skip },
      { $limit: limit },
    ]),
    Album.countDocuments(filter),
  ]);

  attachThumbnailUrls(albums);

  return res.json({
    success: true,
    data: albums,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
};

// ─── GET ONE ───────────────────────────────────────────────────────────────

/**
 * GET /api/albums/:id
 */
exports.getOne = async (req, res) => {
  if (!ensureObjectId(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Invalid id' });
  }

  const album = await Album.findOne({ _id: req.params.id }).populate({
    path: 'tracks.track',
    select: 'title artist album durationSec fileKey coverKey mimeType',
  });

  if (!album) {
    return res.status(404).json({ success: false, message: 'Album not found' });
  }

  album.tracks.sort((a, b) => a.position - b.position);

  const out = attachThumbnailUrl(album.toObject());
  if (Array.isArray(out.tracks)) {
    for (const slot of out.tracks) {
      if (slot.track && typeof slot.track === 'object') {
        slot.track.durationSec = slot.track.durationSec || 0;
      }
    }
  }

  return res.json({ success: true, data: out });
};

// ─── UPDATE ────────────────────────────────────────────────────────────────

/**
 * PATCH /api/albums/:id
 * Body: { title?, artist?, description?, year?, genre? }
 */
exports.update = async (req, res) => {
  if (!ensureObjectId(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Invalid id' });
  }

  const allowed = ['title', 'artist', 'description', 'year', 'genre'];
  const update = {};

  for (const k of allowed) {
    if (req.body[k] !== undefined) {
      if (k === 'year') {
        const n = parseInt(req.body.year, 10);
        update[k] = isNaN(n) ? null : n;
      } else {
        update[k] = String(req.body[k]).trim();
      }
    }
  }

  if (Object.keys(update).length === 0) {
    return res.status(400).json({ success: false, message: 'No updatable fields supplied' });
  }

  const album = await Album.findOneAndUpdate({ _id: req.params.id }, update, { new: true }).lean();
  if (!album) {
    return res.status(404).json({ success: false, message: 'Album not found' });
  }

  return res.json({ success: true, data: attachThumbnailUrl(album) });
};

// ─── DELETE ────────────────────────────────────────────────────────────────

/**
 * DELETE /api/albums/:id
 */
exports.remove = async (req, res) => {
  if (!ensureObjectId(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Invalid id' });
  }

  const album = await Album.findOneAndDelete({ _id: req.params.id });
  if (!album) {
    return res.status(404).json({ success: false, message: 'Album not found' });
  }

  // Xoá thumbnail trên R2 nếu có.
  if (album.thumbnailKey) {
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: album.thumbnailKey }));
    } catch (err) {
      console.warn('[album.remove] R2 delete thumbnail failed:', err.message);
    }
  }

  return res.json({ success: true, data: { id: album._id } });
};

// ─── ADD TRACK ─────────────────────────────────────────────────────────────

/**
 * POST /api/albums/:id/tracks
 * Body: { trackId }
 */
exports.addTrack = async (req, res) => {
  const { trackId } = req.body;

  if (!trackId || !ensureObjectId(trackId)) {
    return res.status(400).json({ success: false, message: 'Invalid trackId' });
  }

  const album = await Album.findOne({ _id: req.params.id });
  if (!album) {
    return res.status(404).json({ success: false, message: 'Album not found' });
  }

  const track = await Track.findOne({ _id: trackId }).select('_id').lean();
  if (!track) {
    return res.status(404).json({ success: false, message: 'Track not found' });
  }

  const exists = album.tracks.some((t) => t.track.toString() === trackId);
  if (exists) {
    return res.json({ success: true, data: album, message: 'Track already in album' });
  }

  const nextPosition =
    album.tracks.length > 0
      ? Math.max(...album.tracks.map((t) => t.position)) + 1
      : 0;

  album.tracks.push({ track: trackId, position: nextPosition });
  await album.save();

  const out = attachThumbnailUrl(album.toObject());
  return res.json({ success: true, data: out });
};

// ─── REMOVE TRACK ──────────────────────────────────────────────────────────

/**
 * DELETE /api/albums/:id/tracks/:trackId
 */
exports.removeTrack = async (req, res) => {
  const album = await Album.findOne({ _id: req.params.id });
  if (!album) {
    return res.status(404).json({ success: false, message: 'Album not found' });
  }

  const before = album.tracks.length;
  album.tracks = album.tracks.filter((t) => t.track.toString() !== req.params.trackId);

  if (album.tracks.length === before) {
    return res.status(404).json({ success: false, message: 'Track not in album' });
  }

  album.tracks.forEach((t, i) => { t.position = i; });
  await album.save();

  return res.json({ success: true, data: attachThumbnailUrl(album.toObject()) });
};

// ─── REORDER ────────────────────────────────────────────────────────────────

/**
 * PATCH /api/albums/:id/reorder
 * Body: { trackIds: [...] }
 */
exports.reorder = async (req, res) => {
  const { trackIds } = req.body;

  if (!Array.isArray(trackIds)) {
    return res.status(400).json({ success: false, message: 'trackIds must be an array' });
  }

  const album = await Album.findOne({ _id: req.params.id });
  if (!album) {
    return res.status(404).json({ success: false, message: 'Album not found' });
  }

  if (trackIds.length !== album.tracks.length) {
    return res.status(400).json({
      success: false,
      message: `trackIds length (${trackIds.length}) must match album tracks count (${album.tracks.length})`,
    });
  }

  const existingIds = new Set(album.tracks.map((t) => t.track.toString()));
  for (const tid of trackIds) {
    if (!existingIds.has(String(tid))) {
      return res.status(400).json({ success: false, message: `trackId ${tid} not in album` });
    }
  }

  const posById = new Map(trackIds.map((tid, idx) => [String(tid), idx]));
  album.tracks.sort((a, b) => posById.get(a.track.toString()) - posById.get(b.track.toString()));
  album.tracks.forEach((t, idx) => { t.position = idx; });

  await album.save();
  return res.json({ success: true, data: attachThumbnailUrl(album.toObject()) });
};

// ─── THUMBNAIL ─────────────────────────────────────────────────────────────

/**
 * POST /api/albums/:id/thumbnail
 * multipart/form-data: file=...
 */
exports.uploadThumbnail = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file uploaded' });
  }
  if (!BUCKET) {
    return res.status(500).json({ success: false, message: 'R2 bucket not configured' });
  }

  const album = await Album.findOne({ _id: req.params.id });
  if (!album) {
    return res.status(404).json({ success: false, message: 'Album not found' });
  }

  const ext = extFromFilename(req.file.originalname) || 'jpg';
  const mime =
    req.file.mimetype && req.file.mimetype !== 'application/octet-stream'
      ? req.file.mimetype
      : mimeFromImageExt(ext);
  const uuid = crypto.randomUUID();
  const thumbnailKey = `album-thumbnails/${req.userId}/${uuid}.${ext}`;

  if (album.thumbnailKey) {
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: album.thumbnailKey }));
    } catch (err) {
      console.warn('[album.uploadThumbnail] delete old thumbnail failed:', err.message);
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

  album.thumbnailKey = thumbnailKey;
  await album.save();

  return res.json({ success: true, data: attachThumbnailUrl(album.toObject()) });
};

/**
 * GET /api/albums/:id/thumbnail
 */
exports.getThumbnail = async (req, res) => {
  const album = await Album.findOne({ _id: req.params.id }).lean();
  if (!album) {
    return res.status(404).json({ success: false, message: 'Album not found' });
  }
  if (!album.thumbnailKey) {
    return res.status(404).json({ success: false, message: 'No thumbnail' });
  }

  let head;
  try {
    head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: album.thumbnailKey }));
  } catch (err) {
    if (err.$metadata && err.$metadata.httpStatusCode === 404) {
      return res.status(404).json({ success: false, message: 'Thumbnail not found in storage' });
    }
    console.error('[album.getThumbnail] HeadObject failed:', err);
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
        new GetObjectCommand({ Bucket: BUCKET, Key: album.thumbnailKey, Range: `bytes=${start}-${end}` })
      );
      obj.Body.on('error', (err) => {
        console.error('[album.getThumbnail] stream error:', err);
        if (!res.headersSent) res.status(500).end();
        else res.destroy(err);
      });
      obj.Body.pipe(res);
    } catch (err) {
      console.error('[album.getThumbnail] GetObject failed:', err);
      if (!res.headersSent) res.status(500).json({ success: false, message: 'Failed to fetch thumbnail' });
    }
    return;
  }

  res.setHeader('Content-Length', fileSize);
  try {
    const obj = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: album.thumbnailKey }));
    obj.Body.on('error', (err) => {
      console.error('[album.getThumbnail] stream error:', err);
      if (!res.headersSent) res.status(500).end();
      else res.destroy(err);
    });
    obj.Body.pipe(res);
  } catch (err) {
    console.error('[album.getThumbnail] GetObject failed:', err);
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Failed to fetch thumbnail' });
  }
};

/**
 * DELETE /api/albums/:id/thumbnail
 */
exports.removeThumbnail = async (req, res) => {
  const album = await Album.findOne({ _id: req.params.id });
  if (!album) {
    return res.status(404).json({ success: false, message: 'Album not found' });
  }
  if (!album.thumbnailKey) {
    return res.json({ success: true, data: album, message: 'No thumbnail to remove' });
  }

  const oldKey = album.thumbnailKey;
  album.thumbnailKey = '';
  await album.save();

  try {
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: oldKey }));
  } catch (err) {
    console.warn('[album.removeThumbnail] R2 delete failed:', err.message);
  }

  return res.json({ success: true, data: attachThumbnailUrl(album.toObject()) });
};
