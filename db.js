const mysql = require("mysql2/promise");
require("dotenv").config();

const albumId = process.env.ALBUM_ID || "worldcup-2026";
const databaseName = process.env.DB_NAME || "figuritas_2026";

const baseConfig = {
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: (process.env.DB_PASSWORD || "").trim(),
  waitForConnections: true,
  connectionLimit: 10,
  enableKeepAlive: true,
};

let pool;

function quoteIdentifier(value) {
  if (!/^[A-Za-z0-9_$]+$/.test(value)) {
    throw new Error(`Nombre de base de datos invalido: ${value}`);
  }

  return `\`${value}\``;
}

async function ensureDatabase() {
  const database = quoteIdentifier(databaseName);
  const adminPool = mysql.createPool(baseConfig);

  try {
    await adminPool.query(
      `CREATE DATABASE IF NOT EXISTS ${database} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );

    await adminPool.query(`
      CREATE TABLE IF NOT EXISTS ${database}.sticker_counts (
        album_id VARCHAR(64) NOT NULL,
        sticker_key VARCHAR(80) NOT NULL,
        count TINYINT UNSIGNED NOT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (album_id, sticker_key),
        CONSTRAINT chk_sticker_count_range CHECK (count BETWEEN 0 AND 99)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  } finally {
    await adminPool.end();
  }

  pool = mysql.createPool({
    ...baseConfig,
    database: databaseName,
  });

  await pool.query("SELECT 1");
}

function getPool() {
  if (!pool) {
    throw new Error("La base de datos no esta inicializada");
  }

  return pool;
}

async function pingDatabase() {
  await getPool().query("SELECT 1");
}

async function getCounts() {
  const [rows] = await getPool().query(
    "SELECT sticker_key, count FROM sticker_counts WHERE album_id = ?",
    [albumId],
  );

  return rows.reduce((counts, row) => {
    counts[row.sticker_key] = Number(row.count);
    return counts;
  }, {});
}

async function adjustSticker(stickerKey, delta) {
  const safeDelta = Number(delta);

  if (![1, -1].includes(safeDelta)) {
    throw new Error("El cambio debe ser +1 o -1");
  }

  if (safeDelta === 1) {
    await getPool().query(
      `INSERT INTO sticker_counts (album_id, sticker_key, count)
       VALUES (?, ?, 1)
       ON DUPLICATE KEY UPDATE count = LEAST(99, count + 1)`,
      [albumId, stickerKey],
    );
  } else {
    await getPool().query(
      "UPDATE sticker_counts SET count = GREATEST(0, count - 1) WHERE album_id = ? AND sticker_key = ?",
      [albumId, stickerKey],
    );
    await getPool().query(
      "DELETE FROM sticker_counts WHERE album_id = ? AND sticker_key = ? AND count = 0",
      [albumId, stickerKey],
    );
  }

  const [rows] = await getPool().query(
    "SELECT count FROM sticker_counts WHERE album_id = ? AND sticker_key = ?",
    [albumId, stickerKey],
  );

  return rows[0] ? Number(rows[0].count) : 0;
}

async function setStickerCount(stickerKey, count) {
  const safeCount = Math.max(0, Math.min(99, Number(count) || 0));

  if (safeCount === 0) {
    await getPool().query(
      "DELETE FROM sticker_counts WHERE album_id = ? AND sticker_key = ?",
      [albumId, stickerKey],
    );
    return 0;
  }

  await getPool().query(
    `INSERT INTO sticker_counts (album_id, sticker_key, count)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE count = VALUES(count)`,
    [albumId, stickerKey, safeCount],
  );

  return safeCount;
}

async function replaceCounts(counts) {
  const entries = Object.entries(counts)
    .map(([stickerKey, count]) => [stickerKey, Math.max(0, Math.min(99, Number(count) || 0))])
    .filter(([, count]) => count > 0);

  const connection = await getPool().getConnection();

  try {
    await connection.beginTransaction();
    await connection.query("DELETE FROM sticker_counts WHERE album_id = ?", [albumId]);

    if (entries.length > 0) {
      await connection.query(
        "INSERT INTO sticker_counts (album_id, sticker_key, count) VALUES ?",
        [entries.map(([stickerKey, count]) => [albumId, stickerKey, count])],
      );
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function resetAlbum() {
  await getPool().query("DELETE FROM sticker_counts WHERE album_id = ?", [albumId]);
}

module.exports = {
  albumId,
  databaseName,
  ensureDatabase,
  pingDatabase,
  getCounts,
  adjustSticker,
  setStickerCount,
  replaceCounts,
  resetAlbum,
};
