import { api } from '../services/api.js';
import { ordersService } from '../services/ordersService.js';
import { money, formatDateTime } from '../utils/helpers.js';
import { authService } from '../services/authService.js';

const PM_ID_LABEL = {
  1: 'Efectivo',
  2: 'Tarjeta',
  3: 'Transferencia'
};

const PM_CODE_LABEL = {
  cash: 'Efectivo',
  transfer: 'Transferencia',
  card: 'Tarjeta'
};

const PAYMENT_LABEL = {
  pendiente: 'Pendiente',
  pagado: 'Pagado'
};

const PAYMENT_BADGE = {
  pendiente: 'text-bg-warning',
  pagado: 'text-bg-success'
};

const PROCESS_LABEL = {
  en_proceso: 'En proceso',
  en_preparacion: 'En preparación',
  listo_para_entregar: 'Listo para entregar',
  entregado: 'Entregado',
  revision: 'Revisión',
  cancelado: 'Cancelado'
};

const PROCESS_BADGE = {
  en_proceso: 'text-bg-info',
  en_preparacion: 'text-bg-secondary',
  listo_para_entregar: 'text-bg-primary',
  entregado: 'text-bg-success',
  revision: 'text-bg-danger',
  cancelado: 'text-bg-dark'
};

const PROCESS_FLOW = [
  'en_proceso',
  'en_preparacion',
  'listo_para_entregar',
  'entregado'
];

