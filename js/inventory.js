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
// =============================================================

import {
  getInventory,
  addInventoryItem,
  updateItemQuantity,
  updateItemThreshold,
  deleteInventoryItem,
  getCategories,
  addCategory,
  deleteCategory
} from './api.js';


// Track the active category filter
let activeCategory = null; // null = show all

// Store categories so we can use them in forms without re-fetching
let currentCategories = [];

// Store items for filtering without re-fetching
let currentItems = [];


// -------------------------------------------------------------
// initInventory(marketId)
// -------------------------------------------------------------
// Entry point for the Inventario screen.
// Loads both categories and items in parallel.
// -------------------------------------------------------------
export async function initInventory(marketId) {
  activeCategory = null;

  const container = document.getElementById('screen-inventario');
  if (!container) return;

  container.innerHTML = '<div class="loading">Cargando inventario...</div>';

  try {
    // Load categories and items at the same time for speed
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
// Builds the full inventory screen HTML.
// -------------------------------------------------------------
function renderInventoryScreen(marketId) {
  const container = document.getElementById('screen-inventario');

  // Count items with stock issues for the alert banner
  const lowStockItems = currentItems.filter(i => i.quantity > 0 && i.quantity <= i.threshold);
  const outOfStockItems = currentItems.filter(i => i.quantity === 0);

  // Build the alert banner if needed
  const alertHTML = (lowStockItems.length > 0 || outOfStockItems.length > 0) ? `
    <div class="alert-banner">
      <div class="alert-label">Alerta de stock</div>
      <div class="alert-text">
        ${outOfStockItems.length > 0 ? `${outOfStockItems.length} agotado(s). ` : ''}
        ${lowStockItems.length > 0 ? `${lowStockItems.length} con stock bajo.` : ''}
      </div>
    </div>
  ` : '';

  // Filter items based on active category
  const filteredItems = activeCategory
    ? currentItems.filter(i => i.category_id === activeCategory)
    : currentItems;

  // Build category filter chips
  const allChipActive = activeCategory === null ? 'active' : '';
  const categoryChipsHTML = currentCategories.map(cat => `
    <button class="btn btn-filter ${activeCategory === cat.id ? 'active' : ''}"
            onclick="window._invSetCategory(${cat.id}, '${marketId}')">
      ${cat.label}
    </button>
  `).join('');

  // Build items list
  const itemsHTML = filteredItems.length > 0
    ? filteredItems.map(item => renderInventoryCard(item, marketId)).join('')
    : '<div class="empty-state">No hay productos en esta categoría.</div>';

  // Active category label for section title
  const activeCatLabel = activeCategory
    ? currentCategories.find(c => c.id === activeCategory)?.label || 'Productos'
    : 'Todos los productos';

  container.innerHTML = `
    ${alertHTML}

    <div class="toolbar">
      <button class="btn btn-filter ${allChipActive}"
              onclick="window._invSetCategory(null, '${marketId}')">
        Todo
      </button>
      ${categoryChipsHTML}
      <button class="btn btn-dashed"
              onclick="window._invShowAddCategory('${marketId}')">
        + Categoría
      </button>
      <button class="btn btn-secondary ml-auto"
              onclick="window._invShowAddItem('${marketId}')">
        + Agregar
      </button>
    </div>

    <div class="section-title mb-sm">${activeCatLabel} — ${filteredItems.length} productos</div>

    ${itemsHTML}

    <div class="footer-brand">Elevate your style.</div>
  `;

  // Expose handlers on window
  window._invSetCategory     = (catId, market) => { activeCategory = catId; renderInventoryScreen(market); };
  window._invShowAddCategory = (market) => showAddCategoryForm(market);
  window._invShowAddItem     = (market) => showAddItemForm(market);
  window._invUpdateQty       = (itemId, market) => showUpdateQuantityForm(itemId, market);
  window._invUpdateMin       = (itemId, market) => showUpdateThresholdForm(itemId, market);
  window._invDeleteItem      = (itemId, market) => handleDeleteItem(itemId, market);
  window._invDeleteCategory  = (catId, market) => handleDeleteCategory(catId, market);
}


// -------------------------------------------------------------
// renderInventoryCard(item, marketId)
// -------------------------------------------------------------
// Returns HTML for a single inventory item card.
// Stock status (ok/low/out) determines dot color and bar fill.
// -------------------------------------------------------------
function renderInventoryCard(item, marketId) {
  // Determine stock status
  let status;
  if (item.quantity === 0) {
    status = 'out';
  } else if (item.quantity <= item.threshold) {
    status = 'low';
  } else {
    status = 'ok';
  }

  // Calculate bar fill percentage (capped at 100%)
  // We use threshold * 3 as the "full" reference point so the bar
  // makes visual sense even for items with small max quantities
  const maxRef = Math.max(item.threshold * 3, item.quantity);
  const fillPct = maxRef > 0 ? Math.min(Math.round((item.quantity / maxRef) * 100), 100) : 0;

  // Add warning/out-of-stock card styling
  const cardClass = status === 'out' ? 'card out-of-stock' : status === 'low' ? 'card warning' : 'card';

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
// Shows a simple prompt to update the quantity of an item.
// Uses the browser's built-in prompt for simplicity — fast
// and doesn't require a modal component.
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
    // Reload inventory to reflect the change
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
              onclick="window.initInventory && window.initInventory('${marketId}')">
        Cancelar
      </button>
    </div>
  `;

  window._invSaveNewItem = async (market) => {
    const categoryId = parseInt(document.getElementById('new-item-category').value);
    const name       = document.getElementById('new-item-name').value.trim();
    const quantity   = parseInt(document.getElementById('new-item-qty').value) || 0;
    const threshold  = parseInt(document.getElementById('new-item-threshold').value) || 5;

    if (!name) {
      alert('El nombre del producto es obligatorio.');
      return;
    }

    try {
      await addInventoryItem({ market_id: market, category_id: categoryId, name, quantity, threshold });
      await initInventory(market);
    } catch (error) {
      alert('Error al guardar el producto.');
      console.error('Add item error:', error);
    }
  };

  // Re-expose initInventory globally so the cancel button can call it
  window.initInventory = initInventory;
}


// -------------------------------------------------------------
// showAddCategoryForm(marketId)
// -------------------------------------------------------------
// Shows a prompt to add a new category.
// -------------------------------------------------------------
async function showAddCategoryForm(marketId) {
  const label = prompt('Nombre de la nueva categoría:\n(Ej. Gorras, Ornamentos, Tote bags...)');
  if (!label || !label.trim()) return;

  // Ask for the unit label
  const unit = prompt(
    `Unidad para "${label.trim()}":\n(Ej. units, pcs, sheets, pairs)\n\nEscribe la unidad:`,
    'units'
  );

  if (!unit) return;

  try {
    await addCategory({ label: label.trim(), unit: unit.trim() });
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
async function handleDeleteItem(itemId, marketId) {
  const item = currentItems.find(i => i.id === itemId);
  const name = item ? item.name : 'este producto';

  const confirmed = confirm(`¿Segura que quieres eliminar "${name}"?`);
  if (!confirmed) return;

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
async function handleDeleteCategory(categoryId, marketId) {
  const cat = currentCategories.find(c => c.id === categoryId);
  const name = cat ? cat.label : 'esta categoría';

  const confirmed = confirm(`¿Segura que quieres eliminar "${name}"?\n\nSolo puedes eliminarla si no tiene productos asignados.`);
  if (!confirmed) return;

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
