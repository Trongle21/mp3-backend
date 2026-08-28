require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const { rateLimit } = require("express-rate-limit");

const {
  errorMiddleware,
  notFoundMiddleware,
} = require("./middleware/error.middleware");

const authRoutes = require("./routes/auth.routes");
const trackRoutes = require("./routes/track.routes");
const groupRoutes = require("./routes/group.routes");
const albumRoutes = require("./routes/album.routes");
const playerRoutes = require("./routes/player.routes");
const userRoutes = require("./routes/user.routes");

const app = express();

// Vercel (và mọi reverse proxy) set X-Forwarded-For. Cần bật trust proxy
// để express-rate-limit đọc IP thật của client, không thì lỗi
// ERR_ERL_UNEXPECTED_X_FORWARDED_FOR.
app.set("trust proxy", 1);

// CORS: chỉ cho phép origin từ env. Cho phép credentials nếu cần.
const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
// app.use(
//   cors({
//     origin: (origin, cb) => {
//       // Cho phép request không có origin (vd: Postman, curl) trong dev.
//       if (!origin) return cb(null, true);
//       if (origin === frontendUrl) return cb(null, true);
//       return cb(new Error(`CORS blocked: ${origin}`));
//     },
//     credentials: true,
//   })
// );

app.use(
  cors({
    origin: "*",
  }),
);

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

// Global rate limiter (rất cao để không cản streaming). Riêng auth có limiter riêng.
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);

// Health check.
app.get("/api/health", (_req, res) => {
  res.json({ success: true, data: { status: "ok", ts: Date.now() } });
});

// Routes.
app.use("/api/auth", authRoutes);
app.use("/api/tracks", trackRoutes);
app.use("/api/groups", groupRoutes);
app.use("/api/albums", albumRoutes);
app.use("/api/player", playerRoutes);
app.use("/api/users", userRoutes);

// 404 + error handler đặt CUỐI cùng.
app.use(notFoundMiddleware);
app.use(errorMiddleware);

module.exports = app;
