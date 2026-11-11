const BASE_PATH = '/WorkflowOs/';
const app = document.getElementById('app');
let sessionToken = localStorage.getItem('workflowos_session') || '';
let sessionInfo = null;
let dashboardData = null;
let currentPeriod = '7d';
let currentGranularity = 'daily';
let currentView = 'dashboard';
let customStartDate = '';
let customEndDate = '';

const navItems = [
  { id: 'dashboard', label: 'Dashboard', icon: '▦' },
  { id: 'sales', label: 'Sales & Transactions', icon: '↗' },
  { id: 'products', label: 'Products & Services', icon: '◇' },
  { id: 'inventory', label: 'Inventory & Stock', icon: '▤' },
  { id: 'customers', label: 'Customers', icon: '◎' },
  { id: 'loyalty', label: 'Loyalty & Memberships', icon: '✳', planned: true },
  { id: 'expenses', label: 'Expenses', icon: '−', planned: true },
  { id: 'insights', label: 'Business Insights / AI Coach', icon: '✧', planned: true },
  { id: 'reports', label: 'Reports', icon: '▥', planned: true },
  { id: 'integrations', label: 'Integrations', icon: '⌘', planned: true },
  { id: 'settings', label: 'Business Settings', icon: '⚙' },
];

function appPath(path) {
  return BASE_PATH + String(path || '').replace(/^\/+/, '');
}

function navigate(path, replace = false) {
  const url = appPath(path);
  if (replace) history.replaceState({}, '', url);
  else history.pushState({}, '', url);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
}

function money(cents, currency = 'ZAR') {
  try {
    return new Intl.NumberFormat('en-ZA', { style: 'currency', currency, maximumFractionDigits: 2 }).format((Number(cents) || 0) / 100);
  } catch {
    return `${currency} ${((Number(cents) || 0) / 100).toFixed(2)}`;
  }
}

function dateTime(value, timezone) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-ZA', { timeZone: timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
      ...options.headers,
    },
  });
  if (response.status === 401) {
    clearSession();
    throw new Error('Your session expired. Please sign in again.');
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'The request could not be completed.');
  return body;
}

function clearSession() {
  localStorage.removeItem('workflowos_session');
  sessionToken = '';
  sessionInfo = null;
  dashboardData = null;
}

function goTo(path) {
  navigate(path);
  if (path === '/login') renderAuth();
  else loadAuthenticatedApp();
}

window.addEventListener('popstate', () => {
  if (!sessionToken) renderAuth();
  else loadAuthenticatedApp();
});

function renderAuth(message = '') {
  app.innerHTML = `
    <main class="auth-layout">
      <section class="auth-story">
        <a class="brand brand-light" href="/WorkflowOs/" aria-label="WorkflowOS home"><span class="brand-mark">W</span><span>workflow<span class="brand-accent">OS</span></span></a>
        <div class="auth-story-copy">
          <span class="eyebrow">BUSINESS, IN CLEAR VIEW</span>
          <h1>Make confident moves for your business.</h1>
          <p>Bring your daily operations, customer relationships and business performance into one clear workspace.</p>
        </div>
        <div class="story-note"><span class="story-dot"></span> Built for the people behind local business.</div>
      </section>
      <section class="auth-main">
        <div class="auth-card">
          <div class="auth-tabs" role="tablist"><button class="auth-tab active" id="show-login" type="button">Sign in</button><button class="auth-tab" id="show-register" type="button">Create account</button></div>
          <div id="auth-panel"></div>
          <p class="message ${message ? 'error' : ''}" id="auth-message">${escapeHtml(message)}</p>
          <p class="auth-legal">By continuing, you agree to our terms and privacy notice.</p>
        </div>
        <div class="auth-mobile-brand"><span class="brand-mark">W</span> workflow<span class="brand-accent">OS</span></div>
      </section>
    </main>`;

  const panel = document.getElementById('auth-panel');
  const loginTab = document.getElementById('show-login');
  const registerTab = document.getElementById('show-register');

  function showLogin() {
    loginTab.classList.add('active');
    registerTab.classList.remove('active');
    panel.innerHTML = `
      <span class="eyebrow">WELCOME BACK</span><h2>Sign in to your business</h2><p class="form-intro">Use your business admin account to continue.</p>
      <form id="login-form" class="form-stack">
        <label>Email address<input name="email" type="email" autocomplete="email" placeholder="you@business.co.za" required /></label>
        <label>Password<input name="password" type="password" autocomplete="current-password" placeholder="Enter your password" required /></label>
        <button class="button button-primary button-wide" type="submit">Sign in <span aria-hidden="true">→</span></button>
      </form>`;
    document.getElementById('login-form').addEventListener('submit', login);
  }

  function showRegister() {
    registerTab.classList.add('active');
    loginTab.classList.remove('active');
    panel.innerHTML = `
      <span class="eyebrow">GET STARTED</span><h2>Create your workspace</h2><p class="form-intro">Set up your admin account and business profile.</p>
      <form id="register-form" class="form-stack form-grid">
        <label>First name<input name="firstName" autocomplete="given-name" required /></label>
        <label>Last name<input name="lastName" autocomplete="family-name" required /></label>
        <label class="span-two">Email address<input name="email" type="email" autocomplete="email" required /></label>
        <label class="span-two">Password<input name="password" type="password" autocomplete="new-password" minlength="10" required /></label>
        <label class="span-two">Business name<input name="businessName" required /></label>
        <label class="span-two">Business type<select name="businessType"><option value="hair_salon">Hair salon</option><option value="barbershop">Barbershop</option><option value="spaza">Spaza shop</option><option value="retail">Retail</option></select></label>
        <button class="button button-primary button-wide span-two" type="submit">Create account <span aria-hidden="true">→</span></button>
      </form>`;
    document.getElementById('register-form').addEventListener('submit', register);
  }

  loginTab.addEventListener('click', showLogin);
  registerTab.addEventListener('click', showRegister);
  showLogin();
}

async function login(event) {
  event.preventDefault();
  const message = document.getElementById('auth-message');
  const submit = event.currentTarget.querySelector('button[type="submit"]');
  submit.disabled = true;
  submit.textContent = 'Signing in…';
  try {
    const data = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget).entries())),
    }).then(async (response) => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Sign in failed.');
      return body;
    });
    sessionToken = data.sessionToken;
    localStorage.setItem('workflowos_session', sessionToken);
    navigate('/dashboard', true);
    await loadAuthenticatedApp();
  } catch (error) {
    message.textContent = error.message;
    message.className = 'message error';
    submit.disabled = false;
    submit.innerHTML = 'Sign in <span aria-hidden="true">→</span>';
  }
}

async function register(event) {
  event.preventDefault();
  const message = document.getElementById('auth-message');
  const submit = event.currentTarget.querySelector('button[type="submit"]');
  submit.disabled = true;
  submit.textContent = 'Creating workspace…';
  try {
    const data = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget).entries())),
    }).then(async (response) => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Registration failed.');
      return body;
    });
    sessionToken = data.sessionToken;
    localStorage.setItem('workflowos_session', sessionToken);
    navigate('/dashboard', true);
    await loadAuthenticatedApp();
  } catch (error) {
    message.textContent = error.message;
    message.className = 'message error';
    submit.disabled = false;
    submit.textContent = 'Create account →';
  }
}

async function loadAuthenticatedApp() {
  if (!sessionToken) {
    navigate('/login', true);
    renderAuth();
    return;
  }
  try {
    sessionInfo = await api('/api/session');
    if (!sessionInfo.business) throw new Error('No business is assigned to this account.');
    if (location.pathname !== appPath('/dashboard') && location.pathname !== BASE_PATH) navigate('/dashboard', true);
    if (location.pathname === BASE_PATH) navigate('/dashboard', true);
    currentView = ['dashboard', 'sales', 'products', 'inventory', 'customers', 'settings'].includes(currentView) ? currentView : 'dashboard';
    renderShell();
    await renderView(currentView);
  } catch (error) {
    if (sessionToken) {
      clearSession();
      navigate('/login', true);
      renderAuth(error.message);
    }
  }
}

