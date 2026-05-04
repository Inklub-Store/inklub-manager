# =============================================================
# routes/settings.py — App Settings Routes
# =============================================================
# Lets her update app-wide settings from the admin UI.
# No code changes needed — everything is stored in the DB.
# =============================================================

from flask import Blueprint, jsonify, request
from db import get_db
from routes.auth import require_auth

settings_bp = Blueprint("settings", __name__)


@settings_bp.route("", methods=["GET"])
@require_auth
def get_settings():
    """Returns all settings as a key-value dictionary."""
    with get_db() as conn:
        rows = conn.execute("SELECT key, value, label FROM settings").fetchall()
    # Convert list of rows into a clean dictionary: { key: { value, label } }
    return jsonify({r["key"]: {"value": r["value"], "label": r["label"]} for r in rows}), 200


@settings_bp.route("", methods=["PATCH"])
@require_auth
def update_settings():
    """
    Updates one or more settings.
    Expected JSON body: { "notification_email": "new@email.com", ... }
    Only keys that already exist in the settings table can be updated.
    """
    data = request.get_json()

    with get_db() as conn:
        for key, value in data.items():
            conn.execute("""
                UPDATE settings SET value = %s, updated_at = NOW()
                WHERE key = %s
            """, (str(value), key))

    return jsonify({"message": "Settings updated."}), 200
