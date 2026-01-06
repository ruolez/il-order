import psycopg2
from psycopg2.extras import RealDictCursor
import pymssql
from contextlib import contextmanager
from typing import Optional, Dict, Any, List
import os


class PostgresManager:
    """Manager for PostgreSQL database operations."""

    def __init__(self, database_url: str):
        self.database_url = database_url

    @contextmanager
    def get_connection(self):
        """Context manager for database connections."""
        conn = psycopg2.connect(self.database_url)
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    @contextmanager
    def get_cursor(self):
        """Context manager for database cursors with dict results."""
        with self.get_connection() as conn:
            cursor = conn.cursor(cursor_factory=RealDictCursor)
            try:
                yield cursor
            finally:
                cursor.close()

    # SQL Config methods
    def get_sql_config(self) -> Optional[Dict[str, Any]]:
        """Get the active SQL Server configuration."""
        with self.get_cursor() as cursor:
            cursor.execute("""
                SELECT id, name, server, database, username, is_active, created_at
                FROM sql_config
                WHERE is_active = TRUE
                ORDER BY id DESC
                LIMIT 1
            """)
            return cursor.fetchone()

    def get_sql_config_with_password(self) -> Optional[Dict[str, Any]]:
        """Get SQL config including password (for internal use only)."""
        with self.get_cursor() as cursor:
            cursor.execute("""
                SELECT id, name, server, database, username, password, is_active
                FROM sql_config
                WHERE is_active = TRUE
                ORDER BY id DESC
                LIMIT 1
            """)
            return cursor.fetchone()

    def save_sql_config(self, server: str, database: str, username: str, password: str, name: str = 'default') -> int:
        """Save SQL Server configuration."""
        with self.get_cursor() as cursor:
            # Deactivate existing configs
            cursor.execute("UPDATE sql_config SET is_active = FALSE")

            # Insert new config
            cursor.execute("""
                INSERT INTO sql_config (name, server, database, username, password, is_active)
                VALUES (%s, %s, %s, %s, %s, TRUE)
                RETURNING id
            """, (name, server, database, username, password))

            result = cursor.fetchone()
            return result['id']

    # Settings methods
    def get_settings(self) -> Dict[str, str]:
        """Get all application settings."""
        with self.get_cursor() as cursor:
            cursor.execute("SELECT key, value FROM settings")
            rows = cursor.fetchall()
            return {row['key']: row['value'] for row in rows}

    def get_setting(self, key: str, default: str = None) -> Optional[str]:
        """Get a single setting value."""
        with self.get_cursor() as cursor:
            cursor.execute("SELECT value FROM settings WHERE key = %s", (key,))
            row = cursor.fetchone()
            return row['value'] if row else default

    def save_setting(self, key: str, value: str) -> None:
        """Save a setting value."""
        with self.get_cursor() as cursor:
            cursor.execute("""
                INSERT INTO settings (key, value, updated_at)
                VALUES (%s, %s, CURRENT_TIMESTAMP)
                ON CONFLICT (key) DO UPDATE SET value = %s, updated_at = CURRENT_TIMESTAMP
            """, (key, value, value))

    def save_settings(self, settings: Dict[str, str]) -> None:
        """Save multiple settings at once."""
        for key, value in settings.items():
            self.save_setting(key, value)

    # Product overrides methods
    def get_product_override(self, product_upc: str) -> Optional[Dict[str, Any]]:
        """Get override settings for a product."""
        with self.get_cursor() as cursor:
            cursor.execute("""
                SELECT * FROM product_overrides WHERE product_upc = %s
            """, (product_upc,))
            return cursor.fetchone()

    def get_all_product_overrides(self) -> List[Dict[str, Any]]:
        """Get all product overrides."""
        with self.get_cursor() as cursor:
            cursor.execute("SELECT * FROM product_overrides ORDER BY product_upc")
            return cursor.fetchall()

    def save_product_override(self, product_upc: str, exclude_from_dynamic: bool = False,
                              manual_threshold: int = None, manual_order_qty: int = None,
                              notes: str = None) -> int:
        """Save or update product override."""
        with self.get_cursor() as cursor:
            cursor.execute("""
                INSERT INTO product_overrides (product_upc, exclude_from_dynamic, manual_threshold, manual_order_qty, notes)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (product_upc) DO UPDATE SET
                    exclude_from_dynamic = %s,
                    manual_threshold = %s,
                    manual_order_qty = %s,
                    notes = %s,
                    updated_at = CURRENT_TIMESTAMP
                RETURNING id
            """, (product_upc, exclude_from_dynamic, manual_threshold, manual_order_qty, notes,
                  exclude_from_dynamic, manual_threshold, manual_order_qty, notes))
            result = cursor.fetchone()
            return result['id']

    def delete_product_override(self, product_upc: str) -> bool:
        """Delete a product override."""
        with self.get_cursor() as cursor:
            cursor.execute("DELETE FROM product_overrides WHERE product_upc = %s", (product_upc,))
            return cursor.rowcount > 0

    # Order draft methods
    def create_order_draft(self, name: str = None, supplier_id: int = None, supplier_name: str = None) -> int:
        """Create a new order draft."""
        with self.get_cursor() as cursor:
            cursor.execute("""
                INSERT INTO order_drafts (name, supplier_id, supplier_name, status)
                VALUES (%s, %s, %s, 'draft')
                RETURNING id
            """, (name, supplier_id, supplier_name))
            result = cursor.fetchone()
            return result['id']

    def get_order_drafts(self, status: str = None) -> List[Dict[str, Any]]:
        """Get all order drafts, optionally filtered by status."""
        with self.get_cursor() as cursor:
            if status:
                cursor.execute("""
                    SELECT d.*, COUNT(i.id) as item_count,
                           COALESCE(SUM(i.final_qty), 0) as total_qty
                    FROM order_drafts d
                    LEFT JOIN order_draft_items i ON d.id = i.order_draft_id
                    WHERE d.status = %s
                    GROUP BY d.id
                    ORDER BY d.created_at DESC
                """, (status,))
            else:
                cursor.execute("""
                    SELECT d.*, COUNT(i.id) as item_count,
                           COALESCE(SUM(i.final_qty), 0) as total_qty
                    FROM order_drafts d
                    LEFT JOIN order_draft_items i ON d.id = i.order_draft_id
                    GROUP BY d.id
                    ORDER BY d.created_at DESC
                """)
            return cursor.fetchall()

    def get_order_draft(self, order_id: int) -> Optional[Dict[str, Any]]:
        """Get a single order draft by ID."""
        with self.get_cursor() as cursor:
            cursor.execute("SELECT * FROM order_drafts WHERE id = %s", (order_id,))
            return cursor.fetchone()

    def get_order_draft_items(self, order_id: int) -> List[Dict[str, Any]]:
        """Get all items for an order draft."""
        with self.get_cursor() as cursor:
            cursor.execute("""
                SELECT * FROM order_draft_items
                WHERE order_draft_id = %s
                ORDER BY product_description
            """, (order_id,))
            return cursor.fetchall()

    def add_order_draft_item(self, order_id: int, product_upc: str, product_description: str,
                              current_qty: float, threshold: int, suggested_qty: int,
                              final_qty: int, unit_qty2: float, unit_cost: float) -> int:
        """Add an item to an order draft."""
        with self.get_cursor() as cursor:
            cursor.execute("""
                INSERT INTO order_draft_items
                (order_draft_id, product_upc, product_description, current_qty,
                 threshold, suggested_qty, final_qty, unit_qty2, unit_cost)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
            """, (order_id, product_upc, product_description, current_qty,
                  threshold, suggested_qty, final_qty, unit_qty2, unit_cost))
            result = cursor.fetchone()
            return result['id']

    def update_order_draft_item(self, item_id: int, final_qty: int) -> bool:
        """Update the final quantity for an order item."""
        with self.get_cursor() as cursor:
            cursor.execute("""
                UPDATE order_draft_items SET final_qty = %s WHERE id = %s
            """, (final_qty, item_id))
            return cursor.rowcount > 0

    def delete_order_draft_item(self, item_id: int) -> bool:
        """Delete an item from an order draft."""
        with self.get_cursor() as cursor:
            cursor.execute("DELETE FROM order_draft_items WHERE id = %s", (item_id,))
            return cursor.rowcount > 0

    def update_order_draft_status(self, order_id: int, status: str) -> bool:
        """Update order draft status."""
        with self.get_cursor() as cursor:
            cursor.execute("""
                UPDATE order_drafts SET status = %s, updated_at = CURRENT_TIMESTAMP
                WHERE id = %s
            """, (status, order_id))
            return cursor.rowcount > 0

    def update_order_draft(self, order_id: int, name: str = None) -> bool:
        """Update order draft name."""
        with self.get_cursor() as cursor:
            cursor.execute("""
                UPDATE order_drafts SET name = %s, updated_at = CURRENT_TIMESTAMP
                WHERE id = %s
            """, (name, order_id))
            return cursor.rowcount > 0

    def delete_order_draft(self, order_id: int) -> bool:
        """Delete an order draft and its items."""
        with self.get_cursor() as cursor:
            cursor.execute("DELETE FROM order_drafts WHERE id = %s", (order_id,))
            return cursor.rowcount > 0