function renderShell() {
  const business = sessionInfo.business;
  const user = sessionInfo.user || {};
  const initials = `${user.firstName?.[0] || ''}${user.lastName?.[0] || user.email?.[0] || 'U'}`.toUpperCase();
  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar" id="sidebar">
        <a class="brand" href="/WorkflowOs/dashboard"><span class="brand-mark">W</span><span>workflow<span class="brand-accent">OS</span></span></a>
        <div class="business-switcher"><span class="business-avatar">${escapeHtml((business.name || 'B').slice(0, 1).toUpperCase())}</span><span class="business-meta"><strong>${escapeHtml(business.name)}</strong><small>${escapeHtml(business.businessType || 'Business workspace')}</small></span><span class="switch-chevron">⌄</span></div>
        <p class="nav-caption">WORKSPACE</p>
        <nav class="side-nav" aria-label="Main navigation">${navItems.map((item) => item.planned
          ? `<span class="nav-item nav-disabled" title="This module is planned"><span class="nav-icon">${item.icon}</span><span>${item.label}</span><small>SOON</small></span>`
          : `<button class="nav-item ${item.id === currentView ? 'selected' : ''}" data-view="${item.id}" type="button"><span class="nav-icon">${item.icon}</span><span>${item.label}</span></button>`).join('')}</nav>
        <div class="sidebar-bottom"><div class="sidebar-help"><span class="help-icon">?</span><span><strong>Need a hand?</strong><small>Help & support</small></span><span>↗</span></div><div class="sidebar-version">WORKFLOWOS · LOCAL PREVIEW</div></div>
      </aside>
      <main class="main-area">
        <header class="topbar"><button class="icon-button menu-button" id="menu-toggle" aria-label="Toggle navigation">☰</button><div class="breadcrumbs"><span>Workspace</span><span class="breadcrumb-slash">/</span><strong id="topbar-title">Dashboard</strong></div><div class="topbar-actions"><button class="icon-button" id="refresh-button" aria-label="Refresh data" title="Refresh">↻</button><div class="profile"><span class="profile-avatar">${escapeHtml(initials)}</span><span class="profile-copy"><strong>${escapeHtml(user.firstName ? `${user.firstName} ${user.lastName || ''}` : user.email || 'Business admin')}</strong><small>Business admin</small></span><button class="profile-menu" id="profile-menu" aria-label="Account menu">⌄</button><div class="profile-dropdown hidden" id="profile-dropdown"><span>${escapeHtml(user.email || '')}</span><button id="logout-button" type="button">Sign out</button></div></div></div></header>
        <div class="page-content" id="page-content"><div class="loading-panel"><span class="spinner"></span>Loading your workspace…</div></div>
      </main>
    </div>`;

  app.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => {
    currentView = button.dataset.view;
    renderShell();
    renderView(currentView);
  }));
  document.getElementById('menu-toggle').addEventListener('click', () => document.getElementById('sidebar').classList.toggle('sidebar-open'));
  document.getElementById('profile-menu').addEventListener('click', () => document.getElementById('profile-dropdown').classList.toggle('hidden'));
  document.getElementById('logout-button').addEventListener('click', async () => {
    try { await api('/api/logout', { method: 'POST' }); } catch { /* clear local session even if offline */ }
    clearSession();
    navigate('/login', true);
    renderAuth();
  });
  document.getElementById('refresh-button').addEventListener('click', () => renderView(currentView));
}

function setPageTitle(view) {
  const item = navItems.find((entry) => entry.id === view);
  document.getElementById('topbar-title').textContent = item?.label || 'Dashboard';
}

async function renderView(view) {
  setPageTitle(view);
  const content = document.getElementById('page-content');
  if (!content) return;
  content.innerHTML = '<div class="loading-panel"><span class="spinner"></span>Loading business data…</div>';
  try {
    if (view === 'dashboard') return await renderDashboard(content);
    if (view === 'products') return await renderProducts(content);
    if (view === 'customers') return await renderCustomers(content);
    if (view === 'inventory') return await renderInventory(content);
    if (view === 'sales') return await renderSales(content);
    if (view === 'settings') return await renderSettings(content);
    content.innerHTML = '<div class="empty-state"><h2>Module not available</h2><p>This area is not included in the current local prototype.</p></div>';
  } catch (error) {
    content.innerHTML = `<div class="error-panel"><strong>We couldn’t load this view.</strong><p>${escapeHtml(error.message)}</p><button class="button button-secondary" id="retry-view">Try again</button></div>`;
    document.getElementById('retry-view').addEventListener('click', () => renderView(view));
  }
}

function changeMetric(value, label) {
  if (value === null || value === undefined) return '<span class="metric-change neutral">No prior data</span>';
  const up = value >= 0;
  return `<span class="metric-change ${up ? 'positive' : 'negative'}">${up ? '↑' : '↓'} ${Math.abs(value)}% <span>${label}</span></span>`;
}

function kpiCard(icon, title, value, note, change, tone = '') {
  return `<article class="kpi-card"><div class="kpi-top"><span class="kpi-icon ${tone}">${icon}</span>${change || ''}</div><p class="kpi-label">${title}</p><strong class="kpi-value">${value}</strong><p class="kpi-note">${note}</p></article>`;
}

async function renderDashboard(content) {
  const query = new URLSearchParams({ period: currentPeriod, granularity: currentGranularity });
  if (currentPeriod === 'custom' && customStartDate && customEndDate) {
    query.set('startDate', customStartDate);
    query.set('endDate', customEndDate);
  }
  dashboardData = await api(`/api/dashboard?${query}`);
  const data = dashboardData;
  const summary = data.summary;
  const today = summary.today;
  const currency = data.business.currency;
  const periodOptions = [['today', 'Today'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['month', 'This month'], ['custom', 'Custom range']];
  if (currentPeriod === 'custom' && !customStartDate) customStartDate = data.todayDate;
  if (currentPeriod === 'custom' && !customEndDate) customEndDate = data.todayDate;
  const maxRevenue = Math.max(1, ...data.trends.map((point) => point.revenueCents));

  content.innerHTML = `
    <section class="page-heading"><div><span class="eyebrow">BUSINESS OVERVIEW · ${escapeHtml(data.todayDate)}</span><h1>Good to see you, ${escapeHtml(sessionInfo.user?.firstName || 'there')}.</h1><p>Here’s how ${escapeHtml(data.business.name)} is doing today.</p></div><div class="heading-actions"><button class="button button-secondary" id="quick-sale">＋ Record a sale</button><button class="button button-primary" id="dashboard-refresh">Refresh overview <span>↻</span></button></div></section>
    <section class="kpi-grid" aria-label="Today's business metrics">
      ${kpiCard('R', 'Today’s revenue', money(today.revenueCents, currency), 'Completed sales · business local time', changeMetric(today.revenueChangePct, 'vs yesterday'), 'icon-green')}
      ${kpiCard('↗', 'Transactions', String(today.transactionCount), `Average ${money(today.averageTransactionCents, currency)} per sale`, changeMetric(today.transactionChangePct, 'vs yesterday'), 'icon-blue')}
      ${kpiCard('▦', 'Items sold', String(today.itemsSold), `${today.uniqueProductsSold} unique product${today.uniqueProductsSold === 1 ? '' : 's'}`, changeMetric(today.itemsSoldChangePct, 'vs yesterday'), 'icon-violet')}
      ${kpiCard('⌁', 'Gross profit', money(today.grossProfitCents, currency), today.grossProfitComplete ? `${today.grossProfitMarginPct ?? 0}% margin` : 'Partial — some product costs missing', today.grossProfitComplete ? '' : '<span class="metric-change neutral">Cost data incomplete</span>', 'icon-amber')}
      ${kpiCard('◎', 'Customers', String(summary.customers.total), `+${summary.customers.newToday} new · ${summary.customers.returningToday} returning today`, '', 'icon-teal')}
      ${kpiCard('!', 'Stock attention', String(summary.inventory.lowStockCount + summary.inventory.outOfStockCount), `${summary.inventory.lowStockCount} low · ${summary.inventory.outOfStockCount} out of stock`, '<button class="text-link" data-view="inventory">View stock →</button>', 'icon-red')}
    </section>
    <section class="dashboard-grid primary-grid">
      <article class="panel chart-panel"><div class="panel-heading"><div><h2>Revenue performance</h2><p>Completed sales · ${escapeHtml(currency)}</p></div><div class="chart-controls"><select id="period-select" aria-label="Reporting period">${periodOptions.map(([value, label]) => `<option value="${value}" ${currentPeriod === value ? 'selected' : ''}>${label}</option>`).join('')}</select><select id="granularity-select" aria-label="Chart interval"><option value="daily" ${currentGranularity === 'daily' ? 'selected' : ''}>Daily</option><option value="weekly" ${currentGranularity === 'weekly' ? 'selected' : ''}>Weekly</option><option value="monthly" ${currentGranularity === 'monthly' ? 'selected' : ''}>Monthly</option></select></div></div>
      ${currentPeriod === 'custom' ? `<form class="custom-range" id="custom-range"><label>From<input type="date" name="startDate" value="${escapeHtml(customStartDate)}" required /></label><label>To<input type="date" name="endDate" value="${escapeHtml(customEndDate)}" required /></label><button class="button button-secondary" type="submit">Apply dates</button></form>` : ''}
      ${data.trends.some((point) => point.revenueCents > 0) ? `<div class="chart-total">${money(data.periodComparison.revenueCents, currency)}<span>in selected period</span>${changeMetric(data.periodComparison.changePct, 'vs previous period')}</div><div class="revenue-chart" role="img" aria-label="Revenue chart">${data.trends.map((point) => `<div class="chart-column"><div class="chart-bar-wrap"><div class="chart-bar ${point.revenueCents ? '' : 'zero'}" style="height:${Math.max(point.revenueCents ? 6 : 0, (point.revenueCents / maxRevenue) * 100)}%" title="${escapeHtml(point.date)}: ${money(point.revenueCents, currency)}"></div></div><span class="chart-value">${point.revenueCents ? money(point.revenueCents, currency) : '—'}</span><span class="chart-label">${escapeHtml(point.date.slice(5))}</span></div>`).join('')}</div>` : '<div class="chart-empty"><span class="empty-chart-icon">⌁</span><strong>No completed sales in this period</strong><span>Record a sale to see revenue trends here.</span></div>'}</article>
      <article class="panel best-panel"><div class="panel-heading"><div><h2>Best-selling products</h2><p>Ranked by units sold</p></div><span class="period-chip">${periodOptions.find(([value]) => value === currentPeriod)?.[1] || 'Custom range'}</span></div>
        ${data.bestSellers.length ? `<div class="best-list">${data.bestSellers.map((product, index) => `<div class="best-row"><span class="rank-badge ${index === 0 ? 'rank-first' : ''}">${String(index + 1).padStart(2, '0')}</span><span class="product-initial">${escapeHtml(product.name.slice(0, 1).toUpperCase())}</span><span class="best-product"><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.category || 'Uncategorised')} · ${money(product.revenueCents, currency)}${product.grossProfitComplete ? ` · ${money(product.grossProfitCents, currency)} profit` : ' · profit incomplete'}</small></span><span class="best-units"><strong>${product.quantitySold}</strong><small>sold</small></span></div>`).join('')}</div>` : '<div class="mini-empty">No product sales in this period yet.</div>'}
      </article>
    </section>
    <section class="dashboard-grid lower-grid">
      <article class="panel activity-panel"><div class="panel-heading"><div><h2>Today’s sales activity</h2><p>Latest transactions for ${escapeHtml(data.todayDate)}</p></div><button class="text-link" data-view="sales">All transactions →</button></div>
        ${data.recentSales.length ? `<div class="table-scroll"><table><thead><tr><th>Transaction</th><th>Customer</th><th>Items</th><th>Amount</th><th>Payment</th><th>Status</th></tr></thead><tbody>${data.recentSales.map((sale) => `<tr><td><strong class="transaction-ref">${escapeHtml(sale.reference)}</strong><small>${escapeHtml(dateTime(sale.created_at, data.business.timezone))}</small></td><td>${escapeHtml(sale.customer_name || 'Walk-in')}</td><td>${sale.items_count}</td><td><strong>${money(sale.total_cents, currency)}</strong></td><td>${escapeHtml(sale.payment_method || '—')}</td><td><span class="status-pill status-${escapeHtml(sale.status)}">${escapeHtml(sale.status)}</span></td></tr>`).join('')}</tbody></table></div>` : '<div class="table-empty"><strong>No sales recorded today</strong><span>Once you record a sale, it will appear here.</span><button class="button button-secondary" id="empty-sale">Record first sale</button></div>'}
      </article>
      <article class="panel insights-panel"><div class="panel-heading"><div><h2>Business insights</h2><p>Signals from your recorded data</p></div><span class="insight-spark">✧</span></div><div class="insight-list">
        ${data.insights.mostProfitableProduct ? `<div class="insight-row"><span class="insight-icon insight-green">↗</span><span><strong>Profit leader</strong><small>${escapeHtml(data.insights.mostProfitableProduct.name)} · ${money(data.insights.mostProfitableProduct.grossProfitCents, currency)} gross profit</small></span></div>` : `<div class="insight-row"><span class="insight-icon insight-green">↗</span><span><strong>Profit leader</strong><small>More cost-complete sales needed to identify this.</small></span></div>`}
        ${data.insights.bestCategory ? `<div class="insight-row"><span class="insight-icon insight-purple">◇</span><span><strong>Leading category</strong><small>${escapeHtml(data.insights.bestCategory.name)} · ${money(data.insights.bestCategory.revenueCents, currency)} revenue</small></span></div>` : `<div class="insight-row"><span class="insight-icon insight-purple">◇</span><span><strong>Leading category</strong><small>Category sales will appear after your first sale.</small></span></div>`}
        <div class="insight-row"><span class="insight-icon insight-amber">!</span><span><strong>Stock to review</strong><small>${summary.inventory.lowStockCount + summary.inventory.outOfStockCount} product${summary.inventory.lowStockCount + summary.inventory.outOfStockCount === 1 ? '' : 's'} need attention · <button class="inline-link" data-view="inventory">Review inventory</button></small></span></div>
        <div class="insight-row"><span class="insight-icon insight-blue">◎</span><span><strong>Customer base</strong><small>${summary.customers.newToday} new customers added today</small></span></div>
      </div></article>
    </section>
    <div class="dashboard-footnote">Metrics use completed sales recorded in ${escapeHtml(data.business.timezone)}. Profit is based on sale-time cost snapshots; estimates are marked when costs are missing.</div>`;

  content.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => {
    currentView = button.dataset.view;
    renderShell();
    renderView(currentView);
  }));
  document.getElementById('period-select').addEventListener('change', (event) => {
    currentPeriod = event.target.value;
    if (currentPeriod === 'custom') { customStartDate = data.todayDate; customEndDate = data.todayDate; }
    renderView('dashboard');
  });
  document.getElementById('granularity-select').addEventListener('change', (event) => { currentGranularity = event.target.value; renderView('dashboard'); });
  document.getElementById('custom-range')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    customStartDate = values.startDate;
    customEndDate = values.endDate;
    renderView('dashboard');
  });
  document.getElementById('dashboard-refresh').addEventListener('click', () => renderView('dashboard'));
  document.getElementById('quick-sale')?.addEventListener('click', () => { currentView = 'sales'; renderShell(); renderView('sales'); });
  document.getElementById('empty-sale')?.addEventListener('click', () => { currentView = 'sales'; renderShell(); renderView('sales'); });
}

async function getProducts() {
  return (await api('/api/products')).products || [];
}

async function renderProductsLegacy(content) {
  const products = await getProducts();
  const currency = sessionInfo.business.currency;
  content.innerHTML = `<section class="page-heading"><div><span class="eyebrow">CATALOGUE</span><h1>Products & services</h1><p>Manage what you sell and the costs that power accurate profit reporting.</p></div></section><section class="panel form-panel"><h2>Add a product</h2><form id="product-form" class="record-form"><label>Product name<input name="name" required /></label><label>SKU<input name="sku" /></label><label>Category<input name="category" /></label><label>Price (${escapeHtml(currency)})<input type="number" min="0" step="0.01" name="price" required /></label><label>Unit cost (${escapeHtml(currency)})<input type="number" min="0" step="0.01" name="cost" placeholder="Leave blank if unknown" /></label><label>Opening stock<input type="number" min="0" step="1" name="initialStock" value="0" required /></label><label>Reorder threshold<input type="number" min="0" step="1" name="reorderLevel" value="0" required /></label><button class="button button-primary" type="submit">Save product</button></form></section><section class="panel list-panel"><div class="panel-heading"><div><h2>Your catalogue</h2><p>${products.length} product${products.length === 1 ? '' : 's'} · changes are saved to your business database</p></div></div>${products.length ? `<div class="table-scroll"><table><thead><tr><th>Product</th><th>SKU</th><th>Category</th><th>Price</th><th>Cost status</th></tr></thead><tbody>${products.map((product) => `<tr><td><strong>${escapeHtml(product.name)}</strong></td><td>${escapeHtml(product.sku || '—')}</td><td>${escapeHtml(product.category || '—')}</td><td>${money(product.price_cents, currency)}</td><td>${product.cost_is_known ? 'Recorded' : 'Not recorded'}</td></tr>`).join('')}</tbody></table></div>` : '<div class="table-empty"><strong>Your catalogue is empty</strong><span>Add the products you sell to start recording transactions.</span></div>'}</section>`;
  document.getElementById('product-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      await api('/api/products', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget).entries())) });
      await renderView('products');
    } catch (error) { showInlineError(event.currentTarget, error.message); submit.disabled = false; }
  });
}

async function renderCustomers(content) {
  const customers = (await api('/api/customers')).customers || [];
  content.innerHTML = `<section class="page-heading"><div><span class="eyebrow">RELATIONSHIPS</span><h1>Customers</h1><p>Keep customer details and return visits connected to your business.</p></div></section><section class="panel form-panel"><h2>Add a customer</h2><form id="customer-form" class="record-form"><label>Name<input name="name" required /></label><label>Email<input type="email" name="email" /></label><label>Phone<input name="phone" /></label><button class="button button-primary" type="submit">Add customer</button></form></section><section class="panel list-panel"><div class="panel-heading"><div><h2>Customer directory</h2><p>${customers.length} registered customer${customers.length === 1 ? '' : 's'}</p></div></div>${customers.length ? `<div class="table-scroll"><table><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Loyalty points</th><th>Added</th></tr></thead><tbody>${customers.map((customer) => `<tr><td><strong>${escapeHtml(customer.name)}</strong></td><td>${escapeHtml(customer.email || '—')}</td><td>${escapeHtml(customer.phone || '—')}</td><td>${customer.loyalty_points}</td><td>${escapeHtml(customer.created_at.slice(0, 10))}</td></tr>`).join('')}</tbody></table></div>` : '<div class="table-empty"><strong>No customers yet</strong><span>Customer records you add will appear here.</span></div>'}</section>`;
  document.getElementById('customer-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      await api('/api/customers', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget).entries())) });
      await renderView('customers');
    } catch (error) { showInlineError(event.currentTarget, error.message); submit.disabled = false; }
  });
}

async function renderInventory(content) {
  const [products, data] = await Promise.all([getProducts(), api('/api/dashboard')]);
  const items = data.summary.inventory.lowStockProducts;
  const inventoryRows = products.map((product) => ({ product, inventory: null }));
  const details = await api('/api/inventory');
  const byProduct = new Map(details.inventory.map((row) => [row.product_id, row]));
  content.innerHTML = `<section class="page-heading"><div><span class="eyebrow">OPERATIONS</span><h1>Inventory & stock</h1><p>Track on-hand quantities, replenishment thresholds and stock changes.</p></div></section><section class="kpi-grid inventory-kpis">${kpiCard('!', 'Below reorder level', String(data.summary.inventory.lowStockCount), 'Replenishment suggested', '', 'icon-amber')}${kpiCard('0', 'Out of stock', String(data.summary.inventory.outOfStockCount), 'No units available', '', 'icon-red')}</section><section class="panel list-panel"><div class="panel-heading"><div><h2>Stock on hand</h2><p>Every adjustment is recorded in the stock movement ledger.</p></div></div>${inventoryRows.length ? `<div class="table-scroll"><table><thead><tr><th>Product</th><th>On hand</th><th>Reorder at</th><th>Status</th><th>Receive / adjust</th></tr></thead><tbody>${inventoryRows.map(({ product }) => { const stock = byProduct.get(product.id); const low = stock.quantity_on_hand < stock.reorder_level; return `<tr><td><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.sku || '')}</small></td><td>${stock.quantity_on_hand}</td><td>${stock.reorder_level}</td><td><span class="status-pill ${stock.quantity_on_hand === 0 ? 'status-refunded' : low ? 'status-cancelled' : 'status-completed'}">${stock.quantity_on_hand === 0 ? 'Out of stock' : low ? 'Low stock' : 'In stock'}</span></td><td><form class="stock-adjust-form" data-product-id="${product.id}"><input aria-label="Quantity adjustment for ${escapeHtml(product.name)}" name="quantity" type="number" step="1" placeholder="± units" required /><input aria-label="Adjustment reason" name="notes" placeholder="Reason" /><button class="button button-small" type="submit">Apply</button></form></td></tr>`; }).join('')}</tbody></table></div>` : '<div class="table-empty"><strong>No products to track</strong><span>Add products with opening stock and reorder levels to get started.</span><button class="button button-secondary" id="add-product-link">Add products</button></div>'}</section>${items.length ? `<section class="panel"><h2>Needs attention</h2><div class="best-list">${items.map((item) => `<div class="best-row"><span class="product-initial">!</span><span class="best-product"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.category || 'Uncategorised')}</small></span><span class="best-units"><strong>${item.quantity_on_hand}</strong><small>of ${item.reorder_level} reorder</small></span></div>`).join('')}</div></section>` : ''}`;
  content.querySelectorAll('.stock-adjust-form').forEach((form) => form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form).entries());
    const submit = form.querySelector('button');
    submit.disabled = true;
    try {
      await api(`/api/inventory/${form.dataset.productId}/adjustments`, { method: 'POST', body: JSON.stringify({ quantity: Number(values.quantity), notes: values.notes }) });
      await renderView('inventory');
    } catch (error) { showInlineError(form, error.message); submit.disabled = false; }
  }));
  document.getElementById('add-product-link')?.addEventListener('click', () => { currentView = 'products'; renderShell(); renderView('products'); });
}

async function renderSalesLegacy(content) {
  const [products, customers, data] = await Promise.all([getProducts(), api('/api/customers'), api('/api/dashboard')]);
  const availableProducts = products.filter((product) => product.is_active);
  content.innerHTML = `<section class="page-heading"><div><span class="eyebrow">REVENUE</span><h1>Sales & transactions</h1><p>Record completed sales against current catalogue and stock.</p></div></section><section class="panel form-panel"><h2>Record a sale</h2>${availableProducts.length ? `<form id="sale-form" class="record-form"><label>Product<select name="productId" required>${availableProducts.map((product) => `<option value="${product.id}">${escapeHtml(product.name)} · ${money(product.price_cents, sessionInfo.business.currency)}</option>`).join('')}</select></label><label>Quantity<input name="quantity" type="number" min="1" step="1" value="1" required /></label><label>Customer<select name="customerId"><option value="">Walk-in customer</option>${customers.customers.map((customer) => `<option value="${customer.id}">${escapeHtml(customer.name)}</option>`).join('')}</select></label><label>Payment method<select name="paymentMethod"><option value="cash">Cash</option><option value="card">Card</option><option value="eft">EFT</option><option value="other">Other</option></select></label><button class="button button-primary" type="submit">Record completed sale</button></form><p class="form-help">This records a sale already completed by your business; it does not charge a card or verify a payment. Payment method is operator-recorded. Sale snapshots, stock deductions, and ledger movements are saved together. Insufficient stock blocks recording.</p>` : '<div class="table-empty"><strong>Add products before recording sales</strong><span>Sales use your catalogue prices and tracked stock.</span><button class="button button-secondary" id="sales-add-product">Add a product</button></div>'}</section><section class="panel activity-panel"><div class="panel-heading"><div><h2>Today’s transactions</h2><p>${data.recentSales.length} transaction${data.recentSales.length === 1 ? '' : 's'} · ${escapeHtml(data.todayDate)} local time</p></div></div>${data.recentSales.length ? `<div class="table-scroll"><table><thead><tr><th>Reference</th><th>Time</th><th>Customer</th><th>Items</th><th>Amount</th><th>Status</th><th>Action</th></tr></thead><tbody>${data.recentSales.map((sale) => `<tr><td><strong>${escapeHtml(sale.reference)}</strong></td><td>${escapeHtml(dateTime(sale.created_at, data.business.timezone))}</td><td>${escapeHtml(sale.customer_name || 'Walk-in')}</td><td>${sale.items_count}</td><td><strong>${money(sale.total_cents, sessionInfo.business.currency)}</strong></td><td><span class="status-pill status-${escapeHtml(sale.status)}">${escapeHtml(sale.status)}</span></td><td>${sale.status === 'completed' ? `<button class="text-link refund-button" data-sale-id="${sale.id}">Refund & restock</button>` : '—'}</td></tr>`).join('')}</tbody></table></div>` : '<div class="table-empty"><strong>No transactions today</strong><span>Completed sales will be listed here.</span></div>'}</section>`;
  document.getElementById('sale-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    submit.disabled = true;
    submit.textContent = 'Saving sale…';
    try {
      await api('/api/sales', {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({
          paymentMethod: values.paymentMethod,
          customerId: values.customerId || null,
          items: [{ productId: Number(values.productId), quantity: Number(values.quantity) }],
        }),
      });
      currentView = 'sales';
      await renderView('sales');
    } catch (error) { showInlineError(event.currentTarget, error.message); submit.disabled = false; submit.textContent = 'Complete sale'; }
  });
  document.getElementById('sales-add-product')?.addEventListener('click', () => { currentView = 'products'; renderShell(); renderView('products'); });
  content.querySelectorAll('.refund-button').forEach((button) => button.addEventListener('click', async () => {
    if (!confirm('Refund this completed sale and return its quantities to stock?')) return;
    button.disabled = true;
    try { await api(`/api/sales/${button.dataset.saleId}/refund`, { method: 'POST' }); await renderView('sales'); }
    catch (error) { alert(error.message); button.disabled = false; }
  }));
}

async function renderProducts(content) {
  const products = await getProducts();
  const currency = sessionInfo.business.currency;
  let editingProductId = null;
  let actionMessage = '';
  content.innerHTML = `
    <section class="page-heading"><div><span class="eyebrow">CATALOGUE</span><h1>Products & services</h1><p>Manage your business-specific prices, stock, and product identifiers.</p></div><div class="heading-actions"><button class="button button-secondary" id="export-products">Export CSV</button><label class="button button-secondary file-button">Import CSV<input id="import-products-file" type="file" accept=".csv,text/csv" hidden /></label></div></section>
    <section class="panel form-panel" id="product-editor"><h2 id="product-form-title">Add a product</h2><form id="product-form" class="record-form"><label>Product name<input name="name" maxlength="180" required /></label><label>Brand<input name="brand" /></label><label>Barcode ID<input name="barcode" inputmode="numeric" placeholder="EAN/UPC; remains unverified" /></label><label>SKU<input name="sku" /></label><label>Category<input name="category" /></label><label>Description<input name="description" maxlength="2000" /></label><label>Packaging size<input name="packagingSize" placeholder="e.g. 1 L" /></label><label>Unit of measure<input name="unitOfMeasure" value="unit" maxlength="32" required /></label><label>Product image URL (HTTPS)<input name="imageUrl" type="url" placeholder="https://…" /></label><label>Price (${escapeHtml(currency)})<input type="number" min="0" step="0.01" name="price" required /></label><label>Unit cost (${escapeHtml(currency)})<input type="number" min="0" step="0.01" name="cost" placeholder="Leave blank if unknown" /></label><label id="stock-field-label">Opening stock<input type="number" min="0" step="1" name="initialStock" value="0" required /></label><label id="reorder-field-label">Reorder threshold<input type="number" min="0" step="1" name="reorderLevel" value="0" required /></label><label id="active-field-label" class="hidden">Status<select name="isActive"><option value="1">Active</option><option value="0">Inactive / archived</option></select></label><div class="product-form-actions"><button class="button button-primary" type="submit" id="product-form-submit">Save product</button><button class="button button-secondary hidden" type="button" id="product-form-cancel">Cancel</button></div></form><p class="form-help">Barcode edits remain unverified unless identified through the reviewed shared catalogue. Stock changes are written to the inventory movement ledger.</p><div id="product-import-feedback" class="inline-feedback">${escapeHtml(actionMessage)}</div></section>
    <section class="panel list-panel"><div class="panel-heading"><div><h2>Your catalogue</h2><p>${products.length} product${products.length === 1 ? '' : 's'} · prices and stock are private to this business</p></div></div>${products.length ? `<div class="table-scroll"><table><thead><tr><th>Product</th><th>Brand / pack</th><th>Barcode</th><th>SKU / category</th><th>Price</th><th>Stock</th><th>Status</th><th>Actions</th></tr></thead><tbody>${products.map((product) => `<tr><td><strong>${escapeHtml(product.name)}</strong></td><td>${escapeHtml(product.brand || '—')}<small>${escapeHtml(product.packaging_size || '')}</small></td><td>${escapeHtml(product.barcode || '—')}<small>${escapeHtml(product.barcode_status || 'unverified')}</small></td><td>${escapeHtml(product.sku || '—')}<small>${escapeHtml(product.category || '—')}</small></td><td>${money(product.price_cents, currency)}</td><td>${product.quantity_on_hand ?? 0} ${escapeHtml(product.unit_of_measure || 'unit')}</td><td><span class="status-pill ${product.is_active ? 'status-completed' : 'status-refunded'}">${product.is_active ? 'Active' : 'Inactive'}</span></td><td><div class="product-row-actions"><button class="text-link edit-product" data-product-id="${product.id}">Edit</button><button class="text-link archive-product" data-product-id="${product.id}" data-active="${product.is_active}">${product.is_active ? 'Archive' : 'Restore'}</button></div></td></tr>`).join('')}</tbody></table></div>` : '<div class="table-empty"><strong>Your catalogue is empty</strong><span>Add products or import a CSV catalogue.</span></div>'}</section>
    <section class="panel list-panel"><div class="panel-heading"><div><h2>Shared South African catalogue</h2><p>Only GS1/source-verified barcode records can identify a product automatically. Candidate entries are marked incomplete.</p></div></div><form id="global-catalogue-search" class="catalogue-search"><input name="query" placeholder="Search brand, product, or category" aria-label="Search shared catalogue" /><button class="button button-secondary" type="submit">Search catalogue</button></form><div id="global-catalogue-results" class="catalogue-results"><p class="muted-copy">Search the shared candidate catalogue.</p></div></section>`;

  const adminAccess = await api('/api/admin/catalogue-access');
  if (adminAccess.isAdmin) {
    const adminPanel = document.createElement('section');
    adminPanel.className = 'panel list-panel admin-catalogue-panel';
    adminPanel.innerHTML = `<div class="panel-heading"><div><h2>Platform catalogue review</h2><p>Review exact product/pack identity against a trusted source before marking any barcode verified.</p></div><span class="status-pill status-completed">Platform admin</span></div><form id="admin-catalogue-form" class="record-form admin-catalogue-form"><label>Product name<input name="productName" required /></label><label>Brand<input name="brand" /></label><label>Packaging size<input name="packagingSize" /></label><label>Category<input name="category" /></label><label>Product description<input name="description" /></label><label>Source note<input name="dataSource" placeholder="Where was identity checked?" required /></label><button class="button button-primary" type="submit">Add candidate</button></form><form id="admin-catalogue-filter" class="catalogue-search"><input name="query" placeholder="Find candidate or barcode" /><button class="button button-secondary" type="submit">Filter review list</button></form><div id="admin-catalogue-list" class="catalogue-results"></div><p class="form-help">Verification records an administrator's review; this app does not fetch or independently validate source contents. Use only a source you have actually checked.</p>`;
    content.append(adminPanel);
    const adminList = document.getElementById('admin-catalogue-list');
    const loadAdminList = async (query = '') => {
      const list = await api(`/api/admin/global-catalogue?q=${encodeURIComponent(query)}`);
      adminList.innerHTML = list.products.length ? list.products.map((item) => `<article class="catalogue-entry"><div><strong>${escapeHtml(item.brand || '')} ${escapeHtml(item.product_name)}</strong><small>${escapeHtml(item.category || 'Uncategorised')} · ${escapeHtml(item.packaging_size || 'pack size not supplied')}</small><span class="status-pill ${item.verification_status === 'verified' ? 'status-completed' : 'status-cancelled'}">${escapeHtml(item.verification_status)}</span><small>Product source: ${escapeHtml(item.data_source)}</small>${item.barcode ? `<small>Barcode ${escapeHtml(item.barcode)} · ${escapeHtml(item.barcode_format)} · ${escapeHtml(item.barcode_verification_status)} · ${escapeHtml(item.barcode_source || '')}</small>` : '<small>No barcode claim recorded</small>'}</div><div class="catalogue-admin-actions"><button class="button button-secondary admin-edit-entry" data-id="${item.id}">Edit candidate</button>${item.barcode ? (item.barcode_verification_status === 'verified' ? '' : `<button class="button button-small admin-verify-barcode" data-barcode-id="${item.barcode_record_id}">Verify reviewed barcode</button>`) : `<button class="button button-secondary admin-add-barcode" data-id="${item.id}">Add barcode claim</button>`}</div></article>`).join('') : '<p class="muted-copy">No shared catalogue records found.</p>';
      adminList.querySelectorAll('.admin-add-barcode').forEach((button) => button.addEventListener('click', async () => {
        const barcode = prompt('Barcode ID (EAN-13, EAN-8, or UPC-A)');
        if (!barcode) return;
        const dataSource = prompt('Source note for this barcode claim (not yet verified)');
        if (!dataSource) return;
        try { await api(`/api/admin/global-catalogue/${button.dataset.id}/barcodes`, { method: 'POST', body: JSON.stringify({ barcode, dataSource }) }); await loadAdminList(query); }
        catch (error) { alert(error.message); }
      }));
      adminList.querySelectorAll('.admin-verify-barcode').forEach((button) => button.addEventListener('click', async () => {
        if (!confirm('Have you confirmed the exact product and packaging against this source?')) return;
        const sourceUrl = prompt('HTTPS URL of the source you reviewed');
        if (!sourceUrl) return;
        try { await api(`/api/admin/global-catalogue/barcodes/${button.dataset.barcodeId}/verify`, { method: 'POST', body: JSON.stringify({ sourceUrl }) }); await loadAdminList(query); }
        catch (error) { alert(error.message); }
      }));
      adminList.querySelectorAll('.admin-edit-entry').forEach((button) => button.addEventListener('click', async () => {
        const item = list.products.find((entry) => entry.id === Number(button.dataset.id));
        if (!item) return;
        const productName = prompt('Product name', item.product_name);
        if (productName === null) return;
        const packagingSize = prompt('Packaging size', item.packaging_size || '');
        if (packagingSize === null) return;
        const dataSource = prompt('Updated product identity source note', item.data_source);
        if (!dataSource) return;
        try {
          await api(`/api/admin/global-catalogue/${item.id}`, { method: 'PUT', body: JSON.stringify({ productName, brand: item.brand, packagingSize, category: item.category, description: item.description, dataSource }) });
          await loadAdminList(query);
        } catch (error) { alert(error.message); }
      }));
    };
    document.getElementById('admin-catalogue-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      try {
        await api('/api/admin/global-catalogue', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) });
        form.reset();
        await loadAdminList();
      } catch (error) { showInlineError(form, error.message); }
    });
    document.getElementById('admin-catalogue-filter').addEventListener('submit', async (event) => {
      event.preventDefault();
      await loadAdminList(new FormData(event.currentTarget).get('query') || '');
    });
    await loadAdminList();
  }

  document.getElementById('product-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('button[type="submit"]');
    const feedback = document.getElementById('product-import-feedback');
    const values = Object.fromEntries(new FormData(form).entries());
    const method = editingProductId ? 'PUT' : 'POST';
    const url = editingProductId ? `/api/products/${editingProductId}` : '/api/products';
    if (editingProductId) {
      values.quantityOnHand = Number(values.quantityOnHand);
      values.reorderLevel = Number(values.reorderLevel);
      values.isActive = values.isActive === '1';
      delete values.initialStock;
    } else {
      delete values.quantityOnHand;
      delete values.isActive;
      values.initialStock = Number(values.initialStock);
      values.reorderLevel = Number(values.reorderLevel);
    }
    submit.disabled = true;
    submit.textContent = editingProductId ? 'Saving changes…' : 'Saving product…';
    feedback.textContent = '';
    try {
      await api(url, { method, body: JSON.stringify(values) });
      await renderView('products');
      const currentFeedback = document.getElementById('product-import-feedback');
      currentFeedback.textContent = method === 'PUT' ? 'Product changes saved successfully.' : 'Product created successfully.';
      currentFeedback.className = 'inline-feedback success';
    } catch (error) {
      showInlineError(form, error.message);
      submit.disabled = false;
      submit.textContent = editingProductId ? 'Save changes' : 'Save product';
    }
  });

  document.getElementById('product-form-cancel').addEventListener('click', () => renderView('products'));

  document.getElementById('export-products').addEventListener('click', async () => {
    try {
      const response = await fetch('/api/products/export.csv', { headers: { Authorization: `Bearer ${sessionToken}` } });
      if (!response.ok) throw new Error('Product export failed');
      const blob = await response.blob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'workflowos-products.csv';
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (error) { document.getElementById('product-import-feedback').textContent = error.message; }
  });

  document.getElementById('import-products-file').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const feedback = document.getElementById('product-import-feedback');
    try {
      const result = await api('/api/products/import-csv', { method: 'POST', body: JSON.stringify({ csv: await file.text() }) });
      const summary = result.summary;
      await renderView('products');
      const currentFeedback = document.getElementById('product-import-feedback');
      currentFeedback.textContent = `Import complete: ${summary.imported} imported, ${summary.duplicates} duplicates, ${summary.invalid} invalid, ${summary.incomplete} barcode record(s) unverified.`;
      currentFeedback.className = 'inline-feedback success';
    } catch (error) { feedback.textContent = error.message; feedback.className = 'inline-feedback error'; }
  });

  content.querySelectorAll('.edit-product').forEach((button) => button.addEventListener('click', async () => {
    const submit = document.getElementById('product-form-submit');
    submit.disabled = true;
    submit.textContent = 'Loading product…';
    try {
      const { product } = await api(`/api/products/${button.dataset.productId}`);
      editingProductId = product.id;
      const form = document.getElementById('product-form');
      const set = (name, value) => { form.elements.namedItem(name).value = value ?? ''; };
      set('name', product.name);
      set('brand', product.brand);
      set('barcode', product.barcode);
      set('sku', product.sku);
      set('category', product.category);
      set('description', product.description);
      set('packagingSize', product.packaging_size);
      set('unitOfMeasure', product.unit_of_measure || 'unit');
      set('imageUrl', product.image_url);
      set('price', (product.price_cents / 100).toFixed(2));
      set('cost', product.cost_is_known ? (product.cost_cents / 100).toFixed(2) : '');
      const stock = form.elements.namedItem('initialStock');
      stock.name = 'quantityOnHand';
      stock.value = product.quantity_on_hand;
      document.getElementById('stock-field-label').querySelector('input').setAttribute('aria-label', 'Current stock quantity');
      document.getElementById('stock-field-label').firstChild.textContent = 'Stock quantity';
      document.getElementById('reorder-field-label').querySelector('input').value = product.reorder_level;
      document.getElementById('active-field-label').classList.remove('hidden');
      set('isActive', product.is_active ? '1' : '0');
      document.getElementById('product-form-title').textContent = `Edit ${product.name}`;
      document.getElementById('product-form-submit').textContent = 'Save changes';
      document.getElementById('product-form-cancel').classList.remove('hidden');
      document.getElementById('product-import-feedback').textContent = `Editing product #${product.id}. Stock changes are ledgered; historical sales remain unchanged.`;
      document.getElementById('product-import-feedback').className = 'inline-feedback';
      document.getElementById('product-editor').scrollIntoView({ behavior: 'smooth', block: 'start' });
      document.getElementById('product-form').elements.namedItem('name').focus();
    } catch (error) {
      const feedback = document.getElementById('product-import-feedback');
      feedback.textContent = error.message;
      feedback.className = 'inline-feedback error';
    } finally {
      submit.disabled = false;
      if (!editingProductId) submit.textContent = 'Save product';
    }
  }));

  content.querySelectorAll('.archive-product').forEach((button) => button.addEventListener('click', async () => {
    const productId = button.dataset.productId;
    const isActive = button.dataset.active === '1';
    if (isActive && !confirm('Archive this product? Historical sales will be retained.')) return;
    button.disabled = true;
    try {
      if (isActive) await api(`/api/products/${productId}/archive`, { method: 'POST' });
      else await api(`/api/products/${productId}`, { method: 'PUT', body: JSON.stringify({ isActive: true }) });
      await renderView('products');
      const feedback = document.getElementById('product-import-feedback');
      feedback.textContent = isActive ? 'Product archived. Historical transactions were retained.' : 'Product restored.';
      feedback.className = 'inline-feedback success';
    } catch (error) {
      button.disabled = false;
      showInlineError(button.closest('td'), error.message);
    }
  }));

  document.getElementById('global-catalogue-search').addEventListener('submit', async (event) => {
    event.preventDefault();
    const query = new FormData(event.currentTarget).get('query');
    const results = document.getElementById('global-catalogue-results');
    results.innerHTML = '<p class="muted-copy">Searching catalogue…</p>';
    try {
      const data = await api(`/api/global-catalogue?q=${encodeURIComponent(query)}`);
      results.innerHTML = data.products.length ? data.products.map((item) => `<article class="catalogue-entry"><div><strong>${escapeHtml(item.brand || '')} ${escapeHtml(item.product_name)}</strong><small>${escapeHtml(item.category || 'Uncategorised')} · ${escapeHtml(item.packaging_size || 'pack size not supplied')}</small><span class="status-pill ${item.verification_status === 'verified' ? 'status-completed' : 'status-cancelled'}">${escapeHtml(item.verification_status === 'verified' ? 'catalogue verified' : 'incomplete candidate')}</span>${item.barcode ? `<small>Verified GTIN: ${escapeHtml(item.barcode)} (${escapeHtml(item.barcode_format)})</small>` : '<small>No verified GTIN available</small>'}</div><form class="catalogue-import-form" data-catalogue-id="${item.id}"><input type="number" name="price" min="0" step="0.01" placeholder="Price" required aria-label="Your selling price" /><input type="number" name="cost" min="0" step="0.01" placeholder="Your cost (optional)" aria-label="Your product cost" /><input type="number" name="initialStock" min="0" step="1" value="0" aria-label="Opening stock" /><input type="number" name="reorderLevel" min="0" step="1" value="0" aria-label="Reorder level" /><button class="button button-small" type="submit">Import to business</button></form></article>`).join('') : '<p class="muted-copy">No matching shared catalogue entries.</p>';
      results.querySelectorAll('.catalogue-import-form').forEach((form) => form.addEventListener('submit', async (submitEvent) => {
        submitEvent.preventDefault();
        const values = Object.fromEntries(new FormData(form).entries());
        const submit = form.querySelector('button');
        submit.disabled = true;
        try {
          await api(`/api/global-catalogue/${form.dataset.catalogueId}/import`, { method: 'POST', body: JSON.stringify(values) });
          await renderView('products');
        } catch (error) { showInlineError(form, error.message); submit.disabled = false; }
      }));
    } catch (error) { results.innerHTML = `<p class="inline-feedback error">${escapeHtml(error.message)}</p>`; }
  });
}

