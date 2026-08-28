// Vercel entry point. Mọi route đều được mount trong src/app.js.
// Middleware đảm bảo MongoDB kết nối + debug endpoint cũng đã được
// đăng ký trong src/app.js để chạy đúng thứ tự trước các router.
const app = require("../src/app");

module.exports = app;
