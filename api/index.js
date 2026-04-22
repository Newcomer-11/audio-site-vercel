const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();

// ─── Config ────────────────────────────────────────────────────────────────
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const SESSION_SECRET = process.env.SESSION_SECRET || 'audio-site-secret-key-change-me';

// ─── Cloudinary (tuỳ chọn) ─────────────────────────────────────────────────
// Nếu muốn upload file, cần cài: npm install cloudinary
// và set env: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
let cloudinary = null;
if (process.env.CLOUDINARY_CLOUD_NAME) {
  try {
    const { v2: cld } = require('cloudinary');
    cld.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key:    process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
    cloudinary = cld;
  } catch (e) {
    console.warn('Cloudinary not available:', e.message);
  }
}

// ─── Simple JWT-like cookie auth (không dùng express-session) ───────────────
function signToken(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verifyToken(token) {
  if (!token) return null;
  try {
    const [data, sig] = token.split('.');
    const expected = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
    if (sig !== expected) return null;
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function parseCookies(req) {
  const list = {};
  const header = req.headers.cookie || '';
  header.split(';').forEach(pair => {
    const [k, ...v] = pair.trim().split('=');
    if (k) list[k.trim()] = decodeURIComponent(v.join('='));
  });
  return list;
}

// ─── Middleware ─────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files từ public/
app.use(express.static(path.join(__dirname, '..', 'public')));

// ─── Multer — dùng memory storage (không ghi disk) ─────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const allowed = /audio\/(mpeg|mp4|ogg|wav|webm|flac|aac|x-m4a)|video\/mp4/;
    if (allowed.test(file.mimetype)) cb(null, true);
    else cb(new Error('Chỉ chấp nhận file audio!'));
  },
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB
});

// ─── Auth middleware ─────────────────────────────────────────────────────────
const requireAuth = (req, res, next) => {
  const cookies = parseCookies(req);
  const payload = verifyToken(cookies['admin_token']);
  if (payload && payload.isAdmin) return next();
  res.redirect('/admin/login');
};

const requireAuthApi = (req, res, next) => {
  const cookies = parseCookies(req);
  const payload = verifyToken(cookies['admin_token']);
  if (payload && payload.isAdmin) return next();
  res.status(401).json({ error: 'Chưa đăng nhập' });
};

// ─── Routes: Public ──────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// API lấy danh sách tracks từ Cloudinary
app.get('/api/tracks', async (req, res) => {
  if (!cloudinary) {
    // Nếu chưa setup Cloudinary, trả về danh sách rỗng
    return res.json({ tracks: [], note: 'Cần cấu hình Cloudinary để upload/stream audio' });
  }
  try {
    const result = await cloudinary.search
      .expression('resource_type:video AND folder:audio-site')
      .sort_by('created_at', 'desc')
      .max_results(100)
      .execute();

    const tracks = result.resources.map(r => {
      const displayName = r.public_id.replace('audio-site/', '').replace(/^\d+_/, '');
      return {
        filename: r.public_id,
        displayName,
        size: r.bytes,
        uploadedAt: r.created_at,
        url: r.secure_url,
      };
    });
    res.json({ tracks });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Không thể đọc danh sách file từ Cloudinary' });
  }
});

// ─── Routes: Admin ───────────────────────────────────────────────────────────
app.get('/admin/login', (req, res) => {
  const cookies = parseCookies(req);
  if (verifyToken(cookies['admin_token'])?.isAdmin) return res.redirect('/admin');
  res.sendFile(path.join(__dirname, '..', 'public', 'login.html'));
});

app.post('/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    const token = signToken({
      isAdmin: true,
      exp: Date.now() + 24 * 60 * 60 * 1000 // 24h
    });
    res.setHeader('Set-Cookie',
      `admin_token=${token}; HttpOnly; Path=/; Max-Age=86400; SameSite=Strict`
    );
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Sai mật khẩu!' });
  }
});

app.post('/admin/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'admin_token=; HttpOnly; Path=/; Max-Age=0');
  res.json({ success: true });
});

app.get('/admin', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
});

// Upload lên Cloudinary
app.post('/admin/upload', requireAuthApi, (req, res) => {
  if (!cloudinary) {
    return res.status(503).json({
      error: 'Chức năng upload chưa được cấu hình. Vui lòng set biến môi trường CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET trong Vercel.'
    });
  }
  upload.single('audio')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Không có file nào được upload' });

    try {
      const safe = req.file.originalname.replace(/[^a-zA-Z0-9._\-\u00C0-\u024F\u1E00-\u1EFF ]/g, '_');
      const publicId = `audio-site/${Date.now()}_${safe.replace(/\.[^.]+$/, '')}`;

      // Upload buffer lên Cloudinary
      const result = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            resource_type: 'video', // Cloudinary dùng "video" cho audio
            public_id: publicId,
            folder: 'audio-site',
          },
          (error, result) => error ? reject(error) : resolve(result)
        );
        stream.end(req.file.buffer);
      });

      res.json({
        success: true,
        message: `Upload thành công: ${req.file.originalname}`,
        filename: result.public_id,
        url: result.secure_url
      });
    } catch (uploadErr) {
      console.error(uploadErr);
      res.status(500).json({ error: 'Upload lên Cloudinary thất bại: ' + uploadErr.message });
    }
  });
});

// Xóa track khỏi Cloudinary
app.delete('/admin/tracks/:filename', requireAuthApi, async (req, res) => {
  if (!cloudinary) {
    return res.status(503).json({ error: 'Cloudinary chưa được cấu hình' });
  }
  try {
    const publicId = decodeURIComponent(req.params.filename);
    await cloudinary.uploader.destroy(publicId, { resource_type: 'video' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Không thể xóa file: ' + err.message });
  }
});

// ─── Export cho Vercel ───────────────────────────────────────────────────────
module.exports = app;
