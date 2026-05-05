const express = require("express");
const cors = require("cors");
const {
  albumId,
  databaseName,
  ensureDatabase,
  pingDatabase,
  getCounts,
  adjustSticker,
  setStickerCount,
  replaceCounts,
  resetAlbum,
} = require("./db");


const app = express();
const port = Number(process.env.PORT || 3001);
const stickerKeyPattern = /^[A-Z0-9]+(?:-[A-Z0-9]+)*-[0-9]{1,2}$/;
const corsOrigin = process.env.CORS_ORIGIN;

if (corsOrigin) {
  app.use(cors({ origin: corsOrigin }));
}

app.use(express.json({ limit: "80kb" }));

function validateStickerKey(req, res, next) {
  const { stickerKey } = req.params;

  if (!stickerKeyPattern.test(stickerKey)) {
    return res.status(400).json({ error: "Codigo de figurita invalido" });
  }

  return next();
}

app.get("/api/health", async (req, res) => {
  try {
    await pingDatabase();
    res.json({ ok: true, albumId, database: databaseName });
  } catch (error) {
    res.status(503).json({ ok: false, error: error.message });
  }
});

app.get("/api/stickers", async (req, res, next) => {
  try {
    res.json({ albumId, counts: await getCounts() });
  } catch (error) {
    next(error);
  }
});

app.post("/api/stickers/:stickerKey/adjust", validateStickerKey, async (req, res, next) => {
  try {
    const count = await adjustSticker(req.params.stickerKey, req.body.delta);
    res.json({ stickerKey: req.params.stickerKey, count });
  } catch (error) {
    next(error);
  }
});

app.put("/api/stickers/:stickerKey", validateStickerKey, async (req, res, next) => {
  try {
    const count = await setStickerCount(req.params.stickerKey, req.body.count);
    res.json({ stickerKey: req.params.stickerKey, count });
  } catch (error) {
    next(error);
  }
});

app.put("/api/stickers", async (req, res, next) => {
  try {
    const rawCounts = req.body.counts || {};
    const counts = {};

    for (const [stickerKey, count] of Object.entries(rawCounts)) {
      if (!stickerKeyPattern.test(stickerKey)) {
        return res.status(400).json({ error: "Codigo de figurita invalido" });
      }

      const safeCount = Math.max(0, Math.min(99, Number(count) || 0));
      if (safeCount > 0) counts[stickerKey] = safeCount;
    }

    await replaceCounts(counts);
    res.json({ albumId, counts: await getCounts() });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/stickers", async (req, res, next) => {
  try {
    await resetAlbum();
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({ error: "Error del servidor" });
});

ensureDatabase()
  .then(() => {
    app.listen(port, "0.0.0.0", () => {
      console.log(`API lista en http://localhost:${port}`);
      console.log(`Album compartido: ${albumId}`);
    });
  })
  .catch((error) => {
    console.error("No se pudo iniciar la base de datos MySQL:");
    console.error(error.message);
    process.exit(1);
  });
