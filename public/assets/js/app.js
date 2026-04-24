import { renderLogin } from './auth/login.js';
import { renderRegister } from './auth/register.js';

import { renderLayout } from './modules/layout.js';
import { renderPOS } from './modules/pos.js';
import { renderInventory } from './modules/inventory.js';
import { renderSales } from './modules/sales.js';
import { renderUsers } from './modules/users.js';
import { renderOtros } from './modules/otros.js';
import { renderOrders } from './modules/orders.js';

import { authService } from './services/authService.js';
import { showOverlay, hideOverlay } from './utils/spinners.js';

const routes = {
  '#/login': async (root) => renderLogin(root),
  '#/register': async (root) => renderRegister(root),

  '#/pos': renderPOS, // ✅ solo óptica (controlado en requireRole)
  '#/inventory': renderInventory,
  '#/sales': renderSales,
  '#/users': renderUsers,
  '#/otros': renderOtros,
  '#/orders': renderOrders
};

function requireAuth(hash) {
  const publicRoutes = ['#/login', '#/register'];
  if (publicRoutes.includes(hash)) return true;

  if (!authService.getToken()) {
    location.hash = '#/login';
    return false;
  }
  return true;
}

function defaultRouteByRole(role){
  if (role === 'admin') return '#/sales';
  if (role === 'employee') return '#/inventory';
  if (role === 'optica') return '#/pos';
  return '#/login';
}

function requireRole(hash) {
  const role = authService.getRole();

  // Admin-only
  const adminOnly = ['#/users', '#/otros', '#/sales'];

  // ✅ Óptica allowed (POS + pedidos)
  const opticaAllowed = ['#/pos', '#/orders'];

  // ✅ Employee allowed (SIN POS)
  const employeeAllowed = ['#/inventory', '#/orders'];

  // --- ADMIN-ONLY ---
  if (adminOnly.includes(hash) && role !== 'admin') {
    Swal.fire('Acceso restringido', 'Solo administradores.', 'warning');
    location.hash = defaultRouteByRole(role);
    return false;
  }

  // --- ÓPTICA ---
  if (role === 'optica' && !opticaAllowed.includes(hash)) {
    location.hash = defaultRouteByRole(role);
    return false;
  }

  // --- EMPLEADO ---
  if (role === 'employee' && !employeeAllowed.includes(hash)) {
    Swal.fire('Acceso restringido', 'Tu rol solo permite Inventario y Pedidos.', 'warning');
    location.hash = defaultRouteByRole(role);
    return false;
  }

  // --- ADMIN ---
  // (admin puede entrar a inventory/orders/etc; POS NO)
  if (role === 'admin' && hash === '#/pos') {
    Swal.fire('Acceso restringido', 'El POS/Catálogo es solo para Ópticas.', 'warning');
    location.hash = defaultRouteByRole(role);
    return false;
  }

  return true;
}

async function navigate() {
  const root = document.getElementById('appRoot');
  let hash = location.hash || '#/login';

  if (!routes[hash]) {
    if (!authService.getToken()) {
      location.hash = '#/login';
      return;
    }
    const role = authService.getRole();
    location.hash = defaultRouteByRole(role);
    return;
  }

  if (!requireAuth(hash)) return;

  const isPublic = ['#/login', '#/register'].includes(hash);
  if (isPublic) {
    await routes[hash](root);
    return;
  }

  if (!requireRole(hash)) return;

  root.innerHTML = renderLayout();
  const outlet = document.getElementById('outlet');

  showOverlay('Cargando…');
  try {
    await routes[hash](outlet);
  } catch (err) {
    console.error(err);
    Swal.fire('Error', 'Ocurrió un error cargando el módulo.', 'error');
  } finally {
    hideOverlay();
  }
}

window.addEventListener('hashchange', navigate);
window.addEventListener('DOMContentLoaded', navigate);
