// =============================================================
// auth.js — Inklub Store Manager
// Authentication Logic
// =============================================================
// Handles the login screen and session management.
//
// HOW IT WORKS:
// 1. When the page loads, checkAuthStatus() is called.
// 2. If logged in → show the main dashboard app.
// 3. If not logged in → show the login screen.
// 4. On login form submit → call login() and redirect.
// 5. On logout → call logout() and reload to show login.
// =============================================================

import { checkAuthStatus, login, logout } from './api.js';


// -------------------------------------------------------------
// initAuth()
// -------------------------------------------------------------
// Called once on page load. Checks if the user is already
// logged in and shows the correct screen.
// -------------------------------------------------------------
export async function initAuth() {
  try {
    const status = await checkAuthStatus();

    if (status.logged_in) {
      // Already logged in — show the main app
      showApp();
    } else {
      // Not logged in — show the login screen
      showLogin();
    }
  } catch (error) {
    // If the backend is unreachable, show login with an error
    console.error('Error checking auth status:', error);
    showLogin();
  }
}


// -------------------------------------------------------------
// setupLoginForm()
// -------------------------------------------------------------
// Attaches the submit handler to the login form.
// Called once when the login screen is rendered.
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
      await login(password);
      // Login successful — show the main app
      showApp();
    } catch (error) {
      // Wrong password or server error
      showLoginError('Contraseña incorrecta. Inténtalo de nuevo.');
      submitBtn.textContent = 'Entrar';
      submitBtn.disabled = false;
      input.value = '';
      input.focus();
    }
  });

  // Allow submitting with Enter key
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      form.dispatchEvent(new Event('submit'));
    }
  });
}


// -------------------------------------------------------------
// setupLogoutButton()
// -------------------------------------------------------------
// Attaches the logout handler. Called once when the settings
// screen is rendered.
// -------------------------------------------------------------
export function setupLogoutButton() {
  const btn = document.getElementById('logout-btn');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    try {
      await logout();
    } catch (error) {
      // Even if the logout API call fails, we still want to
      // show the login screen — the session will expire anyway
      console.error('Logout error:', error);
    }
    // Reload the page — initAuth() will run again and show login
    window.location.reload();
  });
}


// -------------------------------------------------------------
// Helper functions
// -------------------------------------------------------------

// Show the main app — redirects to dashboard.html
// Since login (index.html) and the app (dashboard.html) are separate
// files, we use a simple redirect instead of showing/hiding divs.
function showApp() {
  window.location.href = 'dashboard.html';
}

// Show the login screen — redirects to index.html
// Called when the user is not logged in or after logout.
function showLogin() {
  // If we're already on index.html, just set up the form
  if (window.location.pathname.endsWith('index.html') ||
    window.location.pathname === '/' ||
    window.location.pathname === '') {
    setupLoginForm();
  } else {
    // We're on dashboard.html — redirect to login
    window.location.href = 'index.html';
  }
}

// Show an error message on the login form
function showLoginError(message) {
  const errorMsg = document.getElementById('login-error');
  if (errorMsg) {
    errorMsg.textContent = message;
    errorMsg.classList.remove('hidden');
  }
}