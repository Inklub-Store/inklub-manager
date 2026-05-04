// =============================================================
// inventory.js — Inklub Store Manager
// Inventario Screen Logic
// =============================================================
// Handles everything on the Inventario screen:
//   - Loading and displaying inventory items
//   - Category filter chips
//   - Adding new categories dynamically
//   - Updating item quantities
//   - Updating minimum stock thresholds
//   - Adding and deleting items
//
// FIX: Cancel button in add item form now correctly calls
// window._invCancel instead of window.initInventory, which
// was never exposed as a global and caused a silent failure.
// Also added currentMarket variable so all handlers always
// know which market is active without needing it passed in.
// =============================================================

import {
  getInventory, addInventoryItem, updateItemQuantity,
  updateItemThreshold, deleteInventoryItem,
  getCategories, addCategory, deleteCategory
} from './api.js';


// Track the active category filter (null = show all categories)
let activeCategory = null;

// Store categories so we can use them in forms without re-fetching
let currentCategories = [];

// Store items for filtering without re-fetching
let currentItems = [];

// Track the current market so cancel buttons and back buttons
// always know which market to return to without it being passed in
let currentMarket = null;


// -------------------------------------------------------------
// initInventory(marketId)
// -------------------------------------------------------------
// Entry point for the Inventario screen.
// Loads both categories and items in parallel for speed.
// Called by dashboard.js whenever this screen is shown
// or the market toggle changes.
// -------------------------------------------------------------
export async function initInventory(marketId) {
  activeCategory = null;
  currentMarket = marketId;  // Store so cancel buttons can use it

  const container = document.getElementById('screen-inventario');
  if (!container) return;

  container.innerHTML = '<div class="loading">Cargando inventario...</div>';

  try {
    // Promise.all loads both at the same time — faster than two sequential calls
    [currentCategories, currentItems] = await Promise.all([
      getCategories(),
      getInventory(marketId)
    ]);

    renderInventoryScreen(marketId);
  } catch (error) {
    container.innerHTML = '<div class="empty-state">Error al cargar el inventario.</div>';
    console.error('Inventory error:', error);
  }
}


// -------------------------------------------------------------
// renderInventoryScreen(marketId)
// -------------------------------------------------------------
// Builds the full inventory screen HTML and injects it into
// the screen container. Called after data loads and after
// any update (quantity change, new item, etc.).
// -------------------------------------------------------------
function renderInventoryScreen(marketId) {
  currentMarket = marketId;
  const container = document.getElementById('screen-inventario');

  // Count items with stock issues for the alert banner
  const lowStockItems = currentItems.filter(i => i.quantity > 0 && i.quantity <= i.threshold);
  const outOfStockItems = currentItems.filter(i => i.quantity === 0);

  // Build the alert banner — only shown if there are stock issues
  const alertHTML = (lowStockItems.length > 0 || outOfStockItems.length > 0) ? `
    <div class="alert-banner">
      <div class="alert-label">Alerta de stock</div>
      <div class="alert-text">
        ${outOfStockItems.length > 0 ? `${outOfStockItems.length} agotado(s). ` : ''}
        ${lowStockItems.length > 0 ? `${lowStockItems.length} con stock bajo.` : ''}
      </div>
    </div>
  ` : '';

  // Filter items based on the active category chip
  const filteredItems = activeCategory
    ? currentItems.filter(i => i.category_id === activeCategory)
    : currentItems;

  // Build category filter chips — one per category from the database
  const allChipActive = activeCategory === null ? 'active' : '';
  const categoryChipsHTML = currentCategories.map(cat => `
    <button class="btn btn-filter ${activeCategory === cat.id ? 'active' : ''}"
            onclick="window._invSetCategory(${cat.id}, '${marketId}')">
      ${cat.label}
    </button>
  `).join('');

  // Build the items list or empty state
  const itemsHTML = filteredItems.length > 0
    ? filteredItems.map(item => renderInventoryCard(item, marketId)).join('')
    : '<div class="empty-state">No hay productos en esta categoría.</div>';

  // Section title changes based on the active filter
  const activeCatLabel = activeCategory
    ? currentCategories.find(c => c.id === activeCategory)?.label || 'Productos'
    : 'Todos los productos';

  container.innerHTML = `
    ${alertHTML}

    <div class="toolbar">
      <button class="btn btn-filter ${allChipActive}"
              onclick="window._invSetCategory(null, '${marketId}')">Todo</button>
      ${categoryChipsHTML}
      <button class="btn btn-dashed"
              onclick="window._invShowAddCategory('${marketId}')">+ Categoría</button>
      <button class="btn btn-secondary ml-auto"
              onclick="window._invShowAddItem('${marketId}')">+ Agregar</button>
    </div>

    <div class="section-title mb-sm">${activeCatLabel} — ${filteredItems.length} productos</div>

    ${itemsHTML}

    <div class="footer-brand">Elevate your style.</div>
  `;

  // Expose all action handlers on window so onclick attributes in the
  // injected HTML can call them (module functions aren't global by default)
  window._invSetCategory = (catId, market) => { activeCategory = catId; renderInventoryScreen(market); };
  window._invShowAddCategory = (market) => showAddCategoryForm(market);
  window._invShowAddItem = (market) => showAddItemForm(market);
  window._invUpdateQty = (itemId, market) => showUpdateQuantityForm(itemId, market);
  window._invUpdateMin = (itemId, market) => showUpdateThresholdForm(itemId, market);
  window._invDeleteItem = (itemId, market) => handleDeleteItem(itemId, market);
  // Fixed: cancel button calls this instead of window.initInventory
  // which was never exposed as a global
  window._invCancel = (market) => initInventory(market);
}


