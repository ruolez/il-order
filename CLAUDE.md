# IL-Order Project Documentation

## Overview

**Location:** `/Users/ruolez/Desktop/Dev/IL-Order`
**GitHub:** `github.com/ruolez/il-order`
**Status:** Production Ready
**Created:** January 2026

Inventory ordering system with dynamic threshold calculation based on sales analysis. Connects to external MS SQL Server for inventory data, stores local configuration in PostgreSQL, and exports orders to Excel/PDF.

## Technology Stack

- **Backend:** Python 3.11 + Flask
- **Frontend:** HTML5, CSS3, Vanilla JavaScript (no frameworks)
- **Databases:**
  - PostgreSQL 15: Local storage (settings, overrides, order drafts)
  - MS SQL Server: External inventory data via pymssql + FreeTDS
- **Deployment:** Docker + Docker Compose
- **UI Design:** Google Material Design 3 principles
- **Exports:** openpyxl (Excel), reportlab (PDF)

## Ports

| Service | Port |
|---------|------|
| Frontend (Nginx) | 80 |
| Backend (Flask) | 5001 (external) → 5000 (internal) |
| PostgreSQL | 5432 |

## Database Architecture

### PostgreSQL Tables (Local)

```sql
-- MS SQL connection configuration
sql_config (id, name, server, database, username, password, is_active, created_at)

-- Application settings (key-value)
settings (key, value, updated_at)
-- Keys: sales_period_days, order_period_weeks, threshold_multiplier

-- Product-specific overrides
product_overrides (id, product_upc, exclude_from_dynamic, manual_threshold, manual_order_qty, notes, created_at, updated_at)

-- Order draft headers
order_drafts (id, name, supplier_id, supplier_name, status, created_at, updated_at)
-- Status: draft, exported, archived

-- Order draft line items
order_draft_items (id, order_draft_id, product_upc, product_description, current_qty, threshold, suggested_qty, final_qty, unit_qty2, unit_cost, created_at)
```

### MS SQL Tables (Read-Only, External)

- `Items_tbl` - Product master (ProductUPC, ProductDescription, QuantOnHand, UnitQty2, UnitCost, ReorderLevel)
- `Invoices_tbl` + `InvoicesDetails_tbl` - Sales history for threshold calculation
- `PurchaseOrders_tbl` + `PurchaseOrdersDetails_tbl` - Supplier lookup
- `Suppliers_tbl` - Supplier names

## Core Business Logic

### Dynamic Threshold Calculation

```
Sales Period: Configurable (30, 60, 90, 180 days)
Monthly Average = Total Sales in Period ÷ (Period Days ÷ 30)
Dynamic Threshold = Monthly Average × Multiplier (default 1.0)
```

### Needs Reorder Logic

```
IF product has manual_threshold override:
    threshold = manual_threshold
ELSE IF product excluded from dynamic:
    threshold = Items_tbl.ReorderLevel (or 0)
ELSE:
    threshold = calculated dynamic threshold

needs_reorder = QuantOnHand < threshold
```

### Order Quantity Calculation

```
Order Period: Configurable (2, 3, 4, 6, 8 weeks)
Weekly Average = Monthly Average ÷ 4
Order Qty = Weekly Average × Order Period Weeks
Final Qty = CEILING(Order Qty / UnitQty2) × UnitQty2  -- Round up to full cases
```

## Project Structure

```
IL-Order/
├── docker-compose.yml          # Docker orchestration
├── install.sh                  # Ubuntu 24 installer script
├── README.md                   # User documentation
├── CLAUDE.md                   # This file
├── .gitignore                  # Git ignore rules
├── dbschema.MD                 # Database schema reference
├── backend/
│   ├── Dockerfile              # Python 3.11 + FreeTDS
│   ├── requirements.txt        # Python dependencies
│   ├── init.sql                # PostgreSQL schema
│   └── app/
│       ├── __init__.py         # Flask app factory
│       ├── main.py             # Flask routes (700+ lines)
│       ├── database.py         # PostgresManager + MSSQLManager (400+ lines)
│       └── config.py           # Configuration
└── frontend/
    ├── Dockerfile              # Nginx Alpine
    ├── nginx.conf              # Nginx configuration
    ├── index.html              # Single page app
    ├── css/
    │   └── style.css           # Material Design 3 styles
    └── js/
        ├── app.js              # Main app logic (700+ lines)
        └── settings.js         # Settings page logic
```

## API Endpoints

### Health & Settings
- `GET /health` - Service health check
- `GET /api/settings` - Get all settings
- `POST /api/settings` - Update settings
- `GET /api/sql-config` - Get SQL config (no password)
- `POST /api/sql-config` - Save SQL config
- `POST /api/test-connection` - Test MS SQL connection

