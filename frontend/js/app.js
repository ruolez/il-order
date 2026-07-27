// IL-Order - Main Application JavaScript

// API helper functions
const api = {
  async _parse(response) {
    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }
    return response.json();
  },

  async get(endpoint) {
    const response = await fetch(`/api${endpoint}`);
    return this._parse(response);
  },

  async post(endpoint, data) {
    const response = await fetch(`/api${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    return this._parse(response);
  },

  async delete(endpoint) {
    const response = await fetch(`/api${endpoint}`, {
      method: "DELETE",
    });
    return this._parse(response);
  },

  async put(endpoint, data) {
    const response = await fetch(`/api${endpoint}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    return this._parse(response);
  },
};

// Pagination state
let itemsPerPage = 100; // Default, will be loaded from settings
let salesPeriodDays = 60;
let orderPeriodDays = 28;
let dynamicThresholdSource = "invoices"; // "invoices" | "tracker"
let trackerUrl = "http://192.168.1.114";
let currentPage = 1;
let totalPages = 1;
let totalProducts = 0;
let currentSearch = "";
let pendingFilter = null;
let showExcludedProducts = false;

// Sorting state
let inventorySortBy = "description";
let inventorySortOrder = "asc";
let ordersSortBy = "description";
let ordersSortOrder = "desc";

// View mode state
let inventoryViewMode = localStorage.getItem("inventoryViewMode") || "table";
let isCompactView = localStorage.getItem("inventoryCompactView") === "true";

// Pending order navigation state
let pendingOrderSupplier = null;
let pendingOrderFilter = null;
let pendingOrderAutoLoad = false;
let pendingNoSupplierProducts = null; // Products with no supplier (passed from grouped view)

// Supplier groups cache (populated by renderGroupedView)
let cachedSupplierGroups = {};

// Tracker history cache (persists across re-renders)
let trackerHistoryCache = {};

// Excluded suppliers cache (for grouped view)
let excludedSuppliers = new Set();

// Section load state (skip re-fetch when navigating back)
let inventoryLoaded = false;
let ordersLoaded = false;
let trackingLoaded = false;

// Tracking page state
let trackingCurrentPage = 1;
let trackingTotalPages = 1;
let trackingTotalProducts = 0;
let trackingCurrentSearch = "";
let trackingSortBy = "description";
let trackingSortOrder = "asc";
let trackingHistoryCache = {};

// Inventory selection state (for export from inventory)
let inventorySelectedItems = new Map(); // UPC -> product data (cart, persisted in sessionStorage)
let inventoryCheckedItems = new Map(); // UPC -> product data (ephemeral checkbox selection)

// Cart localStorage key
const CART_STORAGE_KEY = "inventoryCartItems";

// Load application settings (including items per page)
async function loadAppSettings() {
  try {
    const result = await api.get("/settings");
    if (result.success && result.settings) {
      if (result.settings.items_per_page) {
        itemsPerPage = parseInt(result.settings.items_per_page, 10);
      }
      if (result.settings.sales_period_days) {
        salesPeriodDays = parseInt(result.settings.sales_period_days, 10);
      }
      if (result.settings.order_period_days) {
        orderPeriodDays = parseInt(result.settings.order_period_days, 10);
      }
      if (result.settings.dynamic_threshold_source) {
        dynamicThresholdSource = result.settings.dynamic_threshold_source;
      }
      if (result.settings.tracker_url) {
        trackerUrl = result.settings.tracker_url;
      }
    }
  } catch (error) {
    console.error("Error loading app settings:", error);
  }
}

