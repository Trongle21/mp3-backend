const { S3Client } = require('@aws-sdk/client-s3');

const required = ['R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME'];
for (const key of required) {
  if (!process.env[key]) {
    // Không throw lúc require để tránh crash app khi một số route không dùng R2.
    // Các hàm upload/download sẽ kiểm tra riêng.
    console.warn(`[r2] Missing env: ${key}`);
  }
}

const client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.R2_BUCKET_NAME;
const PUBLIC_URL = process.env.R2_PUBLIC_URL || '';

module.exports = { client, BUCKET, PUBLIC_URL };
