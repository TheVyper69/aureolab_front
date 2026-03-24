ALTER TABLE `orders`
  MODIFY COLUMN `process_status`
    ENUM('en_preparacion','en_proceso','listo_para_entregar','entregado','revision','cancelado')
    NOT NULL DEFAULT 'en_preparacion';
ALTER TABLE `order_status_logs`
  MODIFY COLUMN `from_process_status`
    ENUM('en_preparacion','en_proceso','listo_para_entregar','entregado','revision','cancelado') NULL,
  MODIFY COLUMN `to_process_status`
    ENUM('en_preparacion','en_proceso','listo_para_entregar','entregado','revision','cancelado') NULL;
CREATE TABLE IF NOT EXISTS `order_item_treatments` (
  `id` BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
  `order_item_id` BIGINT(20) UNSIGNED NOT NULL,
  `treatment_id` BIGINT(20) UNSIGNED NOT NULL,
  `price_delta` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `notes` VARCHAR(255) DEFAULT NULL,
  `created_at` TIMESTAMP NULL DEFAULT NULL,
  `updated_at` TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_order_item_treat` (`order_item_id`, `treatment_id`),
  KEY `idx_oit_treatment` (`treatment_id`),
  CONSTRAINT `fk_oit_order_item`
    FOREIGN KEY (`order_item_id`) REFERENCES `order_items` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_oit_treatment`
    FOREIGN KEY (`treatment_id`) REFERENCES `treatments` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `products`
  DROP FOREIGN KEY `fk_products_treatment`;

ALTER TABLE `products`
  DROP COLUMN `treatment_id`;
  
ALTER TABLE orders
  MODIFY process_status ENUM(
    'en_preparacion',
    'en_proceso',
    'listo_para_entregar',
    'entregado',
    'revision',
    'cancelado'
  ) NOT NULL DEFAULT 'en_preparacion';
  
CREATE TABLE IF NOT EXISTS order_item_treatments (
  id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
  order_item_id BIGINT(20) UNSIGNED NOT NULL,
  treatment_id BIGINT(20) UNSIGNED NOT NULL,
  created_at TIMESTAMP NULL DEFAULT NULL,
  updated_at TIMESTAMP NULL DEFAULT NULL,
  deleted_at TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_order_item_treatment (order_item_id, treatment_id),
  KEY idx_oit_order_item (order_item_id),
  KEY idx_oit_treatment (treatment_id),
  CONSTRAINT fk_oit_order_item
    FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE CASCADE,
  CONSTRAINT fk_oit_treatment
    FOREIGN KEY (treatment_id) REFERENCES treatments(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Lo hice en lap will y tice

ALTER TABLE inventory_movements
MODIFY COLUMN movement_type ENUM('in','out','adjustment','reserve','unreserve') NOT NULL;

ALTER TABLE products
ADD COLUMN image_path VARCHAR(255) NULL AFTER image_mime;

ALTER TABLE order_items ADD INDEX idx_product (product_id);

ALTER TABLE orders
ADD COLUMN paid_at DATETIME NULL AFTER payment_status;



ALTER TABLE inventory_movements
MODIFY COLUMN movement_type ENUM('in','out','reserve','unreserve') NOT NULL;

ALTER TABLE inventory_movements
MODIFY COLUMN reference_type ENUM('manual','order','order_cancel') NOT NULL;

-- se hizo en lap costa azul

SELECT id, sku, name, sphere, cylinder, axis
FROM products
WHERE
    cylinder = 0
    OR (axis IS NOT NULL AND cylinder IS NULL)
    OR (axis IS NOT NULL AND cylinder >= 0)
    OR (axis < 0 OR axis > 180);

SELECT id, sku, name, sphere, cylinder, axis
FROM products
WHERE
    cylinder = 0
    OR (axis IS NOT NULL AND cylinder IS NULL)
    OR (axis IS NOT NULL AND cylinder >= 0)
    OR (axis < 0 OR axis > 180);


ALTER TABLE products
ADD COLUMN axis INT NULL AFTER cylinder;

UPDATE products
SET axis = NULL
WHERE axis IS NOT NULL
  AND (cylinder IS NULL OR cylinder >= 0);

  UPDATE products
SET cylinder = NULL
WHERE cylinder = 0;

UPDATE products
SET axis = NULL
WHERE axis IS NOT NULL
  AND (axis < 0 OR axis > 180);

  SELECT id, sku, name, sphere, cylinder, axis
FROM products
WHERE
    cylinder = 0
    OR (axis IS NOT NULL AND cylinder IS NULL)
    OR (axis IS NOT NULL AND cylinder >= 0)
    OR (axis < 0 OR axis > 180);

    ALTER TABLE products
ADD CONSTRAINT chk_products_axis_range
CHECK (axis IS NULL OR (axis >= 0 AND axis <= 180));

ALTER TABLE products
ADD CONSTRAINT chk_products_cylinder_negative
CHECK (cylinder IS NULL OR cylinder < 0);

ALTER TABLE products
ADD CONSTRAINT chk_products_axis_cylinder_pair
CHECK (
  (axis IS NULL AND (cylinder IS NULL OR cylinder < 0))
  OR
  (axis IS NOT NULL AND cylinder IS NOT NULL AND cylinder < 0)
);