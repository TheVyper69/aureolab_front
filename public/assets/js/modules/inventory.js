// public/assets/js/pages/inventory.js
// INVENTORY (FULL)
// - Modal crea/edita productos con payload NUEVO (FKs + sphere/cylinder/axis + treatments[])
// - Usa selects para: Type, Material, Supplier, Box
// - Soporta imagen con preview a la derecha
// - Muestra/oculta campos según categoría (is_mica / LENTES_CONTACTO / otros)
// - Guarda con FormData
// - Categorías con is_mica + buy_price + sale_price
// - Generación masiva de micas desde inventario
// - Al editar, consulta /products/{id}
// - La preview usa blob protegido con token

import { inventoryService } from '../services/inventoryService.js';
import { authService } from '../services/authService.js';
import { api } from '../services/api.js';
import { money } from '../utils/helpers.js';

/* =========================
 * Helpers
 * ========================= */
function safe(v) {
  return String(v ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function pickCategoryName(c) {
  return c?.name ?? c?.label ?? c?.title ?? '';
}

function pickCategoryCode(c) {
  return String(c?.code ?? c?.slug ?? '').trim();
}

function isMicaCategory(c) {
  if (!c) return false;

  if (
    c.is_mica === true ||
    c.isMica === true ||
    Number(c.is_mica ?? c.isMica ?? 0) === 1
  ) {
    return true;
  }

  const code = pickCategoryCode(c).toUpperCase();

  return code === 'MICAS' ||
    code.startsWith('MICA_') ||
    code.startsWith('MICA-');
}

function isContactsCategory(c) {
  const code = pickCategoryCode(c).toUpperCase().replace(/\s+/g, '_');
  return code === 'LENTES_CONTACTO';
}

function isLensLikeCategory(c) {
  return isMicaCategory(c) || isContactsCategory(c);
}

function categoryBuyPrice(c) {
  return Number(c?.buy_price ?? c?.buyPrice ?? 0);
}

function categorySalePrice(c) {
  return Number(c?.sale_price ?? c?.salePrice ?? 0);
}
function categoryImageUrl(c) {
  return c?.imageUrl ?? c?.image_url ?? null;
}

function categoryHasImage(c) {
  return Boolean(c?.has_image ?? c?.image_path ?? categoryImageUrl(c));
}

function buildCategoryFormData(values = {}) {
  const formData = new FormData();

  formData.append('code', values.code ?? '');
  formData.append('name', values.name ?? '');
  formData.append('description', values.description ?? '');
  formData.append('is_mica', values.is_mica ? '1' : '0');
  formData.append('buy_price', String(values.buy_price ?? 0));
  formData.append('sale_price', String(values.sale_price ?? 0));

  if (values.update_products_prices !== undefined) {
    formData.append('update_products_prices', values.update_products_prices ? '1' : '0');
  }

  if (values.remove_image !== undefined) {
    formData.append('remove_image', values.remove_image ? '1' : '0');
  }

  if (values.image) {
    formData.append('image', values.image);
  }

  return formData;
}

function isQuarterStep(value) {
  if (value === null || value === undefined || value === '') return true;

  const n = Number(value);

  if (Number.isNaN(n)) return false;

  const scaled = Math.round(n * 100);

  return scaled % 25 === 0;
}

function formatMoneyInput(value) {
  const n = Number(value ?? 0);

  if (Number.isNaN(n)) return '0.00';

  return n.toFixed(2);
}

function buildOptions(arr, placeholder = '-- Selecciona --', labelFn = (x) => x.name, valueKey = 'id') {
  const list = Array.isArray(arr) ? arr : [];
  return `
    <option value="">${safe(placeholder)}</option>
    ${list.map(item => `
      <option value="${safe(item?.[valueKey])}">
        ${safe(labelFn(item))}
      </option>
    `).join('')}
  `;
}

function mountDataTable(selector) {
  if (!(window.$ && $.fn.dataTable)) return null;

  if ($.fn.DataTable.isDataTable(selector)) {
    $(selector).DataTable().destroy();
  }

  return $(selector).DataTable({
    pageLength: 10,
    language: {
      search: 'Buscar:',
      lengthMenu: 'Mostrar _MENU_',
      info: 'Mostrando _START_ a _END_ de _TOTAL_',
      paginate: { previous: 'Anterior', next: 'Siguiente' },
      zeroRecords: 'No hay registros'
    }
  });
}

function extractAxiosErrorMessage(err) {
  const status = err?.response?.status;
  const data = err?.response?.data;

  if (status === 422 && data?.errors) {
    const lines = [];
    for (const k of Object.keys(data.errors)) {
      const arr = data.errors[k] || [];
      for (const msg of arr) {
        lines.push(`• ${msg}`);
      }
    }
    return lines.length ? lines.join('<br>') : (data.message || 'Error de validación');
  }

  return data?.message || data?.error || err?.message || 'Ocurrió un error';
}

function setImagePreview(src) {
  const wrap = document.getElementById('imagePreviewWrap');
  const img = document.getElementById('imagePreview');
  const empty = document.getElementById('imagePreviewEmpty');

  if (!wrap || !img || !empty) return;

  if (src) {
    img.src = src;
    img.classList.remove('d-none');
    empty.classList.add('d-none');
  } else {
    img.removeAttribute('src');
    img.classList.add('d-none');
    empty.classList.remove('d-none');
  }
}

function readImagePreview(file) {
  if (!file) {
    setImagePreview(null);
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    setImagePreview(e.target?.result || null);
  };
  reader.readAsDataURL(file);
}

function appendIfNotNull(formData, key, value) {
  if (value !== null && value !== undefined && value !== '') {
    formData.append(key, value);
  }
}

function setFieldError(inputId, errorId, message = '') {
  const input = document.getElementById(inputId);
  const error = document.getElementById(errorId);
  if (!input || !error) return;

  if (message) {
    input.classList.add('is-invalid');
    error.textContent = message;
    error.classList.remove('d-none');
  } else {
    input.classList.remove('is-invalid');
    error.textContent = '';
    error.classList.add('d-none');
  }
}

function clearLensErrors() {
  setFieldError('cylinder', 'cylinderError', '');
  setFieldError('axis', 'axisError', '');
}

/* =========================
 * Tratamientos
 * ========================= */
function normalizeTreatmentsArray(arr) {
  return (Array.isArray(arr) ? arr : [])
    .map(t => {
      if (typeof t === 'object' && t !== null) {
        return {
          id: Number(t.id || 0),
          name: String(t.name || t.code || `Tratamiento ${t.id || ''}`).trim()
        };
      }
      return {
        id: Number(t || 0),
        name: ''
      };
    })
    .filter(t => t.id > 0);
}

/* =========================
 * Validación graduación
 * ========================= */
function toggleAxisField() {
  const cylinderEl = document.getElementById('cylinder');
  const axisEl = document.getElementById('axis');
  const catId = document.getElementById('category_id')?.value || '';
  const cat = (window.__inventoryCategories || []).find(x => String(x.id) === String(catId));
  const isMicas = isMicaCategory(cat);

  if (!cylinderEl || !axisEl) return;

  if (isMicas) {
    axisEl.disabled = true;
    axisEl.value = '';
    setFieldError('axis', 'axisError', '');
    return;
  }

  const raw = String(cylinderEl.value || '').trim();

  if (raw === '') {
    axisEl.disabled = true;
    axisEl.value = '';
    setFieldError('axis', 'axisError', '');
    return;
  }

  const num = Number(raw);
  const hasValidNegativeCylinder = !Number.isNaN(num) && num < 0;

  axisEl.disabled = !hasValidNegativeCylinder;

  if (!hasValidNegativeCylinder) {
    axisEl.value = '';
    setFieldError('axis', 'axisError', '');
  }
}

function enforceNegativeCylinder() {
  const cylinderEl = document.getElementById('cylinder');
  const axisEl = document.getElementById('axis');

  if (!cylinderEl) return;

  const raw = String(cylinderEl.value ?? '').trim();

  if (raw === '') {
    setFieldError('cylinder', 'cylinderError', '');
    toggleAxisField();
    return;
  }

  const num = Number(raw);

  if (Number.isNaN(num)) {
    setFieldError('cylinder', 'cylinderError', 'Valor inválido.');
    toggleAxisField();
    return;
  }

  if (num > 0) {
    cylinderEl.value = '';
    setFieldError('cylinder', 'cylinderError', 'No se permiten números positivos.');
    toggleAxisField();
    return;
  }

  const catId = document.getElementById('category_id')?.value || '';
  const cat = (window.__inventoryCategories || []).find(x => String(x.id) === String(catId));
  const isMicas = isMicaCategory(cat);

  if (num === 0 && !isMicas) {
    cylinderEl.value = '';
    setFieldError('cylinder', 'cylinderError', 'El cilindro no puede ser 0. Debe ser negativo.');
    if (axisEl) axisEl.value = '';
    toggleAxisField();
    return;
  }

  setFieldError('cylinder', 'cylinderError', '');
  toggleAxisField();
}

function enforceAxisRange() {
  const axisEl = document.getElementById('axis');
  const cylinderEl = document.getElementById('cylinder');
  if (!axisEl) return;

  const axisRaw = String(axisEl.value ?? '').trim();
  const cylinderRaw = String(cylinderEl?.value ?? '').trim();

  if (axisRaw === '') {
    setFieldError('axis', 'axisError', '');
    return;
  }

  const axisNum = Number(axisRaw);
  const cylinderNum = cylinderRaw === '' ? null : Number(cylinderRaw);

  if (Number.isNaN(axisNum)) {
    setFieldError('axis', 'axisError', 'Valor inválido.');
    return;
  }

  if (axisNum < 0 || axisNum > 180) {
    setFieldError('axis', 'axisError', 'El eje debe estar entre 0 y 180.');
    return;
  }

  const catId = document.getElementById('category_id')?.value || '';
  const cat = (window.__inventoryCategories || []).find(x => String(x.id) === String(catId));
  const isMicas = isMicaCategory(cat);

  if (isMicas) {
    axisEl.value = '';
    setFieldError('axis', 'axisError', '');
    return;
  }

  if (cylinderNum === null) {
    setFieldError('axis', 'axisError', 'Si capturas eje debes capturar cilindro.');
    return;
  }

  if (Number.isNaN(cylinderNum) || cylinderNum >= 0) {
    setFieldError('axis', 'axisError', 'El eje solo aplica cuando el cilindro es negativo.');
    return;
  }

  setFieldError('axis', 'axisError', '');
}

/* =========================
 * Normalización INVENTARIO
 * Soporta wrapper: [{ stock,reserved,available, product:{...}}]
 * ========================= */
function normalizeInventoryRows(rows) {
  const arr = Array.isArray(rows) ? rows : [];
  const isWrapped = arr.length && arr[0] && typeof arr[0] === 'object'
    && Object.prototype.hasOwnProperty.call(arr[0], 'product');

  if (!isWrapped) return [];

  return arr.map(r => {
    const p = r.product || {};
    return {
      stock: Number(r.stock ?? 0),
      reserved: Number(r.reserved ?? 0),
      available: Number(r.available ?? (Number(r.stock ?? 0) - Number(r.reserved ?? 0))),
      critical: Boolean(r.critical ?? false),
      product: {
        id: p.id,
        sku: p.sku ?? '',
        name: p.name ?? '',
        description: p.description ?? '',

        categoryCode: p.category_code ?? p.category ?? '',
        categoryLabel: p.category_name ?? p.category_label ?? p.categoryLabel ?? '',
        categoryId: p.category_id ?? p.categoryId ?? null,
        categoryIsMica: Boolean(p.category_is_mica ?? p.is_mica ?? false),
        categoryBuyPrice: Number(p.category_buy_price ?? 0),
        categorySalePrice: Number(p.category_sale_price ?? 0),

        type: p.type ?? null,
        material: p.material ?? null,

        buyPrice: Number(p.buyPrice ?? p.buy_price ?? 0),
        salePrice: Number(p.salePrice ?? p.sale_price ?? 0),
        minStock: Number(p.minStock ?? p.min_stock ?? 0),
        maxStock: (p.maxStock ?? p.max_stock ?? null),

        supplier_id: p.supplier_id ?? null,
        box_id: p.box_id ?? null,
        lens_type_id: p.lens_type_id ?? null,
        material_id: p.material_id ?? null,

        sphere: (p.sphere ?? null),
        cylinder: (p.cylinder ?? null),
        axis: (p.axis ?? null),

        treatments: normalizeTreatmentsArray(p.treatments ?? []),

        imageUrl: p.imageUrl ?? p.image_url ?? null,
      }
    };
  });
}

/* =========================
 * Main render
 * ========================= */
export async function renderInventory(outlet) {
  const role = authService.getRole();
  const token = authService.getToken();
  const canEdit = (role === 'admin') && !!token;

  let view = outlet.dataset.invView || 'inventory';
  outlet.dataset.invView = view;

  let categories = [];
  let inventoryRows = [];

  let lensTypes = [];
  let materials = [];
  let suppliers = [];
  let boxes = [];
  let treatmentsCatalog = [];

  let productModal = null;
  let previewObjectUrl = null;
  let categoryObjectUrls = [];
  let selectedProductIds = new Set();

  function updateBulkDeleteButton() {
    const btn = outlet.querySelector('#btnBulkDeleteProducts');

    if (!btn) return;

    const count = selectedProductIds.size;

    btn.disabled = count === 0;
    btn.textContent = count > 0
      ? `Borrar seleccionados (${count})`
      : 'Borrar seleccionados';
  }

  function syncInventorySelectionChecks() {
    outlet.querySelectorAll('[data-product-check]').forEach(chk => {
      chk.checked = selectedProductIds.has(String(chk.dataset.productCheck));
    });

    const checks = Array.from(outlet.querySelectorAll('[data-product-check]'));
    const visibleChecked = checks.filter(chk => chk.checked).length;
    const all = outlet.querySelector('#chkInvAll');

    if (all) {
      all.checked = checks.length > 0 && visibleChecked === checks.length;
      all.indeterminate = visibleChecked > 0 && visibleChecked < checks.length;
    }

    updateBulkDeleteButton();
  }

  function selectedProductsSummary() {
    const ids = Array.from(selectedProductIds).map(id => String(id));

    return inventoryRows
      .map(r => r.product || {})
      .filter(p => ids.includes(String(p.id)))
      .map(p => ({
        id: p.id,
        sku: p.sku,
        name: p.name,
        category: p.categoryLabel || p.categoryCode || ''
      }));
  }

  function clearCategoryObjectUrls() {
    categoryObjectUrls.forEach(url => {
      try {
        URL.revokeObjectURL(url);
      } catch (_) {}
    });

    categoryObjectUrls = [];
  }

  async function loadProtectedImageInto(imgEl, url) {
    if (!imgEl || !url) return;

    try {
      const token = authService.getToken();

      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'image/*',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        }
      });

      if (!res.ok || res.status === 204) {
        return;
      }

      const blob = await res.blob();

      if (!blob || blob.size === 0) {
        return;
      }

      const objectUrl = URL.createObjectURL(blob);
      categoryObjectUrls.push(objectUrl);

      imgEl.src = objectUrl;
      imgEl.classList.remove('d-none');

      const badge = imgEl.parentElement?.querySelector('.cat-img-loading');
      if (badge) badge.remove();
    } catch (err) {
      console.warn('No se pudo cargar imagen protegida:', err);
    }
  }

  async function loadCategoryThumbnails() {
    const imgs = Array.from(document.querySelectorAll('[data-cat-image-url]'));

    await Promise.all(
      imgs.map(img => loadProtectedImageInto(img, img.dataset.catImageUrl))
    );
  }

  async function loadProtectedPreview(productId) {
    if (!productId) {
      setImagePreview(null);
      return;
    }

    try {
      const blob = await inventoryService.getProductImageBlob(productId);

      if (!blob || blob.size === 0) {
        setImagePreview(null);
        return;
      }

      if (previewObjectUrl) {
        URL.revokeObjectURL(previewObjectUrl);
        previewObjectUrl = null;
      }

      previewObjectUrl = URL.createObjectURL(blob);
      setImagePreview(previewObjectUrl);
    } catch (err) {
      console.error('No se pudo cargar preview protegida:', err);
      setImagePreview(null);
    }
  }

  function buildTreatmentSelectHtml(selectedId = '') {
    const normalizedSelected = String(selectedId || '');

    return `
      <div class="treatment-item position-relative border rounded p-2 mb-2"
           style="transition: box-shadow .15s ease;">
        <button
          type="button"
          class="btn btn-sm btn-danger treatment-remove"
          title="Quitar tratamiento"
          style="
            position:absolute;
            top:-8px;
            right:-8px;
            width:24px;
            height:24px;
            padding:0;
            line-height:1;
            border-radius:50%;
            display:flex;
            align-items:center;
            justify-content:center;
            font-size:14px;
            opacity:0;
            pointer-events:none;
            transition:opacity .15s ease;
            z-index:5;
          ">
          ×
        </button>

        <label class="form-label mb-1">Tratamiento</label>
        <select class="form-select treatment-select" data-selected="${safe(normalizedSelected)}"></select>
      </div>
    `;
  }

  function getTreatmentsContainer() {
    return document.getElementById('treatmentsContainer');
  }

  function getSelectedTreatmentIds() {
    return Array.from(document.querySelectorAll('.treatment-select'))
          .map(el => Number(el.value || 0))
      .filter(v => v > 0);
  }

  function getSelectedTreatmentIdsExcluding(currentSelect = null) {
    return Array.from(document.querySelectorAll('.treatment-select'))
      .filter(el => el !== currentSelect)
      .map(el => Number(el.value || 0))
      .filter(v => v > 0);
  }

  function fillTreatmentSelectOptions(selectEl, selectedId = '') {
    if (!selectEl) return;

    const currentId = Number(selectedId || selectEl.value || 0) || 0;
    const usedIds = getSelectedTreatmentIdsExcluding(selectEl);

    const available = (Array.isArray(treatmentsCatalog) ? treatmentsCatalog : []).filter(t => {
      const tid = Number(t.id || 0);
      if (!tid) return false;
      if (tid === currentId) return true;
      return !usedIds.includes(tid);
    });

    selectEl.innerHTML = `
      <option value="">-- Selecciona tratamiento --</option>
      ${available.map(t => `
        <option value="${safe(t.id)}" ${Number(t.id) === currentId ? 'selected' : ''}>
          ${safe(t.name || t.code || `Tratamiento ${t.id}`)}
        </option>
      `).join('')}
    `;
  }

  function refreshAllTreatmentSelectOptions() {
    document.querySelectorAll('.treatment-select').forEach(selectEl => {
      const currentValue = selectEl.value || selectEl.dataset.selected || '';
      fillTreatmentSelectOptions(selectEl, currentValue);
      selectEl.dataset.selected = selectEl.value || '';
    });
  }

  function renderInitialTreatmentSelects(treatments = []) {
    const container = getTreatmentsContainer();
    if (!container) return;

    const rows = normalizeTreatmentsArray(treatments);
    container.innerHTML = '';

    if (!rows.length) {
      refreshAllTreatmentSelectOptions();
      return;
    }

    rows.forEach(t => {
      container.insertAdjacentHTML('beforeend', buildTreatmentSelectHtml(t.id));
    });

    refreshAllTreatmentSelectOptions();
  }

  function addTreatmentSelect(selectedId = '') {
    const container = getTreatmentsContainer();
    if (!container) return;

    if (!Array.isArray(treatmentsCatalog) || treatmentsCatalog.length === 0) {
      Swal.fire('Sin tratamientos', 'No hay tratamientos disponibles para seleccionar.', 'info');
      return;
    }

    const usedIds = getSelectedTreatmentIds();
    const remaining = treatmentsCatalog.filter(t => !usedIds.includes(Number(t.id || 0)));

    if (!selectedId && remaining.length === 0) {
      Swal.fire('Sin más opciones', 'Ya agregaste todos los tratamientos disponibles.', 'info');
      return;
    }

    container.insertAdjacentHTML('beforeend', buildTreatmentSelectHtml(selectedId));
    refreshAllTreatmentSelectOptions();
  }

  function validateTreatmentDuplicates() {
    const ids = getSelectedTreatmentIds();
    const dup = ids.find((id, idx) => ids.indexOf(id) !== idx);

    document.querySelectorAll('.treatment-select').forEach(el => {
      el.classList.remove('is-invalid');
    });

    if (!dup) return true;

    let markedFirst = false;
    document.querySelectorAll('.treatment-select').forEach(el => {
      if (Number(el.value || 0) === dup) {
        el.classList.add('is-invalid');
        markedFirst = true;
      }
    });

    if (markedFirst) {
      Swal.fire('Tratamiento repetido', 'No puedes agregar el mismo tratamiento más de una vez.', 'warning');
    }

    return false;
  }

  const renderShell = () => {
    outlet.innerHTML = `
      <div class="d-flex flex-wrap gap-2 align-items-center justify-content-between mb-3">
        <div class="d-flex align-items-center gap-2">
          <h4 class="mb-0">Inventario</h4>
          <div class="btn-group ms-2" role="group" aria-label="tabs">
            <button class="btn ${view === 'inventory' ? 'btn-brand' : 'btn-outline-brand'}" id="tabInventory">Inventario</button>
            <button class="btn ${view === 'categories' ? 'btn-brand' : 'btn-outline-brand'}" id="tabCategories">Categorías</button>
          </div>
        </div>

        ${canEdit
          ? `<div class="d-flex gap-2" id="topActions"></div>`
          : `<div class="small text-muted">Solo admin logeado puede editar.</div>`
        }
      </div>

      <div id="invContent"></div>
    `;
  };

  const renderTopActions = () => {
  const box = outlet.querySelector('#topActions');
  if (!box) return;

  if (view === 'inventory') {
    box.innerHTML = `
      <button class="btn btn-outline-danger" id="btnBulkDeleteProducts" data-bulk-delete="1" disabled>
        Borrar seleccionados
      </button>
      <button class="btn btn-outline-brand" id="btnRefresh">Actualizar</button>
      <button class="btn btn-brand" id="btnNewProduct">Nuevo producto</button>
    `;
  } else {
    box.innerHTML = `
      <button class="btn btn-outline-brand" id="btnRefresh">Actualizar</button>
      <button class="btn btn-brand" id="btnNewCategory">Nueva categoría</button>
    `;
  }

  updateBulkDeleteButton();
};

  const renderProductModalHtml = () => {
    const categoryOptions = (categories || []).map(c => {
      const id = c.id ?? '';
      const code = pickCategoryCode(c);
      const name = pickCategoryName(c) || `Categoría #${id}`;
      return `<option value="${safe(id)}">${safe(name)} (${safe(code)})</option>`;
    }).join('');

    const lensTypeOptions = buildOptions(
      lensTypes,
      '-- Selecciona type --',
      (x) => `${x.name}${x.code ? ` (${x.code})` : ''}`
    );

    const materialOptions = buildOptions(
      materials,
      '-- Selecciona material --',
      (x) => x.name
    );

    const supplierOptions = buildOptions(
      suppliers,
      '-- Selecciona supplier --',
      (x) => x.name
    );

    const boxOptions = buildOptions(
      boxes,
      '-- Selecciona box --',
      (x) => `${x.name}${x.code ? ` (${x.code})` : ''}`
    );

    return `
      <div class="modal fade" id="productModal" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog modal-xl modal-dialog-scrollable">
          <div class="modal-content">

            <div class="modal-header">
              <h5 class="modal-title" id="modalTitle">Producto</h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Cerrar"></button>
            </div>

            <div class="modal-body">
              <form id="productForm">
                <div class="row g-3">

                  <div class="col-md-4" id="skuFieldWrap">
                    <label class="form-label">SKU</label>
                    <input class="form-control" id="sku" required>
                    <div class="form-text" id="skuHelp">Para generación masiva de micas, el SKU se genera automáticamente.</div>
                  </div>

                  <div class="col-md-8" id="nameFieldWrap">
                    <label class="form-label">Nombre</label>
                    <input class="form-control" id="name" required>
                    <div class="form-text" id="nameHelp">Para generación masiva de micas, el nombre se genera automáticamente.</div>
                  </div>

                  <div class="col-md-6">
                    <label class="form-label">Categoría</label>
                    <select class="form-select" id="category_id" required>
                      <option value="">-- Selecciona --</option>
                      ${categoryOptions}
                    </select>
                  </div>

                  <div class="col-md-6">
                    <label class="form-label">Descripción</label>
                    <input class="form-control" id="description" placeholder="Opcional">
                  </div>

                  <div class="col-md-6">
                    <label class="form-label">Precio compra</label>
                    <input type="number" class="form-control" id="buyPrice" min="0" step="0.01">
                    <div class="form-text" id="buyPriceHelp"></div>
                  </div>

                  <div class="col-md-6">
                    <label class="form-label">Precio venta</label>
                    <input type="number" class="form-control" id="salePrice" min="0" step="0.01">
                    <div class="form-text" id="salePriceHelp"></div>
                  </div>

                  <div class="col-md-6">
                    <label class="form-label">Stock mín</label>
                    <input type="number" class="form-control" id="minStock" min="0">
                  </div>

                  <div class="col-md-6">
                    <label class="form-label">Stock máx</label>
                    <input type="number" class="form-control" id="maxStock" min="0">
                  </div>

                  <div id="lensSection" class="d-none">
                    <hr class="my-2">
                    <div class="row g-3 mt-0">

                      <div class="col-md-6">
                        <label class="form-label">Type</label>
                        <select class="form-select" id="lens_type_id">
                          ${lensTypeOptions}
                        </select>
                      </div>

                      <div class="col-md-6">
                        <label class="form-label">Material</label>
                        <select class="form-select" id="material_id">
                          ${materialOptions}
                        </select>
                      </div>

                      <div class="col-md-6">
                        <label class="form-label">Supplier</label>
                        <select class="form-select" id="supplier_id">
                          ${supplierOptions}
                        </select>
                      </div>

                      <div class="col-md-6">
                        <label class="form-label">Box</label>
                        <select class="form-select" id="box_id">
                          ${boxOptions}
                        </select>
                      </div>

                      <div class="col-12 d-none" id="bulkMicaSection">
                        <div class="alert alert-light border mb-0">
                          <div class="fw-semibold">Generación masiva de micas</div>
                          <div class="small text-muted">
                            El sistema generará una mica por cada combinación de esfera y cilindro en incrementos de 0.25.
                            El precio se toma desde la categoría seleccionada.
                          </div>

                          <div class="row g-3 mt-1">
                            <div class="col-md-3">
                              <label class="form-label">Esfera mínima</label>
                              <input type="number" class="form-control" id="sphere_min" step="0.25" min="-40" max="40" placeholder="Ej: -2.00">
                            </div>

                            <div class="col-md-3">
                              <label class="form-label">Esfera máxima</label>
                              <input type="number" class="form-control" id="sphere_max" step="0.25" min="-40" max="40" placeholder="Ej: 2.00">
                            </div>

                            <div class="col-md-3">
                              <label class="form-label">Cilindro máximo negativo</label>
                              <input type="number" class="form-control" id="cylinder_max" step="0.25" min="-40" max="0" placeholder="Ej: -0.25">
                              <div class="form-text">Se generará desde 0.00 hasta este valor.</div>
                            </div>

                            <div class="col-md-3">
                              <label class="form-label">Stock inicial por mica</label>
                              <input type="number" class="form-control" id="initial_stock" min="0" step="1" value="0">
                            </div>

                            <div class="col-12">
                              <div class="small" id="bulkMicaPreview">
                                Completa los rangos para ver cuántos productos se generarán.
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div class="row g-3 mt-0" id="singleOpticalFields">
                        <div class="col-md-4">
                          <label class="form-label">Esfera</label>
                          <input type="number" class="form-control" id="sphere" step="0.25" min="-40" max="40" placeholder="Ej: -2.00 o 1.25">
                        </div>

                        <div class="col-md-4">
                          <label class="form-label">Cilindro</label>
                          <input type="number" class="form-control" id="cylinder" step="0.25" min="-40" max="0" placeholder="Ej: 0.00 o -0.50">
                          <span id="cylinderError" class="text-danger small d-none"></span>
                        </div>

                        <div class="col-md-4" id="axisFieldWrap">
                          <label class="form-label">Eje</label>
                          <input type="number" class="form-control" id="axis" min="0" max="180" step="1" placeholder="Ej: 90">
                          <span id="axisError" class="text-danger small d-none"></span>
                        </div>
                      </div>

                      <div class="col-12">
                        <div class="small text-muted">
                          Para micas se permite cilindro 0.00 y no se captura eje. Para lentes de contacto se mantiene la validación con eje.
                        </div>
                      </div>

                    </div>
                  </div>

                  <div id="treatmentsSection" class="col-12 d-none">
                    <hr class="my-2">
                    <div class="row g-2 mt-0">
                      <div class="col-12">
                        <div class="d-flex align-items-center justify-content-between flex-wrap gap-2">
                          <label class="form-label mb-0">Tratamientos</label>
                          <button type="button" class="btn btn-sm btn-outline-brand" id="btnAddTreatment">
                            Agregar tratamiento
                          </button>
                        </div>

                        <div id="treatmentsContainer" class="mt-2"></div>

                        <div class="small text-muted mt-1">
                          Solo aplica para MICAS. No repitas tratamientos.
                        </div>
                      </div>
                    </div>
                  </div>

                  <div class="col-12">
                    <hr class="my-2">
                    <div class="row g-3 align-items-start">
                      <div class="col-md-8">
                        <label class="form-label">Imagen del producto</label>
                        <input type="file" class="form-control" id="image" accept="image/*">
                        <div class="form-text" id="productImageHelp">
                          Selecciona una imagen propia para este producto. Si la dejas vacía, puede heredar la imagen de la categoría.
                        </div>
                      </div>

                      <div class="col-md-4">
                        <label class="form-label d-block">Vista previa</label>
                        <div
                          id="imagePreviewWrap"
                          class="border rounded p-2 text-center bg-light"
                          style="max-width: 220px;"
                        >
                          <div
                            id="imagePreviewEmpty"
                            class="text-muted small d-flex align-items-center justify-content-center"
                            style="height: 120px;"
                          >
                            Sin imagen seleccionada
                          </div>
                          <img
                            id="imagePreview"
                            class="img-fluid rounded d-none mx-auto"
                            alt="Vista previa"
                            style="max-height: 120px; max-width: 100%; object-fit: contain;"
                          >
                        </div>
                      </div>
                    </div>
                  </div>

                </div>

                <input type="hidden" id="productId">
              </form>
            </div>

            <div class="modal-footer">
              <button class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancelar</button>
              <button class="btn btn-brand" id="btnSaveProduct">Guardar</button>
            </div>

          </div>
        </div>
      </div>
    `;
  };

  const renderInventoryTable = () => {
    const content = outlet.querySelector('#invContent');

    content.innerHTML = `
      <div class="card p-3">
        ${canEdit ? `
          <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-2">
            <div class="small text-muted">
              Selecciona productos para borrarlos en grupo.
            </div>
            <button class="btn btn-sm btn-outline-secondary" id="btnClearSelection" data-clear-selection="1" ${selectedProductIds.size === 0 ? 'disabled' : ''}>
              Limpiar selección
            </button>
          </div>
        ` : ''}

        <div class="table-responsive">
          <table id="tblInventory" class="table table-striped align-middle" style="width:100%">
            <thead>
              <tr>
                ${canEdit ? `
                  <th style="width:38px;">
                    <input type="checkbox" class="form-check-input" id="chkInvAll" title="Seleccionar visibles">
                  </th>
                ` : ''}
                <th>SKU</th>
                <th>Nombre</th>
                <th>Categoría</th>
                <th>Disponible</th>
                <th>Mín</th>
                <th>Máx</th>
                <th>Venta</th>
                ${canEdit ? '<th>Acciones</th>' : ''}
              </tr>
            </thead>
            <tbody>
              ${inventoryRows.map(r => {
                const p = r.product || {};
                const available = Number(r.available ?? 0);
                const min = Number(p.minStock ?? 0);
                const low = available <= min;
                const checked = selectedProductIds.has(String(p.id)) ? 'checked' : '';

                return `
                  <tr class="${low ? 'table-warning' : ''}">
                    ${canEdit ? `
                      <td>
                        <input
                          type="checkbox"
                          class="form-check-input"
                          data-product-check="${safe(p.id)}"
                          ${checked}
                        >
                      </td>
                    ` : ''}
                    <td>${safe(p.sku)}</td>
                    <td>
                      ${safe(p.name)}
                      ${low ? '<span class="badge text-bg-danger ms-2">Crítico</span>' : ''}
                    </td>
                    <td>${safe(p.categoryLabel || p.categoryCode || '')}</td>
                    <td class="fw-semibold">${available}</td>
                    <td>${min}</td>
                    <td>${p.maxStock ?? ''}</td>
                    <td>${money(p.salePrice ?? 0)}</td>
                    ${canEdit ? `
                      <td class="text-nowrap">
                        <button class="btn btn-sm btn-outline-success me-1" data-addstock="${p.id}">+ Stock</button>
                        <button class="btn btn-sm btn-outline-brand me-1" data-edit="${p.id}">Editar</button>
                        <button class="btn btn-sm btn-outline-danger" data-del="${p.id}">Borrar</button>
                      </td>
                    ` : ''}
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>

        <div class="small text-muted mt-2">
          ${canEdit ? 'Admin: CRUD + stock + borrado masivo.' : 'Solo admin logeado puede editar.'}
        </div>
      </div>

      ${canEdit ? renderProductModalHtml() : ''}
    `;

    const dt = mountDataTable('#tblInventory');

    if (dt && window.$ && $.fn.dataTable) {
      $('#tblInventory').on('draw.dt', () => {
        syncInventorySelectionChecks();
      });
    }

    syncInventorySelectionChecks();

    if (canEdit) {
      productModal = new bootstrap.Modal(document.getElementById('productModal'));
      wireProductModalHandlers();

      document.getElementById('productModal')?.addEventListener('hidden.bs.modal', () => {
        if (previewObjectUrl) {
          URL.revokeObjectURL(previewObjectUrl);
          previewObjectUrl = null;
        }
        setImagePreview(null);
        clearLensErrors();

        const container = getTreatmentsContainer();
        if (container) container.innerHTML = '';
      });
    }
  };

  const renderCategoriesTable = () => {
    const content = outlet.querySelector('#invContent');

    clearCategoryObjectUrls();

    content.innerHTML = `
      <div class="card p-3">
        <div class="table-responsive">
          <table id="tblCategories" class="table table-striped align-middle" style="width:100%">
            <thead>
              <tr>
                <th>ID</th>
                <th>Code</th>
                <th>Nombre</th>
                <th>Descripción</th>
                <th>Imagen</th>
                <th>Mica</th>
                <th>Compra</th>
                <th>Venta</th>
                ${canEdit ? '<th>Acciones</th>' : ''}
              </tr>
            </thead>
            <tbody>
              ${(categories || []).map(c => {
                const id = c.id ?? '';
                const code = pickCategoryCode(c);
                const name = pickCategoryName(c);
                const desc = c.description ?? '';
                const isMica = isMicaCategory(c);
                const imgUrl = categoryImageUrl(c);

                return `
                  <tr>
                    <td>${safe(id)}</td>
                    <td><code>${safe(code)}</code></td>
                    <td>${safe(name)}</td>
                    <td>${safe(desc)}</td>
                    <td>
                      ${imgUrl
                        ? `
                          <div style="width:70px;height:50px;display:flex;align-items:center;justify-content:center;">
                            <span class="badge text-bg-secondary cat-img-loading">Cargando</span>
                            <img
                              data-cat-image-url="${safe(imgUrl)}"
                              alt="Imagen"
                              class="d-none"
                              style="width:60px;height:46px;object-fit:contain;border:1px solid #ddd;border-radius:6px;background:#fff;"
                            >
                          </div>
                        `
                        : '<span class="badge text-bg-secondary">Sin imagen</span>'
                      }
                    </td>
                    <td>${isMica ? '<span class="badge text-bg-primary">Sí</span>' : '<span class="badge text-bg-secondary">No</span>'}</td>
                    <td>${money(categoryBuyPrice(c))}</td>
                    <td>${money(categorySalePrice(c))}</td>
                    ${canEdit ? `
                      <td class="text-nowrap">
                        <button class="btn btn-sm btn-outline-brand me-1" data-cat-edit="${id}">Editar</button>
                        <button class="btn btn-sm btn-outline-danger" data-cat-del="${id}">Borrar</button>
                      </td>
                    ` : ''}
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>

        <div class="small text-muted mt-2">
          ${canEdit ? 'Admin: CRUD completo de categorías.' : 'Solo admin logeado puede editar.'}
        </div>
      </div>
    `;

    mountDataTable('#tblCategories');
    loadCategoryThumbnails();
  };

  function updateBulkMicaPreview() {
    const preview = document.getElementById('bulkMicaPreview');
    if (!preview) return;

    const sMinRaw = document.getElementById('sphere_min')?.value ?? '';
    const sMaxRaw = document.getElementById('sphere_max')?.value ?? '';
    const cMaxRaw = document.getElementById('cylinder_max')?.value ?? '';

    if (sMinRaw === '' || sMaxRaw === '' || cMaxRaw === '') {
      preview.textContent = 'Completa los rangos para ver cuántos productos se generarán.';
      preview.className = 'small text-muted';
      return;
    }

    const sMin = Number(sMinRaw);
    const sMax = Number(sMaxRaw);
    const cMax = Number(cMaxRaw);

    if (
      Number.isNaN(sMin) ||
      Number.isNaN(sMax) ||
      Number.isNaN(cMax) ||
      sMin > sMax ||
      cMax > 0 ||
      !isQuarterStep(sMin) ||
      !isQuarterStep(sMax) ||
      !isQuarterStep(cMax)
    ) {
      preview.textContent = 'Rangos inválidos. Usa incrementos de 0.25, esfera mínima menor o igual a máxima y cilindro 0 o negativo.';
      preview.className = 'small text-danger';
      return;
    }

    const sphereCount = Math.floor(Math.round((sMax - sMin) * 100) / 25) + 1;
    const cylinderCount = Math.floor(Math.round((0 - cMax) * 100) / 25) + 1;
    const total = Math.max(0, sphereCount) * Math.max(0, cylinderCount);

    preview.textContent = `Se generarán ${total} productos (${sphereCount} esferas x ${cylinderCount} cilindros).`;
    preview.className = 'small text-success fw-semibold';
  }

  function toggleLensSection() {
    const catId = document.getElementById('category_id')?.value || '';
    const productId = document.getElementById('productId')?.value || '';
    const cat = (categories || []).find(x => String(x.id) === String(catId));

    const lensSection = document.getElementById('lensSection');
    const treatmentsSection = document.getElementById('treatmentsSection');
    const bulkMicaSection = document.getElementById('bulkMicaSection');
    const singleOpticalFields = document.getElementById('singleOpticalFields');
    const axisFieldWrap = document.getElementById('axisFieldWrap');

    const sku = document.getElementById('sku');
    const name = document.getElementById('name');
    const skuFieldWrap = document.getElementById('skuFieldWrap');
    const nameFieldWrap = document.getElementById('nameFieldWrap');

    const buyPrice = document.getElementById('buyPrice');
    const salePrice = document.getElementById('salePrice');
    const buyPriceHelp = document.getElementById('buyPriceHelp');
    const salePriceHelp = document.getElementById('salePriceHelp');

    const imageInput = document.getElementById('image');
    const productImageHelp = document.getElementById('productImageHelp');

    if (!lensSection) return;

    const isMicas = isMicaCategory(cat);
    const isContacts = isContactsCategory(cat);
    const isLens = isLensLikeCategory(cat);
    const isCreating = !productId;
    const isBulkMica = isCreating && isMicas;

    lensSection.classList.toggle('d-none', !isLens);

    if (treatmentsSection) {
      treatmentsSection.classList.toggle('d-none', !isMicas);
    }

    if (bulkMicaSection) {
      bulkMicaSection.classList.toggle('d-none', !isBulkMica);
    }

    if (singleOpticalFields) {
      singleOpticalFields.classList.toggle('d-none', isBulkMica);
    }

    if (axisFieldWrap) {
      axisFieldWrap.classList.toggle('d-none', isMicas);
    }

    if (sku) {
      sku.required = !isBulkMica;
      sku.disabled = isBulkMica;
      if (isBulkMica) sku.value = '';
    }

    if (name) {
      name.required = !isBulkMica;
      name.disabled = isBulkMica;
      if (isBulkMica) name.value = '';
    }

    if (skuFieldWrap) {
      skuFieldWrap.classList.toggle('opacity-50', isBulkMica);
    }

    if (nameFieldWrap) {
      nameFieldWrap.classList.toggle('opacity-50', isBulkMica);
    }
    if (imageInput) {
      imageInput.disabled = isBulkMica;
      if (isBulkMica) imageInput.value = '';
    }

    if (productImageHelp) {
      productImageHelp.textContent = isBulkMica
        ? 'Para generación masiva de micas, la imagen se toma desde la categoría.'
        : 'Selecciona una imagen propia para este producto. Si la dejas vacía, puede heredar la imagen de la categoría.';
    }

    if (buyPrice && salePrice) {
      if (isMicas) {
        buyPrice.value = formatMoneyInput(categoryBuyPrice(cat));
        salePrice.value = formatMoneyInput(categorySalePrice(cat));
        buyPrice.disabled = true;
        salePrice.disabled = true;

        if (buyPriceHelp) buyPriceHelp.textContent = 'Para micas, este precio se toma desde la categoría.';
        if (salePriceHelp) salePriceHelp.textContent = 'Para micas, este precio se toma desde la categoría.';
      } else {
        buyPrice.disabled = false;
        salePrice.disabled = false;

        if (buyPriceHelp) buyPriceHelp.textContent = '';
        if (salePriceHelp) salePriceHelp.textContent = '';
      }
    }

    if (!isLens) {
      ['lens_type_id', 'material_id', 'supplier_id', 'box_id', 'sphere', 'cylinder', 'axis'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      clearLensErrors();
    }

    if (isMicas) {
      const axisEl = document.getElementById('axis');
      if (axisEl) {
        axisEl.value = '';
        axisEl.disabled = true;
      }
    }

    if (!isMicas) {
      const container = getTreatmentsContainer();
      if (container) container.innerHTML = '';
    }

    updateBulkMicaPreview();
    toggleAxisField();
  }

  const openProductModal = async (productOrNull) => {
    const p = productOrNull || null;

    document.getElementById('modalTitle').textContent = p ? 'Editar producto' : 'Nuevo producto';
    document.getElementById('productId').value = p?.id ?? '';

    document.getElementById('sku').value = p?.sku ?? '';
    document.getElementById('name').value = p?.name ?? '';
    document.getElementById('description').value = p?.description ?? '';

    document.getElementById('buyPrice').value = (p?.buyPrice ?? p?.buy_price ?? '');
    document.getElementById('salePrice').value = (p?.salePrice ?? p?.sale_price ?? '');
    document.getElementById('minStock').value = (p?.minStock ?? p?.min_stock ?? '');
    document.getElementById('maxStock').value = (p?.maxStock ?? p?.max_stock ?? '');

    document.getElementById('supplier_id').value = (p?.supplier_id ?? '');
    document.getElementById('box_id').value = (p?.box_id ?? '');
    document.getElementById('lens_type_id').value = (p?.lens_type_id ?? '');
    document.getElementById('material_id').value = (p?.material_id ?? '');
    document.getElementById('sphere').value = (p?.sphere ?? '');
    document.getElementById('cylinder').value = (p?.cylinder ?? '');
    document.getElementById('axis').value = (p?.axis ?? '');

    const sMin = document.getElementById('sphere_min');
    const sMax = document.getElementById('sphere_max');
    const cMax = document.getElementById('cylinder_max');
    const initialStock = document.getElementById('initial_stock');

    if (sMin) sMin.value = '';
    if (sMax) sMax.value = '';
    if (cMax) cMax.value = '';
    if (initialStock) initialStock.value = '0';

    const sel = document.getElementById('category_id');
    sel.value = (p?.categoryId ?? p?.category_id ?? '');

    const imageInput = document.getElementById('image');
    if (imageInput) {
      imageInput.value = '';
    }

    setImagePreview(null);
    clearLensErrors();
    toggleLensSection();

    renderInitialTreatmentSelects(
      normalizeTreatmentsArray(
        p?.treatments ??
        p?.product_treatments ??
        []
      )
    );

    enforceNegativeCylinder();
    enforceAxisRange();
    productModal.show();

    if (p?.id) {
      await loadProtectedPreview(p.id);
    }
  };

  const wireProductModalHandlers = () => {
    const btnSave = document.getElementById('btnSaveProduct');
    const categoryEl = document.getElementById('category_id');
    const treatmentsContainer = getTreatmentsContainer();
    const btnAddTreatment = document.getElementById('btnAddTreatment');

    categoryEl?.addEventListener('change', toggleLensSection);

    ['sphere_min', 'sphere_max', 'cylinder_max'].forEach(id => {
      document.getElementById(id)?.addEventListener('input', updateBulkMicaPreview);
      document.getElementById(id)?.addEventListener('blur', updateBulkMicaPreview);
    });

    document.getElementById('cylinder')?.addEventListener('input', () => {
      enforceNegativeCylinder();
      enforceAxisRange();
    });

    document.getElementById('cylinder')?.addEventListener('blur', () => {
      enforceNegativeCylinder();
      enforceAxisRange();
    });

    document.getElementById('axis')?.addEventListener('input', () => {
      enforceAxisRange();
    });

    document.getElementById('axis')?.addEventListener('blur', () => {
      enforceAxisRange();
    });

    document.getElementById('image')?.addEventListener('change', (e) => {
      const file = e.target?.files?.[0] || null;
      readImagePreview(file);
    });

    btnAddTreatment?.addEventListener('click', () => {
      const catId = document.getElementById('category_id')?.value || '';
      const cat = (categories || []).find(x => String(x.id) === String(catId));
      if (!isMicaCategory(cat)) {
        Swal.fire('No aplica', 'Los tratamientos solo se configuran para categorías marcadas como mica.', 'info');
        return;
      }

      addTreatmentSelect('');
    });

    treatmentsContainer?.addEventListener('click', (e) => {
      const btn = e.target.closest('.treatment-remove');
      if (!btn) return;

      const item = btn.closest('.treatment-item');
      if (item) {
        item.remove();
        refreshAllTreatmentSelectOptions();
      }
    });

    treatmentsContainer?.addEventListener('change', (e) => {
      const select = e.target.closest('.treatment-select');
      if (!select) return;

      select.dataset.selected = select.value || '';
      refreshAllTreatmentSelectOptions();
      validateTreatmentDuplicates();
    });

    treatmentsContainer?.addEventListener('mouseover', (e) => {
      const item = e.target.closest('.treatment-item');
      if (!item) return;

      item.style.boxShadow = '0 0 0 2px rgba(126,87,194,.12)';
      const btn = item.querySelector('.treatment-remove');
      if (btn) {
        btn.style.opacity = '1';
        btn.style.pointerEvents = 'auto';
      }
    });

    treatmentsContainer?.addEventListener('mouseout', (e) => {
      const item = e.target.closest('.treatment-item');
      if (!item) return;

      item.style.boxShadow = '';
      const btn = item.querySelector('.treatment-remove');
      if (btn) {
        btn.style.opacity = '0';
        btn.style.pointerEvents = 'none';
      }
    });

    btnSave?.addEventListener('click', async () => {
      clearLensErrors();

      const id = document.getElementById('productId').value || '';

      const sku = document.getElementById('sku').value.trim();
      const name = document.getElementById('name').value.trim();
      const category_id = Number(document.getElementById('category_id').value || 0);

      if (!category_id) {
        Swal.fire('Faltan datos', 'La categoría es obligatoria.', 'info');
        return;
      }

      const cat = (categories || []).find(x => String(x.id) === String(category_id));
      const isMicas = isMicaCategory(cat);
      const isBulkMica = !id && isMicas;

      if (!isBulkMica && (!sku || !name)) {
        Swal.fire('Faltan datos', 'SKU y Nombre son obligatorios.', 'info');
        return;
      }

      const supplier_id = (document.getElementById('supplier_id').value === '' ? null : Number(document.getElementById('supplier_id').value));
      const box_id = (document.getElementById('box_id').value === '' ? null : Number(document.getElementById('box_id').value));
      const lens_type_id = (document.getElementById('lens_type_id').value === '' ? null : Number(document.getElementById('lens_type_id').value));
      const material_id = (document.getElementById('material_id').value === '' ? null : Number(document.getElementById('material_id').value));
      const sphere = (document.getElementById('sphere').value === '' ? null : Number(document.getElementById('sphere').value));
      const cylinder = (document.getElementById('cylinder').value === '' ? null : Number(document.getElementById('cylinder').value));
      const axis = (document.getElementById('axis').value === '' ? null : Number(document.getElementById('axis').value));

      if (isBulkMica) {
        const sphereMin = document.getElementById('sphere_min').value === '' ? null : Number(document.getElementById('sphere_min').value);
        const sphereMax = document.getElementById('sphere_max').value === '' ? null : Number(document.getElementById('sphere_max').value);
        const cylinderMax = document.getElementById('cylinder_max').value === '' ? null : Number(document.getElementById('cylinder_max').value);
        const initialStock = document.getElementById('initial_stock').value === '' ? 0 : Number(document.getElementById('initial_stock').value);

        if (sphereMin === null || sphereMax === null || cylinderMax === null) {
          Swal.fire('Faltan rangos', 'Captura esfera mínima, esfera máxima y cilindro máximo negativo.', 'info');
          return;
        }

        if (!isQuarterStep(sphereMin) || !isQuarterStep(sphereMax) || !isQuarterStep(cylinderMax)) {
          Swal.fire('Rangos inválidos', 'Los valores deben ir en incrementos de 0.25.', 'warning');
          return;
        }

        if (sphereMin > sphereMax) {
          Swal.fire('Rango inválido', 'La esfera mínima no puede ser mayor a la esfera máxima.', 'warning');
          return;
        }

        if (cylinderMax > 0) {
          Swal.fire('Rango inválido', 'El cilindro máximo no puede ser positivo.', 'warning');
          return;
        }

        if (!Number.isInteger(initialStock) || initialStock < 0) {
          Swal.fire('Stock inválido', 'El stock inicial debe ser un entero mayor o igual a 0.', 'warning');
          return;
        }
      } else {
        if (cylinder !== null && cylinder > 0) {
          setFieldError('cylinder', 'cylinderError', 'No se permiten números positivos.');
          return;
        }

        if (cylinder !== null && cylinder === 0 && !isMicas) {
          setFieldError('cylinder', 'cylinderError', 'El cilindro no puede ser 0. Debe ser negativo.');
          return;
        }

        if (!isMicas && cylinder !== null && axis === null) {
          setFieldError('axis', 'axisError', 'Si capturas cilindro debes capturar el eje.');
          return;
        }

        if (!isMicas && axis !== null && cylinder === null) {
          setFieldError('axis', 'axisError', 'Si capturas eje debes capturar cilindro.');
          return;
        }

        if (axis !== null && (axis < 0 || axis > 180)) {
          setFieldError('axis', 'axisError', 'El eje debe estar entre 0 y 180.');
          return;
        }

        if (!isMicas && axis !== null && cylinder !== null && cylinder >= 0) {
          setFieldError('axis', 'axisError', 'El eje solo aplica cuando el cilindro es negativo.');
          return;
        }

        if (sphere !== null && (sphere < -40 || sphere > 40)) {
          Swal.fire('Dato inválido', 'sphere debe estar entre -40 y 40', 'warning');
          return;
        }
      }

      if (!validateTreatmentDuplicates()) {
        return;
      }

      const treatmentIds = isMicas
        ? getSelectedTreatmentIds()
        : [];

      const imageFile = document.getElementById('image')?.files?.[0] || null;

      const formData = new FormData();

      if (!id && isMicas) {
        formData.append('generate_micas', '1');
        formData.append('category_id', String(category_id));

        appendIfNotNull(formData, 'description', (document.getElementById('description').value || '').trim() || null);
        appendIfNotNull(formData, 'minStock', document.getElementById('minStock').value || 0);
        appendIfNotNull(formData, 'maxStock', document.getElementById('maxStock').value === '' ? null : document.getElementById('maxStock').value);

        appendIfNotNull(formData, 'supplier_id', supplier_id);
        appendIfNotNull(formData, 'box_id', box_id);
        appendIfNotNull(formData, 'lens_type_id', lens_type_id);
        appendIfNotNull(formData, 'material_id', material_id);

        formData.append('sphere_min', document.getElementById('sphere_min').value);
        formData.append('sphere_max', document.getElementById('sphere_max').value);
        formData.append('cylinder_max', document.getElementById('cylinder_max').value);
        formData.append('initial_stock', document.getElementById('initial_stock').value || '0');
        formData.append('skip_existing', '1');

        treatmentIds.forEach(tid => {
          formData.append('treatments[]', String(tid));
        });
      } else {
        formData.append('sku', sku);
        formData.append('name', name);
        formData.append('category_id', String(category_id));

        appendIfNotNull(formData, 'description', (document.getElementById('description').value || '').trim() || null);
        appendIfNotNull(formData, 'buyPrice', document.getElementById('buyPrice').value || 0);
        appendIfNotNull(formData, 'salePrice', document.getElementById('salePrice').value || 0);
        appendIfNotNull(formData, 'minStock', document.getElementById('minStock').value || 0);
        appendIfNotNull(formData, 'maxStock', document.getElementById('maxStock').value === '' ? null : document.getElementById('maxStock').value);

        appendIfNotNull(formData, 'supplier_id', supplier_id);
        appendIfNotNull(formData, 'box_id', box_id);
        appendIfNotNull(formData, 'lens_type_id', lens_type_id);
        appendIfNotNull(formData, 'material_id', material_id);
        appendIfNotNull(formData, 'sphere', sphere);
        appendIfNotNull(formData, 'cylinder', cylinder);

        if (!isMicas) {
                    appendIfNotNull(formData, 'axis', axis);
        }

        treatmentIds.forEach(tid => {
          formData.append('treatments[]', String(tid));
        });
        
        if (imageFile) {
          formData.append('image', imageFile);
        }
      }

      try {
        if (id) {
          await inventoryService.updateProduct(id, formData);
        } else {
          await inventoryService.createProduct(formData);
        }

        productModal.hide();
        Swal.fire('Guardado', 'Producto guardado.', 'success');
        await refresh('inventory');
      } catch (err) {
        console.error(err);
        Swal.fire('Error', extractAxiosErrorMessage(err), 'error');
      }
    });
  };

  const openCreateCategory = async () => {
  if (!canEdit) return;

  const r = await Swal.fire({
    title: 'Nueva categoría',
    html: `
      <div class="text-start">
        <label class="form-label">CODE</label>
        <input id="swCatCode" class="form-control" placeholder="Ej: MICA_FOTOCROMATICA_NEGRA">

        <label class="form-label mt-2">Nombre</label>
        <input id="swCatName" class="form-control" placeholder="Ej: Mica fotocromática negra">

        <label class="form-label mt-2">Descripción (opcional)</label>
        <input id="swCatDesc" class="form-control" placeholder="Opcional">

        <div class="form-check form-switch mt-3">
          <input class="form-check-input" type="checkbox" id="swCatIsMica">
          <label class="form-check-label" for="swCatIsMica">
            Esta categoría es una mica
          </label>
        </div>

        <div class="row g-2 mt-1">
          <div class="col-6">
            <label class="form-label">Precio compra</label>
            <input id="swCatBuyPrice" type="number" min="0" step="0.01" class="form-control" value="0.00">
          </div>
          <div class="col-6">
            <label class="form-label">Precio venta</label>
            <input id="swCatSalePrice" type="number" min="0" step="0.01" class="form-control" value="0.00">
          </div>
        </div>

        <label class="form-label mt-3">Imagen de la categoría</label>
        <input id="swCatImage" type="file" accept="image/*" class="form-control">
        <div class="form-text">
          Esta imagen será usada por las micas de esta categoría cuando el producto no tenga imagen propia.
        </div>

        <div class="small text-muted mt-2">
          Si marcas la categoría como mica, los productos generados tomarán estos precios.
        </div>
      </div>
    `,
    focusConfirm: false,
    showCancelButton: true,
    confirmButtonText: 'Guardar',
    preConfirm: () => {
      const code = document.getElementById('swCatCode')?.value?.trim() || '';
      const name = document.getElementById('swCatName')?.value?.trim() || '';
      const description = document.getElementById('swCatDesc')?.value?.trim() || '';
      const is_mica = Boolean(document.getElementById('swCatIsMica')?.checked);
      const buy_price = Number(document.getElementById('swCatBuyPrice')?.value || 0);
      const sale_price = Number(document.getElementById('swCatSalePrice')?.value || 0);
      const image = document.getElementById('swCatImage')?.files?.[0] || null;

      if (!code || !name) {
        Swal.showValidationMessage('CODE y Nombre son obligatorios');
        return false;
      }

      if (Number.isNaN(buy_price) || buy_price < 0) {
        Swal.showValidationMessage('Precio compra inválido');
        return false;
      }

      if (Number.isNaN(sale_price) || sale_price < 0) {
        Swal.showValidationMessage('Precio venta inválido');
        return false;
      }

      return { code, name, description, is_mica, buy_price, sale_price, image };
    }
  });

  if (!r.isConfirmed) return;

  try {
    const formData = buildCategoryFormData({
      code: r.value.code,
      name: r.value.name,
      description: r.value.description || '',
      is_mica: r.value.is_mica,
      buy_price: r.value.buy_price,
      sale_price: r.value.sale_price,
      image: r.value.image
    });

    await api.post('/categories', formData);

    Swal.fire('Listo', 'Categoría creada.', 'success');
    await refresh('categories');
  } catch (e) {
    console.error(e);
    Swal.fire('Error', extractAxiosErrorMessage(e), 'error');
  }
};

  const openEditCategory = async (catId) => {
  if (!canEdit) return;

  const cat = (categories || []).find(x => String(x.id) === String(catId));
  const currentName = pickCategoryName(cat);
  const currentCode = pickCategoryCode(cat);
  const currentDesc = cat?.description ?? '';
  const currentIsMica = isMicaCategory(cat);
  const currentBuyPrice = categoryBuyPrice(cat);
  const currentSalePrice = categorySalePrice(cat);
  const currentImageUrl = categoryImageUrl(cat);
  const currentHasImage = categoryHasImage(cat);

  const r = await Swal.fire({
    title: 'Editar categoría',
    html: `
      <div class="text-start">
        <label class="form-label">CODE</label>
        <input id="swCatCode" class="form-control" value="${safe(currentCode)}">

        <label class="form-label mt-2">Nombre</label>
        <input id="swCatName" class="form-control" value="${safe(currentName)}">

        <label class="form-label mt-2">Descripción (opcional)</label>
        <input id="swCatDesc" class="form-control" value="${safe(currentDesc)}">

        <div class="form-check form-switch mt-3">
          <input class="form-check-input" type="checkbox" id="swCatIsMica" ${currentIsMica ? 'checked' : ''}>
          <label class="form-check-label" for="swCatIsMica">
            Esta categoría es una mica
          </label>
        </div>

        <div class="row g-2 mt-1">
          <div class="col-6">
            <label class="form-label">Precio compra</label>
            <input id="swCatBuyPrice" type="number" min="0" step="0.01" class="form-control" value="${safe(formatMoneyInput(currentBuyPrice))}">
          </div>
          <div class="col-6">
            <label class="form-label">Precio venta</label>
            <input id="swCatSalePrice" type="number" min="0" step="0.01" class="form-control" value="${safe(formatMoneyInput(currentSalePrice))}">
          </div>
        </div>

        <div class="mt-3">
          <label class="form-label">Imagen de la categoría</label>

          <div class="d-flex align-items-center gap-3 flex-wrap">
            <div style="width:84px;height:84px;display:flex;align-items:center;justify-content:center;border:1px solid #ddd;border-radius:8px;background:#fff;">
              ${currentImageUrl
                ? `
                  <span id="swCatImageLoading" class="small text-muted">Cargando</span>
                  <img
                    id="swCatCurrentImage"
                    class="d-none"
                    alt="Imagen categoría"
                    style="width:78px;height:78px;object-fit:contain;"
                  >
                `
                : '<span class="small text-muted">Sin imagen</span>'
              }
            </div>

            <div class="flex-grow-1">
              <input id="swCatImage" type="file" accept="image/*" class="form-control">
              <div class="form-text">Sube una imagen nueva para reemplazar la actual.</div>
            </div>
          </div>
        </div>

        ${currentHasImage ? `
          <div class="form-check mt-2">
            <input class="form-check-input" type="checkbox" id="swCatRemoveImage">
            <label class="form-check-label" for="swCatRemoveImage">
              Quitar imagen actual
            </label>
          </div>
        ` : ''}

        <div class="small text-muted mt-2">
          Si cambias precios, el sistema te preguntará si quieres actualizarlos también en los productos existentes.
        </div>
      </div>
    `,
    focusConfirm: false,
    showCancelButton: true,
    confirmButtonText: 'Guardar',
    didOpen: async () => {
      if (!currentImageUrl) return;

      const img = document.getElementById('swCatCurrentImage');
      const loading = document.getElementById('swCatImageLoading');

      await loadProtectedImageInto(img, currentImageUrl);

      if (loading) loading.remove();
    },
    preConfirm: () => {
      const code = document.getElementById('swCatCode')?.value?.trim() || '';
      const name = document.getElementById('swCatName')?.value?.trim() || '';
      const description = document.getElementById('swCatDesc')?.value?.trim() || '';
      const is_mica = Boolean(document.getElementById('swCatIsMica')?.checked);
      const buy_price = Number(document.getElementById('swCatBuyPrice')?.value || 0);
      const sale_price = Number(document.getElementById('swCatSalePrice')?.value || 0);
      const image = document.getElementById('swCatImage')?.files?.[0] || null;
      const remove_image = Boolean(document.getElementById('swCatRemoveImage')?.checked);

      if (!code || !name) {
        Swal.showValidationMessage('CODE y Nombre son obligatorios');
        return false;
      }

      if (Number.isNaN(buy_price) || buy_price < 0) {
        Swal.showValidationMessage('Precio compra inválido');
        return false;
      }

      if (Number.isNaN(sale_price) || sale_price < 0) {
        Swal.showValidationMessage('Precio venta inválido');
        return false;
      }

      if (remove_image && image) {
        Swal.showValidationMessage('Elige solo una opción: quitar imagen o subir una nueva.');
        return false;
      }

      return { code, name, description, is_mica, buy_price, sale_price, image, remove_image };
    }
  });

  if (!r.isConfirmed) return;

  const pricesChanged =
    Math.abs(Number(r.value.buy_price) - Number(currentBuyPrice)) > 0.00001 ||
    Math.abs(Number(r.value.sale_price) - Number(currentSalePrice)) > 0.00001;

  let update_products_prices = false;

  if (pricesChanged && r.value.is_mica) {
    const confirmPrices = await Swal.fire({
      title: 'Cambió el precio',
      html: `
        <div class="text-start">
          <p class="mb-2">¿Quieres aplicar estos nuevos precios a todos los productos existentes de esta categoría?</p>
          <div class="border rounded p-2 bg-light">
            <div><b>Compra anterior:</b> ${money(currentBuyPrice)}</div>
            <div><b>Compra nueva:</b> ${money(r.value.buy_price)}</div>
            <div><b>Venta anterior:</b> ${money(currentSalePrice)}</div>
            <div><b>Venta nueva:</b> ${money(r.value.sale_price)}</div>
          </div>
          <div class="small text-muted mt-2">
            Esto no modifica pedidos ya creados, solo productos del inventario.
          </div>
        </div>
      `,
      icon: 'question',
      showDenyButton: true,
      showCancelButton: true,
      confirmButtonText: 'Actualizar productos',
      denyButtonText: 'Solo categoría',
      cancelButtonText: 'Cancelar'
    });

    if (confirmPrices.isDismissed) return;

    update_products_prices = confirmPrices.isConfirmed;
  }

  try {
    const formData = buildCategoryFormData({
      code: r.value.code,
      name: r.value.name,
      description: r.value.description || '',
      is_mica: r.value.is_mica,
      buy_price: r.value.buy_price,
      sale_price: r.value.sale_price,
      update_products_prices,
      remove_image: r.value.remove_image,
      image: r.value.image
    });

    const res = await api.post(`/categories/${catId}`, formData);

    const updatedCount = Number(res?.updated_products ?? res?.data?.updated_products ?? 0);

    Swal.fire(
      'Listo',
      update_products_prices
        ? `Categoría actualizada. Productos actualizados: ${updatedCount}.`
        : 'Categoría actualizada.',
      'success'
    );

    await refresh('categories');
  } catch (e) {
    console.error(e);
    Swal.fire('Error', extractAxiosErrorMessage(e), 'error');
  }
};

  const deleteCategory = async (catId) => {
    if (!canEdit) return;

    const r = await Swal.fire({
      title: '¿Borrar categoría?',
      text: 'Si hay productos usando esta categoría, el backend puede rechazarlo.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, borrar'
    });

    if (!r.isConfirmed) return;

    try {
      await inventoryService.deleteCategory(catId);
      Swal.fire('Listo', 'Categoría eliminada.', 'success');
      await refresh('categories');
    } catch (e) {
      console.error(e);
      Swal.fire('Error', extractAxiosErrorMessage(e), 'error');
    }
  };

  const addStock = async (productId) => {
    if (!canEdit) return;

    const r = await Swal.fire({
      title: 'Aumentar stock',
      input: 'number',
      inputLabel: 'Cantidad a agregar',
      inputAttributes: { min: 1, step: 1 },
      inputValue: 1,
      showCancelButton: true,
      confirmButtonText: 'Agregar',
      inputValidator: (v) => {
        const n = Number(v);
        if (!Number.isInteger(n) || n <= 0) return 'Debe ser un entero mayor a 0';
        return null;
      }
    });

    if (!r.isConfirmed) return;

    try {
      await inventoryService.addStock(productId, { qty: Number(r.value), note: 'Entrada desde inventario' });
      Swal.fire('Listo', 'Stock actualizado.', 'success');
      await refresh('inventory');
    } catch (e) {
      console.error(e);
      Swal.fire('Error', extractAxiosErrorMessage(e), 'error');
    }
  };

  const deleteProduct = async (productId) => {
    if (!canEdit) return;

    const r = await Swal.fire({
      title: '¿Eliminar producto?',
      text: 'Esta acción se confirmará.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, borrar'
    });

    if (!r.isConfirmed) return;

    try {
      await inventoryService.deleteProduct(productId);
      Swal.fire('Listo', 'Producto eliminado.', 'success');
      await refresh('inventory');
    } catch (e) {
      console.error(e);
      Swal.fire('Error', extractAxiosErrorMessage(e), 'error');
    }
  };

  const bulkDeleteProducts = async () => {
    if (!canEdit) return;

    const ids = Array.from(selectedProductIds)
      .map(id => Number(id))
      .filter(id => Number.isInteger(id) && id > 0);

    if (!ids.length) {
      Swal.fire('Sin selección', 'Selecciona al menos un producto.', 'info');
      return;
    }

    const selected = selectedProductsSummary();

    const preview = selected
      .slice(0, 12)
      .map(p => `<li><b>${safe(p.name || `Producto #${p.id}`)}</b>${p.sku ? ` <span class="text-muted">(${safe(p.sku)})</span>` : ''}</li>`)
      .join('');

    const more = selected.length > 12
      ? `<div class="small text-muted mt-2">Y ${selected.length - 12} producto(s) más...</div>`
      : '';

    const r = await Swal.fire({
      title: `¿Borrar ${ids.length} producto(s)?`,
      html: `
        <div class="text-start">
          <p>Esta acción enviará los productos seleccionados al borrado lógico.</p>
          <ul class="mb-0">
            ${preview}
          </ul>
          ${more}
          <div class="alert alert-warning mt-3 mb-0">
            Si algún producto tiene stock reservado, el backend puede omitirlo.
          </div>
        </div>
      `,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, borrar seleccionados',
      cancelButtonText: 'Cancelar'
    });

    if (!r.isConfirmed) return;

    try {
      const res = await api.delete('/products/bulk-delete', {
        data: { ids }
      });

      const data = res?.data ?? res ?? {};
      const deletedCount = Number(data.deleted_count ?? 0);
      const skippedCount = Number(data.skipped_count ?? 0);

      selectedProductIds.clear();

      let msg = `Productos borrados: ${deletedCount}.`;

      if (skippedCount > 0) {
        msg += `<br>Productos omitidos: ${skippedCount}.`;
      }

      Swal.fire('Listo', msg, skippedCount > 0 ? 'warning' : 'success');

      await refresh('inventory');
    } catch (e) {
      console.error(e);
      Swal.fire('Error', extractAxiosErrorMessage(e), 'error');
    }
  };

  const loadData = async () => {
    try {
      const [cats, lt, mats, sups, bxs, trts] = await Promise.all([
        inventoryService.listCategories(),
        api.get('/lens-types'),
        api.get('/materials'),
        api.get('/suppliers'),
        api.get('/boxes'),
        api.get('/treatments'),
      ]);

      categories = Array.isArray(cats) ? cats : [];
      window.__inventoryCategories = categories;
      lensTypes = Array.isArray(lt?.data) ? lt.data : (Array.isArray(lt) ? lt : []);
      materials = Array.isArray(mats?.data) ? mats.data : (Array.isArray(mats) ? mats : []);
      suppliers = Array.isArray(sups?.data) ? sups.data : (Array.isArray(sups) ? sups : []);
      boxes = Array.isArray(bxs?.data) ? bxs.data : (Array.isArray(bxs) ? bxs : []);
      treatmentsCatalog = Array.isArray(trts?.data) ? trts.data : (Array.isArray(trts) ? trts : []);
    } catch (e) {
      console.warn('No se pudieron cargar catálogos:', e);
      categories = [];
      lensTypes = [];
      materials = [];
      suppliers = [];
      boxes = [];
      treatmentsCatalog = [];
    }

    if (view === 'inventory') {
      const raw = await inventoryService.list();
      inventoryRows = normalizeInventoryRows(raw);

      const map = new Map((categories || []).map(c => [String(c.id), pickCategoryName(c)]));
      inventoryRows = inventoryRows.map(r => {
        const p = r.product || {};
        if (!p.categoryLabel && p.categoryId && map.has(String(p.categoryId))) {
          p.categoryLabel = map.get(String(p.categoryId));
        }
        return r;
      });
    }
  };

  const draw = async () => {
    renderShell();
    if (canEdit) renderTopActions();

    outlet.querySelector('#tabInventory')?.addEventListener('click', async () => { await refresh('inventory'); });
    outlet.querySelector('#tabCategories')?.addEventListener('click', async () => { await refresh('categories'); });

    outlet.querySelector('#btnRefresh')?.addEventListener('click', async () => { await refresh(view); });

    outlet.querySelector('#btnNewProduct')?.addEventListener('click', async () => {
      if (!categories.length) {
        Swal.fire('Sin categorías', 'Primero crea una categoría en “Categorías”.', 'info');
        return;
      }
      await openProductModal(null);
    });

    outlet.querySelector('#btnNewCategory')?.addEventListener('click', async () => { await openCreateCategory(); });

    if (view === 'inventory') renderInventoryTable();
    else renderCategoriesTable();

    outlet.addEventListener('click', onOutletClick);
  };

  const cleanup = () => {
    outlet.removeEventListener('click', onOutletClick);
  };

  const refresh = async (nextView) => {
    cleanup();
    view = nextView;
    outlet.dataset.invView = view;

    if (view !== 'inventory') {
      selectedProductIds.clear();
    }

    await loadData();

    if (view === 'inventory') {
      const validIds = new Set(
        inventoryRows
          .map(r => String(r.product?.id ?? ''))
          .filter(Boolean)
      );

      selectedProductIds = new Set(
        Array.from(selectedProductIds).filter(id => validIds.has(String(id)))
      );
    }

    await draw();
  };

  async function onOutletClick(e) {
    const t = e.target;

    if (view === 'inventory') {
      if (t?.dataset?.bulkDelete) {
        await bulkDeleteProducts();
        return;
      }

      if (t?.dataset?.clearSelection) {
        selectedProductIds.clear();
        syncInventorySelectionChecks();

        const clearBtn = outlet.querySelector('#btnClearSelection');
        if (clearBtn) clearBtn.disabled = true;

        return;
      }

      if (t?.id === 'chkInvAll') {
        const checked = Boolean(t.checked);

        outlet.querySelectorAll('[data-product-check]').forEach(chk => {
          const id = String(chk.dataset.productCheck || '');

          chk.checked = checked;

          if (checked) {
            selectedProductIds.add(id);
          } else {
            selectedProductIds.delete(id);
          }
        });

        syncInventorySelectionChecks();

        const clearBtn = outlet.querySelector('#btnClearSelection');
        if (clearBtn) clearBtn.disabled = selectedProductIds.size === 0;

        return;
      }

      if (t?.dataset?.productCheck) {
        const id = String(t.dataset.productCheck || '');

        if (t.checked) {
          selectedProductIds.add(id);
        } else {
          selectedProductIds.delete(id);
        }

        syncInventorySelectionChecks();

        const clearBtn = outlet.querySelector('#btnClearSelection');
        if (clearBtn) clearBtn.disabled = selectedProductIds.size === 0;

        return;
      }

      const addStockId = t?.dataset?.addstock;
      const editId = t?.dataset?.edit;
      const delId = t?.dataset?.del;

      if (addStockId) {
        await addStock(addStockId);
        return;
      }

      if (editId) {
        try {
          const fullProduct = await inventoryService.getProduct(editId);
          await openProductModal(fullProduct);
        } catch (err) {
          console.error(err);
          Swal.fire('Error', 'No se pudo cargar el producto para editar.', 'error');
        }
        return;
      }

      if (delId) {
        await deleteProduct(delId);
        return;
      }
    }

    if (view === 'categories') {
      const catEditId = t?.dataset?.catEdit;
      const catDelId = t?.dataset?.catDel;

      if (catEditId) {
        await openEditCategory(catEditId);
        return;
      }

      if (catDelId) {
        await deleteCategory(catDelId);
        return;
      }
    }
  }

  await loadData();
  await draw();
}