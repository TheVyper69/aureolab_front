import { api } from '../services/api.js';
import { ordersService } from '../services/ordersService.js';
import { money, formatDateTime } from '../utils/helpers.js';
import { authService } from '../services/authService.js';

const PM_ID_LABEL = {
  1: 'Efectivo',
  2: 'Transferencia',
  3: 'Tarjeta'
};

const PM_CODE_LABEL = {
  cash: 'Efectivo',
  transfer: 'Transferencia',
  card: 'Tarjeta'
};

const PAYMENT_METHOD_OPTIONS = [
  { id: 1, label: 'Efectivo' },
  { id: 2, label: 'Transferencia' },
  { id: 3, label: 'Tarjeta' }
];

const PAYMENT_LABEL = {
  pendiente: 'Pendiente',
  pagado: 'Pagado'
};

const PAYMENT_BADGE = {
  pendiente: 'text-bg-warning',
  pagado: 'text-bg-success'
};

const PROCESS_LABEL = {
  recibido: 'Recibido',
  surtido: 'Surtido',
  en_corte: 'En corte',
  listo_para_entregar: 'Listo para entregar',
  entregado: 'Entregado',
  revision: 'En revisión',
  cancelado: 'Cancelado',

  // Compatibilidad con pedidos viejos
  en_proceso: 'Recibido',
  en_preparacion: 'En corte'
};

const PROCESS_BADGE = {
  recibido: 'text-bg-info',
  surtido: 'text-bg-secondary',
  en_corte: 'text-bg-warning',
  listo_para_entregar: 'text-bg-primary',
  entregado: 'text-bg-success',
  revision: 'text-bg-danger',
  cancelado: 'text-bg-dark',

  // Compatibilidad con pedidos viejos
  en_proceso: 'text-bg-info',
  en_preparacion: 'text-bg-warning'
};

const PROCESS_FLOW = [
  'recibido',
  'surtido',
  'en_corte',
  'listo_para_entregar',
  'entregado'
];

function normalizeProcessStatusValue(value) {
  const v = String(value || '').trim();

  const map = {
    en_proceso: 'recibido',
    en_preparacion: 'en_corte'
  };

  return map[v] || v || 'recibido';
}

