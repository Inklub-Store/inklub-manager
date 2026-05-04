// =============================================================
// api.js — Inklub Store Manager
// API Communication Module
// =============================================================
// This file handles ALL communication with the Flask backend.
// Every other JS file imports functions from here — no other
// file should ever call fetch() directly.
//
// WHY THIS MATTERS:
// If the backend URL ever changes (e.g. new Render service),
// you only need to update BASE_URL in ONE place here, and
// everything else keeps working automatically.
// =============================================================


// -------------------------------------------------------------
// BASE URL
// -------------------------------------------------------------
// This is the URL of the Flask backend on Render.
// Change this if you ever redeploy to a new Render service.
// During local development, change this to http://127.0.0.1:5000
// -------------------------------------------------------------
const BASE_URL = 'https://inklub-manager.onrender.com';


// -------------------------------------------------------------
// request() — core fetch wrapper
// -------------------------------------------------------------
// All API calls go through this function. It:
//   - Adds the correct headers (JSON content type)
//   - Includes credentials (session cookie for auth)
//   - Handles errors consistently
//   - Returns parsed JSON or throws a readable error
//
// You don't call this directly — use the specific functions below.
// -------------------------------------------------------------
async function request(method, path, body = null) {
  const options = {
    method,
    // 'include' means the browser sends the session cookie with every request.
    // This is how the backend knows who is logged in.
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
  };

  // Only attach a body for POST / PATCH / PUT requests
  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`${BASE_URL}${path}`, options);
  const data = await response.json();

  // If the server returned an error status, throw it so the
  // calling code can catch it and show a user-friendly message
  if (!response.ok) {
    throw new Error(data.error || `Error ${response.status}`);
  }

  return data;
}


// =============================================================
// AUTH
// =============================================================

// Check if the current browser session is logged in.
// Called on page load to decide whether to show login or dashboard.
export async function checkAuthStatus() {
  return request('GET', '/auth/status');
}

// Log in with the admin password.
// Returns { message: "Login successful." } or throws an error.
export async function login(password) {
  return request('POST', '/auth/login', { password });
}

// Log out — clears the session cookie.
export async function logout() {
  return request('POST', '/auth/logout');
}


// =============================================================
// DASHBOARD
// =============================================================

// Get all summary stats for one market.
// marketId is 'ca' or 'pa'.
// Returns: { open_orders, unpaid, revenue, ready, low_stock_count,
//            low_stock_items, market }
export async function getDashboard(marketId) {
  return request('GET', `/api/dashboard/${marketId}`);
}


// =============================================================
// ORDERS
// =============================================================

// Get all active (non-delivered) orders for a market.
export async function getOrders(marketId) {
  return request('GET', `/api/orders/${marketId}`);
}

// Get delivered orders (the archive) for a market.
export async function getOrderArchive(marketId) {
  return request('GET', `/api/orders/${marketId}/archive`);
}

// Create a new order.
// orderData should include: market_id, customer_name, product,
// and optionally: customer_contact, quantity, unit_price, notes
export async function createOrder(orderData) {
  return request('POST', '/api/orders', orderData);
}

// Update the production or payment status of an order.
// statusData can include: production_status and/or payment_status
// Example: { production_status: 'ready' }
// Example: { payment_status: 'paid' }
export async function updateOrderStatus(orderId, statusData) {
  return request('PATCH', `/api/orders/${orderId}/status`, statusData);
}

// Delete an order permanently.
export async function deleteOrder(orderId) {
  return request('DELETE', `/api/orders/${orderId}`);
}


// =============================================================
// INVENTORY
// =============================================================

// Get all inventory items for a market.
// Optionally pass a categoryId to filter by category.
export async function getInventory(marketId, categoryId = null) {
  const query = categoryId ? `?category_id=${categoryId}` : '';
  return request('GET', `/api/inventory/${marketId}${query}`);
}

// Add a new inventory item.
// itemData should include: market_id, category_id, name, quantity
// and optionally: threshold
export async function addInventoryItem(itemData) {
  return request('POST', '/api/inventory', itemData);
}

// Update the quantity of an inventory item (e.g. after restocking).
export async function updateItemQuantity(itemId, quantity) {
  return request('PATCH', `/api/inventory/${itemId}/quantity`, { quantity });
}

// Update the minimum stock threshold for an item.
// When quantity drops to or below this number, an alert email is sent.
export async function updateItemThreshold(itemId, threshold) {
  return request('PATCH', `/api/inventory/${itemId}/threshold`, { threshold });
}

// Delete an inventory item permanently.
export async function deleteInventoryItem(itemId) {
  return request('DELETE', `/api/inventory/${itemId}`);
}

// Get all categories (used to populate filter chips and add-item form).
export async function getCategories() {
  return request('GET', '/api/inventory/categories');
}

// Add a new category (e.g. "Gorras", "Ornamentos").
// categoryData should include: label, unit
export async function addCategory(categoryData) {
  return request('POST', '/api/inventory/categories', categoryData);
}

// Delete a category.
// Will fail if any inventory items still use this category.
export async function deleteCategory(categoryId) {
  return request('DELETE', `/api/inventory/categories/${categoryId}`);
}


// =============================================================
// CUSTOMERS
// =============================================================

// Get all customers for a market, with order stats.
export async function getCustomers(marketId) {
  return request('GET', `/api/customers/${marketId}`);
}

// Get all orders for a specific customer.
// Used in the customer detail / history view.
export async function getCustomerOrders(customerId) {
  return request('GET', `/api/customers/${customerId}/orders`);
}

// Update the notes for a customer (sizes, preferences, etc.)
export async function updateCustomerNotes(customerId, notes) {
  return request('PATCH', `/api/customers/${customerId}/notes`, { notes });
}


// =============================================================
// SETTINGS
// =============================================================

// Get all app settings as a key-value object.
// Returns: { notification_email: { value, label }, ... }
export async function getSettings() {
  return request('GET', '/api/settings');
}

// Update one or more settings.
// settingsData is an object of key: value pairs.
// Example: { notification_email: 'new@email.com' }
export async function updateSettings(settingsData) {
  return request('PATCH', '/api/settings', settingsData);
}
