const express = require('express');
const crypto  = require('crypto');
const path    = require('path');

const app = express();

// ─── Config ────────────────────────────────────────────────────────────────
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const SESSION_SECRET = process.env.SESSION_SECRET || 'audio-site-secret-key';

// ─── Auth helpers ──────────────────────────────────────────────────────────
function signToken(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig  = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}
function verifyToken(token) {
  if (!token) return null;
  try {
    const [data, sig] = token.split('.');
    const ok = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
    if (sig !== ok) return null;
    const p = JSON.parse(Buffer.from(data, 'base64url').toString());
    if (p.exp && Date.now() > p.exp) return null;
    return p;
  } catch { return null; }
}
function parseCookies(req) {
  const map = {};
  (req.headers.cookie || '').split(';').forEach(pair => {
    const [k, ...v] = pair.trim().split('=');
    if (k) map[k.trim()] = decodeURIComponent(v.join('='));
  });
  return map;
}

// ─── Middleware ─────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// ─── Auth guards ─────────────────────────────────────────────────────────────
const requireAuth = (req, res, next) => {
  const p = verifyToken(parseCookies(req)['admin_token']);
  return p && p.isAdmin ? next() : res.redirect('/admin/login');
};
const requireAuthApi = (req, res, next) => {
  const p = verifyToken(parseCookies(req)['admin_token']);
  return p && p.isAdmin ? next() : res.status(401).json({ error: 'Chưa đăng nhập' });
};

// ─── Public ──────────────────────────────────────────────────────────────────
app.get('/', (req, res) =>
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

app.get('/api/tracks', async (req, res) => {
  try {
    const { list } = require('@vercel/blob');
    const { blobs } = await list({ prefix: 'audio/' });
    const tracks = blobs
      .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))
      .map(b => ({
        filename:    b.pathname,
        displayName: b.pathname.replace('audio/', '').replace(/^\d+_/, '').replace(/\.[^.]+$/, ''),
        size:        b.size,
        uploadedAt:  b.uploadedAt,
        url:         b.url,
      }));
    res.json({ tracks });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Admin ───────────────────────────────────────────────────────────────────
app.get('/admin/login', (req, res) => {
  if (verifyToken(parseCookies(req)['admin_token']) && verifyToken(parseCookies(req)['admin_token']).isAdmin)
    return res.redirect('/admin');
  res.sendFile(path.join(__dirname, '..', 'public', 'login.html'));
});

app.post('/admin/login', (req, res) => {
  if (req.body.password !== ADMIN_PASSWORD)
    return res.status(401).json({ error: 'Sai mật khẩu!' });
  const token = signToken({ isAdmin: true, exp: Date.now() + 86400000 });
  res.setHeader('Set-Cookie',
    `admin_token=${token}; HttpOnly; Path=/; Max-Age=86400; SameSite=Strict`);
  res.json({ success: true });
});

app.post('/admin/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'admin_token=; HttpOnly; Path=/; Max-Age=0');
  res.json({ success: true });
});

app.get('/admin', requireAuth, (req, res) =>
  res.sendFile(path.join(__dirname, '..', 'public', 'admin.html')));

// Tạo client upload token — browser dùng để PUT thẳng lên Vercel Blob
app.post('/admin/upload-token', requireAuthApi, async (req, res) => {
  if (!process.env.BLOB_READ_WRITE_TOKEN)
    return res.status(503).json({ error: 'Chưa cấu hình BLOB_READ_WRITE_TOKEN trong Vercel Dashboard.' });
  try {
    const { filename } = req.body;
    if (!filename) return res.status(400).json({ error: 'Thiếu filename' });
    const safe = filename
      .replace(/[^a-zA-Z0-9._\-\u00C0-\u024F\u1E00-\u1EFF .]/g, '_')
      .trim();
    const pathname = `audio/${Date.now()}_${safe}`;

    // Tạo signed URL để client upload thẳng — giải pháp chính thức của Vercel Blob
    const { generateClientTokenFromReadWriteToken } = require('@vercel/blob/client');
    const clientToken = await generateClientTokenFromReadWriteToken({
      token:     process.env.BLOB_READ_WRITE_TOKEN,
      pathname,
      onUploadCompleted: { callbackUrl: `${req.protocol}://${req.get('host')}/api/tracks` },
    });
    res.json({ clientToken, pathname });
  } catch (err) {
    console.error('upload-token error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Xóa file
app.delete('/admin/tracks/:pathname(*)', requireAuthApi, async (req, res) => {
  try {
    const { list, del } = require('@vercel/blob');
    const pathname = decodeURIComponent(req.params.pathname);
    const { blobs } = await list({ prefix: pathname });
    const blob = blobs.find(b => b.pathname === pathname);
    if (!blob) return res.status(404).json({ error: 'File không tồn tại' });
    await del(blob.url);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = app;
