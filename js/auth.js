// =============================================================
// auth.js — Inklub Store Manager
// Authentication Logic
// =============================================================
// Handles login, logout, and session checking.
//
// CHANGE: No more session cookies. After login the token is
// saved to localStorage by api.js. This file just orchestrates
// the flow — checking status on load, handling the form, and
// redirecting between pages.
// =============================================================

import { checkAuthStatus, login, logout, clearToken } from './api.js';


// -------------------------------------------------------------
// initAuth()
// -------------------------------------------------------------
// Called once on page load from index.html.
// Checks if there's a valid token and shows the right screen.
// -------------------------------------------------------------
export async function initAuth() {
  try {
    const status = await checkAuthStatus();

    if (status.logged_in) {
      // Already have a valid token — go straight to the dashboard
      showApp();
    } else {
      // No valid token — show the login form
      showLogin();
    }
  } catch (error) {
    // If backend is unreachable, show login
    console.error('Error checking auth status:', error);
    showLogin();
  }
}


// -------------------------------------------------------------
// setupLoginForm()
// -------------------------------------------------------------
// Attaches the submit handler to the login form.
// Called once when the login screen is shown.
// -------------------------------------------------------------
export function setupLoginForm() {
  const form = document.getElementById('login-form');
  const input = document.getElementById('login-password');
  const errorMsg = document.getElementById('login-error');
  const submitBtn = document.getElementById('login-submit');

  if (!form) return;

  form.addEventListener('submit', async (e) => {
    // Prevent the browser from reloading the page on form submit
    e.preventDefault();

    const password = input.value.trim();

    if (!password) {
      showLoginError('Por favor ingresa tu contraseña.');
      return;
    }

    // Disable the button and show loading state while waiting
    submitBtn.textContent = 'Entrando...';
    submitBtn.disabled = true;
    errorMsg.classList.add('hidden');

    try {
      // api.js login() saves the token to localStorage automatically
      await login(password);
      showApp();
    } catch (error) {
      showLoginError('Contraseña incorrecta. Inténtalo de nuevo.');
      submitBtn.textContent = 'Entrar';
      submitBtn.disabled = false;
      input.value = '';
      input.focus();
    }
  });
}


// -------------------------------------------------------------
// setupLogoutButton()
// -------------------------------------------------------------
// Attaches the logout handler to the button in settings.
// Called by settings.js when the settings screen renders.
// -------------------------------------------------------------
export function setupLogoutButton() {
  const btn = document.getElementById('logout-btn');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    try {
      await logout();
    } catch (error) {
      // Even if the server call fails, clear the local token
      clearToken();
      console.error('Logout error:', error);
    }
    // Redirect to login page
    window.location.href = 'index.html';
  });
}


// -------------------------------------------------------------
// Helper functions
// -------------------------------------------------------------

// Redirect to the main app after successful login
function showApp() {
  window.location.href = 'dashboard.html';
}

// Show the login form (already on index.html, just set up the form)
function showLogin() {
  setupLoginForm();
}

// Show an error message on the login form
function showLoginError(message) {
  const errorMsg = document.getElementById('login-error');
  if (errorMsg) {
    errorMsg.textContent = message;
    errorMsg.classList.remove('hidden');
  }
}