function safe(v) {
  return String(v ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function plain(v) {
  return String(v ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function buildProductMap(products) {
  const m = new Map();

  (products || []).forEach(row => {
    const p = row?.product ?? row;
    if (!p?.id) return;
    m.set(String(p.id), p);
  });

  return m;
}

async function updateOrderPatch(orderId, patch) {
  if (typeof ordersService?.update === 'function') return await ordersService.update(orderId, patch);
  if (typeof ordersService?.patch === 'function') return await ordersService.patch(orderId, patch);
  if (typeof ordersService?.updateStatus === 'function') return await ordersService.updateStatus(orderId, patch);
  return await api.patch(`/orders/${orderId}`, patch);
}

async function cancelOrder(orderId) {
  if (typeof ordersService?.cancel === 'function') return await ordersService.cancel(orderId);
  return await api.patch(`/orders/${orderId}/cancel`);
}

function pickFirst(...values) {
  for (const v of values) {
    if (v !== null && v !== undefined && String(v).trim() !== '') {
      return v;
    }
  }

  return null;
}

function normalizeCustomBisel(raw) {
  if (!raw || typeof raw !== 'object') return null;

  return {
    reflection: raw.reflection ?? raw.reflexion ?? null,
    lensTypeId: raw.lensTypeId ?? raw.lens_type_id ?? null,
    lensTypeCode: raw.lensTypeCode ?? raw.lens_type_code ?? null,
    lensTypeName: raw.lensTypeName ?? raw.lens_type_name ?? null,
    frameHeight: raw.frameHeight ?? raw.frame_height ?? null,
    blankHeight: raw.blankHeight ?? raw.blank_height ?? null,
    observations: raw.observations ?? null,
  };
}

function normalizeOrder(o) {
  if (!o) return o;

  const paymentStatus = o.paymentStatus ?? o.payment_status ?? 'pendiente';
  const processStatus = normalizeProcessStatusValue(o.processStatus ?? o.process_status ?? 'recibido');

  const date = o.date ?? o.created_at ?? o.createdAt ?? null;
  const paidAt = o.paidAt ?? o.paid_at ?? null;
  const opticaId = o.opticaId ?? o.optica_id ?? null;

  const paymentMethodId = Number(
    o.paymentMethodId ??
    o.payment_method_id ??
    o.paymentMethod ??
    o.payment_method ??
    0
  ) || null;

  const paymentMethod =
    o.paymentMethod ??
    o.payment_method ??
    o.payment_method_code ??
    o.payment_method_id ??
    paymentMethodId ??
    null;

  const subtotal = Number(o.subtotal ?? o.sub_total ?? 0);
  const total = Number(o.total ?? 0);

  const rawItems = o.items ?? o.order_items ?? [];
  const items = Array.isArray(rawItems)
    ? rawItems.map(it => {
        const prod = it.product ?? null;

        const productId = it.productId ?? it.product_id ?? prod?.id ?? null;
        const productSku = it.productSku ?? it.sku ?? prod?.sku ?? null;
        const productName = it.productName ?? it.name ?? prod?.name ?? null;

        return {
          id: it.id ?? null,
          productId,
          productSku,
          productName,
          qty: Number(it.qty ?? it.quantity ?? 0),
          price: Number(it.price ?? it.unit_price ?? it.unitPrice ?? 0),
          variantId: it.variantId ?? it.variant_id ?? null,
          axis: it.axis ?? null,
          itemNotes: it.itemNotes ?? it.item_notes ?? null,
          treatments: Array.isArray(it.treatments) ? it.treatments : [],
          product: prod || null,
          customBisel: normalizeCustomBisel(it.customBisel ?? it.custom_bisel ?? prod?.custom_bisel ?? null),
        };
      })
    : [];

  return {
    ...o,
    id: o.id,
    date,
    paidAt,
    opticaId,
    paymentMethod,
    paymentMethodId,
    paymentStatus,
    processStatus,
    subtotal,
    total,
    items,
    notes: o.notes ?? o.note ?? null
  };
}

function badgeHtml(type, value) {
  if (type === 'payment') {
    const v = value || 'pendiente';
    return `<span class="badge ${PAYMENT_BADGE[v] || 'text-bg-secondary'}">${safe(PAYMENT_LABEL[v] || v)}</span>`;
  }

  const v = normalizeProcessStatusValue(value || 'recibido');
  return `<span class="badge ${PROCESS_BADGE[v] || 'text-bg-secondary'}">${safe(PROCESS_LABEL[v] || v)}</span>`;
}

function initDataTable(selector) {
  if (!(window.$ && $.fn.dataTable)) return null;

  if ($.fn.DataTable.isDataTable(selector)) {
    $(selector).DataTable().destroy();
  }

  return $(selector).DataTable({
    pageLength: 10,
    order: [[1, 'desc']],
    language: {
      search: 'Buscar:',
      lengthMenu: 'Mostrar _MENU_',
      info: 'Mostrando _START_ a _END_ de _TOTAL_',
      paginate: { previous: 'Anterior', next: 'Siguiente' },
      zeroRecords: 'No hay registros'
    }
  });
}

async function loadOpticasIndex() {
  try {
    const { data } = await api.get('/opticas');
    const arr = Array.isArray(data) ? data : [];

    const byId = new Map(
      arr.map(o => [
        String(o.optica_id ?? o.id),
        {
          optica_id: o.optica_id ?? o.id,
          customer_id: o.customer_id ?? null,
          nombre: o.customer_name ?? o.nombre ?? o.name ?? 'Óptica',
          email: o.email ?? null,
          phone: o.phone ?? null,
          user_id: o.user_id ?? null
        }
      ])
    );

    return { list: arr, byId };
  } catch (e) {
    console.warn('[orders] /opticas falló:', e?.response?.status || e?.message);
    return { list: [], byId: new Map() };
  }
}

function unwrapPaginated(resp) {
  if (Array.isArray(resp)) return { rows: resp, meta: null };

  const root = resp?.data ?? resp;
  if (Array.isArray(root)) return { rows: root, meta: null };

  const rows = Array.isArray(root?.data) ? root.data : [];
  const meta = (root && typeof root === 'object') ? root : null;

  return { rows, meta };
}

async function fetchOrdersAll() {
  try {
    if (typeof ordersService?.list === 'function') {
      const maybe = await ordersService.list(1, 1000);
      const un = unwrapPaginated(maybe);
      return un.rows || [];
    }
  } catch (_e) {}

  const { data } = await api.get('/orders?per_page=1000');
  const un = unwrapPaginated(data);
  return un.rows || [];
}

function getAllowedProcessOptions(role, currentStatus) {
  const current = normalizeProcessStatusValue(currentStatus || 'recibido');

  if (current === 'cancelado') return ['cancelado'];

  if (role === 'employee') {
    if (current === 'revision') return ['revision'];

    const idx = PROCESS_FLOW.indexOf(current);

    if (idx === -1) return ['recibido'];

    return PROCESS_FLOW.slice(idx);
  }

  if (role === 'admin') {
    if (current === 'revision') return ['revision'];

    if (current === 'entregado') return ['entregado', 'revision'];

    const idx = PROCESS_FLOW.indexOf(current);

    if (idx === -1) return ['recibido'];

    return PROCESS_FLOW.slice(idx);
  }

  return [current];
}

function canOpticaCancel(procSt) {
  return normalizeProcessStatusValue(procSt) === 'recibido';
}

function canAdminCancel(procSt) {
  return normalizeProcessStatusValue(procSt) === 'revision';
}

function canAdminSendToRevision(procSt) {
  return normalizeProcessStatusValue(procSt) === 'entregado';
}

function modalTableWrap(innerHtml) {
  return `
    <div style="width:100%; overflow-x:auto; -webkit-overflow-scrolling:touch;">
      ${innerHtml}
    </div>
  `;
}

function mergeProductSources(primary = {}, secondary = {}, fallback = {}) {
  return {
    ...secondary,
    ...primary,
    id: pickFirst(primary?.id, secondary?.id, fallback?.productId),
    sku: pickFirst(primary?.sku, secondary?.sku, fallback?.productSku),
    name: pickFirst(primary?.name, secondary?.name, fallback?.productName),

    category_name: pickFirst(primary?.category_name, secondary?.category_name, primary?.category, secondary?.category),
    category_code: pickFirst(primary?.category_code, secondary?.category_code),
    category: pickFirst(primary?.category, secondary?.category),

    type: pickFirst(primary?.type, secondary?.type),
    brand: pickFirst(primary?.brand, secondary?.brand),
    model: pickFirst(primary?.model, secondary?.model),
    material: pickFirst(primary?.material, secondary?.material),
    size: pickFirst(primary?.size, secondary?.size),

    lens_type_name: pickFirst(primary?.lens_type_name, secondary?.lens_type_name),
    lens_type_code: pickFirst(primary?.lens_type_code, secondary?.lens_type_code),

    box_name: pickFirst(primary?.box_name, secondary?.box_name),
    box_code: pickFirst(primary?.box_code, secondary?.box_code),

    supplier_name: pickFirst(primary?.supplier_name, secondary?.supplier_name),

    material_name: pickFirst(primary?.material_name, secondary?.material_name),

    buy_price: pickFirst(primary?.buy_price, secondary?.buy_price, primary?.buyPrice, secondary?.buyPrice),
    sale_price: pickFirst(primary?.sale_price, secondary?.sale_price, primary?.salePrice, secondary?.salePrice),

    sphere: pickFirst(primary?.sphere, secondary?.sphere),
    cylinder: pickFirst(primary?.cylinder, secondary?.cylinder),
    axis: pickFirst(primary?.axis, secondary?.axis),

    description: pickFirst(primary?.description, secondary?.description),

    is_custom: pickFirst(primary?.is_custom, secondary?.is_custom, 0),
    show_in_pos: pickFirst(primary?.show_in_pos, secondary?.show_in_pos, 1),

    treatments: Array.isArray(primary?.treatments)
      ? primary.treatments
      : (Array.isArray(secondary?.treatments) ? secondary.treatments : []),

    custom_bisel: primary?.custom_bisel ?? secondary?.custom_bisel ?? null,
  };
}

function renderCustomBiselHtml(customBisel) {
  if (!customBisel) return '';

  return `
    <div class="mt-3">
      <div class="small text-muted">Biselado personalizado</div>
      <div class="border rounded p-2 mt-1">
        <div><b>Reflexión:</b> ${safe(customBisel.reflection || '—')}</div>
        <div><b>Tipo de lente:</b> ${safe(customBisel.lensTypeName || customBisel.lensTypeCode || '—')}</div>
        <div><b>Altura de armazón:</b> ${safe(customBisel.frameHeight ?? '—')}cm</div>
        <div><b>Altura de oblea:</b> ${safe(customBisel.blankHeight ?? '—')}cm</div>
        <div><b>Observaciones:</b> ${safe(customBisel.observations || '—')}</div>
      </div>
    </div>
  `;
}

function getPaymentMethodLabel(o) {
  const id = Number(
    o.paymentMethodId ??
    o.payment_method_id ??
    o.paymentMethod ??
    o.payment_method ??
    0
  );

  if (id) {
    return PM_ID_LABEL[id] || `ID ${id}`;
  }

  const key = String(o.paymentMethod || o.payment_method || '').toLowerCase();

  return PM_CODE_LABEL[key] || o.paymentMethod || o.payment_method || '—';
}

function formatTicketDate(value) {
  if (!value) return '—';

  try {
    return formatDateTime(value);
  } catch (_e) {
    return String(value);
  }
}

function printOrderTicket(order, opticaName, paymentMethodLabel) {
  const o = normalizeOrder(order);

  const items = Array.isArray(o.items) ? o.items : [];

  const itemRows = items.map(it => {
    const qty = Number(it.qty || 0);
    const unit = Number(it.price || 0);
    const line = qty * unit;

    const name = it.productName || it.product?.name || `Producto #${it.productId || '—'}`;
    const sku = it.productSku || it.product?.sku || it.productId || '—';

    const treatments = Array.isArray(it.treatments)
      ? it.treatments
      : [];

    const treatmentsText = treatments.length
      ? treatments.map(t => t?.name || t?.code || `#${t?.id ?? ''}`).filter(Boolean).join(', ')
      : '';

    const customBisel = normalizeCustomBisel(it.customBisel ?? it.custom_bisel ?? it.product?.custom_bisel ?? null);

    const axisText = it.axis !== null && it.axis !== undefined && String(it.axis).trim() !== ''
      ? `Eje: ${it.axis}`
      : '';

    const notesText = it.itemNotes
      ? `Notas: ${it.itemNotes}`
      : '';

    const customText = customBisel
      ? [
          customBisel.reflection ? `Ref: ${customBisel.reflection}` : '',
          customBisel.lensTypeName || customBisel.lensTypeCode ? `Lente: ${customBisel.lensTypeName || customBisel.lensTypeCode}` : '',
          customBisel.frameHeight ? `Alt. armazón: ${customBisel.frameHeight}cm` : '',
          customBisel.blankHeight ? `Alt. oblea: ${customBisel.blankHeight}cm` : '',
          customBisel.observations ? `Obs: ${customBisel.observations}` : '',
        ].filter(Boolean).join(' | ')
      : '';

    const details = [
      treatmentsText ? `Tratamientos: ${treatmentsText}` : '',
      axisText,
      customText,
      notesText
    ].filter(Boolean);

    return `
      <div class="ticket-item">
        <div class="item-main">
          <div class="item-name">${plain(name)}</div>
          <div class="item-sku">SKU: ${plain(sku)}</div>
        </div>

        ${details.length ? `
          <div class="item-details">
            ${details.map(d => `<div>${plain(d)}</div>`).join('')}
          </div>
        ` : ''}

        <div class="item-line">
          <span>${qty} x ${plain(money(unit))}</span>
          <span>${plain(money(line))}</span>
        </div>
      </div>
    `;
  }).join('');

  const paymentStatus = PAYMENT_LABEL[o.paymentStatus] || o.paymentStatus || '—';
  const processStatus = PROCESS_LABEL[o.processStatus] || o.processStatus || '—';

  const ticketHtml = `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>Ticket pedido #${plain(o.id)}</title>

        <style>
          * {
            box-sizing: border-box;
          }

          body {
            margin: 0;
            padding: 0;
            background: #fff;
            color: #000;
            font-family: Arial, Helvetica, sans-serif;
            font-size: 12px;
          }

          .ticket {
            width: 80mm;
            max-width: 80mm;
            padding: 8px;
            margin: 0 auto;
          }

          .center {
            text-align: center;
          }

          .ticket-logo {
            max-width: 48mm;
            max-height: 22mm;
            object-fit: contain;
            display: block;
            margin: 0 auto 4px auto;
          }

          .subtitle {
            font-size: 11px;
            margin-bottom: 6px;
          }

          .line {
            border-top: 1px dashed #000;
            margin: 8px 0;
          }

          .row {
            display: flex;
            justify-content: space-between;
            gap: 8px;
            margin: 2px 0;
          }

          .row span:first-child {
            text-align: left;
          }

          .row span:last-child {
            text-align: right;
            font-weight: 700;
          }

          .ticket-item {
            padding: 6px 0;
            border-bottom: 1px dashed #999;
          }

          .item-name {
            font-weight: 700;
            word-break: break-word;
          }

          .item-sku {
            font-size: 10px;
            color: #333;
            margin-top: 1px;
            word-break: break-word;
          }

          .item-details {
            font-size: 10px;
            color: #111;
            margin-top: 3px;
            word-break: break-word;
          }

          .item-line {
            display: flex;
            justify-content: space-between;
            gap: 8px;
            margin-top: 4px;
          }

          .item-line span:last-child {
            font-weight: 700;
          }

          .total {
            font-size: 15px;
            font-weight: 700;
          }

          .footer {
            margin-top: 10px;
            font-size: 10px;
            text-align: center;
          }

          @media print {
            @page {
              size: 80mm auto;
              margin: 0;
            }

            html,
            body {
              width: 80mm;
              margin: 0;
              padding: 0;
            }

            .ticket {
              width: 80mm;
              max-width: 80mm;
              margin: 0;
            }
          }
        </style>
      </head>

      <body>
        <div class="ticket">
          <div class="center">
            <img class="ticket-logo" src="assets/images/logo.png" alt="Logo">
            <div class="subtitle">Ticket de pedido</div>
          </div>

          <div class="line"></div>

          <div class="row">
            <span>Pedido:</span>
            <span>#${plain(o.id)}</span>
          </div>

          <div class="row">
            <span>Fecha:</span>
            <span>${plain(formatTicketDate(o.date))}</span>
          </div>

          <div class="row">
            <span>Óptica:</span>
            <span>${plain(opticaName || '—')}</span>
          </div>

          <div class="row">
            <span>Pago:</span>
            <span>${plain(paymentMethodLabel || '—')}</span>
          </div>

          <div class="row">
            <span>Estatus pago:</span>
            <span>${plain(paymentStatus)}</span>
          </div>

          <div class="row">
            <span>Proceso:</span>
            <span>${plain(processStatus)}</span>
          </div>

          ${o.notes ? `
            <div class="line"></div>
            <div><b>Notas:</b></div>
            <div>${plain(o.notes)}</div>
          ` : ''}

          <div class="line"></div>

          ${itemRows || '<div class="center">Sin productos</div>'}

          <div class="line"></div>

          <div class="row">
            <span>Subtotal:</span>
            <span>${plain(money(o.subtotal || o.total || 0))}</span>
          </div>

          <div class="row total">
            <span>Total:</span>
            <span>${plain(money(o.total || 0))}</span>
          </div>

          <div class="line"></div>

          <div class="footer">
            Gracias por su pedido.<br>
            Conserve este ticket para cualquier aclaración.
          </div>
        </div>

        <script>
          window.addEventListener('load', function () {
            setTimeout(function () {
              window.focus();
              window.print();
            }, 250);
          });
        </script>
      </body>
    </html>
  `;

  const printWindow = window.open('', '_blank', 'width=420,height=720');

  if (!printWindow) {
    Swal.fire(
      'Ventana bloqueada',
      'El navegador bloqueó la ventana de impresión. Permite ventanas emergentes para este sitio.',
      'warning'
    );
    return;
  }

  printWindow.document.open();
  printWindow.document.write(ticketHtml);
  printWindow.document.close();
}

function showOrderedProductDetail(product, fallback = {}) {
  if (!product && !fallback?.productId) {
    Swal.fire('No encontrado', 'No se encontró la información del producto.', 'warning');
    return;
  }

  const p = product || {};
  const customBisel = normalizeCustomBisel(fallback?.customBisel ?? fallback?.custom_bisel ?? p?.custom_bisel ?? null);

  const treatments = Array.isArray(fallback?.treatments)
    ? fallback.treatments
    : (Array.isArray(p?.treatments) ? p.treatments : []);

  const treatmentHtml = treatments.length
    ? `
      <div class="mt-3">
        <div class="small text-muted">Tratamientos</div>
        <div class="fw-semibold" style="word-break:break-word;">
          ${treatments.map(t => safe(t?.name || t?.code || `#${t?.id ?? ''}`)).join(', ')}
        </div>
      </div>
    `
    : `
      <div class="mt-3">
        <div class="small text-muted">Tratamientos</div>
        <div class="fw-semibold">—</div>
      </div>
    `;

  const axisValue = pickFirst(fallback?.axis, p?.axis);
  const axisHtml = axisValue != null
    ? `
      <div class="col-6">
        <div class="small text-muted">Eje</div>
        <div class="fw-semibold">${safe(axisValue)}</div>
      </div>
    `
    : '';

  const notesHtml = fallback?.itemNotes
    ? `
      <div class="mt-3">
        <div class="small text-muted">Notas del item</div>
        <div class="fw-semibold">${safe(fallback.itemNotes)}</div>
      </div>
    `
    : '';

  const sphere = pickFirst(p.sphere, p.esfera, '—');
  const cylinder = pickFirst(p.cylinder, p.cilindro, '—');

  const customProductBadge = Number(p?.is_custom || 0) === 1
    ? `<span class="badge text-bg-secondary ms-2">Personalizado</span>`
    : '';

  Swal.fire({
    title: `Producto: ${safe(p.name || fallback.productName || 'Producto')}${customProductBadge}`,
    width: Math.min(window.innerWidth - 24, 950),
    html: `
      <div class="text-start">
        <div class="row g-2">
          <div class="col-6">
            <div class="small text-muted">SKU</div>
            <div class="fw-semibold">${safe(p.sku || fallback.productSku || fallback.productId || '—')}</div>
          </div>
          <div class="col-6">
            <div class="small text-muted">Nombre</div>
            <div class="fw-semibold">${safe(p.name || fallback.productName || 'Producto')}</div>
          </div>

          <div class="col-6">
            <div class="small text-muted">Categoría</div>
            <div class="fw-semibold">${safe(p.category_name || p.category || p.category_code || '—')}</div>
          </div>

          <div class="col-6">
            <div class="small text-muted">Tipo de mica</div>
            <div class="fw-semibold">${safe(p.lens_type_name || p.lens_type_code || '—')}</div>
          </div>

          <div class="col-6">
            <div class="small text-muted">Caja</div>
            <div class="fw-semibold">${safe(p.box_name || p.box_code || '—')}</div>
          </div>

          <div class="col-6">
            <div class="small text-muted">Proveedor</div>
            <div class="fw-semibold">${safe(p.supplier_name || '—')}</div>
          </div>

          <div class="col-6">
            <div class="small text-muted">Material catálogo</div>
            <div class="fw-semibold">${safe(p.material_name || '—')}</div>
          </div>

          <div class="col-6">
            <div class="small text-muted">Precio compra</div>
            <div class="fw-semibold">${money(p.buy_price ?? p.buyPrice ?? 0)}</div>
          </div>

          <div class="col-6">
            <div class="small text-muted">Precio venta</div>
            <div class="fw-semibold">${money(p.sale_price ?? p.salePrice ?? 0)}</div>
          </div>

          <div class="col-6">
            <div class="small text-muted">Esfera</div>
            <div class="fw-semibold">${safe(sphere)}</div>
          </div>

          <div class="col-6">
            <div class="small text-muted">Cilindro</div>
            <div class="fw-semibold">${safe(cylinder)}</div>
          </div>

          ${axisHtml}
        </div>

        <div class="mt-3">
          <div class="small text-muted">Descripción</div>
          <div class="fw-semibold">${safe(p.description || '—')}</div>
        </div>

        ${treatmentHtml}
        ${renderCustomBiselHtml(customBisel)}
        ${notesHtml}
      </div>
    `,
    confirmButtonText: 'Cerrar'
  });
}

async function showOrderDetail(order, productsMap, opticasById, ctx) {
  const role = ctx?.role || authService.getRole();
  const o = normalizeOrder(order);

  const opticaName =
    opticasById.get(String(o.opticaId))?.nombre ||
    o.opticaName ||
    `Óptica #${o.opticaId || '—'}`;

  const paySt = o.paymentStatus || 'pendiente';
  const procSt = o.processStatus || 'recibido';

  const canAdminEditPayment = role === 'admin';
  const canEditProcess = (role === 'admin' || role === 'employee');
  const processOptions = getAllowedProcessOptions(role, procSt);

  const itemsHtml = (o.items || []).map((it, idx) => {
    const p = mergeProductSources(
      it.product || {},
      productsMap.get(String(it.productId)) || {},
      it
    );

    const sku = p.sku || it.productSku || (it.productId ?? '—');
    const name = p.name || it.productName || 'Producto';

    const unit = Number(it.price || 0);
    const qty = Number(it.qty || 0);
    const line = qty * unit;

    const treatments = Array.isArray(it.treatments) ? it.treatments : [];
    const treatmentsHtml = treatments.length
      ? `
        <div class="small text-muted mt-1" style="white-space:normal; word-break:break-word;">
          <b>Tratamientos:</b>
          ${treatments.map(t => safe(t?.name || t?.code || `#${t?.id ?? ''}`)).join(', ')}
        </div>
      `
      : '';

    const customBisel = normalizeCustomBisel(it.customBisel);
    const customBiselHtml = customBisel
      ? `
        <div class="small text-muted mt-1" style="white-space:normal; word-break:break-word;">
          <b>Bisel personalizado:</b>
          ${safe(customBisel.reflection || 'Sin reflexión')}
          · ${safe(customBisel.lensTypeName || customBisel.lensTypeCode || 'Sin tipo')}
        </div>
      `
      : '';

    const axisHtml = it.axis != null
      ? `<div class="small text-muted mt-1"><b>Eje:</b> ${safe(it.axis)}</div>`
      : '';

    const notesHtml = it.itemNotes
      ? `<div class="small text-muted mt-1" style="white-space:normal; word-break:break-word;"><b>Notas:</b> ${safe(it.itemNotes)}</div>`
      : '';

    return `
      <tr>
        <td style="min-width:110px; white-space:nowrap;">${safe(sku)}</td>
        <td style="min-width:240px; white-space:normal; word-break:break-word;">
          <div class="fw-semibold">${safe(name)}</div>
          ${treatmentsHtml}
          ${customBiselHtml}
          ${axisHtml}
          ${notesHtml}
        </td>
        <td class="text-end" style="min-width:70px; white-space:nowrap;">${qty}</td>
        <td class="text-end" style="min-width:110px; white-space:nowrap;">${money(unit)}</td>
        <td class="text-end fw-semibold" style="min-width:110px; white-space:nowrap;">${money(line)}</td>
        <td class="text-end" style="min-width:110px; white-space:nowrap;">
          <button
            type="button"
            class="btn btn-sm btn-outline-secondary"
            data-view-product="${safe(it.productId)}"
            data-item-index="${idx}">
            Producto
          </button>
        </td>
      </tr>
    `;
  }).join('') || `<tr><td colspan="6" class="text-muted">Sin items</td></tr>`;

  const pmLabel = getPaymentMethodLabel(o);

  const currentPaymentMethodId = Number(
    o.paymentMethodId ??
    o.payment_method_id ??
    o.paymentMethod ??
    o.payment_method ??
    0
  ) || null;

  const opticaControlsHtml = role === 'optica'
    ? `
      <div class="mt-3 p-3 border rounded bg-light">
        <div class="fw-semibold mb-2">Acciones disponibles</div>
        ${
          canOpticaCancel(procSt)
            ? `
              <div class="d-flex justify-content-end">
                <button class="btn btn-sm btn-outline-danger" id="btnOpticaCancelOrder">
                  Cancelar pedido
                </button>
              </div>
            `
            : `<div class="small text-muted">La óptica solo puede cancelar cuando el pedido está en <b>Recibido</b>.</div>`
        }
      </div>
    `
    : '';

  const adminEmployeeControlsHtml = role === 'optica'
    ? ''
    : `
      <div class="mt-3 p-3 border rounded bg-light">
        <div class="fw-semibold mb-2">Cambios del pedido</div>

        <div class="row g-2">
          <div class="col-md-4">
            <div class="small text-muted">Método de pago</div>
            ${
              role === 'admin'
                ? `
                  <select class="form-select form-select-sm" id="selPaymentMethod">
                    ${PAYMENT_METHOD_OPTIONS.map(pm => `
                      <option value="${pm.id}" ${Number(pm.id) === Number(currentPaymentMethodId) ? 'selected' : ''}>
                        ${safe(pm.label)}
                      </option>
                    `).join('')}
                  </select>
                `
                : `<div>${safe(pmLabel)} <span class="small text-muted ms-2">(solo admin)</span></div>`
            }
          </div>

          <div class="col-md-4">
            <div class="small text-muted">Estatus de pago</div>
            ${
              canAdminEditPayment
                ? `
                  <select class="form-select form-select-sm" id="selPaymentStatus">
                    ${['pendiente', 'pagado'].map(v => `
                      <option value="${v}" ${v === paySt ? 'selected' : ''}>${PAYMENT_LABEL[v]}</option>
                    `).join('')}
                  </select>
                `
                : `<div>${badgeHtml('payment', paySt)} <span class="small text-muted ms-2">(solo admin)</span></div>`
            }
          </div>

          <div class="col-md-4">
            <div class="small text-muted">Estatus de proceso</div>
            ${
              canEditProcess
                ? `
                  <select class="form-select form-select-sm" id="selProcessStatus">
                    ${processOptions.map(v => `
                      <option value="${v}" ${v === procSt ? 'selected' : ''}>${PROCESS_LABEL[v]}</option>
                    `).join('')}
                  </select>
                  <div class="small text-muted mt-1">
                    ${
                      role === 'admin'
                        ? 'Admin puede mandar a revisión solo pedidos entregados y cancelar solo desde revisión.'
                        : 'Empleado solo puede avanzar el pedido en el flujo normal.'
                    }
                  </div>
                `
                : `<div>${badgeHtml('process', procSt)}</div>`
            }
          </div>
        </div>

        ${
          role === 'admin' && canAdminCancel(procSt)
            ? `
              <div class="d-flex justify-content-between align-items-center mt-3 gap-2 flex-wrap">
                <div class="small text-muted">Este pedido ya está en revisión. Puedes cancelarlo.</div>
                <button class="btn btn-sm btn-outline-danger" id="btnAdminCancelOrder">
                  Cancelar pedido
                </button>
              </div>
            `
            : ''
        }

        <div class="d-flex justify-content-end mt-3">
          <button class="btn btn-sm btn-brand" id="btnSaveStatus">Guardar cambios</button>
        </div>
      </div>
    `;
  const paidAtHtml = o.paidAt
    ? `
      <div class="col-6">
        <div class="small text-muted">Fecha de pago</div>
        <div class="fw-semibold">${safe(formatDateTime(o.paidAt))}</div>
      </div>
    `
    : `
      <div class="col-6">
        <div class="small text-muted">Fecha de pago</div>
        <div class="fw-semibold">—</div>
      </div>
    `;

  const itemsTableHtml = modalTableWrap(`
    <table class="table table-sm align-middle mb-0" style="min-width:760px;">
      <thead>
        <tr>
          <th style="min-width:110px;">SKU</th>
          <th style="min-width:240px;">Producto</th>
          <th class="text-end" style="min-width:70px;">Cant.</th>
          <th class="text-end" style="min-width:110px;">Precio</th>
          <th class="text-end" style="min-width:110px;">Importe</th>
          <th class="text-end" style="min-width:110px;">Acción</th>
        </tr>
      </thead>
      <tbody>${itemsHtml}</tbody>
    </table>
  `);

  const html = `
    <div class="text-start">
      <div class="d-flex justify-content-end mb-3">
        <button type="button" class="btn btn-sm btn-brand" id="btnPrintTicket">
          Imprimir ticket
        </button>
      </div>

      <div class="row g-2">
        <div class="col-6">
          <div class="small text-muted">Pedido</div>
          <div class="fw-semibold">#${safe(o.id)}</div>
        </div>
        <div class="col-6">
          <div class="small text-muted">Fecha de creación</div>
          <div class="fw-semibold">${safe(formatDateTime(o.date))}</div>
        </div>

        <div class="col-6">
          <div class="small text-muted">Óptica</div>
          <div class="fw-semibold" style="word-break:break-word;">${safe(opticaName)}</div>
        </div>
        <div class="col-6">
          <div class="small text-muted">Pago (método)</div>
          <div class="fw-semibold">${safe(pmLabel)}</div>
        </div>

        <div class="col-6">
          <div class="small text-muted">Estatus de pago</div>
          <div class="fw-semibold">${badgeHtml('payment', paySt)}</div>
        </div>
        <div class="col-6">
          <div class="small text-muted">Estatus de proceso</div>
          <div class="fw-semibold">${badgeHtml('process', procSt)}</div>
        </div>

        ${paidAtHtml}
      </div>

      ${o.notes ? `
        <div class="mt-3">
          <div class="small text-muted">Notas</div>
          <div class="fw-semibold" style="word-break:break-word;">${safe(o.notes)}</div>
        </div>
      ` : ''}

      ${opticaControlsHtml}
      ${adminEmployeeControlsHtml}

      <hr class="my-3"/>

      ${itemsTableHtml}

      <div class="d-flex justify-content-end mt-3">
        <div class="fw-bold fs-5">Total: ${money(o.total || 0)}</div>
      </div>
    </div>
  `;

  await Swal.fire({
    title: `Detalle del pedido #${o.id}`,
    html,
    width: Math.min(window.innerWidth - 24, 1100),
    icon: 'info',
    confirmButtonText: 'Cerrar',
    customClass: {
      popup: 'swal2-order-modal'
    },
    didOpen: () => {
      const popup = Swal.getPopup();
      if (popup) {
        popup.style.maxWidth = '1100px';
      }

      const htmlContainer = Swal.getHtmlContainer();

      htmlContainer?.querySelector('#btnPrintTicket')?.addEventListener('click', () => {
        printOrderTicket(o, opticaName, pmLabel);
      });

      htmlContainer?.querySelectorAll('[data-view-product]').forEach(btn => {
        btn.addEventListener('click', () => {
          const productId = btn.dataset.viewProduct;
          const itemIndex = Number(btn.dataset.itemIndex || -1);

          const fallbackItem = itemIndex >= 0
            ? (o.items || [])[itemIndex] || {}
            : ((o.items || []).find(x => String(x.productId) === String(productId)) || {});

          const mergedProduct = mergeProductSources(
            fallbackItem?.product || {},
            productsMap.get(String(productId)) || {},
            fallbackItem
          );

          if (fallbackItem?.customBisel) {
            mergedProduct.custom_bisel = {
              reflection: fallbackItem.customBisel.reflection,
              lens_type_id: fallbackItem.customBisel.lensTypeId,
              lens_type_code: fallbackItem.customBisel.lensTypeCode,
              lens_type_name: fallbackItem.customBisel.lensTypeName,
              frame_height: fallbackItem.customBisel.frameHeight,
              blank_height: fallbackItem.customBisel.blankHeight,
              observations: fallbackItem.customBisel.observations,
            };
          }

          showOrderedProductDetail(mergedProduct, fallbackItem);
        });
      });

      const opticaCancelBtn = htmlContainer?.querySelector('#btnOpticaCancelOrder');
      if (opticaCancelBtn) {
        opticaCancelBtn.addEventListener('click', async () => {
          if (!canOpticaCancel(procSt)) {
            Swal.fire('No permitido', 'La óptica solo puede cancelar cuando el pedido está en Recibido.', 'warning');
            return;
          }

          const confirm = await Swal.fire({
            title: '¿Cancelar pedido?',
            text: 'Esta acción cancelará el pedido y liberará la reserva correspondiente.',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Sí, cancelar'
          });

          if (!confirm.isConfirmed) return;

          try {
            await cancelOrder(o.id);
            if (typeof ctx?.onReload === 'function') await ctx.onReload();
            Swal.fire('Listo', 'Pedido cancelado.', 'success');
          } catch (err) {
            Swal.fire('Error', err?.response?.data?.message || 'No se pudo cancelar el pedido.', 'error');
          }
        });
      }

      if (role === 'optica') return;

      const adminCancelBtn = htmlContainer?.querySelector('#btnAdminCancelOrder');
      if (adminCancelBtn) {
        adminCancelBtn.addEventListener('click', async () => {
          if (role !== 'admin') {
            Swal.fire('No permitido', 'Solo admin puede cancelar desde revisión.', 'warning');
            return;
          }

          if (!canAdminCancel(procSt)) {
            Swal.fire('No permitido', 'Admin solo puede cancelar cuando el pedido está en Revisión.', 'warning');
            return;
          }

          const confirm = await Swal.fire({
            title: '¿Cancelar pedido?',
            text: 'Esta acción cancelará el pedido y liberará la reserva correspondiente.',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Sí, cancelar'
          });

          if (!confirm.isConfirmed) return;

          try {
            await cancelOrder(o.id);
            if (typeof ctx?.onReload === 'function') await ctx.onReload();
            Swal.fire('Listo', 'Pedido cancelado.', 'success');
          } catch (err) {
            Swal.fire('Error', err?.response?.data?.message || 'No se pudo cancelar el pedido.', 'error');
          }
        });
      }

      const btn = htmlContainer?.querySelector('#btnSaveStatus');
      if (!btn) return;

      btn.addEventListener('click', async () => {
      const selPay = htmlContainer?.querySelector('#selPaymentStatus');
      const selProc = htmlContainer?.querySelector('#selProcessStatus');
      const selPaymentMethod = htmlContainer?.querySelector('#selPaymentMethod');

      const nextPay = selPay ? selPay.value : paySt;
      const nextProc = selProc ? selProc.value : procSt;
      const nextPaymentMethodId = selPaymentMethod
        ? Number(selPaymentMethod.value || 0)
        : currentPaymentMethodId;

      if (nextPaymentMethodId !== currentPaymentMethodId && role !== 'admin') {
        Swal.fire('No permitido', 'Solo admin puede cambiar el método de pago.', 'warning');
        return;
      }

      if (nextPay !== paySt && role !== 'admin') {
        Swal.fire('No permitido', 'Solo admin puede cambiar el estatus de pago.', 'warning');
        return;
      }

      if (nextProc !== procSt) {
        if (!(role === 'admin' || role === 'employee')) {
          Swal.fire('No permitido', 'Tu rol no puede cambiar el estatus de proceso.', 'warning');
          return;
        }

        if (role === 'employee') {
          if (nextProc === 'revision' || nextProc === 'cancelado') {
            Swal.fire('No permitido', 'Empleado no puede mandar a revisión ni cancelar.', 'warning');
            return;
          }

          const allowedEmployee = getAllowedProcessOptions('employee', procSt);

          if (!allowedEmployee.includes(nextProc)) {
            Swal.fire('No permitido', 'El empleado solo puede avanzar el pedido en el flujo permitido.', 'warning');
            return;
          }
        }

        if (role === 'admin') {
          if (nextProc === 'revision' && !canAdminSendToRevision(procSt)) {
            Swal.fire('No permitido', 'Admin solo puede mandar a revisión pedidos entregados.', 'warning');
            return;
          }

          if (nextProc === 'cancelado') {
            Swal.fire('No permitido', 'El estado cancelado no se cambia desde el selector. Usa el botón Cancelar pedido.', 'warning');
            return;
          }

          const allowedAdmin = getAllowedProcessOptions('admin', procSt);

          if (!allowedAdmin.includes(nextProc)) {
            Swal.fire('No permitido', 'Ese cambio de estado no está permitido.', 'warning');
            return;
          }
        }
      }

      const changedPaymentMethod = Number(nextPaymentMethodId || 0) !== Number(currentPaymentMethodId || 0);
      const changedPaymentStatus = nextPay !== paySt;
      const changedProcessStatus = nextProc !== procSt;

      if (!changedPaymentMethod && !changedPaymentStatus && !changedProcessStatus) {
        Swal.fire('Sin cambios', 'No hiciste modificaciones.', 'info');
        return;
      }

      const nextPaymentMethodLabel = PM_ID_LABEL[Number(nextPaymentMethodId)] || `ID ${nextPaymentMethodId}`;

      const confirm = await Swal.fire({
        title: 'Confirmar cambios',
        html: `
          Método de pago: <b>${safe(nextPaymentMethodLabel)}</b><br/>
          Pago: ${badgeHtml('payment', nextPay)}<br/>
          Proceso: ${badgeHtml('process', nextProc)}
        `,
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Guardar',
        cancelButtonText: 'Cancelar'
      });

      if (!confirm.isConfirmed) return;

      const patch = {};

      if (changedPaymentMethod) patch.payment_method_id = nextPaymentMethodId;
      if (changedPaymentStatus) patch.payment_status = nextPay;
      if (changedProcessStatus) patch.process_status = nextProc;

      try {
        btn.disabled = true;
        btn.textContent = 'Guardando...';

        const res = await updateOrderPatch(o.id, patch);

        const updated = normalizeOrder({
          ...o,
          ...patch,
          ...(res?.data || res || {})
        });

        Swal.close();

        if (typeof ctx?.onReload === 'function') {
          await ctx.onReload();
        } else if (typeof ctx?.onLocalUpdate === 'function') {
          ctx.onLocalUpdate(o.id, updated);
        }

        await Swal.fire('Listo', 'Pedido actualizado.', 'success');
      } catch (err) {
        console.error(err);

        btn.disabled = false;
        btn.textContent = 'Guardar cambios';

        Swal.fire(
          'Error',
          err?.response?.data?.message || 'No se pudo actualizar el pedido.',
          'error'
        );
      }
    });
    }
  });
}

async function renderOpticaOrders(outlet) {
  const [{ data: products }, meRes, optRes] = await Promise.all([
    api.get('/products'),
    api.get('/me'),
    loadOpticasIndex()
  ]);

  const productsMap = buildProductMap(products);
  const opticasById = optRes.byId;

  const me = meRes?.data?.user || null;
  const myOpticaId = Number(me?.optica_id || 0) || null;

  let rows = [];
  let dt = null;

  async function reloadTable() {
    if (dt) {
      dt.destroy();
      dt = null;
    }

    const all = await fetchOrdersAll();
    rows = all.map(normalizeOrder);

    if (myOpticaId) {
      rows = rows.filter(o => Number(o.opticaId) === Number(myOpticaId));
    }

    rows.sort((a, b) => new Date(b.date) - new Date(a.date));

    renderMyOrdersTbody();

    dt = initDataTable('#tblMyOrders');
  }

  const opticaName =
    opticasById.get(String(myOpticaId))?.nombre ||
    me?.name ||
    'Óptica';

  const renderMyOrdersTbody = () => {
    const tbody = outlet.querySelector('#tblMyOrders tbody');
    if (!tbody) return;

    tbody.innerHTML = rows.map(o => {
      const paySt = o.paymentStatus || 'pendiente';
      const procSt = o.processStatus || 'recibido';

      const pmLabel = getPaymentMethodLabel(o);

      return `
        <tr>
          <td class="fw-semibold">#${o.id}</td>
          <td class="small">${formatDateTime(o.date)}</td>
          <td>${money(o.total || 0)}</td>
          <td class="small">${safe(pmLabel)}</td>
          <td>${badgeHtml('payment', paySt)}</td>
          <td>${badgeHtml('process', procSt)}</td>
          <td class="text-end">
            <button class="btn btn-sm btn-outline-brand" data-view-order="${o.id}">Ver</button>
          </td>
        </tr>
      `;
    }).join('') || `
      <tr>
        <td colspan="7" class="text-muted">Aún no tienes pedidos.</td>
      </tr>
    `;
  };

  outlet.innerHTML = `
    <div class="d-flex align-items-center justify-content-between mb-3">
      <div>
        <h4 class="mb-0">Óptica: ${safe(opticaName)}</h4>
        <div class="text-muted small">Historial de pedidos</div>
      </div>
      <button class="btn btn-brand" id="btnGoPOS">Ir a POS</button>
    </div>

    <div class="card p-3">
      <h6 class="mb-0">Mis pedidos</h6>

      <div class="table-responsive mt-3">
        <table class="table table-sm align-middle" id="tblMyOrders" style="width:100%">
          <thead>
            <tr>
              <th>#</th>
              <th>Fecha</th>
              <th>Total</th>
              <th>Pago</th>
              <th>Pago est.</th>
              <th>Proceso</th>
              <th></th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
    </div>
  `;

  outlet.querySelector('#btnGoPOS')?.addEventListener('click', () => {
    location.hash = '#/pos';
  });

  await reloadTable();

  outlet.addEventListener('click', async (e) => {
    const id = e.target?.dataset?.viewOrder;
    if (!id) return;

    const o = rows.find(x => String(x.id) === String(id));
    if (!o) return;

    await showOrderDetail(o, productsMap, opticasById, {
      role: 'optica',
      onReload: reloadTable
    });
  });
}

async function renderEmployeeOrders(outlet) {
  const role = authService.getRole();

  const [{ data: products }, optRes] = await Promise.all([
    api.get('/products'),
    loadOpticasIndex()
  ]);

  const productsMap = buildProductMap(products);
  const opticasById = optRes.byId;

  let rows = [];
  let dt = null;

  async function reloadTable() {
    if (dt) {
      dt.destroy();
      dt = null;
    }

    const all = await fetchOrdersAll();
    rows = all.map(normalizeOrder).sort((a, b) => new Date(b.date) - new Date(a.date));

    renderTbody();

    dt = initDataTable('#tblAllOrders');
  }

  const onLocalUpdate = (orderId, updatedOrder) => {
    if (dt) {
      dt.destroy();
      dt = null;
    }

    const idx = rows.findIndex(x => String(x.id) === String(orderId));

    if (idx >= 0) {
      rows[idx] = normalizeOrder(updatedOrder);
    }

    renderTbody();

    dt = initDataTable('#tblAllOrders');
  };

  function pmLabelFrom(o) {
    return getPaymentMethodLabel(o);
  }

  function renderTbody() {
    const tbody = outlet.querySelector('#tblAllOrders tbody');
    if (!tbody) return;

    tbody.innerHTML = rows.map(o => {
      const optName = opticasById.get(String(o.opticaId))?.nombre || `Óptica #${o.opticaId || '—'}`;
      const paySt = o.paymentStatus || 'pendiente';
      const procSt = o.processStatus || 'recibido';

      return `
        <tr>
          <td class="fw-semibold">#${safe(o.id)}</td>
          <td class="small">${safe(formatDateTime(o.date))}</td>
          <td>${safe(optName)}</td>
          <td class="small">${safe(pmLabelFrom(o))}</td>
          <td>${badgeHtml('payment', paySt)}</td>
          <td>${badgeHtml('process', procSt)}</td>
          <td class="fw-bold">${money(o.total || 0)}</td>
          <td class="text-end">
            <button class="btn btn-sm btn-outline-brand" data-view-order="${o.id}">Detalle</button>
          </td>
        </tr>
      `;
    }).join('') || `
      <tr>
        <td colspan="8" class="text-muted">No hay pedidos.</td>
      </tr>
    `;
  }

  outlet.innerHTML = `
    <div class="d-flex align-items-center justify-content-between mb-3">
      <div>
        <h4 class="mb-0">Pedidos</h4>
        <div class="text-muted small">Ver pedidos de todas las ópticas</div>
      </div>
    </div>

    <div class="card p-3">
      <div class="table-responsive">
        <table id="tblAllOrders" class="table table-striped align-middle" style="width:100%">
          <thead>
            <tr>
              <th>#</th>
              <th>Fecha</th>
              <th>Óptica</th>
              <th>Pago</th>
              <th>Pago est.</th>
              <th>Proceso</th>
              <th>Total</th>
              <th></th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
    </div>
  `;

  await reloadTable();

  outlet.addEventListener('click', async (e) => {
    const id = e.target?.dataset?.viewOrder;
    if (!id) return;

    const o = rows.find(x => String(x.id) === String(id));
    if (!o) return;

    await showOrderDetail(o, productsMap, opticasById, {
      role,
      onLocalUpdate,
      onReload: reloadTable
    });
  });
}

export async function renderOrders(outlet) {
  const role = authService.getRole();

  if (role === 'optica') {
    await renderOpticaOrders(outlet);
  } else {
    await renderEmployeeOrders(outlet);
  }
}