// Toast notifications
function showToast(message, type = "info") {
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = "slideIn 0.3s ease reverse";
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// Excluded suppliers API functions
async function loadExcludedSuppliers() {
  try {
    const result = await api.get("/suppliers/excluded");
    if (result.success) {
      excludedSuppliers = new Set(result.suppliers.map((s) => s.supplier_name));
    }
  } catch (error) {
    console.error("Error loading excluded suppliers:", error);
  }
}

async function excludeSupplierFromView(supplierName) {
  try {
    const result = await api.post("/suppliers/exclude", {
      supplier_name: supplierName,
    });
    if (result.success) {
      excludedSuppliers.add(supplierName);
      showToast(`${supplierName} hidden from view`, "success");
      loadInventory(1, currentSearch);
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    console.error("Error excluding supplier:", error);
    showToast(`Error: ${error.message}`, "error");
  }
}

async function includeSupplierInView(supplierName) {
  try {
    const result = await api.post("/suppliers/include", {
      supplier_name: supplierName,
    });
    if (result.success) {
      excludedSuppliers.delete(supplierName);
      showToast(`${supplierName} restored to view`, "success");
      loadInventory(1, currentSearch);
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    console.error("Error including supplier:", error);
    showToast(`Error: ${error.message}`, "error");
  }
}

function showExcludedSuppliersModal() {
  const modal = document.createElement("div");
  modal.className = "modal active";
  modal.id = "excluded-suppliers-modal";

  const excludedList = Array.from(excludedSuppliers).sort();

  const listHtml =
    excludedList.length > 0
      ? excludedList
          .map(
            (name) => `
        <div class="excluded-supplier-item">
          <span>${escapeHtml(name)}</span>
          <button type="button" class="btn btn-small btn-outline" onclick="includeSupplierInView('${escapeHtml(name).replace(/'/g, "\\'")}'); document.getElementById('excluded-suppliers-modal').remove();">
            Restore
          </button>
        </div>
      `,
          )
          .join("")
      : '<p class="no-excluded-message">No suppliers are hidden</p>';

  modal.innerHTML = `
    <div class="modal-content" style="max-width: 500px;">
      <div class="modal-header">
        <h2>Hidden Suppliers</h2>
        <button class="modal-close" onclick="this.closest('.modal').remove()">&times;</button>
      </div>
      <div class="modal-body">
        <p class="modal-subtitle">These suppliers are hidden from the grouped view. Click "Restore" to show them again.</p>
        <div class="excluded-suppliers-list">
          ${listHtml}
        </div>
      </div>
    </div>
  `;

  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.remove();
  });

  document.body.appendChild(modal);
}

// Navigation
function navigateTo(pageName) {
  // Hide floating bar and clear checked items when leaving inventory
  if (pageName !== "inventory") {
    inventoryCheckedItems.clear();
    const bar = document.getElementById("inventory-export-bar");
    if (bar) bar.classList.add("hidden");
  }

  // Update active nav link
  document.querySelectorAll(".nav-link").forEach((link) => {
    link.classList.toggle("active", link.dataset.page === pageName);
  });

  // Show active page
  document.querySelectorAll(".page").forEach((page) => {
    page.classList.toggle("active", page.id === `page-${pageName}`);
  });

  // Load page-specific data
  switch (pageName) {
    case "dashboard":
      loadDashboard();
      break;
    case "inventory":
      if (!inventoryLoaded || pendingFilter) {
        loadAppSettings().then(() => loadInventory());
      }
      break;
    case "orders":
      if (!ordersLoaded || pendingOrderSupplier || pendingOrderAutoLoad) {
        loadOrderPage();
      }
      break;
    case "history":
      loadOrderHistory();
      break;
    case "tracking":
      if (!trackingLoaded) {
        loadAppSettings().then(() => loadTracking());
      }
      break;
    case "settings":
      loadSettings();
      break;
  }
}

// Navigate to inventory with a specific filter pre-selected
function navigateToInventoryWithFilter(filter) {
  pendingFilter = filter;
  navigateTo("inventory");
}

function refreshInventory() {
  inventoryLoaded = false;
  loadAppSettings().then(() => loadInventory(currentPage, currentSearch));
}

function refreshOrders() {
  ordersLoaded = false;
  loadOrderPage();
}

// Initialize navigation event listeners
document.addEventListener("DOMContentLoaded", async () => {
  // Load app settings first (includes items per page)
  await loadAppSettings();

  // Initialize compact view state
  initCompactView();

  // Initialize history month column headers
  initHistoryMonthHeaders();
  initTrackingMonthHeaders();
  initTrackingVisibility();

  // Load cart from localStorage
  loadCartFromStorage();

  document.querySelectorAll(".nav-link").forEach((link) => {
    link.addEventListener("click", (e) => {
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
    // Fetch summary and settings in parallel
    const [summaryResult, settingsResult] = await Promise.all([
      api.get("/analysis/summary"),
      api.get("/settings"),
    ]);

    // Display settings
    if (settingsResult.success && settingsResult.settings) {
      const settings = settingsResult.settings;

      // Sales period display
      const salesPeriod = settings.sales_period_days || 60;
      document.getElementById("display-sales-period").textContent =
        `Last ${salesPeriod} Days`;

      // Order period editable input
      const orderPeriod = settings.order_period_days || 28;
      document.getElementById("dashboard-order-period").value = orderPeriod;

      // Show settings section
      document.getElementById("current-settings").style.display = "block";
    }

    if (!summaryResult.success) {
      throw new Error(summaryResult.error);
    }

    const summary = summaryResult.summary;

    if (!summary.configured) {
      document.getElementById("dashboard-stats").style.display = "none";
      document.getElementById("current-settings").style.display = "none";
      document.getElementById("not-configured-message").style.display = "block";
      document.getElementById("dashboard-updated").textContent = "";
      return;
    }

    document.getElementById("dashboard-stats").style.display = "grid";
    document.getElementById("not-configured-message").style.display = "none";

    document.getElementById("stat-total").textContent =
      summary.total_products.toLocaleString();
    document.getElementById("stat-reorder").textContent =
      summary.needs_reorder.toLocaleString();
    document.getElementById("stat-healthy").textContent =
      summary.healthy.toLocaleString();

    // Update timestamp
    const now = new Date();
    document.getElementById("dashboard-updated").textContent =
      `Updated: ${now.toLocaleTimeString()}`;
  } catch (error) {
    console.error("Error loading dashboard:", error);
    document.getElementById("dashboard-stats").style.display = "none";
    document.getElementById("current-settings").style.display = "none";
    document.getElementById("not-configured-message").style.display = "block";
  }
}

// Update order period from dashboard and refresh analysis
async function updateOrderPeriodFromDashboard() {
  const input = document.getElementById("dashboard-order-period");
  const value = parseInt(input.value);

  if (!value || value < 1 || value > 365) {
    showToast("Please enter a valid order period (1-365 days)", "error");
    return;
  }

  try {
    // Fetch current settings first
    const currentSettings = await api.get("/settings");
    if (!currentSettings.success) {
      throw new Error("Failed to fetch current settings");
    }

    // Update with new order period
    const result = await api.post("/settings", {
      sales_period_days: currentSettings.settings.sales_period_days || 60,
      order_period_days: value,
      threshold_multiplier:
        currentSettings.settings.threshold_multiplier || 1.0,
      items_per_page: currentSettings.settings.items_per_page || 100,
    });

    if (result.success) {
      showToast("Order period updated", "success");
      inventoryLoaded = false;
      ordersLoaded = false;
      // Refresh dashboard to reflect changes
      refreshDashboard();
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    console.error("Error updating order period:", error);
    showToast(`Error: ${error.message}`, "error");
  }
}

function refreshDashboard() {
  const btn = document.querySelector(".refresh-section .btn");
  btn.disabled = true;
  btn.textContent = "↻ Refreshing...";

  loadDashboard().finally(() => {
    btn.disabled = false;
    btn.textContent = "↻ Refresh Analysis";
    showToast("Analysis refreshed", "success");
  });
}

// History month columns
function getHistoryMonths() {
  const months = [];
  const now = new Date();
  for (let i = 3; i >= 1; i--) {
    const first = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const last = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
    months.push({
      label: first.toLocaleDateString("en-US", {
        month: "short",
        year: "numeric",
      }),
      from: first.toISOString().slice(0, 10),
      to: last.toISOString().slice(0, 10),
    });
  }
  const currentFirst = new Date(now.getFullYear(), now.getMonth(), 1);
  months.push({
    label: "Current",
    from: currentFirst.toISOString().slice(0, 10),
    to: now.toISOString().slice(0, 10),
  });
  return months;
}

const historyMonths = getHistoryMonths();

function initHistoryMonthHeaders() {
  for (let i = 0; i < 4; i++) {
    const el = document.getElementById(`history-month-${i + 1}`);
    if (el) el.textContent = historyMonths[i].label;
  }
}

// Tracking page: 6 past months + current
function getTrackingHistoryMonths() {
  const months = [];
  const now = new Date();
  for (let i = 6; i >= 1; i--) {
    const first = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const last = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
    months.push({
      label: first.toLocaleDateString("en-US", {
        month: "short",
        year: "numeric",
      }),
      from: first.toISOString().slice(0, 10),
      to: last.toISOString().slice(0, 10),
    });
  }
  const currentFirst = new Date(now.getFullYear(), now.getMonth(), 1);
  months.push({
    label: "Current",
    from: currentFirst.toISOString().slice(0, 10),
    to: now.toISOString().slice(0, 10),
  });
  return months;
}

const trackingMonths = getTrackingHistoryMonths();

function initTrackingMonthHeaders() {
  for (let i = 0; i < 7; i++) {
    const el = document.getElementById(`tracking-month-${i + 1}`);
    if (el) {
      const indicator = el.querySelector(".sort-indicator");
      el.textContent = trackingMonths[i].label;
      if (indicator) el.appendChild(indicator);
    }
  }
}

// Inventory
let allProducts = [];

async function loadInventory(page = 1, search = "") {
  const tbody = document.getElementById("inventory-tbody");
  tbody.innerHTML =
    '<tr><td colspan="14" class="loading">Loading products...</td></tr>';

  // Apply pending filter if exists
  if (pendingFilter) {
    document.getElementById("inventory-filter").value = pendingFilter;
    pendingFilter = null;
  }

  // Initialize view toggle buttons state
  document.querySelectorAll(".view-toggle-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === inventoryViewMode);
  });

  currentPage = page;
  currentSearch = search;
  const currentFilter = document.getElementById("inventory-filter").value;

  // Show/hide containers based on view mode
  const tableContainer = document.getElementById("inventory-table-container");
  const cardsContainer = document.getElementById("supplier-cards-container");
  const pagination = document.getElementById("inventory-pagination");

  try {
    let endpoint;

    if (inventoryViewMode === "grouped") {
      // Grouped view: fetch ALL products (no pagination) to group by supplier
      endpoint = `/products?limit=0&filter=${currentFilter}`;
      if (search) {
        endpoint += `&search=${encodeURIComponent(search)}`;
      }
      if (showExcludedProducts) {
        endpoint += "&show_excluded=true";
      }
      // Sort by supplier for grouped view
      endpoint += `&sort_by=last_supplier&sort_order=asc`;

      tableContainer.style.display = "none";
      cardsContainer.style.display = "";
      pagination.style.display = "none";

      // Show loading in cards container
      document.getElementById("supplier-cards-grid").innerHTML =
        '<div class="info-card"><p>Loading suppliers...</p></div>';
    } else {
      // Table view: use pagination
      const offset = (page - 1) * itemsPerPage;
      endpoint = `/products?limit=${itemsPerPage}&offset=${offset}&filter=${currentFilter}`;
      if (search) {
        endpoint += `&search=${encodeURIComponent(search)}`;
      }
      if (showExcludedProducts) {
        endpoint += "&show_excluded=true";
      }
      endpoint += `&sort_by=${inventorySortBy}&sort_order=${inventorySortOrder}`;

      tableContainer.style.display = "";
      cardsContainer.style.display = "none";
      pagination.style.display = "";
    }

    const result = await api.get(endpoint);

    if (!result.success) {
      throw new Error(result.error);
    }

    allProducts = result.products;
    totalProducts = result.total_count;
    totalPages = Math.ceil(totalProducts / itemsPerPage);

    if (inventoryViewMode === "grouped") {
      await loadExcludedSuppliers();
      renderGroupedView(allProducts);
    } else {
      renderInventoryTable(allProducts, true);
      syncCheckboxesWithCart();
      updatePagination();
      // Tracker mode needs the per-row history to recompute thresholds, so load
      // it for the displayed page even without a search term.
      if (currentSearch || dynamicThresholdSource === "tracker") {
        loadTrackerHistory(allProducts);
      }
    }

    updateSortIndicators("inventory");
    inventoryLoaded = true;
  } catch (error) {
    console.error("Error loading inventory:", error);
    if (inventoryViewMode === "grouped") {
      document.getElementById("supplier-cards-grid").innerHTML =
        `<div class="info-card"><p>Error: ${error.message}</p></div>`;
    } else {
      tbody.innerHTML = `<tr><td colspan="14" class="loading">Error: ${error.message}</td></tr>`;
    }
  }
}

function updatePagination() {
  const prevBtn = document.getElementById("prev-page");
  const nextBtn = document.getElementById("next-page");
  const pageInfo = document.getElementById("pagination-info");

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
  const tbody = document.getElementById("inventory-tbody");
  const filter = document.getElementById("inventory-filter").value;

  // Apply client-side filter only if not already filtered by server
  let filtered = products;
  if (!skipFilter) {
    if (filter === "reorder") {
      filtered = products.filter((p) => p.needs_reorder);
    } else if (filter === "stocked") {
      filtered = products.filter((p) => !p.needs_reorder);
    }
  }

  if (filtered.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="14" class="loading">No products found</td></tr>';
    return;
  }

  tbody.innerHTML = filtered
    .map((product) => {
      const qtyOnHand = product.QuantOnHand || 0;
      const pendingPoQty = product.pending_po_qty || 0;
      const effectiveQty = product.effective_qty || qtyOnHand;
      const threshold = product.threshold || 0;
      const isExcluded = product.excluded || false;
      const suggestedQty = product.suggested_qty || 0;
      const unitQty2 = product.UnitQty2 || 1;
      const upc = product.ProductUPC || "";

      // Use stored cart order_qty if in cart, otherwise use suggested_qty
      const isInCart = inventorySelectedItems.has(upc);
      const orderQty = isInCart
        ? inventorySelectedItems.get(upc).order_qty || suggestedQty
        : suggestedQty;
      const cases = Math.ceil(orderQty / unitQty2);

      let statusClass = "badge-success";
      let statusText = "OK";

      if (isExcluded) {
        statusClass = "badge-secondary";
        statusText = "Excluded";
      } else if (product.needs_reorder) {
        statusClass = "badge-error";
        statusText = "Reorder";
      }

      // In compact mode, show threshold in the status badge
      let statusBadgeHtml;
      if (isCompactView && !isExcluded) {
        statusBadgeHtml = `<span class="badge ${statusClass} badge-with-threshold">${statusText}<span class="threshold-value">(${threshold})</span></span>`;
      } else {
        statusBadgeHtml = `<span class="badge ${statusClass}">${statusText}</span>`;
      }

      const rowClass = isExcluded ? "product-excluded" : "";

      // Action buttons: icon-only for compact rows
      const viewBtnHtml = `<button class="action-btn-icon view" onclick="viewProduct('${upc}')" title="View details"><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 2c-3.3 0-6.1 2-7.8 5 1.7 3 4.5 5 7.8 5s6.1-2 7.8-5c-1.7-3-4.5-5-7.8-5zm0 8.5a3.5 3.5 0 110-7 3.5 3.5 0 010 7zm0-5.5a2 2 0 100 4 2 2 0 000-4z"/></svg></button>`;

      const excludeBtnHtml = isExcluded
        ? `<button class="action-btn-icon include" onclick="toggleExclude('${upc}')" title="Include product"><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/></svg></button>`
        : `<button class="action-btn-icon exclude" onclick="toggleExclude('${upc}')" title="Exclude product"><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z"/></svg></button>`;

      // Build effective qty tooltip showing breakdown
      const qipQty = product.qip_qty || 0;
      const tooltipParts = [`On Hand: ${qtyOnHand.toLocaleString()}`];
      if (pendingPoQty > 0)
        tooltipParts.push(`On Order: +${pendingPoQty.toLocaleString()}`);
      if (qipQty > 0)
        tooltipParts.push(`In Progress: -${qipQty.toLocaleString()}`);
      const qtyTooltip = tooltipParts.join(", ");

      let superscripts = "";
      if (pendingPoQty > 0)
        superscripts += `<sup style="color: var(--color-success-fg); font-size: 10px;">+${pendingPoQty}</sup>`;
      if (qipQty > 0)
        superscripts += `<sup style="color: var(--color-danger-fg); font-size: 10px;">-${qipQty}</sup>`;

      const needsTooltip = pendingPoQty > 0 || qipQty > 0;
      const onHandCases = Math.floor(effectiveQty / unitQty2);
      const qtyDisplayHtml = needsTooltip
        ? `<span title="${qtyTooltip}" style="cursor: help;">${effectiveQty.toLocaleString()} <span class="case-count">(${onHandCases.toLocaleString()})</span>${superscripts}</span>`
        : `${effectiveQty.toLocaleString()} <span class="case-count">(${onHandCases.toLocaleString()})</span>`;

      return `
            <tr class="${rowClass}" data-upc="${upc}">
                <td><input type="checkbox" class="inventory-checkbox" data-upc="${upc}" onchange="handleInventoryCheckboxChange(this)" /></td>
                <td>${upc ? `<a href="${trackerUrl}?tracker=${upc}&days=${salesPeriodDays}" target="_blank" rel="noopener">${upc}</a>` : "-"}</td>
                <td>${product.ProductDescription || "-"}</td>
                ${historyMonths
                  .map((m, mi) => {
                    const cached =
                      trackerHistoryCache[upc] && trackerHistoryCache[upc][mi];
                    const cq = unitQty2 || 1;
                    if (cached) {
                      const sv = Math.round(cached.sale).toLocaleString();
                      const sc = Math.round(
                        Math.round(cached.sale) / cq,
                      ).toLocaleString();
                      const pv = Math.round(cached.purchase).toLocaleString();
                      const pc = Math.round(
                        Math.round(cached.purchase) / cq,
                      ).toLocaleString();
                      const iv = Math.round(
                        cached.beginning_inventory,
                      ).toLocaleString();
                      const ic = Math.round(
                        Math.round(cached.beginning_inventory) / cq,
                      ).toLocaleString();
                      return `<td class="history-cell hide-in-compact" data-upc="${upc}" data-month="${mi}" data-case-qty="${cq}"><a href="${trackerUrl}?tracker=${upc}&from=${m.from}&to=${m.to}" target="_blank" rel="noopener"><span class="history-line history-sale"><span class="history-label">&minus;</span><span class="history-s">${sv} <span class="case-count">(${sc})</span></span></span><span class="history-line history-purchase"><span class="history-label">+</span><span class="history-p">${pv} <span class="case-count">(${pc})</span></span></span><span class="history-line history-inv"><span class="history-s-spacer"></span><span class="history-i">${iv} <span class="case-count">(${ic})</span></span></span></a></td>`;
                    }
                    if (currentSearch) {
                      return `<td class="history-cell hide-in-compact" data-upc="${upc}" data-month="${mi}" data-case-qty="${cq}"><div class="history-spinner"></div></td>`;
                    }
                    return `<td class="history-cell hide-in-compact" data-upc="${upc}" data-month="${mi}" data-case-qty="${cq}"></td>`;
                  })
                  .join("")}
                <td class="on-hand-qty">${qtyDisplayHtml}</td>
                <td class="hide-in-compact">${unitQty2.toLocaleString()}</td>
                <td class="hide-in-compact inv-threshold-cell">
                    ${threshold.toLocaleString()}
                    <br><small class="threshold-type threshold-${product.threshold_type}" title="${product.threshold_type}">${product.threshold_type === "dynamic" ? "auto" : product.threshold_type === "manual" ? "manual" : "system"}</small>
                </td>
                <td class="supplier-cell hide-in-compact" title="${product.last_supplier || ""}">${product.last_supplier || "-"}</td>
                <td class="${orderQty > 0 ? "order-qty-highlight" : ""}">
                    <input type="number" class="inventory-order-qty-input"
                           value="${orderQty}"
                           min="0"
                           data-upc="${upc}"
                           data-unit-qty="${unitQty2}"
                           onchange="updateInventoryCases(this)" />
                </td>
                <td class="inventory-cases-cell hide-in-compact">${cases}</td>
                <td class="actions-cell">
                    ${viewBtnHtml}
                    ${excludeBtnHtml}
                </td>
            </tr>
        `;
    })
    .join("");

  // Update select all checkbox state
  updateInventorySelectAllState();
}

// ============== Tracker History ==============

// Recompute a single inventory row's dynamic threshold from the tracker history
// already in cache (3 full past months, indices 0-2). Only rows whose threshold
// is "dynamic" are affected; manual/system thresholds keep their backend values.
// Falls back silently (keeps the invoices value) when tracker data is missing.
function recomputeRowFromTracker(upc) {
  if (dynamicThresholdSource !== "tracker") return;
  const product = allProducts.find((p) => p.ProductUPC === upc);
  if (!product || product.threshold_type !== "dynamic") return;

  const cache = trackerHistoryCache[upc];
  if (!cache) return;

  const monthSales = [];
  const monthDays = [];
  for (let i = 0; i < 3; i++) {
    const vals = cache[i];
    if (!vals) return; // incomplete history -> keep the invoices value
    monthSales.push(vals.sale || 0);
    const m = historyMonths[i];
    monthDays.push(trackerMonthDays(m.from, m.to));
  }

  const unitQty2 = product.UnitQty2 || 1;
  const effectiveQty =
    product.effective_qty != null
      ? product.effective_qty
      : product.QuantOnHand || 0;

  const res = calcTrackerThreshold({
    monthSales,
    monthDays,
    orderPeriodDays,
    unitQty2,
    effectiveQty,
  });

  product.threshold = res.threshold;
  product.dynamic_threshold = res.threshold;
  product.monthly_average = Math.ceil(res.monthlyAverage);
  product.daily_average = Math.round(res.dailyAverage * 100) / 100;
  product.needs_reorder = res.needsReorder;
  product.suggested_qty = res.suggestedQty;

  updateInventoryRowThresholdDOM(upc, product);
}

// Update the threshold/order-qty/cases cells of one already-rendered inventory
// row to match a recomputed product object.
function updateInventoryRowThresholdDOM(upc, product) {
  const rows = document.querySelectorAll(
    `#inventory-tbody tr[data-upc="${upc}"]`,
  );
  rows.forEach((row) => {
    const tcell = row.querySelector(".inv-threshold-cell");
    if (tcell) {
      const tt = product.threshold_type;
      const label =
        tt === "dynamic" ? "auto" : tt === "manual" ? "manual" : "system";
      tcell.innerHTML = `${(product.threshold || 0).toLocaleString()}<br><small class="threshold-type threshold-${tt}" title="${tt}">${label}</small>`;
    }

    // Only refresh the order qty when the user hasn't already put it in the cart.
    if (!inventorySelectedItems.has(upc)) {
      const input = row.querySelector(".inventory-order-qty-input");
      if (input) {
        const sq = product.suggested_qty || 0;
        const unitQty2 = parseInt(input.dataset.unitQty) || 1;
        input.value = sq;
        input.closest("td").classList.toggle("order-qty-highlight", sq > 0);
        const casesCell = row.querySelector(".inventory-cases-cell");
        if (casesCell) casesCell.textContent = Math.ceil(sq / unitQty2);
      }
    }
  });
}

function applyTrackerHistoryToDOM() {
  document.querySelectorAll("td.history-cell[data-upc]").forEach((cell) => {
    const upc = cell.dataset.upc;
    const mi = cell.dataset.month;
    const vals = trackerHistoryCache[upc] && trackerHistoryCache[upc][mi];
    if (vals) {
      const cq = parseInt(cell.dataset.caseQty) || 1;
      const saleRounded = Math.round(vals.sale);
      const purchaseRounded = Math.round(vals.purchase);
      const invRounded = Math.round(vals.beginning_inventory);
      cell.querySelector(".history-s").innerHTML =
        `${saleRounded.toLocaleString()} <span class="case-count">(${Math.round(saleRounded / cq).toLocaleString()})</span>`;
      cell.querySelector(".history-p").innerHTML =
        `${purchaseRounded.toLocaleString()} <span class="case-count">(${Math.round(purchaseRounded / cq).toLocaleString()})</span>`;
      cell.querySelector(".history-i").innerHTML =
        `${invRounded.toLocaleString()} <span class="case-count">(${Math.round(invRounded / cq).toLocaleString()})</span>`;
    }
  });

  if (dynamicThresholdSource === "tracker") {
    allProducts.forEach((p) => recomputeRowFromTracker(p.ProductUPC));
  }
}

function applyTrackerHistoryToRow(upc) {
  document
    .querySelectorAll(`td.history-cell[data-upc="${upc}"]`)
    .forEach((cell) => {
      const mi = cell.dataset.month;
      const vals = trackerHistoryCache[upc] && trackerHistoryCache[upc][mi];
      if (!vals) {
        const spinner = cell.querySelector(".history-spinner");
        if (spinner) spinner.remove();
        return;
      }
      const cq = parseInt(cell.dataset.caseQty) || 1;
      const saleRounded = Math.round(vals.sale);
      const purchaseRounded = Math.round(vals.purchase);
      const invRounded = Math.round(vals.beginning_inventory);

      const m = historyMonths[mi];
      const href = `${trackerUrl}?tracker=${upc}&from=${m.from}&to=${m.to}`;
      cell.innerHTML = `<a href="${href}" target="_blank" rel="noopener"><span class="history-line history-sale"><span class="history-label">&minus;</span><span class="history-s">${saleRounded.toLocaleString()} <span class="case-count">(${Math.round(saleRounded / cq).toLocaleString()})</span></span></span><span class="history-line history-purchase"><span class="history-label">+</span><span class="history-p">${purchaseRounded.toLocaleString()} <span class="case-count">(${Math.round(purchaseRounded / cq).toLocaleString()})</span></span></span><span class="history-line history-inv"><span class="history-s-spacer"></span><span class="history-i">${invRounded.toLocaleString()} <span class="case-count">(${Math.round(invRounded / cq).toLocaleString()})</span></span></span></a>`;
    });

  recomputeRowFromTracker(upc);
}

async function loadTrackerHistory(products) {
  const upcs = products.map((p) => p.ProductUPC).filter(Boolean);
  if (upcs.length === 0) return;

  const months = historyMonths.map((m) => ({ from: m.from, to: m.to }));
  const concurrency = 10;
  let index = 0;

  async function next() {
    while (index < upcs.length) {
      const upc = upcs[index++];
      if (trackerHistoryCache[upc]) {
        applyTrackerHistoryToRow(upc);
        continue;
      }
      try {
        const result = await api.post("/tracker/history", {
          upcs: [upc],
          months,
        });
        if (!result.success) throw new Error(result.error);

        for (const [returnedUpc, monthData] of Object.entries(result.data)) {
          trackerHistoryCache[returnedUpc] = {};
          for (const [mi, vals] of Object.entries(monthData)) {
            trackerHistoryCache[returnedUpc][mi] = vals;
          }
        }
        applyTrackerHistoryToRow(upc);
      } catch (error) {
        console.error(`Error loading tracker history for ${upc}:`, error);
        applyTrackerHistoryToRow(upc);
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, upcs.length) },
    () => next(),
  );
  await Promise.all(workers);
}

// ============== Inventory Selection Functions ==============

// Handle individual checkbox change in inventory table
function handleInventoryCheckboxChange(checkbox) {
  const upc = checkbox.dataset.upc;
  const row = checkbox.closest("tr");

  if (checkbox.checked) {
    // Extract and store product data from the row
    const product = allProducts.find((p) => p.ProductUPC === upc) || {};
    const orderQtyInput = row.querySelector(".inventory-order-qty-input");
    const orderQty = parseInt(orderQtyInput?.value) || 0;
    const unitQty2 = product.UnitQty2 || 1;

    inventoryCheckedItems.set(upc, {
      upc: upc,
      description:
        product.ProductDescription || row.cells[2]?.textContent || "-",
      on_hand: product.effective_qty || product.QuantOnHand || 0,
      case_qty: unitQty2,
      threshold: product.threshold || 0,
      suggested_qty: product.suggested_qty || 0,
      order_qty: orderQty,
      cases: Math.ceil(orderQty / unitQty2),
      unit_cost: parseFloat(product.UnitCost) || 0,
    });
  } else {
    inventoryCheckedItems.delete(upc);
  }

  updateInventoryExportBar();
  updateInventorySelectAllState();
}

// Update cases column when order qty changes
function updateInventoryCases(input) {
  const qty = parseInt(input.value) || 0;
  const unitQty = parseFloat(input.dataset.unitQty) || 1;
  const cases = Math.ceil(qty / unitQty);
  const row = input.closest("tr");
  const casesCell = row.querySelector(".inventory-cases-cell");
  if (casesCell) {
    casesCell.textContent = cases;
  }
  input.closest("td").classList.toggle("order-qty-highlight", qty > 0);

  const upc = input.dataset.upc;

  // Update checked items if item is checked
  if (upc && inventoryCheckedItems.has(upc)) {
    const data = inventoryCheckedItems.get(upc);
    data.order_qty = qty;
    data.cases = cases;
  }

  // Also update cart if item is in cart
  if (upc && inventorySelectedItems.has(upc)) {
    const data = inventorySelectedItems.get(upc);
    data.order_qty = qty;
    data.cases = cases;
    saveCartToStorage();
    renderCartSidebar();
  }
}

// Show/hide floating export bar based on checked (not cart) count
function updateInventoryExportBar() {
  const bar = document.getElementById("inventory-export-bar");
  if (!bar) return;

  const count = inventoryCheckedItems.size;
  if (count > 0) {
    bar.classList.remove("hidden");
    document.getElementById("inventory-selected-count").textContent =
      `${count} item${count !== 1 ? "s" : ""} selected`;
  } else {
    bar.classList.add("hidden");
  }
}

// Toggle select all checkbox in inventory table header
function toggleInventorySelectAll(checkbox) {
  const checkboxes = document.querySelectorAll(".inventory-checkbox");
  const shouldCheck = checkbox.checked;

  checkboxes.forEach((cb) => {
    if (cb.checked !== shouldCheck) {
      cb.checked = shouldCheck;
      const upc = cb.dataset.upc;
      const row = cb.closest("tr");

      if (shouldCheck) {
        const product = allProducts.find((p) => p.ProductUPC === upc) || {};
        const orderQtyInput = row.querySelector(".inventory-order-qty-input");
        const orderQty = parseInt(orderQtyInput?.value) || 0;
        const unitQty2 = product.UnitQty2 || 1;

        inventoryCheckedItems.set(upc, {
          upc: upc,
          description:
            product.ProductDescription || row.cells[2]?.textContent || "-",
          on_hand: product.effective_qty || product.QuantOnHand || 0,
          case_qty: unitQty2,
          threshold: product.threshold || 0,
          suggested_qty: product.suggested_qty || 0,
          order_qty: orderQty,
          cases: Math.ceil(orderQty / unitQty2),
          unit_cost: parseFloat(product.UnitCost) || 0,
        });
      } else {
        inventoryCheckedItems.delete(upc);
      }
    }
  });

  updateInventoryExportBar();
}

// Update select all checkbox state based on individual selections
function updateInventorySelectAllState() {
  const selectAll = document.getElementById("inventory-select-all");
  if (!selectAll) return;

  const checkboxes = document.querySelectorAll(".inventory-checkbox");
  if (checkboxes.length === 0) {
    selectAll.checked = false;
    selectAll.indeterminate = false;
    return;
  }

  const checkedCount = document.querySelectorAll(
    ".inventory-checkbox:checked",
  ).length;
  selectAll.checked = checkedCount === checkboxes.length;
  selectAll.indeterminate =
    checkedCount > 0 && checkedCount < checkboxes.length;
}

// Add checked items to cart
function addCheckedToCart() {
  if (inventoryCheckedItems.size === 0) {
    showToast("No items selected", "error");
    return;
  }

  const count = inventoryCheckedItems.size;

  // Merge checked items into cart
  inventoryCheckedItems.forEach((item, upc) => {
    inventorySelectedItems.set(upc, { ...item });
  });

  saveCartToStorage();
  renderCartSidebar();

  // Clear checkboxes and checked state
  inventoryCheckedItems.clear();
  document
    .querySelectorAll(".inventory-checkbox")
    .forEach((cb) => (cb.checked = false));
  const selectAll = document.getElementById("inventory-select-all");
  if (selectAll) {
    selectAll.checked = false;
    selectAll.indeterminate = false;
  }
  updateInventoryExportBar();

  showToast(`${count} item${count !== 1 ? "s" : ""} added to cart`, "success");
}

// ============== Cart Sidebar Functions ==============

// Load cart from localStorage on page load
function loadCartFromStorage() {
  try {
    const saved = localStorage.getItem(CART_STORAGE_KEY);
    if (saved) {
      const items = JSON.parse(saved);
      inventorySelectedItems.clear();
      items.forEach((item) => inventorySelectedItems.set(item.upc, item));
      renderCartSidebar();
    }
  } catch (e) {
    console.error("Failed to load cart from storage:", e);
  }
}

// Save cart to localStorage
function saveCartToStorage() {
  try {
    const items = Array.from(inventorySelectedItems.values());
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
  } catch (e) {
    console.error("Failed to save cart to storage:", e);
  }
}

// Render cart sidebar content
function renderCartSidebar() {
  const list = document.getElementById("cart-items-list");
  if (!list) return;

  const items = Array.from(inventorySelectedItems.values());

  if (items.length === 0) {
    list.innerHTML = '<div class="cart-empty">No items in cart</div>';
  } else {
    list.innerHTML = items
      .map(
        (item) => `
      <div class="cart-item" data-upc="${item.upc}">
        <div class="cart-item-info">
          <span class="cart-item-desc" title="${escapeHtml(item.description)}">${escapeHtml(item.description)}</span>
          <span class="cart-item-upc">${item.upc}</span>
        </div>
        <div class="cart-item-qty">
          <input type="number" class="cart-qty-input" value="${item.order_qty || 0}"
                 min="0" data-upc="${item.upc}"
                 onchange="updateCartItemQty(this)" />
        </div>
        <button class="cart-item-remove" onclick="removeFromCart('${item.upc}')" title="Remove">&times;</button>
      </div>
    `,
      )
      .join("");
  }

  updateCartSummary();
  updateCartBadge();
}

// Update cart summary totals
function updateCartSummary() {
  const items = Array.from(inventorySelectedItems.values());
  const totalItems = items.length;
  const totalQty = items.reduce((sum, item) => sum + (item.order_qty || 0), 0);
  const totalCost = items.reduce(
    (sum, item) => sum + (item.order_qty || 0) * (item.unit_cost || 0),
    0,
  );

  const itemsEl = document.getElementById("cart-summary-items");
  const qtyEl = document.getElementById("cart-summary-qty");
  const costEl = document.getElementById("cart-summary-cost");

  if (itemsEl) itemsEl.textContent = totalItems;
  if (qtyEl) qtyEl.textContent = totalQty.toLocaleString();
  if (costEl) costEl.textContent = "$" + totalCost.toFixed(2);
}

// Update cart navbar badge
function updateCartBadge() {
  const count = inventorySelectedItems.size;
  const badge = document.getElementById("nav-cart-badge");
  if (badge) {
    badge.textContent = count;
    badge.classList.toggle("visible", count > 0);
  }
}

// Toggle cart sidebar open/closed
function toggleCartSidebar() {
  const sidebar = document.getElementById("inventory-cart-sidebar");
  if (sidebar) {
    sidebar.classList.toggle("collapsed");
  }
}

// Remove item from cart
function removeFromCart(upc) {
  inventorySelectedItems.delete(upc);
  saveCartToStorage();
  renderCartSidebar();
}

// Update cart item quantity from cart input
function updateCartItemQty(input) {
  const upc = input.dataset.upc;
  const qty = parseInt(input.value) || 0;
  if (inventorySelectedItems.has(upc)) {
    const item = inventorySelectedItems.get(upc);
    item.order_qty = qty;
    item.cases = Math.ceil(qty / (item.case_qty || 1));
    saveCartToStorage();
    updateCartSummary();
    // Also update inventory table if visible
    syncInventoryRowWithCart(upc);
  }
}

// Clear entire cart
function clearCart() {
  inventorySelectedItems.clear();
  saveCartToStorage();
  renderCartSidebar();
}

// Sync order qty values from cart (after search/filter/pagination)
function syncCheckboxesWithCart() {
  inventoryCheckedItems.clear();
  document.querySelectorAll(".inventory-checkbox").forEach((cb) => {
    const upc = cb.dataset.upc;
    cb.checked = false;

    // Sync order qty input if item is in cart
    if (inventorySelectedItems.has(upc)) {
      const row = cb.closest("tr");
      const input = row?.querySelector(".inventory-order-qty-input");
      if (input) {
        const cartItem = inventorySelectedItems.get(upc);
        input.value = cartItem.order_qty || 0;
        const casesCell = row.querySelector(".inventory-cases-cell");
        if (casesCell) casesCell.textContent = cartItem.cases || 0;
      }
    }
  });
  updateInventorySelectAllState();
  updateInventoryExportBar();
}

// Sync single inventory row with cart (when qty changes in cart)
function syncInventoryRowWithCart(upc) {
  const checkbox = document.querySelector(
    `.inventory-checkbox[data-upc="${upc}"]`,
  );
  if (checkbox) {
    const row = checkbox.closest("tr");
    const input = row?.querySelector(".inventory-order-qty-input");
    const cartItem = inventorySelectedItems.get(upc);
    if (input && cartItem) {
      input.value = cartItem.order_qty;
      const casesCell = row.querySelector(".inventory-cases-cell");
      if (casesCell) casesCell.textContent = cartItem.cases || 0;
    }
  }
}

// Export from cart (alias for existing function)
function exportCartToExcel() {
  if (inventorySelectedItems.size === 0) {
    showToast("No items in cart to export", "error");
    return;
  }
  exportInventoryToExcel();
}

// Clear all checked selections (not cart)
function clearInventorySelection() {
  inventoryCheckedItems.clear();
  document
    .querySelectorAll(".inventory-checkbox")
    .forEach((cb) => (cb.checked = false));
  const selectAll = document.getElementById("inventory-select-all");
  if (selectAll) {
    selectAll.checked = false;
    selectAll.indeterminate = false;
  }
  updateInventoryExportBar();
}

// Export selected inventory items to Excel (with PO creation option)
async function exportInventoryToExcel() {
  const columnsParam = getInventorySelectedColumnsParam();
  if (columnsParam === null) {
    showToast("Please select at least one column to export", "error");
    return;
  }

  if (inventorySelectedItems.size === 0) {
    showToast("No items selected", "error");
    return;
  }

  // Save as order draft first, then show PO prompt
  const orderId = await saveInventoryAsOrderDraft();
  if (orderId) {
    showCreatePoPrompt(orderId, "excel", null, null);
  }
}

// Export selected inventory items to PDF (with PO creation option)
async function exportInventoryToPDF() {
  const columnsParam = getInventorySelectedColumnsParam();
  if (columnsParam === null) {
    showToast("Please select at least one column to export", "error");
    return;
  }

  if (inventorySelectedItems.size === 0) {
    showToast("No items selected", "error");
    return;
  }

  // Save as order draft first, then show PO prompt
  const orderId = await saveInventoryAsOrderDraft();
  if (orderId) {
    showCreatePoPrompt(orderId, "pdf", null, null);
  }
}

// Save selected inventory items as an order draft
async function saveInventoryAsOrderDraft() {
  const items = Array.from(inventorySelectedItems.values());

  // Build order items from inventory selection
  // Backend expects: upc, description, on_hand, threshold, suggested_qty, order_qty, unit_qty2, unit_cost
  const orderItems = items.map((item) => ({
    upc: item.upc,
    description: item.description,
    on_hand: item.on_hand || 0,
    threshold: item.threshold || 0,
    suggested_qty: item.suggested_qty || 0,
    order_qty: item.order_qty || item.suggested_qty || 0,
    unit_qty2: item.case_qty || 1,
    unit_cost: item.unit_cost || 0,
  }));

  const orderName = `Inventory Export ${new Date().toLocaleString()}`;

  try {
    const result = await api.post("/orders", {
      name: orderName,
      supplier_id: null,
      supplier_name: null,
      items: orderItems,
    });

    if (result.success) {
      return result.id;
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    console.error("Error saving inventory as order:", error);
    showToast(`Error: ${error.message}`, "error");
    return null;
  }
}

// ============== Inventory Column Selector ==============

// Reuse the same column config as orders
const inventoryExportColumnConfig = [
  { id: "upc", label: "UPC", default: true },
  { id: "description", label: "Description", default: true },
  { id: "on_hand", label: "On Hand", default: true },
  { id: "threshold", label: "Threshold", default: true },
  { id: "order_qty", label: "Order Qty", default: true },
  { id: "cases", label: "Cases", default: true },
  { id: "unit_cost", label: "Unit Cost", default: true },
  { id: "total", label: "Total", default: true },
];

// Track selected inventory export columns - load from localStorage or use defaults
function loadInventoryExportColumns() {
  const saved = localStorage.getItem("inventoryExportColumns");
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      const validColumns = parsed.filter((col) =>
        inventoryExportColumnConfig.some((c) => c.id === col),
      );
      if (validColumns.length > 0) {
        return new Set(validColumns);
      }
    } catch (e) {
      console.warn("Failed to parse saved inventory export columns:", e);
    }
  }
  return new Set(
    inventoryExportColumnConfig.filter((c) => c.default).map((c) => c.id),
  );
}

function saveInventoryExportColumns() {
  localStorage.setItem(
    "inventoryExportColumns",
    JSON.stringify(Array.from(inventoryExportColumns)),
  );
}

let inventoryExportColumns = loadInventoryExportColumns();

function initInventoryColumnSelector() {
  const container = document.getElementById(
    "inventory-column-selector-options",
  );
  if (!container) return;

  container.innerHTML = inventoryExportColumnConfig
    .map(
      (col) => `
    <div class="column-option">
      <input type="checkbox" id="inv-col-${col.id}"
             ${inventoryExportColumns.has(col.id) ? "checked" : ""}
             onchange="toggleInventoryColumn('${col.id}')" />
      <label for="inv-col-${col.id}">${col.label}</label>
    </div>
  `,
    )
    .join("");
}

function toggleInventoryColumnSelector() {
  const panel = document.getElementById("inventory-column-selector-panel");
  const btn = document.querySelector("#inventory-export-bar .btn-columns");

  if (panel) {
    panel.classList.toggle("active");
    btn?.classList.toggle("active");
  }
}

function toggleInventoryColumn(columnId) {
  if (inventoryExportColumns.has(columnId)) {
    inventoryExportColumns.delete(columnId);
  } else {
    inventoryExportColumns.add(columnId);
  }
  saveInventoryExportColumns();
}

function selectAllInventoryColumns(select) {
  if (select) {
    inventoryExportColumnConfig.forEach((col) =>
      inventoryExportColumns.add(col.id),
    );
  } else {
    inventoryExportColumns.clear();
  }
  inventoryExportColumnConfig.forEach((col) => {
    const checkbox = document.getElementById(`inv-col-${col.id}`);
    if (checkbox) checkbox.checked = select;
  });
  saveInventoryExportColumns();
}

function getInventorySelectedColumnsParam() {
  if (inventoryExportColumns.size === 0) {
    return null;
  }
  if (inventoryExportColumns.size === inventoryExportColumnConfig.length) {
    return "";
  }
  return Array.from(inventoryExportColumns).join(",");
}

// Close inventory column selector when clicking outside
document.addEventListener("click", (e) => {
  const panel = document.getElementById("inventory-column-selector-panel");
  const wrapper = e.target.closest(".column-selector-wrapper");
  const isInInventoryBar = e.target.closest("#inventory-export-bar");

  if (
    panel &&
    panel.classList.contains("active") &&
    (!wrapper || !isInInventoryBar)
  ) {
    panel.classList.remove("active");
    document
      .querySelector("#inventory-export-bar .btn-columns")
      ?.classList.remove("active");
  }
});

// Initialize inventory column selector on page load
document.addEventListener("DOMContentLoaded", () => {
  initInventoryColumnSelector();
});

function searchProducts() {
  const searchTerm = document.getElementById("inventory-search").value.trim();
  // Selections persist across searches (cart behavior)
  loadInventory(1, searchTerm);
}

// Toggle product exclusion
async function toggleExclude(upc) {
  try {
    const result = await api.post(`/products/${upc}/exclude`, {});

    if (result.success) {
      const action = result.excluded ? "excluded" : "included";
      showToast(`Product ${action} successfully`, "success");
      loadInventory(currentPage, currentSearch);
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    console.error("Error toggling exclusion:", error);
    showToast(`Error: ${error.message}`, "error");
  }
}

// Toggle showing excluded products
function toggleShowExcluded() {
  const checkbox = document.getElementById("show-excluded-checkbox");
  showExcludedProducts = checkbox ? checkbox.checked : false;
  loadInventory(1, currentSearch);
}

// Set inventory view mode (table or grouped)
function setInventoryView(mode) {
  inventoryViewMode = mode;
  localStorage.setItem("inventoryViewMode", mode);

  // Update toggle button states
  document.querySelectorAll(".view-toggle-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === mode);
  });

  // Reload data - grouped view needs ALL products, table view uses pagination
  loadInventory(mode === "table" ? currentPage : 1, currentSearch);
}

// Toggle compact view (hide less important columns)
function toggleCompactView() {
  isCompactView = !isCompactView;
  localStorage.setItem("inventoryCompactView", isCompactView);

  // Update button state
  const btn = document.getElementById("compact-view-btn");
  if (btn) {
    btn.classList.toggle("active", isCompactView);
  }

  // Toggle compact class on table container
  const tableContainer = document.getElementById("inventory-table-container");
  if (tableContainer) {
    tableContainer.classList.toggle("compact-view", isCompactView);
  }

  // Re-render the table to update badge format and action buttons
  if (inventoryViewMode === "table" && allProducts.length > 0) {
    renderInventoryTable(allProducts, true);
    applyTrackerHistoryToDOM();
  }
}

// Initialize compact view state on page load
function initCompactView() {
  const btn = document.getElementById("compact-view-btn");
  if (btn) {
    btn.classList.toggle("active", isCompactView);
  }

  const tableContainer = document.getElementById("inventory-table-container");
  if (tableContainer) {
    tableContainer.classList.toggle("compact-view", isCompactView);
  }
}

// Render grouped view (supplier cards)
function renderGroupedView(products) {
  const container = document.getElementById("supplier-cards-container");
  const grid = document.getElementById("supplier-cards-grid");

  if (!products || products.length === 0) {
    grid.innerHTML = '<div class="info-card"><p>No products found</p></div>';
    return;
  }

  // Group products by supplier
  const supplierGroups = {};
  products.forEach((p) => {
    const supplier = p.last_supplier || "No Supplier";
    if (!supplierGroups[supplier]) {
      supplierGroups[supplier] = {
        name: supplier,
        products: [],
        reorderCount: 0,
        estimatedOrderCost: 0,
      };
    }
    supplierGroups[supplier].products.push(p);
    if (p.needs_reorder) {
      supplierGroups[supplier].reorderCount++;
      // Calculate estimated order cost: suggested_qty × UnitCost
      supplierGroups[supplier].estimatedOrderCost +=
        (p.suggested_qty || 0) * (parseFloat(p.UnitCost) || 0);
    }
  });

  // Cache supplier groups for use when navigating to orders
  cachedSupplierGroups = supplierGroups;

  // Separate visible and hidden suppliers
  const visibleSuppliers = [];
  const hiddenSuppliers = [];

  Object.values(supplierGroups).forEach((group) => {
    if (excludedSuppliers.has(group.name)) {
      hiddenSuppliers.push(group);
    } else {
      visibleSuppliers.push(group);
    }
  });

  // Sort visible by estimated order cost, "No Supplier" at end
  visibleSuppliers.sort((a, b) => {
    if (a.name === "No Supplier") return 1;
    if (b.name === "No Supplier") return -1;
    return b.estimatedOrderCost - a.estimatedOrderCost;
  });

  // Build hidden suppliers indicator HTML
  let hiddenIndicatorHtml = "";
  if (hiddenSuppliers.length > 0) {
    hiddenIndicatorHtml = `
      <div class="hidden-suppliers-indicator">
        <span>${hiddenSuppliers.length} supplier${hiddenSuppliers.length > 1 ? "s" : ""} hidden</span>
        <button type="button" class="btn-text" onclick="showExcludedSuppliersModal()">Manage</button>
      </div>
    `;
  }

  // Render cards with exclude button
  const cardsHtml = visibleSuppliers
    .map((group) => {
      const isNoSupplier = group.name === "No Supplier";
      const cardClass = isNoSupplier
        ? "supplier-card no-supplier"
        : "supplier-card";
      const currentFilter = document.getElementById("inventory-filter").value;
      const escapedName = escapeHtml(group.name);
      const escapedNameForJs = escapedName.replace(/'/g, "\\'");

      return `
      <div class="${cardClass}">
        <div class="supplier-card-content" onclick="navigateToOrdersWithSupplier('${escapedNameForJs}', '${currentFilter}')">
          <div class="supplier-card-name">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
              <circle cx="12" cy="7" r="4"></circle>
            </svg>
            ${escapedName}
          </div>
          <div class="supplier-card-stats">
            <span class="stat">${group.products.length} products</span>
            ${group.reorderCount > 0 ? `<span class="stat reorder">${group.reorderCount} need reorder</span>` : ""}
            ${group.estimatedOrderCost > 0 ? `<span class="stat value">$${group.estimatedOrderCost.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} est. order</span>` : ""}
          </div>
        </div>
        <div class="supplier-card-actions">
          <button type="button" class="supplier-exclude-btn" onclick="event.stopPropagation(); excludeSupplierFromView('${escapedNameForJs}')" title="Hide this supplier">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
              <line x1="1" y1="1" x2="23" y2="23"></line>
            </svg>
          </button>
          <div class="supplier-card-arrow" onclick="navigateToOrdersWithSupplier('${escapedNameForJs}', '${currentFilter}')">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
          </div>
        </div>
      </div>
    `;
    })
    .join("");

  // Insert hidden indicator before grid by replacing container inner HTML
  const existingIndicator = container.querySelector(
    ".hidden-suppliers-indicator",
  );
  if (existingIndicator) {
    existingIndicator.remove();
  }

  grid.innerHTML = cardsHtml;

  if (hiddenIndicatorHtml) {
    grid.insertAdjacentHTML("beforebegin", hiddenIndicatorHtml);
  }
}

// Navigate to Orders page with supplier and filter pre-selected
function navigateToOrdersWithSupplier(supplierName, inventoryFilter) {
  // Map inventory filter to orders filter
  const filterMap = {
    all: "all",
    reorder: "needs_reorder",
    stocked: "all",
  };

  pendingOrderSupplier = supplierName;
  pendingOrderFilter = filterMap[inventoryFilter] || "all";
  pendingOrderAutoLoad = true;

  // For "No Supplier", pass the actual products instead of relying on API filter
  if (supplierName === "No Supplier" && cachedSupplierGroups["No Supplier"]) {
    pendingNoSupplierProducts = cachedSupplierGroups["No Supplier"].products;
  } else {
    pendingNoSupplierProducts = null;
  }

  navigateTo("orders");
}

// Helper function to escape HTML
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// Sorting functions for Inventory table
function sortInventory(column) {
  if (inventorySortBy === column) {
    inventorySortOrder = inventorySortOrder === "asc" ? "desc" : "asc";
  } else {
    inventorySortBy = column;
    inventorySortOrder = "asc";
  }
  currentPage = 1; // Reset to first page when sorting changes
  loadInventory(1, currentSearch);
  updateSortIndicators("inventory");
}

// Sorting functions for Orders table
function sortOrders(column) {
  if (ordersSortBy === column) {
    ordersSortOrder = ordersSortOrder === "asc" ? "desc" : "asc";
  } else {
    ordersSortBy = column;
    ordersSortOrder = "asc";
  }
  loadNeedsReorder();
  updateSortIndicators("orders");
}

// Update sort indicators on table headers
function updateSortIndicators(table) {
  const tableId =
    table === "inventory"
      ? "inventory-table"
      : table === "tracking"
        ? "tracking-table"
        : "order-table";
  const sortBy =
    table === "inventory"
      ? inventorySortBy
      : table === "tracking"
        ? trackingSortBy
        : ordersSortBy;
  const sortOrder =
    table === "inventory"
      ? inventorySortOrder
      : table === "tracking"
        ? trackingSortOrder
        : ordersSortOrder;

  // Remove all indicators
  document.querySelectorAll(`#${tableId} th .sort-indicator`).forEach((el) => {
    el.textContent = "";
  });

  // Add indicator to current column
  if (sortBy) {
    const header = document.querySelector(
      `#${tableId} th[data-sort="${sortBy}"] .sort-indicator`,
    );
    if (header) {
      header.textContent = sortOrder === "asc" ? " ▲" : " ▼";
    }
  }
}

// Current product being viewed in modal
let currentProductUpc = null;

async function viewProduct(upc) {
  currentProductUpc = upc;
  const modal = document.getElementById("product-modal");

  try {
    const result = await api.get(`/products/${upc}`);

    if (!result.success) {
      throw new Error(result.error);
    }

    const product = result.product;
    const salesData = result.sales_data;
    const override = result.override;

    // Populate modal fields
    document.getElementById("modal-upc").textContent =
      product.ProductUPC || "-";
    document.getElementById("modal-description").textContent =
      product.ProductDescription || "-";
    document.getElementById("modal-sku").textContent =
      product.ProductSKU || "-";

    document.getElementById("modal-qty-on-hand").textContent = (
      product.QuantOnHand || 0
    ).toLocaleString();
    document.getElementById("modal-pending-po-qty").textContent = (
      product.pending_po_qty || 0
    ).toLocaleString();
    document.getElementById("modal-qip-qty").textContent = (
      product.qip_qty || 0
    ).toLocaleString();
    document.getElementById("modal-effective-qty").textContent = (
      product.effective_qty ||
      product.QuantOnHand ||
      0
    ).toLocaleString();
    document.getElementById("modal-threshold").textContent = Math.ceil(
      salesData.monthly_average,
    );
    document.getElementById("modal-monthly-avg").textContent = Math.ceil(
      salesData.monthly_average,
    );
    document.getElementById("modal-daily-avg").textContent =
      salesData.daily_average.toFixed(2);

    document.getElementById("modal-total-sold").textContent =
      salesData.total_sold.toLocaleString();
    document.getElementById("modal-invoice-count").textContent =
      salesData.invoice_count;
    document.getElementById("modal-unit-cost").textContent =
      `$${parseFloat(product.UnitCost || 0).toFixed(2)}`;
    document.getElementById("modal-case-qty").value = product.UnitQty2 || "";

    // Set cost override placeholder to show current system cost
    const systemCost = parseFloat(product.UnitCost || 0);
    const costInput = document.getElementById("override-unit-cost");
    costInput.placeholder = `Current: $${systemCost.toFixed(2)}`;

    // Populate override form
    if (override) {
      document.getElementById("override-exclude").checked =
        override.exclude_from_dynamic || false;
      document.getElementById("override-threshold").value =
        override.manual_threshold || "";
      document.getElementById("override-order-qty").value =
        override.manual_order_qty || "";
      document.getElementById("override-order-period-days").value =
        override.manual_order_period_days || "";
      costInput.value =
        override.manual_unit_cost != null ? override.manual_unit_cost : "";
      document.getElementById("override-notes").value = override.notes || "";
    } else {
      document.getElementById("override-exclude").checked = false;
      document.getElementById("override-threshold").value = "";
      document.getElementById("override-order-qty").value = "";
      document.getElementById("override-order-period-days").value = "";
      costInput.value = "";
      document.getElementById("override-notes").value = "";
    }

    // Show modal
    modal.classList.add("active");
  } catch (error) {
    console.error("Error loading product:", error);
    showToast(`Error loading product: ${error.message}`, "error");
  }
}

function closeProductModal() {
  const modal = document.getElementById("product-modal");
  modal.classList.remove("active");
  currentProductUpc = null;
}

async function saveCaseQty() {
  if (!currentProductUpc) {
    showToast("No product selected", "error");
    return;
  }

  const input = document.getElementById("modal-case-qty");
  const value = parseInt(input.value);

  if (!value || value < 1) {
    showToast("Please enter a valid case quantity (minimum 1)", "error");
    return;
  }

  try {
    const result = await api.put(`/products/${currentProductUpc}/unit-qty2`, {
      unit_qty2: value,
    });

    if (result.success) {
      showToast("Case quantity saved", "success");
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    showToast(`Error saving case qty: ${error.message}`, "error");
  }
}

async function saveOverride(e) {
  e.preventDefault();

  if (!currentProductUpc) {
    showToast("No product selected", "error");
    return;
  }

  const overrideData = {
    exclude_from_dynamic: document.getElementById("override-exclude").checked,
    manual_threshold: document.getElementById("override-threshold").value
      ? parseInt(document.getElementById("override-threshold").value)
      : null,
    manual_order_qty: document.getElementById("override-order-qty").value
      ? parseInt(document.getElementById("override-order-qty").value)
      : null,
    manual_order_period_days: document.getElementById(
      "override-order-period-days",
    ).value
      ? parseInt(document.getElementById("override-order-period-days").value)
      : null,
    manual_unit_cost: document.getElementById("override-unit-cost").value
      ? parseFloat(document.getElementById("override-unit-cost").value)
      : null,
    notes: document.getElementById("override-notes").value || null,
  };

  try {
    const result = await api.post(
      `/products/${currentProductUpc}/override`,
      overrideData,
    );

    if (result.success) {
      showToast("Override saved successfully", "success");
      closeProductModal();
      // Reload inventory to reflect changes, preserving search/filter state
      loadInventory(currentPage, currentSearch);
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    console.error("Error saving override:", error);
    showToast(`Error saving override: ${error.message}`, "error");
  }
}

async function clearOverride() {
  if (!currentProductUpc) {
    showToast("No product selected", "error");
    return;
  }

  if (
    !confirm("Are you sure you want to clear the override for this product?")
  ) {
    return;
  }

  try {
    const result = await api.delete(`/products/${currentProductUpc}/override`);

    if (result.success) {
      showToast("Override cleared", "success");
      closeProductModal();
      loadInventory(currentPage, currentSearch);
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    console.error("Error clearing override:", error);
    showToast(`Error clearing override: ${error.message}`, "error");
  }
}

// ============== Bulk Override Functions ==============

function openBulkOverrideModal() {
  if (inventoryCheckedItems.size === 0) {
    showToast("No products selected", "error");
    return;
  }

  const modal = document.getElementById("bulk-override-modal");
  document.getElementById("bulk-override-title").textContent =
    `Bulk Override — ${inventoryCheckedItems.size} product${inventoryCheckedItems.size > 1 ? "s" : ""} selected`;

  // Reset all apply checkboxes and fields
  modal
    .querySelectorAll(".bulk-apply-toggle input[type='checkbox']")
    .forEach((cb) => {
      cb.checked = false;
    });
  document.getElementById("bulk-exclude-dynamic").checked = false;
  document.getElementById("bulk-exclude-dynamic").disabled = true;
  document.getElementById("bulk-manual-threshold").value = "";
  document.getElementById("bulk-manual-threshold").disabled = true;
  document.getElementById("bulk-manual-order-qty").value = "";
  document.getElementById("bulk-manual-order-qty").disabled = true;
  document.getElementById("bulk-order-period").value = "";
  document.getElementById("bulk-order-period").disabled = true;
  document.getElementById("bulk-unit-cost").value = "";
  document.getElementById("bulk-unit-cost").disabled = true;
  document.getElementById("bulk-notes").value = "";
  document.getElementById("bulk-notes").disabled = true;

  // Reset active highlights
  modal.querySelectorAll(".bulk-override-field").forEach((row) => {
    row.classList.remove("active");
  });

  modal.classList.add("active");
}

function closeBulkOverrideModal() {
  document.getElementById("bulk-override-modal").classList.remove("active");
}

function toggleBulkField(checkbox, fieldId) {
  const field = document.getElementById(fieldId);
  const row = checkbox.closest(".bulk-override-field");
  field.disabled = !checkbox.checked;
  row.classList.toggle("active", checkbox.checked);
  if (checkbox.checked) {
    field.focus();
  }
}

async function applyBulkOverride() {
  const upcs = Array.from(inventoryCheckedItems.keys());
  const fields = {};

  const modal = document.getElementById("bulk-override-modal");
  const applyChecks = modal.querySelectorAll(
    ".bulk-apply-toggle input[type='checkbox']",
  );
  let anyChecked = false;

  applyChecks.forEach((cb) => {
    if (!cb.checked) return;
    anyChecked = true;
  });

  if (!anyChecked) {
    showToast("Check at least one 'Apply' toggle", "error");
    return;
  }

  // Collect checked fields
  if (
    modal.querySelector("#bulk-field-exclude-dynamic .bulk-apply-toggle input")
      .checked
  ) {
    fields.exclude_from_dynamic = document.getElementById(
      "bulk-exclude-dynamic",
    ).checked;
  }
  if (
    modal.querySelector("#bulk-field-manual-threshold .bulk-apply-toggle input")
      .checked
  ) {
    const val = document.getElementById("bulk-manual-threshold").value;
    fields.manual_threshold = val ? parseInt(val) : null;
  }
  if (
    modal.querySelector("#bulk-field-manual-order-qty .bulk-apply-toggle input")
      .checked
  ) {
    const val = document.getElementById("bulk-manual-order-qty").value;
    fields.manual_order_qty = val ? parseInt(val) : null;
  }
  if (
    modal.querySelector("#bulk-field-order-period .bulk-apply-toggle input")
      .checked
  ) {
    const val = document.getElementById("bulk-order-period").value;
    fields.manual_order_period_days = val ? parseInt(val) : null;
  }
  if (
    modal.querySelector("#bulk-field-unit-cost .bulk-apply-toggle input")
      .checked
  ) {
    const val = document.getElementById("bulk-unit-cost").value;
    fields.manual_unit_cost = val ? parseFloat(val) : null;
  }
  if (
    modal.querySelector("#bulk-field-notes .bulk-apply-toggle input").checked
  ) {
    const val = document.getElementById("bulk-notes").value;
    fields.notes = val || null;
  }

  if (
    !confirm(
      `Apply overrides to ${upcs.length} product${upcs.length > 1 ? "s" : ""}?`,
    )
  )
    return;

  try {
    const result = await api.post("/products/bulk-override", {
      upcs,
      fields,
      mode: "merge",
    });

    if (result.success) {
      showToast(
        `Override applied to ${result.affected} product${result.affected > 1 ? "s" : ""}`,
        "success",
      );
      closeBulkOverrideModal();
      loadInventory(currentPage, currentSearch);
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    console.error("Error applying bulk override:", error);
    showToast(`Error: ${error.message}`, "error");
  }
}

async function bulkClearOverrides() {
  const upcs = Array.from(inventoryCheckedItems.keys());

  if (
    !confirm(
      `Clear ALL overrides for ${upcs.length} product${upcs.length > 1 ? "s" : ""}?`,
    )
  )
    return;

  try {
    const result = await api.post("/products/bulk-override", {
      upcs,
      mode: "clear",
    });

    if (result.success) {
      showToast(
        `Overrides cleared for ${result.affected} product${result.affected > 1 ? "s" : ""}`,
        "success",
      );
      closeBulkOverrideModal();
      loadInventory(currentPage, currentSearch);
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    console.error("Error clearing bulk overrides:", error);
    showToast(`Error: ${error.message}`, "error");
  }
}

// Initialize modal event listeners
document.addEventListener("DOMContentLoaded", () => {
  const overrideForm = document.getElementById("override-form");
  if (overrideForm) {
    overrideForm.addEventListener("submit", saveOverride);
  }

  // Close modal when clicking outside
  const modal = document.getElementById("product-modal");
  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) {
        closeProductModal();
      }
    });
  }

  // Close bulk override modal when clicking outside
  const bulkModal = document.getElementById("bulk-override-modal");
  if (bulkModal) {
    bulkModal.addEventListener("click", (e) => {
      if (e.target === bulkModal) {
        closeBulkOverrideModal();
      }
    });
  }

  // Global ESC key handler for all modals
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      // First check for bulk override modal
      const bulkModal = document.getElementById("bulk-override-modal");
      if (bulkModal && bulkModal.classList.contains("active")) {
        closeBulkOverrideModal();
        return;
      }

      // Then check for product modal
      const productModal = document.getElementById("product-modal");
      if (productModal && productModal.classList.contains("active")) {
        closeProductModal();
        return;
      }

      // Then check for any dynamically created modals
      const dynamicModal = document.querySelector(".modal.active");
      if (dynamicModal) {
        dynamicModal.remove();
        return;
      }

      // Close column selector panel if open
      const columnPanel = document.getElementById("column-selector-panel");
      if (columnPanel && columnPanel.classList.contains("active")) {
        columnPanel.classList.remove("active");
        document.querySelector(".btn-columns")?.classList.remove("active");
      }
    }
  });
});

// Filter change handler
document.addEventListener("DOMContentLoaded", () => {
  const filterSelect = document.getElementById("inventory-filter");
  if (filterSelect) {
    filterSelect.addEventListener("change", () => {
      // Selections persist across filter changes (cart behavior)
      loadInventory(1, currentSearch);
    });
  }

  // Search on Enter key
  const searchInput = document.getElementById("inventory-search");
  if (searchInput) {
    searchInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        searchProducts();
      }
    });
  }
});

