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

  await ensureDatabaseExists(database);

  pool = mysql.createPool({
    ...baseConfig,
    database: databaseName,
  });

  await pool.query("SELECT 1");
  await ensureTables(pool);
}

async function ensureDatabaseExists(database) {
  const adminPool = mysql.createPool(baseConfig);
  try {
    await adminPool.query(
      `CREATE DATABASE IF NOT EXISTS ${database} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
  } catch (error) {
    if (!isDatabaseCreateDenied(error)) throw error;
    console.warn(`No se pudo crear la base ${databaseName}; se intentara usar la existente.`);
  } finally {
    await adminPool.end();
  }
}

function isDatabaseCreateDenied(error) {
  return ["ER_DBACCESS_DENIED_ERROR", "ER_SPECIFIC_ACCESS_DENIED_ERROR"].includes(error.code);
}

async function ensureTables(connectionPool) {
  await connectionPool.query(`
    CREATE TABLE IF NOT EXISTS users (
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

  await connectionPool.query(`
    CREATE TABLE IF NOT EXISTS friend_requests (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      requester_id BIGINT UNSIGNED NOT NULL,
      addressee_id BIGINT UNSIGNED NOT NULL,
      status ENUM('pending', 'accepted', 'rejected', 'cancelled') NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      responded_at TIMESTAMP NULL DEFAULT NULL,
      PRIMARY KEY (id),
      KEY idx_friend_requests_requester (requester_id, status),
      KEY idx_friend_requests_addressee (addressee_id, status),
      KEY idx_friend_requests_pair (requester_id, addressee_id, status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await connectionPool.query(`
    CREATE TABLE IF NOT EXISTS sticker_counts (
      user_id BIGINT UNSIGNED NOT NULL,
      album_id VARCHAR(64) NOT NULL,
      sticker_key VARCHAR(80) NOT NULL,
      count TINYINT UNSIGNED NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, album_id, sticker_key),
      CONSTRAINT chk_sticker_count_range CHECK (count BETWEEN 0 AND 99)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await migrateStickerCountsTable(connectionPool);
}

async function migrateStickerCountsTable(connectionPool) {
  const [columns] = await connectionPool.query(
    `SELECT COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'sticker_counts'`,
    [databaseName],
  );
  const columnNames = new Set(columns.map((row) => row.COLUMN_NAME));

  if (!columnNames.has("user_id")) {
    await connectionPool.query(`
      ALTER TABLE sticker_counts
      ADD COLUMN user_id BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER album_id
    `);
  }

  const [primaryKeyRows] = await connectionPool.query(
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
    await connectionPool.query(`
      ALTER TABLE sticker_counts
      ADD PRIMARY KEY (user_id, album_id, sticker_key)
    `);
  } else if (primaryKey !== "user_id,album_id,sticker_key") {
    await connectionPool.query(`
      ALTER TABLE sticker_counts
      DROP PRIMARY KEY,
      ADD PRIMARY KEY (user_id, album_id, sticker_key)
    `);
  }
}

function getPool() {
  if (!pool) {
    const error = new Error("La base de datos no esta inicializada");
    error.status = 503;
    throw error;
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

function mapPublicUser(row) {
  if (!row) return null;

  return {
    id: Number(row.id),
    email: row.email,
    name: row.name,
  };
}

function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function mapFriendRequest(row, currentUserId) {
  if (!row) return null;

  const requester = mapPublicUser({
    id: row.requester_id,
    email: row.requester_email,
    name: row.requester_name,
  });
  const addressee = mapPublicUser({
    id: row.addressee_id,
    email: row.addressee_email,
    name: row.addressee_name,
  });

  return {
    id: Number(row.id),
    status: row.status,
    direction: Number(row.requester_id) === Number(currentUserId) ? "outgoing" : "incoming",
    requester,
    addressee,
    friend: Number(row.requester_id) === Number(currentUserId) ? addressee : requester,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    respondedAt: row.responded_at,
  };
}

function getStickerCountryKey(stickerKey) {
  const match = String(stickerKey).match(/^(.+)-[0-9]{1,2}$/);
  return match ? match[1] : stickerKey;
}

function getCountryLabel(countryKey) {
  return String(countryKey)
    .split("-")
    .filter(Boolean)
    .join(" ");
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

async function searchUsers(currentUserId, query, limit = 10) {
  const safeUserId = normalizeUserId(currentUserId);
  const safeQuery = String(query || "").trim().toLowerCase();
  const safeLimit = Math.max(1, Math.min(25, Number(limit) || 10));

  if (safeQuery.length < 2) {
    return [];
  }

  const likeQuery = `%${safeQuery}%`;
  const [rows] = await getPool().query(
    `SELECT
       u.id,
       u.email,
       u.name,
       fr.id AS request_id,
       fr.requester_id,
       fr.addressee_id,
       fr.status
     FROM users u
     LEFT JOIN friend_requests fr
       ON (
         (fr.requester_id = ? AND fr.addressee_id = u.id)
         OR (fr.requester_id = u.id AND fr.addressee_id = ?)
       )
       AND fr.status IN ('pending', 'accepted')
     WHERE u.id <> ?
       AND (LOWER(u.email) LIKE ? OR LOWER(COALESCE(u.name, '')) LIKE ?)
     ORDER BY u.name IS NULL, u.name, u.email
     LIMIT ?`,
    [safeUserId, safeUserId, safeUserId, likeQuery, likeQuery, safeLimit],
  );

  return rows.map((row) => {
    let friendshipStatus = "none";
    let requestId = null;

    if (row.request_id) {
      requestId = Number(row.request_id);

      if (row.status === "accepted") {
        friendshipStatus = "friends";
      } else if (Number(row.requester_id) === safeUserId) {
        friendshipStatus = "pending_outgoing";
      } else {
        friendshipStatus = "pending_incoming";
      }
    }

    return {
      user: mapPublicUser(row),
      friendshipStatus,
      requestId,
    };
  });
}

async function getActiveFriendRequest(userAId, userBId) {
  const [rows] = await getPool().query(
    `SELECT
       fr.id,
       fr.requester_id,
       fr.addressee_id,
       fr.status,
       fr.created_at,
       fr.updated_at,
       fr.responded_at,
       requester.email AS requester_email,
       requester.name AS requester_name,
       addressee.email AS addressee_email,
       addressee.name AS addressee_name
     FROM friend_requests fr
     JOIN users requester ON requester.id = fr.requester_id
     JOIN users addressee ON addressee.id = fr.addressee_id
     WHERE (
       (fr.requester_id = ? AND fr.addressee_id = ?)
       OR (fr.requester_id = ? AND fr.addressee_id = ?)
     )
       AND fr.status IN ('pending', 'accepted')
     ORDER BY FIELD(fr.status, 'accepted', 'pending'), fr.id DESC
     LIMIT 1`,
    [userAId, userBId, userBId, userAId],
  );

  return rows[0] || null;
}

async function sendFriendRequest(requesterId, addresseeId) {
  const safeRequesterId = normalizeUserId(requesterId);
  const safeAddresseeId = normalizeUserId(addresseeId);

  if (safeRequesterId === safeAddresseeId) {
    throw createHttpError(400, "No puedes agregarte a ti mismo");
  }

  const addressee = await findUserById(safeAddresseeId);
  if (!addressee) {
    throw createHttpError(404, "Usuario no encontrado");
  }

  const activeRequest = await getActiveFriendRequest(safeRequesterId, safeAddresseeId);
  if (activeRequest?.status === "accepted") {
    throw createHttpError(409, "Ya son amigos");
  }

  if (activeRequest?.status === "pending") {
    const isOutgoing = Number(activeRequest.requester_id) === safeRequesterId;
    throw createHttpError(
      409,
      isOutgoing ? "Ya enviaste una solicitud a este usuario" : "Ya tienes una solicitud pendiente de este usuario",
    );
  }

  const [result] = await getPool().query(
    "INSERT INTO friend_requests (requester_id, addressee_id, status) VALUES (?, ?, 'pending')",
    [safeRequesterId, safeAddresseeId],
  );

  return getFriendRequestById(result.insertId, safeRequesterId);
}

async function getFriendRequestById(requestId, currentUserId) {
  const [rows] = await getPool().query(
    `SELECT
       fr.id,
       fr.requester_id,
       fr.addressee_id,
       fr.status,
       fr.created_at,
       fr.updated_at,
       fr.responded_at,
       requester.email AS requester_email,
       requester.name AS requester_name,
       addressee.email AS addressee_email,
       addressee.name AS addressee_name
     FROM friend_requests fr
     JOIN users requester ON requester.id = fr.requester_id
     JOIN users addressee ON addressee.id = fr.addressee_id
     WHERE fr.id = ?
     LIMIT 1`,
    [Number(requestId)],
  );

  return mapFriendRequest(rows[0], currentUserId);
}

async function listFriendRequests(userId) {
  const safeUserId = normalizeUserId(userId);
  const [rows] = await getPool().query(
    `SELECT
       fr.id,
       fr.requester_id,
       fr.addressee_id,
       fr.status,
       fr.created_at,
       fr.updated_at,
       fr.responded_at,
       requester.email AS requester_email,
       requester.name AS requester_name,
       addressee.email AS addressee_email,
       addressee.name AS addressee_name
     FROM friend_requests fr
     JOIN users requester ON requester.id = fr.requester_id
     JOIN users addressee ON addressee.id = fr.addressee_id
     WHERE fr.status = 'pending'
       AND (fr.requester_id = ? OR fr.addressee_id = ?)
     ORDER BY fr.created_at DESC`,
    [safeUserId, safeUserId],
  );

  return rows.reduce(
    (groups, row) => {
      const request = mapFriendRequest(row, safeUserId);
      groups[request.direction].push(request);
      return groups;
    },
    { incoming: [], outgoing: [] },
  );
}

async function respondToFriendRequest(userId, requestId, action) {
  const safeUserId = normalizeUserId(userId);
  const safeRequestId = Number(requestId);
  const status = action === "accept" ? "accepted" : action === "reject" ? "rejected" : null;

  if (!Number.isSafeInteger(safeRequestId) || safeRequestId <= 0 || !status) {
    throw createHttpError(400, "Solicitud invalida");
  }

  const [result] = await getPool().query(
    `UPDATE friend_requests
     SET status = ?, responded_at = CURRENT_TIMESTAMP
     WHERE id = ? AND addressee_id = ? AND status = 'pending'`,
    [status, safeRequestId, safeUserId],
  );

  if (result.affectedRows === 0) {
    throw createHttpError(404, "Solicitud pendiente no encontrada");
  }

  return getFriendRequestById(safeRequestId, safeUserId);
}

async function cancelFriendRequest(userId, requestId) {
  const safeUserId = normalizeUserId(userId);
  const safeRequestId = Number(requestId);

  if (!Number.isSafeInteger(safeRequestId) || safeRequestId <= 0) {
    throw createHttpError(400, "Solicitud invalida");
  }

  const [result] = await getPool().query(
    `UPDATE friend_requests
     SET status = 'cancelled', responded_at = CURRENT_TIMESTAMP
     WHERE id = ? AND requester_id = ? AND status = 'pending'`,
    [safeRequestId, safeUserId],
  );

  if (result.affectedRows === 0) {
    throw createHttpError(404, "Solicitud pendiente no encontrada");
  }
}

async function listFriends(userId) {
  const safeUserId = normalizeUserId(userId);
  const [rows] = await getPool().query(
    `SELECT
       fr.id AS request_id,
       fr.updated_at AS friends_since,
       u.id,
       u.email,
       u.name
     FROM friend_requests fr
     JOIN users u
       ON u.id = CASE
         WHEN fr.requester_id = ? THEN fr.addressee_id
         ELSE fr.requester_id
       END
     WHERE fr.status = 'accepted'
       AND (fr.requester_id = ? OR fr.addressee_id = ?)
     ORDER BY u.name IS NULL, u.name, u.email`,
    [safeUserId, safeUserId, safeUserId],
  );

  return rows.map((row) => ({
    requestId: Number(row.request_id),
    friendsSince: row.friends_since,
    user: mapPublicUser(row),
  }));
}

async function removeFriend(userId, friendId) {
  const safeUserId = normalizeUserId(userId);
  const safeFriendId = normalizeUserId(friendId);

  const [result] = await getPool().query(
    `DELETE FROM friend_requests
     WHERE status = 'accepted'
       AND (
         (requester_id = ? AND addressee_id = ?)
         OR (requester_id = ? AND addressee_id = ?)
       )`,
    [safeUserId, safeFriendId, safeFriendId, safeUserId],
  );

  if (result.affectedRows === 0) {
    throw createHttpError(404, "Amigo no encontrado");
  }
}

async function getAcceptedFriends(userId) {
  return listFriends(userId);
}

async function getFriendCounts(friendIds) {
  if (friendIds.length === 0) return [];

  const [rows] = await getPool().query(
    `SELECT user_id, sticker_key, count
     FROM sticker_counts
     WHERE album_id = ? AND user_id IN (?)`,
    [albumId, friendIds],
  );

  return rows.map((row) => ({
    userId: Number(row.user_id),
    stickerKey: row.sticker_key,
    count: Number(row.count),
  }));
}

async function getExchangeSummary(userId) {
  const safeUserId = normalizeUserId(userId);
  const [myCounts, friends] = await Promise.all([getCounts(safeUserId), getAcceptedFriends(safeUserId)]);
  const friendIds = friends.map((friend) => friend.user.id);
  const friendById = new Map(friends.map((friend) => [friend.user.id, friend.user]));
  const friendRows = await getFriendCounts(friendIds);
  const friendCountsByUser = new Map();
  const missingForMe = new Map();
  const myDuplicatesNeededByFriends = new Map();

  for (const friend of friends) {
    friendCountsByUser.set(friend.user.id, new Map());
  }

  for (const row of friendRows) {
    friendCountsByUser.get(row.userId)?.set(row.stickerKey, row.count);

    if ((myCounts[row.stickerKey] || 0) === 0 && row.count > 1) {
      if (!missingForMe.has(row.stickerKey)) {
        missingForMe.set(row.stickerKey, {
          stickerKey: row.stickerKey,
          countryKey: getStickerCountryKey(row.stickerKey),
          friends: [],
        });
      }

      missingForMe.get(row.stickerKey).friends.push({
        user: friendById.get(row.userId),
        count: row.count,
        available: row.count - 1,
      });
    }
  }

  for (const [stickerKey, count] of Object.entries(myCounts)) {
    if (count <= 1) continue;

    const friendsWhoNeedIt = friends
      .filter((friend) => (friendCountsByUser.get(friend.user.id)?.get(stickerKey) || 0) === 0)
      .map((friend) => friend.user);

    if (friendsWhoNeedIt.length > 0) {
      myDuplicatesNeededByFriends.set(stickerKey, {
        stickerKey,
        countryKey: getStickerCountryKey(stickerKey),
        count,
        available: count - 1,
        friends: friendsWhoNeedIt,
      });
    }
  }

  return {
    albumId,
    friendsCount: friends.length,
    missingForMe: Array.from(missingForMe.values()).sort((a, b) =>
      a.stickerKey.localeCompare(b.stickerKey),
    ),
    myDuplicatesNeededByFriends: Array.from(myDuplicatesNeededByFriends.values()).sort((a, b) =>
      a.stickerKey.localeCompare(b.stickerKey),
    ),
  };
}

async function getCountrySummaries(userId, query) {
  const safeUserId = normalizeUserId(userId);
  const [myCounts, friends] = await Promise.all([getCounts(safeUserId), getAcceptedFriends(safeUserId)]);
  const friendIds = friends.map((friend) => friend.user.id);
  const friendRows = await getFriendCounts(friendIds);
  const summaries = new Map();
  const safeQuery = String(query || "").trim().toLowerCase();

  function ensureSummary(countryKey) {
    if (!summaries.has(countryKey)) {
      summaries.set(countryKey, {
        countryKey,
        label: getCountryLabel(countryKey),
        ownedStickers: 0,
        duplicateStickers: 0,
        duplicateCopies: 0,
        friendDuplicateStickers: 0,
      });
    }

    return summaries.get(countryKey);
  }

  for (const [stickerKey, count] of Object.entries(myCounts)) {
    const countryKey = getStickerCountryKey(stickerKey);
    const summary = ensureSummary(countryKey);
    summary.ownedStickers += 1;

    if (count > 1) {
      summary.duplicateStickers += 1;
      summary.duplicateCopies += count - 1;
    }
  }

  const friendDuplicateStickerKeys = new Set();
  for (const row of friendRows) {
    if (row.count <= 1 || (myCounts[row.stickerKey] || 0) > 0) continue;
    friendDuplicateStickerKeys.add(row.stickerKey);
  }

  for (const stickerKey of friendDuplicateStickerKeys) {
    const countryKey = getStickerCountryKey(stickerKey);
    ensureSummary(countryKey).friendDuplicateStickers += 1;
  }

  return Array.from(summaries.values())
    .filter((summary) => {
      if (!safeQuery) return true;
      return (
        summary.countryKey.toLowerCase().includes(safeQuery) ||
        summary.label.toLowerCase().includes(safeQuery)
      );
    })
    .sort((a, b) => a.countryKey.localeCompare(b.countryKey));
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
  cancelFriendRequest,
  createUser,
  databaseName,
  ensureDatabase,
  findUserByEmail,
  findUserById,
  getCountrySummaries,
  getExchangeSummary,
  pingDatabase,
  listFriendRequests,
  listFriends,
  getCounts,
  adjustSticker,
  removeFriend,
  respondToFriendRequest,
  searchUsers,
  sendFriendRequest,
  setStickerCount,
  replaceCounts,
  resetAlbum,
};
