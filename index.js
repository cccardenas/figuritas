const express = require("express");
const cors = require("cors");
const {
  getAuthWarning,
  hashPassword,
  signAuthToken,
  verifyAuthToken,
  verifyPassword,
} = require("./auth");
const {
  albumId,
  cancelFriendRequest,
  createUser,
  databaseName,
  ensureDatabase,
  findUserByEmail,
  findUserById,
  getCountrySummaries,
  getExchangeSummary,
  listFriendRequests,
  listFriends,
  pingDatabase,
  getCounts,
  adjustSticker,
  removeFriend,
  respondToFriendRequest,
  searchUsers,
  sendFriendRequest,
  setStickerCount,
  replaceCounts,
  resetAlbum,
} = require("./db");

const app = express();
const port = Number(process.env.PORT || 3001);
const stickerKeyPattern = /^(?=.{1,80}$)[A-Z0-9]+(?:-[A-Z0-9]+)*$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const corsOrigins = parseCorsOrigins(process.env.CORS_ORIGIN);
let databaseStartupError = null;

function parseCorsOrigins(value) {
  return String(value || "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

if (corsOrigins.length > 0) {
  app.use(
    cors({
      allowedHeaders: ["Content-Type", "Authorization"],
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      origin(origin, callback) {
        if (!origin) return callback(null, true);
        if (corsOrigins.includes("*")) return callback(null, true);

        return callback(null, corsOrigins.includes(origin.replace(/\/$/, "")));
      },
    }),
  );
}

app.use(express.json({ limit: "80kb" }));

app.get("/", (req, res) => {
  res.json({ ok: true, service: "figuritas-api" });
});

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
  };
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizeName(name) {
  const safeName = String(name || "").trim();
  return safeName ? safeName.slice(0, 80) : null;
}

function parsePositiveInt(value, message) {
  const id = Number(value);

  if (!Number.isSafeInteger(id) || id <= 0) {
    const error = new Error(message);
    error.status = 400;
    throw error;
  }

  return id;
}

function validateAuthInput(req, res) {
  const body = req.body || {};
  const email = normalizeEmail(body.email);
  const password = String(body.password || "");
  const name = normalizeName(body.name);

  if (!emailPattern.test(email) || email.length > 254) {
    res.status(400).json({ error: "Email invalido" });
    return null;
  }

  if (password.length < 8 || password.length > 128) {
    res.status(400).json({ error: "La contrasena debe tener entre 8 y 128 caracteres" });
    return null;
  }

  return { email, password, name };
}

function getBearerToken(req) {
  const header = req.get("authorization") || "";
  const [scheme, token] = header.split(" ");

  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return null;
  }

  return token;
}

async function authenticate(req, res, next) {
  try {
    const token = getBearerToken(req);

    if (!token) {
      return res.status(401).json({ error: "Token requerido" });
    }

    let payload;
    try {
      payload = verifyAuthToken(token);
    } catch (error) {
      return res.status(401).json({ error: "Token invalido o vencido" });
    }

    const userId = Number(payload.sub);
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      return res.status(401).json({ error: "Token invalido o vencido" });
    }

    const user = await findUserById(userId);

    if (!user) {
      return res.status(401).json({ error: "Usuario no encontrado" });
    }

    req.user = user;
    return next();
  } catch (error) {
    return next(error);
  }
}

function validateStickerKey(req, res, next) {
  const { stickerKey } = req.params;

  if (!stickerKeyPattern.test(stickerKey)) {
    return res.status(400).json({ error: "Codigo de figurita invalido" });
  }

  return next();
}

app.post("/api/auth/register", async (req, res, next) => {
  try {
    const authInput = validateAuthInput(req, res);
    if (!authInput) return;

    const existingUser = await findUserByEmail(authInput.email);
    if (existingUser) {
      return res.status(409).json({ error: "Ya existe un usuario con ese email" });
    }

    const passwordHash = await hashPassword(authInput.password);
    const user = await createUser({
      email: authInput.email,
      name: authInput.name,
      passwordHash,
    });

    return res.status(201).json({
      token: signAuthToken(user),
      user: publicUser(user),
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "Ya existe un usuario con ese email" });
    }

    return next(error);
  }
});

