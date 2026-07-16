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


ALTER TABLE products
ADD COLUMN is_custom TINYINT(1) NOT NULL DEFAULT 0 AFTER active,
ADD COLUMN show_in_pos TINYINT(1) NOT NULL DEFAULT 1 AFTER is_custom;

CREATE TABLE order_item_custom_bisel (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    order_item_id BIGINT UNSIGNED NOT NULL,
    reflection VARCHAR(120) NULL,
    lens_type_id BIGINT UNSIGNED NULL,
    frame_height DECIMAL(10,2) NULL,
    blank_height DECIMAL(10,2) NULL,
    observations TEXT NULL,
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_order_item_custom_bisel_order_item
        FOREIGN KEY (order_item_id) REFERENCES order_items(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_order_item_custom_bisel_lens_type
        FOREIGN KEY (lens_type_id) REFERENCES lens_types(id)
        ON DELETE SET NULL
);



ALTER TABLE categories
ADD COLUMN is_mica TINYINT(1) NOT NULL DEFAULT 0 AFTER description,
ADD COLUMN buy_price DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER is_mica,
ADD COLUMN sale_price DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER buy_price,
ADD COLUMN last_price_update_at TIMESTAMP NULL DEFAULT NULL AFTER sale_price;

UPDATE categories
SET is_mica = 1
WHERE code = 'MICAS';

ALTER TABLE products
ADD INDEX idx_products_category_sphere_cylinder (category_id, sphere, cylinder);

ALTER TABLE categories
ADD INDEX idx_categories_is_mica (is_mica);

ALTER TABLE products
DROP CONSTRAINT chk_products_cylinder_negative;

ALTER TABLE products
ADD CONSTRAINT chk_products_cylinder_non_positive
CHECK (cylinder IS NULL OR cylinder <= 0);
ALTER TABLE products
DROP CONSTRAINT chk_products_axis_cylinder_pair;

ALTER TABLE products
DROP CONSTRAINT chk_products_axis_range;

ALTER TABLE products
ADD CONSTRAINT chk_products_axis_range
CHECK (axis IS NULL OR (axis >= 1 AND axis <= 180));

/* ============================================================
   AUROLAB - Imagen por categoría
   ============================================================ */

ALTER TABLE categories
ADD COLUMN IF NOT EXISTS image_filename VARCHAR(190) NULL AFTER last_price_update_at,
ADD COLUMN IF NOT EXISTS image_mime VARCHAR(80) NULL AFTER image_filename,
ADD COLUMN IF NOT EXISTS image_path VARCHAR(255) NULL AFTER image_mime;


/* ============================================================
   Revisión rápida
   ============================================================ */

DESCRIBE categories;


/* ============================================================
   Confirmar columnas de imagen en categorías
   ============================================================ */

SELECT 
    id,
    code,
    name,
    is_mica,
    buy_price,
    sale_price,
    image_filename,
    image_mime,
    image_path
FROM categories
ORDER BY name;

-- se realizo en lap wll
ALTER TABLE categories
ADD COLUMN IF NOT EXISTS image_blob LONGBLOB NULL AFTER image_mime;

DESCRIBE categories;






-- SET FOREIGN_KEY_CHECKS = 0;

-- -- Órdenes y sus detalles
-- DELETE FROM order_item_custom_bisel;
-- DELETE FROM order_item_treatments;
-- DELETE FROM order_status_logs;
-- DELETE FROM order_items;
-- DELETE FROM orders;

-- -- Ventas
-- DELETE FROM sale_items;
-- DELETE FROM sales;

-- -- Inventario y productos
-- DELETE FROM inventory_movements;
-- DELETE FROM inventory_variants;
-- DELETE FROM inventory;
-- DELETE FROM product_treatments;
-- DELETE FROM product_variants;
-- DELETE FROM products;

-- -- Relaciones de ópticas con métodos de pago
-- DELETE FROM optica_payment_methods;

-- -- Ópticas y clientes
-- DELETE FROM opticas;
-- DELETE FROM customers;

-- -- Catálogos
-- DELETE FROM boxes;
-- DELETE FROM categories;
-- DELETE FROM lens_materials;
-- DELETE FROM lens_treatments;
-- DELETE FROM lens_types;
-- DELETE FROM materials;
-- DELETE FROM suppliers;
-- DELETE FROM treatments;

-- -- Tokens y sesiones
-- DELETE FROM personal_access_tokens;

-- -- Conservar únicamente al administrador
-- DELETE FROM users
-- WHERE id <> 1;

-- -- Reiniciar contadores AUTO_INCREMENT
-- ALTER TABLE order_item_custom_bisel AUTO_INCREMENT = 1;
-- ALTER TABLE order_item_treatments AUTO_INCREMENT = 1;
-- ALTER TABLE order_status_logs AUTO_INCREMENT = 1;
-- ALTER TABLE order_items AUTO_INCREMENT = 1;
-- ALTER TABLE orders AUTO_INCREMENT = 1;

-- ALTER TABLE sale_items AUTO_INCREMENT = 1;
-- ALTER TABLE sales AUTO_INCREMENT = 1;

-- ALTER TABLE inventory_movements AUTO_INCREMENT = 1;
-- ALTER TABLE inventory_variants AUTO_INCREMENT = 1;
-- ALTER TABLE inventory AUTO_INCREMENT = 1;
-- ALTER TABLE product_treatments AUTO_INCREMENT = 1;
-- ALTER TABLE product_variants AUTO_INCREMENT = 1;
-- ALTER TABLE products AUTO_INCREMENT = 1;

-- ALTER TABLE optica_payment_methods AUTO_INCREMENT = 1;
-- ALTER TABLE opticas AUTO_INCREMENT = 1;
-- ALTER TABLE customers AUTO_INCREMENT = 1;

-- ALTER TABLE boxes AUTO_INCREMENT = 1;
-- ALTER TABLE categories AUTO_INCREMENT = 1;
-- ALTER TABLE lens_materials AUTO_INCREMENT = 1;
-- ALTER TABLE lens_treatments AUTO_INCREMENT = 1;
-- ALTER TABLE lens_types AUTO_INCREMENT = 1;
-- ALTER TABLE materials AUTO_INCREMENT = 1;
-- ALTER TABLE suppliers AUTO_INCREMENT = 1;
-- ALTER TABLE treatments AUTO_INCREMENT = 1;

-- ALTER TABLE personal_access_tokens AUTO_INCREMENT = 1;

-- -- Mantener el siguiente usuario después del administrador en ID 2
-- ALTER TABLE users AUTO_INCREMENT = 2;

-- SET FOREIGN_KEY_CHECKS = 1;