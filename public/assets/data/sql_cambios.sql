ALTER TABLE orders
MODIFY process_status ENUM(
  'recibido',
  'surtido',
  'en_corte',
  'listo_para_entregar',
  'entregado',
  'revision',
  'cancelado',
  'en_proceso',
  'en_preparacion'
) NOT NULL DEFAULT 'recibido';

UPDATE orders
SET process_status = 'recibido'
WHERE process_status = 'en_proceso';

UPDATE orders
SET process_status = 'en_corte'
WHERE process_status = 'en_preparacion';

ALTER TABLE orders
MODIFY process_status ENUM(
  'recibido',
  'surtido',
  'en_corte',
  'listo_para_entregar',
  'entregado',
  'revision',
  'cancelado'
) NOT NULL DEFAULT 'recibido';