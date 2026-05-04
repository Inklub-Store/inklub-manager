# =============================================================
# routes/auth.py — Authentication Routes
# =============================================================
# Token-based authentication — replaces the session cookie approach.
#
# WHY TOKEN-BASED:
# Safari (iPhone and Mac) blocks cross-origin session cookies by default,
# which meant she couldn't log in on any Apple device. Tokens stored in
# localStorage and sent as Authorization headers work on all browsers.
#
# HOW IT WORKS:
# 1. She submits the password
# 2. Backend checks it against ADMIN_PASSWORD env var
# 3. If correct, generates a random token and stores it in the DB
# 4. Returns the token to the frontend
# 5. Frontend stores token in localStorage
# 6. Every subsequent request sends: Authorization: Bearer <token>
# 7. require_auth decorator checks the token against the DB
# =============================================================

import os
import secrets
from flask import Blueprint, request, jsonify
from db import get_db
from functools import wraps

auth_bp = Blueprint("auth", __name__)


# -------------------------------------------------------------
# require_auth — decorator for protected routes
# -------------------------------------------------------------
# Add @require_auth above any route function to protect it.
# Reads the Authorization header and validates the token against
# the tokens table in the database.
#
# Usage:
#   @orders_bp.route("/")
#   @require_auth
#   def get_orders():
#       ...
# -------------------------------------------------------------
def require_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        # Read the Authorization header — expected format: "Bearer <token>"
        auth_header = request.headers.get("Authorization", "")

        if not auth_header.startswith("Bearer "):
            return jsonify({
                "error": "Unauthorized. Please log in.",
                "code": 401
            }), 401

        # Extract the token from the header
        token = auth_header.split(" ", 1)[1]

        # Check the token exists in the database
        with get_db() as conn:
            row = conn.execute(
                "SELECT id FROM tokens WHERE token = %s", (token,)
            ).fetchone()

        if not row:
            return jsonify({
                "error": "Unauthorized. Please log in.",
                "code": 401
            }), 401

        return f(*args, **kwargs)
    return decorated


# -------------------------------------------------------------
# POST /auth/login
# -------------------------------------------------------------
# Accepts JSON: { "password": "..." }
# On success, generates a token, stores it in the DB, and
# returns it to the frontend.
# -------------------------------------------------------------
@auth_bp.route("/login", methods=["POST"])
def login():
    data = request.get_json()

    if not data or "password" not in data:
        return jsonify({"error": "La contraseña es requerida."}), 400

    admin_password = os.environ.get("ADMIN_PASSWORD")

    if not admin_password:
        return jsonify({"error": "Contraseña de admin no configurada en el servidor."}), 500

    if data["password"] != admin_password:
        return jsonify({"error": "Contraseña incorrecta."}), 401

    # Generate a cryptographically secure random token
    # secrets.token_hex(32) produces a 64-character hex string
    token = secrets.token_hex(32)

    # Store the token in the database so we can validate it later
    with get_db() as conn:
        conn.execute(
            "INSERT INTO tokens (token) VALUES (%s)", (token,)
        )

    return jsonify({
        "message": "Login exitoso.",
        "token": token
    }), 200


# -------------------------------------------------------------
# POST /auth/logout
# -------------------------------------------------------------
# Deletes the token from the database, invalidating it.
# The frontend also removes it from localStorage.
# -------------------------------------------------------------
@auth_bp.route("/logout", methods=["POST"])
def logout():
    auth_header = request.headers.get("Authorization", "")

    if auth_header.startswith("Bearer "):
        token = auth_header.split(" ", 1)[1]
        with get_db() as conn:
            conn.execute("DELETE FROM tokens WHERE token = %s", (token,))

    return jsonify({"message": "Sesión cerrada."}), 200


# -------------------------------------------------------------
# GET /auth/status
# -------------------------------------------------------------
# Checks if the current token is valid.
# Called on page load by dashboard.html to decide whether
# to show the app or redirect to login.
# -------------------------------------------------------------
@auth_bp.route("/status", methods=["GET"])
def status():
    auth_header = request.headers.get("Authorization", "")

    if not auth_header.startswith("Bearer "):
        return jsonify({"logged_in": False}), 200

    token = auth_header.split(" ", 1)[1]

    with get_db() as conn:
        row = conn.execute(
            "SELECT id FROM tokens WHERE token = %s", (token,)
        ).fetchone()

    return jsonify({"logged_in": bool(row)}), 200