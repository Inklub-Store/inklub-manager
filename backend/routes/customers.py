# =============================================================
# routes/customers.py — Customer Routes
# =============================================================
# Customers are created automatically when orders come in,
# but this file lets her view customer history and notes.
# =============================================================

from flask import Blueprint, jsonify, request
from db import get_db
from routes.auth import require_auth

customers_bp = Blueprint("customers", __name__)


@customers_bp.route("/<market_id>", methods=["GET"])
@require_auth
def get_customers(market_id):
    """
    Returns all customers for a market, with their total order count.
    Useful for identifying repeat customers.
    """
    with get_db() as conn:
        customers = conn.execute("""
            SELECT c.*,
                   COUNT(o.id)          AS order_count,
                   MAX(o.created_at)    AS last_order_at,
                   SUM(o.total_price)   AS total_spent
            FROM customers c
            LEFT JOIN orders o ON o.customer_id = c.id
            WHERE c.market_id = %s
            GROUP BY c.id
            ORDER BY last_order_at DESC NULLS LAST
        """, (market_id,)).fetchall()
    return jsonify(customers), 200


@customers_bp.route("/<int:customer_id>/orders", methods=["GET"])
@require_auth
def get_customer_orders(customer_id):
    """
    Returns the full order history for a specific customer.
    This is the lightweight CRM view — tap a customer to see all their past orders.
    """
    with get_db() as conn:
        orders = conn.execute("""
            SELECT * FROM orders
            WHERE customer_id = %s
            ORDER BY created_at DESC
        """, (customer_id,)).fetchall()
    return jsonify(orders), 200


@customers_bp.route("/<int:customer_id>/notes", methods=["PATCH"])
@require_auth
def update_notes(customer_id):
    """
    Updates the notes field for a customer.
    She can use this to note preferences, sizes, past issues, etc.
    """
    data = request.get_json()
    with get_db() as conn:
        customer = conn.execute("""
            UPDATE customers SET notes = %s WHERE id = %s RETURNING *
        """, (data.get("notes", ""), customer_id)).fetchone()

        if not customer:
            return jsonify({"error": "Customer not found."}), 404

    return jsonify({"message": "Notes updated.", "customer": customer}), 200
