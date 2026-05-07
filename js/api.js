// =============================================================
// api.js — Inklub Store Manager
// API Communication Module
// =============================================================
// Handles ALL communication with the Flask backend.
//
// CHANGE FROM COOKIE TO TOKEN AUTH:
// Previously we used credentials: 'include' to send session cookies.
// Safari blocks cross-origin cookies, so she couldn't log in on iPhone
// or Mac. Now we store the token in localStorage and send it as an
// Authorization header with every request — works on all browsers.
//
// WHY ONE FILE:
// If the backend URL ever changes, update BASE_URL here and
// everything else keeps working automatically.
// =============================================================

const BASE_URL = 'https://inklub-manager.onrender.com';


// -------------------------------------------------------------
// getToken() / saveToken() / clearToken()
// -------------------------------------------------------------
// Helper functions for reading and writing the auth token
// in localStorage. All auth logic goes through these so
// there's only one place to change if storage ever moves.
// -------------------------------------------------------------
function getToken() {
  return localStorage.getItem('inklub_token');
}

export function saveToken(token) {
  localStorage.setItem('inklub_token', token);
}

export function clearToken() {
  localStorage.removeItem('inklub_token');
}


// -------------------------------------------------------------
// request() — core fetch wrapper
// -------------------------------------------------------------
// All API calls go through this function. It:
//   - Adds the correct Content-Type header
//   - Adds the Authorization header with the stored token
//   - Handles errors consistently
//   - Returns parsed JSON or throws a readable error
// -------------------------------------------------------------
async function request(method, path, body = null) {
  const headers = {
    'Content-Type': 'application/json',
  };

  // Attach the token if we have one.
  // The backend's require_auth decorator reads this header.
  const token = getToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const options = {
    method,
    headers,
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

// Check if the current token is still valid.
// Called on page load to decide whether to show login or dashboard.
export async function checkAuthStatus() {
  return request('GET', '/auth/status');
}

// Log in with the admin password.
// On success, saves the returned token to localStorage.
export async function login(password) {
  const data = await request('POST', '/auth/login', { password });
  // Save the token so all subsequent requests are authenticated
  if (data.token) {
    saveToken(data.token);
  }
  return data;
}

// Log out — deletes the token from the DB and clears localStorage.
export async function logout() {
  try {
    await request('POST', '/auth/logout');
  } finally {
    // Always clear the local token even if the server call fails
    clearToken();
  }
}


// =============================================================
// DASHBOARD
// =============================================================

export async function getDashboard(marketId) {
  return request('GET', `/api/dashboard/${marketId}`);
}

// =============================================================
// INVENTORY
// =============================================================

export async function getInventory(marketId, categoryId = null) {
  const query = categoryId ? `?category_id=${categoryId}` : '';
  return request('GET', `/api/inventory/${marketId}${query}`);
}

export async function addInventoryItem(itemData) {
  return request('POST', '/api/inventory', itemData);
}

export async function updateItemQuantity(itemId, quantity) {
  return request('PATCH', `/api/inventory/${itemId}/quantity`, { quantity });
}

export async function updateItemThreshold(itemId, threshold) {
  return request('PATCH', `/api/inventory/${itemId}/threshold`, { threshold });
}

export async function deleteInventoryItem(itemId) {
  return request('DELETE', `/api/inventory/${itemId}`);
}

export async function getCategories() {
  return request('GET', '/api/inventory/categories');
}

export async function addCategory(categoryData) {
  return request('POST', '/api/inventory/categories', categoryData);
}

export async function deleteCategory(categoryId) {
  return request('DELETE', `/api/inventory/categories/${categoryId}`);
}

// =============================================================
// SETTINGS
// =============================================================

export async function getSettings() {
  return request('GET', '/api/settings');
}

export async function updateSettings(settingsData) {
  return request('PATCH', '/api/settings', settingsData);
}