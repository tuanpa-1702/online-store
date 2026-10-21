const path = require('path');
const fs = require('fs');
const multer = require('multer');
require('dotenv').config();

// Media root: prefer the big disk via MEDIA_DIR, fallback to local public/uploads
const MEDIA_DIR = process.env.MEDIA_DIR || path.join(__dirname, 'public', 'uploads');
fs.mkdirSync(MEDIA_DIR, { recursive: true });

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.svg', '.bmp']);

function safeFolder(name) {
  const s = (name == null ? '' : String(name)).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd')
    .replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return s;
}

function ensureFolder(folder) {
  const f = safeFolder(folder) || 'khac';
  const dir = path.join(MEDIA_DIR, f);
  fs.mkdirSync(dir, { recursive: true });
  return { folder: f, dir };
}

// List folders (subdirectories of MEDIA_DIR)
function listFolders() {
  try {
    return fs.readdirSync(MEDIA_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)
      .sort();
  } catch (e) { return []; }
}

// List image files inside a folder -> [{ name, url }]
function listFiles(folder) {
  const f = safeFolder(folder);
  if (!f) return [];
  const dir = path.join(MEDIA_DIR, f);
  try {
    return fs.readdirSync(dir)
      .filter(n => IMAGE_EXT.has(path.extname(n).toLowerCase()))
      .map(n => ({ name: n, url: '/media/' + f + '/' + n }))
      .sort((a, b) => b.name.localeCompare(a.name));
  } catch (e) { return []; }
}

// All media grouped by folder -> { folder: [urls] }
function allMedia() {
  const out = {};
  for (const f of listFolders()) out[f] = listFiles(f).map(x => x.url);
  return out;
}

// Multer uploader that writes into MEDIA_DIR/<folder>; folderResolver(req) -> folder name
function uploaderTo(folderResolver) {
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      try {
        const { dir } = ensureFolder(folderResolver(req));
        cb(null, dir);
      } catch (e) { cb(e); }
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.png';
      cb(null, Date.now() + '-' + Math.round(Math.random() * 1e6) + ext);
    },
  });
  return multer({
    storage,
    limits: { fileSize: 15 * 1024 * 1024 },
    fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
  });
}

// Resolve the public URL for an uploaded file object
function fileUrl(folder, filename) {
  return '/media/' + (safeFolder(folder) || 'khac') + '/' + filename;
}

// Safely delete a media file given its /media/<folder>/<file> url
function deleteByUrl(url) {
  if (!url || !url.startsWith('/media/')) return false;
  const rel = url.replace(/^\/media\//, '');
  const target = path.normalize(path.join(MEDIA_DIR, rel));
  if (!target.startsWith(MEDIA_DIR)) return false; // path traversal guard
  try { fs.unlinkSync(target); return true; } catch (e) { return false; }
}

module.exports = { MEDIA_DIR, safeFolder, ensureFolder, listFolders, listFiles, allMedia, uploaderTo, fileUrl, deleteByUrl };
