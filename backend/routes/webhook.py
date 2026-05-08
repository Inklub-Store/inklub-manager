# =============================================================
# routes/webhook.py — Inklub Store Manager
# Trello Webhook Route
# =============================================================
# Receives incoming webhook events from Trello and triggers
# inventory deductions when a card moves to the Entregados list.
#
# HOW IT WORKS:
# 1. Trello sends a POST request to /webhook/trello whenever
#    anything happens on the board (card moved, renamed, etc.)
# 2. We check if it's a card move to the Entregados list
# 3. If yes, we parse the [INV: ...] tag in the card description
# 4. We deduct the listed items from inventory (FIFO for vinyl)
# 5. We log the event and any errors to webhook_events table
#
# SETUP:
# Add TRELLO_ENTREGADOS_LIST_ID to your Render environment variables.
# To find it: call GET /api/trello/lists after setting up Trello creds,
# or use the Trello API directly. It's the ID of the "Entregados" list.
#
# IMPORTANT:
# Trello sends a HEAD request first to verify the webhook URL is alive.
# We must return 200 for HEAD requests or Trello won't register the webhook.
# =============================================================

import os
import json
import logging
from flask import Blueprint, request, jsonify
from db import get_db
from inventory_deduction import process_deductions

webhook_bp = Blueprint("webhook", __name__)
logger     = logging.getLogger(__name__)


# -------------------------------------------------------------
# HEAD /webhook/trello
# -------------------------------------------------------------
# Trello sends a HEAD request when registering a webhook to
# verify the URL is reachable. Must return 200.
# -------------------------------------------------------------
@webhook_bp.route("/trello", methods=["HEAD"])
def trello_webhook_verify():
    return '', 200


# -------------------------------------------------------------
# POST /webhook/trello
# -------------------------------------------------------------
# Receives all board events from Trello.
# We filter for card moves to the Entregados list only.
# -------------------------------------------------------------
@webhook_bp.route("/trello", methods=["POST"])
def trello_webhook():
    # Get the raw request body for signature verification
    raw_body = request.get_data()

    # --- Optional: verify the webhook signature ---
    # Uncomment this block once your webhook is working
    # to add an extra layer of security
    #
    # from trello import verify_webhook_signature
    # signature = request.headers.get('X-Trello-Webhook')
    # if not verify_webhook_signature(raw_body, signature):
    #     logger.warning('Invalid Trello webhook signature — rejected')
    #     return jsonify({'error': 'Invalid signature'}), 401

    # Parse the JSON payload
    try:
        payload = json.loads(raw_body)
    except json.JSONDecodeError:
        logger.error('Invalid JSON in Trello webhook payload')
        return jsonify({'error': 'Invalid JSON'}), 400

    # Extract the action type and data
    action      = payload.get('action', {})
    action_type = action.get('type', '')
    action_data = action.get('data', {})

    # We only care about card moves (updateCard with listAfter)
    # All other events (card renamed, comment added, etc.) are ignored
    if action_type != 'updateCard' or 'listAfter' not in action_data:
        return jsonify({'message': 'Event ignored — not a card move'}), 200

    # Get the list the card was moved TO
    list_after_id   = action_data.get('listAfter', {}).get('id', '')
    list_after_name = action_data.get('listAfter', {}).get('name', '')

    # Get the ID of the Entregados list from environment
    entregados_list_id = os.environ.get('TRELLO_ENTREGADOS_LIST_ID', '')

    # Check if the card was moved TO the Entregados list
    # We check both by ID (reliable) and by name (fallback)
    is_entregados = (
        list_after_id == entregados_list_id or
        list_after_name.lower() == 'entregados'
    )

    if not is_entregados:
        return jsonify({'message': f'Card moved to "{list_after_name}" — no action needed'}), 200

    # --- Card was moved to Entregados — process inventory deduction ---

    card      = action_data.get('card', {})
    card_id   = card.get('id', '')
    card_name = card.get('name', 'Unknown card')

    # Fetch the full card to get its description (the payload doesn't include it)
    try:
        from trello import get_card
        full_card   = get_card(card_id)
        description = full_card.get('desc', '')
    except Exception as e:
        logger.error(f'Failed to fetch card details for {card_id}: {e}')
        description = ''

    # Determine which market this card belongs to.
    # We check the board name or use a label convention.
    # For now we default to 'ca' — if she has separate boards
    # for CA and PA, we can detect from board ID later.
    # TODO: detect market from board ID or card label
    market_id = 'ca'
    board_id  = payload.get('model', {}).get('id', '')
    pa_board  = os.environ.get('TRELLO_BOARD_ID_PA', '')
    if pa_board and board_id == pa_board:
        market_id = 'pa'

    # Log the incoming event to the database
    webhook_event_id = None
    try:
        with get_db() as conn:
            event = conn.execute("""
                INSERT INTO webhook_events (
                    source, event_type, card_id, card_name, raw_payload
                ) VALUES (%s, %s, %s, %s, %s)
                RETURNING id
            """, (
                'trello',
                action_type,
                card_id,
                card_name,
                json.dumps(payload)
            )).fetchone()
            webhook_event_id = event['id']
    except Exception as e:
        logger.error(f'Failed to log webhook event: {e}')
        # Continue even if logging fails — deduction is more important

    # Process the inventory deductions
    result = process_deductions(
        market_id       = market_id,
        card_id         = card_id,
        card_name       = card_name,
        description     = description,
        webhook_event_id= webhook_event_id
    )

    # Update the webhook event log with the result
    if webhook_event_id:
        try:
            with get_db() as conn:
                conn.execute("""
                    UPDATE webhook_events
                    SET processed = TRUE,
                        error = %s
                    WHERE id = %s
                """, (
                    '; '.join(result['errors']) if result['errors'] else None,
                    webhook_event_id
                ))
        except Exception as e:
            logger.error(f'Failed to update webhook event log: {e}')

    logger.info(
        f'Webhook processed — card: "{card_name}" — '
        f'{len(result["deducted"])} deductions, {len(result["errors"])} errors'
    )

    return jsonify(result), 200


# -------------------------------------------------------------
# GET /webhook/trello/setup
# -------------------------------------------------------------
# One-time setup route — registers the webhook on the Trello board.
# Call this once after deploying. Protected by a simple secret key
# so it can't be triggered by accident.
#
# Usage: GET /webhook/trello/setup?secret=YOUR_SECRET_KEY
# -------------------------------------------------------------
@webhook_bp.route("/trello/setup", methods=["GET"])
def setup_trello_webhook():
    # Verify the setup secret to prevent accidental calls
    secret = request.args.get('secret', '')
    if secret != os.environ.get('WEBHOOK_SETUP_SECRET', ''):
        return jsonify({'error': 'Invalid secret'}), 401

    try:
        from trello import register_webhook
        result = register_webhook()
        return jsonify({'message': 'Webhook registered successfully', 'webhook': result}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# -------------------------------------------------------------
# GET /webhook/trello/lists
# -------------------------------------------------------------
# Returns all lists on the board so you can find the
# Entregados list ID to set as TRELLO_ENTREGADOS_LIST_ID.
#
# Usage: GET /webhook/trello/lists?secret=YOUR_SECRET_KEY
# -------------------------------------------------------------
@webhook_bp.route("/trello/lists", methods=["GET"])
def get_trello_lists():
    secret = request.args.get('secret', '')
    if secret != os.environ.get('WEBHOOK_SETUP_SECRET', ''):
        return jsonify({'error': 'Invalid secret'}), 401

    try:
        from trello import get_board_lists
        lists = get_board_lists()
        return jsonify(lists), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500
