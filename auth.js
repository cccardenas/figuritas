const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const isProduction = process.env.NODE_ENV === "production";
const jwtSecret = process.env.JWT_SECRET || "figuritas-dev-secret-change-me";
const jwtExpiresIn = process.env.JWT_EXPIRES_IN || "7d";

if (isProduction && !process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET es obligatorio en produccion");
}

function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

function verifyPassword(password, passwordHash) {
  return bcrypt.compare(password, passwordHash);
}

function signAuthToken(user) {
  return jwt.sign(
    {
      sub: String(user.id),
      email: user.email,
    },
    jwtSecret,
    { expiresIn: jwtExpiresIn },
  );
}

function verifyAuthToken(token) {
  return jwt.verify(token, jwtSecret);
}

function getAuthWarning() {
  if (process.env.JWT_SECRET) return null;
  return "JWT_SECRET no esta configurado; usando clave de desarrollo.";
}

module.exports = {
  getAuthWarning,
  hashPassword,
  signAuthToken,
  verifyAuthToken,
  verifyPassword,
};
