// =============================================================
// customers.js — Inklub Store Manager
// Clientes Screen Logic
// =============================================================
// Handles everything on the Clientes screen:
//   - Loading and displaying customers with stats
//   - Search filtering
//   - Viewing a customer's full order history
//   - Editing customer notes
//
// FIX: The back button from customer order history was hardcoded
// to use 'ca' as the market, which meant switching to Panama and
// then viewing a customer's orders would bring you back to Canada.
// Fixed by tracking currentMarket and using it in the back button.
// =============================================================

import { getCustomers, getCustomerOrders, updateCustomerNotes } from './api.js';


// Store the current customers list so search can filter
// without making a new API call
let currentCustomers = [];

// Track the current market so the back button from order history
// always returns to the correct market — fixes the hardcoded 'ca' bug
let currentMarket = null;


// -------------------------------------------------------------
// initCustomers(marketId)
// -------------------------------------------------------------
// Entry point for the Clientes screen.
// Called by dashboard.js whenever this screen is shown
// or the market toggle changes.
// -------------------------------------------------------------
export async function initCustomers(marketId) {
  currentMarket = marketId;  // Store so back button can use it

  const container = document.getElementById('screen-clientes');
  if (!container) return;

  container.innerHTML = '<div class="loading">Cargando clientes...</div>';

  try {
    currentCustomers = await getCustomers(marketId);
    renderCustomersScreen(marketId);
  } catch (error) {
    container.innerHTML = '<div class="empty-state">Error al cargar clientes.</div>';
    console.error('Customers error:', error);
  }
}


// -------------------------------------------------------------
// renderCustomersScreen(marketId)
// -------------------------------------------------------------
// Builds the customers list screen HTML.
// Also sets up the search handler and button handlers.
// -------------------------------------------------------------
function renderCustomersScreen(marketId) {
  currentMarket = marketId;
  const container = document.getElementById('screen-clientes');

  const customersHTML = currentCustomers.length > 0
    ? currentCustomers.map(customer => renderCustomerCard(customer, marketId)).join('')
    : '<div class="empty-state">No hay clientes aún. Se crean automáticamente cuando registras un pedido.</div>';

  container.innerHTML = `
    <input class="search-box" id="customer-search"
           placeholder="Buscar cliente..."
           oninput="window._customersSearch(this.value, '${marketId}')" />

    <div class="section-title mb-sm">${currentCustomers.length} clientes</div>

    <div id="customers-list">
      ${customersHTML}
    </div>

    <div class="footer-brand">Elevate your style.</div>
  `;

  // Search handler — filters the displayed list without re-fetching from the API.
  // Searches by name and contact (WhatsApp / Instagram handle).
  window._customersSearch = (query, market) => {
    const filtered = query.trim()
      ? currentCustomers.filter(c =>
        c.name.toLowerCase().includes(query.toLowerCase()) ||
        (c.contact && c.contact.toLowerCase().includes(query.toLowerCase()))
      )
      : currentCustomers;

    document.getElementById('customers-list').innerHTML = filtered.length > 0
      ? filtered.map(c => renderCustomerCard(c, market)).join('')
      : '<div class="empty-state">No se encontraron clientes.</div>';
  };

  window._customersViewOrders = (customerId) => showCustomerOrders(customerId);
  window._customersEditNotes = (customerId, market) => showEditNotesForm(customerId, market);
}