app.post("/api/auth/login", async (req, res, next) => {
  try {
    const authInput = validateAuthInput(req, res);
    if (!authInput) return;

    const user = await findUserByEmail(authInput.email);
    const passwordMatches = user
      ? await verifyPassword(authInput.password, user.passwordHash)
      : false;

    if (!user || !passwordMatches) {
      return res.status(401).json({ error: "Email o contrasena incorrectos" });
    }

    return res.json({
      token: signAuthToken(user),
      user: publicUser(user),
    });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/auth/me", authenticate, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

app.get("/api/users/search", authenticate, async (req, res, next) => {
  try {
    const users = await searchUsers(req.user.id, req.query.q, req.query.limit);
    res.json({ users });
  } catch (error) {
    next(error);
  }
});

app.get("/api/friends", authenticate, async (req, res, next) => {
  try {
    res.json({ friends: await listFriends(req.user.id) });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/friends/:friendId", authenticate, async (req, res, next) => {
  try {
    const friendId = parsePositiveInt(req.params.friendId, "Amigo invalido");
    await removeFriend(req.user.id, friendId);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.get("/api/friend-requests", authenticate, async (req, res, next) => {
  try {
    res.json(await listFriendRequests(req.user.id));
  } catch (error) {
    next(error);
  }
});

app.post("/api/friend-requests", authenticate, async (req, res, next) => {
  try {
    const userId = parsePositiveInt(req.body?.userId, "Usuario invalido");
    const request = await sendFriendRequest(req.user.id, userId);
    res.status(201).json({ request });
  } catch (error) {
    next(error);
  }
});

app.post("/api/friend-requests/:requestId/accept", authenticate, async (req, res, next) => {
  try {
    const requestId = parsePositiveInt(req.params.requestId, "Solicitud invalida");
    const request = await respondToFriendRequest(req.user.id, requestId, "accept");
    res.json({ request });
  } catch (error) {
    next(error);
  }
});

app.post("/api/friend-requests/:requestId/reject", authenticate, async (req, res, next) => {
  try {
    const requestId = parsePositiveInt(req.params.requestId, "Solicitud invalida");
    const request = await respondToFriendRequest(req.user.id, requestId, "reject");
    res.json({ request });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/friend-requests/:requestId", authenticate, async (req, res, next) => {
  try {
    const requestId = parsePositiveInt(req.params.requestId, "Solicitud invalida");
    await cancelFriendRequest(req.user.id, requestId);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.get("/api/health", async (req, res) => {
  try {
    await pingDatabase();
    res.json({ ok: true, albumId, database: databaseName });
  } catch (error) {
    res.status(503).json({
      ok: false,
      database: databaseName,
      error: databaseStartupError?.message || error.message,
    });
  }
});

app.get("/api/stickers/countries", authenticate, async (req, res, next) => {
  try {
    const countries = await getCountrySummaries(req.user.id, req.query.q);
    res.json({ albumId, countries });
  } catch (error) {
    next(error);
  }
});

app.get("/api/stickers", authenticate, async (req, res, next) => {
  try {
    res.json({ albumId, counts: await getCounts(req.user.id) });
  } catch (error) {
    next(error);
  }
});

app.post(
  "/api/stickers/:stickerKey/adjust",
  authenticate,
  validateStickerKey,
  async (req, res, next) => {
    try {
      const delta = Number(req.body?.delta);
      if (![1, -1].includes(delta)) {
        return res.status(400).json({ error: "El cambio debe ser +1 o -1" });
      }

      const count = await adjustSticker(req.user.id, req.params.stickerKey, delta);
      res.json({ stickerKey: req.params.stickerKey, count });
    } catch (error) {
      next(error);
    }
  },
);

app.put(
  "/api/stickers/:stickerKey",
  authenticate,
  validateStickerKey,
  async (req, res, next) => {
    try {
      const count = await setStickerCount(req.user.id, req.params.stickerKey, req.body?.count);
      res.json({ stickerKey: req.params.stickerKey, count });
    } catch (error) {
      next(error);
    }
  },
);

app.put("/api/stickers", authenticate, async (req, res, next) => {
  try {
    const rawCounts = req.body?.counts || {};
    if (typeof rawCounts !== "object" || Array.isArray(rawCounts)) {
      return res.status(400).json({ error: "Formato de figuritas invalido" });
    }

    const counts = {};

    for (const [stickerKey, count] of Object.entries(rawCounts)) {
      if (!stickerKeyPattern.test(stickerKey)) {
        return res.status(400).json({ error: "Codigo de figurita invalido" });
      }

      const safeCount = Math.max(0, Math.min(99, Number(count) || 0));
      if (safeCount > 0) counts[stickerKey] = safeCount;
    }

    await replaceCounts(req.user.id, counts);
    res.json({ albumId, counts: await getCounts(req.user.id) });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/stickers", authenticate, async (req, res, next) => {
  try {
    await resetAlbum(req.user.id);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.get("/api/exchange", authenticate, async (req, res, next) => {
  try {
    res.json(await getExchangeSummary(req.user.id));
  } catch (error) {
    next(error);
  }
});

app.use((error, req, res, next) => {
  const status = Number(error.status || error.statusCode || 500);

  if (status >= 500) {
    console.error(error);
  }

  res.status(status).json({ error: status >= 500 ? "Error del servidor" : error.message });
});

async function initializeDatabase() {
  try {
    await ensureDatabase();
    databaseStartupError = null;
  } catch (error) {
    databaseStartupError = error;
    console.error("No se pudo iniciar la base de datos MySQL:");
    console.error(`Host: ${process.env.DB_HOST || "localhost"}`);
    console.error(`Usuario: ${process.env.DB_USER || "root"}`);
    console.error(`Base: ${process.env.DB_NAME || "figuritas_2026"}`);
    console.error(error.message);
  }
}

app.listen(port, "0.0.0.0", () => {
  console.log(`API lista en http://localhost:${port}`);
  console.log(`Album compartido: ${albumId}`);
  const authWarning = getAuthWarning();
  if (authWarning) console.warn(authWarning);
  initializeDatabase();
});