// -------------------------------------------------------------
// renderInventoryCard(item, marketId)
// -------------------------------------------------------------
// Returns the HTML string for a single inventory item card.
// Stock status (ok/low/out) determines dot color, bar fill,
// and card background.
// -------------------------------------------------------------
function renderInventoryCard(item, marketId) {
  // Determine stock status based on quantity vs threshold
  let status;
  if (item.quantity === 0) status = 'out';
  else if (item.quantity <= item.threshold) status = 'low';
  else status = 'ok';

  // Calculate bar fill percentage.
  // We use threshold * 3 as the "full" reference point so the bar
  // makes visual sense even for items with small max quantities.
  const maxRef = Math.max(item.threshold * 3, item.quantity);
  const fillPct = maxRef > 0 ? Math.min(Math.round((item.quantity / maxRef) * 100), 100) : 0;

  // Card gets extra styling for warning/out-of-stock states
  const cardClass = status === 'out'
    ? 'card out-of-stock'
    : status === 'low'
      ? 'card warning'
      : 'card';

  return `
    <div class="${cardClass}" id="inv-${item.id}">
      <div class="inv-card-top">
        <div class="inv-dot ${status}"></div>
        <span class="inv-name">${item.name}</span>
        <span class="inv-category">${item.category_label}</span>
      </div>

      <div class="inv-bar-row">
        <div class="inv-bar-track">
          <div class="inv-bar-fill ${status}" style="width: ${fillPct}%"></div>
        </div>
        <span class="inv-qty">${item.quantity} ${item.unit}</span>
      </div>

      <div class="inv-minimum-row">
        <span class="inv-minimum-label">Mínimo:</span>
        <span class="inv-minimum-value">${item.threshold} ${item.unit}</span>
      </div>

      <div class="card-actions">
        <button class="btn btn-primary"
                onclick="window._invUpdateQty(${item.id}, '${marketId}')">
          Editar stock
        </button>
        <button class="btn btn-secondary"
                onclick="window._invUpdateMin(${item.id}, '${marketId}')">
          Mínimo
        </button>
        <button class="btn btn-danger"
                onclick="window._invDeleteItem(${item.id}, '${marketId}')">
          Eliminar
        </button>
      </div>
    </div>
  `;
}


// -------------------------------------------------------------
// showUpdateQuantityForm(itemId, marketId)
// -------------------------------------------------------------
// Shows a browser prompt to update the quantity of an item.
// We use the native prompt() for simplicity — it works on mobile
// without needing a custom modal component.
// -------------------------------------------------------------
async function showUpdateQuantityForm(itemId, marketId) {
  const item = currentItems.find(i => i.id === itemId);
  if (!item) return;

  const newQty = prompt(
    `Actualizar stock de "${item.name}"\nCantidad actual: ${item.quantity} ${item.unit}\n\nNueva cantidad:`,
    item.quantity
  );

  // User cancelled or entered nothing
  if (newQty === null || newQty === '') return;

  const quantity = parseInt(newQty);
  if (isNaN(quantity) || quantity < 0) {
    alert('Por favor ingresa un número válido (0 o más).');
    return;
  }

  try {
    await updateItemQuantity(itemId, quantity);
    // Reload the full inventory screen to reflect the change
    await initInventory(marketId);
  } catch (error) {
    alert('Error al actualizar el stock. Inténtalo de nuevo.');
    console.error('Update quantity error:', error);
  }
}


// -------------------------------------------------------------
// showUpdateThresholdForm(itemId, marketId)
// -------------------------------------------------------------
// Shows a prompt to update the minimum stock threshold.
// When quantity drops to or below this number, an alert email is sent.
// -------------------------------------------------------------
async function showUpdateThresholdForm(itemId, marketId) {
  const item = currentItems.find(i => i.id === itemId);
  if (!item) return;

  const newThreshold = prompt(
    `Mínimo de "${item.name}"\nMínimo actual: ${item.threshold} ${item.unit}\n\nNuevo mínimo (recibirás una alerta cuando llegues a este número):`,
    item.threshold
  );

  if (newThreshold === null || newThreshold === '') return;

  const threshold = parseInt(newThreshold);
  if (isNaN(threshold) || threshold < 0) {
    alert('Por favor ingresa un número válido (0 o más).');
    return;
  }

  try {
    await updateItemThreshold(itemId, threshold);
    await initInventory(marketId);
  } catch (error) {
    alert('Error al actualizar el mínimo.');
    console.error('Update threshold error:', error);
  }
}