### Products & Inventory
- `GET /api/products` - List products with pagination & search
- `GET /api/products/<upc>` - Single product with sales analysis
- `POST /api/products/<upc>/override` - Save product override
- `DELETE /api/products/<upc>/override` - Delete product override

### Suppliers & Analysis
- `GET /api/suppliers` - List suppliers from purchase history
- `GET /api/products/by-supplier/<id>` - Products by supplier
- `GET /api/analysis/needs-reorder` - Products needing reorder
- `GET /api/analysis/summary` - Dashboard statistics

### Orders
- `GET /api/orders` - List all order drafts
- `POST /api/orders` - Create new order with items
- `GET /api/orders/<id>` - Get order with items and summary
- `PUT /api/orders/<id>` - Update order (name, status)
- `DELETE /api/orders/<id>` - Delete order draft
- `DELETE /api/orders/<id>/items/<item_id>` - Remove line item
- `GET /api/orders/<id>/export/excel` - Export to Excel
- `GET /api/orders/<id>/export/pdf` - Export to PDF

## Key Features

1. **Dashboard**: Summary stats, quick actions, connection status
2. **Inventory View**: Search, filter (all/reorder/low/healthy), status badges
3. **Product Details Modal**: Sales analysis, override settings
4. **Order Creation**: Supplier filter, suggested quantities, quantity adjustment
5. **Order History**: View drafts, re-export, archive, delete
6. **Settings**: MS SQL connection, analysis period, order period, multiplier
7. **Excel Export**: Styled headers, auto-column widths, borders, totals
8. **PDF Export**: Professional layout, summary section, line items table

## Frontend Pages

| Page | Description |
|------|-------------|
| Dashboard | Stats cards, quick actions, setup prompt if not configured |
| Inventory | Product table with search, filter, click for details modal |
| Orders | Step wizard: select supplier → load products → adjust → export |
| History | Order list with status badges, actions (view, export, delete) |
| Settings | SQL config form, analysis settings form |

## CORS Configuration

CORS is configured via environment variable for flexibility:

```python
# backend/app/main.py
cors_origin = os.environ.get('CORS_ORIGIN', '*')
if cors_origin == '*':
    CORS(app)
else:
    CORS(app, origins=[cors_origin, 'http://localhost', 'http://127.0.0.1'])
```

Set in docker-compose.yml:
```yaml
environment:
  - CORS_ORIGIN=${CORS_ORIGIN:-*}
```

## Install Script (install.sh)

Interactive installer for Ubuntu 24 with menu:

```
1) Install    - Fresh installation to /opt/il-order
2) Update     - Pull latest, rebuild, preserve data volumes
3) Remove     - Stop containers, optionally remove data
4) Exit
```

Features:
- Auto-detects server IP for CORS configuration
- Installs Docker if not present
- Preserves PostgreSQL data volume during updates
- Prunes unused Docker images after update

One-line install:
```bash
curl -fsSL https://raw.githubusercontent.com/ruolez/il-order/main/install.sh | sudo bash
```

## Color Scheme (Material Design 3)

```css
--primary: #1a73e8;           /* Google Blue */
--primary-hover: #1557b0;     /* Darker blue */
--primary-light: #e8f0fe;     /* Light blue tint */
--background: #f8f9fa;        /* Light gray */
--surface: #ffffff;           /* White */
--error: #d93025;             /* Google Red */
--success: #1e8e3e;           /* Google Green */
--warning: #f9ab00;           /* Yellow */
--on-surface: #202124;        /* Near black */
--outline: #dadce0;           /* Subtle borders */
```

## Dependencies

### Python (requirements.txt)
- flask==3.0.0
- flask-cors==4.0.0
- psycopg2-binary==2.9.9 (PostgreSQL)
- pymssql==2.2.11 (MS SQL Server)
- openpyxl==3.1.2 (Excel export)
- reportlab==4.0.8 (PDF export)
- gunicorn==21.2.0
- python-dotenv==1.0.0

### System (Dockerfile)
- FreeTDS (for MS SQL connectivity)
- gcc (for compiling Python extensions)

## Development Notes

1. **No Caching**: API responses include no-cache headers
2. **Volume Mounts**: `./backend/app:/app/app` for live reload in dev
3. **Health Check**: PostgreSQL has health check, backend depends on it
4. **Docker Networking**: Frontend proxies /api/ to backend via nginx

## Data Persistence

- PostgreSQL data stored in Docker volume `postgres_data`
- Volume survives container rebuilds and updates
- Only removed with `docker-compose down -v`

## Security Notes

- MS SQL credentials stored in PostgreSQL (not exposed via API)
- No passwords returned in GET /api/sql-config
- CORS configurable for production (not wide open)
- Run behind reverse proxy with HTTPS in production

## Workflow Reminders

- **Always push to GitHub** after completing a feature or fix
- Use conventional commits format (feat:, fix:, etc.)