async function renderSales(content) {
  const [customers, data] = await Promise.all([api('/api/customers'), api('/api/dashboard')]);
  const currency = sessionInfo.business.currency;
  const cart = new Map();
  let selectedProduct = null;
  let searchTimer = null;
  let lastScannedBarcode = '';
  let lastScanAt = 0;

  content.innerHTML = `<section class="page-heading"><div><span class="eyebrow">REVENUE</span><h1>Sales & transactions</h1><p>Search your catalogue or scan product barcodes into a multi-item sale.</p></div></section>
    <div class="sales-layout"><section class="panel sales-entry"><div class="panel-heading"><div><h2>Build a transaction</h2><p>USB scanners act as keyboard input. Scan, or type a barcode and press Enter.</p></div></div>
      <label class="scanner-label">Scan barcode or search products<input id="product-lookup" autocomplete="off" placeholder="Scan barcode, search name or SKU…" aria-describedby="scan-feedback" /><small>Focus stays here after each successful scan.</small></label><div id="scan-feedback" class="scan-feedback" role="status" aria-live="polite"></div><div id="product-search-results" class="product-search-results"></div>
      <div id="selected-product" class="selected-product hidden"></div><button class="button button-primary add-selected-button hidden" id="add-selected-product" type="button">Add selected product</button>
      <div class="cart-heading"><h3>Current sale</h3><span id="cart-count">0 items</span></div><div id="sale-cart" class="sale-cart"><div class="cart-empty">Scan or search for a product to begin.</div></div>
      <form id="checkout-form" class="checkout-form"><label>Customer<select name="customerId"><option value="">Walk-in customer</option>${customers.customers.map((customer) => `<option value="${customer.id}">${escapeHtml(customer.name)}</option>`).join('')}</select></label><label>Payment method<select name="paymentMethod"><option value="cash">Cash</option><option value="card">Card</option><option value="eft">EFT</option><option value="other">Other</option></select></label><div class="cart-total"><span>Transaction total</span><strong id="cart-total">${money(0, currency)}</strong></div><button class="button button-primary button-wide" type="submit" id="complete-sale" disabled>Record completed sale</button></form>
      <p class="form-help">This records a transaction stated as already completed; it does not charge or verify a payment. Sale snapshots and stock movements are saved together. Only verified barcode mappings are used for automatic scans.</p>
    </section><section class="panel activity-panel"><div class="panel-heading"><div><h2>Today’s transactions</h2><p>${data.recentSales.length} transaction${data.recentSales.length === 1 ? '' : 's'} · ${escapeHtml(data.todayDate)} local time</p></div></div>${data.recentSales.length ? `<div class="table-scroll"><table><thead><tr><th>Reference</th><th>Time</th><th>Customer</th><th>Items</th><th>Amount</th><th>Payment</th><th>Status</th><th>Action</th></tr></thead><tbody>${data.recentSales.map((sale) => `<tr><td><strong>${escapeHtml(sale.reference)}</strong></td><td>${escapeHtml(dateTime(sale.created_at, data.business.timezone))}</td><td>${escapeHtml(sale.customer_name || 'Walk-in')}</td><td>${sale.items_count}</td><td><strong>${money(sale.total_cents, currency)}</strong></td><td>${escapeHtml(sale.payment_method || '—')}</td><td><span class="status-pill status-${escapeHtml(sale.status)}">${escapeHtml(sale.status)}</span></td><td>${sale.status === 'completed' ? `<button class="text-link refund-button" data-sale-id="${sale.id}">Refund & restock</button>` : '—'}</td></tr>`).join('')}</tbody></table></div>` : '<div class="table-empty"><strong>No transactions today</strong><span>Completed sales will be listed here.</span></div>'}</section></div>`;

  const input = document.getElementById('product-lookup');
  const feedback = document.getElementById('scan-feedback');
  const results = document.getElementById('product-search-results');
  const selectedPanel = document.getElementById('selected-product');
  const addSelected = document.getElementById('add-selected-product');

  function updateCart() {
    const rows = [...cart.values()];
    document.getElementById('cart-count').textContent = `${rows.reduce((sum, item) => sum + item.quantity, 0)} item${rows.length === 1 && rows[0]?.quantity === 1 ? '' : 's'}`;
    document.getElementById('cart-total').textContent = money(rows.reduce((sum, item) => sum + item.price_cents * item.quantity, 0), currency);
    document.getElementById('complete-sale').disabled = rows.length === 0;
    document.getElementById('sale-cart').innerHTML = rows.length ? rows.map((item) => `<div class="cart-row"><span class="product-initial">${escapeHtml(item.name.slice(0, 1).toUpperCase())}</span><span class="cart-product"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.barcode || item.sku || 'No barcode/SKU')} · ${money(item.price_cents, currency)} each · ${item.quantity_on_hand} in stock</small></span><label class="cart-quantity-label">Qty<input class="cart-quantity" type="number" min="1" max="${item.quantity_on_hand}" value="${item.quantity}" data-product-id="${item.id}" aria-label="Quantity of ${escapeHtml(item.name)}" /></label><strong class="cart-line-total">${money(item.price_cents * item.quantity, currency)}</strong><button class="remove-cart-item" type="button" data-product-id="${item.id}" aria-label="Remove ${escapeHtml(item.name)}">×</button></div>`).join('') : '<div class="cart-empty">Scan or search for a product to begin.</div>';
    document.querySelectorAll('.cart-quantity').forEach((field) => field.addEventListener('change', () => {
      const item = cart.get(Number(field.dataset.productId));
      const quantity = Number(field.value);
      if (!item || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > item.quantity_on_hand) { field.value = item?.quantity || 1; return; }
      item.quantity = quantity;
      updateCart();
    }));
    document.querySelectorAll('.remove-cart-item').forEach((button) => button.addEventListener('click', () => { cart.delete(Number(button.dataset.productId)); updateCart(); input.focus(); }));
  }

  function showSelected(product) {
    selectedProduct = product;
    selectedPanel.classList.remove('hidden');
    addSelected.classList.remove('hidden');
    selectedPanel.innerHTML = `<div class="selected-product-heading"><span class="product-initial">${escapeHtml(product.name.slice(0, 1).toUpperCase())}</span><div><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.brand || 'Business product')}</small></div></div><div class="selected-product-details"><span><small>Barcode ID</small><strong>${escapeHtml(product.barcode || 'Not recorded')}</strong></span><span><small>SKU</small><strong>${escapeHtml(product.sku || '—')}</strong></span><span><small>Category</small><strong>${escapeHtml(product.category || '—')}</strong></span><span><small>Selling price</small><strong>${money(product.price_cents, currency)}</strong></span><span><small>Available stock</small><strong>${product.quantity_on_hand}</strong></span><span><small>Barcode status</small><strong>${escapeHtml(product.barcode_status || 'unverified')}</strong></span></div>`;
    const inCart = cart.get(product.id)?.quantity || 0;
    addSelected.disabled = product.quantity_on_hand <= inCart;
    addSelected.textContent = product.quantity_on_hand <= inCart ? 'No more stock available' : 'Add 1 to sale';
  }

  function addToCart(product, scanner = false) {
    const existing = cart.get(product.id);
    if (!product.is_active || product.quantity_on_hand <= (existing?.quantity || 0)) {
      feedback.textContent = product.is_active ? `No available stock for ${product.name}.` : `${product.name} is inactive.`;
      feedback.className = 'scan-feedback error';
      return;
    }
    if (existing) existing.quantity += 1;
    else cart.set(product.id, { ...product, quantity: 1 });
    feedback.textContent = scanner ? `Added ${product.name} · ${money(product.price_cents, currency)} · ${product.quantity_on_hand - (existing ? existing.quantity : 1)} remaining after sale.` : `${product.name} added to this sale.`;
    feedback.className = 'scan-feedback success';
    results.innerHTML = '';
    selectedPanel.classList.add('hidden');
    addSelected.classList.add('hidden');
    selectedProduct = null;
    input.value = '';
    updateCart();
    input.focus();
  }

  async function lookupBarcode(value) {
    const now = Date.now();
    if (value === lastScannedBarcode && now - lastScanAt < 700) {
      feedback.textContent = 'Duplicate scan ignored. Scan again to add another unit.';
      feedback.className = 'scan-feedback neutral';
      return;
    }
    lastScannedBarcode = value;
    lastScanAt = now;
    try {
      const data = await api(`/api/products/barcode/${encodeURIComponent(value)}`);
      showSelected(data.product);
      addToCart(data.product, true);
    } catch (error) {
      feedback.textContent = error.message.includes('Invalid') ? 'Invalid barcode format or check digit.' : error.message.includes('unavailable') ? error.message : 'Barcode not found as a verified product for this business. Search by name or SKU, or add an unverified product to the business catalogue.';
      feedback.className = 'scan-feedback error';
      input.select();
      input.focus();
    }
  }

  async function searchProducts(query) {
    if (!query.trim()) { results.innerHTML = ''; selectedPanel.classList.add('hidden'); addSelected.classList.add('hidden'); selectedProduct = null; return; }
    try {
      const data = await api(`/api/products/search?q=${encodeURIComponent(query)}`);
      results.innerHTML = data.products.length ? data.products.map((product) => `<button class="search-result" type="button" data-product-id="${product.id}"><span class="product-initial">${escapeHtml(product.name.slice(0, 1).toUpperCase())}</span><span><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.sku || 'No SKU')} · ${escapeHtml(product.barcode || 'No barcode')} · stock ${product.quantity_on_hand}</small></span><strong>${money(product.price_cents, currency)}</strong></button>`).join('') : '<div class="search-no-results">No matching active products found.</div>';
      results.querySelectorAll('.search-result').forEach((button) => button.addEventListener('click', () => {
        const product = data.products.find((item) => item.id === Number(button.dataset.productId));
        if (product) showSelected(product);
      }));
    } catch (error) {
      feedback.textContent = error.message;
      feedback.className = 'scan-feedback error';
    }
  }

  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => searchProducts(input.value), 160);
  });
  input.addEventListener('keydown', async (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const value = input.value.trim();
    if (!value) return;
    if (/^\d+$/.test(value)) {
      clearTimeout(searchTimer);
      await lookupBarcode(value);
      return;
    }
    const firstResult = results.querySelector('.search-result');
    if (firstResult) firstResult.click();
    else await searchProducts(value);
  });
  addSelected.addEventListener('click', () => { if (selectedProduct) addToCart(selectedProduct); });

  document.getElementById('checkout-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const items = [...cart.values()].map((item) => ({ productId: item.id, quantity: item.quantity }));
    if (!items.length) return;
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    const submit = document.getElementById('complete-sale');
    submit.disabled = true;
    submit.textContent = 'Saving transaction…';
    try {
      await api('/api/sales', {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ paymentMethod: values.paymentMethod, customerId: values.customerId || null, items }),
      });
      currentView = 'sales';
      await renderView('sales');
      document.getElementById('scan-feedback').textContent = 'Transaction recorded; stock and dashboard source records updated.';
      document.getElementById('scan-feedback').className = 'scan-feedback success';
      document.getElementById('product-lookup').focus();
    } catch (error) {
      showInlineError(form, error.message);
      submit.disabled = false;
      submit.textContent = 'Record completed sale';
    }
  });
  content.querySelectorAll('.refund-button').forEach((button) => button.addEventListener('click', async () => {
    if (!confirm('Refund this completed sale and return its quantities to stock?')) return;
    button.disabled = true;
    try { await api(`/api/sales/${button.dataset.saleId}/refund`, { method: 'POST' }); await renderView('sales'); }
    catch (error) { alert(error.message); button.disabled = false; }
  }));
  input.focus();
}

