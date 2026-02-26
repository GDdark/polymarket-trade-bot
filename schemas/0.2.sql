USE `prediction_market`;

ALTER TABLE `conditions` ADD COLUMN `closed_at` DATETIME DEFAULT NULL AFTER `closed`;

ALTER TABLE `conditions` MODIFY COLUMN `slug` VARCHAR(256) NOT NULL;