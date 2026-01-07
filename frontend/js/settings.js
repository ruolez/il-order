// IL-Order - Settings Page JavaScript

// Load settings when page loads
async function loadSettings() {
    await loadSqlConfig();
    await loadAnalysisSettings();
}

// SQL Configuration
async function loadSqlConfig() {
    try {
        const result = await api.get('/sql-config');

        if (result.success && result.config) {
            document.getElementById('sql-server').value = result.config.server || '';
            document.getElementById('sql-database').value = result.config.database || '';
            document.getElementById('sql-username').value = result.config.username || '';
            // Password is not returned for security
        }
    } catch (error) {
        console.error('Error loading SQL config:', error);
    }
}

async function saveSqlConfig(e) {
    e.preventDefault();

    const config = {
        server: document.getElementById('sql-server').value,
        database: document.getElementById('sql-database').value,
        username: document.getElementById('sql-username').value,
        password: document.getElementById('sql-password').value
    };

    try {
        const result = await api.post('/sql-config', config);

        if (result.success) {
            showToast('SQL configuration saved successfully', 'success');
            document.getElementById('sql-password').value = '';
        } else {
            throw new Error(result.error);
        }
    } catch (error) {
        showToast(`Error saving config: ${error.message}`, 'error');
    }
}

async function testConnection() {
    const statusDiv = document.getElementById('connection-status');
    statusDiv.className = 'status-message';
    statusDiv.style.display = 'block';
    statusDiv.textContent = 'Testing connection...';
    statusDiv.style.backgroundColor = 'var(--primary-light)';
    statusDiv.style.color = 'var(--primary)';
    statusDiv.style.border = '1px solid var(--primary)';

    const config = {
        server: document.getElementById('sql-server').value,
        database: document.getElementById('sql-database').value,
        username: document.getElementById('sql-username').value,
        password: document.getElementById('sql-password').value
    };

    try {
        const result = await api.post('/test-connection', config);

        if (result.success) {
            statusDiv.className = 'status-message success';
            statusDiv.textContent = `Connection successful! Connected to: ${result.database}`;
        } else {
            statusDiv.className = 'status-message error';
            statusDiv.textContent = `Connection failed: ${result.error}`;
        }
    } catch (error) {
        statusDiv.className = 'status-message error';
        statusDiv.textContent = `Connection error: ${error.message}`;
    }
}

// Analysis Settings
async function loadAnalysisSettings() {
    try {
        const result = await api.get('/settings');

        if (result.success && result.settings) {
            const settings = result.settings;

            if (settings.sales_period_days) {
                document.getElementById('sales-period').value = settings.sales_period_days;
            }
            if (settings.order_period_weeks) {
                document.getElementById('order-period').value = settings.order_period_weeks;
            }
            if (settings.threshold_multiplier) {
                document.getElementById('threshold-multiplier').value = settings.threshold_multiplier;
            }
            if (settings.items_per_page) {
                document.getElementById('items-per-page').value = settings.items_per_page;
            }
        }
    } catch (error) {
        console.error('Error loading settings:', error);
    }
}

async function saveAnalysisSettings(e) {
    e.preventDefault();

    const settings = {
        sales_period_days: document.getElementById('sales-period').value,
        order_period_weeks: document.getElementById('order-period').value,
        threshold_multiplier: document.getElementById('threshold-multiplier').value,
        items_per_page: document.getElementById('items-per-page').value
    };

    try {
        const result = await api.post('/settings', settings);

        if (result.success) {
            showToast('Settings saved successfully', 'success');
        } else {
            throw new Error(result.error);
        }
    } catch (error) {
        showToast(`Error saving settings: ${error.message}`, 'error');
    }
}

// Initialize form event listeners
document.addEventListener('DOMContentLoaded', () => {
    const sqlForm = document.getElementById('sql-config-form');
    if (sqlForm) {
        sqlForm.addEventListener('submit', saveSqlConfig);
    }

    const analysisForm = document.getElementById('analysis-settings-form');
    if (analysisForm) {
        analysisForm.addEventListener('submit', saveAnalysisSettings);
    }
});
