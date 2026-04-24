import { authService } from '../services/authService.js';
import { catalogosService } from '../services/otrosService.js';

function safe(v) {
  return String(v ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function slugify(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function badgeActive(active) {
  return active
    ? '<span class="badge text-bg-success">Activo</span>'
    : '<span class="badge text-bg-danger">Inactivo</span>';
}

function destroyDataTable(selector) {
  if (!(window.$ && $.fn.dataTable)) return;
  if ($.fn.DataTable.isDataTable(selector)) {
    $(selector).DataTable().destroy();
  }
}

function initDataTable(selector) {
  if (!(window.$ && $.fn.dataTable)) return;

  destroyDataTable(selector);

  $(selector).DataTable({
    responsive: true,
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

function normalizeBool(v) {
  return v === true || v === 1 || v === '1' || v === 'true';
}

function mapLensType(row) {
  return {
    id: row?.id,
    name: row?.name ?? row?.nombre ?? '',
    code: row?.code ?? row?.codigo ?? '',
    active: normalizeBool(row?.active ?? row?.activo ?? true),
  };
}

function mapMaterial(row) {
  return {
    id: row?.id,
    name: row?.name ?? row?.nombre ?? '',
    code: row?.code ?? row?.codigo ?? '',
    description: row?.description ?? row?.descripcion ?? '',
    active: normalizeBool(row?.active ?? row?.activo ?? true),
  };
}

function mapSupplier(row) {
  return {
    id: row?.id,
    name: row?.name ?? row?.nombre ?? '',
    code: row?.code ?? row?.codigo ?? '',
    phone: row?.phone ?? row?.telefono ?? '',
    email: row?.email ?? '',
    active: normalizeBool(row?.active ?? row?.activo ?? true),
  };
}

function mapBox(row) {
  return {
    id: row?.id,
    name: row?.name ?? row?.nombre ?? '',
    code: row?.code ?? row?.codigo ?? '',
    active: normalizeBool(row?.active ?? row?.activo ?? true),
  };
}

export async function renderOtros(outlet) {
  const role = authService.getRole();

  if (!['admin', 'employee'].includes(role)) {
    outlet.innerHTML = `
      <div class="alert alert-warning mb-0">
        No tienes permiso para ver este apartado.
      </div>
    `;
    return;
  }

  const TAB_META = {
    lens_types: {
      label: 'Tipos de lente',
      button: 'Nuevo tipo de lente'
    },
    materials: {
      label: 'Materiales',
      button: 'Nuevo material'
    },
    suppliers: {
      label: 'Proveedores',
      button: 'Nuevo proveedor'
    },
    boxes: {
      label: 'Boxes',
      button: 'Nuevo box'
    }
  };

  const state = {
    activeTab: 'lens_types',
    loading: false,
    lens_types: [],
    materials: [],
    suppliers: [],
    boxes: []
  };

  let delegatedEventsBound = false;

  const getCurrentRows = () => state[state.activeTab] || [];
  const getTableId = () => `tbl_${state.activeTab}`;
  const getCurrentTitle = () => TAB_META[state.activeTab]?.label || '';

  const serviceMap = {
    lens_types: {
      list: () => catalogosService.listLensTypes(),
      create: (payload) => catalogosService.createLensType(payload),
      update: (id, payload) => catalogosService.updateLensType(id, payload),
      remove: (id) => catalogosService.deleteLensType(id),
    },
    materials: {
      list: () => catalogosService.listMaterials(),
      create: (payload) => catalogosService.createMaterial(payload),
      update: (id, payload) => catalogosService.updateMaterial(id, payload),
      remove: (id) => catalogosService.deleteMaterial(id),
    },
    suppliers: {
      list: () => catalogosService.listSuppliers(),
      create: (payload) => catalogosService.createSupplier(payload),
      update: (id, payload) => catalogosService.updateSupplier(id, payload),
      remove: (id) => catalogosService.deleteSupplier(id),
    },
    boxes: {
      list: () => catalogosService.listBoxes(),
      create: (payload) => catalogosService.createBox(payload),
      update: (id, payload) => catalogosService.updateBox(id, payload),
      remove: (id) => catalogosService.deleteBox(id),
    }
  };

  async function loadTabData(tab) {
    const service = serviceMap[tab];
    if (!service?.list) return [];

    const resp = await service.list();
    const rows = Array.isArray(resp?.data) ? resp.data : (Array.isArray(resp) ? resp : []);

    switch (tab) {
      case 'lens_types':
        state[tab] = rows.map(mapLensType);
        break;
      case 'materials':
        state[tab] = rows.map(mapMaterial);
        break;
      case 'suppliers':
        state[tab] = rows.map(mapSupplier);
        break;
      case 'boxes':
        state[tab] = rows.map(mapBox);
        break;
      default:
        state[tab] = [];
    }

    return state[tab];
  }

  async function loadAllCatalogs() {
    state.loading = true;
    try {
      await Promise.all([
        loadTabData('lens_types'),
        loadTabData('materials'),
        loadTabData('suppliers'),
        loadTabData('boxes')
      ]);
    } finally {
      state.loading = false;
    }
  }

  function renderTabs() {
    return `
      <ul class="nav nav-tabs mb-3" id="catalogTabs">
        ${Object.entries(TAB_META).map(([key, meta]) => `
          <li class="nav-item">
            <button
              type="button"
              class="nav-link ${state.activeTab === key ? 'active' : ''}"
              data-tab="${key}">
              ${safe(meta.label)}
            </button>
          </li>
        `).join('')}
      </ul>
    `;
  }

  function renderLensTypesTable() {
    const rows = state.lens_types;
    return `
      <div class="table-responsive">
        <table id="${getTableId()}" class="table table-striped align-middle" style="width:100%">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Código</th>
              <th>Estatus</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(row => `
              <tr>
                <td>${safe(row.name)}</td>
                <td>${safe(row.code)}</td>
                <td>${badgeActive(row.active)}</td>
                <td>
                  <button class="btn btn-sm btn-outline-brand" data-edit="${row.id}">Editar</button>
                  <button class="btn btn-sm btn-outline-danger" data-del="${row.id}">Borrar</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderMaterialsTable() {
    const rows = state.materials;
    return `
      <div class="table-responsive">
        <table id="${getTableId()}" class="table table-striped align-middle" style="width:100%">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Código</th>
              <th>Descripción</th>
              <th>Estatus</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(row => `
              <tr>
                <td>${safe(row.name)}</td>
                <td>${safe(row.code)}</td>
                <td>${safe(row.description || '')}</td>
                <td>${badgeActive(row.active)}</td>
                <td>
                  <button class="btn btn-sm btn-outline-brand" data-edit="${row.id}">Editar</button>
                  <button class="btn btn-sm btn-outline-danger" data-del="${row.id}">Borrar</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderSuppliersTable() {
    const rows = state.suppliers;
    return `
      <div class="table-responsive">
        <table id="${getTableId()}" class="table table-striped align-middle" style="width:100%">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Código</th>
              <th>Teléfono</th>
              <th>Email</th>
              <th>Estatus</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(row => `
              <tr>
                <td>${safe(row.name)}</td>
                <td>${safe(row.code)}</td>
                <td>${safe(row.phone || '')}</td>
                <td>${safe(row.email || '')}</td>
                <td>${badgeActive(row.active)}</td>
                <td>
                  <button class="btn btn-sm btn-outline-brand" data-edit="${row.id}">Editar</button>
                  <button class="btn btn-sm btn-outline-danger" data-del="${row.id}">Borrar</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderBoxesTable() {
    const rows = state.boxes;
    return `
      <div class="table-responsive">
        <table id="${getTableId()}" class="table table-striped align-middle" style="width:100%">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Código</th>
              <th>Estatus</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(row => `
              <tr>
                <td>${safe(row.name)}</td>
                <td>${safe(row.code)}</td>
                <td>${badgeActive(row.active)}</td>
                <td>
                  <button class="btn btn-sm btn-outline-brand" data-edit="${row.id}">Editar</button>
                  <button class="btn btn-sm btn-outline-danger" data-del="${row.id}">Borrar</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderCurrentTable() {
    switch (state.activeTab) {
      case 'lens_types':
        return renderLensTypesTable();
      case 'materials':
        return renderMaterialsTable();
      case 'suppliers':
        return renderSuppliersTable();
      case 'boxes':
        return renderBoxesTable();
      default:
        return '';
    }
  }

  function renderModalBody() {
    if (state.activeTab === 'lens_types') {
      return `
        <form id="catalogForm">
          <div class="row g-3">
            <div class="col-md-8">
              <label class="form-label">Nombre</label>
              <input class="form-control" id="fName" required>
            </div>
            <div class="col-md-4">
              <label class="form-label">Código</label>
              <input class="form-control text-uppercase" id="fCode" required>
            </div>
            <div class="col-md-4">
              <label class="form-label">Estatus</label>
              <select class="form-select" id="fActive">
                <option value="true">Activo</option>
                <option value="false">Inactivo</option>
              </select>
            </div>
          </div>
          <input type="hidden" id="fId">
        </form>
      `;
    }

    if (state.activeTab === 'materials') {
      return `
        <form id="catalogForm">
          <div class="row g-3">
            <div class="col-md-8">
              <label class="form-label">Nombre</label>
              <input class="form-control" id="fName" required>
            </div>
            <div class="col-md-4">
              <label class="form-label">Código</label>
              <input class="form-control text-uppercase" id="fCode" required>
            </div>
            <div class="col-12">
              <label class="form-label">Descripción</label>
              <textarea class="form-control" id="fDescription" rows="3"></textarea>
            </div>
            <div class="col-md-4">
              <label class="form-label">Estatus</label>
              <select class="form-select" id="fActive">
                <option value="true">Activo</option>
                <option value="false">Inactivo</option>
              </select>
            </div>
          </div>
          <input type="hidden" id="fId">
        </form>
      `;
    }

    if (state.activeTab === 'suppliers') {
      return `
        <form id="catalogForm">
          <div class="row g-3">
            <div class="col-md-8">
              <label class="form-label">Nombre</label>
              <input class="form-control" id="fName" required>
            </div>
            <div class="col-md-4">
              <label class="form-label">Código</label>
              <input class="form-control text-uppercase" id="fCode" required>
            </div>
            <div class="col-md-6">
              <label class="form-label">Teléfono</label>
              <input class="form-control" id="fPhone">
            </div>
            <div class="col-md-6">
              <label class="form-label">Email</label>
              <input type="email" class="form-control" id="fEmail">
            </div>
            <div class="col-md-4">
              <label class="form-label">Estatus</label>
              <select class="form-select" id="fActive">
                <option value="true">Activo</option>
                <option value="false">Inactivo</option>
              </select>
            </div>
          </div>
          <input type="hidden" id="fId">
        </form>
      `;
    }

    return `
      <form id="catalogForm">
        <div class="row g-3">
          <div class="col-md-8">
            <label class="form-label">Nombre</label>
            <input class="form-control" id="fName" required>
          </div>
          <div class="col-md-4">
            <label class="form-label">Código</label>
            <input class="form-control text-uppercase" id="fCode" required>
          </div>
          <div class="col-md-4">
            <label class="form-label">Estatus</label>
            <select class="form-select" id="fActive">
              <option value="true">Activo</option>
              <option value="false">Inactivo</option>
            </select>
          </div>
        </div>
        <input type="hidden" id="fId">
      </form>
    `;
  }

  function renderLoading() {
    outlet.innerHTML = `
      <div class="card p-4">
        <div class="text-center">
          <div class="spinner-border" role="status"></div>
          <div class="mt-2">Cargando catálogos...</div>
        </div>
      </div>
    `;
  }

  function renderView() {
    destroyDataTable('#tbl_lens_types');
    destroyDataTable('#tbl_materials');
    destroyDataTable('#tbl_suppliers');
    destroyDataTable('#tbl_boxes');

    outlet.innerHTML = `
      <div class="d-flex align-items-center justify-content-between mb-3">
        <h4 class="mb-0">Catálogos</h4>
        <button class="btn btn-brand" id="btnNewRow">${safe(TAB_META[state.activeTab].button)}</button>
      </div>

      ${renderTabs()}

      <div class="card p-3">
        <div class="d-flex align-items-center justify-content-between mb-3">
          <h6 class="mb-0">${safe(getCurrentTitle())}</h6>
        </div>

        ${renderCurrentTable()}
      </div>

      <div class="modal fade" id="catalogModal" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog modal-lg modal-dialog-scrollable">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title" id="catalogModalTitle">Nuevo registro</h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Cerrar"></button>
            </div>
            <div class="modal-body">
              ${renderModalBody()}
            </div>
            <div class="modal-footer">
              <button class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancelar</button>
              <button class="btn btn-brand" id="btnSaveCatalog">Guardar</button>
            </div>
          </div>
        </div>
      </div>
    `;

    initDataTable(`#${getTableId()}`);
    bindStaticEvents();
  }

  function getRowById(id) {
    return getCurrentRows().find(x => String(x.id) === String(id)) || null;
  }

  function openModal(row = null) {
    const modalEl = document.getElementById('catalogModal');
    const modal = new bootstrap.Modal(modalEl);
    const titleEl = document.getElementById('catalogModalTitle');

    titleEl.textContent = row
      ? `Editar ${getCurrentTitle().toLowerCase()}`
      : `Nuevo ${getCurrentTitle().toLowerCase()}`;

    document.getElementById('fId').value = row?.id ?? '';
    document.getElementById('fName').value = row?.name ?? '';
    document.getElementById('fCode').value = row?.code ?? '';
    document.getElementById('fActive').value = String(row?.active ?? true);

    const fDescription = document.getElementById('fDescription');
    if (fDescription) fDescription.value = row?.description ?? '';

    const fPhone = document.getElementById('fPhone');
    if (fPhone) fPhone.value = row?.phone ?? '';

    const fEmail = document.getElementById('fEmail');
    if (fEmail) fEmail.value = row?.email ?? '';

    modal.show();
  }

  function buildPayloadFromForm() {
    const id = document.getElementById('fId')?.value || '';
    const name = (document.getElementById('fName')?.value || '').trim();
    const codeRaw = (document.getElementById('fCode')?.value || '').trim();
    const active = document.getElementById('fActive')?.value === 'true';

    if (!name) {
      throw new Error('El nombre es obligatorio.');
    }

    let code = codeRaw.toUpperCase();
    if (!code) {
      code = slugify(name).toUpperCase();
    }

    const rows = getCurrentRows();
    const duplicateCode = rows.find(x =>
      String(x.code || '').toUpperCase() === String(code).toUpperCase() &&
      String(x.id) !== String(id)
    );

    if (duplicateCode) {
      throw new Error('Ya existe un registro con ese código.');
    }

    let payload = { name, code, active };

    if (state.activeTab === 'materials') {
      payload = {
        ...payload,
        description: (document.getElementById('fDescription')?.value || '').trim()
      };
    }

    if (state.activeTab === 'suppliers') {
      payload = {
        ...payload,
        phone: (document.getElementById('fPhone')?.value || '').trim(),
        email: (document.getElementById('fEmail')?.value || '').trim()
      };
    }

    return { id, payload };
  }

  async function saveCurrentForm() {
    try {
      const { id, payload } = buildPayloadFromForm();
      const service = serviceMap[state.activeTab];

      if (!service) {
        throw new Error('No existe configuración de servicio para esta pestaña.');
      }

      if (id) {
        await service.update(id, payload);
      } else {
        await service.create(payload);
      }

      bootstrap.Modal.getInstance(document.getElementById('catalogModal'))?.hide();

      await loadTabData(state.activeTab);
      renderView();

      await Swal.fire('Guardado', 'Registro guardado correctamente.', 'success');
    } catch (err) {
      Swal.fire(
        'Error',
        err?.response?.data?.message || err?.message || 'No se pudo guardar el registro.',
        'error'
      );
    }
  }

  async function removeCurrentRow(id) {
    try {
      const confirm = await Swal.fire({
        title: '¿Eliminar registro?',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Sí, borrar'
      });

      if (!confirm.isConfirmed) return;

      const service = serviceMap[state.activeTab];
      await service.remove(id);

      await loadTabData(state.activeTab);
      renderView();

      await Swal.fire('Listo', 'Registro eliminado.', 'success');
    } catch (err) {
      Swal.fire(
        'Error',
        err?.response?.data?.message || err?.message || 'No se pudo eliminar el registro.',
        'error'
      );
    }
  }

  function bindStaticEvents() {
    outlet.querySelector('#btnNewRow')?.addEventListener('click', () => openModal(null));
    document.getElementById('btnSaveCatalog')?.addEventListener('click', saveCurrentForm);
  }

  function bindDelegatedEventsOnce() {
    if (delegatedEventsBound) return;

    outlet.addEventListener('click', async (e) => {
      const tabBtn = e.target?.closest('[data-tab]');
      if (tabBtn) {
        const nextTab = tabBtn.dataset.tab;
        if (!TAB_META[nextTab] || nextTab === state.activeTab) return;

        state.activeTab = nextTab;
        renderView();
        return;
      }

      const editBtn = e.target?.closest('[data-edit]');
      if (editBtn) {
        const row = getRowById(editBtn.dataset.edit);
        if (row) openModal(row);
        return;
      }

      const delBtn = e.target?.closest('[data-del]');
      if (delBtn) {
        await removeCurrentRow(delBtn.dataset.del);
      }
    });

    delegatedEventsBound = true;
  }

  try {
    renderLoading();
    bindDelegatedEventsOnce();
    await loadAllCatalogs();
    renderView();
  } catch (err) {
    outlet.innerHTML = `
      <div class="alert alert-danger mb-0">
        No se pudieron cargar los catálogos.
      </div>
    `;
    console.error('[renderOtros] error:', err);
  }
}