CREATE DATABASE IF NOT EXISTS figuritas_2026
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE figuritas_2026;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email VARCHAR(254) NOT NULL,
  name VARCHAR(80) NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sticker_counts (
  user_id BIGINT UNSIGNED NOT NULL,
  album_id VARCHAR(64) NOT NULL,
  sticker_key VARCHAR(80) NOT NULL,
  count TINYINT UNSIGNED NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, album_id, sticker_key),
  CONSTRAINT chk_sticker_count_range CHECK (count BETWEEN 0 AND 99)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS exchanges (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  friend_id BIGINT UNSIGNED NOT NULL,
  awaiting_user_id BIGINT UNSIGNED NOT NULL,
  last_offered_by_user_id BIGINT UNSIGNED NOT NULL,
  album_id VARCHAR(64) NOT NULL,
  status ENUM('pending', 'confirmed', 'rejected', 'cancelled') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  responded_at TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (id),
  KEY idx_exchanges_user (user_id, album_id, created_at),
  KEY idx_exchanges_user_status (user_id, album_id, status, created_at),
  KEY idx_exchanges_friend_status (friend_id, album_id, status, created_at),
  KEY idx_exchanges_awaiting_status (awaiting_user_id, album_id, status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS exchange_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  exchange_id BIGINT UNSIGNED NOT NULL,
  direction ENUM('give', 'receive') NOT NULL,
  sticker_key VARCHAR(80) NOT NULL,
  quantity TINYINT UNSIGNED NOT NULL,
  friend_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_exchange_items_exchange (exchange_id),
  KEY idx_exchange_items_friend (friend_id),
  CONSTRAINT chk_exchange_item_quantity CHECK (quantity BETWEEN 1 AND 99)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
