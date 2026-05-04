// =============================================================
// settings.js — Inklub Store Manager
// Configuración Screen Logic
// =============================================================
// Handles the settings screen — loading and updating:
//   - Notification email
//   - Default minimum stock threshold
//   - Market labels (currency, payment method)
// =============================================================

import { getSettings, updateSettings } from './api.js';


// -------------------------------------------------------------
// initSettings()
// -------------------------------------------------------------
export async function initSettings() {
  const container = document.getElementById('screen-settings');
  if (!container) return;

  container.innerHTML = '<div class="loading">Cargando configuración...</div>';

  try {
    const settings = await getSettings();
    renderSettingsScreen(settings);
  } catch (error) {
    container.innerHTML = '<div class="empty-state">Error al cargar la configuración.</div>';
    console.error('Settings error:', error);
  }
}


// -------------------------------------------------------------
// renderSettingsScreen(settings)
// -------------------------------------------------------------
function renderSettingsScreen(settings) {
  const container = document.getElementById('screen-settings');

  // Helper to get a setting value safely
  const val = (key) => settings[key]?.value || '—';

  container.innerHTML = `

    <div class="settings-section">
      <div class="settings-section-label">Notificaciones</div>

      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-name">Correo de alertas</div>
          <div class="setting-desc">Recibes alertas de stock bajo aquí</div>
        </div>
        <div class="setting-value">${val('notification_email')}</div>
        <button class="btn btn-secondary"
                onclick="window._settingsEdit('notification_email', 'Correo de alertas', '${val('notification_email')}')">
          Editar
        </button>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-name">Mínimo por defecto</div>
          <div class="setting-desc">Para productos nuevos sin mínimo definido</div>
        </div>
        <div class="setting-value">${val('default_threshold')} uds.</div>
        <button class="btn btn-secondary"
                onclick="window._settingsEdit('default_threshold', 'Mínimo por defecto', '${val('default_threshold')}')">
          Editar
        </button>
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-section-label">Mercados</div>

      <div class="market-setting-card">
        <div class="market-setting-header">
          <span class="market-setting-name">🇨🇦 Canadá</span>
          <span class="badge badge-ready">CA</span>
        </div>
        <div class="market-setting-fields">
          <div class="market-setting-field">
            <span class="msf-label">Moneda</span>
            <span class="msf-value">CAD</span>
          </div>
          <div class="market-setting-field">
            <span class="msf-label">Método de pago</span>
            <span class="msf-value">e-Transfer</span>
          </div>
        </div>
      </div>

      <div class="market-setting-card">
        <div class="market-setting-header">
          <span class="market-setting-name">🇵🇦 Panamá</span>
          <span class="badge badge-ready">PA</span>
        </div>
        <div class="market-setting-fields">
          <div class="market-setting-field">
            <span class="msf-label">Moneda</span>
            <span class="msf-value">PAB/USD</span>
          </div>
          <div class="market-setting-field">
            <span class="msf-label">Método de pago</span>
            <span class="msf-value">Yappi</span>
          </div>
        </div>
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-section-label">Sesión</div>
      <div class="market-setting-card">
        <div class="danger-title label mb-sm">Cerrar sesión</div>
        <button class="btn btn-secondary btn-full" id="logout-btn">
          Cerrar sesión
        </button>
      </div>
    </div>

    <div class="footer-brand">Elevate your style.</div>
  `;

  // Attach edit handler
  window._settingsEdit = async (key, label, currentValue) => {
    const newValue = prompt(`${label}:\n\nValor actual: ${currentValue}\n\nNuevo valor:`, currentValue);

    // User cancelled
    if (newValue === null) return;

    if (!newValue.trim()) {
      alert('El valor no puede estar vacío.');
      return;
    }

    try {
      await updateSettings({ [key]: newValue.trim() });
      // Reload settings to show the updated value
      await initSettings();
    } catch (error) {
      alert('Error al guardar la configuración.');
      console.error('Settings update error:', error);
    }
  };

  // Re-attach logout button (setupLogoutButton from auth.js looks for #logout-btn)
  import('./auth.js').then(({ setupLogoutButton }) => setupLogoutButton());
}