class MSSQLManager:
    """Manager for MS SQL Server database operations."""

    def __init__(self, server: str, database: str, username: str, password: str):
        self.server = server
        self.database = database
        self.username = username
        self.password = password

    @contextmanager
    def get_connection(self):
        """Context manager for MS SQL connections."""
        conn = pymssql.connect(
            server=self.server,
            database=self.database,
            user=self.username,
            password=self.password,
            as_dict=True
        )
        try:
            yield conn
        finally:
            conn.close()

    @contextmanager
    def get_cursor(self):
        """Context manager for MS SQL cursors."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            try:
                yield cursor
            finally:
                cursor.close()

    def test_connection(self) -> Dict[str, Any]:
        """Test the MS SQL connection and return server info."""
        try:
            with self.get_cursor() as cursor:
                cursor.execute("SELECT @@VERSION as version, DB_NAME() as database_name")
                row = cursor.fetchone()
                return {
                    'success': True,
                    'version': row['version'][:100] if row else 'Unknown',
                    'database': row['database_name'] if row else self.database
                }
        except Exception as e:
            return {
                'success': False,
                'error': str(e)
            }

    def get_products(self, search: str = None, limit: int = 100, offset: int = 0) -> List[Dict[str, Any]]:
        """Get products from Items_tbl."""
        with self.get_cursor() as cursor:
            query = """
                SELECT
                    ProductID, ProductUPC, ProductSKU, ProductDescription,
                    QuantOnHand, QuantOnOrder, ReorderLevel, ReorderQuant,
                    UnitCost, UnitPrice, UnitQty2, UnitID2,
                    LastReceived, LastSold, Discontinued
                FROM Items_tbl
                WHERE Discontinued = 0 OR Discontinued IS NULL
            """
            params = []

            if search:
                query += " AND (ProductUPC LIKE %s OR ProductDescription LIKE %s)"
                params.extend([f'%{search}%', f'%{search}%'])

            query += " ORDER BY ProductDescription"
            query += f" OFFSET {offset} ROWS FETCH NEXT {limit} ROWS ONLY"

            cursor.execute(query, params)
            return cursor.fetchall()

    def get_product_by_upc(self, upc: str) -> Optional[Dict[str, Any]]:
        """Get a single product by UPC."""
        with self.get_cursor() as cursor:
            cursor.execute("""
                SELECT
                    ProductID, ProductUPC, ProductSKU, ProductDescription,
                    QuantOnHand, QuantOnOrder, ReorderLevel, ReorderQuant,
                    UnitCost, UnitPrice, UnitQty2, UnitID2,
                    LastReceived, LastSold, Discontinued
                FROM Items_tbl
                WHERE ProductUPC = %s
            """, (upc,))
            return cursor.fetchone()

    def get_sales_data(self, product_upc: str, days: int = 60) -> Dict[str, Any]:
        """Get sales data for a product over specified days."""
        with self.get_cursor() as cursor:
            cursor.execute("""
                SELECT
                    COALESCE(SUM(d.QtyShipped), 0) as total_sold,
                    COUNT(DISTINCT i.InvoiceID) as invoice_count
                FROM InvoicesDetails_tbl d
                JOIN Invoices_tbl i ON d.InvoiceID = i.InvoiceID
                WHERE d.ProductUPC = %s
                  AND i.InvoiceDate >= DATEADD(day, -%s, GETDATE())
                  AND i.Void = 0
            """, (product_upc, days))
            row = cursor.fetchone()

            total_sold = float(row['total_sold'] or 0)
            months = days / 30.0

            return {
                'total_sold': total_sold,
                'invoice_count': row['invoice_count'] or 0,
                'days_analyzed': days,
                'monthly_average': total_sold / months if months > 0 else 0,
                'daily_average': total_sold / days if days > 0 else 0
            }

    def get_suppliers_from_purchase_history(self) -> List[Dict[str, Any]]:
        """Get list of suppliers that have been used in purchase orders."""
        with self.get_cursor() as cursor:
            cursor.execute("""
                SELECT DISTINCT
                    s.SupplierID,
                    s.BusinessName,
                    s.AccountNo,
                    COUNT(DISTINCT po.PoID) as order_count
                FROM Suppliers_tbl s
                JOIN PurchaseOrders_tbl po ON s.SupplierID = po.SupplierID
                WHERE s.Discontinued = 0 OR s.Discontinued IS NULL
                GROUP BY s.SupplierID, s.BusinessName, s.AccountNo
                ORDER BY s.BusinessName
            """)
            return cursor.fetchall()

    def get_products_by_supplier(self, supplier_id: int) -> List[Dict[str, Any]]:
        """Get products that have been ordered from a specific supplier."""
        with self.get_cursor() as cursor:
            cursor.execute("""
                SELECT DISTINCT
                    i.ProductID, i.ProductUPC, i.ProductSKU, i.ProductDescription,
                    i.QuantOnHand, i.QuantOnOrder, i.ReorderLevel, i.ReorderQuant,
                    i.UnitCost, i.UnitPrice, i.UnitQty2,
                    i.LastReceived, i.LastSold
                FROM Items_tbl i
                JOIN PurchaseOrdersDetails_tbl pod ON i.ProductUPC = pod.ProductUPC
                JOIN PurchaseOrders_tbl po ON pod.PoID = po.PoID
                WHERE po.SupplierID = %s
                  AND (i.Discontinued = 0 OR i.Discontinued IS NULL)
                ORDER BY i.ProductDescription
            """, (supplier_id,))
            return cursor.fetchall()
