// =============================================================
// dashboard.js — Inklub Store Manager
// Main App Controller + Inicio Screen
// =============================================================
// This file does two things:
//
// 1. APP CONTROLLER — manages navigation between screens,
//    the market toggle (CA/PA), and the gear icon.
//
// 2. INICIO SCREEN — loads and renders the dashboard data:
//    stat cards, stock alerts, payment summary, recent orders.
//
// WHY COMBINED:
// The app controller needs to know about the active market
// to pass it to each screen when switching tabs. Keeping it
// here avoids circular imports.
// =============================================================

import { getDashboard } from './api.js';
import { setupLogoutButton } from './auth.js';
import { initOrders } from './orders.js';
import { initInventory } from './inventory.js';
import { initCustomers } from './customers.js';
import { initSettings } from './settings.js';


// -------------------------------------------------------------
// App State
// -------------------------------------------------------------
// These variables track what's currently active.
// All screen functions read from here when they need
// to know which market is selected.
// -------------------------------------------------------------
export const state = {
  market: 'ca',          // Currently selected market: 'ca' or 'pa'
  activeScreen: 'inicio' // Currently visible screen
};

// Market display info — used to build the market label line
const MARKET_INFO = {
  ca: { name: 'Canadá',  currency: 'CAD',     payment: 'e-Transfer', flag: '🇨🇦' },
  pa: { name: 'Panamá',  currency: 'PAB/USD',  payment: 'Yappi',      flag: '🇵🇦' }
};


// -------------------------------------------------------------
// initApp()
// -------------------------------------------------------------
// Entry point for the whole app — called once after login.
// Sets up navigation, market toggle, and loads the first screen.
// -------------------------------------------------------------
export function initApp() {
  setupNavigation();
  setupMarketToggle();
  setupGearButton();
  setupLogoutButton();

  // Load the inicio (dashboard) screen first
  loadScreen('inicio');
}


// -------------------------------------------------------------
// setupNavigation()
// -------------------------------------------------------------
// Attaches click handlers to the four nav tab buttons.
// Each tab loads its corresponding screen.
// -------------------------------------------------------------
function setupNavigation() {
  const navButtons = document.querySelectorAll('.nav button[data-screen]');

  navButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const screen = btn.dataset.screen;
      loadScreen(screen);
    });
  });
}


// -------------------------------------------------------------
// setupMarketToggle()
// -------------------------------------------------------------
// Attaches click handlers to the CA / PA toggle buttons.
// When the market changes, the active screen reloads with
// the new market's data.
// -------------------------------------------------------------
function setupMarketToggle() {
  const toggleButtons = document.querySelectorAll('.market-toggle button');

  toggleButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const market = btn.dataset.market;

      // Don't reload if already on this market
      if (market === state.market) return;

      // Update state
      state.market = market;

      // Update toggle button styles
      toggleButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Update the market label line below the nav
      updateMarketLabel();

      // Reload the active screen with the new market's data
      loadScreen(state.activeScreen);
    });
  });
}


// -------------------------------------------------------------
// setupGearButton()
// -------------------------------------------------------------
// The gear icon in the topbar opens/closes the settings screen.
// -------------------------------------------------------------
function setupGearButton() {
  const gearBtn = document.getElementById('btn-settings');
  if (!gearBtn) return;

  gearBtn.addEventListener('click', () => {
    if (state.activeScreen === 'settings') {
      // Already on settings — go back to inicio
      loadScreen('inicio');
    } else {
      loadScreen('settings');
    }
  });
}


// -------------------------------------------------------------
// loadScreen(screenName)
// -------------------------------------------------------------
// Shows the requested screen and hides all others.
// Also updates nav tab styles and loads fresh data.
// -------------------------------------------------------------
function loadScreen(screenName) {
  state.activeScreen = screenName;

  // Hide all screens
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));

  // Show the requested screen
  const screen = document.getElementById(`screen-${screenName}`);
  if (screen) screen.classList.add('active');

  // Update nav tab active state
  document.querySelectorAll('.nav button[data-screen]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.screen === screenName);
  });

  // Update gear button active state
  const gearBtn = document.getElementById('btn-settings');
  if (gearBtn) {
    gearBtn.classList.toggle('active', screenName === 'settings');
  }

  // Update the market label
  updateMarketLabel();

  // Load data for the requested screen
  switch (screenName) {
    case 'inicio':    loadDashboard();          break;
    case 'pedidos':   initOrders(state.market); break;
    case 'inventario':initInventory(state.market); break;
    case 'clientes':  initCustomers(state.market); break;
    case 'settings':  initSettings();           break;
  }
}


// -------------------------------------------------------------
// updateMarketLabel()
// -------------------------------------------------------------
// Updates the "Canadá · CAD · e-Transfer" line below the nav.
// -------------------------------------------------------------
function updateMarketLabel() {
  const labelEl = document.getElementById('market-label');
  if (!labelEl) return;

  const info = MARKET_INFO[state.market];
  labelEl.textContent = `${info.flag} ${info.name} · ${info.currency} · ${info.payment}`;
}


// =============================================================
// INICIO (DASHBOARD) SCREEN
// =============================================================

