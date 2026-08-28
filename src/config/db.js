const mongoose = require("mongoose");

async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");

  mongoose.set("strictQuery", true);

  // Trên Vercel serverless, DNS + TLS + server selection có thể chậm hơn local.
  // Tăng timeout để tránh false-negative.
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 30000,
    socketTimeoutMS: 45000,
    connectTimeoutMS: 30000,
  });

  console.log("MongoDB connected");
}

module.exports = connectDB;