// ============== Tracking Page ==============

let trackingAllProducts = [];

async function loadTracking(page = 1, search = "") {
  const tbody = document.getElementById("tracking-tbody");
  const tfoot = document.getElementById("tracking-tfoot");

  // Show empty state when no search term
  if (!search) {
    tbody.innerHTML =
      '<tr><td colspan="12" class="loading">Enter a search term to load products</td></tr>';
    tfoot.innerHTML = "";
    trackingCurrentPage = 1;
    trackingTotalPages = 1;
    trackingTotalProducts = 0;
    trackingCurrentSearch = "";
    trackingAllProducts = [];
    updateTrackingPagination();
    trackingLoaded = true;
    return;
  }

  tbody.innerHTML =
    '<tr><td colspan="12" class="loading">Loading products...</td></tr>';
  tfoot.innerHTML = "";

  trackingCurrentPage = page;
  trackingCurrentSearch = search;
  const currentFilter = document.getElementById("tracking-filter").value;

  try {
    const offset = (page - 1) * itemsPerPage;
    let endpoint = `/products?limit=${itemsPerPage}&offset=${offset}&filter=${currentFilter}&include_totals=true&show_excluded=true`;
    if (search) {
      endpoint += `&search=${encodeURIComponent(search)}`;
    }
    endpoint += `&sort_by=${trackingSortBy}&sort_order=${trackingSortOrder}`;

    const result = await api.get(endpoint);

    if (!result.success) {
      throw new Error(result.error);
    }

    trackingAllProducts = result.products;
    trackingTotalProducts = result.total_count;
    trackingTotalPages = Math.ceil(trackingTotalProducts / itemsPerPage);

    renderTrackingTable(trackingAllProducts);
    updateTrackingPagination();
    renderTrackingTotals(result.total_effective_qty, result.total_cost);
    loadTrackingHistory(trackingAllProducts);
    updateSortIndicators("tracking");
    trackingLoaded = true;
  } catch (error) {
    console.error("Error loading tracking:", error);
    tbody.innerHTML = `<tr><td colspan="12" class="loading">Error: ${error.message}</td></tr>`;
  }
}

