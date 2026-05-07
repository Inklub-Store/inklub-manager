// =============================================================
// dashboard.js — Inklub Store Manager
// Main App Controller + Inicio Screen
// =============================================================
// Updated: Pedidos removed from navigation.
// Inventario is now the default screen that loads on login.
// Inicio screen simplified to a pure inventory overview —
// low stock summary and quick links, no payment/order data.
// =============================================================

import { getDashboard } from './api.js';
import { setupLogoutButton } from './auth.js';
import { initInventory } from './inventory.js';
import { initCustomers } from './customers.js';
import { initSettings } from './settings.js';


// -------------------------------------------------------------
// App State
// -------------------------------------------------------------
export const state = {
  market: 'ca',          // Currently selected market: 'ca' or 'pa'
  activeScreen: 'inventario'   // Inventario is now the default screen
};

// Market display info
const MARKET_INFO = {
  ca: { name: 'Canadá', currency: 'CAD', payment: 'e-Transfer', flag: '🇨🇦' },
  pa: { name: 'Panamá', currency: 'PAB/USD', payment: 'Yappi', flag: '🇵🇦' }
};


// -------------------------------------------------------------
// initApp()
// -------------------------------------------------------------
// Entry point — called once after login.
// Sets up navigation and loads Inventario as the first screen.
// -------------------------------------------------------------
export function initApp() {
  setupNavigation();
  setupMarketToggle();
  setupGearButton();
  setupLogoutButton();

  // Load Inventario first — it's the main screen now
  loadScreen('inventario');
}


// -------------------------------------------------------------
// setupNavigation()
// -------------------------------------------------------------
function setupNavigation() {
  const navButtons = document.querySelectorAll('.nav button[data-screen]');

  navButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      loadScreen(btn.dataset.screen);
    });
  });
}


// -------------------------------------------------------------
// setupMarketToggle()
// -------------------------------------------------------------
function setupMarketToggle() {
  const toggleButtons = document.querySelectorAll('.market-toggle button');

  toggleButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const market = btn.dataset.market;
      if (market === state.market) return;

      state.market = market;

      toggleButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      updateMarketLabel();
      loadScreen(state.activeScreen);
    });
  });
}


// -------------------------------------------------------------
// setupGearButton()
// -------------------------------------------------------------
function setupGearButton() {
  const gearBtn = document.getElementById('btn-settings');
  if (!gearBtn) return;

  gearBtn.addEventListener('click', () => {
    if (state.activeScreen === 'settings') {
      // Already on settings — go back to inventario
      loadScreen('inventario');
    } else {
      loadScreen('settings');
    }
  });
}


// -------------------------------------------------------------
// loadScreen(screenName)
// -------------------------------------------------------------
// Shows the requested screen and loads its data.
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

  updateMarketLabel();

  // Load data for the requested screen
  switch (screenName) {
    case 'inicio': loadInicio(); break;
    case 'inventario': initInventory(state.market); break;
    case 'clientes': initCustomers(state.market); break;
    case 'settings': initSettings(); break;
  }
}


// -------------------------------------------------------------
// updateMarketLabel()
// -------------------------------------------------------------
function updateMarketLabel() {
  const labelEl = document.getElementById('market-label');
  if (!labelEl) return;

  const info = MARKET_INFO[state.market];
  labelEl.textContent = `${info.flag} ${info.name} · ${info.currency} · ${info.payment}`;
}


// =============================================================
// INICIO SCREEN — Simplified inventory overview
// =============================================================
// Since orders are managed in Trello, Inicio now shows a
// simple inventory health summary — low stock alerts,
// total items per market, and a quick link to Inventario.
// =============================================================

async function loadInicio() {
  const container = document.getElementById('screen-inicio');
  if (!container) return;

  container.innerHTML = '<div class="loading">Cargando...</div>';

  try {
    const data = await getDashboard(state.market);
    renderInicio(data);
  } catch (error) {
    container.innerHTML = '<div class="empty-state">Error al cargar. Verifica tu conexión.</div>';
    console.error('Inicio error:', error);
  }
}


function renderInicio(data) {
  const container = document.getElementById('screen-inicio');

  // Build low stock alert banner
  const alertHTML = data.low_stock_count > 0 ? `
    <div class="alert-banner">
      <div class="alert-label">Alerta de stock</div>
      <div class="alert-text">
        ${data.low_stock_items[0].name} — solo ${data.low_stock_items[0].quantity} ${data.low_stock_items[0].unit} restantes.
        ${data.low_stock_count > 1 ? `Y ${data.low_stock_count - 1} producto(s) más.` : ''}
      </div>
    </div>
  ` : '';

  // Build low stock items list
  const lowStockHTML = data.low_stock_items.length > 0
    ? data.low_stock_items.map(item => `
        <div class="inv-row" style="display:flex; align-items:center; gap:10px; padding:9px 0; border-bottom:0.5px solid var(--color-cream);">
          <div class="inv-dot ${item.quantity === 0 ? 'out' : 'low'}"></div>
          <span style="flex:1; font-size:13px; font-weight:700;">${item.name}</span>
          <span style="font-size:11px; color:var(--color-grey);">${item.quantity} ${item.unit}</span>
        </div>
      `).join('')
    : '<div class="empty-state">Todo el inventario está en orden. ✓</div>';

  container.innerHTML = `
    <div class="stat-grid">
      <div class="stat-card alert">
        <div class="stat-label">Stock bajo</div>
        <div class="stat-value">${data.low_stock_count}</div>
        <div class="stat-sub">productos</div>
      </div>
      <div class="stat-card info">
        <div class="stat-label">Total items</div>
        <div class="stat-value">${data.total_items || 0}</div>
        <div class="stat-sub">en inventario</div>
      </div>
    </div>

    ${alertHTML}

    <div class="section-header">
      <span class="section-title">Productos con stock bajo</span>
    </div>

    <div style="margin-bottom: var(--space-lg);">
      ${lowStockHTML}
    </div>

    <button class="btn btn-primary btn-full"
            onclick="document.querySelector('[data-screen=inventario]').click()">
      Ir a Inventario completo
    </button>

    <div class="footer-brand">Elevate your style.</div>
  `;
}