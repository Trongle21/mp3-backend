const mongoose = require("mongoose");

async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");

  // Debug log để xác nhận Vercel load đúng env vars.
  // Tạm thời an toàn vì URI không in ra.
  console.log(`[mongo] connecting... has SRV: ${uri.startsWith('mongodb+srv://')}`);
  console.log(`[mongo] host: ${new URL(uri.replace('mongodb+srv://', 'http://').replace('mongodb://', 'http://')).host}`);

  mongoose.set("strictQuery", true);

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 30000,
    socketTimeoutMS: 45000,
    connectTimeoutMS: 30000,
  });

  console.log("MongoDB connected");
}

module.exports = connectDB;
