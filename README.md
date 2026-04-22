# 🎵 IT Security Podcast — Audio Site

## 🚀 Deploy lên Vercel (4 bước)

### Bước 1 — Push lên GitHub
```bash
git init && git add . && git commit -m "init"
git remote add origin https://github.com/<username>/<repo>.git
git push -u origin main
```

### Bước 2 — Import vào Vercel
Vào [vercel.com](https://vercel.com) → **Add New Project** → chọn repo → **Deploy**

### Bước 3 — Tạo Vercel Blob Storage (miễn phí)
1. Vào **Vercel Dashboard → Storage → Create Database**
2. Chọn **Blob** → đặt tên → **Create**
3. Vào tab **Settings** → copy `BLOB_READ_WRITE_TOKEN`

### Bước 4 — Set Environment Variables
Vào **Project → Settings → Environment Variables**:

| Variable | Giá trị |
|---|---|
| `ADMIN_PASSWORD` | Mật khẩu admin |
| `SESSION_SECRET` | Random string dài (vd: `openssl rand -hex 32`) |
| `BLOB_READ_WRITE_TOKEN` | Token từ bước 3 |

Sau đó **Redeploy** là xong ✅

---

## 📁 Cấu trúc

```
audio-site/
├── api/index.js      ← Express server
├── public/
│   ├── index.html    ← Trang nghe podcast
│   ├── admin.html    ← Trang upload
│   └── login.html    ← Đăng nhập
├── vercel.json
└── package.json
```

## 🛠 Chạy local
```bash
npm install
cp .env.example .env   # điền BLOB_READ_WRITE_TOKEN
npx vercel dev         # cần Vercel CLI
```
