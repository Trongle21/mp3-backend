const mongoose = require("mongoose");

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error("MONGODB_URI is not set");

mongoose.set("strictQuery", true);

// Cache connection giữa các lần gọi function (quan trọng với serverless)
let cached = global._mongoose;
if (!cached) {
  cached = global._mongoose = { conn: null, promise: null };
}

async function connectDB() {
  // Đã có connection sẵn sàng -> dùng lại luôn
  if (cached.conn && mongoose.connection.readyState === 1) {
    return cached.conn;
  }

  // Đang trong quá trình connect -> chờ promise đó, không tạo connect mới
  if (!cached.promise) {
    cached.promise = mongoose
      .connect(uri, {
        serverSelectionTimeoutMS: 10000,
        socketTimeoutMS: 45000,
        connectTimeoutMS: 10000,
        maxPoolSize: 10,
      })
      .then((m) => {
        console.log("MongoDB connected");
        return m;
      })
      .catch((err) => {
        cached.promise = null; // reset để lần sau thử lại
        throw err;
      });
  }

  cached.conn = await cached.promise;
  return cached.conn;
}

module.exports = connectDB;