function renderTrackingTable(products) {
  const tbody = document.getElementById("tracking-tbody");

  if (products.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="12" class="loading">No products found</td></tr>';
    return;
  }

  tbody.innerHTML = products
    .map((product) => {
      const qtyOnHand = product.QuantOnHand || 0;
      const pendingPoQty = product.pending_po_qty || 0;
      const effectiveQty = product.effective_qty || qtyOnHand;
      const unitQty2 = product.UnitQty2 || 1;
      const upc = product.ProductUPC || "";
      const unitCost = parseFloat(product.UnitCost) || 0;
      const totalCost = effectiveQty * unitCost;

      // Build effective qty tooltip
      const qipQty = product.qip_qty || 0;
      const tooltipParts = [`On Hand: ${qtyOnHand.toLocaleString()}`];
      if (pendingPoQty > 0)
        tooltipParts.push(`On Order: +${pendingPoQty.toLocaleString()}`);
      if (qipQty > 0)
        tooltipParts.push(`In Progress: -${qipQty.toLocaleString()}`);
      const qtyTooltip = tooltipParts.join(", ");

      let superscripts = "";
      if (pendingPoQty > 0)
        superscripts += `<sup style="color: var(--color-success-fg); font-size: 10px;">+${pendingPoQty}</sup>`;
      if (qipQty > 0)
        superscripts += `<sup style="color: var(--color-danger-fg); font-size: 10px;">-${qipQty}</sup>`;

      const needsTooltip = pendingPoQty > 0 || qipQty > 0;
      const onHandCases = Math.floor(effectiveQty / unitQty2);
      const qtyDisplayHtml = needsTooltip
        ? `<span title="${qtyTooltip}" style="cursor: help;">${effectiveQty.toLocaleString()} <span class="case-count">(${onHandCases.toLocaleString()})</span>${superscripts}</span>`
        : `${effectiveQty.toLocaleString()} <span class="case-count">(${onHandCases.toLocaleString()})</span>`;

      return `
            <tr data-upc="${upc}">
                <td>${upc ? `<a href="${trackerUrl}?tracker=${upc}&days=${salesPeriodDays}" target="_blank" rel="noopener">${upc}</a>` : "-"}</td>
                <td>${product.ProductDescription || "-"}</td>
                ${trackingMonths
                  .map((m, mi) => {
                    const cached =
                      trackingHistoryCache[upc] &&
                      trackingHistoryCache[upc][mi];
                    const cq = unitQty2 || 1;
                    if (cached) {
                      const sv = Math.round(cached.sale).toLocaleString();
                      const sc = Math.round(
                        Math.round(cached.sale) / cq,
                      ).toLocaleString();
                      const pv = Math.round(cached.purchase).toLocaleString();
                      const pc = Math.round(
                        Math.round(cached.purchase) / cq,
                      ).toLocaleString();
                      const iv = Math.round(
                        cached.beginning_inventory,
                      ).toLocaleString();
                      const ic = Math.round(
                        Math.round(cached.beginning_inventory) / cq,
                      ).toLocaleString();
                      return `<td class="history-cell tracking-history-cell" data-upc="${upc}" data-month="${mi}" data-case-qty="${cq}"><a href="${trackerUrl}?tracker=${upc}&from=${m.from}&to=${m.to}" target="_blank" rel="noopener"><span class="history-line history-sale"><span class="history-label">&minus;</span><span class="history-s">${sv} <span class="case-count">(${sc})</span></span></span><span class="history-line history-purchase"><span class="history-label">+</span><span class="history-p">${pv} <span class="case-count">(${pc})</span></span></span><span class="history-line history-inv"><span class="history-s-spacer"></span><span class="history-i">${iv} <span class="case-count">(${ic})</span></span></span></a></td>`;
                    }
                    return `<td class="history-cell tracking-history-cell" data-upc="${upc}" data-month="${mi}" data-case-qty="${cq}"><div class="history-spinner"></div></td>`;
                  })
                  .join("")}
                <td class="on-hand-qty">${qtyDisplayHtml}</td>
                <td class="tracking-cost">$${unitCost.toFixed(2)}</td>
                <td class="tracking-total-cost">$${totalCost.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            </tr>
        `;
    })
    .join("");
}

