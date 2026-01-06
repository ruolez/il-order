# IL-Order

Inventory Ordering System with dynamic thresholds, sales analysis, and Excel/PDF export.

## Features

- **Dynamic Threshold Calculation**: Automatically calculates reorder thresholds based on sales history
- **Inventory Management**: View products with real-time stock levels and status indicators
- **Smart Reorder Suggestions**: Calculates optimal order quantities based on configurable periods
- **Supplier Filtering**: Filter products by supplier for targeted ordering
- **Product Overrides**: Set manual thresholds or exclude products from dynamic calculations
- **Order Drafts**: Save and manage order drafts before finalizing
- **Excel/PDF Export**: Export orders to Excel or PDF format
- **Order History**: Track all past orders with status and details

## Tech Stack

- **Frontend**: HTML5, CSS3, Vanilla JavaScript (Material Design 3)
- **Backend**: Python 3.11 + Flask
- **Local Database**: PostgreSQL 15
- **External Data**: MS SQL Server (via pymssql + FreeTDS)
- **Containerization**: Docker + Docker Compose

## Quick Start (Ubuntu 24)

### One-Line Install

```bash
curl -fsSL https://raw.githubusercontent.com/ruolez/il-order/main/install.sh | sudo bash
```

### Manual Install

1. Clone the repository:
   ```bash
   git clone https://github.com/ruolez/il-order.git
   cd il-order
   ```

2. Start with Docker Compose:
   ```bash
   docker-compose up -d --build
   ```

3. Access the application:
   - Frontend: http://localhost
   - Backend API: http://localhost:5001

## Configuration

### Ports

| Service | Port |
|---------|------|
| Frontend (Nginx) | 80 |
| Backend (Flask) | 5001 |
| PostgreSQL | 5432 |

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `CORS_ORIGIN` | Allowed CORS origin | `*` (all) |
| `DATABASE_URL` | PostgreSQL connection string | Auto-configured |
| `FLASK_ENV` | Flask environment | `development` |

### MS SQL Server Connection

Configure your MS SQL Server connection through the Settings page in the web UI:
1. Navigate to **Settings**
2. Enter your SQL Server details (server, database, username, password)
3. Click **Test Connection** to verify
4. Click **Save Configuration**

## Usage

### Dashboard
Overview of inventory status with quick action buttons.

### Inventory
Browse and search products. Click on a product to view details and set overrides.

### Orders
1. Select a supplier (optional)
2. Load products needing reorder
3. Adjust quantities as needed
4. Save as draft or export to Excel/PDF

### History
View past orders, re-export, or archive old orders.

### Settings
- Configure MS SQL Server connection
- Set sales analysis period (30, 60, 90, 180 days)
- Set order period (2-8 weeks)
- Adjust threshold multiplier

## Data Persistence

PostgreSQL data is stored in a Docker volume (`postgres_data`) and persists across updates.

## Updating

To update to the latest version while preserving your data:

```bash
cd /opt/il-order
sudo ./install.sh
# Select option 2) Update
```

## License

MIT License
