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
      CREATE TABLE IF NOT EXISTS ${database}.users (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        email VARCHAR(254) NOT NULL,
        name VARCHAR(80) NULL,
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_users_email (email)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await adminPool.query(`
      CREATE TABLE IF NOT EXISTS ${database}.sticker_counts (
        user_id BIGINT UNSIGNED NOT NULL,
        album_id VARCHAR(64) NOT NULL,
        sticker_key VARCHAR(80) NOT NULL,
        count TINYINT UNSIGNED NOT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, album_id, sticker_key),
        CONSTRAINT chk_sticker_count_range CHECK (count BETWEEN 0 AND 99)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await migrateStickerCountsTable(adminPool, database);
  } finally {
    await adminPool.end();
  }

  pool = mysql.createPool({
    ...baseConfig,
    database: databaseName,
  });

  await pool.query("SELECT 1");
}

async function migrateStickerCountsTable(adminPool, database) {
  const [columns] = await adminPool.query(
    `SELECT COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'sticker_counts'`,
    [databaseName],
  );
  const columnNames = new Set(columns.map((row) => row.COLUMN_NAME));

  if (!columnNames.has("user_id")) {
    await adminPool.query(`
      ALTER TABLE ${database}.sticker_counts
      ADD COLUMN user_id BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER album_id
    `);
  }

  const [primaryKeyRows] = await adminPool.query(
    `SELECT COLUMN_NAME
     FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = ?
       AND TABLE_NAME = 'sticker_counts'
       AND CONSTRAINT_NAME = 'PRIMARY'
     ORDER BY ORDINAL_POSITION`,
    [databaseName],
  );
  const primaryKey = primaryKeyRows.map((row) => row.COLUMN_NAME).join(",");

  if (!primaryKey) {
    await adminPool.query(`
      ALTER TABLE ${database}.sticker_counts
      ADD PRIMARY KEY (user_id, album_id, sticker_key)
    `);
  } else if (primaryKey !== "user_id,album_id,sticker_key") {
    await adminPool.query(`
      ALTER TABLE ${database}.sticker_counts
      DROP PRIMARY KEY,
      ADD PRIMARY KEY (user_id, album_id, sticker_key)
    `);
  }
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

function normalizeUserId(userId) {
  const id = Number(userId);

  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error("Usuario invalido");
  }

  return id;
}

function mapUser(row) {
  if (!row) return null;

  return {
    id: Number(row.id),
    email: row.email,
    name: row.name,
    passwordHash: row.password_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function createUser({ email, name, passwordHash }) {
  const [result] = await getPool().query(
    "INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)",
    [email, name || null, passwordHash],
  );

  return findUserById(result.insertId);
}

async function findUserByEmail(email) {
  const [rows] = await getPool().query(
    `SELECT id, email, name, password_hash, created_at, updated_at
     FROM users
     WHERE email = ?
     LIMIT 1`,
    [email],
  );

  return mapUser(rows[0]);
}

async function findUserById(userId) {
  const [rows] = await getPool().query(
    `SELECT id, email, name, password_hash, created_at, updated_at
     FROM users
     WHERE id = ?
     LIMIT 1`,
    [normalizeUserId(userId)],
  );

  return mapUser(rows[0]);
}

async function getCounts(userId) {
  const safeUserId = normalizeUserId(userId);
  const [rows] = await getPool().query(
    "SELECT sticker_key, count FROM sticker_counts WHERE user_id = ? AND album_id = ?",
    [safeUserId, albumId],
  );

  return rows.reduce((counts, row) => {
    counts[row.sticker_key] = Number(row.count);
    return counts;
  }, {});
}

async function adjustSticker(userId, stickerKey, delta) {
  const safeUserId = normalizeUserId(userId);
  const safeDelta = Number(delta);

  if (![1, -1].includes(safeDelta)) {
    throw new Error("El cambio debe ser +1 o -1");
  }

  if (safeDelta === 1) {
    await getPool().query(
      `INSERT INTO sticker_counts (user_id, album_id, sticker_key, count)
       VALUES (?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE count = LEAST(99, count + 1)`,
      [safeUserId, albumId, stickerKey],
    );
  } else {
    await getPool().query(
      `UPDATE sticker_counts
       SET count = GREATEST(0, count - 1)
       WHERE user_id = ? AND album_id = ? AND sticker_key = ?`,
      [safeUserId, albumId, stickerKey],
    );
    await getPool().query(
      `DELETE FROM sticker_counts
       WHERE user_id = ? AND album_id = ? AND sticker_key = ? AND count = 0`,
      [safeUserId, albumId, stickerKey],
    );
  }

  const [rows] = await getPool().query(
    "SELECT count FROM sticker_counts WHERE user_id = ? AND album_id = ? AND sticker_key = ?",
    [safeUserId, albumId, stickerKey],
  );

  return rows[0] ? Number(rows[0].count) : 0;
}

async function setStickerCount(userId, stickerKey, count) {
  const safeUserId = normalizeUserId(userId);
  const safeCount = Math.max(0, Math.min(99, Number(count) || 0));

  if (safeCount === 0) {
    await getPool().query(
      "DELETE FROM sticker_counts WHERE user_id = ? AND album_id = ? AND sticker_key = ?",
      [safeUserId, albumId, stickerKey],
    );
    return 0;
  }

  await getPool().query(
    `INSERT INTO sticker_counts (user_id, album_id, sticker_key, count)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE count = VALUES(count)`,
    [safeUserId, albumId, stickerKey, safeCount],
  );

  return safeCount;
}

async function replaceCounts(userId, counts) {
  const safeUserId = normalizeUserId(userId);
  const entries = Object.entries(counts)
    .map(([stickerKey, count]) => [stickerKey, Math.max(0, Math.min(99, Number(count) || 0))])
    .filter(([, count]) => count > 0);

  const connection = await getPool().getConnection();

  try {
    await connection.beginTransaction();
    await connection.query("DELETE FROM sticker_counts WHERE user_id = ? AND album_id = ?", [
      safeUserId,
      albumId,
    ]);

    if (entries.length > 0) {
      await connection.query(
        "INSERT INTO sticker_counts (user_id, album_id, sticker_key, count) VALUES ?",
        [entries.map(([stickerKey, count]) => [safeUserId, albumId, stickerKey, count])],
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

async function resetAlbum(userId) {
  await getPool().query("DELETE FROM sticker_counts WHERE user_id = ? AND album_id = ?", [
    normalizeUserId(userId),
    albumId,
  ]);
}

module.exports = {
  albumId,
  createUser,
  databaseName,
  ensureDatabase,
  findUserByEmail,
  findUserById,
  pingDatabase,
  getCounts,
  adjustSticker,
  setStickerCount,
  replaceCounts,
  resetAlbum,
};