function renderTrackingTotals(totalEffectiveQty, totalCost) {
  const tfoot = document.getElementById("tracking-tfoot");
  const emptyCols = "<td></td>".repeat(7);
  const qty = parseInt(totalEffectiveQty) || 0;
  const cost = parseFloat(totalCost) || 0;
  tfoot.innerHTML = `
    <tr>
      <td colspan="2"><strong>TOTALS</strong></td>
      ${emptyCols}
      <td class="on-hand-qty"><strong>${qty.toLocaleString("en-US")}</strong></td>
      <td colspan="2" class="tracking-total-cost" style="text-align: right;"><strong>$${cost.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></td>
    </tr>
  `;
}

function updateTrackingPagination() {
  const prevBtn = document.getElementById("tracking-prev-page");
  const nextBtn = document.getElementById("tracking-next-page");
  const pageInfo = document.getElementById("tracking-pagination-info");

  prevBtn.disabled = trackingCurrentPage <= 1;
  nextBtn.disabled = trackingCurrentPage >= trackingTotalPages;

  pageInfo.textContent = `Page ${trackingCurrentPage} of ${trackingTotalPages} (${trackingTotalProducts.toLocaleString()} products)`;
}

function loadTrackingPrevPage() {
  if (trackingCurrentPage > 1) {
    loadTracking(trackingCurrentPage - 1, trackingCurrentSearch);
  }
}

