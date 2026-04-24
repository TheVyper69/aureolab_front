import { authService } from '../services/authService.js';

export function renderLayout(){
  const role = authService.getRole();
  const user = authService.getUser() || { name: 'Usuario' };

  // ✅ POS solo para óptica
  const links = [
    { hash: '#/sales',     label: 'Ventas / Reportes', roles: ['admin'] },
    { hash: '#/pos',       label: 'Catálogo',          roles: ['optica'] },
    { hash: '#/inventory', label: 'Inventario',        roles: ['admin','employee'] },
    { hash: '#/orders',    label: 'Pedidos',           roles: ['optica','employee','admin'] },
    { hash: '#/users',     label: 'Usuarios',          roles: ['admin'] },
    { hash: '#/otros',   label: 'Otros',           roles: ['admin'] },
  ].filter(l => l.roles.includes(role));

  // ✅ default por rol
  const defaultHash =
    role === 'optica' ? '#/pos'
    : role === 'admin' ? '#/sales'
    : role === 'employee' ? '#/inventory'
    : '#/login';
    
  const current = location.hash || defaultHash;

  return `
  <div class="container-fluid">
    <!-- HEADER MOBILE -->
    <div class="d-lg-none d-flex align-items-center justify-content-between p-2 border-bottom bg-white">
      <button class="btn btn-outline-secondary" id="btnToggleSidebar">
        <i class="bi bi-list"></i>
      </button>

      <img
        src="assets/images/logo.png"
        alt="Logo"
        class="header-logo"
      />

      <div></div>
    </div>

    <div class="row">
      <!-- SIDEBAR -->
      <aside class="sidebar col-12 col-lg-2 p-2" id="sidebar">
        <div class="p-3 text-center">
          <img
            src="assets/images/logo.png"
            alt="Logo"
            class="sidebar-logo mb-2"
          />
          <div>
            <span class="badge badge-role">${role}</span>
            <div class="small text-muted mt-1">${user.name}</div>
          </div>
        </div>

        <nav>
          ${links.map(l => `
            <a class="${l.hash===current?'active':''}" href="${l.hash}">
              ${l.label}
            </a>
          `).join('')}
          <a href="#" id="btnLogout" class="text-danger">Cerrar sesión</a>
        </nav>
      </aside>

      <!-- OVERLAY MOBILE -->
      <div class="sidebar-overlay d-lg-none" id="sidebarOverlay"></div>

      <!-- CONTENT -->
      <main class="col-12 col-lg-10 p-3">
        <div id="outlet"></div>
      </main>
    </div>
  </div>
  `;
}

/* ================= INTERACCIONES ================= */
document.addEventListener('click', (e)=>{
  if(e.target?.closest('#btnLogout')){
    e.preventDefault();
    Swal.fire({
      title: '¿Cerrar sesión?',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Sí, salir'
    }).then(r=>{
      if(r.isConfirmed){
        authService.logout();
        location.hash = '#/login';
      }
    });
    return;
  }

  if(e.target?.closest('#btnToggleSidebar')){
    document.getElementById('sidebar')?.classList.toggle('open');
    document.getElementById('sidebarOverlay')?.classList.toggle('show');
    return;
  }

  if(e.target?.id === 'sidebarOverlay'){
    document.getElementById('sidebar')?.classList.remove('open');
    document.getElementById('sidebarOverlay')?.classList.remove('show');
    return;
  }

  const navLink = e.target?.closest('aside#sidebar nav a[href^="#/"]');
  if(navLink){
    document.getElementById('sidebar')?.classList.remove('open');
    document.getElementById('sidebarOverlay')?.classList.remove('show');
  }
});