function safe(v) {
  return String(v ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
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

function normalizeOrder(o) {
  if (!o) return o;

  const paymentStatus = o.paymentStatus ?? o.payment_status ?? 'pendiente';
  const processStatus = o.processStatus ?? o.process_status ?? 'en_proceso';

  const date = o.date ?? o.created_at ?? o.createdAt ?? null;
  const paidAt = o.paidAt ?? o.paid_at ?? null;
  const opticaId = o.opticaId ?? o.optica_id ?? null;

  const paymentMethod =
    o.paymentMethod ??
    o.payment_method ??
    o.payment_method_code ??
    o.payment_method_id ??
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
  const v = value || 'en_proceso';
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
  const current = String(currentStatus || 'en_proceso');

  if (current === 'cancelado') return ['cancelado'];

  if (role === 'employee') {
    if (current === 'revision') return ['revision'];
    const idx = PROCESS_FLOW.indexOf(current);
    if (idx === -1) return ['en_proceso'];
    return PROCESS_FLOW.slice(idx);
  }

  if (role === 'admin') {
    if (current === 'revision') return ['revision'];
    if (current === 'entregado') return ['entregado', 'revision'];
    const idx = PROCESS_FLOW.indexOf(current);
    if (idx === -1) return ['en_proceso'];
    return PROCESS_FLOW.slice(idx);
  }

  return [current];
}

function canOpticaCancel(procSt) {
  return procSt === 'en_proceso';
}

function canAdminCancel(procSt) {
  return procSt === 'revision';
}

function canAdminSendToRevision(procSt) {
  return procSt === 'entregado';
}

function modalTableWrap(innerHtml) {
  return `
    <div style="width:100%; overflow-x:auto; -webkit-overflow-scrolling:touch;">
      ${innerHtml}
    </div>
  `;
}

function pickFirst(...values) {
  for (const v of values) {
    if (v !== null && v !== undefined && String(v).trim() !== '') {
      return v;
    }
  }
  return null;
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

    treatments: Array.isArray(primary?.treatments)
      ? primary.treatments
      : (Array.isArray(secondary?.treatments) ? secondary.treatments : []),
  };
}

function showOrderedProductDetail(product, fallback = {}) {
  if (!product && !fallback?.productId) {
    Swal.fire('No encontrado', 'No se encontró la información del producto.', 'warning');
    return;
  }

  const p = product || {};
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

  Swal.fire({
    title: `Producto: ${safe(p.name || fallback.productName || 'Producto')}`,
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
  const procSt = o.processStatus || 'en_proceso';

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

  let pmLabel = '—';
  if (typeof o.paymentMethod === 'number' || String(o.paymentMethod).match(/^\d+$/)) {
    pmLabel = PM_ID_LABEL[Number(o.paymentMethod)] || `ID ${o.paymentMethod}`;
  } else {
    const key = String(o.paymentMethod || '').toLowerCase();
    pmLabel = PM_CODE_LABEL[key] || o.paymentMethod || '—';
  }

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
            : `<div class="small text-muted">La óptica solo puede cancelar cuando el pedido está en <b>En proceso</b>.</div>`
        }
      </div>
    `
    : '';

  const adminEmployeeControlsHtml = role === 'optica'
    ? ''
    : `
      <div class="mt-3 p-3 border rounded bg-light">
        <div class="fw-semibold mb-2">Cambios de estatus</div>

        <div class="row g-2">
          <div class="col-md-6">
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

          <div class="col-md-6">
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

          showOrderedProductDetail(mergedProduct, fallbackItem);
        });
      });

      const opticaCancelBtn = htmlContainer?.querySelector('#btnOpticaCancelOrder');
      if (opticaCancelBtn) {
        opticaCancelBtn.addEventListener('click', async () => {
          if (!canOpticaCancel(procSt)) {
            Swal.fire('No permitido', 'La óptica solo puede cancelar cuando el pedido está en En proceso.', 'warning');
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

        const nextPay = selPay ? selPay.value : paySt;
        const nextProc = selProc ? selProc.value : procSt;

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

        if (nextPay === paySt && nextProc === procSt) {
          Swal.fire('Sin cambios', 'No hiciste modificaciones.', 'info');
          return;
        }

        const confirm = await Swal.fire({
          title: 'Confirmar cambios',
          html: `Pago: ${badgeHtml('payment', nextPay)}<br/>Proceso: ${badgeHtml('process', nextProc)}`,
          icon: 'question',
          showCancelButton: true,
          confirmButtonText: 'Guardar'
        });

        if (!confirm.isConfirmed) return;

        const patch = {};
        if (nextPay !== paySt) patch.payment_status = nextPay;
        if (nextProc !== procSt) patch.process_status = nextProc;

        try {
          const res = await updateOrderPatch(o.id, patch);
          const updated = normalizeOrder({ ...o, ...patch, ...(res?.data || res || {}) });

          if (typeof ctx?.onReload === 'function') await ctx.onReload();
          if (typeof ctx?.onLocalUpdate === 'function') ctx.onLocalUpdate(o.id, updated);

          Swal.fire('Listo', 'Estatus actualizado.', 'success');
        } catch (err) {
          console.error(err);
          Swal.fire('Error', err?.response?.data?.message || 'No se pudo actualizar el estatus.', 'error');
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
    const all = await fetchOrdersAll();
    rows = all.map(normalizeOrder);

    if (myOpticaId) {
      rows = rows.filter(o => Number(o.opticaId) === Number(myOpticaId));
    }

    rows.sort((a, b) => new Date(b.date) - new Date(a.date));

    renderMyOrdersTbody();

    if (dt) {
      dt.destroy();
      dt = null;
    }
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
      const procSt = o.processStatus || 'en_proceso';

      let pmLabel = '—';
      if (typeof o.paymentMethod === 'number' || String(o.paymentMethod).match(/^\d+$/)) {
        pmLabel = PM_ID_LABEL[Number(o.paymentMethod)] || `ID ${o.paymentMethod}`;
      } else {
        const key = String(o.paymentMethod || '').toLowerCase();
        pmLabel = PM_CODE_LABEL[key] || o.paymentMethod || '—';
      }

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
    const all = await fetchOrdersAll();
    rows = all.map(normalizeOrder).sort((a, b) => new Date(b.date) - new Date(a.date));

    renderTbody();

    if (dt) {
      dt.destroy();
      dt = null;
    }
    dt = initDataTable('#tblAllOrders');
  }

  const onLocalUpdate = (orderId, updatedOrder) => {
    const idx = rows.findIndex(x => String(x.id) === String(orderId));
    if (idx >= 0) {
      rows[idx] = normalizeOrder(updatedOrder);
    }
    renderTbody();

    if (dt) {
      dt.destroy();
      dt = null;
    }
    dt = initDataTable('#tblAllOrders');
  };

  function pmLabelFrom(o) {
    if (typeof o.paymentMethod === 'number' || String(o.paymentMethod).match(/^\d+$/)) {
      return PM_ID_LABEL[Number(o.paymentMethod)] || `ID ${o.paymentMethod}`;
    }
    const key = String(o.paymentMethod || '').toLowerCase();
    return PM_CODE_LABEL[key] || o.paymentMethod || '—';
  }

  function renderTbody() {
    const tbody = outlet.querySelector('#tblAllOrders tbody');
    if (!tbody) return;

    tbody.innerHTML = rows.map(o => {
      const optName = opticasById.get(String(o.opticaId))?.nombre || `Óptica #${o.opticaId || '—'}`;
      const paySt = o.paymentStatus || 'pendiente';
      const procSt = o.processStatus || 'en_proceso';

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