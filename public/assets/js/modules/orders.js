// public/assets/js/pages/orders.js
// - PAGINADO
// - Óptica: solo ve sus pedidos
// - Admin/Employee: ven todos
// - Modal de detalle del pedido
// - Cambio de estatus
// - Botón para ver detalle completo del producto ordenado
// - Muestra tratamientos, eje y notas por item
// - SIN tabla de stock disponible en vista óptica

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
  listo_para_entregar: 'Listo para entregar',
  entregado: 'Entregado',
  revision: 'Revisión',
  en_preparacion: 'En preparación',
  cancelado: 'Cancelado'
};

const PROCESS_BADGE = {
  en_proceso: 'text-bg-info',
  listo_para_entregar: 'text-bg-primary',
  entregado: 'text-bg-success',
  revision: 'text-bg-danger',
  en_preparacion: 'text-bg-secondary',
  cancelado: 'text-bg-dark'
};

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

function normalizeOrder(o) {
  if (!o) return o;

  const paymentStatus = o.paymentStatus ?? o.payment_status ?? 'pendiente';
  const processStatus = o.processStatus ?? o.process_status ?? 'en_proceso';

  const date = o.date ?? o.created_at ?? o.createdAt ?? null;
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
        };
      })
    : [];

  return {
    ...o,
    id: o.id,
    date,
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

async function fetchOrdersPage(page = 1) {
  try {
    if (typeof ordersService?.list === 'function') {
      const maybe = await ordersService.list(page);
      const un = unwrapPaginated(maybe);
      if (un.rows.length || un.meta) return un;
    }
  } catch (_e) {}

  const { data } = await api.get(`/orders?page=${encodeURIComponent(page)}`);
  return unwrapPaginated(data);
}

function showOrderedProductDetail(product, fallback = {}) {
  if (!product && !fallback?.productId) {
    Swal.fire('No encontrado', 'No se encontró la información del producto.', 'warning');
    return;
  }

  const p = product || {};
  const treatments = Array.isArray(fallback?.treatments) ? fallback.treatments : [];

  const treatmentHtml = treatments.length
    ? `
      <div class="mt-3">
        <div class="small text-muted">Tratamientos ordenados</div>
        <div class="fw-semibold">
          ${treatments.map(t => safe(t?.name || t?.code || `#${t?.id ?? ''}`)).join(', ')}
        </div>
      </div>
    `
    : `
      <div class="mt-3">
        <div class="small text-muted">Tratamientos ordenados</div>
        <div class="fw-semibold">—</div>
      </div>
    `;

  const axisHtml = fallback?.axis != null
    ? `
      <div class="col-6">
        <div class="small text-muted">Eje</div>
        <div class="fw-semibold">${safe(fallback.axis)}</div>
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

  const sphere = p.sphere ?? p.esfera ?? '—';
  const cylinder = p.cylinder ?? p.cilindro ?? '—';

  Swal.fire({
    title: `Producto: ${safe(p.name || fallback.productName || 'Producto')}`,
    width: 850,
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
            <div class="small text-muted">Tipo</div>
            <div class="fw-semibold">${safe(p.type || '—')}</div>
          </div>

          <div class="col-6">
            <div class="small text-muted">Marca</div>
            <div class="fw-semibold">${safe(p.brand || '—')}</div>
          </div>
          <div class="col-6">
            <div class="small text-muted">Modelo</div>
            <div class="fw-semibold">${safe(p.model || '—')}</div>
          </div>

          <div class="col-6">
            <div class="small text-muted">Material</div>
            <div class="fw-semibold">${safe(p.material || '—')}</div>
          </div>
          <div class="col-6">
            <div class="small text-muted">Tamaño</div>
            <div class="fw-semibold">${safe(p.size || '—')}</div>
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
  const employeeLocked = (role === 'employee' && procSt === 'entregado');

  const procOptionsEmployee = ['en_proceso', 'listo_para_entregar', 'entregado'];
  const procOptionsAdmin = ['en_proceso', 'listo_para_entregar', 'entregado', 'revision'];
  const procOptions = (role === 'admin') ? procOptionsAdmin : procOptionsEmployee;

  const itemsHtml = (o.items || []).map((it, idx) => {
    const p = productsMap.get(String(it.productId)) || {};
    const sku = p.sku || it.productSku || (it.productId ?? '—');
    const name = p.name || it.productName || 'Producto';

    const unit = Number(it.price || 0);
    const qty = Number(it.qty || 0);
    const line = qty * unit;

    const treatments = Array.isArray(it.treatments) ? it.treatments : [];
    const treatmentsHtml = treatments.length
      ? `
        <div class="small text-muted mt-1">
          <b>Tratamientos:</b>
          ${treatments.map(t => safe(t?.name || t?.code || `#${t?.id ?? ''}`)).join(', ')}
        </div>
      `
      : '';

    const axisHtml = it.axis != null
      ? `<div class="small text-muted mt-1"><b>Eje:</b> ${safe(it.axis)}</div>`
      : '';

    const notesHtml = it.itemNotes
      ? `<div class="small text-muted mt-1"><b>Notas:</b> ${safe(it.itemNotes)}</div>`
      : '';

    return `
      <tr>
        <td>${safe(sku)}</td>
        <td>
          <div class="fw-semibold">${safe(name)}</div>
          ${treatmentsHtml}
          ${axisHtml}
          ${notesHtml}
        </td>
        <td class="text-end">${qty}</td>
        <td class="text-end">${money(unit)}</td>
        <td class="text-end fw-semibold">${money(line)}</td>
        <td class="text-end">
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

  const controlsHtml = (role === 'optica')
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
                  <select class="form-select form-select-sm" id="selProcessStatus" ${employeeLocked ? 'disabled' : ''}>
                    ${procOptions.map(v => `
                      <option value="${v}" ${v === procSt ? 'selected' : ''}>${PROCESS_LABEL[v]}</option>
                    `).join('')}
                  </select>
                  ${
                    employeeLocked
                      ? `<div class="small text-muted mt-1">Entregado: solo admin puede moverlo a <b>Revisión</b>.</div>`
                      : (role === 'employee'
                          ? `<div class="small text-muted mt-1">Si lo cambias a <b>Entregado</b>, ya no podrás modificarlo.</div>`
                          : `<div class="small text-muted mt-1">Admin puede usar <b>Revisión</b> para inconformidades.</div>`)
                  }
                `
                : `<div>${badgeHtml('process', procSt)}</div>`
            }
          </div>
        </div>

        <div class="d-flex justify-content-end mt-3">
          <button class="btn btn-sm btn-brand" id="btnSaveStatus">Guardar cambios</button>
        </div>
      </div>
    `;

  const html = `
    <div class="text-start">
      <div class="row g-2">
        <div class="col-6">
          <div class="small text-muted">Pedido</div>
          <div class="fw-semibold">#${safe(o.id)}</div>
        </div>
        <div class="col-6">
          <div class="small text-muted">Fecha</div>
          <div class="fw-semibold">${safe(formatDateTime(o.date))}</div>
        </div>

        <div class="col-6">
          <div class="small text-muted">Óptica</div>
          <div class="fw-semibold">${safe(opticaName)}</div>
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
      </div>

      ${o.notes ? `
        <div class="mt-3">
          <div class="small text-muted">Notas</div>
          <div class="fw-semibold">${safe(o.notes)}</div>
        </div>
      ` : ''}

      ${controlsHtml}

      <hr class="my-3"/>

      <div class="table-responsive">
        <table class="table table-sm align-middle">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Producto</th>
              <th class="text-end">Cant.</th>
              <th class="text-end">Precio</th>
              <th class="text-end">Importe</th>
              <th class="text-end">Acción</th>
            </tr>
          </thead>
          <tbody>${itemsHtml}</tbody>
        </table>
      </div>

      <div class="d-flex justify-content-end mt-2">
        <div class="fw-bold fs-5">Total: ${money(o.total || 0)}</div>
      </div>
    </div>
  `;

  await Swal.fire({
    title: `Detalle del pedido #${o.id}`,
    html,
    width: 980,
    icon: 'info',
    confirmButtonText: 'Cerrar',
    didOpen: () => {
      const htmlContainer = Swal.getHtmlContainer();

      htmlContainer?.querySelectorAll('[data-view-product]').forEach(btn => {
        btn.addEventListener('click', () => {
          const productId = btn.dataset.viewProduct;
          const itemIndex = Number(btn.dataset.itemIndex || -1);

          const product = productsMap.get(String(productId)) || null;
          const fallbackItem = itemIndex >= 0
            ? (o.items || [])[itemIndex] || {}
            : ((o.items || []).find(x => String(x.productId) === String(productId)) || {});

          showOrderedProductDetail(product, fallbackItem);
        });
      });

      if (role === 'optica') return;

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
          if (role === 'employee' && procSt === 'entregado') {
            Swal.fire('Bloqueado', 'Entregado: solo admin puede moverlo a Revisión.', 'warning');
            return;
          }
          if (role !== 'admin' && nextProc === 'revision') {
            Swal.fire('No permitido', 'Solo admin puede poner el pedido en Revisión.', 'warning');
            return;
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
          await updateOrderPatch(o.id, patch);
          if (typeof ctx?.onLocalUpdate === 'function') ctx.onLocalUpdate(o.id, patch);
          Swal.fire('Listo', 'Estatus actualizado.', 'success');
        } catch (err) {
          console.error(err);
          Swal.fire('Error', 'No se pudo actualizar el estatus.', 'error');
        }
      });
    }
  });
}

function paginationHtml(meta) {
  if (!meta || !meta.current_page || !meta.last_page) return '';
  const cur = Number(meta.current_page);
  const last = Number(meta.last_page);

  const prevDisabled = cur <= 1 ? 'disabled' : '';
  const nextDisabled = cur >= last ? 'disabled' : '';

  return `
    <div class="d-flex align-items-center justify-content-between mt-3">
      <div class="small text-muted">Página <b>${cur}</b> de <b>${last}</b> · Total: <b>${meta.total ?? '—'}</b></div>
      <div class="btn-group">
        <button class="btn btn-sm btn-outline-secondary" data-page="prev" ${prevDisabled}>Anterior</button>
        <button class="btn btn-sm btn-outline-secondary" data-page="next" ${nextDisabled}>Siguiente</button>
      </div>
    </div>
  `;
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

  let page = 1;
  let rows = [];
  let meta = null;

  async function loadPage(p) {
    const res = await fetchOrdersPage(p);
    rows = (res.rows || []).map(normalizeOrder);

    if (myOpticaId) {
      rows = rows.filter(o => Number(o.opticaId) === Number(myOpticaId));
    }

    meta = res.meta;
    page = meta?.current_page ? Number(meta.current_page) : p;
  }

  await loadPage(1);

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
        <tr data-process="${procSt}">
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

    const pager = outlet.querySelector('#ordersPager');
    if (pager) pager.innerHTML = paginationHtml(meta);
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

      <div class="row g-2 mt-2">
        <div class="col-7">
          <input class="form-control form-control-sm" id="orderSearch" placeholder="Buscar #, pago, estatus...">
        </div>
        <div class="col-5">
          <select class="form-select form-select-sm" id="orderProcess">
            <option value="">Proceso (todos)</option>
            <option value="en_proceso">En proceso</option>
            <option value="listo_para_entregar">Listo para entregar</option>
            <option value="entregado">Entregado</option>
            <option value="revision">Revisión</option>
            <option value="en_preparacion">En preparación</option>
            <option value="cancelado">Cancelado</option>
          </select>
        </div>
      </div>

      <div class="table-responsive mt-2">
        <table class="table table-sm align-middle" id="tblMyOrders">
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

      <div id="ordersPager"></div>

      <div class="small text-muted">Tip: usa el buscador o filtra por proceso.</div>
    </div>
  `;

  outlet.querySelector('#btnGoPOS')?.addEventListener('click', () => {
    location.hash = '#/pos';
  });

  renderMyOrdersTbody();

  const applyOrderFilter = () => {
    const q = (outlet.querySelector('#orderSearch')?.value || '').toLowerCase().trim();
    const proc = outlet.querySelector('#orderProcess')?.value || '';
    const trs = Array.from(outlet.querySelectorAll('#tblMyOrders tbody tr'));

    trs.forEach(r => {
      const txt = r.innerText.toLowerCase();
      const okQ = !q || txt.includes(q);
      const okP = !proc || (r.dataset.process === proc);
      r.style.display = (okQ && okP) ? '' : 'none';
    });
  };

  outlet.querySelector('#orderSearch')?.addEventListener('input', applyOrderFilter);
  outlet.querySelector('#orderProcess')?.addEventListener('change', applyOrderFilter);

  outlet.addEventListener('click', async (e) => {
    const id = e.target?.dataset?.viewOrder;
    if (!id) return;

    const o = rows.find(x => String(x.id) === String(id));
    if (!o) return;

    await showOrderDetail(o, productsMap, opticasById, { role: 'optica' });
  });

  outlet.addEventListener('click', async (e) => {
    const btn = e.target?.closest('[data-page]');
    if (!btn) return;

    const dir = btn.dataset.page;
    const cur = Number(meta?.current_page || page);
    const last = Number(meta?.last_page || cur);

    let next = cur;
    if (dir === 'prev') next = Math.max(1, cur - 1);
    if (dir === 'next') next = Math.min(last, cur + 1);

    if (next === cur) return;

    await loadPage(next);
    renderMyOrdersTbody();
    applyOrderFilter();
  });

  applyOrderFilter();
}

async function renderEmployeeOrders(outlet) {
  const role = authService.getRole();

  const [{ data: products }, optRes] = await Promise.all([
    api.get('/products'),
    loadOpticasIndex()
  ]);

  const productsMap = buildProductMap(products);
  const opticasById = optRes.byId;

  let page = 1;
  let rows = [];
  let meta = null;

  async function loadPage(p) {
    const res = await fetchOrdersPage(p);
    rows = (res.rows || []).map(normalizeOrder).sort((a, b) => new Date(b.date) - new Date(a.date));
    meta = res.meta;
    page = meta?.current_page ? Number(meta.current_page) : p;
  }

  await loadPage(1);

  const onLocalUpdate = (orderId, patch) => {
    const idx = rows.findIndex(x => String(x.id) === String(orderId));
    if (idx >= 0) {
      rows[idx] = normalizeOrder({ ...rows[idx], ...patch });
    }
    renderTbody();
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

    const pager = outlet.querySelector('#ordersPagerAll');
    if (pager) pager.innerHTML = paginationHtml(meta);
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

      <div id="ordersPagerAll"></div>

      <div class="small text-muted mt-2">
        Tip: usa Ctrl+F o agrega un buscador si quieres filtro por texto.
      </div>
    </div>
  `;

  renderTbody();

  outlet.addEventListener('click', async (e) => {
    const id = e.target?.dataset?.viewOrder;
    if (id) {
      const o = rows.find(x => String(x.id) === String(id));
      if (!o) return;
      await showOrderDetail(o, productsMap, opticasById, { role, onLocalUpdate });
      return;
    }

    const btn = e.target?.closest('[data-page]');
    if (!btn) return;

    const dir = btn.dataset.page;
    const cur = Number(meta?.current_page || page);
    const last = Number(meta?.last_page || cur);

    let next = cur;
    if (dir === 'prev') next = Math.max(1, cur - 1);
    if (dir === 'next') next = Math.min(last, cur + 1);

    if (next === cur) return;

    await loadPage(next);
    renderTbody();
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