# =============================================================
# routes/orders.py — Order Management Routes
# =============================================================
# Handles creating, reading, updating, and archiving orders.
#
# Endpoints:
#   GET    /api/orders/<market_id>          — list active orders
#   GET    /api/orders/<market_id>/archive  — list delivered orders
#   POST   /api/orders                      — create a new order
#   PATCH  /api/orders/<id>/status          — update production or payment status
#   DELETE /api/orders/<id>                 — delete an order
#
# FIX: Added currency field to all order queries by joining the
# markets table. The frontend uses order.currency to display
# prices like "$60 CAD". Also wrapped all fetchall() results
# in list() so they serialize correctly to JSON.
# =============================================================

from flask import Blueprint, jsonify, request
from db import get_db
from routes.auth import require_auth

orders_bp = Blueprint("orders", __name__)


# -------------------------------------------------------------
# GET /api/orders/<market_id>
# -------------------------------------------------------------
# Returns all active (non-delivered) orders for a market,
# newest first. Used for the main orders screen.
# Joins markets to include currency for price display.
# -------------------------------------------------------------
@orders_bp.route("/<market_id>", methods=["GET"])
@require_auth
def get_orders(market_id):
    with get_db() as conn:
        orders = conn.execute("""
            SELECT o.*, m.currency, m.flag, m.payment AS market_payment
            FROM orders o
            JOIN markets m ON m.id = o.market_id
            WHERE o.market_id = %s
              AND o.production_status != 'delivered'
            ORDER BY o.created_at DESC
        """, (market_id,)).fetchall()

    # list() wraps the result so it serializes correctly to JSON
    return jsonify(list(orders)), 200


# -------------------------------------------------------------
# GET /api/orders/<market_id>/archive
# -------------------------------------------------------------
# Returns delivered orders for a market, newest first.
# Separated from active orders so the main view stays clean.
# -------------------------------------------------------------
@orders_bp.route("/<market_id>/archive", methods=["GET"])
@require_auth
def get_archive(market_id):
    with get_db() as conn:
        orders = conn.execute("""
            SELECT o.*, m.currency, m.flag
            FROM orders o
            JOIN markets m ON m.id = o.market_id
            WHERE o.market_id = %s
              AND o.production_status = 'delivered'
            ORDER BY o.delivered_at DESC
        """, (market_id,)).fetchall()

    return jsonify(list(orders)), 200


# -------------------------------------------------------------
# POST /api/orders
# -------------------------------------------------------------
# Creates a new order. Also creates the customer record if
# this is the first time this customer has ordered.
#
# Expected JSON body:
# {
#   "market_id":        "ca",
#   "customer_name":    "Carlos Reyes",
#   "customer_contact": "+1 604 555 0123",
#   "product":          "Happy Place tee — L, red",
#   "quantity":         2,
#   "unit_price":       30.00,
#   "notes":            "Add a small heart next to the text"
# }
# -------------------------------------------------------------
@orders_bp.route("", methods=["POST"])
@require_auth
def create_order():
    data = request.get_json()

    # Basic validation — these fields are required
    required = ["market_id", "customer_name", "product"]
    missing = [f for f in required if not data.get(f)]
    if missing:
        return jsonify({"error": f"Campos requeridos: {', '.join(missing)}"}), 400

    with get_db() as conn:
        # Look up the market to get the default payment method
        market = conn.execute(
            "SELECT * FROM markets WHERE id = %s", (data["market_id"],)
        ).fetchone()

        if not market:
            return jsonify({"error": "Mercado inválido."}), 400

        # Find or create the customer record.
        # We match on name + market using ILIKE (case-insensitive).
        customer = conn.execute("""
            SELECT id FROM customers
            WHERE market_id = %s AND name ILIKE %s
        """, (data["market_id"], data["customer_name"])).fetchone()

        if not customer:
            # First time this customer has ordered — create their record
            customer = conn.execute("""
                INSERT INTO customers (market_id, name, contact)
                VALUES (%s, %s, %s) RETURNING id
            """, (
                data["market_id"],
                data["customer_name"],
                data.get("customer_contact")
            )).fetchone()

        # Calculate total price from quantity × unit price
        quantity   = data.get("quantity", 1)
        unit_price = data.get("unit_price")
        total      = (quantity * unit_price) if unit_price else None

        # Insert the order — default status is pending + unpaid
        order = conn.execute("""
            INSERT INTO orders (
                market_id, customer_id, customer_name, customer_contact,
                product, quantity, unit_price, total_price,
                payment_method, notes
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING *
        """, (
            data["market_id"],
            customer["id"],
            data["customer_name"],
            data.get("customer_contact"),
            data["product"],
            quantity,
            unit_price,
            total,
            market["payment"],  # Default to market's payment method
            data.get("notes")
        )).fetchone()

    return jsonify({"message": "Pedido creado.", "order": dict(order)}), 201


# -------------------------------------------------------------
# PATCH /api/orders/<id>/status
# -------------------------------------------------------------
# Updates the production status or payment status of an order.
# This is the main action she'll take throughout the day.
#
# Expected JSON body (send only the fields you want to change):
# {
#   "production_status": "in_production",   // optional
#   "payment_status":    "paid"             // optional
# }
# -------------------------------------------------------------
@orders_bp.route("/<int:order_id>/status", methods=["PATCH"])
@require_auth
def update_status(order_id):
    data = request.get_json()

    # Valid values for each status field
    valid_production = {"pending", "in_production", "ready", "delivered"}
    valid_payment    = {"unpaid", "paid"}

    updates = []   # Will hold "column = %s" strings
    values  = []   # Will hold the actual values

    if "production_status" in data:
        if data["production_status"] not in valid_production:
            return jsonify({"error": "Estado de producción inválido."}), 400
        updates.append("production_status = %s")
        values.append(data["production_status"])

        # If marking as delivered, also record the delivery timestamp
        if data["production_status"] == "delivered":
            updates.append("delivered_at = NOW()")

    if "payment_status" in data:
        if data["payment_status"] not in valid_payment:
            return jsonify({"error": "Estado de pago inválido."}), 400
        updates.append("payment_status = %s")
        values.append(data["payment_status"])

    if not updates:
        return jsonify({"error": "No hay campos válidos para actualizar."}), 400

    # Add the order ID as the last value (for the WHERE clause)
    values.append(order_id)

    with get_db() as conn:
        order = conn.execute(
            f"UPDATE orders SET {', '.join(updates)} WHERE id = %s RETURNING *",
            values
        ).fetchone()

        if not order:
            return jsonify({"error": "Pedido no encontrado."}), 404

    return jsonify({"message": "Estado actualizado.", "order": dict(order)}), 200


# -------------------------------------------------------------
# DELETE /api/orders/<id>
# -------------------------------------------------------------
# Deletes an order permanently. Used for mistakes or test entries.
# The frontend asks for confirmation before calling this.
# -------------------------------------------------------------
@orders_bp.route("/<int:order_id>", methods=["DELETE"])
@require_auth
def delete_order(order_id):
    with get_db() as conn:
        deleted = conn.execute(
            "DELETE FROM orders WHERE id = %s RETURNING id", (order_id,)
        ).fetchone()

        if not deleted:
            return jsonify({"error": "Pedido no encontrado."}), 404

    return jsonify({"message": "Pedido eliminado."}), 200