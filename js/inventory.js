// =============================================================
// inventory.js — Inklub Store Manager
// Inventario Screen Logic
// =============================================================
// Handles everything on the Inventario screen:
//   - Loading and displaying inventory items
//   - Category filter chips
//   - Adding new categories dynamically
//   - Adding new items (regular units OR vinyl rolls)
//   - Updating item quantities / remaining inches
//   - Updating minimum stock thresholds
//   - Deleting items and categories
//
// VINYL ROLL SUPPORT:
// Items in categories with tracking_type = 'roll' are displayed
// and edited differently from regular unit items:
//   - Display: "85in / 120in" instead of "10 units"
//   - Add form: shows roll-specific fields (color, total, remaining)
//   - Edit prompt: asks for remaining inches instead of quantity
//   - Bar fill: based on remaining/total percentage
//   - Minimum: shown in inches instead of units
//
// The add form detects the category type automatically and
// switches between regular and roll fields dynamically.
// =============================================================

import {
  getInventory, addInventoryItem, updateItemQuantity,
  updateItemThreshold, deleteInventoryItem,
  getCategories, addCategory, deleteCategory
} from './api.js';


// Track the active category filter (null = show all)
let activeCategory = null;

// Store categories so forms can use them without re-fetching
let currentCategories = [];

// Store items for filtering without re-fetching
let currentItems = [];

// Track the current market so cancel/back buttons always
// know which market to return to
let currentMarket = null;


