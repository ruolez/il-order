import os


class Config:
    """Application configuration."""

    # PostgreSQL connection
    DATABASE_URL = os.environ.get(
        'DATABASE_URL',
        'postgresql://ilorder:ilorder_secret@localhost:5432/ilorder'
    )

    # Flask settings
    DEBUG = os.environ.get('FLASK_DEBUG', '0') == '1'

    # Default settings values
    DEFAULT_SALES_PERIOD_DAYS = 60
    DEFAULT_ORDER_PERIOD_WEEKS = 4
    DEFAULT_THRESHOLD_MULTIPLIER = 1.0
