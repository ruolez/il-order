// IL-Order - Settings Page JavaScript

// Load settings when page loads
async function loadSettings() {
  await loadSqlConfig();
  await loadAnalysisSettings();
  await loadExcludedProducts();
}

// SQL Configuration
async function loadSqlConfig() {
  try {
    const result = await api.get("/sql-config");

    if (result.success && result.config) {
      document.getElementById("sql-server").value = result.config.server || "";
      document.getElementById("sql-database").value =
        result.config.database || "";
      document.getElementById("sql-username").value =
        result.config.username || "";
      document.getElementById("sql-admin-database").value =
        result.config.admin_database || "";
      // Password is not returned for security
    }
  } catch (error) {
    console.error("Error loading SQL config:", error);
  }
}

async function saveSqlConfig(e) {
  e.preventDefault();

  const config = {
    server: document.getElementById("sql-server").value,
    database: document.getElementById("sql-database").value,
    username: document.getElementById("sql-username").value,
    password: document.getElementById("sql-password").value,
    admin_database: document.getElementById("sql-admin-database").value || null,
  };

  try {
    const result = await api.post("/sql-config", config);

    if (result.success) {
      showToast("SQL configuration saved successfully", "success");
      document.getElementById("sql-password").value = "";
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    showToast(`Error saving config: ${error.message}`, "error");
  }
}

async function testConnection() {
  const statusDiv = document.getElementById("connection-status");
  statusDiv.className = "status-message";
  statusDiv.style.display = "block";
  statusDiv.textContent = "Testing connection...";
  statusDiv.style.backgroundColor = "var(--primary-light)";
  statusDiv.style.color = "var(--primary)";
  statusDiv.style.border = "1px solid var(--primary)";

  const config = {
    server: document.getElementById("sql-server").value,
    database: document.getElementById("sql-database").value,
    username: document.getElementById("sql-username").value,
    password: document.getElementById("sql-password").value,
  };

  try {
    const result = await api.post("/test-connection", config);

    if (result.success) {
      statusDiv.className = "status-message success";
      statusDiv.textContent = `Connection successful! Connected to: ${result.database}`;
    } else {
      statusDiv.className = "status-message error";
      statusDiv.textContent = `Connection failed: ${result.error}`;
    }
  } catch (error) {
    statusDiv.className = "status-message error";
    statusDiv.textContent = `Connection error: ${error.message}`;
  }
}

async function testAdminConnection() {
  const adminDb = document.getElementById("sql-admin-database").value;
  if (!adminDb) {
    showToast("Please enter an Admin Database name first", "error");
    return;
  }

  const statusDiv = document.getElementById("connection-status");
  statusDiv.className = "status-message";
  statusDiv.style.display = "block";
  statusDiv.textContent = "Testing admin DB connection...";
  statusDiv.style.backgroundColor = "var(--primary-light)";
  statusDiv.style.color = "var(--primary)";
  statusDiv.style.border = "1px solid var(--primary)";

  const config = {
    server: document.getElementById("sql-server").value,
    username: document.getElementById("sql-username").value,
    password: document.getElementById("sql-password").value,
    admin_database: adminDb,
  };

  try {
    const result = await api.post("/test-admin-connection", config);

    if (result.success) {
      statusDiv.className = "status-message success";
      statusDiv.textContent = `Admin DB connection successful! Connected to: ${result.database}`;
    } else {
      statusDiv.className = "status-message error";
      statusDiv.textContent = `Admin DB connection failed: ${result.error}`;
    }
  } catch (error) {
    statusDiv.className = "status-message error";
    statusDiv.textContent = `Admin DB connection error: ${error.message}`;
  }
}

// Analysis Settings
async function loadAnalysisSettings() {
  try {
    const result = await api.get("/settings");

    if (result.success && result.settings) {
      const settings = result.settings;

      if (settings.dynamic_threshold_source) {
        document.getElementById("threshold-source").value =
          settings.dynamic_threshold_source;
      }
      if (settings.sales_period_days) {
        document.getElementById("sales-period").value =
          settings.sales_period_days;
      }
      applyThresholdSourceLock();
      if (settings.order_period_days) {
        document.getElementById("order-period").value =
          settings.order_period_days;
      }
      if (settings.threshold_multiplier) {
        document.getElementById("threshold-multiplier").value =
          settings.threshold_multiplier;
      }
      if (settings.items_per_page) {
        document.getElementById("items-per-page").value =
          settings.items_per_page;
      }
      if (settings.tracker_url) {
        document.getElementById("tracker-url").value = settings.tracker_url;
      }
    }
  } catch (error) {
    console.error("Error loading settings:", error);
  }
}

// When the tracker source is selected the analysis period is fixed at 90 days
// (the tracker recompute always uses the 3 full past months), so lock the field.
function applyThresholdSourceLock() {
  const source = document.getElementById("threshold-source").value;
  const salesPeriod = document.getElementById("sales-period");
  if (source === "tracker") {
    salesPeriod.value = "90";
    salesPeriod.disabled = true;
  } else {
    salesPeriod.disabled = false;
  }
}

async function saveAnalysisSettings(e) {
  e.preventDefault();

  const source = document.getElementById("threshold-source").value;
  const settings = {
    dynamic_threshold_source: source,
    sales_period_days:
      source === "tracker"
        ? "90"
        : document.getElementById("sales-period").value,
    order_period_days: document.getElementById("order-period").value,
    threshold_multiplier: document.getElementById("threshold-multiplier").value,
    items_per_page: document.getElementById("items-per-page").value,
    tracker_url: document.getElementById("tracker-url").value,
  };

  try {
    const result = await api.post("/settings", settings);

    if (result.success) {
      showToast("Settings saved successfully", "success");
      inventoryLoaded = false;
      ordersLoaded = false;
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    showToast(`Error saving settings: ${error.message}`, "error");
  }
}

// Excluded Products
async function loadExcludedProducts() {
  const container = document.getElementById("excluded-products-container");
  if (!container) return;

  try {
    const result = await api.get("/products/excluded");

    if (!result.success) {
      container.innerHTML =
        '<div class="info-message error">Error loading excluded products</div>';
      return;
    }

    if (!result.sql_configured) {
      container.innerHTML =
        '<div class="info-message">Configure SQL Server connection to view excluded products</div>';
      return;
    }

    if (result.products.length === 0) {
      container.innerHTML =
        '<div class="info-message">No products excluded</div>';
      return;
    }

    let html = '<table class="data-table excluded-products-table"><thead><tr>';
    html += "<th>UPC</th><th>Description</th><th>Actions</th>";
    html += "</tr></thead><tbody>";

    for (const product of result.products) {
      html += `<tr>
                <td>${product.product_upc || ""}</td>
                <td>${product.description || ""}</td>
                <td>
                    <button class="btn btn-small btn-outline" onclick="restoreExcludedProduct('${product.product_upc}')">
                        Restore
                    </button>
                </td>
            </tr>`;
    }

    html += "</tbody></table>";
    container.innerHTML = html;
  } catch (error) {
    console.error("Error loading excluded products:", error);
    container.innerHTML =
      '<div class="info-message error">Error loading excluded products</div>';
  }
}

async function restoreExcludedProduct(upc) {
  try {
    const result = await api.post(`/products/${upc}/exclude`);

    if (result.success && !result.excluded) {
      showToast("Product restored successfully", "success");
      await loadExcludedProducts();
    } else if (result.success && result.excluded) {
      showToast("Product is still excluded", "error");
    } else {
      throw new Error(result.error || "Failed to restore product");
    }
  } catch (error) {
    showToast(`Error restoring product: ${error.message}`, "error");
  }
}

// Initialize form event listeners
document.addEventListener("DOMContentLoaded", () => {
  const sqlForm = document.getElementById("sql-config-form");
  if (sqlForm) {
    sqlForm.addEventListener("submit", saveSqlConfig);
  }

  const analysisForm = document.getElementById("analysis-settings-form");
  if (analysisForm) {
    analysisForm.addEventListener("submit", saveAnalysisSettings);
  }

  const thresholdSource = document.getElementById("threshold-source");
  if (thresholdSource) {
    thresholdSource.addEventListener("change", applyThresholdSourceLock);
  }
});