async function renderSettings(content) {
  const settings = await api(`/api/businesses/${sessionInfo.business.id}/settings`);
  content.innerHTML = `<section class="page-heading"><div><span class="eyebrow">WORKSPACE</span><h1>Business settings</h1><p>Keep your business contact and operating details up to date.</p></div></section><section class="panel form-panel"><h2>${escapeHtml(sessionInfo.business.name)}</h2><form id="settings-form" class="record-form"><label>Operating hours<input name="operatingHours" value="${escapeHtml(settings.settings?.operating_hours || '')}" /></label><label>Contact email<input type="email" name="contactEmail" value="${escapeHtml(settings.settings?.contact_email || '')}" /></label><label>Phone<input name="phone" value="${escapeHtml(settings.settings?.phone || '')}" /></label><label>Address<textarea name="address">${escapeHtml(settings.settings?.address || '')}</textarea></label><button class="button button-primary" type="submit">Save settings</button></form><div class="inline-feedback" id="settings-feedback"></div></section>`;
  document.getElementById('settings-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const feedback = document.getElementById('settings-feedback');
    try {
      await api(`/api/businesses/${sessionInfo.business.id}/settings`, { method: 'PUT', body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget).entries())) });
      feedback.textContent = 'Settings saved.';
      feedback.className = 'inline-feedback success';
    } catch (error) { feedback.textContent = error.message; feedback.className = 'inline-feedback error'; }
  });
}

function showInlineError(form, message) {
  let feedback = form.querySelector('.inline-feedback');
  if (!feedback) {
    feedback = document.createElement('p');
    feedback.className = 'inline-feedback error';
    form.append(feedback);
  }
  feedback.textContent = message;
}

if (sessionToken) loadAuthenticatedApp();
else renderAuth();
