CREATE SCHEMA `prediction_market` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;

CREATE TABLE `traces`
(
    `id`           BIGINT          NOT NULL AUTO_INCREMENT,
    `chain_id`     INT             NOT NULL,
    `type`         VARCHAR(32)     NOT NULL,
    `start_block`  BIGINT UNSIGNED NOT NULL,
    `traced_block` BIGINT UNSIGNED NOT NULL,
    `created_at`   DATETIME        NOT NULL,
    `updated_at`   DATETIME        NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE INDEX `uniq_chain_id_type` (`chain_id`, `type`)
) ENGINE = InnoDB DEFAULT CHARACTER SET = utf8mb4;

CREATE TABLE `conditions`
(
    `id`              BIGINT           NOT NULL AUTO_INCREMENT,
    `condition_id`    VARCHAR(66)      NOT NULL,
    `token0_id`       VARCHAR(66)      NOT NULL DEFAULT '',
    `token1_id`       VARCHAR(66)      NOT NULL DEFAULT '',
    `slug`            VARCHAR(128)     NOT NULL DEFAULT '',
    `closed`          TINYINT          NOT NULL DEFAULT 0,
    `closed_at`       DATETIME         DEFAULT NULL,
    `archived`        TINYINT          NOT NULL DEFAULT 0,
    `win_token_index` TINYINT          NOT NULL DEFAULT 2,
    `origin`          JSON             NOT NULL,
    `created_at`      DATETIME         NOT NULL,
    `updated_at`      DATETIME         NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE INDEX `uniq_condition_id` (`condition_id`),
    INDEX `idx_closed_archived` (`closed`, `archived`)
) ENGINE = InnoDB DEFAULT CHARACTER SET = utf8mb4;

CREATE TABLE `condition_tokens`
(
    `id`              BIGINT           NOT NULL AUTO_INCREMENT,
    `condition_id`    VARCHAR(66)      NOT NULL,
    `token_id`        VARCHAR(66)      NOT NULL,
    `closed`          TINYINT          NOT NULL DEFAULT 0,
    `created_at`      DATETIME         NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE INDEX `uniq_token_id` (`token_id`)
) ENGINE = InnoDB DEFAULT CHARACTER SET = utf8mb4;


--------------ClickHouse----------------

CREATE DATABASE IF NOT EXISTS prediction_market ENGINE = Atomic;

CREATE TABLE transfers_raw
(
  chain_id     UInt32,
  -- event_id = block_time(秒时间戳 10位) + block_number(保留9位) + log_index(保留6位)
  event_id     UInt128,
  block_time   DateTime64(3, 'UTC'),
  token        FixedString(66),
  `from`       FixedString(42),
  `to`         FixedString(42),
  amount       UInt64
)
ENGINE = ReplacingMergeTree()
PARTITION BY (chain_id, toYYYYMM(block_time))
ORDER BY (chain_id, event_id)

CREATE TABLE balance_deltas
(
  chain_id   UInt32,
  token      FixedString(66),
  address    FixedString(42),
  side       UInt8,                 -- 0 = from, 1 = to
  delta      Int64,
  event_id     UInt128,
  block_time   DateTime64(3, 'UTC')
)
ENGINE = ReplacingMergeTree()
PARTITION BY (chain_id, toYYYYMM(block_time))
ORDER BY (chain_id, address, event_id, side)

CREATE MATERIALIZED VIEW mv_transfers_to_balance_deltas
TO balance_deltas
AS
SELECT
  chain_id,
  token,
  tupleElement(x, 1) AS address,
  tupleElement(x, 2) AS side,
  tupleElement(x, 3) AS delta,
  event_id,
  block_time
FROM transfers_raw
ARRAY JOIN
[
  (`from`, toUInt8(0), -toInt64(amount)),
  (`to`,   toUInt8(1),  toInt64(amount))
] AS x

CREATE TABLE balances (
  chain_id UInt32,
  token FixedString(66),
  address FixedString(42),
  balance Int64,
) ENGINE = SummingMergeTree(balance)
ORDER BY (chain_id, token, address)
SETTINGS deduplicate_merge_projection_mode = 'rebuild'

CREATE MATERIALIZED VIEW mv_deltas_to_balances
TO balances
AS
SELECT
  chain_id,
  token,
  address,
  delta AS balance
FROM balance_deltas

CREATE TABLE trades
(
  chain_id      UInt32,
  token         FixedString(66),
  address       FixedString(42),
  side          UInt8,                 -- 0 = buy, 1 = sell
  amount        UInt64,
  amount_usdc   UInt64,
  fee           UInt64,
  event_id      UInt128, -- event_id = block_time(秒时间戳 10位) + block_number(保留9位) + log_index(保留6位) + side(保留1位)
  block_time    DateTime64(3, 'UTC')
)
ENGINE = ReplacingMergeTree()
ORDER BY (chain_id, token, event_id)