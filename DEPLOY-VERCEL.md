# Deploy Backend lên Vercel

## Cấu trúc Vercel

- `api/index.js` — entry point serverless
- `vercel.json` — cấu hình routing + build
- `.vercelignore` — loại trừ file không cần thiết

## Deploy

### Cách 1: Vercel Dashboard (khuyến nghị)

1. Push code lên GitHub
2. Vào [vercel.com](https://vercel.com) → **Add New Project** → Import repo
3. Cấu hình:
   - **Framework Preset**: Other
   - **Root Directory**: `./` (mặc định)
   - **Build Command**: để trống
   - **Output Directory**: để trống

### Cách 2: Vercel CLI

```bash
npm i -g vercel
vercel login
vercel              # preview
vercel --prod       # production
```

## Environment Variables (bắt buộc)

Vào **Settings → Environment Variables** trên Vercel Dashboard:

| Key | Ví dụ |
|-----|-------|
| `MONGODB_URI` | `mongodb+srv://user:pass@cluster.mongodb.net/db` |
| `JWT_SECRET` | `your-super-secret-key` |
| `NODE_ENV` | `production` |
| `FRONTEND_URL` | `https://your-frontend.vercel.app` |
| `R2_ACCOUNT_ID` | `xxx` |
| `R2_ACCESS_KEY_ID` | `xxx` |
| `R2_SECRET_ACCESS_KEY` | `xxx` |
| `R2_BUCKET` | `mp3-bucket` |
| `R2_PUBLIC_URL` | `https://pub-xxx.r2.dev` |
| `R2_ENDPOINT` | `https://<account>.r2.cloudflarestorage.com` |

## Kiểm tra

```
GET https://your-app.vercel.app/api/health
```

Response:
```json
{ "success": true, "data": { "status": "ok", "ts": 1234567890 } }
```

## ⚠️ Giới hạn Vercel

| Vấn đề | Giải pháp |
|--------|-----------|
| Upload file lớn (>4.5MB) bị fail | Dùng R2 presigned URL — frontend upload thẳng lên R2 |
| Timeout 10s (Hobby) / 60s (Pro) | Tránh xử lý đồng bộ nặng |
| Cold start ~1-2s | Chấp nhận được |
| MongoDB Atlas phải whitelist IP | Cho phép `0.0.0.0/0` (Vercel IP động) |

## CORS

Sau khi deploy frontend, cập nhật `FRONTEND_URL` trong Vercel env vars để CORS chỉ cho phép domain thật (hiện đang mở `*` trong code).
