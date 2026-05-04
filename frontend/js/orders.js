// =============================================================
// orders.js — Inklub Store Manager
// Pedidos Screen Logic
// =============================================================
// Handles everything on the Pedidos screen:
//   - Loading and displaying orders
//   - Filtering by status (Todos, Pendientes, Listos)
//   - Moving orders through production stages
//   - Marking orders as paid
//   - Deleting orders
//   - Viewing the archive (delivered orders)
// =============================================================

import {
  getOrders,
  getOrderArchive,
  createOrder,
  updateOrderStatus,
  deleteOrder
} from './api.js';


// Track the active filter so we can restore it after updates
let activeFilter = 'all';

// Track whether we're viewing the archive or active orders
let viewingArchive = false;

// Store the current orders so we can filter without re-fetching
let currentOrders = [];


// -------------------------------------------------------------
// initOrders(marketId)
// -------------------------------------------------------------
// Entry point for the Pedidos screen.
// Called by dashboard.js whenever this screen is shown
// or the market changes.
// -------------------------------------------------------------
export async function initOrders(marketId) {
  viewingArchive = false;
  activeFilter = 'all';
  await loadOrders(marketId);
}


// -------------------------------------------------------------
// loadOrders(marketId)
// -------------------------------------------------------------
// Fetches orders from the API and renders the screen.
// -------------------------------------------------------------
async function loadOrders(marketId) {
  const container = document.getElementById('screen-pedidos');
  if (!container) return;

  container.innerHTML = '<div class="loading">Cargando pedidos...</div>';

  try {
    // Fetch active or archived orders based on current view
    currentOrders = viewingArchive
      ? await getOrderArchive(marketId)
      : await getOrders(marketId);

    renderOrdersScreen(marketId);
  } catch (error) {
    container.innerHTML = '<div class="empty-state">Error al cargar pedidos.</div>';
    console.error('Orders error:', error);
  }
}


// -------------------------------------------------------------
// renderOrdersScreen(marketId)
// -------------------------------------------------------------
// Builds and injects the full orders screen HTML.
// -------------------------------------------------------------
function renderOrdersScreen(marketId) {
  const container = document.getElementById('screen-pedidos');

  // Filter orders based on active filter
  const filteredOrders = filterOrders(currentOrders, activeFilter);

  // Count orders by status for the filter badges
  const pendingCount = currentOrders.filter(o => o.production_status === 'pending').length;
  const readyCount   = currentOrders.filter(o => o.production_status === 'ready').length;

  const ordersHTML = filteredOrders.length > 0
    ? filteredOrders.map(order => renderOrderCard(order, marketId)).join('')
    : '<div class="empty-state">No hay pedidos en esta categoría.</div>';

  container.innerHTML = `
    <div class="toolbar">
      <button class="btn btn-filter ${activeFilter === 'all' ? 'active' : ''}"
              onclick="window._ordersSetFilter('all', '${marketId}')">
        Todos <span class="filter-count">${currentOrders.length}</span>
      </button>
      <button class="btn btn-filter ${activeFilter === 'pending' ? 'active' : ''}"
              onclick="window._ordersSetFilter('pending', '${marketId}')">
        Pendientes <span class="filter-count">${pendingCount}</span>
      </button>
      <button class="btn btn-filter ${activeFilter === 'ready' ? 'active' : ''}"
              onclick="window._ordersSetFilter('ready', '${marketId}')">
        Listos <span class="filter-count">${readyCount}</span>
      </button>
      <button class="btn btn-secondary ml-auto"
              onclick="window._ordersShowNewForm('${marketId}')">
        + Nuevo pedido
      </button>
    </div>

    <div class="section-title mb-sm">
      ${viewingArchive ? 'Pedidos entregados' : 'Pedidos activos'}
    </div>

    ${ordersHTML}

    <div class="archive-link"
         onclick="window._ordersToggleArchive('${marketId}')">
      ${viewingArchive ? '← Ver pedidos activos' : 'Ver archivo de pedidos entregados →'}
    </div>

    <div class="footer-brand">Elevate your style.</div>
  `;

  // Attach global handlers (needed because onclick in innerHTML can't reference
  // module-scoped functions directly — we expose them on window temporarily)
  window._ordersSetFilter    = (filter, market) => { activeFilter = filter; renderOrdersScreen(market); };
  window._ordersToggleArchive= (market) => { viewingArchive = !viewingArchive; loadOrders(market); };
  window._ordersShowNewForm  = (market) => showNewOrderForm(market);
  window._ordersUpdateStatus = (orderId, field, value, market) => handleStatusUpdate(orderId, field, value, market);
  window._ordersDelete       = (orderId, market) => handleDelete(orderId, market);
}


