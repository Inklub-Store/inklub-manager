# =============================================================
# trello.py — Inklub Store Manager
# Trello API Helper
# =============================================================
# Handles all communication with the Trello API:
#   - Registering the webhook on her board
#   - Verifying incoming webhook requests are genuine
#   - Fetching card details
#
# SETUP REQUIRED:
# Add these to your Render environment variables:
#   TRELLO_API_KEY    — from https://trello.com/app-key
#   TRELLO_TOKEN      — generated from the same page
#   TRELLO_BOARD_ID   — the ID of her Inklub board
#   TRELLO_WEBHOOK_URL — the full URL of the webhook endpoint
#                        e.g. https://inklub-manager.onrender.com/webhook/trello
#
# HOW TO FIND THE BOARD ID:
# Open the board in Trello, add .json to the URL:
# https://trello.com/b/BOARD_ID/board-name.json
# The "id" field at the top is the board ID.
# =============================================================

import os
import hmac
import hashlib
import base64
import requests

# Trello API base URL
TRELLO_API_BASE = 'https://api.trello.com/1'


# -------------------------------------------------------------
# get_credentials()
# -------------------------------------------------------------
# Returns the Trello API key and token from environment variables.
# Raises an error if they're not set.
# -------------------------------------------------------------
def get_credentials():
    api_key = os.environ.get('TRELLO_API_KEY')
    token   = os.environ.get('TRELLO_TOKEN')

    if not api_key or not token:
        raise EnvironmentError(
            'TRELLO_API_KEY and TRELLO_TOKEN must be set in environment variables.'
        )

    return api_key, token


# -------------------------------------------------------------
# verify_webhook_signature(request_body, signature_header)
# -------------------------------------------------------------
# Trello signs every webhook request with HMAC-SHA1.
# We verify the signature to make sure the request is genuinely
# from Trello and not from someone trying to fake inventory changes.
#
# Returns True if the signature is valid, False otherwise.
# -------------------------------------------------------------
def verify_webhook_signature(request_body, signature_header):
    api_key, token = get_credentials()
    webhook_url    = os.environ.get('TRELLO_WEBHOOK_URL', '')

    if not signature_header:
        return False

    # Trello signs: body + webhook_url
    content    = request_body + webhook_url.encode('utf-8')
    secret     = token.encode('utf-8')
    digest     = hmac.new(secret, content, hashlib.sha1).digest()
    expected   = base64.b64encode(digest).decode('utf-8')

    return hmac.compare_digest(expected, signature_header)


# -------------------------------------------------------------
# register_webhook(callback_url, board_id)
# -------------------------------------------------------------
# Registers a webhook on the Trello board so Trello calls our
# backend whenever a card is moved between lists.
#
# This only needs to be called ONCE — after that Trello
# remembers the webhook. Call it from the Flask CLI or a
# one-time setup route.
# -------------------------------------------------------------
def register_webhook(callback_url=None, board_id=None):
    api_key, token = get_credentials()

    callback_url = callback_url or os.environ.get('TRELLO_WEBHOOK_URL')
    board_id     = board_id     or os.environ.get('TRELLO_BOARD_ID')

    if not callback_url or not board_id:
        raise EnvironmentError(
            'TRELLO_WEBHOOK_URL and TRELLO_BOARD_ID must be set.'
        )

    response = requests.post(
        f'{TRELLO_API_BASE}/webhooks',
        params={
            'key':         api_key,
            'token':       token,
            'callbackURL': callback_url,
            'idModel':     board_id,
            'description': 'Inklub inventory auto-deduction webhook'
        }
    )

    if response.status_code in (200, 201):
        return response.json()
    else:
        raise Exception(
            f'Failed to register Trello webhook: {response.status_code} {response.text}'
        )


# -------------------------------------------------------------
# get_board_lists(board_id)
# -------------------------------------------------------------
# Returns all lists on the board with their IDs and names.
# Used to find the ID of the "Entregados" list so we know
# which list moves should trigger inventory deduction.
# -------------------------------------------------------------
def get_board_lists(board_id=None):
    api_key, token = get_credentials()
    board_id = board_id or os.environ.get('TRELLO_BOARD_ID')

    response = requests.get(
        f'{TRELLO_API_BASE}/boards/{board_id}/lists',
        params={'key': api_key, 'token': token}
    )

    if response.status_code == 200:
        return response.json()
    else:
        raise Exception(f'Failed to fetch board lists: {response.text}')


# -------------------------------------------------------------
# get_card(card_id)
# -------------------------------------------------------------
# Fetches the full details of a Trello card including its
# description — needed to parse the [INV: ...] tag.
# -------------------------------------------------------------
def get_card(card_id):
    api_key, token = get_credentials()

    response = requests.get(
        f'{TRELLO_API_BASE}/cards/{card_id}',
        params={'key': api_key, 'token': token}
    )

    if response.status_code == 200:
        return response.json()
    else:
        raise Exception(f'Failed to fetch card {card_id}: {response.text}')
