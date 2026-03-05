// public/assets/js/pages/inventory.js
// INVENTORY (FULL) - REAL BACKEND (Laravel) + Sanctum token (Opción A)
//
// ✅ Funciona con tu backend actual:
// - ProductsController espera (store/update): sku, name, category (CODE), buyPrice, salePrice, minStock, maxStock, supplier, description, image
// - ProductsController.image(id): GET /api/products/{id}/image (protegida, requiere token)
// - InventoryService.updateProduct: si FormData => manda POST + _method=PUT (por tu 405)
// - CategoriesController: index/store/update/destroy con fields: code, name, description
//
// ✅ Lo que resuelve:
// - Evita el 422 de "category required ..." mandando category + category_id + categoryId
// - Select de categoría usa CODE (MICAS, BISEL, etc.) pero también resuelve el ID
// - Editar abre modal y carga imagen real usando api.getBlob (con token)
// - CRUD productos + CRUD categorías + add stock
// - DataTables con destroy correcto
//
// Requiere:
// - inventoryService.js (el que pegaste)
// - api.js (el que pegaste, con api.getBlob())
// - authService.js con getRole(), getToken(), logout()
// - Swal (SweetAlert2), bootstrap.Modal, jQuery + DataTables

import { inventoryService } from '../services/inventoryService.js';
import { authService } from '../services/authService.js';
import { api } from '../services/api.js';
import { money } from '../utils/helpers.js';

/* =========================
 * Helpers
 * ========================= */
function safe(v){
  return String(v ?? '')
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;');
}

function pickCategoryName(c){
  return c?.name ?? c?.label ?? c?.title ?? '';
}

function pickCategoryCode(c){
  // en tu backend: categories => { id, code, name }
  return String(c?.code ?? c?.slug ?? '').trim();
}

function buildCodeFromName(name){
  return String(name || '')
    .trim()
    .toUpperCase()
    .replaceAll('Á','A').replaceAll('É','E').replaceAll('Í','I').replaceAll('Ó','O').replaceAll('Ú','U').replaceAll('Ñ','N')
    .replace(/\s+/g,'_')
    .replace(/[^A-Z0-9_]/g,'');
}

function mountDataTable(selector){
  if(!(window.$ && $.fn.dataTable)) return null;

  if($.fn.DataTable.isDataTable(selector)){
    $(selector).DataTable().destroy();
  }

  return $(selector).DataTable({
    pageLength: 10,
    language: {
      search: "Buscar:",
      lengthMenu: "Mostrar _MENU_",
      info: "Mostrando _START_ a _END_ de _TOTAL_",
      paginate: { previous: "Anterior", next: "Siguiente" },
      zeroRecords: "No hay registros"
    }
  });
}

function extractAxiosErrorMessage(err){
  const status = err?.response?.status;
  const data = err?.response?.data;

  if(status === 422 && data?.errors){
    const lines = [];
    for(const k of Object.keys(data.errors)){
      const arr = data.errors[k] || [];
      for(const msg of arr){
        lines.push(`• ${msg}`);
      }
    }
    return lines.length ? lines.join('<br>') : (data.message || 'Error de validación');
  }
  return data?.message || err?.message || 'Ocurrió un error';
}

/* =========================
 * Normalización INVENTARIO
 * A) API real (flat):
 * [{ id, sku, name, description, category (string o obj), category_id, buy_price, sale_price, min_stock, max_stock, stock, supplier }]
 * B) mock viejo:
 * [{ stock, product:{...} }]
 * ========================= */