// -------------------------------------------------------------
// showAddItemForm(marketId)
// -------------------------------------------------------------
// Replaces the inventory screen with a form to add a new item.
// The cancel button uses window._invCancel which correctly
// calls initInventory() to go back.
// -------------------------------------------------------------
function showAddItemForm(marketId) {
  const container = document.getElementById('screen-inventario');

  // Build category options for the select dropdown
  const categoryOptionsHTML = currentCategories.map(cat =>
    `<option value="${cat.id}">${cat.label} (${cat.unit})</option>`
  ).join('');

  container.innerHTML = `
    <div class="form-card">
      <div class="form-title">Nuevo producto</div>

      <label class="field-label">Categoría</label>
      <select class="field-input" id="new-item-category">
        ${categoryOptionsHTML}
      </select>

      <label class="field-label">Nombre del producto</label>
      <input class="field-input" id="new-item-name"
             placeholder="Ej. Vinilo — dorado" />

      <div class="field-row">
        <div>
          <label class="field-label">Cantidad inicial</label>
          <input class="field-input" id="new-item-qty"
                 type="number" min="0" value="0" />
        </div>
        <div>
          <label class="field-label">Mínimo (alerta)</label>
          <input class="field-input" id="new-item-threshold"
                 type="number" min="0" value="5" />
        </div>
      </div>
    </div>

    <div class="flex gap-sm mt-md">
      <button class="btn btn-primary flex-1"
              onclick="window._invSaveNewItem('${marketId}')">
        Guardar producto
      </button>
      <button class="btn btn-secondary"
              onclick="window._invCancel('${marketId}')">
        Cancelar
      </button>
    </div>
  `;

  // Save handler — reads the form values and calls the API
  window._invSaveNewItem = async (market) => {
    const categoryId = parseInt(document.getElementById('new-item-category').value);
    const name = document.getElementById('new-item-name').value.trim();
    const quantity = parseInt(document.getElementById('new-item-qty').value) || 0;
    const threshold = parseInt(document.getElementById('new-item-threshold').value) || 5;

    if (!name) {
      alert('El nombre del producto es obligatorio.');
      return;
    }

    try {
      await addInventoryItem({
        market_id: market,
        category_id: categoryId,
        name,
        quantity,
        threshold
      });
      // Return to the inventory list after saving
      await initInventory(market);
    } catch (error) {
      alert('Error al guardar el producto.');
      console.error('Add item error:', error);
    }
  };
}


// -------------------------------------------------------------
// showAddCategoryForm(marketId)
// -------------------------------------------------------------
// Uses browser prompts to collect the category name and unit.
// No custom modal needed — keeps things simple for a first version.
// -------------------------------------------------------------
async function showAddCategoryForm(marketId) {
  const label = prompt('Nombre de la nueva categoría:\n(Ej. Gorras, Ornamentos, Tote bags...)');
  if (!label || !label.trim()) return;

  const unit = prompt(
    `Unidad para "${label.trim()}":\n(Ej. units, pcs, sheets, pairs)\n\nEscribe la unidad:`,
    'units'
  );
  if (!unit) return;

  try {
    await addCategory({ label: label.trim(), unit: unit.trim() });
    // Reload the screen so the new category chip appears
    await initInventory(marketId);
  } catch (error) {
    if (error.message.includes('already exists')) {
      alert('Ya existe una categoría con ese nombre.');
    } else {
      alert('Error al crear la categoría.');
    }
    console.error('Add category error:', error);
  }
}


// -------------------------------------------------------------
// handleDeleteItem(itemId, marketId)
// -------------------------------------------------------------
// Asks for confirmation before permanently deleting an item.
// -------------------------------------------------------------
async function handleDeleteItem(itemId, marketId) {
  const item = currentItems.find(i => i.id === itemId);
  const name = item ? item.name : 'este producto';

  if (!confirm(`¿Segura que quieres eliminar "${name}"?`)) return;

  try {
    await deleteInventoryItem(itemId);
    await initInventory(marketId);
  } catch (error) {
    alert('Error al eliminar el producto.');
    console.error('Delete item error:', error);
  }
}


// -------------------------------------------------------------
// handleDeleteCategory(categoryId, marketId)
// -------------------------------------------------------------
// Deletes a category. The backend will reject this if any
// inventory items still use the category — we show a helpful
// error message in that case.
// -------------------------------------------------------------
async function handleDeleteCategory(categoryId, marketId) {
  const cat = currentCategories.find(c => c.id === categoryId);
  const name = cat ? cat.label : 'esta categoría';

  if (!confirm(`¿Segura que quieres eliminar "${name}"?\n\nSolo puedes eliminarla si no tiene productos asignados.`)) return;

  try {
    await deleteCategory(categoryId);
    await initInventory(marketId);
  } catch (error) {
    if (error.message.includes('Cannot delete')) {
      alert('No puedes eliminar esta categoría porque tiene productos asignados. Elimina o mueve los productos primero.');
    } else {
      alert('Error al eliminar la categoría.');
    }
    console.error('Delete category error:', error);
  }
}