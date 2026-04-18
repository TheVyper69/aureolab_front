// public/assets/js/pages/inventory.js
// INVENTORY (FULL)
// - Modal crea/edita productos con payload NUEVO (FKs + sphere/cylinder/axis + treatments[])
// - Usa selects para: Type, Material, Supplier, Box
// - Soporta imagen con preview a la derecha
// - Muestra/oculta campos según categoría (MICAS / LENTES_CONTACTO / otros)
// - Guarda con FormData
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
  if (!cylinderEl || !axisEl) return;

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

  if (num === 0) {
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

        categoryCode: p.category ?? '',
        categoryLabel: p.category_label ?? p.categoryLabel ?? '',
        categoryId: p.category_id ?? p.categoryId ?? null,

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
        <button class="btn btn-outline-brand" id="btnRefresh">Actualizar</button>
        <button class="btn btn-brand" id="btnNewProduct">Nuevo producto</button>
      `;
    } else {
      box.innerHTML = `
        <button class="btn btn-outline-brand" id="btnRefresh">Actualizar</button>
        <button class="btn btn-brand" id="btnNewCategory">Nueva categoría</button>
      `;
    }
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

                  <div class="col-md-4">
                    <label class="form-label">SKU</label>
                    <input class="form-control" id="sku" required>
                  </div>

                  <div class="col-md-8">
                    <label class="form-label">Nombre</label>
                    <input class="form-control" id="name" required>
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
                  </div>

                  <div class="col-md-6">
                    <label class="form-label">Precio venta</label>
                    <input type="number" class="form-control" id="salePrice" min="0" step="0.01">
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

                      <div class="col-md-4">
                        <label class="form-label">Esfera</label>
                        <input type="number" class="form-control" id="sphere" step="0.25" min="-40" max="40" placeholder="Ej: -2.00 o 1.25">
                      </div>

                      <div class="col-md-4">
                        <label class="form-label">Cilindro</label>
                        <input type="number" class="form-control" id="cylinder" step="0.25" max="0" placeholder="Ej: -0.50">
                        <span id="cylinderError" class="text-danger small d-none"></span>
                      </div>

                      <div class="col-md-4">
                        <label class="form-label">Eje</label>
                        <input type="number" class="form-control" id="axis" min="0" max="180" step="1" placeholder="Ej: 90">
                        <span id="axisError" class="text-danger small d-none"></span>
                      </div>

                      <div class="col-12">
                        <div class="small text-muted">
                          Type, Material, Supplier, Box, Esfera, Cilindro y Eje solo aplican para MICAS y LENTES_CONTACTO.
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
                        <div class="form-text">Selecciona una imagen para el producto.</div>
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
        <div class="table-responsive">
          <table id="tblInventory" class="table table-striped align-middle" style="width:100%">
            <thead>
              <tr>
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

                return `
                  <tr class="${low ? 'table-warning' : ''}">
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
          ${canEdit ? 'Admin: CRUD + stock.' : 'Solo admin logeado puede editar.'}
        </div>
      </div>

      ${canEdit ? renderProductModalHtml() : ''}
    `;

    mountDataTable('#tblInventory');

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
                ${canEdit ? '<th>Acciones</th>' : ''}
              </tr>
            </thead>
            <tbody>
              ${(categories || []).map(c => {
                const id = c.id ?? '';
                const code = pickCategoryCode(c);
                const name = pickCategoryName(c);
                const desc = c.description ?? '';
                return `
                  <tr>
                    <td>${safe(id)}</td>
                    <td><code>${safe(code)}</code></td>
                    <td>${safe(name)}</td>
                    <td>${safe(desc)}</td>
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
  };

  function toggleLensSection() {
    const catId = document.getElementById('category_id')?.value || '';
    const cat = (categories || []).find(x => String(x.id) === String(catId));
    const code = pickCategoryCode(cat);

    const lensSection = document.getElementById('lensSection');
    const treatmentsSection = document.getElementById('treatmentsSection');
    if (!lensSection) return;

    const isMicas = (code === 'MICAS');
    const isContacts = (code === 'LENTES_CONTACTO');
    const isLens = isMicas || isContacts;

    lensSection.classList.toggle('d-none', !isLens);
    if (treatmentsSection) {
      treatmentsSection.classList.toggle('d-none', !isMicas);
    }

    if (!isLens) {
      ['lens_type_id', 'material_id', 'supplier_id', 'box_id', 'sphere', 'cylinder', 'axis'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      clearLensErrors();
    }

    if (!isMicas) {
      const container = getTreatmentsContainer();
      if (container) container.innerHTML = '';
    }

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
      const code = pickCategoryCode(cat);

      if (code !== 'MICAS') {
        Swal.fire('No aplica', 'Los tratamientos solo se configuran para MICAS.', 'info');
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

      if (!sku || !name || !category_id) {
        Swal.fire('Faltan datos', 'SKU, Nombre y Categoría son obligatorios.', 'info');
        return;
      }

      const supplier_id = (document.getElementById('supplier_id').value === '' ? null : Number(document.getElementById('supplier_id').value));
      const box_id = (document.getElementById('box_id').value === '' ? null : Number(document.getElementById('box_id').value));
      const lens_type_id = (document.getElementById('lens_type_id').value === '' ? null : Number(document.getElementById('lens_type_id').value));
      const material_id = (document.getElementById('material_id').value === '' ? null : Number(document.getElementById('material_id').value));
      const sphere = (document.getElementById('sphere').value === '' ? null : Number(document.getElementById('sphere').value));
      const cylinder = (document.getElementById('cylinder').value === '' ? null : Number(document.getElementById('cylinder').value));
      const axis = (document.getElementById('axis').value === '' ? null : Number(document.getElementById('axis').value));

      if (cylinder !== null && cylinder > 0) {
        setFieldError('cylinder', 'cylinderError', 'No se permiten números positivos.');
        return;
      }

      if (cylinder !== null && cylinder === 0) {
        setFieldError('cylinder', 'cylinderError', 'El cilindro no puede ser 0. Debe ser negativo.');
        return;
      }

      if (cylinder !== null && axis === null) {
        setFieldError('axis', 'axisError', 'Si capturas cilindro debes capturar el eje.');
        return;
      }

      if (axis !== null && cylinder === null) {
        setFieldError('axis', 'axisError', 'Si capturas eje debes capturar cilindro.');
        return;
      }

      if (axis !== null && (axis < 0 || axis > 180)) {
        setFieldError('axis', 'axisError', 'El eje debe estar entre 0 y 180.');
        return;
      }

      if (axis !== null && cylinder !== null && cylinder >= 0) {
        setFieldError('axis', 'axisError', 'El eje solo aplica cuando el cilindro es negativo.');
        return;
      }

      if (sphere !== null && (sphere < -40 || sphere > 40)) {
        Swal.fire('Dato inválido', 'sphere debe estar entre -40 y 40', 'warning');
        return;
      }

      if (!validateTreatmentDuplicates()) {
        return;
      }

      const cat = (categories || []).find(x => String(x.id) === String(category_id));
      const code = pickCategoryCode(cat);
      const treatmentIds = code === 'MICAS'
        ? getSelectedTreatmentIds()
        : [];

      const imageFile = document.getElementById('image')?.files?.[0] || null;

      const formData = new FormData();
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
      appendIfNotNull(formData, 'axis', axis);

      treatmentIds.forEach(tid => {
        formData.append('treatments[]', String(tid));
      });

      if (imageFile) {
        formData.append('image', imageFile);
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
          <input id="swCatCode" class="form-control" placeholder="Ej: MICAS">
          <label class="form-label mt-2">Nombre</label>
          <input id="swCatName" class="form-control" placeholder="Ej: Micas">
          <label class="form-label mt-2">Descripción (opcional)</label>
          <input id="swCatDesc" class="form-control" placeholder="Opcional">
        </div>
      `,
      focusConfirm: false,
      showCancelButton: true,
      confirmButtonText: 'Guardar',
      preConfirm: () => {
        const code = document.getElementById('swCatCode')?.value?.trim() || '';
        const name = document.getElementById('swCatName')?.value?.trim() || '';
        const description = document.getElementById('swCatDesc')?.value?.trim() || '';
        if (!code || !name) {
          Swal.showValidationMessage('CODE y Nombre son obligatorios');
          return false;
        }
        return { code, name, description };
      }
    });

    if (!r.isConfirmed) return;

    try {
      await inventoryService.createCategory({
        code: r.value.code,
        name: r.value.name,
        description: r.value.description || null
      });
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
        </div>
      `,
      focusConfirm: false,
      showCancelButton: true,
      confirmButtonText: 'Guardar',
      preConfirm: () => {
        const code = document.getElementById('swCatCode')?.value?.trim() || '';
        const name = document.getElementById('swCatName')?.value?.trim() || '';
        const description = document.getElementById('swCatDesc')?.value?.trim() || '';
        if (!code || !name) {
          Swal.showValidationMessage('CODE y Nombre son obligatorios');
          return false;
        }
        return { code, name, description };
      }
    });

    if (!r.isConfirmed) return;

    try {
      await inventoryService.updateCategory(catId, {
        code: r.value.code,
        name: r.value.name,
        description: r.value.description || null
      });
      Swal.fire('Listo', 'Categoría actualizada.', 'success');
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
    await loadData();
    await draw();
  };

  async function onOutletClick(e) {
    const t = e.target;

    if (view === 'inventory') {
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