function loadTrackingNextPage() {
  if (trackingCurrentPage < trackingTotalPages) {
    loadTracking(trackingCurrentPage + 1, trackingCurrentSearch);
  }
}

// ============== Tracking History ==============

function applyTrackingHistoryToRow(upc) {
  const escapedUpc = CSS.escape(upc);
  document
    .querySelectorAll(
      `#tracking-table td.tracking-history-cell[data-upc="${escapedUpc}"]`,
    )
    .forEach((cell) => {
      const mi = cell.dataset.month;
      const vals = trackingHistoryCache[upc] && trackingHistoryCache[upc][mi];
      if (!vals) {
        const spinner = cell.querySelector(".history-spinner");
        if (spinner) spinner.remove();
        return;
      }
      const cq = parseInt(cell.dataset.caseQty) || 1;
      const saleRounded = Math.round(vals.sale);
      const purchaseRounded = Math.round(vals.purchase);
      const invRounded = Math.round(vals.beginning_inventory);

      const m = trackingMonths[mi];
      const href = `${trackerUrl}?tracker=${upc}&from=${m.from}&to=${m.to}`;
      cell.innerHTML = `<a href="${href}" target="_blank" rel="noopener"><span class="history-line history-sale"><span class="history-label">&minus;</span><span class="history-s">${saleRounded.toLocaleString()} <span class="case-count">(${Math.round(saleRounded / cq).toLocaleString()})</span></span></span><span class="history-line history-purchase"><span class="history-label">+</span><span class="history-p">${purchaseRounded.toLocaleString()} <span class="case-count">(${Math.round(purchaseRounded / cq).toLocaleString()})</span></span></span><span class="history-line history-inv"><span class="history-s-spacer"></span><span class="history-i">${invRounded.toLocaleString()} <span class="case-count">(${Math.round(invRounded / cq).toLocaleString()})</span></span></span></a>`;
    });
}

function toggleTrackingVisibility() {
  const sales = document.getElementById("tracking-show-sales").checked;
  const purchases = document.getElementById("tracking-show-purchases").checked;
  const inventory = document.getElementById("tracking-show-inventory").checked;
  const table = document.getElementById("tracking-table");
  table.classList.toggle("hide-sales", !sales);
  table.classList.toggle("hide-purchases", !purchases);
  table.classList.toggle("hide-inventory", !inventory);
  localStorage.setItem(
    "trackingVisibility",
    JSON.stringify({ sales, purchases, inventory }),
  );
}

function initTrackingVisibility() {
  const saved = localStorage.getItem("trackingVisibility");
  if (saved) {
    const { sales, purchases, inventory } = JSON.parse(saved);
    document.getElementById("tracking-show-sales").checked = sales;
    document.getElementById("tracking-show-purchases").checked = purchases;
    document.getElementById("tracking-show-inventory").checked = inventory;
  }
  toggleTrackingVisibility();
}

async function loadTrackingHistory(products) {
  const allUpcs = products.map((p) => p.ProductUPC).filter(Boolean);
  if (allUpcs.length === 0) return;

  const months = trackingMonths.map((m) => ({ from: m.from, to: m.to }));

  // Process one product at a time, sequentially
  for (const upc of allUpcs) {
    if (trackingHistoryCache[upc]) {
      applyTrackingHistoryToRow(upc);
      continue;
    }
    try {
      const result = await api.post("/tracker/history", {
        upcs: [upc],
        months,
      });
      if (!result.success) throw new Error(result.error);

      for (const [returnedUpc, monthData] of Object.entries(result.data)) {
        trackingHistoryCache[returnedUpc] = {};
        for (const [mi, vals] of Object.entries(monthData)) {
          trackingHistoryCache[returnedUpc][mi] = vals;
        }
      }
      applyTrackingHistoryToRow(upc);
    } catch (error) {
      console.error(`Error loading tracking history for ${upc}:`, error);
      applyTrackingHistoryToRow(upc);
    }
  }
}

// ============== Tracking Sort / Search / Refresh ==============

function sortTracking(column) {
  if (trackingSortBy === column) {
    trackingSortOrder = trackingSortOrder === "asc" ? "desc" : "asc";
  } else {
    trackingSortBy = column;
    trackingSortOrder = "asc";
  }

  if (column.startsWith("month_")) {
    const mi = parseInt(column.split("_")[1]);
    trackingAllProducts.sort((a, b) => {
      const aCache = trackingHistoryCache[a.ProductUPC];
      const bCache = trackingHistoryCache[b.ProductUPC];
      const aSale = aCache && aCache[mi] ? aCache[mi].sale : 0;
      const bSale = bCache && bCache[mi] ? bCache[mi].sale : 0;
      return trackingSortOrder === "asc" ? aSale - bSale : bSale - aSale;
    });
    renderTrackingTable(trackingAllProducts);
    updateSortIndicators("tracking");
  } else {
    trackingCurrentPage = 1;
    loadTracking(1, trackingCurrentSearch);
    updateSortIndicators("tracking");
  }
}

function searchTracking() {
  const searchTerm = document.getElementById("tracking-search").value.trim();
  loadTracking(1, searchTerm);
}

function refreshTracking() {
  trackingLoaded = false;
  trackingHistoryCache = {};
  loadTracking(trackingCurrentPage, trackingCurrentSearch);
}

// ============== Tracking Export ==============

async function exportTrackingExcel() {
  const currentFilter = document.getElementById("tracking-filter").value;
  const search = trackingCurrentSearch;

  try {
    showToast("Generating Excel export...", "info");
    const response = await fetch("/api/tracking/export/excel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filter: currentFilter,
        search: search,
        sort_by: trackingSortBy,
        sort_order: trackingSortOrder,
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || "Export failed");
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download =
      response.headers
        .get("Content-Disposition")
        ?.match(/filename="?(.+?)"?$/)?.[1] || "tracking-export.xlsx";
    a.click();
    URL.revokeObjectURL(url);
    showToast("Excel export downloaded", "success");
  } catch (error) {
    console.error("Error exporting Excel:", error);
    showToast(`Export error: ${error.message}`, "error");
  }
}

async function exportTrackingPDF() {
  const currentFilter = document.getElementById("tracking-filter").value;
  const search = trackingCurrentSearch;

  try {
    showToast("Generating PDF export...", "info");
    const response = await fetch("/api/tracking/export/pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filter: currentFilter,
        search: search,
        sort_by: trackingSortBy,
        sort_order: trackingSortOrder,
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || "Export failed");
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download =
      response.headers
        .get("Content-Disposition")
        ?.match(/filename="?(.+?)"?$/)?.[1] || "tracking-export.pdf";
    a.click();
    URL.revokeObjectURL(url);
    showToast("PDF export downloaded", "success");
  } catch (error) {
    console.error("Error exporting PDF:", error);
    showToast(`Export error: ${error.message}`, "error");
  }
}

// Tracking event listeners
document.addEventListener("DOMContentLoaded", () => {
  const trackingFilterSelect = document.getElementById("tracking-filter");
  if (trackingFilterSelect) {
    trackingFilterSelect.addEventListener("change", () => {
      loadTracking(1, trackingCurrentSearch);
    });
  }

  const trackingSearchInput = document.getElementById("tracking-search");
  if (trackingSearchInput) {
    trackingSearchInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        searchTracking();
      }
    });
  }
});

// Orders
async function loadOrderPage() {
  // Load suppliers
  try {
    const result = await api.get("/suppliers");

    if (result.success) {
      const select = document.getElementById("supplier-select");
      select.innerHTML = '<option value="">All Suppliers</option>';

      result.suppliers.forEach((supplier) => {
        select.innerHTML += `
                    <option value="${supplier.SupplierID}" data-name="${escapeHtml(supplier.BusinessName)}">
                        ${supplier.BusinessName} (${supplier.order_count} orders)
                    </option>
                `;
      });

      // Handle pending supplier selection from inventory grouped view
      if (pendingOrderSupplier) {
        // Find supplier option by name
        const options = select.options;
        let found = false;

        for (let i = 0; i < options.length; i++) {
          const optionName =
            options[i].dataset.name ||
            options[i].textContent.split(" (")[0].trim();
          if (
            optionName === pendingOrderSupplier ||
            (pendingOrderSupplier === "No Supplier" && options[i].value === "")
          ) {
            select.selectedIndex = i;
            found = true;
            break;
          }
        }

        // If supplier name was "No Supplier", select "All Suppliers"
        if (!found && pendingOrderSupplier === "No Supplier") {
          select.selectedIndex = 0;
        }

        pendingOrderSupplier = null;
      }

      // Handle pending filter
      if (pendingOrderFilter) {
        document.getElementById("order-reorder-only").checked =
          pendingOrderFilter === "needs_reorder";
        pendingOrderFilter = null;
      }

      // Restore last ordered filter from localStorage
      const savedLastOrdered = localStorage.getItem("orderLastOrderedMonths");
      if (savedLastOrdered) {
        document.getElementById("last-ordered-filter").value = savedLastOrdered;
      }

      // Restore checkbox states from localStorage
      const savedReorderOnly = localStorage.getItem("orderReorderOnly");
      if (savedReorderOnly !== null) {
        document.getElementById("order-reorder-only").checked =
          savedReorderOnly === "true";
      }
      const savedShowHistorical = localStorage.getItem("orderShowHistorical");
      if (savedShowHistorical !== null) {
        document.getElementById("order-show-historical").checked =
          savedShowHistorical === "true";
      }

      // Auto-load products if requested
      if (pendingOrderAutoLoad) {
        pendingOrderAutoLoad = false;
        loadNeedsReorder();
      }

      ordersLoaded = true;
    }
  } catch (error) {
    console.error("Error loading suppliers:", error);
  }
}

