-- IL-Order PostgreSQL Schema Initialization

-- MS SQL connection configuration
CREATE TABLE IF NOT EXISTS sql_config (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL DEFAULT 'default',
    server VARCHAR(255) NOT NULL,
    database VARCHAR(100) NOT NULL,
    username VARCHAR(100) NOT NULL,
    password VARCHAR(255) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Application settings
CREATE TABLE IF NOT EXISTS settings (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default settings
INSERT INTO settings (key, value) VALUES
    ('sales_period_days', '60'),
    ('order_period_weeks', '4'),
    ('threshold_multiplier', '1.0')
ON CONFLICT (key) DO NOTHING;

-- Product overrides (linked by UPC)
CREATE TABLE IF NOT EXISTS product_overrides (
    id SERIAL PRIMARY KEY,
    product_upc VARCHAR(20) NOT NULL UNIQUE,
    exclude_from_dynamic BOOLEAN DEFAULT FALSE,
    exclude_from_orders BOOLEAN DEFAULT FALSE,
    manual_threshold INT,
    manual_order_qty INT,
    manual_unit_cost DECIMAL(12,2),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Order drafts/history
CREATE TABLE IF NOT EXISTS order_drafts (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100),
    supplier_id INT,
    supplier_name VARCHAR(100),
    status VARCHAR(20) DEFAULT 'draft',
    total_items INT DEFAULT 0,
    total_cases REAL DEFAULT 0,
    total_cost DECIMAL(12,2) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Order draft line items
CREATE TABLE IF NOT EXISTS order_draft_items (
    id SERIAL PRIMARY KEY,
    order_draft_id INT REFERENCES order_drafts(id) ON DELETE CASCADE,
    product_upc VARCHAR(20) NOT NULL,
    product_description VARCHAR(100),
    current_qty REAL,
    threshold REAL,
    avg_daily_sales REAL,
    suggested_qty INT,
    final_qty INT,
    unit_qty2 REAL,
    unit_cost DECIMAL(12,2),
    line_total DECIMAL(12,2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_order_draft_items_draft_id ON order_draft_items(order_draft_id);
CREATE INDEX IF NOT EXISTS idx_product_overrides_upc ON product_overrides(product_upc);

-- Excluded suppliers from grouped view
CREATE TABLE IF NOT EXISTS excluded_suppliers (
    id SERIAL PRIMARY KEY,
    supplier_name VARCHAR(255) NOT NULL UNIQUE,
    excluded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_excluded_suppliers_name ON excluded_suppliers(supplier_name);
