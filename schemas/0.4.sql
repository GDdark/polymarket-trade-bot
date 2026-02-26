CREATE TABLE `trader_profiles`
(
    `id`                    BIGINT           NOT NULL AUTO_INCREMENT,
    `address`               VARCHAR(42)      NOT NULL,
    `event_id`              VARCHAR(64)      NOT NULL,
    `window_start_ts`       BIGINT UNSIGNED  NOT NULL,
    `window_end_ts`         BIGINT UNSIGNED  NOT NULL,
    `sample_size`           INT              NOT NULL DEFAULT 0,
    `style`                 VARCHAR(32)      NOT NULL,
    `ev`                    DOUBLE           NOT NULL DEFAULT 0,
    `roi`                   DOUBLE           NOT NULL DEFAULT 0,
    `first_entry_win_rate`  DOUBLE           NOT NULL DEFAULT 0,
    `avg_dci`               DOUBLE           NOT NULL DEFAULT 0,
    `avg_entry_price`       DOUBLE           NOT NULL DEFAULT 0,
    `follow_suitability`    VARCHAR(32)      NOT NULL,
    `score`                 INT              NOT NULL DEFAULT 0,
    `stats_json`            JSON             NOT NULL,
    `created_at`            DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`            DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`), 
    UNIQUE INDEX `uniq_event_address` (`event_id`, `address`),
    INDEX `idx_event_follow_suitability` (`event_id`, `follow_suitability`)
) ENGINE = InnoDB DEFAULT CHARACTER SET = utf8mb4;

CREATE TABLE `simulation_trades`
(
    `id`                    BIGINT           NOT NULL AUTO_INCREMENT,
    `condition_id`          VARCHAR(66)      NOT NULL,
    `follow_address`        VARCHAR(42)      NOT NULL,
    `token_id_index`        TINYINT          NOT NULL,
    `amount`                DOUBLE           NOT NULL,
    `amount_usdc`           DOUBLE           NOT NULL,
    `price`                 DOUBLE           NOT NULL,
    `is_win`                TINYINT          NULL,
    `created_at`            DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`            DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`), 
    INDEX `uniq_condition_id` (`condition_id`)
) ENGINE = InnoDB DEFAULT CHARACTER SET = utf8mb4;