async function loadNeedsReorder() {
  const supplierId = document.getElementById("supplier-select").value;
  const supplierSelect = document.getElementById("supplier-select");
  const selectedSupplierName =
    supplierSelect.selectedOptions[0]?.dataset.name || null;
  const reorderOnly = document.getElementById("order-reorder-only").checked;
  const showHistorical = document.getElementById(
    "order-show-historical",
  ).checked;
  const filterMode = reorderOnly ? "needs_reorder" : "all";
  localStorage.setItem("orderReorderOnly", reorderOnly);
  localStorage.setItem("orderShowHistorical", showHistorical);
  const container = document.getElementById("order-items-container");
  const tbody = document.getElementById("order-tbody");

  container.style.display = "block";
  tbody.innerHTML =
    '<tr><td colspan="9" class="loading">Loading products...</td></tr>';

  try {
    let products;

    // Check if we have pending "No Supplier" products from inventory grouped view
    if (pendingNoSupplierProducts) {
      // Transform inventory products to match the order table format
      products = pendingNoSupplierProducts.map((p) => {
        const unitQty2 = p.UnitQty2 || 1;
        const suggestedQty = p.suggested_qty || 0;
        return {
          ProductUPC: p.ProductUPC,
          ProductDescription: p.ProductDescription,
          QuantOnHand: p.QuantOnHand || 0,
          pending_po_qty: p.pending_po_qty || 0,
          qip_qty: p.qip_qty || 0,
          effective_qty: p.effective_qty || p.QuantOnHand || 0,
          unit_qty2: unitQty2,
          threshold: p.threshold || 0,
          suggested_qty: suggestedQty,
          cases_needed: Math.ceil(suggestedQty / unitQty2),
          status: p.needs_reorder ? "needs_reorder" : "sufficient",
          UnitCost: p.UnitCost,
          last_supplier: p.last_supplier,
        };
      });

      // Apply filter
      if (filterMode === "needs_reorder") {
        products = products.filter((p) => p.status === "needs_reorder");
      }

      // Apply sorting
      if (ordersSortBy) {
        const sortKey =
          ordersSortBy === "description" ? "ProductDescription" : ordersSortBy;
        products.sort((a, b) => {
          let aVal = a[sortKey] || "";
          let bVal = b[sortKey] || "";
          if (typeof aVal === "string") aVal = aVal.toLowerCase();
          if (typeof bVal === "string") bVal = bVal.toLowerCase();
          if (aVal < bVal) return ordersSortOrder === "asc" ? -1 : 1;
          if (aVal > bVal) return ordersSortOrder === "asc" ? 1 : -1;
          return 0;
        });
      }

      // Clear the pending products after use
      pendingNoSupplierProducts = null;
    } else {
      // Normal API call for supplier-filtered products
      let endpoint = "/analysis/needs-reorder";
      const params = [];
      if (supplierId) params.push(`supplier_id=${supplierId}`);
      const lastOrderedMonths = document.getElementById(
        "last-ordered-filter",
      ).value;
      localStorage.setItem("orderLastOrderedMonths", lastOrderedMonths);
      if (lastOrderedMonths) params.push(`months=${lastOrderedMonths}`);
      params.push(`filter=${filterMode}`);
      if (ordersSortBy) {
        params.push(`sort_by=${ordersSortBy}`);
        params.push(`sort_order=${ordersSortOrder}`);
      }
      if (params.length) endpoint += "?" + params.join("&");

      const result = await api.get(endpoint);

      if (!result.success) {
        throw new Error(result.error);
      }

      products = result.products;
    }

    if (products.length === 0) {
      const emptyMessage =
        filterMode === "needs_reorder"
          ? "No products need reordering"
          : "No products found";
      tbody.innerHTML = `<tr><td colspan="11" class="loading">${emptyMessage}</td></tr>`;
      loadedOrderProducts = [];
      updateOrderSummary();
      return;
    }

    loadedOrderProducts = products;

    // Sort products: current supplier first, then historical supplier, then sufficient
    if (selectedSupplierName) {
      products.sort((a, b) => {
        const aHistorical =
          a.last_supplier && a.last_supplier !== selectedSupplierName;
        const bHistorical =
          b.last_supplier && b.last_supplier !== selectedSupplierName;
        const aNeedsReorder = a.status === "needs_reorder";
        const bNeedsReorder = b.status === "needs_reorder";

        // Primary: needs_reorder first, sufficient last
        if (aNeedsReorder !== bNeedsReorder) {
          return aNeedsReorder ? -1 : 1;
        }

        // Secondary: within needs_reorder, current supplier before historical
        if (aNeedsReorder && bNeedsReorder) {
          if (aHistorical !== bHistorical) {
            return aHistorical ? 1 : -1;
          }
        }

        // Tertiary: by description
        return (a.ProductDescription || "").localeCompare(
          b.ProductDescription || "",
        );
      });
    }

    // Count products per group for header labels
    const groupCounts = { historical: 0, sufficient: 0 };
    products.forEach((p) => {
      const isHist =
        selectedSupplierName &&
        p.last_supplier &&
        p.last_supplier !== selectedSupplierName;
      if (p.status !== "needs_reorder") groupCounts.sufficient++;
      else if (isHist) groupCounts.historical++;
    });

    let prevGroup = null;
    tbody.innerHTML = products
      .map((product) => {
        const needsReorder = product.status === "needs_reorder";
        const isHistoricalSupplier =
          selectedSupplierName &&
          product.last_supplier &&
          product.last_supplier !== selectedSupplierName;
        // Only auto-check if needs_reorder AND has suggested qty AND is NOT historical supplier
        const shouldCheck =
          needsReorder && product.suggested_qty > 0 && !isHistoricalSupplier;

        // Determine group for visual separation
        const group = !needsReorder
          ? "sufficient"
          : isHistoricalSupplier
            ? "historical"
            : "current";
        let headerHtml = "";
        if (prevGroup !== null && group !== prevGroup) {
          const label =
            group === "historical" ? "Historical Supplier" : "Sufficient Stock";
          const count =
            group === "historical"
              ? groupCounts.historical
              : groupCounts.sufficient;
          headerHtml = `<tr class="group-header group-header-${group}"><td colspan="9"><span class="group-label">${label} <span class="group-count">(${count})</span></span></td></tr>`;
        }
        prevGroup = group;

        // Build row classes
        const rowClasses = [];
        if (!needsReorder) rowClasses.push("row-sufficient");
        if (isHistoricalSupplier) rowClasses.push("row-historical-supplier");
        const rowClass = rowClasses.join(" ");

        return `${headerHtml}
                <tr data-upc="${product.ProductUPC}" class="${rowClass}">
                    <td><input type="checkbox" class="order-checkbox" ${shouldCheck ? "checked" : ""} onchange="handleOrderCheckbox(this)" /></td>
                    <td>${product.ProductUPC ? `<a href="${trackerUrl}?tracker=${product.ProductUPC}&days=${salesPeriodDays}" target="_blank" rel="noopener">${product.ProductUPC}</a>` : "-"}</td>
                    <td>${product.ProductDescription || "-"}</td>
                    <td class="on-hand-qty">${(product.effective_qty || product.QuantOnHand || 0).toLocaleString()}${product.pending_po_qty > 0 ? `<sup style="color: var(--color-success-fg); font-size: 10px;">+${product.pending_po_qty}</sup>` : ""}${product.qip_qty > 0 ? `<sup style="color: var(--color-danger-fg); font-size: 10px;">-${product.qip_qty}</sup>` : ""}</td>
                    <td>${(product.unit_qty2 || 0).toLocaleString()}</td>
                    <td>${product.threshold.toLocaleString()}</td>
                    <td class="${product.suggested_qty > 0 ? "order-qty-highlight" : ""}">
                        <input type="number" class="qty-input order-qty"
                               value="${product.suggested_qty}"
                               min="0"
                               data-unit-qty="${product.unit_qty2 || 1}"
                               onchange="updateCases(this); updateOrderSummary();" />
                    </td>
                    <td class="cases-cell">${product.cases_needed}</td>
                    <td><button class="action-btn view" onclick="viewProduct('${product.ProductUPC}')">View</button></td>
                </tr>
            `;
      })
      .join("");

    // Hide historical supplier rows when checkbox is unchecked
    if (!showHistorical) {
      document
        .querySelectorAll("#order-tbody .row-historical-supplier")
        .forEach((row) => {
          row.style.display = "none";
        });
    }

    const hasSelectableItems = products.some((p) => {
      const isHistorical =
        selectedSupplierName &&
        p.last_supplier &&
        p.last_supplier !== selectedSupplierName;
      if (isHistorical && !showHistorical) return false;
      return (
        p.status === "needs_reorder" && p.suggested_qty > 0 && !isHistorical
      );
    });
    document.getElementById("select-all-orders").checked = hasSelectableItems;
    updateOrderSummary();
    updateSortIndicators("orders");
  } catch (error) {
    console.error("Error loading products:", error);
    tbody.innerHTML = `<tr><td colspan="11" class="loading">Error: ${error.message}</td></tr>`;
    loadedOrderProducts = [];
    updateOrderSummary();
  }
}

function updateCases(input) {
  const qty = parseInt(input.value) || 0;
  const unitQty = parseFloat(input.dataset.unitQty) || 1;
  const cases = Math.ceil(qty / unitQty);
  const row = input.closest("tr");
  row.querySelector(".cases-cell").textContent = cases;
  input.closest("td").classList.toggle("order-qty-highlight", qty > 0);

  // Auto-uncheck if Order Qty is 0
  const checkbox = row.querySelector(".order-checkbox");
  if (checkbox && qty === 0) {
    checkbox.checked = false;
  }
}

function handleOrderCheckbox(checkbox) {
  if (checkbox.checked) {
    const row = checkbox.closest("tr");
    const qtyInput = row.querySelector(".order-qty");
    const qty = parseInt(qtyInput?.value) || 0;

    if (qty === 0) {
      checkbox.checked = false;
      showToast("Cannot select item with Order Qty of 0", "error");
    }
  }
  updateOrderSummary();
}

// Select all checkbox
document.addEventListener("DOMContentLoaded", () => {
  const selectAll = document.getElementById("select-all-orders");
  if (selectAll) {
    selectAll.addEventListener("change", (e) => {
      document.querySelectorAll(".order-checkbox").forEach((cb) => {
        const row = cb.closest("tr");
        if (row.style.display === "none") return;
        if (e.target.checked) {
          // Only check items with Order Qty > 0
          const qtyInput = row.querySelector(".order-qty");
          const qty = parseInt(qtyInput?.value) || 0;
          cb.checked = qty > 0;
        } else {
          cb.checked = false;
        }
      });
      updateOrderSummary();
    });
  }
});

// Store loaded order data for reference
let loadedOrderProducts = [];

// ============== Column Selector for Export ==============
const exportColumnConfig = [
  { id: "upc", label: "UPC", default: true },
  { id: "description", label: "Description", default: true },
  { id: "on_hand", label: "On Hand", default: true },
  { id: "threshold", label: "Threshold", default: true },
  { id: "order_qty", label: "Order Qty", default: true },
  { id: "cases", label: "Cases", default: true },
  { id: "unit_cost", label: "Unit Cost", default: true },
  { id: "total", label: "Total", default: true },
];

// Track selected export columns - load from localStorage or use defaults
function loadExportColumns() {
  const saved = localStorage.getItem("exportColumns");
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      // Validate that saved columns are still valid
      const validColumns = parsed.filter((col) =>
        exportColumnConfig.some((c) => c.id === col),
      );
      if (validColumns.length > 0) {
        return new Set(validColumns);
      }
    } catch (e) {
      console.warn("Failed to parse saved export columns:", e);
    }
  }
  // Return defaults if nothing saved or invalid
  return new Set(exportColumnConfig.filter((c) => c.default).map((c) => c.id));
}

function saveExportColumns() {
  localStorage.setItem(
    "exportColumns",
    JSON.stringify(Array.from(exportColumns)),
  );
}

let exportColumns = loadExportColumns();

function initColumnSelector() {
  const container = document.getElementById("column-selector-options");
  if (!container) return;

  container.innerHTML = exportColumnConfig
    .map(
      (col) => `
    <div class="column-option">
      <input type="checkbox" id="col-${col.id}"
             ${exportColumns.has(col.id) ? "checked" : ""}
             onchange="toggleColumn('${col.id}')" />
      <label for="col-${col.id}">${col.label}</label>
    </div>
  `,
    )
    .join("");
}

function toggleColumnSelector() {
  const panel = document.getElementById("column-selector-panel");
  const btn = document.querySelector(".btn-columns");

  if (panel) {
    panel.classList.toggle("active");
    btn?.classList.toggle("active");
  }
}

function toggleColumn(columnId) {
  if (exportColumns.has(columnId)) {
    exportColumns.delete(columnId);
  } else {
    exportColumns.add(columnId);
  }
  saveExportColumns();
}

function selectAllColumns(select) {
  if (select) {
    exportColumnConfig.forEach((col) => exportColumns.add(col.id));
  } else {
    exportColumns.clear();
  }
  // Update checkboxes
  exportColumnConfig.forEach((col) => {
    const checkbox = document.getElementById(`col-${col.id}`);
    if (checkbox) checkbox.checked = select;
  });
  saveExportColumns();
}

function getSelectedColumnsParam() {
  if (exportColumns.size === 0) {
    return null; // No columns selected
  }
  if (exportColumns.size === exportColumnConfig.length) {
    return ""; // All columns selected, no param needed
  }
  return Array.from(exportColumns).join(",");
}

// Close column selector when clicking outside
document.addEventListener("click", (e) => {
  const panel = document.getElementById("column-selector-panel");
  const wrapper = e.target.closest(".column-selector-wrapper");

  if (panel && panel.classList.contains("active") && !wrapper) {
    panel.classList.remove("active");
    document.querySelector(".btn-columns")?.classList.remove("active");
  }
});

// Initialize column selector on page load
document.addEventListener("DOMContentLoaded", () => {
  initColumnSelector();
});

// Export functions
function getOrderData() {
  const rows = document.querySelectorAll("#order-tbody tr");
  const items = [];

  rows.forEach((row) => {
    if (row.style.display === "none") return;
    const checkbox = row.querySelector(".order-checkbox");
    if (checkbox && checkbox.checked) {
      const qtyInput = row.querySelector(".order-qty");
      const upc = row.dataset.upc;
      const product =
        loadedOrderProducts.find((p) => p.ProductUPC === upc) || {};

      // Use effective_unit_cost if available (includes override), fallback to UnitCost
      const unitCost = product.effective_unit_cost ?? product.UnitCost ?? 0;

      items.push({
        upc: upc,
        description: row.cells[2].textContent,
        on_hand: parseFloat(row.cells[3].textContent.replace(/,/g, "")) || 0,
        threshold: parseFloat(row.cells[5].textContent.replace(/,/g, "")) || 0,
        suggested_qty: product.suggested_qty || 0,
        order_qty: parseInt(qtyInput ? qtyInput.value : 0) || 0,
        unit_qty2: product.unit_qty2 || 1,
        unit_cost: unitCost,
      });
    }
  });

  return items;
}