function normalizeInventoryRows(rows){
  const arr = Array.isArray(rows) ? rows : [];

  // ✅ Tu backend actual regresa:
  // [{ stock, critical, product:{...}, variants:[...] }]
  // Entonces si existe "product", NO es flat.
  const isWrapped = arr.length && arr[0] && typeof arr[0] === 'object'
    && Object.prototype.hasOwnProperty.call(arr[0], 'product');

  if(isWrapped){
    return arr.map(r=>{
      const p = r.product || {};
      return {
        stock: Number(r.stock ?? 0),
        critical: Boolean(r.critical ?? false),
        product: {
          id: p.id,
          sku: p.sku ?? '',
          name: p.name ?? '',
          description: p.description ?? '',
          // ✅ tus campos reales
          categoryCode: p.category ?? '',
          categoryLabel: p.category_label ?? p.categoryLabel ?? '',
          categoryId: p.category_id ?? p.categoryId ?? null,

          supplier: p.supplier ?? p.supplier_name ?? '',
          minStock: Number(p.minStock ?? p.min_stock ?? 0),
          maxStock: (p.maxStock ?? p.max_stock ?? null),

          buyPrice: Number(p.buyPrice ?? p.buy_price ?? 0),
          salePrice: Number(p.salePrice ?? p.sale_price ?? 0),

          imageUrl: p.imageUrl ?? null,

          // por si luego lo usas
          variants: Array.isArray(r.variants) ? r.variants : (Array.isArray(p.variants) ? p.variants : []),
        },
        variants: Array.isArray(r.variants) ? r.variants : []
      };
    });
  }

  // ✅ “flat” REAL: productos vienen en raíz sin "product"
  const looksFlat = arr.length && arr[0] && typeof arr[0] === 'object' && !arr[0].product && (
    Object.prototype.hasOwnProperty.call(arr[0], 'sku') ||
    Object.prototype.hasOwnProperty.call(arr[0], 'name') ||
    Object.prototype.hasOwnProperty.call(arr[0], 'category_id') ||
    Object.prototype.hasOwnProperty.call(arr[0], 'sale_price') ||
    Object.prototype.hasOwnProperty.call(arr[0], 'buy_price')
  );

  if(looksFlat){
    return arr.map(p => {
      const supplier =
        (typeof p.supplier === 'string' ? p.supplier :
          (p.supplier?.name ?? p.supplier_name ?? ''));

      const catLabel =
        (typeof p.category === 'string' ? p.category : (p.category?.name ?? p.category_label ?? ''));

      const catId =
        p.category_id ?? p.categoryId ?? p.category?.id ?? null;

      return {
        stock: Number(p.stock ?? 0),
        critical: Boolean(p.critical ?? false),
        product: {
          id: p.id,
          sku: p.sku ?? '',
          name: p.name ?? '',
          description: p.description ?? '',
          categoryLabel: catLabel ?? '',
          categoryId: catId,
          supplier: supplier ?? '',
          minStock: Number(p.min_stock ?? p.minStock ?? 0),
          maxStock: (p.max_stock ?? p.maxStock ?? null),
          buyPrice: Number(p.buy_price ?? p.buyPrice ?? 0),
          salePrice: Number(p.sale_price ?? p.salePrice ?? 0),
          variants: Array.isArray(p.variants) ? p.variants : [],
        }
      };
    });
  }

  // fallback
  return [];
}

/* =========================
 * Imagen protegida (Sanctum)
 * ========================= */
async function loadProductImageUrl(productId){
  try{
    const blob = await api.getBlob(`/products/${productId}/image`);
    return URL.createObjectURL(blob);
  }catch(e){
    console.warn('No se pudo cargar imagen:', e?.message || e);
    return null;
  }
}

/* =========================
 * Main render
 * ========================= */
