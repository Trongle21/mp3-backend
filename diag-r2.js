// Ép dotenv override mọi biến đã có sẵn
const dotenv = require("dotenv");
const envPath = "d:/Another/Mp3/Backend/.env";
const result = dotenv.config({ path: envPath, override: true });

const {
  S3Client,
  HeadBucketCommand,
  PutObjectCommand,
} = require("@aws-sdk/client-s3");

const client = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});

const bucket = process.env.R2_BUCKET_NAME;

(async () => {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    console.log("HeadBucket: OK");
  } catch (e) {
    console.log(
      "HeadBucket FAIL:",
      e.name,
      "|",
      e.$metadata?.httpStatusCode || e.message,
    );
  }
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: "__diag_test__.txt",
        Body: "ok",
        ContentType: "text/plain",
      }),
    );
    console.log("PutObject: OK");
  } catch (e) {
    console.log(
      "PutObject FAIL:",
      e.name,
      "|",
      e.$metadata?.httpStatusCode || e.message,
    );
  }
})();