async function saveOrderDraft() {
  const items = getOrderData();

  if (items.length === 0) {
    showToast("No items selected to save", "error");
    return null;
  }

  const orderName = document.getElementById("order-name").value || null;
  const supplierId = document.getElementById("supplier-select").value;

  try {
    const result = await api.post("/orders", {
      name: orderName,
      supplier_filter: supplierId || null,
      items: items,
    });

    if (result.success) {
      showToast("Order draft saved successfully", "success");
      return result.id;
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    console.error("Error saving order:", error);
    showToast(`Error saving order: ${error.message}`, "error");
    return null;
  }
}

async function saveAndExportExcel() {
  const columnsParam = getSelectedColumnsParam();
  if (columnsParam === null) {
    showToast("Please select at least one column to export", "error");
    return;
  }

  const orderId = await saveOrderDraft();
  if (orderId) {
    let url = `/api/orders/${orderId}/export/excel`;
    if (columnsParam) {
      url += `?columns=${columnsParam}`;
    }
    window.location.href = url;
  }
}

async function saveAndExportPDF() {
  const columnsParam = getSelectedColumnsParam();
  if (columnsParam === null) {
    showToast("Please select at least one column to export", "error");
    return;
  }

  const orderId = await saveOrderDraft();
  if (orderId) {
    let url = `/api/orders/${orderId}/export/pdf`;
    if (columnsParam) {
      url += `?columns=${columnsParam}`;
    }
    window.location.href = url;
  }
}

function updateOrderSummary() {
  const rows = document.querySelectorAll("#order-tbody tr");
  let itemCount = 0;
  let totalQty = 0;
  let totalCost = 0;

  rows.forEach((row) => {
    if (row.style.display === "none") return;
    const checkbox = row.querySelector(".order-checkbox");
    if (checkbox && checkbox.checked) {
      itemCount++;
      const qtyInput = row.querySelector(".order-qty");
      const qty = parseInt(qtyInput ? qtyInput.value : 0) || 0;
      totalQty += qty;

      const upc = row.dataset.upc;
      const product =
        loadedOrderProducts.find((p) => p.ProductUPC === upc) || {};
      // Use effective_unit_cost if available (includes override), fallback to UnitCost
      const unitCost = product.effective_unit_cost ?? product.UnitCost ?? 0;
      totalCost += qty * unitCost;
    }
  });

  document.getElementById("order-item-count").textContent =
    itemCount.toLocaleString();
  document.getElementById("order-total-qty").textContent =
    totalQty.toLocaleString();
  document.getElementById("order-total-cost").textContent =
    `$${totalCost.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Order History
async function loadOrderHistory() {
  const tbody = document.getElementById("history-tbody");
  tbody.innerHTML =
    '<tr><td colspan="6" class="loading">Loading orders...</td></tr>';

  try {
    const status = document.getElementById("history-filter").value;
    let endpoint = "/orders";
    if (status) {
      endpoint += `?status=${status}`;
    }

    const result = await api.get(endpoint);

    if (!result.success) {
      throw new Error(result.error);
    }

    if (result.orders.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="8" class="loading">No orders found</td></tr>';
      return;
    }

    tbody.innerHTML = result.orders
      .map((order) => {
        const createdDate = order.created_at
          ? new Date(order.created_at).toLocaleString()
          : "-";
        let statusClass = "badge-info";
        if (order.status === "exported") statusClass = "badge-success";
        if (order.status === "archived") statusClass = "badge-secondary";
        const totalCost = parseFloat(order.total_cost || 0);
        const formattedCost = `$${totalCost.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

        return `
                <tr data-id="${order.id}">
                    <td>${order.name || "Untitled"}</td>
                    <td>${order.supplier_name || "-"}</td>
                    <td>${createdDate}</td>
                    <td>${order.item_count || 0}</td>
                    <td>${(order.total_qty || 0).toLocaleString()}</td>
                    <td>${formattedCost}</td>
                    <td><span class="badge ${statusClass}">${order.status}</span></td>
                    <td class="action-cell">
                        <button class="action-btn view" onclick="viewOrder(${order.id})">View</button>
                        <button class="action-btn export" onclick="exportOrderExcelWithPo(${order.id})">Excel</button>
                        <button class="action-btn export" onclick="exportOrderPDFWithPo(${order.id})">PDF</button>
                        <button class="action-btn delete" onclick="deleteOrder(${order.id})">Delete</button>
                    </td>
                </tr>
            `;
      })
      .join("");
  } catch (error) {
    console.error("Error loading order history:", error);
    tbody.innerHTML = `<tr><td colspan="8" class="loading">Error: ${error.message}</td></tr>`;
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
            <h3>${order.name || "Untitled Order"}</h3>
            <p>Created: ${order.created_at ? new Date(order.created_at).toLocaleString() : "-"}</p>
            <p>Status: ${order.status}</p>
            <p>Items: ${summary.total_items} | Total Qty: ${summary.total_qty.toLocaleString()} | Est. Cost: $${summary.total_cost.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
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
                    ${items
                      .map(
                        (item) => `
                        <tr>
                            <td>${item.product_upc ? `<a href="${trackerUrl}?tracker=${item.product_upc}&days=${salesPeriodDays}" target="_blank" rel="noopener">${item.product_upc}</a>` : "-"}</td>
                            <td>${item.product_description}</td>
                            <td>${item.final_qty}</td>
                        </tr>
                    `,
                      )
                      .join("")}
                </tbody>
            </table>
        `;

    const modal = document.createElement("div");
    modal.className = "modal active";
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
    // Close modal when clicking outside
    modal.addEventListener("click", (e) => {
      if (e.target === modal) {
        modal.remove();
      }
    });
    document.body.appendChild(modal);
  } catch (error) {
    console.error("Error viewing order:", error);
    showToast(`Error loading order: ${error.message}`, "error");
  }
}

function exportOrderExcel(orderId) {
  const columnsParam = getSelectedColumnsParam();
  if (columnsParam === null) {
    showToast("Please select at least one column to export", "error");
    return;
  }

  let url = `/api/orders/${orderId}/export/excel`;
  if (columnsParam) {
    url += `?columns=${columnsParam}`;
  }
  window.location.href = url;
}

function exportOrderPDF(orderId) {
  const columnsParam = getSelectedColumnsParam();
  if (columnsParam === null) {
    showToast("Please select at least one column to export", "error");
    return;
  }

  let url = `/api/orders/${orderId}/export/pdf`;
  if (columnsParam) {
    url += `?columns=${columnsParam}`;
  }
  window.location.href = url;
}

async function deleteOrder(orderId) {
  if (!confirm("Are you sure you want to delete this order?")) {
    return;
  }

  try {
    const result = await api.delete(`/orders/${orderId}`);

    if (result.success) {
      showToast("Order deleted", "success");
      loadOrderHistory();
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    console.error("Error deleting order:", error);
    showToast(`Error deleting order: ${error.message}`, "error");
  }
}

// ============== Purchase Order Creation Modal ==============

// Store current PO creation state
let poCreationState = {
  orderId: null,
  exportType: null,
  supplierId: null,
  supplierName: null,
};

// Show initial PO creation prompt
function showCreatePoPrompt(
  orderId,
  exportType,
  supplierId = null,
  supplierName = null,
) {
  poCreationState = { orderId, exportType, supplierId, supplierName };

  const modal = document.createElement("div");
  modal.className = "modal active";
  modal.id = "create-po-modal";

  modal.innerHTML = `
    <div class="modal-content po-modal">
      <div class="modal-header">
        <h2>Create Purchase Order?</h2>
        <button class="modal-close" onclick="closeCreatePoModal()">&times;</button>
      </div>
      <div class="modal-body">
        <p>Would you like to create a Purchase Order in the system for this export?</p>
        <div class="po-modal-actions">
          <button type="button" class="btn btn-primary" onclick="handlePoYes()">
            Yes, Create PO
          </button>
          <button type="button" class="btn btn-outline" onclick="skipPoCreation()">
            No, Just Export
          </button>
        </div>
      </div>
    </div>
  `;

  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeCreatePoModal();
  });

  document.body.appendChild(modal);
}

// Handle "Yes" to PO creation - check if supplier is selected
async function handlePoYes() {
  const { orderId, supplierId } = poCreationState;

  // If no supplier selected, show supplier selection
  if (!supplierId) {
    showSupplierSelectionForPo();
  } else {
    showPoNumberInput();
  }
}

// Show supplier selection modal
async function showSupplierSelectionForPo() {
  const modal = document.getElementById("create-po-modal");
  if (!modal) return;

  try {
    const result = await api.get("/suppliers");
    if (!result.success) throw new Error(result.error);

    const suppliersHtml = result.suppliers
      .map(
        (s) => `
        <option value="${s.SupplierID}" data-name="${escapeHtml(s.BusinessName)}">
          ${escapeHtml(s.BusinessName)}
        </option>
      `,
      )
      .join("");

    modal.querySelector(".modal-content").innerHTML = `
      <div class="modal-header">
        <h2>Select Supplier</h2>
        <button class="modal-close" onclick="closeCreatePoModal()">&times;</button>
      </div>
      <div class="modal-body">
        <p>Please select a supplier for the Purchase Order:</p>
        <div class="form-group">
          <select id="po-supplier-select" class="form-control">
            <option value="">-- Select Supplier --</option>
            ${suppliersHtml}
          </select>
        </div>
        <div class="po-modal-actions">
          <button type="button" class="btn btn-primary" onclick="handleSupplierSelected()">
            Continue
          </button>
          <button type="button" class="btn btn-outline" onclick="showCreatePoPrompt(poCreationState.orderId, poCreationState.exportType, poCreationState.supplierId, poCreationState.supplierName)">
            Back
          </button>
        </div>
      </div>
    `;
  } catch (error) {
    showToast(`Error loading suppliers: ${error.message}`, "error");
    closeCreatePoModal();
  }
}

// Handle supplier selection
function handleSupplierSelected() {
  const select = document.getElementById("po-supplier-select");
  const selectedOption = select.selectedOptions[0];

  if (!select.value) {
    showToast("Please select a supplier", "error");
    return;
  }

  poCreationState.supplierId = select.value;
  poCreationState.supplierName =
    selectedOption.dataset.name || selectedOption.textContent.trim();

  showPoNumberInput();
}

// Show PO number input modal
function showPoNumberInput() {
  const modal = document.getElementById("create-po-modal");
  if (!modal) return;

  const supplierInfo = poCreationState.supplierName
    ? `<p class="po-supplier-info">Supplier: <strong>${escapeHtml(poCreationState.supplierName)}</strong></p>`
    : "";

  modal.querySelector(".modal-content").innerHTML = `
    <div class="modal-header">
      <h2>Enter PO Number</h2>
      <button class="modal-close" onclick="closeCreatePoModal()">&times;</button>
    </div>
    <div class="modal-body">
      ${supplierInfo}
      <div class="form-group">
        <label for="po-number-input">PO Number (max 20 characters)</label>
        <div class="po-number-input-wrapper">
          <input type="text" id="po-number-input" class="form-control"
                 maxlength="20" placeholder="Enter PO number..."
                 onblur="validatePoNumberInput()"
                 oninput="clearPoValidation()" />
          <span id="po-validation-icon" class="po-validation-icon"></span>
        </div>
        <div id="po-validation-message" class="po-validation-message"></div>
      </div>
      <div class="po-modal-actions">
        <button type="button" id="po-create-btn" class="btn btn-primary" onclick="createPoAndExport()">
          Create PO & Export
        </button>
        <button type="button" class="btn btn-outline" onclick="skipPoCreation()">
          Skip, Just Export
        </button>
      </div>
    </div>
  `;

  // Focus the input
  setTimeout(() => {
    document.getElementById("po-number-input")?.focus();
  }, 100);
}

// Validate PO number on blur
async function validatePoNumberInput() {
  const input = document.getElementById("po-number-input");
  const icon = document.getElementById("po-validation-icon");
  const message = document.getElementById("po-validation-message");
  const createBtn = document.getElementById("po-create-btn");

  const poNumber = input?.value.trim();

  if (!poNumber) {
    icon.textContent = "";
    icon.className = "po-validation-icon";
    message.textContent = "";
    message.className = "po-validation-message";
    return;
  }

  // Show loading state
  icon.textContent = "...";
  icon.className = "po-validation-icon validating";
  message.textContent = "Validating...";
  message.className = "po-validation-message";

  try {
    const result = await api.post("/po/validate-number", {
      po_number: poNumber,
    });

    if (result.success && result.valid) {
      icon.textContent = "✓";
      icon.className = "po-validation-icon valid";
      message.textContent = result.message;
      message.className = "po-validation-message valid";
      createBtn.disabled = false;
    } else {
      icon.textContent = "✗";
      icon.className = "po-validation-icon invalid";
      message.textContent =
        result.message || result.error || "Invalid PO number";
      message.className = "po-validation-message invalid";
      createBtn.disabled = true;
    }
  } catch (error) {
    icon.textContent = "!";
    icon.className = "po-validation-icon error";
    message.textContent = `Error: ${error.message}`;
    message.className = "po-validation-message invalid";
    createBtn.disabled = true;
  }
}

// Clear validation state when typing
function clearPoValidation() {
  const icon = document.getElementById("po-validation-icon");
  const message = document.getElementById("po-validation-message");
  const createBtn = document.getElementById("po-create-btn");

  if (icon) {
    icon.textContent = "";
    icon.className = "po-validation-icon";
  }
  if (message) {
    message.textContent = "";
    message.className = "po-validation-message";
  }
  if (createBtn) {
    createBtn.disabled = false;
  }
}

// Create PO and then export
async function createPoAndExport() {
  const { orderId, exportType, supplierId } = poCreationState;
  const poNumber = document.getElementById("po-number-input")?.value.trim();

  if (!poNumber) {
    showToast("Please enter a PO number", "error");
    return;
  }

  const createBtn = document.getElementById("po-create-btn");
  if (createBtn) {
    createBtn.disabled = true;
    createBtn.textContent = "Creating...";
  }

  try {
    const result = await api.post(`/orders/${orderId}/create-po`, {
      po_number: poNumber,
      supplier_id: supplierId,
    });

    if (result.success) {
      showToast(
        `Purchase Order ${result.po_number} created successfully!`,
        "success",
      );
      clearCart();
      ordersLoaded = false;
      inventoryLoaded = false;
      closeCreatePoModal();
      performExport(orderId, exportType);
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    console.error("Error creating PO:", error);
    showToast(`Error creating PO: ${error.message}`, "error");

    if (createBtn) {
      createBtn.disabled = false;
      createBtn.textContent = "Create PO & Export";
    }
  }
}

// Skip PO creation and just export
function skipPoCreation() {
  const { orderId, exportType } = poCreationState;
  closeCreatePoModal();
  performExport(orderId, exportType);
}

// Perform the actual export
function performExport(orderId, exportType) {
  const columnsParam = getSelectedColumnsParam();

  let url;
  if (exportType === "excel") {
    url = `/api/orders/${orderId}/export/excel`;
  } else {
    url = `/api/orders/${orderId}/export/pdf`;
  }

  if (columnsParam) {
    url += `?columns=${columnsParam}`;
  }

  window.location.href = url;
}

// Close the PO modal
function closeCreatePoModal() {
  const modal = document.getElementById("create-po-modal");
  if (modal) {
    modal.remove();
  }
  poCreationState = {
    orderId: null,
    exportType: null,
    supplierId: null,
    supplierName: null,
  };
}

// Modified saveAndExportExcel - now shows PO prompt
async function saveAndExportExcelWithPo() {
  const columnsParam = getSelectedColumnsParam();
  if (columnsParam === null) {
    showToast("Please select at least one column to export", "error");
    return;
  }

  const orderId = await saveOrderDraft();
  if (orderId) {
    // Get supplier info from the order page
    const supplierSelect = document.getElementById("supplier-select");
    const supplierId = supplierSelect?.value || null;
    const supplierName =
      supplierSelect?.selectedOptions[0]?.dataset.name || null;

    showCreatePoPrompt(orderId, "excel", supplierId, supplierName);
  }
}

// Modified saveAndExportPDF - now shows PO prompt
async function saveAndExportPDFWithPo() {
  const columnsParam = getSelectedColumnsParam();
  if (columnsParam === null) {
    showToast("Please select at least one column to export", "error");
    return;
  }

  const orderId = await saveOrderDraft();
  if (orderId) {
    // Get supplier info from the order page
    const supplierSelect = document.getElementById("supplier-select");
    const supplierId = supplierSelect?.value || null;
    const supplierName =
      supplierSelect?.selectedOptions[0]?.dataset.name || null;

    showCreatePoPrompt(orderId, "pdf", supplierId, supplierName);
  }
}

// Modified exportOrderExcel for history page - now shows PO prompt
async function exportOrderExcelWithPo(orderId) {
  const columnsParam = getSelectedColumnsParam();
  if (columnsParam === null) {
    showToast("Please select at least one column to export", "error");
    return;
  }

  // Fetch order to get supplier info
  try {
    const result = await api.get(`/orders/${orderId}`);
    if (result.success) {
      const supplierId = result.order.supplier_id || null;
      const supplierName = result.order.supplier_name || null;
      showCreatePoPrompt(orderId, "excel", supplierId, supplierName);
    } else {
      // If we can't get order details, just show prompt without supplier
      showCreatePoPrompt(orderId, "excel");
    }
  } catch (error) {
    // Fall back to prompt without supplier info
    showCreatePoPrompt(orderId, "excel");
  }
}

// Modified exportOrderPDF for history page - now shows PO prompt
async function exportOrderPDFWithPo(orderId) {
  const columnsParam = getSelectedColumnsParam();
  if (columnsParam === null) {
    showToast("Please select at least one column to export", "error");
    return;
  }

  // Fetch order to get supplier info
  try {
    const result = await api.get(`/orders/${orderId}`);
    if (result.success) {
      const supplierId = result.order.supplier_id || null;
      const supplierName = result.order.supplier_name || null;
      showCreatePoPrompt(orderId, "pdf", supplierId, supplierName);
    } else {
      // If we can't get order details, just show prompt without supplier
      showCreatePoPrompt(orderId, "pdf");
    }
  } catch (error) {
    // Fall back to prompt without supplier info
    showCreatePoPrompt(orderId, "pdf");
  }
}

// ============== Order Qty TAB Navigation ==============
// TAB key moves to the next row's Order Qty input for faster data entry
document.addEventListener("DOMContentLoaded", () => {
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;

    const target = e.target;
    const isInventoryQtyInput = target.classList.contains(
      "inventory-order-qty-input",
    );
    const isOrderQtyInput = target.classList.contains("order-qty");

    if (!isInventoryQtyInput && !isOrderQtyInput) return;

    const inputClass = isInventoryQtyInput
      ? "inventory-order-qty-input"
      : "order-qty";
    const tableId = isInventoryQtyInput ? "inventory-table" : "order-table";
    const table = document.getElementById(tableId);
    if (!table) return;

    const allInputs = Array.from(table.querySelectorAll(`.${inputClass}`));
    const currentIndex = allInputs.indexOf(target);
    if (currentIndex === -1) return;

    const nextIndex = e.shiftKey ? currentIndex - 1 : currentIndex + 1;

    if (nextIndex >= 0 && nextIndex < allInputs.length) {
      e.preventDefault();
      const nextInput = allInputs[nextIndex];
      nextInput.focus();
      nextInput.select();
    }
  });
});
