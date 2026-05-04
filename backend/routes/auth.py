# =============================================================
# routes/auth.py — Authentication Routes
# =============================================================
# Handles admin login and logout.
# This is a simple single-password login — no user accounts,
# no roles. She logs in with one password to access the admin.
#
# The password is stored as an environment variable (ADMIN_PASSWORD),
# never hardcoded in the source code.
#
# After login, Flask stores a session cookie in the browser.
# All protected routes check for this cookie before responding.
# =============================================================

import os
from flask import Blueprint, request, session, jsonify
from functools import wraps

auth_bp = Blueprint("auth", __name__)


# -------------------------------------------------------------
# require_auth — decorator for protected routes
# -------------------------------------------------------------
# Add @require_auth above any route function to make it
# require a valid login session. If not logged in, it returns
# a 401 Unauthorized response.
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
        # Check if the session has 'logged_in' set to True
        if not session.get("logged_in"):
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
# Checks against the ADMIN_PASSWORD environment variable.
# On success, sets session["logged_in"] = True.
# -------------------------------------------------------------
@auth_bp.route("/login", methods=["POST"])
def login():
    data = request.get_json()

    if not data or "password" not in data:
        return jsonify({"error": "Password is required."}), 400

    admin_password = os.environ.get("ADMIN_PASSWORD")

    if not admin_password:
        return jsonify({"error": "Admin password is not configured on the server."}), 500

    if data["password"] == admin_password:
        # Mark this browser session as authenticated
        session["logged_in"] = True
        return jsonify({"message": "Login successful."}), 200
    else:
        return jsonify({"error": "Incorrect password."}), 401


# -------------------------------------------------------------
# POST /auth/logout
# -------------------------------------------------------------
# Clears the session, logging the user out.
# -------------------------------------------------------------
@auth_bp.route("/logout", methods=["POST"])
def logout():
    session.clear()
    return jsonify({"message": "Logged out successfully."}), 200


# -------------------------------------------------------------
# GET /auth/status
# -------------------------------------------------------------
# The frontend calls this on page load to check if the
# user is already logged in (e.g. after a page refresh).
# -------------------------------------------------------------
@auth_bp.route("/status", methods=["GET"])
def status():
    return jsonify({"logged_in": bool(session.get("logged_in"))}), 200