// -------------------------------------------------------------
// initInventory(marketId)
// -------------------------------------------------------------
// Entry point for the Inventario screen.
// Loads categories and items in parallel for speed.
// Called by dashboard.js whenever this screen is shown
// or the market toggle changes.
// -------------------------------------------------------------
export async function initInventory(marketId) {
  activeCategory = null;
  currentMarket = marketId;

  const container = document.getElementById('screen-inventario');
  if (!container) return;

  container.innerHTML = '<div class="loading">Cargando inventario...</div>';

  try {
    // Promise.all loads both at the same time — faster than sequential calls
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
// Builds the full inventory screen HTML and injects it.
// Called after data loads and after any update.
// Handles both regular items and vinyl roll items in the same list.
// -------------------------------------------------------------
function renderInventoryScreen(marketId) {
  currentMarket = marketId;
  const container = document.getElementById('screen-inventario');

  // Count stock issues — roll items use remaining_inches vs threshold,
  // regular items use quantity vs threshold
  const lowStockItems = currentItems.filter(i => {
    if (i.tracking_type === 'roll') {
      return i.remaining_inches > 0 && i.remaining_inches <= i.threshold;
    }
    return i.quantity > 0 && i.quantity <= i.threshold;
  });

  const outOfStockItems = currentItems.filter(i => {
    if (i.tracking_type === 'roll') return (i.remaining_inches || 0) === 0;
    return i.quantity === 0;
  });

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

  // Filter items by the active category chip
  const filteredItems = activeCategory
    ? currentItems.filter(i => i.category_id === activeCategory)
    : currentItems;

  // Build category filter chips — one per category
  const allChipActive = activeCategory === null ? 'active' : '';
  const categoryChipsHTML = currentCategories.map(cat => `
    <button class="btn btn-filter ${activeCategory === cat.id ? 'active' : ''}"
            onclick="window._invSetCategory(${cat.id}, '${marketId}')">
      ${cat.label}
    </button>
  `).join('');

  const itemsHTML = filteredItems.length > 0
    ? filteredItems.map(item => renderInventoryCard(item, marketId)).join('')
    : '<div class="empty-state">No hay productos en esta categoría.</div>';

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

  // Expose all action handlers on window so onclick attributes
  // in the injected HTML can call them (module functions aren't global)
  window._invSetCategory = (catId, market) => { activeCategory = catId; renderInventoryScreen(market); };
  window._invShowAddCategory = (market) => showAddCategoryForm(market);
  window._invShowAddItem = (market) => showAddItemForm(market);
  window._invUpdateQty = (itemId, market) => showUpdateStockForm(itemId, market);
  window._invUpdateMin = (itemId, market) => showUpdateThresholdForm(itemId, market);
  window._invDeleteItem = (itemId, market) => handleDeleteItem(itemId, market);
  // Cancel button handler — returns to inventory list
  window._invCancel = (market) => initInventory(market);
}


// -------------------------------------------------------------
// renderInventoryCard(item, marketId)
// -------------------------------------------------------------
// Returns the HTML for a single inventory card.
// Renders differently based on tracking_type:
//
// 'roll' items show:
//   - "85in / 120in" quantity display
//   - Bar fill based on remaining/total percentage
//   - Roll color badge
//   - "Actualizar rollo" button label
//   - Minimum shown in inches
//
// 'units' items show:
//   - "10 units" quantity display
//   - Bar fill based on qty vs threshold*3
//   - "Editar stock" button label
//   - Minimum shown in units
// -------------------------------------------------------------
function renderInventoryCard(item, marketId) {
  const isRoll = item.tracking_type === 'roll';

  // --- Determine stock status ---
  let status;
  if (isRoll) {
    const remaining = item.remaining_inches || 0;
    if (remaining === 0) status = 'out';
    else if (remaining <= item.threshold) status = 'low';
    else status = 'ok';
  } else {
    if (item.quantity === 0) status = 'out';
    else if (item.quantity <= item.threshold) status = 'low';
    else status = 'ok';
  }

  // --- Calculate progress bar fill percentage ---
  let fillPct;
  if (isRoll) {
    // For rolls: remaining / total * 100
    const total = item.total_inches || 0;
    const remaining = item.remaining_inches || 0;
    fillPct = total > 0 ? Math.min(Math.round((remaining / total) * 100), 100) : 0;
  } else {
    // For regular items: qty / (threshold * 3) as a reference max
    const maxRef = Math.max(item.threshold * 3, item.quantity);
    fillPct = maxRef > 0 ? Math.min(Math.round((item.quantity / maxRef) * 100), 100) : 0;
  }

  // --- Build quantity display label ---
  const qtyDisplay = isRoll
    ? `${item.remaining_inches || 0}in / ${item.total_inches || 0}in`
    : `${item.quantity} ${item.unit}`;

  // --- Build minimum display label ---
  const minDisplay = isRoll
    ? `${item.threshold} in`
    : `${item.threshold} ${item.unit}`;

  // --- Card CSS class based on stock status ---
  const cardClass = status === 'out'
    ? 'card out-of-stock'
    : status === 'low'
      ? 'card warning'
      : 'card';

  // --- Roll color badge (only for vinyl roll items) ---
  const colorLabel = isRoll && item.roll_color
    ? `<span class="inv-category" style="margin-left:4px;">${item.roll_color}</span>`
    : '';

  return `
    <div class="${cardClass}" id="inv-${item.id}">
      <div class="inv-card-top">
        <div class="inv-dot ${status}"></div>
        <span class="inv-name">${item.name}</span>
        <span class="inv-category">${item.category_label}</span>
        ${colorLabel}
      </div>

      <div class="inv-bar-row">
        <div class="inv-bar-track">
          <div class="inv-bar-fill ${status}" style="width: ${fillPct}%"></div>
        </div>
        <span class="inv-qty">${qtyDisplay}</span>
      </div>

      <div class="inv-minimum-row">
        <span class="inv-minimum-label">Mínimo:</span>
        <span class="inv-minimum-value">${minDisplay}</span>
      </div>

      <div class="card-actions">
        <button class="btn btn-primary"
                onclick="window._invUpdateQty(${item.id}, '${marketId}')">
          ${isRoll ? 'Actualizar rollo' : 'Editar stock'}
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
// showUpdateStockForm(itemId, marketId)
// -------------------------------------------------------------
// Shows a prompt to update stock.
// For roll items: asks for remaining inches
// For regular items: asks for new quantity
// Uses native browser prompt() for simplicity — works on mobile
// without needing a custom modal.
// -------------------------------------------------------------
async function showUpdateStockForm(itemId, marketId) {
  const item = currentItems.find(i => i.id === itemId);
  if (!item) return;

  const isRoll = item.tracking_type === 'roll';
  let newValue;

  if (isRoll) {
    // For rolls, ask how many inches remain after the latest use
    newValue = prompt(
      `Actualizar rollo "${item.name}"\n` +
      `Total del rollo: ${item.total_inches}in\n` +
      `Restante actual: ${item.remaining_inches}in\n\n` +
      `¿Cuántas pulgadas quedan ahora?`,
      item.remaining_inches
    );
  } else {
    newValue = prompt(
      `Actualizar stock de "${item.name}"\n` +
      `Cantidad actual: ${item.quantity} ${item.unit}\n\n` +
      `Nueva cantidad:`,
      item.quantity
    );
  }

  // User cancelled — null means they pressed Cancel
  if (newValue === null || newValue === '') return;

  const parsed = parseFloat(newValue);
  if (isNaN(parsed) || parsed < 0) {
    alert('Por favor ingresa un número válido (0 o más).');
    return;
  }

  try {
    if (isRoll) {
      // Pass remaining_inches for roll items
      await updateItemQuantity(itemId, null, parsed);
    } else {
      // Pass quantity for regular items
      await updateItemQuantity(itemId, parsed);
    }
    // Reload to reflect the updated values
    await initInventory(marketId);
  } catch (error) {
    alert('Error al actualizar. Inténtalo de nuevo.');
    console.error('Update stock error:', error);
  }
}


// -------------------------------------------------------------
// showUpdateThresholdForm(itemId, marketId)
// -------------------------------------------------------------
// Shows a prompt to update the minimum stock threshold.
// For roll items the threshold is in inches.
// For regular items it's in units.
// An email alert is sent when stock drops to or below this value.
// -------------------------------------------------------------
async function showUpdateThresholdForm(itemId, marketId) {
  const item = currentItems.find(i => i.id === itemId);
  if (!item) return;

  const isRoll = item.tracking_type === 'roll';
  const unit = isRoll ? 'pulgadas' : item.unit;

  const newThreshold = prompt(
    `Mínimo de "${item.name}"\n` +
    `Mínimo actual: ${item.threshold} ${unit}\n\n` +
    `Nuevo mínimo (recibirás una alerta cuando llegues a este número):`,
    item.threshold
  );

  if (newThreshold === null || newThreshold === '') return;

  const threshold = parseFloat(newThreshold);
  if (isNaN(threshold) || threshold < 0) {
    alert('Por favor ingresa un número válido.');
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
//
// The form dynamically shows different fields based on the
// selected category's tracking_type:
//   - 'units' → shows quantity + threshold fields
//   - 'roll'  → shows color, total inches, remaining, threshold
//
// The switch happens in real time via the onchange handler on
// the category select — window._invCategoryChanged().
// -------------------------------------------------------------
function showAddItemForm(marketId) {
  const container = document.getElementById('screen-inventario');

  // Build category options — embed tracking_type as data attribute
  // so the JS can read it when the user selects a category
  const categoryOptionsHTML = currentCategories.map(cat =>
    `<option value="${cat.id}" data-type="${cat.tracking_type}">${cat.label}</option>`
  ).join('');

  container.innerHTML = `
    <div class="form-card">
      <div class="form-title">Nuevo producto</div>

      <label class="field-label">Categoría</label>
      <select class="field-input" id="new-item-category"
              onchange="window._invCategoryChanged()">
        ${categoryOptionsHTML}
      </select>

      <label class="field-label">Nombre</label>
      <input class="field-input" id="new-item-name"
             placeholder="Ej. T-shirt Blanca, Vinilo Negro Rollo 1" />

      <!-- Regular unit fields — shown for non-roll categories -->
      <div id="regular-fields">
        <div class="field-row">
          <div>
            <label class="field-label">Cantidad inicial</label>
            <input class="field-input" id="new-item-qty"
                   type="number" min="0" value="0" />
          </div>
          <div>
            <label class="field-label">Mínimo (unidades)</label>
            <input class="field-input" id="new-item-threshold"
                   type="number" min="0" value="5" />
          </div>
        </div>
      </div>

      <!-- Vinyl roll fields — shown when a roll category is selected -->
      <div id="roll-fields" style="display:none;">
        <label class="field-label">Color del rollo</label>
        <input class="field-input" id="new-roll-color"
               placeholder="Ej. Negro, Rojo, Blanco, Dorado" />

        <div class="field-row">
          <div>
            <label class="field-label">Largo total (pulgadas)</label>
            <input class="field-input" id="new-roll-total"
                   type="number" min="0" step="0.5"
                   placeholder="Ej. 120" />
          </div>
          <div>
            <label class="field-label">Restante actual (in)</label>
            <input class="field-input" id="new-roll-remaining"
                   type="number" min="0" step="0.5"
                   placeholder="Igual al total si es nuevo" />
          </div>
        </div>

        <div class="field-row">
          <div>
            <label class="field-label">Mínimo (pulgadas)</label>
            <input class="field-input" id="new-roll-threshold"
                   type="number" min="0" value="12" />
          </div>
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

  // -------------------------------------------------------------
  // _invCategoryChanged — toggles roll vs regular fields
  // -------------------------------------------------------------
  // Reads the data-type attribute of the selected option and
  // shows/hides the appropriate field groups.
  // -------------------------------------------------------------
  window._invCategoryChanged = () => {
    const select = document.getElementById('new-item-category');
    const selected = select.options[select.selectedIndex];
    const isRoll = selected.dataset.type === 'roll';

    document.getElementById('regular-fields').style.display = isRoll ? 'none' : 'block';
    document.getElementById('roll-fields').style.display = isRoll ? 'block' : 'none';
  };

  // Trigger on load to set the correct initial state
  window._invCategoryChanged();

  // -------------------------------------------------------------
  // _invSaveNewItem — reads the form and calls the API
  // -------------------------------------------------------------
  window._invSaveNewItem = async (market) => {
    const select = document.getElementById('new-item-category');
    const selected = select.options[select.selectedIndex];
    const categoryId = parseInt(select.value);
    const isRoll = selected.dataset.type === 'roll';
    const name = document.getElementById('new-item-name').value.trim();

    if (!name) {
      alert('El nombre del producto es obligatorio.');
      return;
    }

    try {
      if (isRoll) {
        // --- Vinyl roll save ---
        const totalInches = parseFloat(document.getElementById('new-roll-total').value) || 0;
        const remainingInches = parseFloat(document.getElementById('new-roll-remaining').value) || totalInches;
        const threshold = parseFloat(document.getElementById('new-roll-threshold').value) || 12;
        const rollColor = document.getElementById('new-roll-color').value.trim();

        if (totalInches === 0) {
          alert('El largo total del rollo es obligatorio.');
          return;
        }

        await addInventoryItem({
          market_id: market,
          category_id: categoryId,
          name,
          roll_color: rollColor,
          total_inches: totalInches,
          remaining_inches: remainingInches,
          threshold
        });

      } else {
        // --- Regular item save ---
        const quantity = parseInt(document.getElementById('new-item-qty').value) || 0;
        const threshold = parseInt(document.getElementById('new-item-threshold').value) || 5;

        await addInventoryItem({
          market_id: market,
          category_id: categoryId,
          name,
          quantity,
          threshold
        });
      }

      // Return to inventory list after saving
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
// Uses browser prompts to collect the category name and type.
// Asks if it's a vinyl roll category — if yes, sets tracking_type
// to 'roll' and unit to 'in'. Otherwise uses units.
// -------------------------------------------------------------
async function showAddCategoryForm(marketId) {
  const label = prompt('Nombre de la nueva categoría:\n(Ej. Gorras, Ornamentos, Tote bags...)');
  if (!label || !label.trim()) return;

  // Ask if this is a vinyl roll category
  // confirm() returns true for OK, false for Cancel
  const isRoll = confirm(
    `¿"${label.trim()}" es una categoría de rollos de vinilo?\n\n` +
    `OK = Sí, se trackea por pulgadas\n` +
    `Cancelar = No, se trackea por unidades`
  );

  let unit;
  if (!isRoll) {
    unit = prompt(
      `Unidad para "${label.trim()}":\n(Ej. units, pcs, pairs)`,
      'units'
    );
    if (!unit) return;
  }

  try {
    await addCategory({
      label: label.trim(),
      unit: isRoll ? 'in' : unit.trim(),
      tracking_type: isRoll ? 'roll' : 'units'
    });
    // Reload so the new category chip appears immediately
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