// -------------------------------------------------------------
// renderOrderCard(order, marketId)
// -------------------------------------------------------------
// Returns the HTML for a single order card including action buttons.
// The primary action button label changes based on current status:
//   pending → "Iniciar producción"
//   in_production → "Marcar listo"
//   ready → "Marcar entregado"
//   delivered → (no action — archive view)
// -------------------------------------------------------------
function renderOrderCard(order, marketId) {
  const date = new Date(order.created_at);
  const dateStr = date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });

  // Production status display info
  const statusMap = {
    pending:      { class: 'badge-pending', label: 'Pendiente' },
    in_production:{ class: 'badge-prod',    label: 'En producción' },
    ready:        { class: 'badge-ready',   label: 'Listo' },
    delivered:    { class: 'badge-delivered',label: 'Entregado' }
  };

  // Payment status display info
  const paymentMap = {
    paid:   { class: 'badge-paid',   label: 'Pagado' },
    unpaid: { class: 'badge-unpaid', label: 'Sin pagar' }
  };

  // Primary action — moves the order to the next production stage
  const nextStatusMap = {
    pending:      { next: 'in_production', label: 'Iniciar producción' },
    in_production:{ next: 'ready',         label: 'Marcar listo' },
    ready:        { next: 'delivered',     label: 'Marcar entregado' },
    delivered:    null  // No further action
  };

  const status  = statusMap[order.production_status]  || statusMap.pending;
  const payment = paymentMap[order.payment_status]    || paymentMap.unpaid;
  const nextAction = nextStatusMap[order.production_status];

  const notesHTML = order.notes
    ? `<div class="order-notes">${order.notes}</div>`
    : '';

  // Build action buttons
  // Primary action — only show if there's a next stage
  const primaryBtnHTML = nextAction ? `
    <button class="btn btn-primary"
            onclick="window._ordersUpdateStatus(${order.id}, 'production_status', '${nextAction.next}', '${marketId}')">
      ${nextAction.label}
    </button>
  ` : '';

  // "Marcar pagado" — only show if not yet paid and order is not delivered
  const payBtnHTML = order.payment_status === 'unpaid' && order.production_status !== 'delivered' ? `
    <button class="btn btn-success"
            onclick="window._ordersUpdateStatus(${order.id}, 'payment_status', 'paid', '${marketId}')">
      Marcar pagado
    </button>
  ` : '';

  // Delete button — always available
  const deleteBtnHTML = `
    <button class="btn btn-danger"
            onclick="window._ordersDelete(${order.id}, '${marketId}')">
      Eliminar
    </button>
  `;

  return `
    <div class="card" id="order-${order.id}">
      <div class="order-card-top">
        <div class="order-name">${order.customer_name}</div>
        <div class="order-date">${dateStr}</div>
      </div>
      <div class="order-item">${order.product}</div>
      ${notesHTML}
      <div class="order-badges">
        <span class="badge ${status.class}">${status.label}</span>
        <span class="badge ${payment.class}">${payment.label}</span>
        <span class="order-price ml-auto">
          $${order.total_price || '—'} ${order.currency || ''}
        </span>
      </div>
      <div class="card-actions">
        ${primaryBtnHTML}
        ${payBtnHTML}
        ${deleteBtnHTML}
      </div>
    </div>
  `;
}


// -------------------------------------------------------------
// handleStatusUpdate(orderId, field, value, marketId)
// -------------------------------------------------------------
// Called when any status button is tapped.
// Updates the order on the server then reloads the list.
// -------------------------------------------------------------
async function handleStatusUpdate(orderId, field, value, marketId) {
  try {
    await updateOrderStatus(orderId, { [field]: value });
    // Reload the orders list to reflect the change
    await loadOrders(marketId);
  } catch (error) {
    alert('Error al actualizar el pedido. Inténtalo de nuevo.');
    console.error('Status update error:', error);
  }
}


