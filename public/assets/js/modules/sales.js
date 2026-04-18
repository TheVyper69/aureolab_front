import { api } from '../services/api.js';
import { money } from '../utils/helpers.js';

let salesCharts = [];

// esto es una prueba

function destroyCharts() {
  for (const ch of salesCharts) {
    try { ch.destroy(); } catch {}
  }
  salesCharts = [];
}

function safe(v) {
  return String(v ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export async function renderSales(outlet) {
  destroyCharts();

  let dashboard = {
    orders: 0,
    income: 0,
    avg: 0
  };

  let byDay = [];
  let paymentMethods = [];
  let topProducts = [];

  const results = await Promise.allSettled([
    api.get('/reports/dashboard'),
    api.get('/reports/orders/by-day'),
    api.get('/reports/orders/payment-methods'),
    api.get('/reports/orders/top-products')
  ]);

  if (results[0].status === 'fulfilled') {
    const data = results[0].value?.data || {};
    dashboard = {
      orders: Number(data.orders || 0),
      income: Number(data.income || 0),
      avg: Number(data.avg || 0)
    };
  }

  if (results[1].status === 'fulfilled') {
    byDay = Array.isArray(results[1].value?.data) ? results[1].value.data : [];
  }

  if (results[2].status === 'fulfilled') {
    paymentMethods = Array.isArray(results[2].value?.data) ? results[2].value.data : [];
  }

  if (results[3].status === 'fulfilled') {
    topProducts = Array.isArray(results[3].value?.data) ? results[3].value.data : [];
  }

  const bestDay = [...byDay].sort((a, b) => Number(b.total || 0) - Number(a.total || 0))[0] || null;
 
  outlet.innerHTML = `
    <div class="d-flex align-items-center justify-content-between mb-3">
      <h4 class="mb-0">Ventas / Reportes</h4>
      <button class="btn btn-outline-brand" id="btnLowStock">Ver stock bajo</button>
    </div>

    <div class="row g-3 mb-3">
      <div class="col-md-3">
        <div class="card card-kpi p-3">
          <div class="text-muted small">Pedidos</div>
          <div class="fs-4 fw-bold">${dashboard.orders}</div>
        </div>
      </div>

      <div class="col-md-3">
        <div class="card card-kpi p-3">
          <div class="text-muted small">Ingresos</div>
          <div class="fs-4 fw-bold">${money(dashboard.income)}</div>
        </div>
      </div>

      <div class="col-md-3">
        <div class="card card-kpi p-3">
          <div class="text-muted small">Promedio por pedido</div>
          <div class="fs-4 fw-bold">${money(dashboard.avg)}</div>
        </div>
      </div>

      <div class="col-md-3">
        <div class="card card-kpi p-3">
          <div class="text-muted small">Mejor día</div>
          <div class="fw-bold">${safe(bestDay?.day || '—')}</div>
          <div class="small text-muted">${money(bestDay?.total || 0)}</div>
        </div>
      </div>
    </div>

    <div class="row g-3">
      <div class="col-lg-8">
        <div class="card p-3 h-100">
          <div class="d-flex justify-content-between align-items-center mb-2">
            <h6 class="mb-0">Ingresos por día</h6>
            <span class="small text-muted">Pedidos no cancelados</span>
          </div>
          <div style="position: relative; height: 320px;">
            <canvas id="chartOrdersByDay"></canvas>
          </div>
        </div>
      </div>

      <div class="col-lg-4">
        <div class="card p-3 h-100">
          <div class="d-flex justify-content-between align-items-center mb-2">
            <h6 class="mb-0">Métodos de pago</h6>
            <span class="small text-muted">Distribución</span>
          </div>
          <div style="position: relative; height: 320px;">
            <canvas id="chartPaymentMethods"></canvas>
          </div>
        </div>
      </div>

      <div class="col-lg-7">
        <div class="card p-3 h-100">
          <div class="d-flex justify-content-between align-items-center mb-2">
            <h6 class="mb-0">Top productos</h6>
            <span class="small text-muted">Por cantidad vendida</span>
          </div>
          <div style="position: relative; height: 360px;">
            <canvas id="chartTopProducts"></canvas>
          </div>
        </div>
      </div>

      <div class="col-lg-5">
        <div class="card p-3 h-100">
          <h6 class="mb-2">Resumen rápido</h6>
          <div class="small text-muted mb-2">Métodos de pago</div>

          <div class="d-flex flex-column gap-2">
            ${
              paymentMethods.length
                ? paymentMethods.map(pm => `
                  <div class="border rounded p-2">
                    <div class="d-flex justify-content-between">
                      <div class="fw-semibold">${safe(pm.label || 'Método')}</div>
                      <div class="fw-bold">${money(pm.total || 0)}</div>
                    </div>
                    <div class="small text-muted">
                      Pedidos: ${Number(pm.qty || 0)}
                    </div>
                  </div>
                `).join('')
                : `<div class="text-muted">Sin datos disponibles.</div>`
            }
          </div>
        </div>
      </div>
    </div>
  `;

  if (typeof Chart === 'undefined') {
    console.error('Chart.js no está cargado');
    return;
  }

  const byDayLabels = byDay.map(x => x.day || 'Sin fecha');
  const byDayTotals = byDay.map(x => Number(x.total || 0));

  const pmLabels = paymentMethods.map(x => x.label || `Método #${x.payment_method_id || ''}`);
  const pmTotals = paymentMethods.map(x => Number(x.total || 0));

  const topLabels = topProducts.map(x => {
    const name = x.name || 'Producto';
    const sku = x.sku ? ` (${x.sku})` : '';
    return `${name}${sku}`;
  });
  const topQty = topProducts.map(x => Number(x.qty || 0));

  const ordersByDayCtx = outlet.querySelector('#chartOrdersByDay');
  const paymentMethodsCtx = outlet.querySelector('#chartPaymentMethods');
  const topProductsCtx = outlet.querySelector('#chartTopProducts');

  if (ordersByDayCtx) {
    salesCharts.push(new Chart(ordersByDayCtx, {
      type: 'bar',
      data: {
        labels: byDayLabels,
        datasets: [{
          label: 'Ingresos',
          data: byDayTotals
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: true }
        },
        scales: {
          y: {
            beginAtZero: true
          }
        }
      }
    }));
  }

  if (paymentMethodsCtx) {
    salesCharts.push(new Chart(paymentMethodsCtx, {
      type: 'doughnut',
      data: {
        labels: pmLabels,
        datasets: [{
          label: 'Métodos de pago',
          data: pmTotals
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom' }
        }
      }
    }));
  }

  if (topProductsCtx) {
    salesCharts.push(new Chart(topProductsCtx, {
      type: 'bar',
      data: {
        labels: topLabels,
        datasets: [{
          label: 'Cantidad vendida',
          data: topQty
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: true }
        },
        scales: {
          x: {
            beginAtZero: true
          }
        }
      }
    }));
  }

  outlet.querySelector('#btnLowStock')?.addEventListener('click', async () => {
    try {
      const { data: low } = await api.get('/inventory/low-stock');

      if (!Array.isArray(low) || low.length === 0) {
        Swal.fire('Todo bien', 'No hay productos en stock bajo.', 'success');
        return;
      }

      const html = low.map(r => {
        const p = r.product || r;
        const sku = p.sku || '';
        const name = p.name || '';
        const st = Number(r.stock ?? p.stock ?? 0);
        const min = Number(p.minStock ?? p.min_stock ?? 0);

        return `• <b>${safe(sku)}</b> — ${safe(name)} (stock: <b>${st}</b>, mín: ${min})`;
      }).join('<br>');

      Swal.fire({
        title: 'Stock bajo',
        html,
        icon: 'warning'
      });
    } catch (err) {
      console.error(err);
      Swal.fire(
        'Falta endpoint',
        'No existe o está fallando /inventory/low-stock.',
        'info'
      );
    }
  });
}