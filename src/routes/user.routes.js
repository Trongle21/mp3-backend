const { Router } = require("express");
const { body, param } = require("express-validator");
const ctrl = require("../controllers/user.controller");
const contactCtrl = require("../controllers/contact.controller");
const presenceCtrl = require("../controllers/presence.controller");
const asyncHandler = require("../utils/asyncHandler");
const auth = require("../middleware/auth.middleware");
const requireMaster = require("../middleware/master.middleware");
const upload = require("../middleware/upload.middleware");
const { runValidation } = require("../middleware/error.middleware");

const router = Router();

router.use(auth);

// ✅ Own profile — đặt trước /:id để Express match đúng
router.get("/me", asyncHandler(ctrl.getProfile));
router.patch("/me", asyncHandler(ctrl.updateProfile));
router.post(
  "/me/avatar",
  upload.uploadImage.single("file"),
  asyncHandler(ctrl.updateAvatar),
);
router.delete("/me/avatar", asyncHandler(ctrl.deleteAvatar));

// ─── CONTACTS ────────────────────────────────────────────────────────────────
router.get("/contacts", asyncHandler(contactCtrl.list));
router.post(
  "/contacts",
  // [body("recipientId").isMongoId()],
  // runValidation,
  asyncHandler(contactCtrl.sendRequest),
);
router.patch(
  "/contacts/:id",
  [
    param("id").isMongoId(),
    body("action").isIn(["accept", "decline", "block"]),
  ],
  runValidation,
  asyncHandler(contactCtrl.respondRequest),
);
router.delete(
  "/contacts/:id",
  [param("id").isMongoId()],
  runValidation,
  asyncHandler(contactCtrl.removeContact),
);

// ─── PRESENCE ────────────────────────────────────────────────────────────────
router.get("/presence", asyncHandler(presenceCtrl.getPresence));
router.post("/presence/heartbeat", asyncHandler(presenceCtrl.heartbeat));

// 🔒 Master only
router.get("/", requireMaster, asyncHandler(ctrl.list));
router.patch(
  "/:id/role",
  requireMaster,
  [param("id").isMongoId(), body("isAdmin").optional()],
  runValidation,
  asyncHandler(ctrl.updateRole),
);
router.patch(
  "/:id",
  requireMaster,
  [param("id").isMongoId()],
  runValidation,
  asyncHandler(ctrl.updateUser),
);
router.delete(
  "/:id",
  requireMaster,
  [param("id").isMongoId()],
  runValidation,
  asyncHandler(ctrl.remove),
);

module.exports = router;
