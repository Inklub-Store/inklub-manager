# =============================================================
# routes/public.py — Public Order Form Routes
# =============================================================
# These routes are accessible WITHOUT login — they are the
# customer-facing order form that she shares via WhatsApp/DM.
#
# There are two public URLs, one per market:
#   /order/ca  — Canada order form (shows e-Transfer, CAD)
#   /order/pa  — Panama order form (shows Yappi, PAB/USD)
#
# When a customer submits the form, the order goes straight
# into the tracker as a 'pending' order, ready for her to review.
# =============================================================

from flask import Blueprint, jsonify, request
from db import get_db

public_bp = Blueprint("public", __name__)


# -------------------------------------------------------------
# GET /order/<market_id>/info
# -------------------------------------------------------------
# Returns market info (currency, payment method, flag) so the
# frontend can display the correct labels on the form.
# This is a public endpoint — no login needed.
# -------------------------------------------------------------
@public_bp.route("/<market_id>/info", methods=["GET"])
def get_market_info(market_id):
    if market_id not in ("ca", "pa"):
        return jsonify({"error": "Invalid market."}), 404

    with get_db() as conn:
        market = conn.execute(
            "SELECT id, name, currency, flag, payment FROM markets WHERE id = %s",
            (market_id,)
        ).fetchone()

    if not market:
        return jsonify({"error": "Market not found."}), 404

    return jsonify(market), 200


# -------------------------------------------------------------
# GET /order/<market_id>/categories
# -------------------------------------------------------------
# Returns available categories so the customer can select
# what type of product they want to order.
# Public endpoint — no login needed.
# -------------------------------------------------------------
@public_bp.route("/<market_id>/categories", methods=["GET"])
def get_public_categories(market_id):
    with get_db() as conn:
        categories = conn.execute(
            "SELECT id, label, unit FROM categories ORDER BY label"
        ).fetchall()
    return jsonify(categories), 200


# -------------------------------------------------------------
# POST /order/<market_id>/submit
# -------------------------------------------------------------
# Receives a customer order submission from the public form.
# Creates the customer (if new) and inserts a pending order.
# No login required — this is the public-facing endpoint.
#
# Expected JSON body:
# {
#   "customer_name":    "Mariana López",
#   "customer_contact": "@mariana.ig or +507 6000 0000",
#   "product":          "World Cup 2026 tee",
#   "category_id":      1,
#   "quantity":         1,
#   "notes":            "Size M, white, with my name on the back"
# }
# -------------------------------------------------------------
@public_bp.route("/<market_id>/submit", methods=["POST"])
def submit_order(market_id):
    if market_id not in ("ca", "pa"):
        return jsonify({"error": "Invalid market."}), 404

    data = request.get_json()

    # Validate required fields
    required = ["customer_name", "product"]
    missing = [f for f in required if not data.get(f)]
    if missing:
        return jsonify({
            "error": f"Please fill in the following fields: {', '.join(missing)}"
        }), 400

    with get_db() as conn:
        # Get the market's default payment method to attach to the order
        market = conn.execute(
            "SELECT * FROM markets WHERE id = %s", (market_id,)
        ).fetchone()

        # Find or create the customer
        customer = conn.execute("""
            SELECT id FROM customers
            WHERE market_id = %s AND name ILIKE %s
        """, (market_id, data["customer_name"])).fetchone()

        if not customer:
            customer = conn.execute("""
                INSERT INTO customers (market_id, name, contact)
                VALUES (%s, %s, %s) RETURNING id
            """, (
                market_id,
                data["customer_name"],
                data.get("customer_contact")
            )).fetchone()

        # Insert the order as 'pending' — she will review and action it
        order = conn.execute("""
            INSERT INTO orders (
                market_id, customer_id, customer_name, customer_contact,
                product, quantity, payment_method, notes,
                production_status, payment_status
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'pending', 'unpaid')
            RETURNING id, customer_name, product, created_at
        """, (
            market_id,
            customer["id"],
            data["customer_name"],
            data.get("customer_contact"),
            data["product"],
            data.get("quantity", 1),
            market["payment"],
            data.get("notes")
        )).fetchone()

    # Return a friendly confirmation — the frontend shows this to the customer
    return jsonify({
        "message": (
            f"Thanks {data['customer_name']}! "
            f"Your order for '{data['product']}' has been received. "
            f"We'll contact you via {market['payment']} to confirm details and payment."
        ),
        "order_id": order["id"]
    }), 201