// -------------------------------------------------------------
// handleDelete(orderId, marketId)
// -------------------------------------------------------------
// Asks for confirmation before deleting an order.
// -------------------------------------------------------------
async function handleDelete(orderId, marketId) {
  const confirmed = confirm('¿Segura que quieres eliminar este pedido? Esta acción no se puede deshacer.');
  if (!confirmed) return;

  try {
    await deleteOrder(orderId);
    await loadOrders(marketId);
  } catch (error) {
    alert('Error al eliminar el pedido.');
    console.error('Delete error:', error);
  }
}


// -------------------------------------------------------------
// showNewOrderForm(marketId)
// -------------------------------------------------------------
// Renders a simple inline form for creating a new order.
// Replaces the orders list with the form.
// -------------------------------------------------------------
function showNewOrderForm(marketId) {
  const container = document.getElementById('screen-pedidos');

  container.innerHTML = `
    <div class="form-card">
      <div class="form-title">Nuevo pedido</div>

      <label class="field-label">Nombre del cliente</label>
      <input class="field-input" id="new-customer-name" placeholder="Ej. Carlos Reyes" />

      <label class="field-label">WhatsApp o Instagram</label>
      <input class="field-input" id="new-customer-contact" placeholder="Ej. @usuario o +1 604..." />

      <label class="field-label">Producto</label>
      <input class="field-input" id="new-product" placeholder="Ej. Camiseta Copa 2026 — M, blanco" />

      <div class="field-row">
        <div>
          <label class="field-label">Cantidad</label>
          <input class="field-input" id="new-quantity" type="number" min="1" value="1" placeholder="1" />
        </div>
        <div>
          <label class="field-label">Precio unitario</label>
          <input class="field-input" id="new-price" type="number" min="0" placeholder="0.00" />
        </div>
      </div>

      <label class="field-label">Notas / personalización</label>
      <textarea class="field-textarea" id="new-notes"
                placeholder="Detalles del diseño, talla, color de vinilo, texto..."></textarea>
    </div>

    <div class="flex gap-sm mt-md">
      <button class="btn btn-primary flex-1" onclick="window._ordersSaveNew('${marketId}')">
        Guardar pedido
      </button>
      <button class="btn btn-secondary" onclick="window._ordersSetFilter('all', '${marketId}'); window.initOrders && window.initOrders('${marketId}')">
        Cancelar
      </button>
    </div>
  `;

  // Save handler
  window._ordersSaveNew = async (market) => {
    const name    = document.getElementById('new-customer-name').value.trim();
    const contact = document.getElementById('new-customer-contact').value.trim();
    const product = document.getElementById('new-product').value.trim();
    const qty     = parseInt(document.getElementById('new-quantity').value) || 1;
    const price   = parseFloat(document.getElementById('new-price').value) || null;
    const notes   = document.getElementById('new-notes').value.trim();

    if (!name || !product) {
      alert('El nombre del cliente y el producto son obligatorios.');
      return;
    }

    try {
      await createOrder({
        market_id:        market,
        customer_name:    name,
        customer_contact: contact || null,
        product,
        quantity:         qty,
        unit_price:       price,
        notes:            notes || null
      });

      // Go back to the orders list after saving
      await loadOrders(market);
    } catch (error) {
      alert('Error al guardar el pedido. Inténtalo de nuevo.');
      console.error('Create order error:', error);
    }
  };
}


// -------------------------------------------------------------
// filterOrders(orders, filter)
// -------------------------------------------------------------
// Filters the orders array based on the active filter chip.
// 'all' returns everything, other values filter by production_status.
// -------------------------------------------------------------
function filterOrders(orders, filter) {
  if (filter === 'all') return orders;
  if (filter === 'pending') return orders.filter(o =>
    o.production_status === 'pending' || o.production_status === 'in_production'
  );
  if (filter === 'ready') return orders.filter(o => o.production_status === 'ready');
  return orders;
}