// -------------------------------------------------------------
// loadDashboard()
// -------------------------------------------------------------
// Fetches dashboard data for the current market and renders
// all the stat cards, alerts, payment summary, and recent orders.
// -------------------------------------------------------------
async function loadDashboard() {
  const container = document.getElementById('screen-inicio');
  if (!container) return;

  // Show a loading state while waiting for the API
  container.innerHTML = '<div class="loading">Cargando...</div>';

  try {
    const data = await getDashboard(state.market);
    renderDashboard(data);
  } catch (error) {
    container.innerHTML = `
      <div class="empty-state">
        Error al cargar el dashboard. Verifica tu conexión.
      </div>
    `;
    console.error('Dashboard error:', error);
  }
}


// -------------------------------------------------------------
// renderDashboard(data)
// -------------------------------------------------------------
// Takes the API response and builds the dashboard HTML.
// Called by loadDashboard() once the data arrives.
// -------------------------------------------------------------
function renderDashboard(data) {
  const container = document.getElementById('screen-inicio');

  // Build the low-stock alert banner (only shown if there are alerts)
  const alertHTML = data.low_stock_count > 0 ? `
    <div class="alert-banner">
      <div class="alert-label">Alerta de stock</div>
      <div class="alert-text">
        ${data.low_stock_items[0].name} — solo ${data.low_stock_items[0].quantity} ${data.low_stock_items[0].unit} restantes.
        ${data.low_stock_count > 1 ? `Y ${data.low_stock_count - 1} producto(s) más.` : ''}
      </div>
    </div>
  ` : '';

  // Build the payment summary rows (only unpaid orders)
  const paymentRowsHTML = data.unpaid_orders && data.unpaid_orders.length > 0
    ? data.unpaid_orders.map(order => `
        <div class="payment-row">
          <span class="payment-row-label">${order.customer_name} — ${order.product}</span>
          <span class="payment-row-value">$${order.total_price || '—'}</span>
        </div>
      `).join('')
    : '<div class="payment-row"><span class="payment-row-label">No hay pagos pendientes</span></div>';

  // Build the recent orders list (first 3)
  const recentOrdersHTML = data.recent_orders && data.recent_orders.length > 0
    ? data.recent_orders.slice(0, 3).map(order => renderOrderCard(order)).join('')
    : '<div class="empty-state">No hay pedidos activos.</div>';

  // Assemble the full dashboard HTML
  container.innerHTML = `
    <div class="stat-grid">
      <div class="stat-card alert">
        <div class="stat-label">Pedidos abiertos</div>
        <div class="stat-value">${data.open_orders}</div>
        <div class="stat-sub">${data.unpaid} sin pagar</div>
      </div>
      <div class="stat-card info">
        <div class="stat-label">Este mes</div>
        <div class="stat-value">$${Math.round(data.revenue)}</div>
        <div class="stat-sub">${data.market.currency} cobrado</div>
      </div>
      <div class="stat-card info">
        <div class="stat-label">Listos para entregar</div>
        <div class="stat-value">${data.ready}</div>
        <div class="stat-sub">esperando retiro</div>
      </div>
      <div class="stat-card alert">
        <div class="stat-label">Stock bajo</div>
        <div class="stat-value">${data.low_stock_count}</div>
        <div class="stat-sub">productos</div>
      </div>
    </div>

    ${alertHTML}

    <div class="section-header">
      <span class="section-title">Pagos pendientes</span>
    </div>
    <div class="payment-summary">
      ${paymentRowsHTML}
      <div class="payment-row total">
        <span class="payment-row-label">Total por cobrar</span>
        <span class="payment-row-value">$${data.total_pending || 0} ${data.market.currency}</span>
      </div>
    </div>

    <div class="divider"></div>

    <div class="section-header">
      <span class="section-title">Pedidos recientes</span>
    </div>

    ${recentOrdersHTML}

    <div class="footer-brand">Elevate your style.</div>
  `;
}


// -------------------------------------------------------------
// renderOrderCard(order)
// -------------------------------------------------------------
// Returns the HTML string for a single order card.
// Used on the dashboard for the recent orders preview.
// The full version with action buttons is in orders.js.
// -------------------------------------------------------------
function renderOrderCard(order) {
  // Format the date as "3 may" style
  const date = new Date(order.created_at);
  const dateStr = date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });

  // Map production_status to the correct CSS class and Spanish label
  const statusLabels = {
    pending:     { class: 'badge-pending',  label: 'Pendiente' },
    in_production:{ class: 'badge-prod',   label: 'En producción' },
    ready:       { class: 'badge-ready',    label: 'Listo' },
    delivered:   { class: 'badge-delivered',label: 'Entregado' }
  };

  const paymentLabels = {
    paid:   { class: 'badge-paid',   label: 'Pagado' },
    unpaid: { class: 'badge-unpaid', label: 'Sin pagar' }
  };

  const status  = statusLabels[order.production_status]  || statusLabels.pending;
  const payment = paymentLabels[order.payment_status]    || paymentLabels.unpaid;

  // Notes line only shows if there are notes
  const notesHTML = order.notes
    ? `<div class="order-notes">${order.notes}</div>`
    : '';

  return `
    <div class="card">
      <div class="order-card-top">
        <div class="order-name">${order.customer_name}</div>
        <div class="order-date">${dateStr}</div>
      </div>
      <div class="order-item">${order.product}</div>
      ${notesHTML}
      <div class="order-badges">
        <span class="badge ${status.class}">${status.label}</span>
        <span class="badge ${payment.class}">${payment.label}</span>
        <span class="order-price ml-auto">$${order.total_price || '—'} ${order.currency || ''}</span>
      </div>
    </div>
  `;
}
