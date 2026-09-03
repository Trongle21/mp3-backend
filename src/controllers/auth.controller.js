const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");

const ACCESS_EXPIRES = process.env.JWT_ACCESS_EXPIRES;
const REFRESH_EXPIRES = process.env.JWT_REFRESH_EXPIRES;

function signAccessToken(userId) {
  return jwt.sign({ sub: userId.toString() }, process.env.JWT_ACCESS_SECRET, {
    expiresIn: ACCESS_EXPIRES,
  });
}

function signRefreshToken(userId) {
  return jwt.sign(
    { sub: userId.toString(), typ: "refresh" },
    process.env.JWT_REFRESH_SECRET,
    {
      expiresIn: REFRESH_EXPIRES,
    },
  );
}

function generateTokens(userId) {
  return {
    accessToken: signAccessToken(userId),
    refreshToken: signRefreshToken(userId),
  };
}

exports.register = async (req, res) => {
  const { email, password, name } = req.body;

  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) {
    return res
      .status(409)
      .json({ success: false, message: "Email already registered" });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await User.create({ email, passwordHash, name });

  const tokens = generateTokens(user._id);
  return res.status(201).json({
    success: true,
    data: { user: user.toJSON(), ...tokens },
  });
};

exports.login = async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) {
    return res
      .status(401)
      .json({ success: false, message: "Invalid credentials" });
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    return res
      .status(401)
      .json({ success: false, message: "Invalid credentials" });
  }

  const tokens = generateTokens(user._id);
  return res.json({
    success: true,
    data: { user: user.toJSON(), ...tokens },
  });
};

exports.refresh = async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return res
      .status(400)
      .json({ success: false, message: "Missing refreshToken" });
  }

  let payload;
  try {
    payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
  } catch (err) {
    return res
      .status(401)
      .json({ success: false, message: "Invalid or expired refresh token" });
  }

  if (payload.typ !== "refresh" || !payload.sub) {
    return res
      .status(401)
      .json({ success: false, message: "Invalid token type" });
  }

  const user = await User.findById(payload.sub).select("_id");
  if (!user) {
    return res.status(401).json({ success: false, message: "User not found" });
  }

  const accessToken = signAccessToken(user._id);
  return res.json({ success: true, data: { accessToken } });
};

exports.me = async (req, res) => {
  const user = await User.findById(req.userId);
  if (!user)
    return res.status(404).json({ success: false, message: "User not found" });
  return res.json({ success: true, data: user.toJSON() });
};
