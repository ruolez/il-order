from flask import Flask, jsonify, request, send_file
from flask_cors import CORS
from .database import (
    PostgresManager, MSSQLManager,
    DatabaseError, DBConnectionError, QueryError, DBTimeoutError
)
from .config import Config
from datetime import datetime
from io import BytesIO
import os
import math

app = Flask(__name__)

# Configure CORS with environment variable support
cors_origin = os.environ.get('CORS_ORIGIN', '*')
if cors_origin == '*':
    CORS(app)
else:
    CORS(app, origins=[cors_origin, 'http://localhost', 'http://127.0.0.1'])

# Initialize PostgreSQL manager
pg = PostgresManager(Config.DATABASE_URL)


def get_mssql_manager():
    """Get MS SQL manager from stored config."""
    config = pg.get_sql_config_with_password()
    if not config:
        return None
    return MSSQLManager(
        server=config['server'],
        database=config['database'],
        username=config['username'],
        password=config['password']
    )


# Health check
@app.route('/health')
def health():
    return jsonify({'status': 'healthy', 'service': 'il-order-backend'})


# ============== Settings Endpoints ==============

@app.route('/api/settings', methods=['GET'])
def get_settings():
    """Get all application settings."""
    try:
        settings = pg.get_settings()
        return jsonify({
            'success': True,
            'settings': settings
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/settings', methods=['POST'])
def save_settings():
    """Save application settings."""
    try:
        data = request.get_json()
        pg.save_settings(data)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


# ============== SQL Config Endpoints ==============

@app.route('/api/sql-config', methods=['GET'])
def get_sql_config():
    """Get SQL Server configuration (without password)."""
    try:
        config = pg.get_sql_config()
        return jsonify({
            'success': True,
            'config': dict(config) if config else None
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/sql-config', methods=['POST'])
def save_sql_config():
    """Save SQL Server configuration."""
    try:
        data = request.get_json()
        required = ['server', 'database', 'username', 'password']
        for field in required:
            if not data.get(field):
                return jsonify({'success': False, 'error': f'Missing required field: {field}'}), 400

        config_id = pg.save_sql_config(
            server=data['server'],
            database=data['database'],
            username=data['username'],
            password=data['password'],
            name=data.get('name', 'default')
        )

        return jsonify({'success': True, 'id': config_id})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/test-connection', methods=['POST'])
def test_connection():
    """Test MS SQL Server connection."""
    try:
        data = request.get_json()

        # Use provided credentials or stored config
        if data and all(k in data for k in ['server', 'database', 'username', 'password']):
            mssql = MSSQLManager(
                server=data['server'],
                database=data['database'],
                username=data['username'],
                password=data['password']
            )
        else:
            mssql = get_mssql_manager()
            if not mssql:
                return jsonify({
                    'success': False,
                    'error': 'No SQL configuration found. Please save configuration first.'
                }), 400

        result = mssql.test_connection()
        return jsonify(result)
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


# ============== Products Endpoints ==============

@app.route('/api/products', methods=['GET'])
def get_products():
    """Get products with optional search, filter, pagination, and sorting."""
    try:
        mssql = get_mssql_manager()
        if not mssql:
            return jsonify({'success': False, 'error': 'SQL Server not configured'}), 400

        search = request.args.get('search', '')
        limit = int(request.args.get('limit', 100))
        offset = int(request.args.get('offset', 0))
        status_filter = request.args.get('filter', 'all')  # all, reorder, healthy
        show_excluded = request.args.get('show_excluded', 'false').lower() == 'true'
        sort_by = request.args.get('sort_by', 'description')  # upc, description, on_hand, threshold, monthly_avg, status
        sort_order = request.args.get('sort_order', 'asc')  # asc, desc

        # Get settings for threshold calculation
        settings = pg.get_settings()
        sales_period = int(settings.get('sales_period_days', 60))

        # Get overrides for threshold calculation
        overrides = {o['product_upc']: o for o in pg.get_all_product_overrides()}
        excluded_upcs = pg.get_excluded_upcs() if not show_excluded else set()

        # For filtered views (reorder/healthy), we need to process all products
        # because threshold depends on PostgreSQL overrides
        if status_filter != 'all':
            # Use optimized combined query (single round-trip instead of two)
            result = mssql.get_products_with_sales(
                days=sales_period,
                search=search if search else None,
                sort_by=sort_by,
                sort_order=sort_order
            )
            all_products = result['products']

            # Enrich and filter products
            filtered = []
            for product in all_products:
                upc = product['ProductUPC']

                # Skip excluded products unless show_excluded is true
                is_excluded = upc in excluded_upcs
                if is_excluded and not show_excluded:
                    continue

                override = overrides.get(upc)
                monthly_avg = float(product.get('monthly_average') or 0)
                daily_avg = float(product.get('daily_average') or 0)
                dynamic_threshold = math.ceil(monthly_avg)

                # Determine effective threshold
                if override and override.get('manual_threshold') is not None:
                    threshold = override['manual_threshold']
                    threshold_type = 'manual'
                elif override and override.get('exclude_from_dynamic'):
                    threshold = product.get('ReorderLevel') or 0
                    threshold_type = 'system'
                else:
                    threshold = dynamic_threshold
                    threshold_type = 'dynamic'

                qty_on_hand = product.get('QuantOnHand') or 0
                needs_reorder = qty_on_hand < threshold

                # Apply filter
                if status_filter == 'reorder' and not needs_reorder:
                    continue
                elif status_filter == 'healthy' and needs_reorder:
                    continue

                filtered.append({
                    'ProductID': product['ProductID'],
                    'ProductUPC': product['ProductUPC'],
                    'ProductSKU': product['ProductSKU'],
                    'ProductDescription': product['ProductDescription'],
                    'QuantOnHand': product['QuantOnHand'],
                    'QuantOnOrder': product['QuantOnOrder'],
                    'ReorderLevel': product['ReorderLevel'],
                    'ReorderQuant': product['ReorderQuant'],
                    'UnitCost': product['UnitCost'],
                    'UnitPrice': product['UnitPrice'],
                    'UnitQty2': product['UnitQty2'],
                    'UnitID2': product['UnitID2'],
                    'LastReceived': product['LastReceived'],
                    'LastSold': product['LastSold'],
                    'threshold': int(threshold),
                    'threshold_type': threshold_type,
                    'dynamic_threshold': int(dynamic_threshold),
                    'monthly_average': int(math.ceil(monthly_avg)),
                    'daily_average': round(daily_avg, 2),
                    'needs_reorder': needs_reorder,
                    'excluded': is_excluded or (override and override.get('exclude_from_orders', False)),
                    'override': override
                })

            # Apply pagination to filtered results
            total_count = len(filtered)
            enriched = filtered[offset:offset + limit]
        else:
            # "all" filter - use SQL-level pagination for maximum speed
            result = mssql.get_products_with_sales(
                days=sales_period,
                search=search if search else None,
                limit=limit,
                offset=offset,
                sort_by=sort_by,
                sort_order=sort_order
            )
            products = result['products']
            total_count = result['total_count']

            # Enrich products with threshold data
            enriched = []
            for product in products:
                upc = product['ProductUPC']

                # Skip excluded products unless show_excluded is true
                is_excluded = upc in excluded_upcs
                if is_excluded and not show_excluded:
                    total_count -= 1
                    continue

                override = overrides.get(upc)
                monthly_avg = float(product.get('monthly_average') or 0)
                daily_avg = float(product.get('daily_average') or 0)
                dynamic_threshold = math.ceil(monthly_avg)

                # Determine effective threshold
                if override and override.get('manual_threshold') is not None:
                    threshold = override['manual_threshold']
                    threshold_type = 'manual'
                elif override and override.get('exclude_from_dynamic'):
                    threshold = product.get('ReorderLevel') or 0
                    threshold_type = 'system'
                else:
                    threshold = dynamic_threshold
                    threshold_type = 'dynamic'

                qty_on_hand = product.get('QuantOnHand') or 0

                enriched.append({
                    'ProductID': product['ProductID'],
                    'ProductUPC': product['ProductUPC'],
                    'ProductSKU': product['ProductSKU'],
                    'ProductDescription': product['ProductDescription'],
                    'QuantOnHand': product['QuantOnHand'],
                    'QuantOnOrder': product['QuantOnOrder'],
                    'ReorderLevel': product['ReorderLevel'],
                    'ReorderQuant': product['ReorderQuant'],
                    'UnitCost': product['UnitCost'],
                    'UnitPrice': product['UnitPrice'],
                    'UnitQty2': product['UnitQty2'],
                    'UnitID2': product['UnitID2'],
                    'LastReceived': product['LastReceived'],
                    'LastSold': product['LastSold'],
                    'threshold': int(threshold),
                    'threshold_type': threshold_type,
                    'dynamic_threshold': int(dynamic_threshold),
                    'monthly_average': int(math.ceil(monthly_avg)),
                    'daily_average': round(daily_avg, 2),
                    'needs_reorder': qty_on_hand < threshold,
                    'excluded': is_excluded or (override and override.get('exclude_from_orders', False)),
                    'override': override
                })

        return jsonify({
            'success': True,
            'products': enriched,
            'count': len(enriched),
            'total_count': total_count,
            'limit': limit,
            'offset': offset,
            'filter': status_filter
        })
    except DBTimeoutError as e:
        return jsonify({'success': False, 'error': f'Database timeout: {e}'}), 504
    except DBConnectionError as e:
        return jsonify({'success': False, 'error': f'Connection error: {e}'}), 503
    except QueryError as e:
        return jsonify({'success': False, 'error': f'Query error: {e}'}), 500
    except DatabaseError as e:
        return jsonify({'success': False, 'error': f'Database error: {e}'}), 500
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/products/<upc>', methods=['GET'])
def get_product(upc):
    """Get single product details."""
    try:
        mssql = get_mssql_manager()
        if not mssql:
            return jsonify({'success': False, 'error': 'SQL Server not configured'}), 400

        product = mssql.get_product_by_upc(upc)
        if not product:
            return jsonify({'success': False, 'error': 'Product not found'}), 404

        settings = pg.get_settings()
        sales_period = int(settings.get('sales_period_days', 60))
        sales_data = mssql.get_sales_data(upc, sales_period)
        override = pg.get_product_override(upc)

        return jsonify({
            'success': True,
            'product': product,
            'sales_data': sales_data,
            'override': override
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/products/<upc>/override', methods=['POST'])
def save_product_override(upc):
    """Save product override settings."""
    try:
        data = request.get_json()

        override_id = pg.save_product_override(
            product_upc=upc,
            exclude_from_dynamic=data.get('exclude_from_dynamic', False),
            exclude_from_orders=data.get('exclude_from_orders', False),
            manual_threshold=data.get('manual_threshold'),
            manual_order_qty=data.get('manual_order_qty'),
            notes=data.get('notes')
        )

        return jsonify({'success': True, 'id': override_id})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/products/<upc>/override', methods=['DELETE'])
def delete_product_override(upc):
    """Delete product override."""
    try:
        deleted = pg.delete_product_override(upc)
        return jsonify({'success': True, 'deleted': deleted})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/products/<upc>/exclude', methods=['POST'])
def toggle_product_exclusion(upc):
    """Toggle product exclusion from orders."""
    try:
        new_state = pg.toggle_product_exclusion(upc)
        return jsonify({
            'success': True,
            'excluded': new_state,
            'upc': upc
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/products/excluded', methods=['GET'])
def get_excluded_products():
    """Get list of products excluded from orders."""
    try:
        excluded = pg.get_excluded_products()
        return jsonify({
            'success': True,
            'products': [dict(p) for p in excluded],
            'count': len(excluded)
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


# ============== Suppliers Endpoints ==============

@app.route('/api/suppliers', methods=['GET'])
def get_suppliers():
    """Get suppliers from purchase history."""
    try:
        mssql = get_mssql_manager()
        if not mssql:
            return jsonify({'success': False, 'error': 'SQL Server not configured'}), 400

        suppliers = mssql.get_suppliers_from_purchase_history()
        return jsonify({
            'success': True,
            'suppliers': suppliers
        })
    except DBTimeoutError as e:
        return jsonify({'success': False, 'error': f'Database timeout: {e}'}), 504
    except DBConnectionError as e:
        return jsonify({'success': False, 'error': f'Connection error: {e}'}), 503
    except QueryError as e:
        return jsonify({'success': False, 'error': f'Query error: {e}'}), 500
    except DatabaseError as e:
        return jsonify({'success': False, 'error': f'Database error: {e}'}), 500
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/products/by-supplier/<int:supplier_id>', methods=['GET'])
def get_products_by_supplier(supplier_id):
    """Get products ordered from a specific supplier."""
    try:
        mssql = get_mssql_manager()
        if not mssql:
            return jsonify({'success': False, 'error': 'SQL Server not configured'}), 400

        products = mssql.get_products_by_supplier(supplier_id)

        # Filter out excluded products
        excluded_upcs = pg.get_excluded_upcs()
        products = [p for p in products if p['ProductUPC'] not in excluded_upcs]

        return jsonify({
            'success': True,
            'products': products,
            'count': len(products)
        })
    except DBTimeoutError as e:
        return jsonify({'success': False, 'error': f'Database timeout: {e}'}), 504
    except DBConnectionError as e:
        return jsonify({'success': False, 'error': f'Connection error: {e}'}), 503
    except QueryError as e:
        return jsonify({'success': False, 'error': f'Query error: {e}'}), 500
    except DatabaseError as e:
        return jsonify({'success': False, 'error': f'Database error: {e}'}), 500
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


# ============== Analysis Endpoints ==============

@app.route('/api/analysis/needs-reorder', methods=['GET'])
def get_needs_reorder():
    """Get products with reorder analysis. Supports filtering by status."""
    try:
        mssql = get_mssql_manager()
        if not mssql:
            return jsonify({'success': False, 'error': 'SQL Server not configured'}), 400

        supplier_id = request.args.get('supplier_id', type=int)
        filter_mode = request.args.get('filter', 'all')
        sort_by = request.args.get('sort_by')  # None = use default sort; options: status, upc, description, on_hand, threshold, suggested_qty, cases
        sort_order = request.args.get('sort_order', 'asc')  # asc, desc

        if supplier_id:
            products = mssql.get_products_by_supplier(supplier_id)
        else:
            products = mssql.get_all_products()

        settings = pg.get_settings()
        sales_period = int(settings.get('sales_period_days', 60))
        order_period_weeks = int(settings.get('order_period_weeks', 4))

        result_products = []
        overrides = {o['product_upc']: o for o in pg.get_all_product_overrides()}
        excluded_upcs = pg.get_excluded_upcs()

        all_sales_data = mssql.get_all_sales_data(sales_period)

        for product in products:
            upc = product['ProductUPC']

            if upc in excluded_upcs:
                continue

            override = overrides.get(upc)

            sales_data = all_sales_data.get(upc, {'monthly_average': 0, 'daily_average': 0})
            dynamic_threshold = math.ceil(sales_data['monthly_average'])

            if override and override.get('manual_threshold') is not None:
                threshold = override['manual_threshold']
            elif override and override.get('exclude_from_dynamic'):
                threshold = product.get('ReorderLevel') or 0
            else:
                threshold = dynamic_threshold

            qty_on_hand = product.get('QuantOnHand') or 0
            needs_reorder = qty_on_hand < threshold

            unit_qty2 = product.get('UnitQty2') or 1
            if unit_qty2 <= 0:
                unit_qty2 = 1

            if needs_reorder:
                daily_avg = sales_data['daily_average']
                order_period_days = order_period_weeks * 7
                projected_need = daily_avg * order_period_days
                cases_needed = -(-projected_need // unit_qty2)
                suggested_qty = int(cases_needed * unit_qty2)

                if override and override.get('manual_order_qty'):
                    suggested_qty = override['manual_order_qty']
                    cases_needed = -(-suggested_qty // unit_qty2)
            else:
                suggested_qty = 0
                cases_needed = 0

            product_data = {
                **product,
                'threshold': int(threshold),
                'monthly_average': int(math.ceil(sales_data['monthly_average'])),
                'daily_average': round(sales_data['daily_average'], 2),
                'suggested_qty': suggested_qty,
                'cases_needed': int(cases_needed),
                'unit_qty2': unit_qty2,
                'deficit': int(threshold - qty_on_hand),
                'status': 'needs_reorder' if needs_reorder else 'sufficient'
            }

            if filter_mode == 'all':
                result_products.append(product_data)
            elif filter_mode == 'needs_reorder' and needs_reorder:
                result_products.append(product_data)
            elif filter_mode == 'sufficient' and not needs_reorder:
                result_products.append(product_data)

        # Sort products
        if sort_by:
            def get_sort_key(p):
                key_map = {
                    'status': 0 if p['status'] == 'needs_reorder' else 1,
                    'upc': (p.get('ProductUPC') or '').lower(),
                    'description': (p.get('ProductDescription') or '').lower(),
                    'on_hand': p.get('QuantOnHand') or 0,
                    'case_qty': p.get('unit_qty2') or 0,
                    'threshold': p.get('threshold') or 0,
                    'suggested_qty': p.get('suggested_qty') or 0,
                    'cases': p.get('cases_needed') or 0
                }
                return key_map.get(sort_by, (p.get('ProductDescription') or '').lower())

            reverse_sort = sort_order == 'desc'
            result_products.sort(key=get_sort_key, reverse=reverse_sort)
        else:
            # Default: needs_reorder first, then by deficit, then by description
            result_products.sort(key=lambda x: (
                0 if x['status'] == 'needs_reorder' else 1,
                -x['deficit'] if x['status'] == 'needs_reorder' else 0,
                (x.get('ProductDescription') or '').lower()
            ))

        return jsonify({
            'success': True,
            'products': result_products,
            'count': len(result_products),
            'filter': filter_mode
        })
    except DBTimeoutError as e:
        return jsonify({'success': False, 'error': f'Database timeout: {e}'}), 504
    except DBConnectionError as e:
        return jsonify({'success': False, 'error': f'Connection error: {e}'}), 503
    except QueryError as e:
        return jsonify({'success': False, 'error': f'Query error: {e}'}), 500
    except DatabaseError as e:
        return jsonify({'success': False, 'error': f'Database error: {e}'}), 500
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/analysis/summary', methods=['GET'])
def get_summary():
    """Get dashboard summary statistics."""
    try:
        mssql = get_mssql_manager()
        if not mssql:
            return jsonify({
                'success': True,
                'summary': {
                    'configured': False
                }
            })

        products = mssql.get_all_products()
        settings = pg.get_settings()
        sales_period = int(settings.get('sales_period_days', 60))

        total_products = len(products)
        needs_reorder_count = 0

        overrides = {o['product_upc']: o for o in pg.get_all_product_overrides()}

        # Get all sales data in a single query (optimized)
        all_sales_data = mssql.get_all_sales_data(sales_period)

        for product in products:
            upc = product['ProductUPC']
            override = overrides.get(upc)

            # Look up sales data from batch result
            sales_data = all_sales_data.get(upc, {'monthly_average': 0})
            dynamic_threshold = math.ceil(sales_data['monthly_average'])

            if override and override.get('manual_threshold') is not None:
                threshold = override['manual_threshold']
            elif override and override.get('exclude_from_dynamic'):
                threshold = product.get('ReorderLevel') or 0
            else:
                threshold = dynamic_threshold

            qty_on_hand = product.get('QuantOnHand') or 0

            if qty_on_hand < threshold:
                needs_reorder_count += 1

        return jsonify({
            'success': True,
            'summary': {
                'configured': True,
                'total_products': total_products,
                'needs_reorder': needs_reorder_count,
                'healthy': total_products - needs_reorder_count,
                'settings': settings
            }
        })
    except DBTimeoutError as e:
        return jsonify({'success': False, 'error': f'Database timeout: {e}'}), 504
    except DBConnectionError as e:
        return jsonify({'success': False, 'error': f'Connection error: {e}'}), 503
    except QueryError as e:
        return jsonify({'success': False, 'error': f'Query error: {e}'}), 500
    except DatabaseError as e:
        return jsonify({'success': False, 'error': f'Database error: {e}'}), 500
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


# ============== Order Draft Endpoints ==============

@app.route('/api/orders', methods=['GET'])
def get_orders():
    """Get all order drafts."""
    try:
        status = request.args.get('status')
        orders = pg.get_order_drafts(status)
        return jsonify({
            'success': True,
            'orders': [dict(o) for o in orders]
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/orders', methods=['POST'])
def create_order():
    """Create a new order draft with items."""
    try:
        data = request.get_json()
        name = data.get('name', f"Order {datetime.now().strftime('%Y-%m-%d %H:%M')}")
        supplier_id = data.get('supplier_id')
        supplier_name = data.get('supplier_name')
        items = data.get('items', [])

        order_id = pg.create_order_draft(name=name, supplier_id=supplier_id, supplier_name=supplier_name)

        for item in items:
            pg.add_order_draft_item(
                order_id=order_id,
                product_upc=item['upc'],
                product_description=item.get('description', ''),
                current_qty=item.get('on_hand', 0),
                threshold=item.get('threshold', 0),
                suggested_qty=item.get('suggested_qty', 0),
                final_qty=item.get('order_qty', item.get('suggested_qty', 0)),
                unit_qty2=item.get('unit_qty2', 1),
                unit_cost=item.get('unit_cost', 0)
            )

        return jsonify({'success': True, 'id': order_id})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/orders/<int:order_id>', methods=['GET'])
def get_order(order_id):
    """Get order draft details with items."""
    try:
        order = pg.get_order_draft(order_id)
        if not order:
            return jsonify({'success': False, 'error': 'Order not found'}), 404

        items = pg.get_order_draft_items(order_id)

        total_items = len(items)
        total_qty = sum(i['final_qty'] or 0 for i in items)
        total_cost = sum((i['final_qty'] or 0) * float(i['unit_cost'] or 0) for i in items)

        return jsonify({
            'success': True,
            'order': dict(order),
            'items': [dict(i) for i in items],
            'summary': {
                'total_items': total_items,
                'total_qty': total_qty,
                'total_cost': round(total_cost, 2)
            }
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/orders/<int:order_id>', methods=['PUT'])
def update_order(order_id):
    """Update order draft."""
    try:
        data = request.get_json()

        if 'name' in data:
            pg.update_order_draft(order_id, name=data['name'])

        if 'status' in data:
            pg.update_order_draft_status(order_id, data['status'])

        if 'items' in data:
            for item in data['items']:
                if 'id' in item and 'final_qty' in item:
                    pg.update_order_draft_item(item['id'], item['final_qty'])

        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/orders/<int:order_id>', methods=['DELETE'])
def delete_order(order_id):
    """Delete order draft."""
    try:
        deleted = pg.delete_order_draft(order_id)
        return jsonify({'success': True, 'deleted': deleted})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/orders/<int:order_id>/items/<int:item_id>', methods=['DELETE'])
def delete_order_item(order_id, item_id):
    """Delete an item from an order draft."""
    try:
        deleted = pg.delete_order_draft_item(item_id)
        return jsonify({'success': True, 'deleted': deleted})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


# ============== Export Endpoints ==============

@app.route('/api/orders/<int:order_id>/export/excel', methods=['GET'])
def export_order_excel(order_id):
    """Export order to Excel file."""
    try:
        from openpyxl import Workbook
        from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

        order = pg.get_order_draft(order_id)
        if not order:
            return jsonify({'success': False, 'error': 'Order not found'}), 404

        items = pg.get_order_draft_items(order_id)

        wb = Workbook()
        ws = wb.active
        ws.title = "Order"

        header_font = Font(bold=True, color="FFFFFF")
        header_fill = PatternFill(start_color="1a73e8", end_color="1a73e8", fill_type="solid")
        thin_border = Border(
            left=Side(style='thin'),
            right=Side(style='thin'),
            top=Side(style='thin'),
            bottom=Side(style='thin')
        )

        ws['A1'] = f"Order: {order['name'] or 'Untitled'}"
        ws['A1'].font = Font(bold=True, size=14)
        ws['A2'] = f"Created: {order['created_at'].strftime('%Y-%m-%d %H:%M') if order['created_at'] else ''}"
        ws['A3'] = f"Status: {order['status']}"

        headers = ['UPC', 'Description', 'On Hand', 'Threshold', 'Suggested Qty', 'Order Qty', 'Cases', 'Unit Cost', 'Total']
        for col, header in enumerate(headers, 1):
            cell = ws.cell(row=5, column=col, value=header)
            cell.font = header_font
            cell.fill = header_fill
            cell.alignment = Alignment(horizontal='center')
            cell.border = thin_border

        for row, item in enumerate(items, 6):
            unit_qty2 = float(item['unit_qty2'] or 1)
            cases = int((item['final_qty'] or 0) / unit_qty2) if unit_qty2 > 0 else 0
            total = (item['final_qty'] or 0) * float(item['unit_cost'] or 0)

            ws.cell(row=row, column=1, value=item['product_upc']).border = thin_border
            ws.cell(row=row, column=2, value=item['product_description']).border = thin_border
            ws.cell(row=row, column=3, value=item['current_qty']).border = thin_border
            ws.cell(row=row, column=4, value=item['threshold']).border = thin_border
            ws.cell(row=row, column=5, value=item['suggested_qty']).border = thin_border
            ws.cell(row=row, column=6, value=item['final_qty']).border = thin_border
            ws.cell(row=row, column=7, value=cases).border = thin_border
            ws.cell(row=row, column=8, value=float(item['unit_cost'] or 0)).border = thin_border
            ws.cell(row=row, column=8).number_format = '$#,##0.00'
            ws.cell(row=row, column=9, value=total).border = thin_border
            ws.cell(row=row, column=9).number_format = '$#,##0.00'

        summary_row = len(items) + 7
        ws.cell(row=summary_row, column=5, value="TOTALS:").font = Font(bold=True)
        ws.cell(row=summary_row, column=6, value=sum(i['final_qty'] or 0 for i in items)).font = Font(bold=True)
        total_cost = sum((i['final_qty'] or 0) * float(i['unit_cost'] or 0) for i in items)
        ws.cell(row=summary_row, column=9, value=total_cost).font = Font(bold=True)
        ws.cell(row=summary_row, column=9).number_format = '$#,##0.00'

        ws.column_dimensions['A'].width = 15
        ws.column_dimensions['B'].width = 40
        ws.column_dimensions['C'].width = 12
        ws.column_dimensions['D'].width = 12
        ws.column_dimensions['E'].width = 14
        ws.column_dimensions['F'].width = 12
        ws.column_dimensions['G'].width = 10
        ws.column_dimensions['H'].width = 12
        ws.column_dimensions['I'].width = 12

        output = BytesIO()
        wb.save(output)
        output.seek(0)

        pg.update_order_draft_status(order_id, 'exported')

        filename = f"order_{order_id}_{datetime.now().strftime('%Y%m%d')}.xlsx"
        return send_file(
            output,
            mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            as_attachment=True,
            download_name=filename
        )
    except ImportError:
        return jsonify({'success': False, 'error': 'openpyxl not installed'}), 500
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/orders/<int:order_id>/export/pdf', methods=['GET'])
def export_order_pdf(order_id):
    """Export order to PDF file."""
    try:
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import letter, landscape
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.units import inch
        from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer

        order = pg.get_order_draft(order_id)
        if not order:
            return jsonify({'success': False, 'error': 'Order not found'}), 404

        items = pg.get_order_draft_items(order_id)

        output = BytesIO()
        doc = SimpleDocTemplate(output, pagesize=landscape(letter), topMargin=0.5*inch, bottomMargin=0.5*inch)
        elements = []
        styles = getSampleStyleSheet()

        title_style = ParagraphStyle('Title', parent=styles['Heading1'], fontSize=18, spaceAfter=12)
        elements.append(Paragraph(f"Order: {order['name'] or 'Untitled'}", title_style))

        info_style = ParagraphStyle('Info', parent=styles['Normal'], fontSize=10, spaceAfter=6)
        elements.append(Paragraph(f"Created: {order['created_at'].strftime('%Y-%m-%d %H:%M') if order['created_at'] else ''}", info_style))
        elements.append(Paragraph(f"Status: {order['status']}", info_style))
        elements.append(Spacer(1, 0.3*inch))

        data = [['UPC', 'Description', 'On Hand', 'Threshold', 'Suggested', 'Order Qty', 'Cases', 'Unit Cost', 'Total']]

        for item in items:
            unit_qty2 = float(item['unit_qty2'] or 1)
            cases = int((item['final_qty'] or 0) / unit_qty2) if unit_qty2 > 0 else 0
            total = (item['final_qty'] or 0) * float(item['unit_cost'] or 0)

            data.append([
                item['product_upc'] or '',
                (item['product_description'] or '')[:35],
                str(int(item['current_qty'] or 0)),
                str(int(item['threshold'] or 0)),
                str(int(item['suggested_qty'] or 0)),
                str(int(item['final_qty'] or 0)),
                str(cases),
                f"${float(item['unit_cost'] or 0):.2f}",
                f"${total:.2f}"
            ])

        total_qty = sum(i['final_qty'] or 0 for i in items)
        total_cost = sum((i['final_qty'] or 0) * float(i['unit_cost'] or 0) for i in items)
        data.append(['', '', '', '', 'TOTALS:', str(int(total_qty)), '', '', f"${total_cost:.2f}"])

        table = Table(data, colWidths=[1.1*inch, 2.5*inch, 0.7*inch, 0.8*inch, 0.8*inch, 0.8*inch, 0.6*inch, 0.8*inch, 0.9*inch])
        table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1a73e8')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('ALIGN', (1, 1), (1, -1), 'LEFT'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 10),
            ('FONTSIZE', (0, 1), (-1, -1), 9),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 8),
            ('BACKGROUND', (0, -1), (-1, -1), colors.HexColor('#f0f0f0')),
            ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
            ('ROWBACKGROUNDS', (0, 1), (-1, -2), [colors.white, colors.HexColor('#f8f9fa')]),
        ]))

        elements.append(table)
        doc.build(elements)
        output.seek(0)

        pg.update_order_draft_status(order_id, 'exported')

        filename = f"order_{order_id}_{datetime.now().strftime('%Y%m%d')}.pdf"
        return send_file(
            output,
            mimetype='application/pdf',
            as_attachment=True,
            download_name=filename
        )
    except ImportError:
        return jsonify({'success': False, 'error': 'reportlab not installed'}), 500
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
