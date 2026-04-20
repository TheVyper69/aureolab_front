// public/assets/js/pages/pos.js
// FULL - actualizado para imágenes protegidas
// + biselado personalizado sin producto visible en POS
// + checkout compatible con OrdersController custom_bisel
// + refracción usando esfera, cilindro y eje
// + validaciones ópticas equivalentes:
//   - cilindro debe ser negativo y no puede ser 0
//   - si hay cilindro debe haber eje
//   - si hay eje debe haber cilindro
//   - eje entre 1 y 180

import { api } from '../services/api.js';
import { money } from '../utils/helpers.js';
import { authService } from '../services/authService.js';

let cart = [];
const imageUrlCache = new Map();

export async function renderPOS(outlet) {
  const DBG = (...args) => console.log('%cPOS_DEBUG', 'color:#7E57C2;font-weight:bold', ...args);

  const role = authService.getRole();
  const token = authService.getToken();
  const isOptica = role === 'optica';

  DBG('renderPOS start', { role, isOptica, hasToken: !!token });

  const CRITICAL_STOCK = 3;

  const safe = (v) => String(v ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

  const clampPct = (n) => Math.min(100, Math.max(0, Number(n || 0)));

  const warnNoStock = (name = 'Producto') => {
    Swal.fire({
      icon: 'warning',
      title: 'Ya no hay en inventario',
      text: `${name} no tiene stock suficiente.`,
      confirmButtonText: 'Entendido'
    });
  };

  const stockBadge = (available) => {
    const st = Number(available ?? 0);
    if (st <= 0) return `<span class="badge text-bg-secondary">Sin stock</span>`;
    if (st <= CRITICAL_STOCK) return `<span class="badge text-bg-danger">Crítico</span>`;
    return `<span class="badge text-bg-success">OK</span>`;
  };

  const PLACEHOLDER_IMG =
    `data:image/svg+xml;utf8,` +
    encodeURIComponent(`
      <svg xmlns="http://www.w3.org/2000/svg" width="640" height="360">
        <defs>
          <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#B39DDB"/>
            <stop offset="1" stop-color="#7E57C2"/>
          </linearGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#g)"/>
        <circle cx="320" cy="170" r="90" fill="rgba(255,255,255,0.25)"/>
        <path d="M235 170c28-44 142-44 170 0" fill="none" stroke="rgba(255,255,255,0.8)" stroke-width="14" stroke-linecap="round"/>
        <circle cx="275" cy="170" r="18" fill="rgba(255,255,255,0.9)"/>
        <circle cx="365" cy="170" r="18" fill="rgba(255,255,255,0.9)"/>
        <text x="50%" y="86%" dominant-baseline="middle" text-anchor="middle"
              font-family="Arial" font-size="22" fill="rgba(255,255,255,0.9)">
          Sin imagen
        </text>
      </svg>
    `);

  const fmtGrad = (g) => {
    if (!g) return '—';
    const sph = (g.sph ?? '').toString().trim();
    const cyl = (g.cyl ?? '').toString().trim();
    if (!sph && !cyl) return '—';
    return `SPH: <b>${safe(sph || '—')}</b> · CYL: <b>${safe(cyl || '—')}</b>`;
  };

  const fmtBisel = (b) => {
    if (!b) return '—';
    const axis = (b.axis ?? '').toString().trim();
    const notes = (b.notes ?? '').toString().trim();
    if (!axis && !notes) return '—';
    return `Eje: <b>${safe(axis || '—')}</b>${notes ? `<br/>Notas: <b>${safe(notes)}</b>` : ''}`;
  };

  const PAYMENT_METHOD_ID = { cash: 1, card: 2, transfer: 3 };

  const resolvePaymentMethodId = (methodKey) => {
    const id = PAYMENT_METHOD_ID[String(methodKey || '').toLowerCase()];
    return Number(id || 0);
  };

  let products = [];
  let inventory = [];
  let categoriesApi = [];
  let treatmentsCatalog = [];
  let lensTypesCatalog = [];

  let stockById = new Map();
  let reservedById = new Map();
  let availableById = new Map();

  let customers = [];
  let selectedCustomer = null;
  let opticaUserContext = { id: null, name: null, optica_id: null };

  const categoryById = new Map();

  const normalizeInventoryRows = (arr) => {
    const rows = Array.isArray(arr) ? arr : [];
    return rows
      .map(r => {
        const p = r?.product || null;
        const pid = Number(p?.id ?? r?.product_id ?? r?.id ?? 0) || 0;
        if (!pid) return null;

        const st = Number(r?.stock ?? 0);
        const rs = Number(r?.reserved ?? 0);
        const av = Number(r?.available ?? (st - rs));

        return {
          stock: st,
          reserved: rs,
          available: av,
          product: p || r
        };
      })
      .filter(Boolean);
  };

  const buildCategoryMap = () => {
    categoryById.clear();
    for (const c of (categoriesApi || [])) {
      const id = Number(c?.id || 0);
      if (!id) continue;
      categoryById.set(id, {
        id,
        code: String(c?.code || '').trim(),
        name: String(c?.name || '').trim(),
      });
    }
  };

  const getProductCategoryCode = (p) => {
    const direct = String(p?.category_code || p?.category || '').trim().toUpperCase();
    if (direct) return direct;

    const cid = Number(p?.category_id || 0);
    if (cid && categoryById.has(cid)) {
      return String(categoryById.get(cid)?.code || '').trim().toUpperCase();
    }

    return '';
  };

  const getProductCategoryLabel = (p) => {
    if (p?.category_name) return String(p.category_name);
    if (p?.category_label) return String(p.category_label);
    if (p?.category) return String(p.category);

    const cid = Number(p?.category_id || 0);
    if (cid && categoryById.has(cid)) {
      return categoryById.get(cid)?.name || '';
    }

    return '';
  };

  const isMicaProduct = (p) => {
    const code = String(getProductCategoryCode(p) || '').trim().toUpperCase();
    const label = String(getProductCategoryLabel(p) || '').trim().toUpperCase();

    return code === 'MICAS'
      || code === 'MICA'
      || label === 'MICAS'
      || label === 'MICA'
      || label.includes('MICA');
  };

  const buildStockMaps = () => {
    stockById = new Map();
    reservedById = new Map();
    availableById = new Map();

    for (const r of (inventory || [])) {
      const pid = Number(r?.product?.id ?? r?.product_id ?? r?.id ?? 0);
      if (!pid) continue;

      const st = Number(r?.stock ?? 0);
      const rs = Number(r?.reserved ?? 0);
      const av = Number(r?.available ?? (st - rs));

      stockById.set(pid, st);
      reservedById.set(pid, rs);
      availableById.set(pid, av);
    }
  };

  const getAvailable = (productId) => Number(availableById.get(Number(productId)) ?? 0);
  const getStockTotal = (productId) => Number(stockById.get(Number(productId)) ?? 0);
  const getReserved = (productId) => Number(reservedById.get(Number(productId)) ?? 0);

  const normalizeTreatments = (arr) => {
    return (Array.isArray(arr) ? arr : [])
      .map(v => {
        if (typeof v === 'object' && v !== null) {
          return {
            id: Number(v.id || 0),
            name: String(v.name || v.code || `Tratamiento ${v.id || ''}`).trim()
          };
        }
        return { id: Number(v || 0), name: '' };
      })
      .filter(x => x.id > 0)
      .reduce((acc, cur) => {
        if (!acc.find(x => x.id === cur.id)) acc.push(cur);
        return acc;
      }, []);
  };

  const treatmentIdsKey = (arr) => {
    return normalizeTreatments(arr)
      .map(x => x.id)
      .sort((a, b) => a - b)
      .join(',');
  };

  const makeCartKey = (itemLike) => {
    const pid = Number(itemLike?.id ?? itemLike?.product_id ?? 0);
    const variantId = Number(itemLike?.variant_id ?? 0);
    const axis = itemLike?.axis ?? '';
    const tKey = treatmentIdsKey(itemLike?.treatments ?? []);
    const customKey = itemLike?.custom_bisel
      ? JSON.stringify({
          sphere: itemLike.sphere ?? '',
          cylinder: itemLike.cylinder ?? '',
          axis: itemLike.axis ?? '',
          lens_type_id: itemLike.lens_type_id ?? '',
          frame_height: itemLike.frame_height ?? '',
          blank_height: itemLike.blank_height ?? '',
          observations: itemLike.observations ?? '',
          treatments: normalizeTreatments(itemLike.treatments || []).map(t => t.id).sort((a, b) => a - b)
        })
      : '';

    return `${pid}::${variantId}::${axis}::${tKey}::${customKey}`;
  };

  const getCartQtyForProduct = (productId) =>
    cart
      .filter(x => Number(x.id) === Number(productId) && !x.custom_bisel)
      .reduce((acc, x) => acc + Number(x.qty || 0), 0);

  async function loadCore() {
    DBG('loadCore -> /products + /inventory + /categories + /treatments + /lens-types');

    const [prodRes, invRes, catRes, trRes, ltRes] = await Promise.allSettled([
      api.get('/products'),
      api.get('/inventory'),
      api.get('/categories'),
      api.get('/treatments'),
      api.get('/lens-types'),
    ]);

    const prodData = (prodRes.status === 'fulfilled') ? (prodRes.value?.data ?? []) : [];
    const invData = (invRes.status === 'fulfilled') ? (invRes.value?.data ?? []) : [];
    categoriesApi = (catRes.status === 'fulfilled') ? (catRes.value?.data ?? []) : [];
    treatmentsCatalog = (trRes.status === 'fulfilled' && Array.isArray(trRes.value?.data)) ? trRes.value.data : [];
    lensTypesCatalog = (ltRes.status === 'fulfilled' && Array.isArray(ltRes.value?.data)) ? ltRes.value.data : [];

    buildCategoryMap();

    const productsLooksLikeInventory = Array.isArray(prodData) && prodData[0] && (prodData[0].product !== undefined);

    if (productsLooksLikeInventory) {
      inventory = normalizeInventoryRows(prodData);

      products = inventory.map(r => {
        const p = r.product || {};
        return {
          ...p,
          treatments: normalizeTreatments(p.treatments || []),
          category: p.category ?? p.category_name ?? getProductCategoryLabel(p),
          category_code: p.category_code ?? getProductCategoryCode(p),
          category_name: p.category_name ?? getProductCategoryLabel(p),
          __stock: r.stock,
          __reserved: r.reserved,
          __available: r.available,
        };
      });
    } else {
      products = (Array.isArray(prodData) ? prodData : []).map(p => ({
        ...p,
        treatments: normalizeTreatments(p.treatments || []),
        category: p.category ?? p.category_name ?? getProductCategoryLabel(p),
        category_code: p.category_code ?? getProductCategoryCode(p),
        category_name: p.category_name ?? getProductCategoryLabel(p),
      }));
      inventory = normalizeInventoryRows(invData);
    }

    buildStockMaps();
    DBG('products loaded', products.map(p => ({
      id: p.id,
      name: p.name,
      imageUrl: p.imageUrl
    })));
  }

  async function loadCustomersIfNeeded() {
    if (isOptica) return;
    try {
      const { data } = await api.get('/opticas');
      customers = Array.isArray(data) ? data : [];
    } catch (_e) {
      customers = [];
    }
  }

  async function loadOpticaUserContextIfNeeded() {
    if (!isOptica) return;

    try {
      const { data: me } = await api.get('/me');
      const u = me?.user || null;

      opticaUserContext = {
        id: Number(u?.id || 0) || null,
        name: String(u?.name || '').trim() || null,
        optica_id: Number(u?.optica_id || 0) || null
      };

      const box = outlet.querySelector('#opticaCustomerBox');
      if (box) box.textContent = opticaUserContext.name || 'Óptica';
    } catch (_e) {
      opticaUserContext = { id: null, name: null, optica_id: null };
    }
  }

  await loadCore();
  await Promise.all([loadCustomersIfNeeded(), loadOpticaUserContextIfNeeded()]);

  async function getProtectedImageUrl(product) {
    const pid = Number(product?.id || 0);
    if (!pid) return PLACEHOLDER_IMG;

    if (imageUrlCache.has(pid)) return imageUrlCache.get(pid);

    if (!token) {
      imageUrlCache.set(pid, PLACEHOLDER_IMG);
      return PLACEHOLDER_IMG;
    }

    const endpoint = product?.imageUrl || `/products/${pid}/image`;

    try {
      const blob = await api.getBlob(endpoint);

      if (!blob || blob.size === 0) {
        throw new Error('Empty image blob');
      }

      const url = URL.createObjectURL(blob);
      imageUrlCache.set(pid, url);
      return url;
    } catch (e) {
      console.error('POS image error', {
        productId: pid,
        endpoint,
        error: e?.message || e
      });

      imageUrlCache.set(pid, PLACEHOLDER_IMG);
      return PLACEHOLDER_IMG;
    }
  }

  async function hydrateImages(container) {
    const imgs = container.querySelectorAll('img[data-imgpid]');
    const tasks = [];

    for (const img of imgs) {
      const pid = Number(img.dataset.imgpid || 0);
      const product = products.find(p => Number(p.id) === pid);

      img.onerror = () => {
        img.onerror = null;
        img.src = PLACEHOLDER_IMG;
      };

      tasks.push((async () => {
        const url = await getProtectedImageUrl(product);
        img.src = url || PLACEHOLDER_IMG;
      })());
    }

    await Promise.allSettled(tasks);
  }

  const categories = () => Array.from(
    new Set((products || []).map(p => getProductCategoryLabel(p)).filter(Boolean))
  ).sort();

  let selectedCategory = 'ALL';
  let searchQuery = '';
  let discountMode = 'order';
  let orderDiscountPct = 0;

  outlet.innerHTML = `
    <div class="d-flex align-items-center justify-content-between mb-3">
      <h4 class="mb-0">Catálogo</h4>
    </div>

    <div class="card p-3 mb-3">
      <div class="d-flex flex-wrap gap-2 align-items-center justify-content-between">
        <div class="d-flex flex-wrap gap-2 align-items-center" id="posCategories"></div>

        <div class="input-group" style="max-width:420px;">
          <span class="input-group-text">🔎</span>
          <input id="posSearch" class="form-control" placeholder="Buscar por SKU o nombre..." />
        </div>
      </div>

      <div class="mt-3 d-flex flex-wrap gap-2">
        <button type="button" class="btn btn-outline-brand" id="btnCustomBisel">
          Ordenar biselado personalizado
        </button>
      </div>

      <div class="d-flex flex-wrap gap-3 align-items-center mt-3">
        ${
          isOptica
            ? ``
            : `
              <div class="d-flex flex-wrap gap-2 align-items-center">
                <label class="m-0">Descuento</label>

                <select id="discountMode" class="form-select form-select-sm" style="max-width:170px;">
                  <option value="order" selected>Por pedido total</option>
                  <option value="item">Por producto</option>
                </select>

                <input id="orderDiscount" type="number" min="0" max="100" value="0"
                       class="form-control form-control-sm" style="max-width:110px;"
                       placeholder="%"
                />
                <span id="orderDiscountHint" class="d-none"></span>
              </div>
            `
        }
      </div>
    </div>

    <div class="row g-3">
      <div class="col-lg-7">
        <div class="card p-3">
          <div class="d-flex align-items-center justify-content-between mb-2">
            <h6 class="mb-0">Productos</h6>
            <div id="posCount"></div>
          </div>
          <div id="productsGrid" class="row g-3"></div>
        </div>

        <div class="card p-3 mt-3">
          <h6 class="mb-0">Stock disponible</h6>
          <div class="table-responsive mt-2">
            <table class="table table-sm align-middle" id="tblPosStock" style="width:100%">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Producto</th>
                  <th>Categoría</th>
                  <th>Tipo</th>
                  <th class="text-end">Stock</th>
                  <th class="text-end">Reservado</th>
                  <th class="text-end">Disponible</th>
                  <th>Estatus</th>
                  <th class="text-end">Precio</th>
                </tr>
              </thead>
              <tbody id="posStockTbody"></tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="col-lg-5">
        <div class="card p-3">
          <h6>Carrito</h6>
          <div id="cartBox" class="mt-2"></div>
          <hr/>

          <div class="d-flex justify-content-between">
            <div>Subtotal</div>
            <div class="fw-bold" id="cartSubtotal">$0</div>
          </div>

          ${isOptica ? '' : `
            <div class="d-flex justify-content-between">
              <div>Descuento</div>
              <div class="fw-bold" id="cartDiscount">$0</div>
            </div>
          `}

          <div class="d-flex justify-content-between">
            <div>Total</div>
            <div class="fw-bold" id="cartTotal">$0</div>
          </div>

          <div class="mt-3">
            <label class="form-label">Método de pago</label>
            <select id="payMethod" class="form-select">
              <option value="cash">Efectivo</option>
              <option value="card">Tarjeta</option>
              <option value="transfer">Transferencia</option>
            </select>
          </div>

          ${
            isOptica
              ? `
                <div class="mt-3">
                  <label class="form-label">Cliente</label>
                  <div class="form-control bg-light" id="opticaCustomerBox">
                    ${safe(opticaUserContext.name || 'Óptica')}
                  </div>
                </div>
              `
              : `
                <div class="mt-3 position-relative">
                  <label class="form-label">Cliente</label>
                  <input type="hidden" id="customerId" value="" />
                  <input id="customerName" class="form-control" placeholder="Buscar óptica..." autocomplete="off">
                  <div id="customerSuggest" class="list-group position-absolute w-100"
                       style="z-index:2000; display:none; max-height:240px; overflow:auto;">
                  </div>
                </div>
              `
          }

          <button id="btnCheckout" type="button" class="btn btn-brand w-100 mt-3" disabled>
            Crear pedido
          </button>

          <div id="checkoutHint" class="d-none"></div>
        </div>
      </div>
    </div>
  `;

  const grid = outlet.querySelector('#productsGrid');
  const countEl = outlet.querySelector('#posCount');
  const btnCheckout = outlet.querySelector('#btnCheckout');
  const checkoutHint = outlet.querySelector('#checkoutHint');

  const categoryContainer = outlet.querySelector('#posCategories');
  const renderCategoryButtons = () => {
    const allCats = categories();
    categoryContainer.innerHTML = `
      <button class="btn btn-sm ${selectedCategory === 'ALL' ? 'btn-brand' : 'btn-outline-brand'}" data-cat="ALL">Todos</button>
      ${allCats.map(c => `
        <button class="btn btn-sm ${selectedCategory === c ? 'btn-brand' : 'btn-outline-brand'}" data-cat="${safe(c)}">${safe(c)}</button>
      `).join('')}
    `;
  };

  const discountModeSel = isOptica ? null : outlet.querySelector('#discountMode');
  const orderDiscountInp = isOptica ? null : outlet.querySelector('#orderDiscount');
  const orderDiscountHint = isOptica ? null : outlet.querySelector('#orderDiscountHint');

  const setCheckoutState = () => {
    const empty = cart.length === 0;
    btnCheckout.disabled = empty;
    if (checkoutHint) checkoutHint.style.display = 'none';
  };

  const matchesFilter = (p) => {
    const label = getProductCategoryLabel(p);
    const catOk = (selectedCategory === 'ALL') || (String(label) === String(selectedCategory));
    const q = searchQuery.trim().toLowerCase();
    const qOk = !q || String(p.sku || '').toLowerCase().includes(q) || String(p.name || '').toLowerCase().includes(q);
    return catOk && qOk;
  };

  function renderStockTableBody() {
    const tbody = outlet.querySelector('#posStockTbody');
    tbody.innerHTML = (inventory || []).map(r => {
      const p = r.product || r;
      const st = Number(r.stock ?? 0);
      const rs = Number(r.reserved ?? 0);
      const av = Number(r.available ?? (st - rs));

      return `
        <tr class="${av <= CRITICAL_STOCK ? 'table-warning' : ''}">
          <td>${safe(p.sku || '')}</td>
          <td>${safe(p.name || '')}</td>
          <td>${safe(getProductCategoryLabel(p) || '—')}</td>
          <td>${safe(p.type || '')}</td>
          <td class="text-end fw-semibold">${st}</td>
          <td class="text-end">${rs}</td>
          <td class="text-end fw-semibold">${av}</td>
          <td>${stockBadge(av)}</td>
          <td class="text-end">${money(p.salePrice ?? p.sale_price ?? 0)}</td>
        </tr>
      `;
    }).join('');
  }

  function ensureDataTable() {
    if (!(window.$ && $.fn.dataTable)) return;

    if ($.fn.DataTable.isDataTable('#tblPosStock')) {
      $('#tblPosStock').DataTable().destroy();
    }

    $('#tblPosStock').DataTable({
      pageLength: 8,
      order: [[6, 'asc']],
      language: {
        search: 'Buscar:',
        lengthMenu: 'Mostrar _MENU_',
        info: 'Mostrando _START_ a _END_ de _TOTAL_',
        paginate: { previous: 'Anterior', next: 'Siguiente' },
        zeroRecords: 'No hay registros'
      }
    });
  }

  function refreshInventoryTable() {
    if (window.$ && $.fn.dataTable && $.fn.DataTable.isDataTable('#tblPosStock')) {
      $('#tblPosStock').DataTable().destroy();
    }
    renderStockTableBody();
    ensureDataTable();
  }

  const treatmentsHtmlBlock = (arr) => {
    const rows = normalizeTreatments(arr || []);
    if (!rows.length) return '';
    return `
      <div class="small text-muted mt-1">
        Tratamientos: <b>${safe(rows.map(x => x.name || `#${x.id}`).join(', '))}</b>
      </div>
    `;
  };

  const renderCards = async () => {
    const filtered = (products || []).filter(matchesFilter);
    countEl.textContent = `${filtered.length} producto(s)`;

    if (filtered.length === 0) {
      grid.innerHTML = `
        <div class="col-12">
          <div class="alert alert-light border mb-0">No hay productos con ese filtro.</div>
        </div>
      `;
      return;
    }

    grid.innerHTML = filtered.map(p => {
      const available = getAvailable(p.id);
      const disabled = available <= 0 ? 'disabled' : '';
      const critical = available > 0 && available <= CRITICAL_STOCK;

      return `
        <div class="col-12 col-sm-6 col-xl-4">
          <div class="card h-100 ${critical ? 'border-warning' : ''}">
            <div style="width:100%; aspect-ratio: 16/10; overflow:hidden; background:#f8f9fa;">
              <img
                src="${PLACEHOLDER_IMG}"
                data-imgpid="${p.id}"
                alt="${safe(p.name || 'Producto')}"
                style="width:100%; height:100%; object-fit:cover; display:block;"
                loading="lazy"
              />
            </div>

            <div class="card-body d-flex flex-column">
              <div class="d-flex align-items-start justify-content-between gap-2">
                <div class="fw-semibold" style="white-space: normal; overflow: visible;">
                  ${safe(p.name)}
                </div>
                <div class="text-end">
                  <div>${safe(p.sku)}</div>
                  <div>${stockBadge(available)}</div>
                </div>
              </div>

              <div class="mt-1">
                ${getProductCategoryLabel(p) ? `<span class="me-2"><b>${safe(getProductCategoryLabel(p))}</b></span>` : ''}
                ${p.type ? `<span>${safe(p.type)}</span>` : ''}
              </div>

              ${treatmentsHtmlBlock(p.treatments)}

              <div class="mt-2 d-flex align-items-center justify-content-between">
                <div class="fw-bold">${money(p.salePrice ?? p.sale_price ?? 0)}</div>
                <div class="${critical ? 'text-danger' : ''}">
                  Disponible: <b>${available}</b>
                </div>
              </div>

              <div class="mt-3 d-flex gap-2">
                <button type="button" class="btn btn-brand flex-grow-1" data-add="${p.id}" ${disabled}>Agregar</button>
                <button type="button" class="btn btn-outline-brand btn-sm" data-details="${p.id}" title="Ver detalles">
                  Detalles
                </button>
              </div>

              ${
                available <= 0
                  ? ``
                  : (critical ? `<div class="mt-2 text-danger">Stock crítico</div>` : ``)
              }
            </div>
          </div>
        </div>
      `;
    }).join('');

    await hydrateImages(grid);
  };

  const showProductDetails = async (p) => {
    const available = getAvailable(p.id);
    const totalStock = getStockTotal(p.id);
    const reserved = getReserved(p.id);

    const desc = (p.description ?? '').toString().trim();
    const g = p.graduation || null;
    const b = p.bisel || null;
    const catCode = getProductCategoryCode(p);
    const imgUrl = await getProtectedImageUrl(p);

    const graduacionHtml =
      (catCode === 'MICAS' || catCode === 'LENTES CONTACTO')
        ? `<div class="mt-3"><div class="fw-semibold">Graduación</div><div>${fmtGrad(g)}</div></div>`
        : `<div class="mt-3"><div class="fw-semibold">Graduación</div><div>—</div></div>`;

    const biselHtml =
      (catCode === 'BISEL')
        ? `<div class="mt-3"><div class="fw-semibold">Bisel</div><div>${fmtBisel(b)}</div></div>`
        : `<div class="mt-3"><div class="fw-semibold">Bisel</div><div>—</div></div>`;

    const buyPriceHtml = isOptica ? '' : `
      <div class="col-6">
        <div>Precio compra</div>
        <div class="fw-semibold">${money(p.buyPrice ?? p.buy_price ?? 0)}</div>
      </div>
    `;

    const treatmentsHtml = normalizeTreatments(p.treatments || []).length
      ? `
        <div class="mt-3">
          <div class="fw-semibold">Tratamientos</div>
          <div class="small text-muted">
            ${safe(normalizeTreatments(p.treatments || []).map(x => x.name || `#${x.id}`).join(', '))}
          </div>
        </div>
      `
      : `
        <div class="mt-3">
          <div class="fw-semibold">Tratamientos</div>
          <div class="small text-muted">—</div>
        </div>
      `;

    const html = `
      <div class="text-start">
        <div class="d-flex gap-3 align-items-start">
          <img
            src="${imgUrl}"
            alt="${safe(p.name)}"
            style="width:120px;height:120px;object-fit:cover;border-radius:12px;border:1px solid #e9ecef;"
          />
          <div style="min-width:0;">
            <div class="fw-bold">${safe(p.name)}</div>
            <div>${safe(p.sku)}</div>
            <div class="mt-1">${stockBadge(available)}
              <span class="ms-2">
                Disponible: <b>${available}</b> · Stock: ${totalStock} · Res: ${reserved}
              </span>
            </div>
            <div class="mt-2 fw-bold">${money(p.salePrice ?? p.sale_price ?? 0)}</div>
          </div>
        </div>

        <hr class="my-3"/>

        <div class="row g-2">
          <div class="col-6">
            <div>Categoría</div>
            <div class="fw-semibold">${safe(getProductCategoryLabel(p) || '—')}</div>
          </div>
          <div class="col-6">
            <div>Tipo</div>
            <div class="fw-semibold">${safe(p.type || '—')}</div>
          </div>

          ${buyPriceHtml}

          <div class="col-6">
            <div>Proveedor</div>
            <div class="fw-semibold">${safe(p.supplier || '—')}</div>
          </div>
        </div>

        <div class="mt-3">
          <div class="fw-semibold">Descripción</div>
          <div>${desc ? safe(desc) : '—'}</div>
        </div>

        ${treatmentsHtml}
        ${graduacionHtml}
        ${biselHtml}
      </div>
    `;

    const r = await Swal.fire({
      title: 'Detalle del producto',
      html,
      width: 720,
      showCancelButton: true,
      confirmButtonText: 'Agregar al carrito',
      cancelButtonText: 'Cerrar',
      focusConfirm: false
    });

    if (r.isConfirmed) await addToCart(p);
  };

  const calcTotals = () => {
    const subtotal = cart.reduce((a, i) => a + (Number(i.salePrice || i.sale_price || 0) * Number(i.qty || 0)), 0);

    if (isOptica) {
      return { subtotal, discountAmount: 0, total: subtotal, orderDiscountPct: 0 };
    }

    if (discountMode === 'order') {
      const pct = clampPct(orderDiscountPct);
      const discountAmount = subtotal * (pct / 100);
      const total = subtotal - discountAmount;
      return { subtotal, discountAmount, total, orderDiscountPct: pct };
    }

    let discountAmount = 0;
    for (const it of cart) {
      const pct = clampPct(it.itemDiscountPct || 0);
      discountAmount += (Number(it.salePrice || it.sale_price || 0) * Number(it.qty || 0)) * (pct / 100);
    }
    const total = subtotal - discountAmount;
    return { subtotal, discountAmount, total, orderDiscountPct: 0 };
  };

  const treatmentsHtml = (it) => {
    const arr = normalizeTreatments(it.treatments || []);
    if (!arr.length) return '';
    return `
      <div class="mt-1">
        Tratamientos: <b>${safe(arr.map(x => x.name || `#${x.id}`).join(', '))}</b>
      </div>
    `;
  };

  const customBiselHtml = (it) => {
    if (!it.custom_bisel) return '';

    const treatmentText = normalizeTreatments(it.treatments || [])
      .map(x => x.name || `#${x.id}`)
      .join(', ');

    return `
      <div class="mt-1 border rounded p-2 bg-light">
        <div><b>Esfera:</b> ${safe(it.sphere ?? '—')}</div>
        <div><b>Cilindro:</b> ${safe(it.cylinder ?? '—')}</div>
        <div><b>Eje:</b> ${safe(it.axis ?? '—')}</div>
        <div><b>Tipo de lente:</b> ${safe(it.lens_type_name || '—')}</div>
        <div><b>Altura de armazón:</b> ${safe(it.frame_height ?? '—')}</div>
        <div><b>Altura de oblea:</b> ${safe(it.blank_height ?? '—')}</div>
        <div><b>Tratamientos:</b> ${safe(treatmentText || '—')}</div>
        <div><b>Observaciones:</b> ${safe(it.observations || '—')}</div>
      </div>
    `;
  };

  const renderCart = () => {
    const box = outlet.querySelector('#cartBox');

    if (cart.length === 0) {
      box.innerHTML = `<div class="text-muted">Carrito vacío</div>`;
      outlet.querySelector('#cartSubtotal').textContent = money(0);
      if (!isOptica) outlet.querySelector('#cartDiscount').textContent = money(0);
      outlet.querySelector('#cartTotal').textContent = money(0);
      setCheckoutState();
      return;
    }

    box.innerHTML = cart.map(it => {
      const isCustom = !!it.custom_bisel;
      const available = isCustom ? 999999 : getAvailable(it.id);
      const totalAlreadyInCartForProduct = isCustom ? 0 : getCartQtyForProduct(it.id);
      const remainingForThisLine = isCustom
        ? 999999
        : Math.max(0, available - (totalAlreadyInCartForProduct - Number(it.qty || 0)));
      const atLimit = !isCustom && Number(it.qty || 0) >= remainingForThisLine;

      const itemDisc = isOptica ? '' : `
        <div class="mt-1 ${discountMode === 'item' ? '' : 'd-none'}" data-itemdiscbox="${it.cart_key}">
          <div class="d-flex align-items-center gap-2">
            <span>Desc %</span>
            <input type="number" min="0" max="100"
              class="form-control form-control-sm"
              style="max-width:90px;"
              value="${clampPct(it.itemDiscountPct || 0)}"
              data-itemdisc="${it.cart_key}"
              ${discountMode === 'item' ? '' : 'disabled'}
            />
          </div>
        </div>
      `;

      return `
        <div class="d-flex justify-content-between border rounded p-2 mb-2">
          <div style="min-width:0;">
            <div class="fw-semibold">${safe(it.name)}</div>
            <div>${safe(it.sku || 'CUSTOM-BISEL')} · ${money(it.salePrice ?? it.sale_price ?? 0)} · ${isCustom ? 'Personalizado' : `Disponible: ${available}`}</div>
            ${treatmentsHtml(it)}
            ${customBiselHtml(it)}
            ${!isCustom && available <= CRITICAL_STOCK && available > 0 ? `<div class="text-danger">Stock crítico</div>` : ``}
            ${itemDisc}
          </div>

          <div class="d-flex gap-2 align-items-center">
            <button type="button" class="btn btn-sm btn-outline-secondary" data-dec="${safe(it.cart_key)}">-</button>
            <div class="fw-bold">${it.qty}</div>
            <button type="button" class="btn btn-sm btn-outline-secondary" data-inc="${safe(it.cart_key)}" ${atLimit ? 'disabled' : ''}>+</button>
            <button type="button" class="btn btn-sm btn-outline-danger" data-del="${safe(it.cart_key)}">x</button>
          </div>
        </div>
      `;
    }).join('');

    const t = calcTotals();
    outlet.querySelector('#cartSubtotal').textContent = money(t.subtotal);
    if (!isOptica) outlet.querySelector('#cartDiscount').textContent = money(t.discountAmount);
    outlet.querySelector('#cartTotal').textContent = money(t.total);

    setCheckoutState();
  };

  async function selectTreatmentsForProduct(p) {
    if (!isOptica || !isMicaProduct(p)) return [];

    try {
      const { data } = await api.get(`/products/${Number(p.id)}/treatments`);
      const rows = Array.isArray(data) ? data : [];

      if (!rows.length) {
        await Swal.fire({
          icon: 'info',
          title: 'Sin tratamientos disponibles',
          text: 'Esta mica no tiene tratamientos configurados.'
        });
        return [];
      }

      const html = rows.map(t => `
        <div class="form-check text-start mb-2">
          <input class="form-check-input js-treatment-check" type="checkbox" value="${Number(t.id)}" id="tr_${Number(t.id)}">
          <label class="form-check-label" for="tr_${Number(t.id)}">
            ${safe(t.name || t.code || `Tratamiento ${t.id}`)}
          </label>
          ${t.description ? `<div class="ms-4">${safe(t.description)}</div>` : ''}
        </div>
      `).join('');

      const result = await Swal.fire({
        title: 'Selecciona tratamientos',
        html: `<div style="max-height:320px;overflow:auto;text-align:left;">${html}</div>`,
        showCancelButton: true,
        confirmButtonText: 'Agregar',
        cancelButtonText: 'Cancelar',
        focusConfirm: false,
        preConfirm: () => {
          return Array.from(document.querySelectorAll('.js-treatment-check:checked')).map(el => {
            const id = Number(el.value || 0);
            const row = rows.find(x => Number(x.id) === id);
            return {
              id,
              name: row?.name || row?.code || `Tratamiento ${id}`
            };
          });
        }
      });

      if (!result.isConfirmed) return null;
      return normalizeTreatments(result.value || []);
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || 'No se pudieron cargar tratamientos';
      await Swal.fire('Error', msg, 'error');
      return null;
    }
  }

  function renderCustomTreatmentRows(selected = []) {
    const selectedIds = normalizeTreatments(selected).map(t => t.id);

    const makeSelect = (currentId = '') => {
      const currentNum = Number(currentId || 0);

      const options = (treatmentsCatalog || [])
        .filter(t => {
          const id = Number(t.id);
          return id === currentNum || !selectedIds.includes(id);
        })
        .map(t => `<option value="${Number(t.id)}" ${Number(t.id) === currentNum ? 'selected' : ''}>${safe(t.name || t.code || `Tratamiento ${t.id}`)}</option>`)
        .join('');

      return `
        <div class="input-group mb-2 js-custom-treatment-row">
          <select class="form-select js-custom-treatment-select">
            <option value="">Selecciona tratamiento</option>
            ${options}
          </select>
          <button type="button" class="btn btn-outline-danger js-remove-custom-treatment">×</button>
        </div>
      `;
    };

    if (!selectedIds.length) return makeSelect('');
    return selectedIds.map(id => makeSelect(id)).join('');
  }

  async function openCustomBiselModal() {
    if (!isOptica) {
      await Swal.fire('No permitido', 'Esta opción está pensada para el flujo de óptica.', 'warning');
      return;
    }

    if (!Array.isArray(lensTypesCatalog) || !lensTypesCatalog.length) {
      await Swal.fire('Falta catálogo', 'No se pudieron cargar los tipos de lente.', 'warning');
      return;
    }

    const lensOptions = lensTypesCatalog.map(lt => `
      <option value="${Number(lt.id)}">${safe(lt.name || lt.code || `Tipo ${lt.id}`)}</option>
    `).join('');

    const html = `
      <div class="text-start">
        <div class="row g-3">
          <div class="col-md-4">
            <label class="form-label">Esfera</label>
            <input id="customBiselSphere" type="number" step="0.01" class="form-control" placeholder="Ej. -2.00" />
          </div>

          <div class="col-md-4">
            <label class="form-label">Cilindro</label>
            <input id="customBiselCylinder" type="number" step="0.01" class="form-control" placeholder="Ej. -0.50" />
          </div>

          <div class="col-md-4">
            <label class="form-label">Eje</label>
            <input id="customBiselAxis" type="number" min="1" max="180" step="1" class="form-control" placeholder="Ej. 90" disabled />
          </div>
        </div>

        <div class="mb-3 mt-3">
          <label class="form-label">Tratamiento</label>
          <div id="customBiselTreatmentsBox">
            ${renderCustomTreatmentRows([])}
          </div>
          <button type="button" class="btn btn-sm btn-outline-brand mt-2" id="btnAddCustomTreatment">
            Agregar tratamiento
          </button>
        </div>

        <div class="mb-3">
          <label class="form-label">Tipo de lente</label>
          <select id="customBiselLensType" class="form-select">
            <option value="">Selecciona tipo de lente</option>
            ${lensOptions}
          </select>
        </div>

        <div class="mb-3">
          <label class="form-label">Altura de armazón</label>
          <input id="customBiselFrameHeight" type="number" min="0" step="0.01" class="form-control" placeholder="Ej. 50" />
          <div class="mt-2">
            <b>Altura de la oblea:</b> <span id="customBiselBlankHeightText">—</span>
          </div>
        </div>

        <div class="mb-3">
          <label class="form-label">Observaciones</label>
          <textarea id="customBiselObservations" class="form-control" rows="3" placeholder="Observaciones"></textarea>
        </div>
      </div>
    `;

    const bindCustomTreatmentEvents = () => {
      const box = document.getElementById('customBiselTreatmentsBox');
      if (!box) return;

      box.querySelectorAll('.js-remove-custom-treatment').forEach(btn => {
        btn.onclick = () => {
          const rows = box.querySelectorAll('.js-custom-treatment-row');
          if (rows.length <= 1) {
            const sel = btn.closest('.js-custom-treatment-row')?.querySelector('.js-custom-treatment-select');
            if (sel) sel.value = '';
            return;
          }
          btn.closest('.js-custom-treatment-row')?.remove();
          refreshCustomTreatmentOptions();
        };
      });

      box.querySelectorAll('.js-custom-treatment-select').forEach(sel => {
        sel.onchange = () => refreshCustomTreatmentOptions();
      });
    };

    const refreshCustomTreatmentOptions = () => {
      const box = document.getElementById('customBiselTreatmentsBox');
      if (!box) return;

      const currentValues = Array.from(box.querySelectorAll('.js-custom-treatment-select'))
        .map(el => Number(el.value || 0));

      const rows = Array.from(box.querySelectorAll('.js-custom-treatment-row'));

      rows.forEach((row, idx) => {
        const sel = row.querySelector('.js-custom-treatment-select');
        const current = Number(sel.value || 0);

        const others = currentValues.filter((_, i) => i !== idx && currentValues[i] > 0);

        sel.innerHTML = `
          <option value="">Selecciona tratamiento</option>
          ${(treatmentsCatalog || [])
            .filter(t => {
              const id = Number(t.id);
              return id === current || !others.includes(id);
            })
            .map(t => `<option value="${Number(t.id)}" ${Number(t.id) === current ? 'selected' : ''}>${safe(t.name || t.code || `Tratamiento ${t.id}`)}</option>`)
            .join('')}
        `;
      });

      bindCustomTreatmentEvents();
    };

    const recalcBlankHeight = () => {
      const frameInput = document.getElementById('customBiselFrameHeight');
      const out = document.getElementById('customBiselBlankHeightText');
      if (!frameInput || !out) return;

      const frameHeight = Number(frameInput.value || 0);
      if (!frameInput.value || Number.isNaN(frameHeight) || frameHeight <= 0) {
        out.textContent = '—';
        return;
      }

      const blankHeight = (frameHeight / 2) - 2;
      out.textContent = Number.isFinite(blankHeight) ? blankHeight.toFixed(2) : '—';
    };

    const result = await Swal.fire({
      title: 'Ordenar biselado personalizado',
      html,
      width: 720,
      showCancelButton: true,
      confirmButtonText: 'Agregar al carrito',
      cancelButtonText: 'Cancelar',
      focusConfirm: false,
      didOpen: () => {
        const addBtn = document.getElementById('btnAddCustomTreatment');
        const box = document.getElementById('customBiselTreatmentsBox');
        const frameInput = document.getElementById('customBiselFrameHeight');
        const cylinderInput = document.getElementById('customBiselCylinder');
        const axisInput = document.getElementById('customBiselAxis');

        const syncAxisState = () => {
          if (!axisInput || !cylinderInput) return;

          const cylinderRaw = String(cylinderInput.value || '').trim();
          const hasCylinder = cylinderRaw !== '';

          axisInput.disabled = !hasCylinder;

          if (!hasCylinder) {
            axisInput.value = '';
          }
        };

        addBtn?.addEventListener('click', () => {
          const wrapper = document.createElement('div');
          wrapper.innerHTML = renderCustomTreatmentRows([]);
          const row = wrapper.firstElementChild;
          if (row) box.appendChild(row);
          refreshCustomTreatmentOptions();
        });

        frameInput?.addEventListener('input', recalcBlankHeight);
        cylinderInput?.addEventListener('input', syncAxisState);

        bindCustomTreatmentEvents();
        refreshCustomTreatmentOptions();
        recalcBlankHeight();
        syncAxisState();
      },
      preConfirm: () => {
        const sphereRaw = String(document.getElementById('customBiselSphere')?.value || '').trim();
        const cylinderRaw = String(document.getElementById('customBiselCylinder')?.value || '').trim();
        const axisRaw = String(document.getElementById('customBiselAxis')?.value || '').trim();

        const lensTypeId = Number(document.getElementById('customBiselLensType')?.value || 0);
        const frameHeight = Number(document.getElementById('customBiselFrameHeight')?.value || 0);
        const observations = String(document.getElementById('customBiselObservations')?.value || '').trim();

        const blankHeight = Number(((frameHeight / 2) - 2).toFixed(2));

        const selectedTreatments = Array.from(document.querySelectorAll('.js-custom-treatment-select'))
          .map(el => Number(el.value || 0))
          .filter(Boolean)
          .map(id => {
            const row = treatmentsCatalog.find(t => Number(t.id) === id);
            return { id, name: row?.name || row?.code || `Tratamiento ${id}` };
          });

        if (!lensTypeId) {
          Swal.showValidationMessage('Debes seleccionar tipo de lente.');
          return false;
        }

        if (!frameHeight || Number.isNaN(frameHeight) || frameHeight <= 0) {
          Swal.showValidationMessage('La altura de armazón debe ser mayor a 0.');
          return false;
        }

        if (!blankHeight || Number.isNaN(blankHeight) || blankHeight <= 0) {
          Swal.showValidationMessage('La altura de la oblea calculada no es válida.');
          return false;
        }

        const sphere = sphereRaw === '' ? null : Number(sphereRaw);
        const cylinder = cylinderRaw === '' ? null : Number(cylinderRaw);
        const axis = axisRaw === '' ? null : Number(axisRaw);

        if (sphereRaw !== '' && Number.isNaN(sphere)) {
          Swal.showValidationMessage('La esfera debe ser numérica.');
          return false;
        }

        if (cylinderRaw !== '' && Number.isNaN(cylinder)) {
          Swal.showValidationMessage('El cilindro debe ser numérico.');
          return false;
        }

        if (axisRaw !== '' && Number.isNaN(axis)) {
          Swal.showValidationMessage('El eje debe ser numérico.');
          return false;
        }

        if (cylinder !== null && cylinder >= 0) {
          Swal.showValidationMessage('El cilindro debe ser negativo y no puede ser 0.');
          return false;
        }

        if (cylinder !== null && axis === null) {
          Swal.showValidationMessage('Si capturas cilindro debes capturar el eje.');
          return false;
        }

        if (cylinder === null && axis !== null) {
          Swal.showValidationMessage('Si capturas eje debes capturar cilindro.');
          return false;
        }

        if (axis !== null && (axis < 1 || axis > 180)) {
          Swal.showValidationMessage('El eje debe estar entre 1 y 180.');
          return false;
        }

        const lensType = lensTypesCatalog.find(x => Number(x.id) === lensTypeId);

        return {
          sphere,
          cylinder,
          axis,
          lens_type_id: lensTypeId,
          lens_type_name: lensType?.name || lensType?.code || `Tipo ${lensTypeId}`,
          frame_height: frameHeight,
          blank_height: blankHeight,
          observations,
          treatments: normalizeTreatments(selectedTreatments),
        };
      }
    });

    if (!result.isConfirmed || !result.value) return;

    const cfg = result.value;

    const customItem = {
      id: -1,
      sku: `BIS-CUSTOM-${Date.now()}`,
      name: 'Biselado personalizado',
      salePrice: 0,
      buyPrice: 0,
      qty: 1,
      itemDiscountPct: 0,
      custom_bisel: true,
      sphere: cfg.sphere,
      cylinder: cfg.cylinder,
      axis: cfg.axis,
      lens_type_id: cfg.lens_type_id,
      lens_type_name: cfg.lens_type_name,
      frame_height: cfg.frame_height,
      blank_height: cfg.blank_height,
      observations: cfg.observations || null,
      treatments: normalizeTreatments(cfg.treatments || []),
      item_notes: cfg.observations || null
    };

    const cart_key = makeCartKey(customItem);

    cart.push({
      ...customItem,
      cart_key
    });

    renderCart();
  }

  const addToCart = async (p) => {
    const available = getAvailable(p.id);
    if (available <= 0) {
      warnNoStock(p.name);
      return false;
    }

    let selectedTreatments = normalizeTreatments(p.treatments || []);

    if (isOptica && isMicaProduct(p)) {
      const picked = await selectTreatmentsForProduct(p);
      if (picked === null) return false;
      selectedTreatments = picked;
    }

    const baseItem = {
      ...p,
      salePrice: p.salePrice ?? p.sale_price ?? 0,
      buyPrice: p.buyPrice ?? p.buy_price ?? 0,
      qty: 1,
      itemDiscountPct: 0,
      treatments: selectedTreatments,
    };

    const cart_key = makeCartKey(baseItem);
    const totalInCartSameProduct = getCartQtyForProduct(p.id);

    if (totalInCartSameProduct + 1 > available) {
      warnNoStock(p.name);
      return false;
    }

    const found = cart.find(i => String(i.cart_key) === String(cart_key));
    if (found) {
      found.qty = Number(found.qty || 0) + 1;
    } else {
      cart.push({
        ...baseItem,
        cart_key
      });
    }

    renderCart();
    return true;
  };

  function mountCustomerAutocomplete() {
    if (isOptica) return;

    const input = outlet.querySelector('#customerName');
    const hidden = outlet.querySelector('#customerId');
    const box = outlet.querySelector('#customerSuggest');

    if (!input || !hidden || !box) return;

    const getId = (c) => {
      const n = Number(c?.user_id || 0);
      return Number.isFinite(n) && n > 0 ? n : null;
    };

    const getName = (c) => String(c?.customer_name || c?.name || '').trim();

    const getMeta = (c) => {
      const email = c?.email ? `· ${c.email}` : '';
      const phone = c?.phone ? `· ${c.phone}` : '';
      return `${email} ${phone}`.trim();
    };

    const hide = () => { box.style.display = 'none'; box.innerHTML = ''; };
    const show = () => { box.style.display = 'block'; };

    const pick = (c) => {
      const id = getId(c);
      const name = getName(c);
      if (!id) return;

      selectedCustomer = { id, name };
      hidden.value = String(id);
      input.value = name;
      hide();
    };

    const renderList = (matches) => {
      box.innerHTML = matches.map((c) => {
        const id = getId(c);
        const name = getName(c);
        const meta = getMeta(c);

        return `
          <button type="button"
                  class="list-group-item list-group-item-action"
                  data-custid="${id ?? ''}">
            <div class="fw-semibold">${safe(name || '(Sin nombre)')}</div>
            ${meta ? `<div>${safe(meta)}</div>` : ''}
          </button>
        `;
      }).join('');
      show();
    };

    const filterMatches = () => {
      selectedCustomer = null;
      hidden.value = '';

      const q = String(input.value || '').trim().toLowerCase();
      if (!q || customers.length === 0) { hide(); return []; }

      const matches = customers
        .filter(c => {
          const name = getName(c).toLowerCase();
          const email = String(c?.email || '').toLowerCase();
          const phone = String(c?.phone || '').toLowerCase();
          return name.includes(q) || email.includes(q) || phone.includes(q);
        })
        .slice(0, 10);

      if (matches.length === 0) { hide(); return []; }
      renderList(matches);
      return matches;
    };

    input.addEventListener('input', filterMatches);
    input.addEventListener('focus', () => { if (String(input.value || '').trim()) filterMatches(); });

    const handlePickFromEvent = (e) => {
      const btn = e.target?.closest('[data-custid]');
      if (!btn) return;
      e.preventDefault();

      const id = Number(btn.dataset.custid || 0);
      if (!id) return;

      const c = customers.find(x => getId(x) === id);
      if (c) pick(c);
    };

    box.addEventListener('mousedown', handlePickFromEvent);
    box.addEventListener('click', handlePickFromEvent);

    input.addEventListener('blur', () => setTimeout(() => hide(), 150));
  }

  outlet.addEventListener('click', async (e) => {
    const addId = e.target?.dataset?.add;
    const detailsId = e.target?.dataset?.details;
    const incKey = e.target?.dataset?.inc;
    const decKey = e.target?.dataset?.dec;
    const delKey = e.target?.dataset?.del;
    const catBtn = e.target?.closest('[data-cat]');

    if (catBtn) {
      selectedCategory = String(catBtn.dataset.cat || 'ALL');
      renderCategoryButtons();
      await renderCards();
      return;
    }

    if (detailsId) {
      const p = products.find(x => String(x.id) === String(detailsId));
      if (p) await showProductDetails(p);
      return;
    }

    if (addId) {
      const p = products.find(x => String(x.id) === String(addId));
      if (p) await addToCart(p);
      return;
    }

    if (incKey) {
      const it = cart.find(x => String(x.cart_key) === String(incKey));
      if (it) {
        if (!it.custom_bisel) {
          const available = getAvailable(it.id);
          const totalForProduct = getCartQtyForProduct(it.id);
          if (totalForProduct + 1 > available) {
            warnNoStock(it.name);
            return;
          }
        }
        it.qty++;
        renderCart();
      }
      return;
    }

    if (decKey) {
      const it = cart.find(x => String(x.cart_key) === String(decKey));
      if (it) {
        it.qty = Math.max(1, it.qty - 1);
        renderCart();
      }
      return;
    }

    if (delKey) {
      cart = cart.filter(x => String(x.cart_key) !== String(delKey));
      renderCart();
      return;
    }
  });

  outlet.querySelector('#posSearch')?.addEventListener('input', async (e) => {
    searchQuery = String(e.target.value || '');
    await renderCards();
  });

  outlet.querySelector('#btnCustomBisel')?.addEventListener('click', async () => {
    await openCustomBiselModal();
  });

  if (!isOptica) {
    discountModeSel.addEventListener('change', () => {
      discountMode = discountModeSel.value === 'item' ? 'item' : 'order';

      if (discountMode === 'order') {
        if (orderDiscountHint) orderDiscountHint.textContent = 'Aplica a todo el pedido.';
        orderDiscountInp.disabled = false;
      } else {
        if (orderDiscountHint) orderDiscountHint.textContent = 'Define descuento por cada producto en el carrito.';
        orderDiscountInp.disabled = true;
      }

      outlet.querySelectorAll('[data-itemdiscbox]').forEach(box => {
        box.classList.toggle('d-none', discountMode !== 'item');
      });
      outlet.querySelectorAll('[data-itemdisc]').forEach(inp => {
        inp.disabled = discountMode !== 'item';
      });

      renderCart();
    });

    orderDiscountInp.addEventListener('input', () => {
      orderDiscountPct = clampPct(orderDiscountInp.value);
      renderCart();
    });

    outlet.addEventListener('input', (e) => {
      const key = e.target?.dataset?.itemdisc;
      if (!key) return;
      if (discountMode !== 'item') return;

      const it = cart.find(x => String(x.cart_key) === String(key));
      if (!it) return;
      it.itemDiscountPct = clampPct(e.target.value);
      renderCart();
    });
  }

  outlet.querySelector('#btnCheckout')?.addEventListener('click', async (e) => {
    e.preventDefault();
    if (cart.length === 0) return;

    const productQtyMap = new Map();
    for (const it of cart) {
      if (it.custom_bisel) continue;
      const pid = Number(it.id);
      const prev = Number(productQtyMap.get(pid) || 0);
      productQtyMap.set(pid, prev + Number(it.qty || 0));
    }

    for (const [pid, qty] of productQtyMap.entries()) {
      const available = getAvailable(pid);
      const p = products.find(x => Number(x.id) === pid);
      if (qty > available) {
        warnNoStock(p?.name || 'Producto');
        return;
      }
    }

    const methodKey = outlet.querySelector('#payMethod').value;
    const payment_method_id = resolvePaymentMethodId(methodKey);
    if (!payment_method_id) {
      Swal.fire('Método inválido', 'Configura PAYMENT_METHOD_ID en pos.js con los IDs reales.', 'warning');
      return;
    }

    const t = calcTotals();

    const items = cart.map(it => {
      const qty = Number(it.qty || 0);
      const unit_price = Number(it.salePrice ?? it.sale_price ?? 0);

      let item_discount_type = 'none';
      let item_discount_value = 0;

      if (!isOptica && discountMode === 'item') {
        const pct = clampPct(it.itemDiscountPct || 0);
        if (pct > 0) {
          item_discount_type = 'pct';
          item_discount_value = pct;
        }
      }

      const base = {
        product_id: it.custom_bisel ? null : Number(it.id),
        variant_id: it.variant_id ? Number(it.variant_id) : null,
        qty,
        unit_price,
        item_discount_type,
        item_discount_value,
        axis: it.axis ?? null,
        item_notes: it.item_notes ?? null,
        treatments: normalizeTreatments(it.treatments || []).map(x => x.id),
      };

      if (it.custom_bisel) {
        return {
          ...base,
          custom_bisel: true,
          sphere: it.sphere ?? null,
          cylinder: it.cylinder ?? null,
          axis: it.axis ?? null,
          lens_type_id: it.lens_type_id ? Number(it.lens_type_id) : null,
          frame_height: it.frame_height != null ? Number(it.frame_height) : null,
          blank_height: it.blank_height != null ? Number(it.blank_height) : null,
          observations: it.observations ?? null,
          name: it.name ?? 'Biselado personalizado',
        };
      }

      return base;
    });

    const orderPayload = {
      payment_method_id,
      notes: null,
      items
    };

    const ok = await Swal.fire({
      title: 'Confirmar pedido',
      html: `Óptica: <b>${safe(opticaUserContext.name || 'Óptica')}</b><br>Total: <b>${money(t.total)}</b><br>Pago: <b>${safe(methodKey)}</b>`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Crear'
    });

    if (!ok.isConfirmed) return;

    try {
      await api.post('/orders', orderPayload);

      cart = [];
      selectedCustomer = null;
      const hid = outlet.querySelector('#customerId');
      if (hid) hid.value = '';
      renderCart();

      await loadCore();
      renderCategoryButtons();
      refreshInventoryTable();
      await renderCards();

      Swal.fire('Pedido registrado', 'Proceso completado.', 'success');
    } catch (err) {
      console.log(orderPayload);
      const msg = err?.response?.data?.message || err?.message || 'Error al registrar el pedido';
      const details = err?.response?.data?.errors
        ? Object.values(err.response.data.errors).flat().map(x => `• ${x}`).join('<br>')
        : '';
      Swal.fire('Error', details || msg, 'error');
    }
  });

  renderCategoryButtons();
  renderStockTableBody();
  ensureDataTable();
  await renderCards();
  renderCart();
  setCheckoutState();

  if (!isOptica) {
    discountModeSel.dispatchEvent(new Event('change'));
    mountCustomerAutocomplete();
  }

  DBG('renderPOS end');
}