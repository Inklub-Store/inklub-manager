# =============================================================
# notifications.py — Email Notification System
# =============================================================
# Sends low-stock alert emails to the Inklub Gmail account.
# Uses Python's built-in smtplib — no extra libraries needed.
#
# Gmail setup (do this once):
#   1. Go to your Google Account → Security → 2-Step Verification → App passwords
#   2. Create an app password for "Mail"
#   3. Set GMAIL_USER and GMAIL_APP_PASSWORD in your .env / Render env vars
#
# This is the same approach used in the Dominus Tecum project.
# =============================================================

import os
import smtplib
import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

# Set up logging so email errors show up in Render logs
# without crashing the app
logger = logging.getLogger(__name__)

# Market display names for the email body
MARKET_NAMES = {
    "ca": "Canada 🇨🇦",
    "pa": "Panama 🇵🇦"
}


def send_low_stock_alert(to_email, item_name, quantity, unit, market_id, threshold):
    """
    Sends a low-stock alert email when an inventory item drops
    to or below its threshold.

    Parameters:
        to_email  (str): The recipient email address (from settings)
        item_name (str): Name of the inventory item, e.g. "Vinyl — black"
        quantity  (int): Current quantity
        unit      (str): Unit label, e.g. "sheets"
        market_id (str): "ca" or "pa"
        threshold (int): The threshold that was triggered
    """
    gmail_user     = os.environ.get("GMAIL_USER")
    gmail_password = os.environ.get("GMAIL_APP_PASSWORD")

    if not gmail_user or not gmail_password:
        # Log a warning but don't crash the app — the inventory
        # update already succeeded, email is just a bonus notification
        logger.warning(
            "GMAIL_USER or GMAIL_APP_PASSWORD not set — skipping low-stock email."
        )
        return

    market_name = MARKET_NAMES.get(market_id, market_id)

    # Determine the urgency label for the subject line
    if quantity == 0:
        urgency = "OUT OF STOCK"
    else:
        urgency = "Low stock"

    subject = f"[Inklub] {urgency}: {item_name} ({market_name})"

    # Build the plain-text email body — simple and readable
    body = f"""
Hi! This is an automatic alert from your Inklub store manager.

Item:    {item_name}
Market:  {market_name}
Stock:   {quantity} {unit} remaining
Alert threshold: {threshold} {unit}

{"⚠️ This item is OUT OF STOCK." if quantity == 0 else f"⚠️ Stock is running low ({quantity} {unit} left)."}

Log in to your Inklub dashboard to update the inventory once you restock.

---
Inklub Store Manager
(This is an automated message — do not reply to this email.)
""".strip()

    # Build the email message object
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"]    = gmail_user
    msg["To"]      = to_email
    msg.attach(MIMEText(body, "plain"))

    try:
        # Connect to Gmail's SMTP server using SSL on port 465
        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
            server.login(gmail_user, gmail_password)
            server.sendmail(gmail_user, to_email, msg.as_string())

        logger.info(f"Low-stock alert sent for '{item_name}' ({market_id}) to {to_email}")

    except smtplib.SMTPException as e:
        # Log the error but don't raise it — a failed email should never
        # break the inventory update that triggered it
        logger.error(f"Failed to send low-stock email: {e}")