export async function renderInventory(outlet){
  const role = authService.getRole();
  const token = authService.getToken();
  const canEdit = (role === 'admin') && !!token; // ✅ SOLO admin logeado edita

  // vista actual
  let view = outlet.dataset.invView || 'inventory'; // inventory | categories
  outlet.dataset.invView = view;

  // data en memoria
  let categories = [];
  let inventoryRows = [];

  // modal
  let productModal = null;
  let currentPreviewObjectUrl = null;

  /* ---------- Render Shell ---------- */
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
    if(!box) return;

    if(view === 'inventory'){
      box.innerHTML = `
        <button class="btn btn-outline-brand" id="btnRefresh">Actualizar</button>
        <button class="btn btn-brand" id="btnNewProduct">Nuevo producto</button>
      `;
    }else{
      box.innerHTML = `
        <button class="btn btn-outline-brand" id="btnRefresh">Actualizar</button>
        <button class="btn btn-brand" id="btnNewCategory">Nueva categoría</button>
      `;
    }
  };

  /* ---------- Product Modal HTML ---------- */
  const renderProductModalHtml = () => {
    // ✅ select por CODE (value=code), pero mostramos Name + Code
    const options = (categories || []).map(c=>{
      const code = pickCategoryCode(c);
      const name = pickCategoryName(c) || `Categoría #${c.id}`;
      return `<option value="${safe(code)}">${safe(name)} (${safe(code)})</option>`;
    }).join('');

    return `
      <div class="modal fade" id="productModal" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog modal-lg modal-dialog-scrollable">
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

                  <div class="col-md-4">
                    <label class="form-label">Categoría</label>
                    <select class="form-select" id="category" required>
                      <option value="">-- Selecciona --</option>
                      ${options}
                    </select>
                    <div class="form-text">Value = CODE (MICAS, BISEL...).</div>
                  </div>

                  <div class="col-md-8">
                    <label class="form-label">Descripción</label>
                    <input class="form-control" id="description" placeholder="Descripción breve (opcional)">
                  </div>

                  <div class="col-md-8">
                    <label class="form-label">Imagen del producto</label>
                    <input type="file" class="form-control" id="imageFile" accept="image/*">
                    <div class="form-text">Se carga al backend y se lee con token.</div>
                  </div>

                  <div class="col-md-4 d-flex align-items-end">
                    <div class="border rounded w-100 overflow-hidden" style="height:84px; background:#F8F9FA;">
                      <img id="imagePreview" alt="preview" style="width:100%; height:84px; object-fit:cover; display:none;">
                      <div id="imageEmpty" class="small text-muted d-flex align-items-center justify-content-center h-100">
                        Sin imagen
                      </div>
                    </div>
                  </div>

                  <div class="col-md-4">
                    <label class="form-label">Precio compra</label>
                    <input type="number" class="form-control" id="buyPrice" min="0" step="0.01">
                  </div>

                  <div class="col-md-4">
                    <label class="form-label">Precio venta</label>
                    <input type="number" class="form-control" id="salePrice" min="0" step="0.01">
                  </div>

                  <div class="col-md-4">
                    <label class="form-label">Stock mín</label>
                    <input type="number" class="form-control" id="minStock" min="0">
                  </div>

                  <div class="col-md-4">
                    <label class="form-label">Stock máx</label>
                    <input type="number" class="form-control" id="maxStock" min="0">
                  </div>

                  <div class="col-md-4">
                    <label class="form-label">Proveedor</label>
                    <input class="form-control" id="supplier">
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

  /* ---------- Tables Render ---------- */
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
                <th>Stock</th>
                <th>Mín</th>
                <th>Máx</th>
                <th>Venta</th>
                <th>Proveedor</th>
                ${canEdit ? '<th>Acciones</th>' : ''}
              </tr>
            </thead>
            <tbody>
              ${inventoryRows.map(r=>{
                const p = r.product || {};
                const stock = Number(r.stock ?? 0);
                const min = Number(p.minStock ?? 0);
                const low = stock <= min;

                return `
                  <tr class="${low ? 'table-warning' : ''}">
                    <td>${safe(p.sku)}</td>
                    <td>
                      ${safe(p.name)}
                      ${low ? '<span class="badge text-bg-danger ms-2">Crítico</span>' : ''}
                    </td>
                    <td>${safe(p.categoryLabel || '')}</td>
                    <td class="fw-semibold">${stock}</td>
                    <td>${min}</td>
                    <td>${p.maxStock ?? ''}</td>
                    <td>${money(p.salePrice ?? 0)}</td>
                    <td>${safe(p.supplier ?? '')}</td>
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
          ${canEdit ? 'Admin: CRUD + stock + imagen protegida.' : 'Solo admin logeado puede editar.'}
        </div>
      </div>

      ${canEdit ? renderProductModalHtml() : ''}
    `;

    mountDataTable('#tblInventory');

    if(canEdit){
      productModal = new bootstrap.Modal(document.getElementById('productModal'));
      wireProductModalHandlers();
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
              ${(categories || []).map(c=>{
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

  /* ---------- Product Modal Logic ---------- */
  const renderImagePreview = (src)=>{
    const img = document.getElementById('imagePreview');
    const empty = document.getElementById('imageEmpty');
    if(!img || !empty) return;

    if(!src){
      img.style.display = 'none';
      empty.style.display = 'flex';
      img.removeAttribute('src');
      return;
    }
    img.src = src;
    img.style.display = 'block';
    empty.style.display = 'none';
  };

  const openProductModal = async (productOrNull) => {
    // limpiar objectURL previo
    if(currentPreviewObjectUrl){
      URL.revokeObjectURL(currentPreviewObjectUrl);
      currentPreviewObjectUrl = null;
    }

    const p = productOrNull || null;

    document.getElementById('modalTitle').textContent = p ? 'Editar producto' : 'Nuevo producto';
    document.getElementById('productId').value = p?.id ?? '';
    document.getElementById('sku').value = p?.sku ?? '';
    document.getElementById('name').value = p?.name ?? '';
    document.getElementById('description').value = p?.description ?? '';
    document.getElementById('buyPrice').value = p?.buyPrice ?? '';
    document.getElementById('salePrice').value = p?.salePrice ?? '';
    document.getElementById('minStock').value = p?.minStock ?? '';
    document.getElementById('maxStock').value = (p?.maxStock ?? '');
    document.getElementById('supplier').value = p?.supplier ?? '';

    // ✅ set category select por CODE (si lo conocemos)
    // Si tu inventory.list no trae code, intentamos resolver por categoryId->categories[].code
    const sel = document.getElementById('category');
    let codeToSet = '';

    if(p?.categoryId){
      const cat = (categories || []).find(c => String(c.id) === String(p.categoryId));
      codeToSet = pickCategoryCode(cat);
    }

    // fallback por label (si tu label coincide con name)
    if(!codeToSet && p?.categoryLabel){
      const cat2 = (categories || []).find(c => String(pickCategoryName(c)).trim() === String(p.categoryLabel).trim());
      codeToSet = pickCategoryCode(cat2);
    }

    sel.value = codeToSet || '';

    // reset file
    const fileInput = document.getElementById('imageFile');
    if(fileInput) fileInput.value = '';

    renderImagePreview(null);

    // cargar imagen desde backend (token)
    if(p?.id){
      const url = await loadProductImageUrl(p.id);
      if(url){
        currentPreviewObjectUrl = url;
        renderImagePreview(url);
      }
    }

    productModal.show();
  };

  const wireProductModalHandlers = () => {
    const fileInput = document.getElementById('imageFile');
    const btnSave = document.getElementById('btnSaveProduct');

    // preview local de imagen
    fileInput?.addEventListener('change', async (e)=>{
      const file = e.target.files?.[0];
      if(!file) return;

      if(!file.type.startsWith('image/')){
        Swal.fire('Archivo inválido','Solo se permiten imágenes.','warning');
        e.target.value = '';
        return;
      }
      if(file.size > 2 * 1024 * 1024){
        Swal.fire('Imagen muy grande','Máximo 2MB.','warning');
        e.target.value = '';
        return;
      }

      // si había objectURL de backend, liberar
      if(currentPreviewObjectUrl){
        URL.revokeObjectURL(currentPreviewObjectUrl);
        currentPreviewObjectUrl = null;
      }

      const reader = new FileReader();
      reader.onload = ()=> renderImagePreview(reader.result);
      reader.readAsDataURL(file);
    });

    // guardar producto
    btnSave?.addEventListener('click', async ()=>{
      const id = document.getElementById('productId').value || '';
      const sku = document.getElementById('sku').value.trim();
      const name = document.getElementById('name').value.trim();
      const categoryCode = (document.getElementById('category').value || '').trim();
      const description = document.getElementById('description').value.trim();

      if(!sku || !name || !categoryCode){
        Swal.fire('Faltan datos','SKU, Nombre y Categoría son obligatorios.','info');
        return;
      }

      // ✅ Resolver category_id por code
      const catObj = (categories || []).find(c => String(pickCategoryCode(c)) === String(categoryCode));
      const categoryId = catObj?.id ?? '';

      if(!categoryId){
        Swal.fire('Categoría inválida', `No existe la categoría con code: ${categoryCode}`, 'warning');
        return;
      }

      const file = document.getElementById('imageFile')?.files?.[0] || null;

      // ✅ Para tu ProductsController (camelCase) + compat con validaciones required_without
      const fd = new FormData();
      fd.append('sku', sku);
      fd.append('name', name);

      // manda TODAS para que nunca falle el "required when ..."
      fd.append('category', categoryCode);
      fd.append('category_id', String(categoryId));
      fd.append('categoryId', String(categoryId));

      fd.append('description', description || '');

      fd.append('buyPrice', String(Number(document.getElementById('buyPrice').value || 0)));
      fd.append('salePrice', String(Number(document.getElementById('salePrice').value || 0)));
      fd.append('minStock', String(Number(document.getElementById('minStock').value || 0)));
      fd.append('maxStock', String(Number(document.getElementById('maxStock').value || 0)));
      fd.append('supplier', (document.getElementById('supplier').value || '').trim());

      if(file) fd.append('image', file);

      try{
        if(id) await inventoryService.updateProduct(id, fd);
        else await inventoryService.createProduct(fd);

        productModal.hide();
        Swal.fire('Guardado','Producto guardado.','success');
        await refresh('inventory');
      }catch(err){
        console.error(err);
        Swal.fire('Error', extractAxiosErrorMessage(err), 'error');
      }
    });
  };

  /* ---------- Category CRUD (Swal) ---------- */
  const openCreateCategory = async () => {
    if(!canEdit) return;

    const r = await Swal.fire({
      title: 'Nueva categoría',
      html: `
        <div class="text-start">
          <label class="form-label">Nombre</label>
          <input id="swCatName" class="form-control" placeholder="Ej: Micas, Bisel, Lentes de contacto...">
          <div class="form-text">El CODE se genera automático (puedes editarlo después).</div>

          <label class="form-label mt-2">Descripción (opcional)</label>
          <input id="swCatDesc" class="form-control" placeholder="Opcional">
        </div>
      `,
      focusConfirm: false,
      showCancelButton: true,
      confirmButtonText: 'Guardar',
      preConfirm: ()=>{
        const name = document.getElementById('swCatName')?.value?.trim() || '';
        const description = document.getElementById('swCatDesc')?.value?.trim() || '';
        if(!name){
          Swal.showValidationMessage('El nombre es obligatorio');
          return false;
        }
        return { name, description };
      }
    });

    if(!r.isConfirmed) return;

    try{
      const code = buildCodeFromName(r.value.name);
      await inventoryService.createCategory({
        code,
        name: r.value.name,
        description: r.value.description || null
      });
      Swal.fire('Listo','Categoría creada.','success');
      await refresh('categories');
    }catch(e){
      console.error(e);
      Swal.fire('Error', extractAxiosErrorMessage(e), 'error');
    }
  };

  const openEditCategory = async (catId) => {
    if(!canEdit) return;

    const cat = (categories || []).find(x => String(x.id) === String(catId));
    const currentName = pickCategoryName(cat);
    const currentCode = pickCategoryCode(cat);
    const currentDesc = cat?.description ?? '';

    const r = await Swal.fire({
      title: 'Editar categoría',
      html: `
        <div class="text-start">
          <label class="form-label">CODE</label>
          <input id="swCatCode" class="form-control" value="${safe(currentCode)}" placeholder="Ej: MICAS">

          <label class="form-label mt-2">Nombre</label>
          <input id="swCatName" class="form-control" value="${safe(currentName)}" placeholder="Ej: Micas">

          <label class="form-label mt-2">Descripción (opcional)</label>
          <input id="swCatDesc" class="form-control" value="${safe(currentDesc)}" placeholder="Opcional">
        </div>
      `,
      focusConfirm: false,
      showCancelButton: true,
      confirmButtonText: 'Guardar',
      preConfirm: ()=>{
        const code = document.getElementById('swCatCode')?.value?.trim() || '';
        const name = document.getElementById('swCatName')?.value?.trim() || '';
        const description = document.getElementById('swCatDesc')?.value?.trim() || '';
        if(!code || !name){
          Swal.showValidationMessage('CODE y Nombre son obligatorios');
          return false;
        }
        return { code, name, description };
      }
    });

    if(!r.isConfirmed) return;

    try{
      await inventoryService.updateCategory(catId, {
        code: r.value.code,
        name: r.value.name,
        description: r.value.description || null
      });
      Swal.fire('Listo','Categoría actualizada.','success');
      await refresh('categories');
    }catch(e){
      console.error(e);
      Swal.fire('Error', extractAxiosErrorMessage(e), 'error');
    }
  };

  const deleteCategory = async (catId) => {
    if(!canEdit) return;

    const r = await Swal.fire({
      title: '¿Borrar categoría?',
      text: 'Si hay productos usando esta categoría, el backend puede rechazarlo.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, borrar'
    });

    if(!r.isConfirmed) return;

    try{
      await inventoryService.deleteCategory(catId);
      Swal.fire('Listo','Categoría eliminada.','success');
      await refresh('categories');
    }catch(e){
      console.error(e);
      Swal.fire('Error', extractAxiosErrorMessage(e), 'error');
    }
  };

  /* ---------- Inventory actions ---------- */
  const addStock = async (productId) => {
    if(!canEdit) return;

    const r = await Swal.fire({
      title: 'Aumentar stock',
      input: 'number',
      inputLabel: 'Cantidad a agregar',
      inputAttributes: { min: 1, step: 1 },
      inputValue: 1,
      showCancelButton: true,
      confirmButtonText: 'Agregar',
      inputValidator: (v)=>{
        const n = Number(v);
        if(!Number.isInteger(n) || n <= 0) return 'Debe ser un entero mayor a 0';
        return null;
      }
    });

    if(!r.isConfirmed) return;

    try{
      await inventoryService.addStock(productId, { qty: Number(r.value), note: 'Entrada desde inventario' });
      Swal.fire('Listo','Stock actualizado.','success');
      await refresh('inventory');
    }catch(e){
      console.error(e);
      Swal.fire('Error', extractAxiosErrorMessage(e), 'error');
    }
  };

  const deleteProduct = async (productId) => {
    if(!canEdit) return;

    const r = await Swal.fire({
      title: '¿Eliminar producto?',
      text: 'Esta acción se confirmará.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, borrar'
    });
    if(!r.isConfirmed) return;

    try{
      await inventoryService.deleteProduct(productId);
      Swal.fire('Listo','Producto eliminado.','success');
      await refresh('inventory');
    }catch(e){
      console.error(e);
      Swal.fire('Error', extractAxiosErrorMessage(e), 'error');
    }
  };

  /* ---------- Load / Draw / Refresh ---------- */
  const loadData = async () => {
    // categorías siempre
    try{
      const cats = await inventoryService.listCategories();
      categories = Array.isArray(cats) ? cats : [];
    }catch(e){
      console.warn('No se pudieron cargar categorías:', e);
      categories = [];
    }

    // inventario solo si toca
    if(view === 'inventory'){
      const raw = await inventoryService.list();
      inventoryRows = normalizeInventoryRows(raw);

      // mejora: si no viene label pero sí categoryId, resolver name por categories
      const map = new Map((categories || []).map(c => [String(c.id), pickCategoryName(c)]));
      inventoryRows = inventoryRows.map(r=>{
        const p = r.product || {};
        if(!p.categoryLabel && p.categoryId && map.has(String(p.categoryId))){
          p.categoryLabel = map.get(String(p.categoryId));
        }
        return r;
      });
    }
  };

  const draw = async () => {
    renderShell();
    if(canEdit) renderTopActions();

    // tabs
    outlet.querySelector('#tabInventory')?.addEventListener('click', async ()=>{
      await refresh('inventory');
    });

    outlet.querySelector('#tabCategories')?.addEventListener('click', async ()=>{
      await refresh('categories');
    });

    // top actions
    outlet.querySelector('#btnRefresh')?.addEventListener('click', async ()=>{
      await refresh(view);
    });

    outlet.querySelector('#btnNewProduct')?.addEventListener('click', async ()=>{
      if(!categories.length){
        Swal.fire('Sin categorías','Primero crea una categoría en “Categorías”.','info');
        return;
      }
      await openProductModal(null);
    });

    outlet.querySelector('#btnNewCategory')?.addEventListener('click', async ()=>{
      await openCreateCategory();
    });

    // render view
    if(view === 'inventory') renderInventoryTable();
    else renderCategoriesTable();

    // delegación de clicks
    outlet.addEventListener('click', onOutletClick);
  };

  const cleanup = () => {
    // quitar delegación para no duplicar
    outlet.removeEventListener('click', onOutletClick);

    // liberar objectURL
    if(currentPreviewObjectUrl){
      URL.revokeObjectURL(currentPreviewObjectUrl);
      currentPreviewObjectUrl = null;
    }
  };

  const refresh = async (nextView) => {
    cleanup();
    view = nextView;
    outlet.dataset.invView = view;
    await loadData();
    await draw();
  };

  /* ---------- Delegación: botones tabla ---------- */
  async function onOutletClick(e){
    const t = e.target;

    // INVENTARIO
    if(view === 'inventory'){
      const addStockId = t?.dataset?.addstock;
      const editId = t?.dataset?.edit;
      const delId = t?.dataset?.del;

      if(addStockId){ await addStock(addStockId); return; }
      if(editId){
        const p = inventoryRows.map(r=>r.product).find(x=>String(x?.id)===String(editId));
        if(!p){
          Swal.fire('No encontrado','No se encontró el producto en la lista.','info');
          return;
        }
        await openProductModal(p);
        return;
      }
      if(delId){ await deleteProduct(delId); return; }
    }

    // CATEGORÍAS
    if(view === 'categories'){
      const catEditId = t?.dataset?.catEdit;
      const catDelId = t?.dataset?.catDel;

      if(catEditId){ await openEditCategory(catEditId); return; }
      if(catDelId){ await deleteCategory(catDelId); return; }
    }
  }

  /* ---------- Init ---------- */
  await loadData();
  await draw();
}