// -------------------------------------------------------------
// renderCustomerCard(customer, marketId)
// -------------------------------------------------------------
// Returns the HTML for a single customer card.
// Customers with 3+ orders get the "Frecuente" badge and
// an outlined avatar to make them stand out.
// -------------------------------------------------------------
function renderCustomerCard(customer, marketId) {
  // Get initials from the first two words of the customer's name
  const initials = customer.name
    .split(' ')
    .slice(0, 2)
    .map(word => word[0]?.toUpperCase() || '')
    .join('');

  // Frequent customers: 3 or more orders
  const isFrequent = customer.order_count >= 3;
  const avatarClass = isFrequent ? 'avatar frequent' : 'avatar';
  const frequentHTML = isFrequent
    ? '<span class="badge badge-ready ml-auto">Frecuente</span>'
    : '';

  // Format the last order date in Spanish short format (e.g. "3 may")
  const lastOrderDate = customer.last_order_at
    ? new Date(customer.last_order_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
    : '—';

  // Notes block only appears if notes have been saved for this customer
  const notesHTML = customer.notes
    ? `<div class="customer-notes">${customer.notes}</div>`
    : '';

  return `
    <div class="card">
      <div class="customer-top">
        <div class="${avatarClass}">${initials}</div>
        <div>
          <div class="customer-name">${customer.name}</div>
          <div class="customer-contact">${customer.contact || 'Sin contacto'}</div>
        </div>
        ${frequentHTML}
      </div>

      <div class="customer-stats">
        <span><strong>${customer.order_count}</strong> pedidos</span>
        <span><strong>$${Math.round(customer.total_spent || 0)}</strong> total</span>
        <span>Último: <strong>${lastOrderDate}</strong></span>
      </div>

      ${notesHTML}

      <div class="card-actions">
        <button class="btn btn-primary"
                onclick="window._customersViewOrders(${customer.id})">
          Ver pedidos
        </button>
        <button class="btn btn-secondary"
                onclick="window._customersEditNotes(${customer.id}, '${marketId}')">
          Editar notas
        </button>
      </div>
    </div>
  `;
}


// -------------------------------------------------------------
// showCustomerOrders(customerId)
// -------------------------------------------------------------
// Replaces the customers list with the full order history
// for a specific customer. The back button returns to the
// customers list using currentMarket (fixed bug).
// -------------------------------------------------------------
async function showCustomerOrders(customerId) {
  const customer = currentCustomers.find(c => c.id === customerId);
  const container = document.getElementById('screen-clientes');

  container.innerHTML = '<div class="loading">Cargando historial...</div>';

  try {
    const orders = await getCustomerOrders(customerId);

    const ordersHTML = orders.length > 0
      ? orders.map(order => {
        const date = new Date(order.created_at).toLocaleDateString('es-ES', {
          day: 'numeric', month: 'short', year: 'numeric'
        });

        // Map production_status to Spanish labels
        const statusLabels = {
          pending: 'Pendiente',
          in_production: 'En producción',
          ready: 'Listo',
          delivered: 'Entregado'
        };

        // Map status to badge class
        const statusClass = order.production_status === 'ready' ? 'badge-ready'
          : order.production_status === 'delivered' ? 'badge-delivered'
            : 'badge-pending';

        return `
            <div class="card">
              <div class="flex-between mb-sm">
                <span class="order-name">${order.product}</span>
                <span class="text-small">${date}</span>
              </div>
              <div class="order-badges">
                <span class="badge ${statusClass}">
                  ${statusLabels[order.production_status] || order.production_status}
                </span>
                <span class="badge ${order.payment_status === 'paid' ? 'badge-paid' : 'badge-unpaid'}">
                  ${order.payment_status === 'paid' ? 'Pagado' : 'Sin pagar'}
                </span>
                <span class="order-price ml-auto">$${order.total_price || '—'}</span>
              </div>
            </div>
          `;
      }).join('')
      : '<div class="empty-state">Este cliente no tiene pedidos aún.</div>';

    container.innerHTML = `
      <div class="section-header mb-sm">
        <span class="section-title">Historial de ${customer?.name || 'cliente'}</span>
        <button class="btn btn-secondary" onclick="window._customersBack()">
          ← Volver
        </button>
      </div>
      ${ordersHTML}
    `;

    // Fixed: use currentMarket instead of hardcoded 'ca'
    // This ensures going back always returns to the correct market
    window._customersBack = () => renderCustomersScreen(currentMarket);

  } catch (error) {
    container.innerHTML = '<div class="empty-state">Error al cargar el historial.</div>';
    console.error('Customer orders error:', error);
  }
}


// -------------------------------------------------------------
// showEditNotesForm(customerId, marketId)
// -------------------------------------------------------------
// Uses a browser prompt to edit customer notes.
// Notes are free-form text — she can write anything useful
// like sizes, preferences, payment habits, etc.
// -------------------------------------------------------------
async function showEditNotesForm(customerId, marketId) {
  const customer = currentCustomers.find(c => c.id === customerId);
  if (!customer) return;

  const newNotes = prompt(
    `Notas para ${customer.name}:\n(Talla habitual, preferencias, método de pago, etc.)\n\nNotas actuales: ${customer.notes || '(ninguna)'}`,
    customer.notes || ''
  );

  // User cancelled — null means they pressed Cancel, not just cleared the field
  if (newNotes === null) return;

  try {
    await updateCustomerNotes(customerId, newNotes);
    // Reload the customers screen to show the updated notes
    await initCustomers(marketId);
  } catch (error) {
    alert('Error al guardar las notas.');
    console.error('Update notes error:', error);
  }
}