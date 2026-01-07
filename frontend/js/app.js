// IL-Order - Main Application JavaScript

// API helper functions
const api = {
    async get(endpoint) {
        const response = await fetch(`/api${endpoint}`);
        return response.json();
    },

    async post(endpoint, data) {
        const response = await fetch(`/api${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        return response.json();
    },

    async delete(endpoint) {
        const response = await fetch(`/api${endpoint}`, {
            method: 'DELETE'
        });
        return response.json();
    }
};

// Pagination state
const ITEMS_PER_PAGE = 100;
let currentPage = 1;
let totalPages = 1;
let totalProducts = 0;
let currentSearch = '';
let pendingFilter = null;

// Toast notifications
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'slideIn 0.3s ease reverse';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Navigation
function navigateTo(pageName) {
    // Update active nav link
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.toggle('active', link.dataset.page === pageName);
    });

    // Show active page
    document.querySelectorAll('.page').forEach(page => {
        page.classList.toggle('active', page.id === `page-${pageName}`);
    });

    // Load page-specific data
    switch (pageName) {
        case 'dashboard':
            loadDashboard();
            break;
        case 'inventory':
            loadInventory();
            break;
        case 'orders':
            loadOrderPage();
            break;
        case 'history':
            loadOrderHistory();
            break;
        case 'settings':
            loadSettings();
            break;
    }
}

// Navigate to inventory with a specific filter pre-selected
function navigateToInventoryWithFilter(filter) {
    pendingFilter = filter;
    navigateTo('inventory');
}

// Initialize navigation event listeners
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            navigateTo(link.dataset.page);
        });
    });

    // Load initial page
    loadDashboard();
});

// Dashboard
async function loadDashboard() {
    try {
        const result = await api.get('/analysis/summary');

        if (!result.success) {
            throw new Error(result.error);
        }

        const summary = result.summary;

        if (!summary.configured) {
            document.getElementById('dashboard-stats').style.display = 'none';
            document.getElementById('not-configured-message').style.display = 'block';
            document.getElementById('dashboard-updated').textContent = '';
            return;
        }

        document.getElementById('dashboard-stats').style.display = 'grid';
        document.getElementById('not-configured-message').style.display = 'none';

        document.getElementById('stat-total').textContent = summary.total_products.toLocaleString();
        document.getElementById('stat-reorder').textContent = summary.needs_reorder.toLocaleString();
        document.getElementById('stat-healthy').textContent = summary.healthy.toLocaleString();

        // Update timestamp
        const now = new Date();
        document.getElementById('dashboard-updated').textContent = `Updated: ${now.toLocaleTimeString()}`;

    } catch (error) {
        console.error('Error loading dashboard:', error);
        document.getElementById('dashboard-stats').style.display = 'none';
        document.getElementById('not-configured-message').style.display = 'block';
    }
}

function refreshDashboard() {
    const btn = document.querySelector('.refresh-section .btn');
    btn.disabled = true;
    btn.textContent = '↻ Refreshing...';

    loadDashboard().finally(() => {
        btn.disabled = false;
        btn.textContent = '↻ Refresh Analysis';
        showToast('Analysis refreshed', 'success');
    });
}

// Inventory
let allProducts = [];

async function loadInventory(page = 1, search = '') {
    const tbody = document.getElementById('inventory-tbody');
    tbody.innerHTML = '<tr><td colspan="7" class="loading">Loading products...</td></tr>';

    // Apply pending filter if exists
    if (pendingFilter) {
        document.getElementById('inventory-filter').value = pendingFilter;
        pendingFilter = null;
    }

    currentPage = page;
    currentSearch = search;
    const offset = (page - 1) * ITEMS_PER_PAGE;
    const currentFilter = document.getElementById('inventory-filter').value;

    try {
        let endpoint = `/products?limit=${ITEMS_PER_PAGE}&offset=${offset}&filter=${currentFilter}`;
        if (search) {
            endpoint += `&search=${encodeURIComponent(search)}`;
        }

        const result = await api.get(endpoint);

        if (!result.success) {
            throw new Error(result.error);
        }

        allProducts = result.products;
        totalProducts = result.total_count;
        totalPages = Math.ceil(totalProducts / ITEMS_PER_PAGE);

        renderInventoryTable(allProducts, true);  // Skip client-side filter
        updatePagination();

    } catch (error) {
        console.error('Error loading inventory:', error);
        tbody.innerHTML = `<tr><td colspan="7" class="loading">Error: ${error.message}</td></tr>`;
    }
}

function updatePagination() {
    const prevBtn = document.getElementById('prev-page');
    const nextBtn = document.getElementById('next-page');
    const pageInfo = document.getElementById('pagination-info');

    prevBtn.disabled = currentPage <= 1;
    nextBtn.disabled = currentPage >= totalPages;

    pageInfo.textContent = `Page ${currentPage} of ${totalPages} (${totalProducts.toLocaleString()} products)`;
}

function loadPrevPage() {
    if (currentPage > 1) {
        loadInventory(currentPage - 1, currentSearch);
    }
}

function loadNextPage() {
    if (currentPage < totalPages) {
        loadInventory(currentPage + 1, currentSearch);
    }
}

function renderInventoryTable(products, skipFilter = false) {
    const tbody = document.getElementById('inventory-tbody');
    const filter = document.getElementById('inventory-filter').value;

    // Apply client-side filter only if not already filtered by server
    let filtered = products;
    if (!skipFilter) {
        if (filter === 'reorder') {
            filtered = products.filter(p => p.needs_reorder);
        } else if (filter === 'healthy') {
            filtered = products.filter(p => !p.needs_reorder);
        }
    }

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="loading">No products found</td></tr>';
        return;
    }

    tbody.innerHTML = filtered.map(product => {
        const qtyOnHand = product.QuantOnHand || 0;
        const threshold = product.threshold || 0;

        let statusClass = 'badge-success';
        let statusText = 'OK';

        if (product.needs_reorder) {
            statusClass = 'badge-error';
            statusText = 'Reorder';
        }

        return `
            <tr>
                <td>${product.ProductUPC || '-'}</td>
                <td>${product.ProductDescription || '-'}</td>
                <td>${qtyOnHand.toLocaleString()}</td>
                <td>
                    ${threshold.toLocaleString()}
                    <small style="color: var(--on-surface-secondary);">(${product.threshold_type})</small>
                </td>
                <td>${product.monthly_average.toLocaleString()}</td>
                <td><span class="badge ${statusClass}">${statusText}</span></td>
                <td>
                    <button class="action-btn view" onclick="viewProduct('${product.ProductUPC}')">View</button>
                </td>
            </tr>
        `;
    }).join('');
}

function searchProducts() {
    const searchTerm = document.getElementById('inventory-search').value.trim();
    loadInventory(1, searchTerm);
}

// Current product being viewed in modal
let currentProductUpc = null;

async function viewProduct(upc) {
    currentProductUpc = upc;
    const modal = document.getElementById('product-modal');

    try {
        const result = await api.get(`/products/${upc}`);

        if (!result.success) {
            throw new Error(result.error);
        }

        const product = result.product;
        const salesData = result.sales_data;
        const override = result.override;

        // Populate modal fields
        document.getElementById('modal-upc').textContent = product.ProductUPC || '-';
        document.getElementById('modal-description').textContent = product.ProductDescription || '-';
        document.getElementById('modal-sku').textContent = product.ProductSKU || '-';

        document.getElementById('modal-qty-on-hand').textContent = (product.QuantOnHand || 0).toLocaleString();
        document.getElementById('modal-threshold').textContent = salesData.monthly_average.toFixed(1);
        document.getElementById('modal-monthly-avg').textContent = salesData.monthly_average.toFixed(1);
        document.getElementById('modal-daily-avg').textContent = salesData.daily_average.toFixed(2);

        document.getElementById('modal-total-sold').textContent = salesData.total_sold.toLocaleString();
        document.getElementById('modal-invoice-count').textContent = salesData.invoice_count;
        document.getElementById('modal-unit-cost').textContent = `$${parseFloat(product.UnitCost || 0).toFixed(2)}`;
        document.getElementById('modal-case-qty').textContent = product.UnitQty2 || 'N/A';

        // Populate override form
        if (override) {
            document.getElementById('override-exclude').checked = override.exclude_from_dynamic || false;
            document.getElementById('override-threshold').value = override.manual_threshold || '';
            document.getElementById('override-order-qty').value = override.manual_order_qty || '';
            document.getElementById('override-notes').value = override.notes || '';
        } else {
            document.getElementById('override-exclude').checked = false;
            document.getElementById('override-threshold').value = '';
            document.getElementById('override-order-qty').value = '';
            document.getElementById('override-notes').value = '';
        }

        // Show modal
        modal.classList.add('active');

    } catch (error) {
        console.error('Error loading product:', error);
        showToast(`Error loading product: ${error.message}`, 'error');
    }
}

function closeProductModal() {
    const modal = document.getElementById('product-modal');
    modal.classList.remove('active');
    currentProductUpc = null;
}

async function saveOverride(e) {
    e.preventDefault();

    if (!currentProductUpc) {
        showToast('No product selected', 'error');
        return;
    }

    const overrideData = {
        exclude_from_dynamic: document.getElementById('override-exclude').checked,
        manual_threshold: document.getElementById('override-threshold').value ?
            parseInt(document.getElementById('override-threshold').value) : null,
        manual_order_qty: document.getElementById('override-order-qty').value ?
            parseInt(document.getElementById('override-order-qty').value) : null,
        notes: document.getElementById('override-notes').value || null
    };

    try {
        const result = await api.post(`/products/${currentProductUpc}/override`, overrideData);

        if (result.success) {
            showToast('Override saved successfully', 'success');
            closeProductModal();
            // Reload inventory to reflect changes
            loadInventory();
        } else {
            throw new Error(result.error);
        }
    } catch (error) {
        console.error('Error saving override:', error);
        showToast(`Error saving override: ${error.message}`, 'error');
    }
}

async function clearOverride() {
    if (!currentProductUpc) {
        showToast('No product selected', 'error');
        return;
    }

    if (!confirm('Are you sure you want to clear the override for this product?')) {
        return;
    }

    try {
        const result = await api.delete(`/products/${currentProductUpc}/override`);

        if (result.success) {
            showToast('Override cleared', 'success');
            closeProductModal();
            loadInventory();
        } else {
            throw new Error(result.error);
        }
    } catch (error) {
        console.error('Error clearing override:', error);
        showToast(`Error clearing override: ${error.message}`, 'error');
    }
}

// Initialize modal event listeners
document.addEventListener('DOMContentLoaded', () => {
    const overrideForm = document.getElementById('override-form');
    if (overrideForm) {
        overrideForm.addEventListener('submit', saveOverride);
    }

    // Close modal when clicking outside
    const modal = document.getElementById('product-modal');
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeProductModal();
            }
        });
    }

    // Close modal with Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal && modal.classList.contains('active')) {
            closeProductModal();
        }
    });
});

// Filter change handler
document.addEventListener('DOMContentLoaded', () => {
    const filterSelect = document.getElementById('inventory-filter');
    if (filterSelect) {
        filterSelect.addEventListener('change', () => {
            // Reload from server with new filter
            loadInventory(1, currentSearch);
        });
    }

    // Search on Enter key
    const searchInput = document.getElementById('inventory-search');
    if (searchInput) {
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                searchProducts();
            }
        });
    }
});

// Orders
async function loadOrderPage() {
    // Load suppliers
    try {
        const result = await api.get('/suppliers');

        if (result.success) {
            const select = document.getElementById('supplier-select');
            select.innerHTML = '<option value="">All Suppliers</option>';

            result.suppliers.forEach(supplier => {
                select.innerHTML += `
                    <option value="${supplier.SupplierID}">
                        ${supplier.BusinessName} (${supplier.order_count} orders)
                    </option>
                `;
            });
        }
    } catch (error) {
        console.error('Error loading suppliers:', error);
    }
}

async function loadNeedsReorder() {
    const supplierId = document.getElementById('supplier-select').value;
    const container = document.getElementById('order-items-container');
    const tbody = document.getElementById('order-tbody');

    container.style.display = 'block';
    tbody.innerHTML = '<tr><td colspan="8" class="loading">Loading products...</td></tr>';

    try {
        let endpoint = '/analysis/needs-reorder';
        if (supplierId) {
            endpoint += `?supplier_id=${supplierId}`;
        }

        const result = await api.get(endpoint);

        if (!result.success) {
            throw new Error(result.error);
        }

        if (result.products.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" class="loading">No products need reordering</td></tr>';
            loadedOrderProducts = [];
            updateOrderSummary();
            return;
        }

        loadedOrderProducts = result.products;

        tbody.innerHTML = result.products.map(product => `
            <tr data-upc="${product.ProductUPC}">
                <td><input type="checkbox" class="order-checkbox" checked onchange="updateOrderSummary()" /></td>
                <td>${product.ProductUPC || '-'}</td>
                <td>${product.ProductDescription || '-'}</td>
                <td>${(product.QuantOnHand || 0).toLocaleString()}</td>
                <td>${product.threshold.toLocaleString()}</td>
                <td>${product.suggested_qty.toLocaleString()}</td>
                <td>
                    <input type="number" class="qty-input order-qty"
                           value="${product.suggested_qty}"
                           min="0"
                           data-unit-qty="${product.unit_qty2 || 1}"
                           onchange="updateCases(this); updateOrderSummary();" />
                </td>
                <td class="cases-cell">${product.cases_needed}</td>
            </tr>
        `).join('');

        document.getElementById('select-all-orders').checked = true;
        updateOrderSummary();

    } catch (error) {
        console.error('Error loading reorder list:', error);
        tbody.innerHTML = `<tr><td colspan="8" class="loading">Error: ${error.message}</td></tr>`;
        loadedOrderProducts = [];
        updateOrderSummary();
    }
}

function updateCases(input) {
    const qty = parseInt(input.value) || 0;
    const unitQty = parseFloat(input.dataset.unitQty) || 1;
    const cases = Math.ceil(qty / unitQty);
    input.closest('tr').querySelector('.cases-cell').textContent = cases;
}

// Select all checkbox
document.addEventListener('DOMContentLoaded', () => {
    const selectAll = document.getElementById('select-all-orders');
    if (selectAll) {
        selectAll.addEventListener('change', (e) => {
            document.querySelectorAll('.order-checkbox').forEach(cb => {
                cb.checked = e.target.checked;
            });
            updateOrderSummary();
        });
    }
});

// Store loaded order data for reference
let loadedOrderProducts = [];

// Export functions
function getOrderData() {
    const rows = document.querySelectorAll('#order-tbody tr');
    const items = [];

    rows.forEach(row => {
        const checkbox = row.querySelector('.order-checkbox');
        if (checkbox && checkbox.checked) {
            const qtyInput = row.querySelector('.order-qty');
            const upc = row.dataset.upc;
            const product = loadedOrderProducts.find(p => p.ProductUPC === upc) || {};

            items.push({
                upc: upc,
                description: row.cells[2].textContent,
                on_hand: parseFloat(row.cells[3].textContent.replace(/,/g, '')) || 0,
                threshold: parseFloat(row.cells[4].textContent.replace(/,/g, '')) || 0,
                suggested_qty: parseFloat(row.cells[5].textContent.replace(/,/g, '')) || 0,
                order_qty: parseInt(qtyInput ? qtyInput.value : 0) || 0,
                unit_qty2: product.unit_qty2 || 1,
                unit_cost: product.UnitCost || 0
            });
        }
    });

    return items;
}

async function saveOrderDraft() {
    const items = getOrderData();

    if (items.length === 0) {
        showToast('No items selected to save', 'error');
        return null;
    }

    const orderName = document.getElementById('order-name').value || null;
    const supplierId = document.getElementById('supplier-select').value;

    try {
        const result = await api.post('/orders', {
            name: orderName,
            supplier_filter: supplierId || null,
            items: items
        });

        if (result.success) {
            showToast('Order draft saved successfully', 'success');
            return result.id;
        } else {
            throw new Error(result.error);
        }
    } catch (error) {
        console.error('Error saving order:', error);
        showToast(`Error saving order: ${error.message}`, 'error');
        return null;
    }
}

async function saveAndExportExcel() {
    const orderId = await saveOrderDraft();
    if (orderId) {
        window.location.href = `/api/orders/${orderId}/export/excel`;
    }
}

async function saveAndExportPDF() {
    const orderId = await saveOrderDraft();
    if (orderId) {
        window.location.href = `/api/orders/${orderId}/export/pdf`;
    }
}

function updateOrderSummary() {
    const rows = document.querySelectorAll('#order-tbody tr');
    let itemCount = 0;
    let totalQty = 0;
    let totalCost = 0;

    rows.forEach(row => {
        const checkbox = row.querySelector('.order-checkbox');
        if (checkbox && checkbox.checked) {
            itemCount++;
            const qtyInput = row.querySelector('.order-qty');
            const qty = parseInt(qtyInput ? qtyInput.value : 0) || 0;
            totalQty += qty;

            const upc = row.dataset.upc;
            const product = loadedOrderProducts.find(p => p.ProductUPC === upc) || {};
            totalCost += qty * (product.UnitCost || 0);
        }
    });

    document.getElementById('order-item-count').textContent = itemCount.toLocaleString();
    document.getElementById('order-total-qty').textContent = totalQty.toLocaleString();
    document.getElementById('order-total-cost').textContent = `$${totalCost.toFixed(2)}`;
}

// Order History
async function loadOrderHistory() {
    const tbody = document.getElementById('history-tbody');
    tbody.innerHTML = '<tr><td colspan="6" class="loading">Loading orders...</td></tr>';

    try {
        const status = document.getElementById('history-filter').value;
        let endpoint = '/orders';
        if (status) {
            endpoint += `?status=${status}`;
        }

        const result = await api.get(endpoint);

        if (!result.success) {
            throw new Error(result.error);
        }

        if (result.orders.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="loading">No orders found</td></tr>';
            return;
        }

        tbody.innerHTML = result.orders.map(order => {
            const createdDate = order.created_at ? new Date(order.created_at).toLocaleString() : '-';
            let statusClass = 'badge-info';
            if (order.status === 'exported') statusClass = 'badge-success';
            if (order.status === 'archived') statusClass = 'badge-secondary';

            return `
                <tr data-id="${order.id}">
                    <td>${order.name || 'Untitled'}</td>
                    <td>${createdDate}</td>
                    <td>${order.item_count || 0}</td>
                    <td>${(order.total_qty || 0).toLocaleString()}</td>
                    <td><span class="badge ${statusClass}">${order.status}</span></td>
                    <td class="action-cell">
                        <button class="action-btn view" onclick="viewOrder(${order.id})">View</button>
                        <button class="action-btn export" onclick="exportOrderExcel(${order.id})">Excel</button>
                        <button class="action-btn export" onclick="exportOrderPDF(${order.id})">PDF</button>
                        <button class="action-btn delete" onclick="deleteOrder(${order.id})">Delete</button>
                    </td>
                </tr>
            `;
        }).join('');

    } catch (error) {
        console.error('Error loading order history:', error);
        tbody.innerHTML = `<tr><td colspan="6" class="loading">Error: ${error.message}</td></tr>`;
    }
}

async function viewOrder(orderId) {
    try {
        const result = await api.get(`/orders/${orderId}`);

        if (!result.success) {
            throw new Error(result.error);
        }

        const order = result.order;
        const items = result.items;
        const summary = result.summary;

        let content = `
            <h3>${order.name || 'Untitled Order'}</h3>
            <p>Created: ${order.created_at ? new Date(order.created_at).toLocaleString() : '-'}</p>
            <p>Status: ${order.status}</p>
            <p>Items: ${summary.total_items} | Total Qty: ${summary.total_qty.toLocaleString()} | Est. Cost: $${summary.total_cost.toFixed(2)}</p>
            <hr>
            <table class="data-table" style="margin-top: 1rem;">
                <thead>
                    <tr>
                        <th>UPC</th>
                        <th>Description</th>
                        <th>Order Qty</th>
                    </tr>
                </thead>
                <tbody>
                    ${items.map(item => `
                        <tr>
                            <td>${item.product_upc}</td>
                            <td>${item.product_description}</td>
                            <td>${item.final_qty}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;

        const modal = document.createElement('div');
        modal.className = 'modal active';
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 800px;">
                <div class="modal-header">
                    <h2>Order Details</h2>
                    <button class="modal-close" onclick="this.closest('.modal').remove()">&times;</button>
                </div>
                <div class="modal-body">
                    ${content}
                </div>
            </div>
        `;
        document.body.appendChild(modal);

    } catch (error) {
        console.error('Error viewing order:', error);
        showToast(`Error loading order: ${error.message}`, 'error');
    }
}

function exportOrderExcel(orderId) {
    window.location.href = `/api/orders/${orderId}/export/excel`;
}

function exportOrderPDF(orderId) {
    window.location.href = `/api/orders/${orderId}/export/pdf`;
}

async function deleteOrder(orderId) {
    if (!confirm('Are you sure you want to delete this order?')) {
        return;
    }

    try {
        const result = await api.delete(`/orders/${orderId}`);

        if (result.success) {
            showToast('Order deleted', 'success');
            loadOrderHistory();
        } else {
            throw new Error(result.error);
        }
    } catch (error) {
        console.error('Error deleting order:', error);
        showToast(`Error deleting order: ${error.message}`, 'error');
    }
}
