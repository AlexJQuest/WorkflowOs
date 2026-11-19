const app = document.getElementById('app');
const publicPagePaths = new Set([
  '/',
  '/about',
  '/features',
  '/solutions',
  '/pricing',
  '/contact',
  '/faq',
  '/privacy',
  '/terms',
]);
let sessionToken = localStorage.getItem('workflowos_session') || '';
let sessionInfo = null;
let dashboardData = null;
let currentPeriod = '7d';
let currentGranularity = 'daily';
let currentView = 'dashboard';
let customStartDate = '';
let customEndDate = '';
let expenseFilters = new URLSearchParams();
let invoiceFilters = new URLSearchParams();
let reportPeriod = 'month';
let reportStartDate = '';
let reportEndDate = '';
let reportType = 'sales';
let reportStatusFilter = '';
let reportEntityFilter = '';
let payablesFilters = new URLSearchParams();
let employeePage = 1;
let employeeSearch = '';
let employeeStatus = '';
let leaveEmployeeId = '';

const navItems = [
  { id: 'dashboard', label: 'Dashboard', icon: '▦' },
  { id: 'sales', label: 'Sales & Transactions', icon: '↗' },
  { id: 'customers', label: 'Customers', icon: '◎' },
  { id: 'invoices', label: 'Customer Invoices', icon: '▧' },
  { id: 'products', label: 'Products & Services', icon: '◇' },
  { id: 'inventory', label: 'Inventory & Stock', icon: '▤' },
  { id: 'payables', label: 'Supplier Invoices', icon: '−' },
  { id: 'documents', label: 'Financial Documents', icon: '▤' },
  { id: 'expenses', label: 'Expenses', icon: '−' },
  { id: 'employees', label: 'Employees', icon: '♙', ownerOnly: true },
  { id: 'attendance', label: 'Attendance', icon: '◷', ownerOnly: true },
  { id: 'leave', label: 'Leave Management', icon: '▣', ownerOnly: true },
  { id: 'payroll-rules', label: 'Payroll Rules', icon: '§', ownerOnly: true },
  { id: 'payroll', label: 'Payroll Runs', icon: '▧', ownerOnly: true },
  { id: 'reports', label: 'Reports', icon: '▥' },
  { id: 'settings', label: 'Business Settings', icon: '⚙' },
];
const navGroups = [
  { label: 'WORKSPACE', items: ['dashboard'] },
  { label: 'SALES & CUSTOMERS', items: ['sales', 'customers', 'invoices'] },
  { label: 'PRODUCTS & OPERATIONS', items: ['products', 'inventory', 'payables'] },
  { label: 'FINANCE & PEOPLE', items: ['expenses', 'employees', 'attendance', 'leave', 'payroll-rules', 'payroll', 'reports', 'documents'] },
  { label: 'ADMINISTRATION', items: ['settings'] },
];

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
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('The server returned an unexpected response. Restart WorkflowOS and refresh this page.');
  }
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'The request could not be completed.');
  return body;
}

async function authenticatedBlob(url) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${sessionToken}` },
  });
  if (response.status === 401) {
    clearSession();
    renderAuth('Your session expired. Please sign in again.');
    throw new Error('Your session expired. Please sign in again.');
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || 'The file could not be opened.');
  }
  return response.blob();
}

async function downloadAuthenticatedFile(url, filename) {
  const blob = await authenticatedBlob(url);
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

function clearSession() {
  localStorage.removeItem('workflowos_session');
  sessionToken = '';
  sessionInfo = null;
  dashboardData = null;
}

function goTo(path) {
  history.pushState({}, '', path);
  if (publicPagePaths.has(path)) window.renderPublicSite(path);
  else if (path === '/login' || path === '/signup') renderAuth('', path === '/signup' ? 'register' : 'login');
  else loadAuthenticatedApp();
}

window.addEventListener('popstate', () => {
  if (location.pathname === '/reset-password') renderResetPassword(new URLSearchParams(location.search).get('token') || '');
  else if (publicPagePaths.has(location.pathname)) window.renderPublicSite(location.pathname);
  else if (!sessionToken || location.pathname === '/login' || location.pathname === '/signup') {
    renderAuth('', location.pathname === '/signup' ? 'register' : 'login');
  }
  else loadAuthenticatedApp();
});

function renderAuth(message = '', initialTab = 'login') {
  app.innerHTML = `
    <main class="auth-layout">
      <section class="auth-story">
        <a class="brand brand-light" href="/" aria-label="WorkflowOS home"><span class="brand-mark">W</span><span>workflow<span class="brand-accent">OS</span></span></a>
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
          <p class="auth-legal">By continuing, you agree to our <a href="/terms">terms</a> and acknowledge our <a href="/privacy">privacy information</a>.</p>
        </div>
        <div class="auth-mobile-brand"><span class="brand-mark">W</span> workflow<span class="brand-accent">OS</span></div>
      </section>
    </main>`;

  const panel = document.getElementById('auth-panel');
  const loginTab = document.getElementById('show-login');
  const registerTab = document.getElementById('show-register');

  function showLogin() {
    document.title = 'Log in | WorkflowOS';
    loginTab.classList.add('active');
    registerTab.classList.remove('active');
    panel.innerHTML = `
      <span class="eyebrow">WELCOME BACK</span><h2>Sign in to your business</h2><p class="form-intro">Use your business admin account to continue.</p>
      <form id="login-form" class="form-stack">
        <label>Email address<input name="email" type="email" autocomplete="email" placeholder="you@business.co.za" required /></label>
        <label>Password<input name="password" type="password" autocomplete="current-password" placeholder="Enter your password" required /></label>
        <button class="button button-primary button-wide" type="submit">Sign in <span aria-hidden="true">→</span></button>
      </form>
      <p class="auth-forgot"><button class="text-link" id="forgot-password" type="button">Forgot password?</button></p>`;
    document.getElementById('login-form').addEventListener('submit', login);
    document.getElementById('forgot-password').addEventListener('click', showForgotPassword);
  }

  function showRegister() {
    document.title = 'Get started | WorkflowOS';
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
  if (initialTab === 'register') showRegister();
  else showLogin();
}


function showForgotPassword() {
  const panel = document.getElementById('auth-panel');
  if (!panel) return;
  panel.innerHTML = `
    <span class="eyebrow">ACCOUNT RECOVERY</span><h2>Reset your password</h2>
    <p class="form-intro">Enter your account email. If an account exists, we'll send a secure reset link.</p>
    <form id="forgot-password-form" class="form-stack">
      <label>Email address<input name="email" type="email" autocomplete="email" required /></label>
      <button class="button button-primary button-wide" type="submit">Send reset link →</button>
    </form>
    <p class="auth-forgot"><button class="text-link" id="back-to-login" type="button">← Back to sign in</button></p>`;
  document.getElementById('show-login')?.classList.add('active');
  document.getElementById('show-register')?.classList.remove('active');
  document.getElementById('forgot-password-form').addEventListener('submit', requestPasswordReset);
  document.getElementById('back-to-login').addEventListener('click', () => renderAuth());
  const message = document.getElementById('auth-message');
  if (message) { message.textContent = ''; message.className = 'message'; }
}

async function requestPasswordReset(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('button[type="submit"]');
  const message = document.getElementById('auth-message');
  submit.disabled = true;
  submit.textContent = 'Sending…';
  try {
    const response = await fetch('/api/password-reset/request', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: new FormData(form).get('email') }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Could not process your request.');
    if (message) { message.textContent = body.message || 'If an account exists for that email, a reset link has been sent.'; message.className = 'message success'; }
    form.reset(); submit.textContent = 'Send another link'; submit.disabled = false;
  } catch (error) {
    if (message) { message.textContent = error.message; message.className = 'message error'; }
    submit.disabled = false; submit.textContent = 'Send reset link →';
  }
}

function renderResetPassword(token) {
  app.innerHTML = `
    <main class="auth-layout">
      <section class="auth-story"><a class="brand brand-light" href="/"><span class="brand-mark">W</span><span>workflow<span class="brand-accent">OS</span></span></a>
        <div class="auth-story-copy"><span class="eyebrow">ACCOUNT SECURITY</span><h1>A fresh start, securely.</h1><p>Choose a new password to protect your WorkflowOS workspace.</p></div>
        <div class="story-note"><span class="story-dot"></span> Your business data stays yours.</div>
      </section>
      <section class="auth-main"><div class="auth-card"><span class="eyebrow">NEW PASSWORD</span><h2>Choose a new password</h2>
        <p class="form-intro">Use at least 10 characters. Your reset link can only be used once.</p>
        <form id="reset-password-form" class="form-stack">
          <label>New password<input name="password" type="password" autocomplete="new-password" minlength="10" required /></label>
          <label>Confirm new password<input name="confirmPassword" type="password" autocomplete="new-password" minlength="10" required /></label>
          <button class="button button-primary button-wide" type="submit">Update password →</button>
        </form><p class="message" id="reset-message"></p><p class="auth-forgot"><a class="inline-link" href="/login">Back to sign in</a></p>
      </div><div class="auth-mobile-brand"><span class="brand-mark">W</span> workflow<span class="brand-accent">OS</span></div></section>
    </main>`;
  document.getElementById('reset-password-form').addEventListener('submit', (event) => submitNewPassword(event, token));
}

async function submitNewPassword(event, token) {
  event.preventDefault();
  const form = event.currentTarget, message = document.getElementById('reset-message');
  const submit = form.querySelector('button[type="submit"]');
  const values = Object.fromEntries(new FormData(form).entries());
  if (values.password !== values.confirmPassword) { message.textContent = 'The passwords do not match.'; message.className = 'message error'; return; }
  submit.disabled = true; submit.textContent = 'Updating…';
  try {
    const response = await fetch('/api/password-reset/confirm', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password: values.password }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Unable to reset password.');
    message.textContent = 'Your password has been updated. You can now sign in.';
    message.className = 'message success'; form.reset(); submit.textContent = 'Password updated';
  } catch (error) {
    message.textContent = error.message; message.className = 'message error';
    submit.disabled = false; submit.textContent = 'Update password →';
  }
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
    history.replaceState({}, '', '/dashboard');
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
    history.replaceState({}, '', '/dashboard');
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
    history.replaceState({}, '', '/login');
    renderAuth();
    return;
  }
  try {
    sessionInfo = await api('/api/session');
    if (!sessionInfo.business) throw new Error('No business is assigned to this account.');
    if (location.pathname !== '/dashboard' && location.pathname !== '/') history.replaceState({}, '', '/dashboard');
    if (location.pathname === '/') history.replaceState({}, '', '/dashboard');
    const accessibleViews = navItems
      .filter((item) => !item.ownerOnly || sessionInfo.business.isOwner)
      .map((item) => item.id);
    if (!accessibleViews.includes(currentView)) currentView = 'dashboard';
    renderShell();
    await renderView(currentView);
  } catch (error) {
    if (sessionToken) {
      clearSession();
      history.replaceState({}, '', '/login');
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
        <a class="brand" href="/dashboard"><span class="brand-mark">W</span><span>workflow<span class="brand-accent">OS</span></span></a>
        <div class="business-switcher"><span class="business-avatar">${escapeHtml((business.name || 'B').slice(0, 1).toUpperCase())}</span><span class="business-meta"><strong>${escapeHtml(business.name)}</strong><small>${escapeHtml(business.businessType || 'Business workspace')}</small></span><span class="switch-chevron">⌄</span></div>
        <nav class="side-nav" aria-label="Main navigation">${navGroups.map((group) => {
          const items = group.items
            .map((id) => navItems.find((item) => item.id === id))
            .filter((item) => item && (!item.ownerOnly || business.isOwner));
          if (!items.length) return '';
          return `<section class="nav-group"><p class="nav-caption">${group.label}</p>${items.map((item) =>
            `<button class="nav-item ${item.id === currentView ? 'selected' : ''}" data-view="${item.id}" type="button" ${item.id === currentView ? 'aria-current="page"' : ''}><span class="nav-icon" aria-hidden="true">${item.icon}</span><span>${item.label}</span></button>`
          ).join('')}</section>`;
        }).join('')}</nav>
        <div class="sidebar-bottom"><div class="sidebar-help"><span class="help-icon">?</span><span><strong>Need a hand?</strong><small>Help & support</small></span><span>↗</span></div><div class="sidebar-version">WORKFLOWOS · LOCAL PREVIEW</div></div>
      </aside>
      <button class="sidebar-backdrop hidden" id="sidebar-backdrop" type="button" aria-label="Close navigation"></button>
      <main class="main-area">
        <header class="topbar"><button class="icon-button menu-button" id="menu-toggle" aria-label="Toggle navigation" aria-expanded="false">☰</button><div class="breadcrumbs"><span>Workspace</span><span class="breadcrumb-slash">/</span><strong id="topbar-title">Dashboard</strong></div><div class="topbar-actions"><button class="icon-button" id="refresh-button" aria-label="Refresh data" title="Refresh">↻</button><div class="profile"><span class="profile-avatar">${escapeHtml(initials)}</span><span class="profile-copy"><strong>${escapeHtml(user.firstName ? `${user.firstName} ${user.lastName || ''}` : user.email || 'Business admin')}</strong><small>${business.isOwner ? 'Workspace owner' : 'Team member'}</small></span><button class="profile-menu" id="profile-menu" aria-label="Account menu">⌄</button><div class="profile-dropdown hidden" id="profile-dropdown"><span>${escapeHtml(user.email || '')}</span><button id="logout-button" type="button">Sign out</button></div></div></div></header>
        <div class="page-content" id="page-content"><div class="loading-panel"><span class="spinner"></span>Loading your workspace…</div></div>
      </main>
    </div>`;

  app.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => {
    currentView = button.dataset.view;
    renderShell();
    renderView(currentView);
  }));
  document.getElementById('menu-toggle').addEventListener('click', (event) => {
    const isOpen = document.getElementById('sidebar').classList.toggle('sidebar-open');
    document.getElementById('sidebar-backdrop').classList.toggle('hidden', !isOpen);
    event.currentTarget.setAttribute('aria-expanded', String(isOpen));
  });
  document.getElementById('sidebar-backdrop').addEventListener('click', () => {
    document.getElementById('sidebar').classList.remove('sidebar-open');
    document.getElementById('sidebar-backdrop').classList.add('hidden');
    document.getElementById('menu-toggle').setAttribute('aria-expanded', 'false');
    document.getElementById('menu-toggle').focus();
  });
  document.onkeydown = (event) => {
    if (event.key !== 'Escape') return;
    const sidebar = document.getElementById('sidebar');
    if (!sidebar?.classList.contains('sidebar-open')) return;
    sidebar.classList.remove('sidebar-open');
    document.getElementById('sidebar-backdrop').classList.add('hidden');
    document.getElementById('menu-toggle').setAttribute('aria-expanded', 'false');
    document.getElementById('menu-toggle').focus();
  };
  document.getElementById('profile-menu').addEventListener('click', () => document.getElementById('profile-dropdown').classList.toggle('hidden'));
  document.getElementById('logout-button').addEventListener('click', async () => {
    try { await api('/api/logout', { method: 'POST' }); } catch { /* clear local session even if offline */ }
    clearSession();
    history.replaceState({}, '', '/login');
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
    if (view === 'invoices') return await renderInvoices(content);
    if (view === 'payables') return await renderPayables(content);
    if (view === 'documents') return await renderFinancialDocuments(content);
    if (view === 'inventory') return await renderInventory(content);
    if (view === 'sales') return await renderSales(content);
    if (view === 'expenses') return await renderExpenses(content);
    if (view === 'reports') return await renderReports(content);
    if (view === 'employees') return await renderEmployees(content);
    if (view === 'attendance') return await renderAttendance(content);
    if (view === 'leave') return await renderLeave(content);
    if (view === 'payroll-rules') return await renderPayrollRules(content);
    if (view === 'payroll') return await renderPayrollRuns(content);
    if (view === 'settings') return await renderSettings(content);
    content.innerHTML = '<div class="empty-state"><h2>Module not available</h2><p>This area is not included in the current local prototype.</p></div>';
  } catch (error) {
    content.innerHTML = `<div class="error-panel"><strong>We couldn’t load this view.</strong><p>${escapeHtml(error.message)}</p><button class="button button-secondary" id="retry-view">Try again</button></div>`;
    content.querySelector('#retry-view')?.addEventListener('click', () => renderView(view));
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
  if (!data.summary?.expenses || !data.summary?.financial) {
    throw new Error('The server is out of date. Restart WorkflowOS and refresh this page.');
  }
  const summary = data.summary;
  const today = summary.today;
  const financial = summary.financial;
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
      ${kpiCard('⌁', 'Gross profit', money(today.grossProfitCents, currency), today.grossProfitComplete ? `${today.grossProfitMarginPct ?? 0}% margin` : 'Estimate — missing sale-time costs treated as zero', today.grossProfitComplete ? '' : '<span class="metric-change neutral">Cost data incomplete</span>', 'icon-amber')}
      ${kpiCard('◎', 'Customers', String(summary.customers.total), `+${summary.customers.newToday} new · ${summary.customers.returningToday} returning today`, '', 'icon-teal')}
      ${kpiCard('!', 'Stock attention', String(summary.inventory.lowStockCount + summary.inventory.outOfStockCount), `${summary.inventory.lowStockCount} low · ${summary.inventory.outOfStockCount} out of stock`, '<button class="text-link" data-view="inventory">View stock →</button>', 'icon-red')}
    </section>
    <section class="kpi-grid report-kpis" aria-label="Accounts receivable and payable">
      ${kpiCard('▤', 'Customer invoices outstanding', money(financial.receivables.outstandingCents, currency), `${money(financial.receivables.overdueCents, currency)} overdue · ${financial.receivables.overdueCount} invoices`, '<button class="text-link" data-view="invoices">Review receivables →</button>', 'icon-blue')}
      ${kpiCard('↗', 'Customer payments this month', money(financial.receivables.paymentsThisMonthCents, currency), `${money(financial.receivables.paymentsTodayCents, currency)} received today`, '', 'icon-green')}
      ${kpiCard('−', 'Supplier invoices outstanding', money(financial.payables.outstandingCents, currency), `${money(financial.payables.overdueCents, currency)} overdue · ${financial.payables.overdueCount} invoices`, '<button class="text-link" data-view="expenses">Review payables →</button>', 'icon-red')}
      ${kpiCard('⌁', 'Supplier payments this month', money(financial.payables.paymentsThisMonthCents, currency), `${financial.payables.dueWithinWeek} invoices due within 7 days`, '', 'icon-amber')}
      ${financial.payroll ? `${kpiCard('≋', 'Finalised net pay this month', money(financial.payroll.finalisedNetPayThisMonthCents, currency), 'Estimate based on finalised payroll runs', '<button class="text-link" data-view="payroll">Review payroll →</button>', 'icon-violet')}
      ${kpiCard('−', 'Payroll payments outstanding', money(financial.payroll.outstandingCents, currency), `${money(financial.payroll.paymentsThisMonthCents, currency)} manually recorded this month`, 'Transfers are made outside WorkflowOS', 'icon-amber')}` : ''}
    </section>
    <section class="panel report-panel"><div class="panel-heading"><div><h2>Financial action centre</h2><p>Items requiring follow-up across invoices, payroll and stock receipts</p></div><button class="text-link" data-view="reports">Open financial reports →</button></div>
      ${financial.actionItems.length ? `<div class="best-list">${financial.actionItems.map((item) => `<div class="best-row"><span class="product-initial">${item.type === 'customer_invoice_overdue' ? '!' : item.type === 'supplier_invoice_due' ? '−' : item.type === 'payroll_payment_outstanding' ? '≋' : '▤'}</span><span class="best-product"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.detail)}${item.amountCents === undefined ? '' : ` · ${money(item.amountCents, currency)}`}</small></span><button class="text-link" data-view="${escapeHtml(item.view)}">Review →</button></div>`).join('')}</div>` : '<div class="mini-empty">No outstanding invoice, payroll or stock-receipt follow-ups.</div>'}
    </section>
    <section class="dashboard-grid primary-grid">
      <article class="panel chart-panel"><div class="panel-heading"><div><h2>Revenue performance</h2><p>Completed sales · ${escapeHtml(currency)}</p></div><div class="chart-controls"><select id="period-select" aria-label="Reporting period">${periodOptions.map(([value, label]) => `<option value="${value}" ${currentPeriod === value ? 'selected' : ''}>${label}</option>`).join('')}</select><select id="granularity-select" aria-label="Chart interval"><option value="daily" ${currentGranularity === 'daily' ? 'selected' : ''}>Daily</option><option value="weekly" ${currentGranularity === 'weekly' ? 'selected' : ''}>Weekly</option><option value="monthly" ${currentGranularity === 'monthly' ? 'selected' : ''}>Monthly</option></select></div></div>
      ${currentPeriod === 'custom' ? `<form class="custom-range" id="custom-range"><label>From<input type="date" name="startDate" value="${escapeHtml(customStartDate)}" required /></label><label>To<input type="date" name="endDate" value="${escapeHtml(customEndDate)}" required /></label><button class="button button-secondary" type="submit">Apply dates</button></form>` : ''}
      ${data.trends.some((point) => point.revenueCents > 0) ? `<div class="chart-total">${money(data.periodComparison.revenueCents, currency)}<span>in selected period</span>${changeMetric(data.periodComparison.changePct, 'vs previous period')}</div><div class="revenue-chart" role="img" aria-label="Revenue chart">${data.trends.map((point) => `<div class="chart-column"><div class="chart-bar-wrap"><div class="chart-bar ${point.revenueCents ? '' : 'zero'}" style="height:${Math.max(point.revenueCents ? 6 : 0, (point.revenueCents / maxRevenue) * 100)}%" title="${escapeHtml(point.date)}: ${money(point.revenueCents, currency)}"></div></div><span class="chart-value">${point.revenueCents ? money(point.revenueCents, currency) : '—'}</span><span class="chart-label">${escapeHtml(point.date.slice(5))}</span></div>`).join('')}</div>` : '<div class="chart-empty"><span class="empty-chart-icon">⌁</span><strong>No completed sales in this period</strong><span>Record a sale to see revenue trends here.</span></div>'}</article>
      <article class="panel best-panel"><div class="panel-heading"><div><h2>Best-selling products</h2><p>Ranked by units sold</p></div><span class="period-chip">${periodOptions.find(([value]) => value === currentPeriod)?.[1] || 'Custom range'}</span></div>
        ${data.bestSellers.length ? `<div class="best-list">${data.bestSellers.map((product, index) => `<div class="best-row"><span class="rank-badge ${index === 0 ? 'rank-first' : ''}">${String(index + 1).padStart(2, '0')}</span><span class="product-initial">${escapeHtml(product.name.slice(0, 1).toUpperCase())}</span><span class="best-product"><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.category || 'Uncategorised')} · ${money(product.revenueCents, currency)} · ${money(product.grossProfitCents, currency)} ${product.grossProfitComplete ? 'profit' : 'estimated profit (missing costs treated as zero)'}</small></span><span class="best-units"><strong>${product.quantitySold}</strong><small>sold</small></span></div>`).join('')}</div>` : '<div class="mini-empty">No product sales in this period yet.</div>'}
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
        <div class="insight-row"><span class="insight-icon insight-amber">−</span><span><strong>Expenses this month</strong><small>${money(summary.expenses.monthToDateCents, currency)} recorded · ${money(summary.expenses.outstandingCents, currency)} outstanding · ${summary.expenses.overdueCount} overdue · <button class="inline-link" data-view="expenses">Review expenses</button></small></span></div>
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

let expensePage = 1;

function centsFromInput(value) {
  if (value === '') return 0;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return null;
  const cents = Math.round(amount * 100);
  return Number.isSafeInteger(cents) && Math.abs(amount * 100 - cents) < 0.000001
    ? cents
    : null;
}

function taxRateBpsFromInput(value) {
  const match = /^(0|[1-9]\d{0,2})(?:\.(\d{1,2}))?$/.exec(String(value ?? ''));
  if (!match) return null;
  const rate = Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0'));
  return Number.isSafeInteger(rate) && rate <= 10000 ? rate : null;
}

function dateInputValue(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value || '').slice(0, 10);
}

async function renderInvoices(content) {
  const invoiceQuery = new URLSearchParams(invoiceFilters);
  invoiceQuery.set('page', '1');
  invoiceQuery.set('pageSize', '50');
  const [list, customersResponse, productsResponse, settingsResponse] = await Promise.all([
    api(`/api/invoices?${invoiceQuery}`),
    api('/api/customers'),
    api('/api/products'),
    api('/api/invoices/settings'),
  ]);
  const customers = customersResponse.customers || [];
  const products = (productsResponse.products || []).filter((product) => Number(product.is_active));
  const currency = sessionInfo.business.currency;
  const today = new Date().toISOString().slice(0, 10);
  let editingInvoiceId = null;

  function lineEditor(line = {}) {
    const type = line.item_type || line.itemType || 'custom';
    const selectedProductId = Number(line.product_id || line.productId || 0);
    const productOptions = products.map((product) =>
      `<option value="${product.id}" ${selectedProductId === Number(product.id) ? 'selected' : ''}>${escapeHtml(product.name)}</option>`
    ).join('');
    const quantity = line.quantity_millis
      ? (Number(line.quantity_millis) / 1000).toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
      : (line.quantity || '1');
    const price = line.unit_price_cents !== undefined
      ? (Number(line.unit_price_cents) / 100).toFixed(2)
      : (line.unitPrice || '');
    const discount = line.discount_cents !== undefined
      ? (Number(line.discount_cents) / 100).toFixed(2)
      : (line.discount || '');
    const taxRate = line.tax_rate_bps !== undefined
      ? (Number(line.tax_rate_bps) / 100).toFixed(2)
      : (line.taxRate || '0');
    return `<fieldset class="invoice-line-editor">
      <legend>Invoice item</legend>
      <label>Existing product or service<select class="invoice-line-product"><option value="">Custom item</option>${productOptions}</select></label>
      <label>Type<select class="invoice-line-type"><option value="custom" ${type === 'custom' ? 'selected' : ''}>Custom</option><option value="product" ${type === 'product' ? 'selected' : ''}>Product</option><option value="service" ${type === 'service' ? 'selected' : ''}>Service</option></select></label>
      <label>Description<input class="invoice-line-name" maxlength="191" value="${escapeHtml(line.item_name || line.name || '')}" required /></label>
      <label>Quantity<input class="invoice-line-quantity" type="number" min="0.001" step="0.001" value="${escapeHtml(quantity)}" required /></label>
      <label>Unit price (${escapeHtml(currency)})<input class="invoice-line-price" type="number" min="0" step="0.01" value="${escapeHtml(price)}" required /></label>
      <label>Discount (${escapeHtml(currency)})<input class="invoice-line-discount" type="number" min="0" step="0.01" value="${escapeHtml(discount)}" /></label>
      <label>Tax rate (%)<input class="invoice-line-tax" type="number" min="0" max="100" step="0.01" value="${escapeHtml(taxRate)}" /></label>
      <label class="invoice-tax-inclusive"><input class="invoice-line-inclusive" type="checkbox" ${Number(line.tax_inclusive) === 1 || line.taxInclusive ? 'checked' : ''} /> Price includes tax</label>
      <button class="button button-secondary invoice-line-remove" type="button">Remove item</button>
    </fieldset>`;
  }

  content.innerHTML = `
    <section class="page-heading"><div><span class="eyebrow">FINANCE</span><h1>Invoices</h1><p>Create customer invoices, issue numbered records, and track payments separately from POS sales.</p></div></section>
    <section class="panel invoice-create-panel">
      <div class="panel-heading"><div><h2 id="invoice-form-title">Create draft invoice</h2><p>Totals and tax are recalculated by the server; issuing an invoice locks its financial details.</p></div></div>
      <form id="invoice-form" class="invoice-form">
        <div class="invoice-header-fields">
          <label>Customer<select name="customerId" required><option value="">Choose a customer</option>${customers.map((customer) => `<option value="${customer.id}">${escapeHtml(customer.name)}${customer.email ? ` · ${escapeHtml(customer.email)}` : ''}</option>`).join('')}</select></label>
          <label>Invoice date<input name="invoiceDate" type="date" value="${today}" required /></label>
          <label>Due date<input name="dueDate" type="date" value="${today}" required /></label>
          <label>Reference (optional)<input name="referenceNumber" maxlength="100" /></label>
          <label class="invoice-address-field">Billing address (optional)<textarea name="customerBillingAddress" maxlength="2000"></textarea></label>
          <label>Payment terms<input name="paymentTerms" maxlength="500" placeholder="e.g. Due within 14 days" /></label>
          <label class="invoice-address-field">Notes<textarea name="notes" maxlength="4000"></textarea></label>
          <label class="invoice-address-field">Terms and conditions<textarea name="termsAndConditions" maxlength="4000"></textarea></label>
        </div>
        <div id="invoice-lines">${lineEditor()}</div>
        <div class="invoice-form-actions"><button class="button button-secondary" id="invoice-add-line" type="button">Add line item</button><button class="button button-primary" id="invoice-save" type="submit">Save draft</button><button class="button button-secondary hidden" id="invoice-edit-cancel" type="button">Stop editing</button></div>
        <p class="inline-feedback" id="invoice-form-feedback" aria-live="polite"></p>
      </form>
    </section>
    <section class="panel list-panel invoice-list-panel">
      <div class="panel-heading"><div><h2>Customer invoices</h2><p>${list.total} record${list.total === 1 ? '' : 's'} · invoice revenue is distinct from cash collected at point of sale</p></div></div>
      <form id="invoice-filters" class="expense-filters">
        <label>Search<input name="search" value="${escapeHtml(invoiceFilters.get('search') || '')}" placeholder="Number, customer, or reference" /></label>
        <label>Status<select name="status"><option value="">All statuses</option><option value="draft" ${invoiceFilters.get('status') === 'draft' ? 'selected' : ''}>Draft</option><option value="issued" ${invoiceFilters.get('status') === 'issued' ? 'selected' : ''}>Issued</option><option value="sent" ${invoiceFilters.get('status') === 'sent' ? 'selected' : ''}>Sent</option><option value="partially_paid" ${invoiceFilters.get('status') === 'partially_paid' ? 'selected' : ''}>Partially paid</option><option value="paid" ${invoiceFilters.get('status') === 'paid' ? 'selected' : ''}>Paid</option><option value="overdue" ${invoiceFilters.get('status') === 'overdue' ? 'selected' : ''}>Overdue</option><option value="cancelled" ${invoiceFilters.get('status') === 'cancelled' ? 'selected' : ''}>Cancelled</option></select></label>
        <button class="button button-secondary" type="submit">Apply filters</button>
        <button class="button button-secondary" id="invoice-clear-filters" type="button">Clear</button>
      </form>
      ${list.invoices.length ? `<div class="table-scroll"><table><thead><tr><th>Invoice</th><th>Customer</th><th>Date / due</th><th>Total</th><th>Paid</th><th>Balance</th><th>Status</th><th>Actions</th></tr></thead><tbody>${list.invoices.map((invoice) => `<tr><td><strong>${escapeHtml(invoice.invoice_number || 'Draft')}</strong><small>${escapeHtml(invoice.reference_number || '')}</small></td><td>${escapeHtml(invoice.customer_name)}</td><td>${escapeHtml(dateInputValue(invoice.invoice_date))}<small>Due ${escapeHtml(dateInputValue(invoice.due_date))}</small></td><td>${money(invoice.total_cents, currency)}</td><td>${money(invoice.paid_cents, currency)}</td><td>${money(invoice.outstanding_cents, currency)}</td><td><span class="status-pill status-${escapeHtml(invoice.display_status)}">${escapeHtml(invoice.display_status.replace('_', ' '))}</span></td><td><div class="invoice-row-actions"><button class="text-link invoice-view" data-id="${invoice.id}" type="button">Details</button><button class="text-link invoice-pdf" data-id="${invoice.id}" type="button">Download PDF</button>${['issued', 'sent', 'partially_paid', 'overdue'].includes(invoice.display_status) ? `<button class="text-link invoice-email" data-id="${invoice.id}" type="button">Email</button>` : ''}${invoice.status === 'draft' ? `<button class="text-link invoice-edit" data-id="${invoice.id}" type="button">Edit draft</button><button class="text-link invoice-issue" data-id="${invoice.id}" type="button">Issue</button>` : ''}${['issued', 'sent', 'partially_paid', 'overdue'].includes(invoice.display_status) ? `<button class="text-link invoice-pay" data-id="${invoice.id}" type="button">Record payment</button>` : ''}${['issued', 'sent'].includes(invoice.status) && Number(invoice.paid_cents) === 0 ? `<button class="text-link invoice-cancel" data-id="${invoice.id}" type="button">Cancel</button>` : ''}</div></td></tr>`).join('')}</tbody></table></div>` : '<div class="table-empty"><strong>No invoices found</strong><span>Choose an existing customer above to create a draft invoice. Drafts are not counted as completed POS sales.</span></div>'}
    </section>
    <section class="panel invoice-settings-panel"><h2>Invoice settings</h2><form id="invoice-settings-form" class="record-form invoice-settings-form">
      <label>Invoice number prefix<input name="numberPrefix" value="${escapeHtml(settingsResponse.settings.numberPrefix)}" maxlength="20" pattern="[A-Za-z0-9][A-Za-z0-9-]*" required /></label>
      <label>Bank account name<input name="bankAccountName" value="${escapeHtml(settingsResponse.settings.bankAccountName)}" maxlength="191" /></label>
      <label>Bank name<input name="bankName" value="${escapeHtml(settingsResponse.settings.bankName)}" maxlength="191" /></label>
      <label>Account number<input name="bankAccountNumber" value="${escapeHtml(settingsResponse.settings.bankAccountNumber)}" maxlength="100" /></label>
      <label>Branch code<input name="bankBranchCode" value="${escapeHtml(settingsResponse.settings.bankBranchCode)}" maxlength="40" /></label>
      <label>Account type<input name="bankAccountType" value="${escapeHtml(settingsResponse.settings.bankAccountType)}" maxlength="80" /></label>
      <label>Payment instructions<textarea name="paymentInstructions" maxlength="1000">${escapeHtml(settingsResponse.settings.paymentInstructions)}</textarea></label>
      <input type="hidden" name="logoDocumentId" value="${escapeHtml(settingsResponse.settings.logoDocumentId || '')}" />
      <button class="button button-secondary" type="submit">Save invoice settings</button><span class="inline-feedback" id="invoice-settings-feedback" aria-live="polite"></span>
    </form><form id="invoice-logo-form" class="compact-form"><label>Business logo (JPEG or PNG)<input type="file" name="logo" accept="image/jpeg,image/png" /></label><button class="button button-secondary" type="submit">Upload logo</button></form></section>
    <dialog class="expense-dialog" id="invoice-details-dialog"></dialog>
    <dialog class="expense-dialog" id="invoice-payment-dialog"></dialog>`;

  const invoiceForm = document.getElementById('invoice-form');
  const invoiceLines = document.getElementById('invoice-lines');
  const invoiceDialog = document.getElementById('invoice-details-dialog');
  document.getElementById('invoice-add-line').addEventListener('click', () => {
    invoiceLines.insertAdjacentHTML('beforeend', lineEditor());
  });
  invoiceLines.addEventListener('click', (event) => {
    if (!event.target.classList.contains('invoice-line-remove')) return;
    const rows = invoiceLines.querySelectorAll('.invoice-line-editor');
    if (rows.length === 1) {
      showInlineError(invoiceForm, 'An invoice must contain at least one line item.');
      return;
    }
    event.target.closest('.invoice-line-editor').remove();
  });
  invoiceLines.addEventListener('change', (event) => {
    const row = event.target.closest('.invoice-line-editor');
    if (event.target.classList.contains('invoice-line-type') && event.target.value === 'custom') {
      row.querySelector('.invoice-line-product').value = '';
      return;
    }
    if (event.target.classList.contains('invoice-line-product')) {
      const product = products.find((item) => Number(item.id) === Number(event.target.value));
      if (!product) {
        row.querySelector('.invoice-line-type').value = 'custom';
        return;
      }
      row.querySelector('.invoice-line-type').value = 'product';
      row.querySelector('.invoice-line-name').value = product.name;
      row.querySelector('.invoice-line-price').value = (Number(product.price_cents) / 100).toFixed(2);
    }
  });
  document.getElementById('invoice-edit-cancel').addEventListener('click', () => renderInvoices(content));

  invoiceForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    const items = [];
    for (const row of invoiceLines.querySelectorAll('.invoice-line-editor')) {
      const unitPriceCents = centsFromInput(row.querySelector('.invoice-line-price').value);
      const discountCents = centsFromInput(row.querySelector('.invoice-line-discount').value);
      const taxRateBps = taxRateBpsFromInput(row.querySelector('.invoice-line-tax').value || '0');
      if (unitPriceCents === null || discountCents === null || taxRateBps === null) {
        showInlineError(form, 'Enter valid prices and a tax rate from 0% to 100%, using at most two decimal places.');
        return;
      }
      items.push({
        productId: row.querySelector('.invoice-line-product').value || null,
        itemType: row.querySelector('.invoice-line-type').value,
        name: row.querySelector('.invoice-line-name').value,
        quantity: row.querySelector('.invoice-line-quantity').value,
        unitPriceCents,
        discountCents,
        taxRateBps,
        taxInclusive: row.querySelector('.invoice-line-inclusive').checked,
      });
    }
    const submit = document.getElementById('invoice-save');
    submit.disabled = true;
    try {
      const endpoint = editingInvoiceId ? `/api/invoices/${editingInvoiceId}` : '/api/invoices';
      await api(endpoint, {
        method: editingInvoiceId ? 'PUT' : 'POST',
        body: JSON.stringify({
          customerId: values.customerId,
          invoiceDate: values.invoiceDate,
          dueDate: values.dueDate,
          referenceNumber: values.referenceNumber,
          customerBillingAddress: values.customerBillingAddress,
          paymentTerms: values.paymentTerms,
          notes: values.notes,
          termsAndConditions: values.termsAndConditions,
          items,
        }),
      });
      await renderInvoices(content);
    } catch (error) {
      showInlineError(form, error.message);
      submit.disabled = false;
    }
  });

  document.getElementById('invoice-filters').addEventListener('submit', async (event) => {
    event.preventDefault();
    invoiceFilters = new URLSearchParams();
    for (const [key, value] of new FormData(event.currentTarget).entries()) {
      if (value) invoiceFilters.set(key, value);
    }
    try {
      await renderInvoices(content);
    } catch (error) {
      showInlineError(event.currentTarget, error.message);
    }
  });
  document.getElementById('invoice-clear-filters').addEventListener('click', () => {
    invoiceFilters = new URLSearchParams();
    renderInvoices(content).catch((error) => alert(error.message));
  });
  document.getElementById('invoice-settings-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const feedback = document.getElementById('invoice-settings-feedback');
    try {
      const values = Object.fromEntries(new FormData(event.currentTarget).entries());
      const result = await api('/api/invoices/settings', {
        method: 'PUT',
        body: JSON.stringify(values),
      });
      feedback.textContent = `Invoice settings saved. New invoices will use ${result.settings.numberPrefix}.`;
      feedback.className = 'inline-feedback success';
    } catch (error) {
      feedback.textContent = error.message;
      feedback.className = 'inline-feedback error';
    }
  });
  document.getElementById('invoice-logo-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const file = form.elements.logo.files[0];
    if (!file) return showInlineError(form, 'Choose a JPEG or PNG logo first.');
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const uploaded = await api('/api/business/invoice-logo', {
        method: 'POST',
        headers: { 'Content-Type': file.type, 'X-File-Name': encodeURIComponent(file.name) },
        body: file,
      });
      form.reset();
      await api('/api/invoices/settings', {
        method: 'PUT',
        body: JSON.stringify({
          numberPrefix: document.querySelector('#invoice-settings-form [name="numberPrefix"]').value,
          logoDocumentId: uploaded.document.id,
        }),
      });
      await renderInvoices(content);
    } catch (error) {
      showInlineError(form, error.message);
      button.disabled = false;
    }
  });

  async function editInvoice(invoiceId) {
    try {
      const invoice = (await api(`/api/invoices/${invoiceId}`)).invoice;
      editingInvoiceId = invoice.id;
      invoiceForm.elements.customerId.value = String(invoice.customer_id);
      invoiceForm.elements.invoiceDate.value = dateInputValue(invoice.invoice_date);
      invoiceForm.elements.dueDate.value = dateInputValue(invoice.due_date);
      invoiceForm.elements.referenceNumber.value = invoice.reference_number || '';
      invoiceForm.elements.customerBillingAddress.value = invoice.customer_billing_address || '';
      invoiceForm.elements.paymentTerms.value = invoice.payment_terms || '';
      invoiceForm.elements.notes.value = invoice.notes || '';
      invoiceForm.elements.termsAndConditions.value = invoice.terms_and_conditions || '';
      invoiceLines.innerHTML = invoice.items.map((item) => lineEditor(item)).join('');
      document.getElementById('invoice-form-title').textContent = `Edit draft ${invoice.id}`;
      document.getElementById('invoice-save').textContent = 'Save draft changes';
      document.getElementById('invoice-edit-cancel').classList.remove('hidden');
      invoiceForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      alert(error.message);
    }
  }

  async function showInvoice(invoiceId) {
    try {
      const invoice = (await api(`/api/invoices/${invoiceId}`)).invoice;
      invoiceDialog.innerHTML = `<form method="dialog" class="dialog-close"><button class="icon-button" aria-label="Close">×</button></form><h2>${escapeHtml(invoice.invoice_number || `Draft ${invoice.id}`)}</h2><p>${escapeHtml(invoice.customer_name)} · ${escapeHtml(invoice.status.replace('_', ' '))}</p><dl><div><dt>Invoice date</dt><dd>${escapeHtml(dateInputValue(invoice.invoice_date))}</dd></div><div><dt>Due date</dt><dd>${escapeHtml(dateInputValue(invoice.due_date))}</dd></div><div><dt>Billing address</dt><dd>${escapeHtml(invoice.customer_billing_address || '—')}</dd></div><div><dt>Subtotal / discount / tax</dt><dd>${money(invoice.subtotal_cents, currency)} / ${money(invoice.discount_cents, currency)} / ${money(invoice.tax_cents, currency)}</dd></div><div><dt>Total / paid / balance</dt><dd>${money(invoice.total_cents, currency)} / ${money(invoice.paid_cents, currency)} / ${money(invoice.outstanding_cents, currency)}</dd></div></dl><h3>Items</h3><div class="table-scroll"><table><thead><tr><th>Description</th><th>Qty</th><th>Unit price</th><th>Discount</th><th>Tax</th><th>Total</th></tr></thead><tbody>${invoice.items.map((item) => `<tr><td>${escapeHtml(item.item_name)}<small>${escapeHtml(item.description || '')}</small></td><td>${Number(item.quantity_millis) / 1000}</td><td>${money(item.unit_price_cents, currency)}</td><td>${money(item.discount_cents, currency)}</td><td>${money(item.tax_cents, currency)}</td><td>${money(item.total_cents, currency)}</td></tr>`).join('')}</tbody></table></div><h3>Payment history</h3>${invoice.payments.length ? `<div class="table-scroll"><table><thead><tr><th>Date</th><th>Method</th><th>Reference</th><th>Amount</th><th>Receipt</th></tr></thead><tbody>${invoice.payments.map((payment) => `<tr><td>${escapeHtml(dateInputValue(payment.payment_date))}</td><td>${escapeHtml(payment.payment_method)}</td><td>${escapeHtml(payment.reference || '—')}</td><td>${money(payment.amount_cents, currency)}</td><td><button class="text-link receipt-download" data-id="${payment.id}" type="button">PDF</button> <button class="text-link receipt-email" data-id="${payment.id}" type="button">Email</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted-copy">No payments recorded.</p>'}<h3>Credit notes</h3>${invoice.creditNotes?.length ? `<div class="table-scroll"><table><thead><tr><th>Credit</th><th>Date</th><th>Reason</th><th>Amount</th><th>PDF</th></tr></thead><tbody>${invoice.creditNotes.map((credit) => `<tr><td>${escapeHtml(credit.credit_number)}</td><td>${escapeHtml(dateInputValue(credit.credit_date))}</td><td>${escapeHtml(credit.reason)}</td><td>${money(credit.total_cents, currency)}</td><td><button class="text-link credit-pdf" data-id="${credit.id}" type="button">PDF</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted-copy">No credit notes recorded.</p>'}${invoice.outstanding_cents > 0 && ['issued', 'sent', 'partially_paid', 'overdue'].includes(invoice.status) ? `<form id="invoice-credit-form" class="record-form"><h3>Issue a credit note</h3><label>Invoice item<select name="invoiceItemId" required>${invoice.items.map((item) => `<option value="${item.id}">${escapeHtml(item.item_name)} · ${Number(item.quantity_millis) / 1000} units</option>`).join('')}</select></label><label>Quantity<input name="quantity" type="number" min="0.001" step="0.001" required /></label><label>Credit date<input name="creditDate" type="date" value="${today}" required /></label><label>Reason<input name="reason" maxlength="1000" required /></label><button class="button button-secondary" type="submit">Create credit note</button><p class="inline-feedback" aria-live="polite"></p></form>` : ''}`;
      invoiceDialog.showModal();
      invoiceDialog.querySelectorAll('.receipt-download').forEach((button) => button.addEventListener('click', () => {
        downloadAuthenticatedFile(`/api/invoice-payments/${button.dataset.id}/receipt.pdf`, `receipt-${button.dataset.id}.pdf`)
          .catch((error) => alert(error.message));
      }));
      invoiceDialog.querySelectorAll('.receipt-email').forEach((button) => button.addEventListener('click', async () => {
        try {
          await api(`/api/invoice-payments/${button.dataset.id}/receipt-email`, { method: 'POST' });
          alert('Receipt email accepted by the configured provider.');
        } catch (error) {
          alert(error.message);
        }
      }));
      invoiceDialog.querySelectorAll('.credit-pdf').forEach((button) => button.addEventListener('click', () => {
        downloadAuthenticatedFile(`/api/credit-notes/${button.dataset.id}/pdf`, `credit-note-${button.dataset.id}.pdf`)
          .catch((error) => alert(error.message));
      }));
      invoiceDialog.querySelector('#invoice-credit-form')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const values = Object.fromEntries(new FormData(form).entries());
        const submit = form.querySelector('button[type="submit"]');
        submit.disabled = true;
        try {
          await api(`/api/invoices/${invoice.id}/credit-notes`, {
            method: 'POST',
            body: JSON.stringify({
              creditDate: values.creditDate,
              reason: values.reason,
              items: [{ invoiceItemId: values.invoiceItemId, quantity: values.quantity }],
            }),
          });
          invoiceDialog.close();
          await showInvoice(invoice.id);
        } catch (error) {
          showInlineError(form, error.message);
          submit.disabled = false;
        }
      });
    } catch (error) {
      alert(error.message);
    }
  }

  function bindInvoiceDetails() {
    content.querySelectorAll('.invoice-view').forEach((button) => {
      button.addEventListener('click', () => showInvoice(Number(button.dataset.id)));
    });
  }

  async function downloadInvoicePdf(invoiceId) {
    try {
      const response = await fetch(`/api/invoices/${invoiceId}/pdf`, {
        headers: sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {},
      });
      if (response.status === 401) {
        clearSession();
        throw new Error('Your session expired. Please sign in again.');
      }
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'The invoice PDF could not be generated.');
      }
      const objectUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = `invoice-${invoiceId}.pdf`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (error) {
      alert(error.message);
    }
  }

  bindInvoiceDetails();
  content.querySelectorAll('.invoice-pdf').forEach((button) => {
    button.addEventListener('click', () => downloadInvoicePdf(Number(button.dataset.id)));
  });
  content.querySelectorAll('.invoice-email').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!window.confirm('Send this invoice to the customer email address on file?')) return;
      try {
        const result = await api(`/api/invoices/${button.dataset.id}/email`, { method: 'POST' });
        alert(`Invoice email ${result.email.status}.`);
      } catch (error) {
        alert(error.message);
      }
    });
  });
  content.querySelectorAll('.invoice-edit').forEach((button) => {
    button.addEventListener('click', () => editInvoice(Number(button.dataset.id)));
  });
  content.querySelectorAll('.invoice-issue').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!confirm('Issue this invoice? Its financial details will be locked.')) return;
      button.disabled = true;
      try {
        await api(`/api/invoices/${button.dataset.id}/issue`, { method: 'POST' });
        await renderInvoices(content);
      } catch (error) {
        alert(error.message);
        button.disabled = false;
      }
    });
  });
  content.querySelectorAll('.invoice-cancel').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!confirm('Cancel this unpaid invoice? The record will be retained.')) return;
      try {
        await api(`/api/invoices/${button.dataset.id}/cancel`, { method: 'POST' });
        await renderInvoices(content);
      } catch (error) {
        alert(error.message);
      }
    });
  });
  content.querySelectorAll('.invoice-pay').forEach((button) => {
    button.addEventListener('click', async () => {
      let invoice;
      try {
        invoice = (await api(`/api/invoices/${button.dataset.id}`)).invoice;
      } catch (error) {
        alert(error.message);
        return;
      }
      const dialog = document.getElementById('invoice-payment-dialog');
      dialog.innerHTML = `<form method="dialog" class="dialog-close"><button class="icon-button" aria-label="Close">×</button></form><h2>Record payment</h2><p>${escapeHtml(invoice.invoice_number)} · balance ${money(invoice.outstanding_cents, currency)}</p><form id="invoice-payment-form" class="record-form"><label>Amount (${escapeHtml(currency)})<input name="amount" type="number" min="0.01" step="0.01" max="${(invoice.outstanding_cents / 100).toFixed(2)}" required /></label><label>Payment date<input name="paymentDate" type="date" value="${today}" required /></label><label>Method<select name="paymentMethod"><option value="eft">EFT</option><option value="cash">Cash</option><option value="card">Card</option><option value="other">Other</option></select></label><label>Reference (optional)<input name="reference" maxlength="100" /></label><label class="invoice-address-field">Notes<textarea name="notes" maxlength="2000"></textarea></label><button class="button button-primary" type="submit">Save payment</button><p class="inline-feedback" aria-live="polite"></p></form>`;
      dialog.showModal();
      const paymentKey = crypto.randomUUID();
      dialog.querySelector('#invoice-payment-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const values = Object.fromEntries(new FormData(form).entries());
        const amountCents = centsFromInput(values.amount);
        if (amountCents === null || amountCents <= 0) {
          showInlineError(form, 'Enter a valid payment amount.');
          return;
        }
        const submit = form.querySelector('button[type="submit"]');
        submit.disabled = true;
        try {
          await api(`/api/invoices/${invoice.id}/payments`, {
            method: 'POST',
            headers: { 'Idempotency-Key': paymentKey },
            body: JSON.stringify({
              amountCents,
              paymentDate: values.paymentDate,
              paymentMethod: values.paymentMethod,
              reference: values.reference,
              notes: values.notes,
            }),
          });
          dialog.close();
          await renderInvoices(content);
        } catch (error) {
          showInlineError(form, error.message);
          submit.disabled = false;
        }
      });
    });
  });
}

async function renderPayables(content) {
  const query = new URLSearchParams(payablesFilters);
  query.set('page', '1');
  query.set('pageSize', '50');
  const [list, suppliersResponse, productsResponse, summaryResponse] = await Promise.all([
    api(`/api/supplier-invoices?${query}`),
    api('/api/expenses/suppliers'),
    api('/api/products'),
    api('/api/supplier-invoices/summary'),
  ]);
  const suppliers = suppliersResponse.suppliers || [];
  const products = (productsResponse.products || []).filter((product) => Number(product.is_active));
  const summary = summaryResponse.summary;
  const currency = sessionInfo.business.currency;
  const dateParts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: sessionInfo.business.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date()).filter((part) => part.type !== 'literal')
    .map((part) => [part.type, part.value]));
  const today = `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
  const lineEditor = () => `<fieldset class="invoice-line-editor supplier-invoice-line">
    <legend>Supplier invoice item</legend>
    <label>Product<select class="supplier-item-product"><option value="">Custom item / service</option>${products.map((product) => `<option value="${product.id}">${escapeHtml(product.name)}</option>`).join('')}</select></label>
    <label>Description<input class="supplier-item-name" maxlength="191" required /></label>
    <label>Quantity<input class="supplier-item-quantity" type="number" min="0.001" step="0.001" value="1" required /></label>
    <label>Unit cost (${escapeHtml(currency)})<input class="supplier-item-price" type="number" min="0" step="0.01" value="0" required /></label>
    <label>Tax rate (%)<input class="supplier-item-tax" type="number" min="0" max="100" step="0.01" value="0" required /></label>
    <button class="text-link supplier-item-remove" type="button">Remove item</button>
  </fieldset>`;
  content.innerHTML = `<section class="page-heading"><div><span class="eyebrow">SUPPLIER FINANCES</span><h1>Supplier invoices</h1><p>Record supplier bills, link expenses, track payments, and receive ordered stock.</p></div></section>
    <section class="kpi-grid report-kpis">
      ${kpiCard('▤', 'Outstanding payables', money(summary.outstandingCents, currency), `${summary.invoiceCount} supplier invoices`, '', 'icon-blue')}
      ${kpiCard('!', 'Overdue', money(summary.overdueCents, currency), `${summary.overdueCount} invoices past due`, '', 'icon-red')}
      ${kpiCard('↗', 'Paid this month', money(summary.paidThisMonthCents, currency), `${summary.partiallyPaidCount} partially paid`, '', 'icon-green')}
    </section>
    <section class="panel form-panel"><h2>Record a supplier invoice</h2>${suppliers.length ? `<form id="supplier-invoice-form" class="record-form">
      <label>Supplier<select name="supplierId" required><option value="">Select supplier</option>${suppliers.map((supplier) => `<option value="${supplier.id}">${escapeHtml(supplier.name)}</option>`).join('')}</select></label>
      <label>Supplier invoice number<input name="supplierInvoiceNumber" maxlength="100" required /></label>
      <label>Invoice date<input type="date" name="invoiceDate" value="${today}" required /></label>
      <label>Received date<input type="date" name="receivedDate" value="${today}" required /></label>
      <label>Due date<input type="date" name="dueDate" value="${today}" required /></label>
      <div id="supplier-invoice-lines">${lineEditor()}</div>
      <button class="button button-secondary" id="supplier-add-line" type="button">Add line item</button>
      <label>Notes<textarea name="notes" maxlength="4000"></textarea></label>
      <button class="button button-primary" type="submit">Save supplier invoice</button><p class="inline-feedback" aria-live="polite"></p>
    </form>` : '<div class="table-empty"><strong>Add a supplier first</strong><span>Use Expenses → Suppliers to create a supplier record.</span><button class="button button-secondary" data-view="expenses">Open expenses</button></div>'}</section>
    <section class="panel list-panel"><div class="panel-heading"><div><h2>Supplier invoice register</h2><p>${list.total} record${list.total === 1 ? '' : 's'} · linked expenses are not counted twice</p></div></div>
      <form id="payables-filters" class="expense-filters">
        <label>Search<input name="search" value="${escapeHtml(payablesFilters.get('search') || '')}" placeholder="Invoice number or supplier" /></label>
        <label>Supplier<select name="supplierId"><option value="">All suppliers</option>${suppliers.map((supplier) => `<option value="${supplier.id}" ${payablesFilters.get('supplierId') === String(supplier.id) ? 'selected' : ''}>${escapeHtml(supplier.name)}</option>`).join('')}</select></label>
        <label>Status<select name="status"><option value="">All statuses</option>${['received', 'partially_paid', 'paid', 'overdue', 'cancelled'].map((status) => `<option value="${status}" ${payablesFilters.get('status') === status ? 'selected' : ''}>${escapeHtml(status.replace('_', ' '))}</option>`).join('')}</select></label>
        <button class="button button-secondary" type="submit">Apply filters</button><button class="button button-secondary" id="payables-clear" type="button">Clear</button>
      </form>
      ${list.supplierInvoices.length ? `<div class="table-scroll"><table><thead><tr><th>Supplier invoice</th><th>Supplier</th><th>Dates</th><th>Total</th><th>Paid</th><th>Balance</th><th>Status</th><th>Actions</th></tr></thead><tbody>${list.supplierInvoices.map((invoice) => `<tr><td><strong>${escapeHtml(invoice.supplier_invoice_number)}</strong></td><td>${escapeHtml(invoice.supplier_name)}</td><td>${escapeHtml(invoice.invoice_date)}<small>Due ${escapeHtml(invoice.due_date)}</small></td><td>${money(invoice.total_cents, currency)}</td><td>${money(invoice.paid_cents, currency)}</td><td>${money(invoice.outstanding_cents, currency)}</td><td><span class="status-pill status-${escapeHtml(invoice.status)}">${escapeHtml(invoice.status.replace('_', ' '))}</span></td><td><div class="invoice-row-actions"><button class="text-link supplier-invoice-details" data-id="${invoice.id}" type="button">Details</button>${invoice.outstanding_cents > 0 && invoice.status !== 'cancelled' ? `<button class="text-link supplier-invoice-pay" data-id="${invoice.id}" data-balance="${invoice.outstanding_cents}" type="button">Record payment</button>` : ''}${!invoice.expense_id ? `<button class="text-link supplier-invoice-link" data-id="${invoice.id}" type="button">Link expense</button>` : ''}<button class="text-link supplier-invoice-stock" data-id="${invoice.id}" type="button">Receive stock</button><button class="text-link supplier-statement" data-supplier-id="${invoice.supplier_id}" type="button">Statement</button></div></td></tr>`).join('')}</tbody></table></div>` : '<div class="table-empty"><strong>No supplier invoices found</strong><span>Record a supplier invoice to track costs and deliveries.</span></div>'}
    </section>
    <dialog class="expense-dialog" id="supplier-invoice-details"></dialog>`;
  content.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => {
    currentView = button.dataset.view;
    renderShell();
    renderView(currentView);
  }));
  const invoiceForm = document.getElementById('supplier-invoice-form');
  const lineContainer = document.getElementById('supplier-invoice-lines');
  document.getElementById('supplier-add-line')?.addEventListener('click', () => {
    lineContainer.insertAdjacentHTML('beforeend', lineEditor());
  });
  lineContainer?.addEventListener('change', (event) => {
    if (!event.target.classList.contains('supplier-item-product')) return;
    const product = products.find((item) => Number(item.id) === Number(event.target.value));
    event.target.closest('.supplier-invoice-line').querySelector('.supplier-item-name').value = product?.name || '';
  });
  lineContainer?.addEventListener('click', (event) => {
    if (!event.target.classList.contains('supplier-item-remove')) return;
    if (lineContainer.querySelectorAll('.supplier-invoice-line').length === 1) {
      showInlineError(invoiceForm, 'An invoice must contain at least one line item.');
      return;
    }
    event.target.closest('.supplier-invoice-line').remove();
  });
  invoiceForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    const items = [];
    for (const row of lineContainer.querySelectorAll('.supplier-invoice-line')) {
      const unitPriceCents = centsFromInput(row.querySelector('.supplier-item-price').value);
      const taxRateBps = taxRateBpsFromInput(row.querySelector('.supplier-item-tax').value || '0');
      if (unitPriceCents === null || taxRateBps === null) {
        showInlineError(form, 'Enter a valid unit cost and tax rate.');
        return;
      }
      const productId = row.querySelector('.supplier-item-product').value;
      items.push({
        productId: productId || null,
        itemType: productId ? 'product' : 'custom',
        name: row.querySelector('.supplier-item-name').value,
        quantity: row.querySelector('.supplier-item-quantity').value,
        unitPriceCents,
        taxRateBps,
      });
    }
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      await api('/api/supplier-invoices', {
        method: 'POST',
        body: JSON.stringify({ ...values, items }),
      });
      await renderPayables(content);
    } catch (error) {
      showInlineError(form, error.message);
      submit.disabled = false;
    }
  });
  document.getElementById('payables-filters').addEventListener('submit', (event) => {
    event.preventDefault();
    payablesFilters = new URLSearchParams();
    for (const [key, value] of new FormData(event.currentTarget).entries()) {
      if (value) payablesFilters.set(key, value);
    }
    renderPayables(content).catch((error) => showInlineError(event.currentTarget, error.message));
  });
  document.getElementById('payables-clear').addEventListener('click', () => {
    payablesFilters = new URLSearchParams();
    renderPayables(content).catch((error) => alert(error.message));
  });
  const detailsDialog = document.getElementById('supplier-invoice-details');
  content.querySelectorAll('.supplier-invoice-details').forEach((button) => button.addEventListener('click', async () => {
    try {
      const invoice = (await api(`/api/supplier-invoices/${button.dataset.id}`)).supplierInvoice;
      detailsDialog.innerHTML = `<form method="dialog" class="dialog-close"><button class="icon-button" aria-label="Close">×</button></form><h2>${escapeHtml(invoice.supplier_invoice_number)}</h2><p>${escapeHtml(invoice.supplier_name)} · ${escapeHtml(invoice.status.replace('_', ' '))}</p><dl><div><dt>Invoice / due</dt><dd>${escapeHtml(invoice.invoice_date)} / ${escapeHtml(invoice.due_date)}</dd></div><div><dt>Total / paid / balance</dt><dd>${money(invoice.total_cents, currency)} / ${money(invoice.paid_cents, currency)} / ${money(invoice.outstanding_cents, currency)}</dd></div><div><dt>Linked expense</dt><dd>${invoice.linked_expense_id ? `#${invoice.linked_expense_id}` : 'No linked expense'}</dd></div></dl><h3>Items and receiving</h3><div class="table-scroll"><table><thead><tr><th>Item</th><th>Ordered</th><th>Received</th><th>Unit cost</th><th>Total</th></tr></thead><tbody>${invoice.items.map((item) => `<tr><td>${escapeHtml(item.item_name)}</td><td>${Number(item.quantity_millis) / 1000}</td><td>${Number(item.received_quantity_millis) / 1000}</td><td>${money(item.unit_price_cents, currency)}</td><td>${money(item.total_cents, currency)}</td></tr>`).join('')}</tbody></table></div><h3>Payments</h3>${invoice.payments.length ? `<div class="table-scroll"><table><thead><tr><th>Date</th><th>Method</th><th>Reference</th><th>Amount</th></tr></thead><tbody>${invoice.payments.map((payment) => `<tr><td>${escapeHtml(dateInputValue(payment.payment_date))}</td><td>${escapeHtml(payment.payment_method)}</td><td>${escapeHtml(payment.reference || '—')}</td><td>${money(payment.amount_cents, currency)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted-copy">No payments recorded.</p>'}`;
      detailsDialog.showModal();
    } catch (error) {
      alert(error.message);
    }
  }));
  content.querySelectorAll('.supplier-invoice-pay').forEach((button) => button.addEventListener('click', async () => {
    const amount = window.prompt(`Payment amount (${currency})`, (Number(button.dataset.balance) / 100).toFixed(2));
    if (amount === null) return;
    const amountCents = centsFromInput(amount);
    if (amountCents === null || amountCents <= 0) return alert('Enter a valid payment amount.');
    const paymentMethod = window.prompt('Payment method (cash, EFT, card, etc.)', 'eft');
    if (!paymentMethod) return;
    try {
      await api(`/api/supplier-invoices/${button.dataset.id}/payments`, {
        method: 'POST',
        headers: { 'Idempotency-Key': button.dataset.idempotencyKey || (button.dataset.idempotencyKey = crypto.randomUUID()) },
        body: JSON.stringify({ amountCents, paymentDate: today, paymentMethod }),
      });
      await renderPayables(content);
    } catch (error) {
      alert(error.message);
    }
  }));
  content.querySelectorAll('.supplier-invoice-link').forEach((button) => button.addEventListener('click', async () => {
    try {
      const invoice = (await api(`/api/supplier-invoices/${button.dataset.id}`)).supplierInvoice;
      const existing = (await api(
        `/api/expenses?search=${encodeURIComponent(invoice.supplier_invoice_number)}&page=1&pageSize=100`
      )).expenses.filter((expense) =>
        Number(expense.supplier_id) === Number(invoice.supplier_id) &&
        expense.reference_number === invoice.supplier_invoice_number &&
        expense.status !== 'cancelled'
      );
      let payload = {};
      if (existing.length) {
        const choices = existing.map((expense) =>
          `${expense.id}: ${expense.title} - ${money(expense.total_cents, currency)}`
        ).join('\n');
        const selected = window.prompt(
          `An expense already uses this invoice reference. Enter the matching expense ID:\n${choices}`,
          String(existing[0].id)
        );
        if (selected === null) return;
        if (!existing.some((expense) => String(expense.id) === selected.trim())) {
          return alert('Select an expense ID from the list to avoid duplicating the payable.');
        }
        payload = { expenseId: Number(selected) };
      } else if (!window.confirm('Create and link an expense for this supplier invoice?')) {
        return;
      }
      await api(`/api/supplier-invoices/${button.dataset.id}/expense`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      await renderPayables(content);
    } catch (error) {
      alert(error.message);
    }
  }));
  content.querySelectorAll('.supplier-invoice-stock').forEach((button) => button.addEventListener('click', async () => {
    try {
      const invoice = (await api(`/api/supplier-invoices/${button.dataset.id}`)).supplierInvoice;
      const remaining = invoice.items.filter((item) =>
        item.item_type === 'product' && item.product_id &&
        Number(item.received_quantity_millis) < Number(item.quantity_millis)
      );
      if (!remaining.length) return alert('No unreceived product lines remain.');
      const receiveItems = [];
      for (const item of remaining) {
        const left = (Number(item.quantity_millis) - Number(item.received_quantity_millis)) / 1000;
        const input = window.prompt(`Whole units of ${item.item_name} to receive (up to ${left})`, String(Math.floor(left)));
        if (input === null) continue;
        const quantity = Number(input);
        if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > left) {
          return alert('Enter a positive whole-number quantity within the remaining amount.');
        }
        receiveItems.push({
          supplierInvoiceItemId: item.id,
          quantity,
          updateCost: window.confirm(`Update product cost to ${money(item.unit_price_cents, currency)}?`),
        });
      }
      if (!receiveItems.length) return;
      await api(`/api/supplier-invoices/${button.dataset.id}/stock-receipts`, {
        method: 'POST',
        headers: { 'Idempotency-Key': button.dataset.idempotencyKey || (button.dataset.idempotencyKey = crypto.randomUUID()) },
        body: JSON.stringify({ items: receiveItems }),
      });
      await renderPayables(content);
    } catch (error) {
      alert(error.message);
    }
  }));
  content.querySelectorAll('.supplier-statement').forEach((button) => button.addEventListener('click', async () => {
    const startDate = window.prompt('Statement start date (YYYY-MM-DD)', `${today.slice(0, 7)}-01`);
    if (!startDate) return;
    const endDate = window.prompt('Statement end date (YYYY-MM-DD)', today);
    if (!endDate) return;
    const params = new URLSearchParams({ startDate, endDate });
    try {
      await downloadAuthenticatedFile(
        `/api/suppliers/${button.dataset.supplierId}/statement.pdf?${params}`,
        `supplier-${button.dataset.supplierId}-statement.pdf`
      );
    } catch (error) {
      alert(error.message);
    }
  }));
}

function expenseDateForPeriod(period) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: sessionInfo.business.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const dateParts = Object.fromEntries(
    parts.filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)])
  );
  const today = `${dateParts.year}-${String(dateParts.month).padStart(2, '0')}-${String(dateParts.day).padStart(2, '0')}`;
  const date = new Date(`${today}T00:00:00.000Z`);
  const addDays = (value, days) => {
    const result = new Date(`${value}T00:00:00.000Z`);
    result.setUTCDate(result.getUTCDate() + days);
    return result.toISOString().slice(0, 10);
  };

  if (period === 'today') return [today, today];
  if (period === 'week') {
    const weekday = date.getUTCDay();
    const start = addDays(today, -((weekday + 6) % 7));
    return [start, today];
  }
  if (period === 'month') return [`${today.slice(0, 7)}-01`, today];
  if (period === 'last-month') {
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() - 1);
    const start = date.toISOString().slice(0, 10);
    date.setUTCMonth(date.getUTCMonth() + 1);
    date.setUTCDate(0);
    return [start, date.toISOString().slice(0, 10)];
  }
  if (period === 'quarter') return [addDays(today, -89), today];
  if (period === 'year') return [`${today.slice(0, 4)}-01-01`, today];
  return ['', ''];
}

async function renderFinancialDocuments(content) {
  const [documentsResponse, supplierResponse, expenseResponse, invoiceResponse, extractionStatus] =
    await Promise.all([
      api('/api/documents'),
      api('/api/supplier-invoices?page=1&pageSize=100'),
      api('/api/expenses?page=1&pageSize=100'),
      api('/api/invoices?page=1&pageSize=100'),
      api('/api/documents/extraction-status'),
    ]);
  const suppliers = supplierResponse.supplierInvoices || [];
  const expenses = expenseResponse.expenses || [];
  const invoices = invoiceResponse.invoices || [];
  const extraction = extractionStatus.extraction;
  const dialog = document.createElement('dialog');
  dialog.className = 'expense-dialog document-preview-dialog';
  const optionsFor = (type) => {
    const records = type === 'supplier_invoice'
      ? suppliers.map((record) => ({ id: record.id, name: `${record.supplier_invoice_number} · ${record.supplier_name}` }))
      : type === 'expense'
        ? expenses.map((record) => ({ id: record.id, name: record.title }))
        : invoices.map((record) => ({ id: record.id, name: `${record.invoice_number || 'Draft'} · ${record.customer_name}` }));
    return records.map((record) => `<option value="${record.id}">${escapeHtml(record.name)}</option>`).join('');
  };
  content.innerHTML = `<section class="page-heading"><div><span class="eyebrow">PRIVATE BUSINESS FILES</span><h1>Financial documents</h1><p>Search, preview, and download supplier invoices, receipts, and customer invoice attachments. Files are stored outside public web assets.</p></div></section>
    <section class="panel form-panel"><h2>Upload a financial document</h2><form id="document-upload-form" class="record-form">
      <label>Attach to<select name="recordType" id="document-record-type"><option value="supplier_invoice">Supplier invoice</option><option value="expense">Expense</option><option value="invoice">Customer invoice</option></select></label>
      <label>Financial record<select name="recordId" id="document-record-id" required>${optionsFor('supplier_invoice')}</select></label>
      <label>File (PDF, JPEG, PNG, or WebP; maximum 10 MB)<input type="file" name="file" accept="application/pdf,image/jpeg,image/png,image/webp" required /></label>
      <button class="button button-primary" type="submit">Upload document</button><p class="inline-feedback" aria-live="polite"></p>
    </form></section>
    <section class="panel list-panel"><div class="panel-heading"><div><h2>Document library</h2><p>${documentsResponse.documents.length} document${documentsResponse.documents.length === 1 ? '' : 's'} · extraction ${extraction.configured ? `available (${escapeHtml(extraction.provider)})` : 'not configured'}</p></div></div>
      <form class="expense-filters" id="document-search-form"><label>Search<input name="search" placeholder="Filename, supplier, or invoice number" /></label><label>Type<select name="documentType"><option value="">All types</option><option value="supplier_invoice">Supplier invoice</option><option value="expense_receipt">Expense receipt</option><option value="supporting_document">Supporting document</option><option value="business_logo">Business logo</option></select></label><button class="button button-secondary" type="submit">Search</button></form>
      <div id="document-list">${renderDocumentRows(documentsResponse.documents, extraction.configured)}</div>
    </section>`;
  content.append(dialog);
  const recordType = document.getElementById('document-record-type');
  const recordId = document.getElementById('document-record-id');
  recordType.addEventListener('change', () => {
    recordId.innerHTML = optionsFor(recordType.value);
    recordId.required = recordId.options.length > 0;
  });
  document.getElementById('document-upload-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const file = form.elements.file.files[0];
    if (!file) return;
    const type = form.elements.recordType.value;
    const id = form.elements.recordId.value;
    const endpoint = type === 'supplier_invoice'
      ? `/api/supplier-invoices/${id}/documents`
      : type === 'expense'
        ? `/api/expenses/${id}/documents`
        : `/api/invoices/${id}/documents`;
    const feedback = form.querySelector('.inline-feedback');
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      await api(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': file.type, 'X-File-Name': encodeURIComponent(file.name) },
        body: file,
      });
      await renderFinancialDocuments(content);
    } catch (error) {
      feedback.textContent = error.message;
      feedback.className = 'inline-feedback error';
      submit.disabled = false;
    }
  });
  document.getElementById('document-search-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const query = new URLSearchParams(new FormData(event.currentTarget));
    for (const [key, value] of [...query.entries()]) if (!value) query.delete(key);
    try {
      const result = await api(`/api/documents?${query}`);
      document.getElementById('document-list').innerHTML =
        renderDocumentRows(result.documents, extraction.configured);
      bindDocumentActions();
    } catch (error) {
      showInlineError(event.currentTarget, error.message);
    }
  });
  function renderDocumentRows(documents, extractionConfigured) {
    return documents.length ? `<div class="table-scroll"><table><thead><tr><th>File</th><th>Type</th><th>Related record</th><th>Uploaded</th><th>Size</th><th>Actions</th></tr></thead><tbody>${documents.map((document) => {
      const related = document.supplier_invoice_number
        ? `${document.supplier_invoice_number} · ${document.supplier_name}`
        : document.invoice_number
          ? document.invoice_number
          : document.expense_title || 'Business file';
      return `<tr><td><strong>${escapeHtml(document.original_filename)}</strong></td><td>${escapeHtml(document.document_type.replace('_', ' '))}</td><td>${escapeHtml(related)}</td><td>${escapeHtml(dateTime(document.uploaded_at, sessionInfo.business.timezone))}</td><td>${Math.ceil(document.file_size_bytes / 1024)} KB</td><td><div class="invoice-row-actions"><button class="text-link document-preview" data-id="${document.id}" data-name="${escapeHtml(document.original_filename)}" type="button">Preview</button><button class="text-link document-download" data-id="${document.id}" data-name="${escapeHtml(document.original_filename)}" type="button">Download</button><button class="text-link document-delete" data-id="${document.id}" type="button">Delete</button>${extractionConfigured && ['supplier_invoice', 'supporting_document'].includes(document.document_type) ? `<button class="text-link document-extract" data-id="${document.id}" type="button">Extract fields</button>` : ''}</div></td></tr>`;
    }).join('')}</tbody></table></div>` : '<div class="table-empty"><strong>No financial documents found</strong><span>Uploaded files remain private and are only available to your business.</span></div>';
  }
  function bindDocumentActions() {
    document.querySelectorAll('.document-preview').forEach((button) => button.addEventListener('click', async () => {
      try {
        const blob = await authenticatedBlob(`/api/documents/${button.dataset.id}/preview`);
        const url = URL.createObjectURL(blob);
        dialog.innerHTML = `<form method="dialog" class="dialog-close"><button class="icon-button" aria-label="Close">×</button></form><h2>${escapeHtml(button.dataset.name)}</h2><iframe title="${escapeHtml(button.dataset.name)}" sandbox="" src="${url}"></iframe>`;
        dialog.addEventListener('close', () => URL.revokeObjectURL(url), { once: true });
        dialog.showModal();
      } catch (error) {
        alert(error.message);
      }
    }));
    document.querySelectorAll('.document-download').forEach((button) => button.addEventListener('click', () => {
      downloadAuthenticatedFile(`/api/documents/${button.dataset.id}`, button.dataset.name)
        .catch((error) => alert(error.message));
    }));
    document.querySelectorAll('.document-delete').forEach((button) => button.addEventListener('click', async () => {
      if (!window.confirm('Remove this document from the business library?')) return;
      try {
        await api(`/api/documents/${button.dataset.id}`, { method: 'DELETE' });
        await renderFinancialDocuments(content);
      } catch (error) {
        alert(error.message);
      }
    }));
    document.querySelectorAll('.document-extract').forEach((button) => button.addEventListener('click', async () => {
      if (!window.confirm('This sends the selected document to the configured external extraction provider. Continue?')) return;
      try {
        const result = await api(`/api/documents/${button.dataset.id}/extract`, {
          method: 'POST',
          body: JSON.stringify({ consentToExternalProcessing: true }),
        });
        const approved = window.confirm(`Review these unverified suggestions before use:\n\n${JSON.stringify(result.extraction.fields, null, 2)}\n\nChoose OK to confirm or Cancel to reject.`);
        await api(`/api/documents/${button.dataset.id}/extractions/${result.extraction.id}/confirm`, {
          method: 'POST',
          body: JSON.stringify({ confirmed: approved }),
        });
        alert(approved ? 'Suggestions confirmed for human review.' : 'Suggestions rejected.');
      } catch (error) {
        alert(error.message);
      }
    }));
  }
  bindDocumentActions();
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
}

async function renderEmployees(content) {
  const query = new URLSearchParams({
    page: String(employeePage),
    pageSize: '20',
    ...(employeeSearch ? { search: employeeSearch } : {}),
    ...(employeeStatus ? { status: employeeStatus } : {}),
  });
  const list = await api(`/api/employees?${query}`);
  const currency = sessionInfo.business.currency || 'ZAR';
  const payLabels = {
    monthly_salary: 'Monthly salary',
    hourly: 'Hourly',
    weekly: 'Weekly wage',
    fortnightly: 'Fortnightly wage',
    daily: 'Daily wage',
  };
  const compensationForm = (employee) => `
    <dialog class="expense-dialog" id="employee-compensation-dialog">
      <form method="dialog" class="dialog-close"><button class="icon-button" aria-label="Close">×</button></form>
      <h2>Change compensation</h2>
    <p class="form-help">Changes are effective-dated. Payroll drafts still require owner-entered gross pay.</p>
      <form id="employee-compensation-form" class="record-form">
        <label>Pay structure<select name="payStructure" required><option value="monthly_salary">Monthly salary</option><option value="hourly">Hourly</option><option value="weekly">Weekly wage</option><option value="fortnightly">Fortnightly wage</option><option value="daily">Daily wage</option></select></label>
        <label>Pay frequency<select name="payFrequency" required><option value="monthly">Monthly</option><option value="fortnightly">Fortnightly</option><option value="weekly">Weekly</option></select></label>
        <label>Rate in ${escapeHtml(currency)}<input name="baseRate" type="number" min="0.01" step="0.01" required /></label>
        <label>Hours per week (optional)<input name="hoursPerWeek" type="number" min="0.1" max="168" step="0.1" /></label>
        <label>Effective from<input name="effectiveFrom" type="date" value="${new Date().toISOString().slice(0, 10)}" required /></label>
        <button class="button button-primary" type="submit">Save compensation</button>
      </form>
    </dialog>`;

  content.innerHTML = `
    <section class="page-heading"><div><span class="eyebrow">FINANCE & PEOPLE</span><h1>Employees</h1><p>Manage employee records, effective-dated base pay, and invitations to private payslip access.</p></div><div class="heading-actions"><button class="button button-primary" id="employee-add">＋ Add employee</button></div></section>
    <section class="panel list-panel">
      <form id="employee-filters" class="expense-filters">
        <label>Search<input name="search" value="${escapeHtml(employeeSearch)}" placeholder="Name, employee number or department" /></label>
        <label>Status<select name="status"><option value="">All statuses</option>${[['active','Active'],['on_leave','On leave'],['suspended','Suspended'],['terminated','Terminated'],['archived','Archived']].map(([value,label]) => `<option value="${value}" ${employeeStatus === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
        <button class="button button-secondary" type="submit">Apply filters</button>
      </form>
      <form id="employee-form" class="record-form employee-form hidden">
        <h2 id="employee-form-title">Add employee</h2>
        <input type="hidden" name="employeeId" />
        <label>Employee number<input name="employeeNumber" maxlength="40" required /></label>
        <label>First name<input name="firstName" maxlength="100" required /></label>
        <label>Last name<input name="lastName" maxlength="100" required /></label>
        <label>Email<input name="email" type="email" maxlength="191" /></label>
        <label>Phone<input name="phone" type="tel" maxlength="50" /></label>
        <label>Job title<input name="jobTitle" maxlength="191" required /></label>
        <label>Department<input name="department" maxlength="100" /></label>
        <label>Employment type<select name="employmentType" required><option value="permanent">Permanent</option><option value="fixed_term">Fixed term</option><option value="casual">Casual</option><option value="contractor">Contractor</option><option value="intern">Intern</option></select></label>
        <label>Employment status<select name="employmentStatus"><option value="active">Active</option><option value="on_leave">On leave</option><option value="suspended">Suspended</option><option value="terminated">Terminated</option><option value="archived">Archived</option></select></label>
        <label>Start date<input name="employmentStartDate" type="date" required /></label>
        <label>End date<input name="employmentEndDate" type="date" /></label>
        <label>Contract type<input name="contractType" maxlength="100" /></label>
        <label>Work location<input name="workLocation" maxlength="191" /></label>
        <label class="span-two">Residential address<textarea name="residentialAddress" maxlength="2000" rows="2"></textarea></label>
        <label>Emergency contact<input name="emergencyContactName" maxlength="191" /></label>
        <label>Emergency contact phone<input name="emergencyContactPhone" type="tel" maxlength="50" /></label>
        <fieldset id="employee-initial-compensation" class="span-two employee-compensation-fields">
          <legend>Initial base pay (private to the business owner)</legend>
          <div class="record-form">
            <label>Pay structure<select name="payStructure"><option value="monthly_salary">Monthly salary</option><option value="hourly">Hourly</option><option value="weekly">Weekly wage</option><option value="fortnightly">Fortnightly wage</option><option value="daily">Daily wage</option></select></label>
            <label>Pay frequency<select name="payFrequency"><option value="monthly">Monthly</option><option value="fortnightly">Fortnightly</option><option value="weekly">Weekly</option></select></label>
            <label>Rate in ${escapeHtml(currency)}<input name="baseRate" type="number" min="0.01" step="0.01" /></label>
            <label>Hours per week (optional)<input name="hoursPerWeek" type="number" min="0.1" max="168" step="0.1" /></label>
            <label>Effective from<input name="effectiveFrom" type="date" value="${new Date().toISOString().slice(0, 10)}" /></label>
          </div>
        </fieldset>
        <div class="employee-form-actions span-two"><button class="button button-primary" type="submit">Save employee</button><button class="button button-secondary" id="employee-cancel" type="button">Cancel</button><span class="form-help" id="employee-form-feedback" role="status"></span></div>
      </form>
      ${list.employees.length ? `<div class="table-scroll"><table><thead><tr><th>Employee</th><th>Role / department</th><th>Employment</th><th>Base pay record</th><th>Actions</th></tr></thead><tbody>${list.employees.map((employee) => `<tr><td><strong>${escapeHtml(employee.first_name)} ${escapeHtml(employee.last_name)}</strong><small>${escapeHtml(employee.employee_number)}${employee.email ? ` · ${escapeHtml(employee.email)}` : ''}</small></td><td>${escapeHtml(employee.job_title)}<small>${escapeHtml(employee.department || 'No department')}</small></td><td><span class="status-pill status-${employee.employment_status === 'active' ? 'completed' : 'cancelled'}">${escapeHtml(employee.employment_status.replace('_', ' '))}</span><small>${escapeHtml(employee.employment_type)} · since ${escapeHtml(employee.employment_start_date)}</small></td><td>${employee.base_rate_cents === null ? 'No current rate' : `${money(employee.base_rate_cents, employee.compensation_currency)} · ${escapeHtml(payLabels[employee.pay_structure] || employee.pay_structure)} / ${escapeHtml(employee.pay_frequency)}`}<small>${employee.compensation_effective_from ? `Effective ${escapeHtml(employee.compensation_effective_from)}` : ''}</small></td><td><div class="invoice-row-actions"><button class="text-link employee-edit" data-id="${employee.id}" type="button">Edit details</button><button class="text-link employee-compensation" data-id="${employee.id}" type="button">Change pay</button>${employee.portal_user_id ? `<button class="text-link employee-portal-revoke" data-id="${employee.id}" type="button">Revoke portal</button>` : employee.email ? `<button class="text-link employee-portal-invite" data-id="${employee.id}" type="button">Invite to portal</button>` : ''}</div></td></tr>`).join('')}</tbody></table></div>` : '<div class="table-empty"><strong>No employees found</strong><span>Add an employee or change the search filters.</span></div>'}
      <div class="expense-pagination"><button class="button button-secondary" id="employee-prev" ${list.page <= 1 ? 'disabled' : ''}>Previous</button><span>Page ${list.page} of ${Math.max(1, Math.ceil(list.total / list.pageSize))}</span><button class="button button-secondary" id="employee-next" ${list.page * list.pageSize >= list.total ? 'disabled' : ''}>Next</button></div>
    </section>
    <p class="form-help">Employee, attendance, leave, and payroll administration is restricted to the business owner. Identity numbers and bank details are intentionally not collected. Payslip access is limited to finalised runs and individually invited employees; configured payroll figures remain estimates.</p>
    ${compensationForm()}`;

  const form = document.getElementById('employee-form');
  content.querySelectorAll('.employee-portal-invite').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        const { invitation } = await api(`/api/employees/${button.dataset.id}/portal-invitation`, {
          method: 'POST',
        });
        const url = new URL('/employee-portal', window.location.origin);
        url.searchParams.set('token', invitation.invitationToken);
        const message = `Share this one-time link securely. It expires in seven days:\n\n${url.href}`;
        try {
          await navigator.clipboard.writeText(url.href);
          alert('Employee portal invitation copied. Share it directly with the employee; it expires in seven days.');
        } catch {
          window.prompt(message, url.href);
        }
        await renderEmployees(content);
      } catch (error) {
        alert(error.message);
      }
    });
  });
  content.querySelectorAll('.employee-portal-revoke').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!confirm('Revoke this employee’s portal access? Their current sign-in will no longer show payslips.')) return;
      try {
        await api(`/api/employees/${button.dataset.id}/portal-access`, { method: 'DELETE' });
        await renderEmployees(content);
      } catch (error) {
        alert(error.message);
      }
    });
  });
  document.getElementById('employee-add').addEventListener('click', () => {
    form.reset();
    form.elements.employeeId.value = '';
    document.getElementById('employee-form-title').textContent = 'Add employee';
    document.getElementById('employee-initial-compensation').classList.remove('hidden');
    form.classList.remove('hidden');
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    form.elements.employeeNumber.focus();
  });
  document.getElementById('employee-cancel').addEventListener('click', () => form.classList.add('hidden'));
  document.getElementById('employee-filters').addEventListener('submit', (event) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    employeeSearch = String(values.get('search') || '').trim();
    employeeStatus = String(values.get('status') || '');
    employeePage = 1;
    renderEmployees(content);
  });
  document.getElementById('employee-prev').addEventListener('click', () => {
    employeePage = Math.max(1, employeePage - 1);
    renderEmployees(content);
  });
  document.getElementById('employee-next').addEventListener('click', () => {
    employeePage += 1;
    renderEmployees(content);
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form).entries());
    const employeeId = values.employeeId;
    const payload = {
      employeeNumber: values.employeeNumber,
      firstName: values.firstName,
      lastName: values.lastName,
      email: values.email || null,
      phone: values.phone || null,
      jobTitle: values.jobTitle,
      department: values.department || null,
      employmentType: values.employmentType,
      employmentStatus: values.employmentStatus,
      employmentStartDate: values.employmentStartDate,
      employmentEndDate: values.employmentEndDate || null,
      contractType: values.contractType || null,
      workLocation: values.workLocation || null,
      residentialAddress: values.residentialAddress || null,
      emergencyContactName: values.emergencyContactName || null,
      emergencyContactPhone: values.emergencyContactPhone || null,
    };
    const feedback = document.getElementById('employee-form-feedback');
    try {
      if (employeeId) {
        await api(`/api/employees/${employeeId}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        const baseRateCents = Math.round(Number(values.baseRate) * 100);
        const hoursPerWeekMillis = values.hoursPerWeek
          ? Math.round(Number(values.hoursPerWeek) * 1000)
          : null;
        await api('/api/employees', {
          method: 'POST',
          body: JSON.stringify({
            ...payload,
            payStructure: values.payStructure,
            payFrequency: values.payFrequency,
            baseRateCents,
            hoursPerWeekMillis,
            currency,
            effectiveFrom: values.effectiveFrom,
          }),
        });
      }
      await renderEmployees(content);
    } catch (error) {
      feedback.textContent = error.message;
      feedback.className = 'form-help error';
    }
  });
  content.querySelectorAll('.employee-edit').forEach((button) => button.addEventListener('click', async () => {
    try {
      const { employee } = await api(`/api/employees/${button.dataset.id}`);
      form.reset();
      form.elements.employeeId.value = employee.id;
      document.getElementById('employee-form-title').textContent = `Edit ${employee.first_name} ${employee.last_name}`;
      document.getElementById('employee-initial-compensation').classList.add('hidden');
      const fields = {
        employeeNumber: 'employee_number',
        firstName: 'first_name',
        lastName: 'last_name',
        email: 'email',
        phone: 'phone',
        jobTitle: 'job_title',
        department: 'department',
        employmentType: 'employment_type',
        employmentStatus: 'employment_status',
        employmentStartDate: 'employment_start_date',
        employmentEndDate: 'employment_end_date',
        contractType: 'contract_type',
        workLocation: 'work_location',
        residentialAddress: 'residential_address',
        emergencyContactName: 'emergency_contact_name',
        emergencyContactPhone: 'emergency_contact_phone',
      };
      for (const [field, key] of Object.entries(fields)) {
        form.elements[field].value = employee[key] || '';
      }
      form.classList.remove('hidden');
      form.scrollIntoView({ behavior: 'smooth', block: 'center' });
      form.elements.firstName.focus();
    } catch (error) {
      alert(error.message);
    }
  }));
  const compensationDialog = document.getElementById('employee-compensation-dialog');
  content.querySelectorAll('.employee-compensation').forEach((button) => button.addEventListener('click', () => {
    compensationDialog.dataset.employeeId = button.dataset.id;
    compensationDialog.showModal();
  }));
  document.getElementById('employee-compensation-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      await api(`/api/employees/${compensationDialog.dataset.employeeId}/compensation`, {
        method: 'POST',
        body: JSON.stringify({
          payStructure: values.payStructure,
          payFrequency: values.payFrequency,
          baseRateCents: Math.round(Number(values.baseRate) * 100),
          hoursPerWeekMillis: values.hoursPerWeek ? Math.round(Number(values.hoursPerWeek) * 1000) : null,
          currency,
          effectiveFrom: values.effectiveFrom,
        }),
      });
      compensationDialog.close();
      await renderEmployees(content);
    } catch (error) {
      alert(error.message);
    }
  });
}

async function renderAttendance(content) {
  const [employeeResult, attendanceResult] = await Promise.all([
    api('/api/employees?status=active&page=1&pageSize=100'),
    api('/api/attendance?page=1&pageSize=50'),
  ]);
  const employees = employeeResult.employees || [];
  const records = attendanceResult.records || [];
  const employeeOptions = employees.map((employee) =>
    `<option value="${employee.id}">${escapeHtml(employee.employee_number)} · ${escapeHtml(employee.first_name)} ${escapeHtml(employee.last_name)}</option>`
  ).join('');
  const minutes = (value) => `${(Number(value || 0) / 60).toFixed(2)} h`;
  const statusLabel = (value) => escapeHtml(String(value || '').replace('_', ' '));

  content.innerHTML = `
    <section class="page-heading"><div><span class="eyebrow">FINANCE & PEOPLE</span><h1>Attendance</h1><p>Submit time records, review them, and preserve a reasoned correction history.</p></div></section>
    <section class="panel form-panel"><h2>Submit attendance</h2>
      ${employees.length ? `<form id="attendance-form" class="record-form">
        <label>Employee<select name="employeeId" required>${employeeOptions}</select></label>
        <label>Work date<input name="workDate" type="date" value="${new Date().toISOString().slice(0, 10)}" required /></label>
        <label>Ordinary hours<input name="ordinaryHours" type="number" min="0" max="24" step="0.01" value="0" required /></label>
        <label>Overtime hours<input name="overtimeHours" type="number" min="0" max="24" step="0.01" value="0" required /></label>
        <label>Sunday hours<input name="sundayHours" type="number" min="0" max="24" step="0.01" value="0" required /></label>
        <label>Public-holiday hours<input name="publicHolidayHours" type="number" min="0" max="24" step="0.01" value="0" required /></label>
        <label>Break hours<input name="breakHours" type="number" min="0" max="24" step="0.01" value="0" required /></label>
        <label>Absence hours<input name="absenceHours" type="number" min="0" max="24" step="0.01" value="0" required /></label>
        <label class="span-two">Notes<textarea name="notes" maxlength="1000" rows="2"></textarea></label>
        <button class="button button-primary" type="submit">Submit for review</button>
        <span class="inline-feedback" id="attendance-feedback" role="status"></span>
      </form>` : '<div class="table-empty"><strong>No active employees</strong><span>Add an active employee before submitting attendance.</span></div>'}
    </section>
    <section class="panel list-panel">
      <div class="panel-heading"><div><h2>Recent attendance</h2><p>${attendanceResult.total || 0} matching record(s) · hours are converted to minutes for storage</p></div></div>
      ${records.length ? `<div class="table-scroll"><table><thead><tr><th>Date / employee</th><th>Ordinary</th><th>Overtime</th><th>Sunday</th><th>Public holiday</th><th>Break / absence</th><th>Status / actions</th></tr></thead><tbody>${records.map((record) => `
        <tr>
          <td><strong>${escapeHtml(String(record.work_date).slice(0, 10))}</strong><small>${escapeHtml(record.first_name)} ${escapeHtml(record.last_name)} · ${escapeHtml(record.employee_number)}</small></td>
          <td>${minutes(record.ordinary_minutes)}</td><td>${minutes(record.overtime_minutes)}</td><td>${minutes(record.sunday_minutes)}</td><td>${minutes(record.public_holiday_minutes)}</td>
          <td>${minutes(record.break_minutes)} break<small>${minutes(record.absence_minutes)} absent</small></td>
          <td><span class="status-pill status-${record.status === 'approved' ? 'completed' : record.status === 'rejected' ? 'cancelled' : 'pending'}">${statusLabel(record.status)}</span>
            ${record.status === 'submitted' ? `<details class="workflow-details"><summary>Review</summary><form class="attendance-review-form" data-id="${record.id}">
              <label>Review note<textarea name="comment" maxlength="1000" rows="2" placeholder="Required when rejecting"></textarea></label>
              <div class="workflow-actions"><button class="button button-primary" type="button" data-decision="approved">Approve</button><button class="button button-secondary" type="button" data-decision="rejected">Reject</button></div>
              <span class="inline-feedback" role="status"></span>
            </form></details>` : ''}
            ${record.status !== 'approved' ? `<details class="workflow-details"><summary>Correct record</summary><form class="attendance-adjustment-form" data-id="${record.id}">
              <label>Field<select name="fieldName"><option value="ordinary_minutes">Ordinary hours</option><option value="overtime_minutes">Overtime hours</option><option value="sunday_minutes">Sunday hours</option><option value="public_holiday_minutes">Public-holiday hours</option><option value="break_minutes">Break hours</option><option value="absence_minutes">Absence hours</option></select></label>
              <label>Corrected hours<input name="hours" type="number" min="0" max="24" step="0.01" required /></label>
              <label>Reason<input name="reason" maxlength="1000" required /></label><button class="button button-secondary" type="submit">Save correction</button>
              <span class="inline-feedback" role="status"></span>
            </form></details>` : ''}
          </td>
        </tr>`).join('')}</tbody></table></div>` : '<div class="table-empty"><strong>No attendance records yet</strong><span>Submitted records will appear here for owner review.</span></div>'}
    </section>
    <p class="form-help">Attendance management is restricted to the business owner. Approved records are immutable; use an audited correction before approval. This module does not calculate wages or statutory overtime.</p>`;

  document.getElementById('attendance-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    const toMinutes = (hours) => Math.round(Number(hours || 0) * 60);
    try {
      await api('/api/attendance', {
        method: 'POST',
        body: JSON.stringify({
          employeeId: Number(values.employeeId),
          workDate: values.workDate,
          ordinaryMinutes: toMinutes(values.ordinaryHours),
          overtimeMinutes: toMinutes(values.overtimeHours),
          sundayMinutes: toMinutes(values.sundayHours),
          publicHolidayMinutes: toMinutes(values.publicHolidayHours),
          breakMinutes: toMinutes(values.breakHours),
          absenceMinutes: toMinutes(values.absenceHours),
          notes: values.notes,
          idempotencyKey: `attendance-${crypto.randomUUID()}`,
        }),
      });
      await renderAttendance(content);
    } catch (error) {
      showInlineError(form, error.message);
    }
  });
  content.querySelectorAll('.attendance-review-form button[data-decision]').forEach((button) => {
    button.addEventListener('click', async () => {
      const form = button.closest('form');
      const comment = new FormData(form).get('comment');
      const feedback = form.querySelector('.inline-feedback');
      if (button.dataset.decision === 'rejected' && !String(comment || '').trim()) {
        feedback.textContent = 'Add a review note before rejecting this record.';
        feedback.className = 'inline-feedback error';
        return;
      }
      try {
        await api(`/api/attendance/${form.dataset.id}/review`, {
          method: 'POST',
          body: JSON.stringify({ decision: button.dataset.decision, comment }),
        });
        await renderAttendance(content);
      } catch (error) {
        feedback.textContent = error.message;
        feedback.className = 'inline-feedback error';
      }
    });
  });
  content.querySelectorAll('.attendance-adjustment-form').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(form).entries());
      try {
        await api(`/api/attendance/${form.dataset.id}/adjustments`, {
          method: 'POST',
          body: JSON.stringify({
            fieldName: values.fieldName,
            adjustedMinutes: Math.round(Number(values.hours) * 60),
            reason: values.reason,
          }),
        });
        await renderAttendance(content);
      } catch (error) {
        showInlineError(form, error.message);
      }
    });
  });
}

async function renderLeave(content) {
  const [employeeResult, typeResult, requestResult] = await Promise.all([
    api('/api/employees?status=active&page=1&pageSize=100'),
    api('/api/leave-types'),
    api('/api/leave-requests'),
  ]);
  const employees = employeeResult.employees || [];
  const leaveTypes = typeResult.leaveTypes || [];
  const requests = requestResult.leaveRequests || [];
  const selectedEmployee = employees.find((employee) => String(employee.id) === String(leaveEmployeeId)) || employees[0];
  if (selectedEmployee) leaveEmployeeId = String(selectedEmployee.id);
  const balances = selectedEmployee
    ? (await api(`/api/employees/${selectedEmployee.id}/leave-balances`)).balances
    : [];
  const employeeOptions = employees.map((employee) =>
    `<option value="${employee.id}" ${selectedEmployee && String(employee.id) === String(selectedEmployee.id) ? 'selected' : ''}>${escapeHtml(employee.employee_number)} · ${escapeHtml(employee.first_name)} ${escapeHtml(employee.last_name)}</option>`
  ).join('');
  const typeOptions = leaveTypes.filter((type) => Boolean(Number(type.is_active))).map((type) =>
    `<option value="${type.id}">${escapeHtml(type.name)} (${escapeHtml(type.unit)})</option>`
  ).join('');
  const amount = (millis) => (Number(millis || 0) / 1000).toFixed(3).replace(/\.?0+$/, '');
  const statusLabel = (value) => escapeHtml(String(value || '').replace('_', ' '));

  content.innerHTML = `
    <section class="page-heading"><div><span class="eyebrow">FINANCE & PEOPLE</span><h1>Leave management</h1><p>Configure leave categories, record balances, and review employee requests.</p></div></section>
    <section class="panel list-panel"><div class="panel-heading"><div><h2>Leave types</h2><p>Business-configured categories and balance rules</p></div></div>
      ${leaveTypes.length ? `<div class="table-scroll"><table><thead><tr><th>Type</th><th>Unit</th><th>Paid</th><th>Balance required</th><th>Override allowed</th><th>Status</th></tr></thead><tbody>${leaveTypes.map((type) => `<tr><td><strong>${escapeHtml(type.name)}</strong><small>${escapeHtml(type.code)}</small></td><td>${escapeHtml(type.unit)}</td><td>${Number(type.is_paid) ? 'Yes' : 'No'}</td><td>${Number(type.requires_balance) ? 'Yes' : 'No'}</td><td>${Number(type.allow_balance_override) ? 'Yes' : 'No'}</td><td><button class="text-link leave-type-toggle" data-id="${type.id}" data-active="${Number(type.is_active)}" type="button">${Number(type.is_active) ? 'Deactivate' : 'Activate'}</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="table-empty"><strong>No leave types configured</strong><span>Add the categories your business uses.</span></div>'}
      <form id="leave-type-form" class="record-form workflow-form">
        <label>Code<input name="code" maxlength="40" required /></label><label>Name<input name="name" maxlength="100" required /></label>
        <label>Unit<select name="unit"><option value="days">Days</option><option value="hours">Hours</option></select></label>
        <label>Paid<select name="isPaid"><option value="true">Paid</option><option value="false">Unpaid</option></select></label>
        <label>Require balance<select name="requiresBalance"><option value="true">Yes</option><option value="false">No</option></select></label>
        <label>Allow override<select name="allowBalanceOverride"><option value="false">No</option><option value="true">Yes, with a reason</option></select></label>
        <button class="button button-primary" type="submit">Add leave type</button><span class="inline-feedback" id="leave-type-feedback" role="status"></span>
      </form>
    </section>
    <section class="panel list-panel"><div class="panel-heading workflow-panel-heading"><div><h2>Balances</h2><p>Ledger values are stored in thousandths of the selected unit.</p></div>
      ${employees.length ? `<label class="workflow-employee-select">Employee<select id="leave-employee-select">${employeeOptions}</select></label>` : ''}
    </div>
    ${balances.length ? `<div class="table-scroll"><table><thead><tr><th>Leave type</th><th>Unit</th><th>Balance</th><th>Balance required</th></tr></thead><tbody>${balances.map((balance) => `<tr><td>${escapeHtml(balance.name)}</td><td>${escapeHtml(balance.unit)}</td><td><strong>${amount(balance.balance_millis)}</strong></td><td>${Number(balance.requires_balance) ? 'Yes' : 'No'}</td></tr>`).join('')}</tbody></table></div>` : '<div class="table-empty"><strong>No balances to display</strong><span>Choose an employee and configure leave types first.</span></div>'}
    ${employees.length && leaveTypes.length ? `<form id="leave-balance-form" class="record-form workflow-form">
      <label>Leave type<select name="leaveTypeId" required>${typeOptions}</select></label>
      <label>Entry type<select name="sourceType"><option value="opening_balance">Opening balance</option><option value="accrual">Accrual</option><option value="adjustment">Adjustment</option><option value="reversal">Reversal</option></select></label>
      <label>Units (decimals allowed)<input name="units" type="number" step="0.001" required /></label>
      <label>Reason<input name="reason" maxlength="1000" required /></label>
      <button class="button button-secondary" type="submit">Add ledger entry</button><span class="inline-feedback" role="status"></span>
    </form>` : ''}</section>
    <section class="panel form-panel"><h2>Record leave request</h2>
      ${employees.length && typeOptions ? `<form id="leave-request-form" class="record-form workflow-form">
        <label>Employee<select name="employeeId" required>${employeeOptions}</select></label><label>Leave type<select name="leaveTypeId" required>${typeOptions}</select></label>
        <label>Start date<input name="startDate" type="date" required /></label><label>End date<input name="endDate" type="date" required /></label>
        <label>Requested units<input name="units" type="number" min="0.001" max="366" step="0.001" required /></label>
        <label class="span-two">Comment<textarea name="comment" maxlength="1000" rows="2"></textarea></label>
        <button class="button button-primary" type="submit">Create request</button><span class="inline-feedback" role="status"></span>
      </form>` : '<div class="table-empty"><strong>Setup needed</strong><span>Add an active employee and leave type to record a request.</span></div>'}
    </section>
    <section class="panel list-panel"><div class="panel-heading"><div><h2>Leave requests</h2><p>${requests.length} request(s) · pending requests are listed first</p></div></div>
      ${requests.length ? `<div class="table-scroll"><table><thead><tr><th>Employee / type</th><th>Dates</th><th>Units</th><th>Status / review</th></tr></thead><tbody>${requests.map((request) => `<tr>
        <td><strong>${escapeHtml(request.first_name)} ${escapeHtml(request.last_name)}</strong><small>${escapeHtml(request.leave_type_name)} · ${escapeHtml(request.employee_number)}</small></td>
        <td>${escapeHtml(String(request.start_date).slice(0, 10))} – ${escapeHtml(String(request.end_date).slice(0, 10))}</td><td>${amount(request.requested_units_millis)}</td>
        <td><span class="status-pill status-${request.status === 'approved' ? 'completed' : request.status === 'rejected' ? 'cancelled' : 'pending'}">${statusLabel(request.status)}</span>
          ${request.status === 'pending' ? `<details class="workflow-details"><summary>Review</summary><form class="leave-review-form" data-id="${request.id}">
            <label>Review comment<textarea name="comment" maxlength="1000" rows="2" placeholder="Required when rejecting"></textarea></label>
            <label>Balance override reason (if needed)<input name="overrideReason" maxlength="1000" /></label>
            <div class="workflow-actions"><button class="button button-primary" type="button" data-decision="approved">Approve</button><button class="button button-secondary" type="button" data-decision="rejected">Reject</button></div>
            <span class="inline-feedback" role="status"></span>
          </form></details>` : ''}
        </td></tr>`).join('')}</tbody></table></div>` : '<div class="table-empty"><strong>No leave requests</strong><span>New requests will appear here for review.</span></div>'}
    </section>
    <p class="form-help">Leave tools are restricted to the business owner. Opening balances and adjustments require an explanation; the immutable ledger preserves every entry. This is not a payroll accrual or statutory leave calculation.</p>`;

  document.getElementById('leave-employee-select')?.addEventListener('change', (event) => {
    leaveEmployeeId = event.currentTarget.value;
    renderLeave(content);
  });
  document.getElementById('leave-type-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    try {
      await api('/api/leave-types', {
        method: 'POST',
        body: JSON.stringify({
          ...values,
          requiresBalance: values.requiresBalance === 'true',
          isPaid: values.isPaid === 'true',
          allowBalanceOverride: values.allowBalanceOverride === 'true',
        }),
      });
      await renderLeave(content);
    } catch (error) {
      showInlineError(form, error.message);
    }
  });
  content.querySelectorAll('.leave-type-toggle').forEach((button) => button.addEventListener('click', async () => {
    try {
      await api(`/api/leave-types/${button.dataset.id}/status`, {
        method: 'PUT',
        body: JSON.stringify({ isActive: button.dataset.active !== '1' }),
      });
      await renderLeave(content);
    } catch (error) {
      alert(error.message);
    }
  }));
  document.getElementById('leave-balance-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    try {
      await api('/api/leave-balances', {
        method: 'POST',
        body: JSON.stringify({
          employeeId: Number(selectedEmployee.id),
          leaveTypeId: Number(values.leaveTypeId),
          sourceType: values.sourceType,
          unitsMillis: Math.round(Number(values.units) * 1000),
          idempotencyKey: `leave-balance-${crypto.randomUUID()}`,
          reason: values.reason,
        }),
      });
      await renderLeave(content);
    } catch (error) {
      showInlineError(form, error.message);
    }
  });
  document.getElementById('leave-request-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    try {
      await api('/api/leave-requests', {
        method: 'POST',
        body: JSON.stringify({
          employeeId: Number(values.employeeId),
          leaveTypeId: Number(values.leaveTypeId),
          startDate: values.startDate,
          endDate: values.endDate,
          requestedUnitsMillis: Math.round(Number(values.units) * 1000),
          comment: values.comment,
        }),
      });
      await renderLeave(content);
    } catch (error) {
      showInlineError(form, error.message);
    }
  });
  content.querySelectorAll('.leave-review-form button[data-decision]').forEach((button) => {
    button.addEventListener('click', async () => {
      const form = button.closest('form');
      const values = Object.fromEntries(new FormData(form).entries());
      const feedback = form.querySelector('.inline-feedback');
      if (button.dataset.decision === 'rejected' && !values.comment.trim()) {
        feedback.textContent = 'Add a review comment before rejecting this request.';
        feedback.className = 'inline-feedback error';
        return;
      }
      try {
        await api(`/api/leave-requests/${form.dataset.id}/review`, {
          method: 'POST',
          body: JSON.stringify({ ...values, decision: button.dataset.decision }),
        });
        await renderLeave(content);
      } catch (error) {
        feedback.textContent = error.message;
        feedback.className = 'inline-feedback error';
      }
    });
  });
}

async function renderPayrollRules(content) {
  const { ruleSets } = await api('/api/payroll/rules');
  const bandsMarkup = (bands) => bands.map((band) =>
    `<li>${money(band.lower_cents, 'ZAR')} – ${band.upper_cents === null ? 'unbounded' : money(band.upper_cents, 'ZAR')} at ${(Number(band.rate_bps) / 100).toFixed(2)}% · base tax ${money(band.base_tax_cents, 'ZAR')}</li>`
  ).join('');
  const bandRow = () => `<div class="payroll-band-row"><label>Upper annual income threshold (ZAR)<input name="upperAmount" type="number" min="0.01" step="0.01" placeholder="Leave blank for the top band" /></label><label>Marginal rate (%)<input name="ratePercent" type="number" min="0" max="100" step="0.01" required /></label><button class="text-link payroll-remove-band" type="button" aria-label="Remove PAYE band">Remove</button></div>`;

  content.innerHTML = `
    <section class="page-heading"><div><span class="eyebrow">FINANCE & PEOPLE</span><h1>Payroll statutory rules</h1><p>Maintain reviewed, effective-dated PAYE, UIF, and SDL parameters for a ZAR business.</p></div></section>
    <div class="report-caveats"><strong>Rates are never preloaded.</strong> Enter values from current official guidance and have them reviewed by a qualified payroll professional. This configuration screen does not calculate payroll or submit data to SARS.</div>
    <section class="panel form-panel"><h2>Add an effective-dated rule set</h2>
      <form id="payroll-rule-form" class="record-form workflow-form">
        <label>Schedule label<input name="label" maxlength="100" required placeholder="e.g. Approved 20XX tax-year schedule" /></label>
        <label>Effective from<input name="effectiveFrom" type="date" required /></label>
        <label>Effective to (optional)<input name="effectiveTo" type="date" /></label>
        <label>Annual rebate (ZAR)<input name="annualRebate" type="number" min="0" step="0.01" required /></label>
        <label>Employee UIF rate (%)<input name="uifEmployeeRate" type="number" min="0" max="100" step="0.01" required /></label>
        <label>Employer UIF rate (%)<input name="uifEmployerRate" type="number" min="0" max="100" step="0.01" required /></label>
        <label>Monthly UIF earnings cap (ZAR)<input name="uifMonthlyCap" type="number" min="0.01" step="0.01" required /></label>
        <label>SDL rate (%)<input name="sdlRate" type="number" min="0" max="100" step="0.01" required /></label>
        <label>Annual SDL threshold (ZAR)<input name="sdlAnnualThreshold" type="number" min="0" step="0.01" required /></label>
        <fieldset class="span-two payroll-bands">
          <legend>Annual PAYE tax bands</legend>
          <p class="form-help">Add bands in order. Each upper threshold becomes the next lower threshold; leave only the final upper threshold blank. Base tax is derived.</p>
          <div class="payroll-band-list" id="payroll-band-list">${bandRow()}</div>
          <button class="button button-secondary" type="button" id="payroll-add-band">Add tax band</button>
        </fieldset>
        <button class="button button-primary" type="submit">Save rule set</button>
        <span class="inline-feedback" role="status"></span>
      </form>
    </section>
    <section class="panel list-panel"><div class="panel-heading"><div><h2>Saved rule sets</h2><p>${ruleSets.length} version(s) · immutable once created</p></div></div>
      ${ruleSets.length ? `<div class="payroll-rule-list">${ruleSets.map((ruleSet) => `<details class="payroll-rule-card"><summary><strong>${escapeHtml(ruleSet.label)}</strong><span>${escapeHtml(String(ruleSet.effective_from).slice(0, 10))} – ${ruleSet.effective_to ? escapeHtml(String(ruleSet.effective_to).slice(0, 10)) : 'open-ended'}</span></summary>
        <div class="table-scroll"><table><tbody><tr><th>Annual rebate</th><td>${money(ruleSet.annual_rebate_cents, 'ZAR')}</td><th>Employee UIF</th><td>${(Number(ruleSet.uif_employee_rate_bps) / 100).toFixed(2)}%</td></tr>
        <tr><th>Employer UIF</th><td>${(Number(ruleSet.uif_employer_rate_bps) / 100).toFixed(2)}%</td><th>Monthly UIF cap</th><td>${money(ruleSet.uif_monthly_cap_cents, 'ZAR')}</td></tr>
        <tr><th>SDL</th><td>${(Number(ruleSet.sdl_rate_bps) / 100).toFixed(2)}%</td><th>Annual SDL threshold</th><td>${money(ruleSet.sdl_annual_threshold_cents, 'ZAR')}</td></tr></tbody></table></div>
        <h3>PAYE bands</h3><ol>${bandsMarkup(ruleSet.paye_bands || [])}</ol></details>`).join('')}</div>` : '<div class="table-empty"><strong>No statutory rules configured</strong><span>Payroll cannot be calculated until an owner enters and verifies an effective rule set.</span></div>'}
    </section>`;

  const bandList = document.getElementById('payroll-band-list');
  document.getElementById('payroll-add-band').addEventListener('click', () => {
    const lastRow = bandList.lastElementChild;
    const previousUpper = lastRow?.querySelector('[name="upperAmount"]').value.trim();
    if (lastRow && !previousUpper) {
      showInlineError(document.getElementById('payroll-rule-form'), 'Enter the previous band upper threshold before adding another band.');
      return;
    }
    bandList.insertAdjacentHTML('beforeend', bandRow());
    bindPayrollBandRemoval();
  });
  function bindPayrollBandRemoval() {
    bandList.querySelectorAll('.payroll-remove-band').forEach((button) => {
      button.onclick = () => {
        if (bandList.children.length > 1) button.closest('.payroll-band-row').remove();
      };
    });
  }
  bindPayrollBandRemoval();
  document.getElementById('payroll-rule-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    const rows = [...bandList.querySelectorAll('.payroll-band-row')];
    let lowerCents = 0;
    const payeBands = [];
    for (const [index, row] of rows.entries()) {
      const upperInput = row.querySelector('[name="upperAmount"]').value.trim();
      const ratePercent = Number(row.querySelector('[name="ratePercent"]').value);
      const upperCents = upperInput ? Math.round(Number(upperInput) * 100) : null;
      if ((upperInput && (!Number.isFinite(Number(upperInput)) || upperCents <= lowerCents)) ||
          !Number.isFinite(ratePercent) || ratePercent < 0 || ratePercent > 100 ||
          (index < rows.length - 1 && upperCents === null) ||
          (index === rows.length - 1 && upperCents !== null)) {
        showInlineError(form, 'Check the PAYE band order, upper thresholds, and rates.');
        return;
      }
      payeBands.push({
        lowerCents,
        upperCents,
        rateBps: Math.round(ratePercent * 100),
      });
      if (upperCents !== null) lowerCents = upperCents;
    }
    const toCents = (value) => Math.round(Number(value) * 100);
    try {
      await api('/api/payroll/rules', {
        method: 'POST',
        body: JSON.stringify({
          label: values.label,
          effectiveFrom: values.effectiveFrom,
          effectiveTo: values.effectiveTo || null,
          annualRebateCents: toCents(values.annualRebate),
          uifEmployeeRateBps: Math.round(Number(values.uifEmployeeRate) * 100),
          uifEmployerRateBps: Math.round(Number(values.uifEmployerRate) * 100),
          uifMonthlyCapCents: toCents(values.uifMonthlyCap),
          sdlRateBps: Math.round(Number(values.sdlRate) * 100),
          sdlAnnualThresholdCents: toCents(values.sdlAnnualThreshold),
          payeBands,
        }),
      });
      await renderPayrollRules(content);
    } catch (error) {
      showInlineError(form, error.message);
    }
  });
}

async function renderPayrollRuns(content) {
  const [employeeResult, runResult, ruleResult] = await Promise.all([
    api('/api/employees?page=1&pageSize=100'),
    api('/api/payroll/runs'),
    api('/api/payroll/rules'),
  ]);
  const employees = [...(employeeResult.employees || [])];
  for (let page = 2; employees.length < employeeResult.total; page += 1) {
    const nextPage = await api(`/api/employees?page=${page}&pageSize=100`);
    employees.push(...(nextPage.employees || []));
  }
  const runs = runResult.runs || [];
  const now = new Date();
  const defaultStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    .toISOString().slice(0, 10);
  const defaultEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))
    .toISOString().slice(0, 10);
  const dialog = '<dialog class="expense-dialog" id="payroll-run-dialog"></dialog>';
  const statusLabel = (value) => escapeHtml(String(value || '').replace('_', ' '));

  content.innerHTML = `
    <section class="page-heading"><div><span class="eyebrow">FINANCE & PEOPLE</span><h1>Payroll runs</h1><p>Create a monthly draft using owner-entered gross pay and reviewed statutory rules.</p></div></section>
    <div class="report-caveats"><strong>Payroll estimate only.</strong> Approved attendance is not automatically converted to wages. Review every gross-pay input and calculated deduction. Payment records are manual tracking only and do not initiate bank transfers or statutory submissions.</div>
    <section class="panel form-panel"><h2>Create a monthly draft</h2>
      ${ruleResult.ruleSets.length ? `<form id="payroll-run-form" class="record-form workflow-form">
        <label>Period start<input name="periodStart" type="date" value="${defaultStart}" required /></label>
        <label>Period end<input name="periodEnd" type="date" value="${defaultEnd}" required /></label>
        <label>Pay date<input name="payDate" type="date" value="${defaultEnd}" required /></label>
        <div class="span-two table-scroll"><table><thead><tr><th>Employee</th><th>Current base-pay record</th><th>Gross pay (ZAR)</th><th>Other deductions (ZAR)</th></tr></thead><tbody id="payroll-run-lines"></tbody></table></div>
        <button class="button button-primary" type="submit">Calculate draft</button><span class="inline-feedback" role="status"></span>
      </form>` : '<div class="table-empty"><strong>Statutory rules required</strong><span>Configure an effective-dated rule set before creating payroll drafts.</span></div>'}
    </section>
    <section class="panel list-panel"><div class="panel-heading"><div><h2>Payroll history</h2><p>${runs.length} run(s) · newest periods first</p></div></div>
      ${runs.length ? `<div class="table-scroll"><table><thead><tr><th>Period / pay date</th><th>Status</th><th>Gross</th><th>PAYE</th><th>Employee UIF</th><th>Employer UIF / SDL</th><th>Net pay</th><th>Paid / outstanding</th><th>Actions</th></tr></thead><tbody>${runs.map((run) => `<tr>
        <td><strong>${escapeHtml(String(run.period_start).slice(0, 10))} – ${escapeHtml(String(run.period_end).slice(0, 10))}</strong><small>Pay date ${escapeHtml(String(run.pay_date).slice(0, 10))}</small></td>
        <td><span class="status-pill status-${run.status === 'finalized' ? 'completed' : run.status === 'cancelled' ? 'cancelled' : 'pending'}">${statusLabel(run.status)}</span></td>
        <td>${money(run.total_gross_cents, 'ZAR')}</td><td>${money(run.total_paye_cents, 'ZAR')}</td><td>${money(run.total_uif_employee_cents, 'ZAR')}</td>
        <td>${money(run.total_uif_employer_cents, 'ZAR')}<small>${money(run.total_sdl_cents, 'ZAR')} SDL</small></td><td>${money(run.total_net_cents, 'ZAR')}</td>
        <td>${money(run.total_paid_cents, 'ZAR')}<small>${money(run.total_outstanding_cents, 'ZAR')} outstanding</small></td>
        <td><div class="product-row-actions"><button class="text-link payroll-run-view" data-id="${run.id}" type="button">View</button>${run.status === 'draft' ? `<button class="text-link payroll-run-transition" data-id="${run.id}" data-decision="approved" type="button">Approve</button><button class="text-link payroll-run-transition" data-id="${run.id}" data-decision="cancelled" type="button">Cancel</button>` : ''}${run.status === 'approved' ? `<button class="text-link payroll-run-transition" data-id="${run.id}" data-decision="finalized" type="button">Finalize</button>` : ''}</div></td>
      </tr>`).join('')}</tbody></table></div>` : '<div class="table-empty"><strong>No payroll runs</strong><span>Drafts will appear here after you configure rules and enter gross-pay values.</span></div>'}
    </section>
    <p class="form-help">Monthly PAYE is estimated from the selected effective rule set using annualized gross pay, the configured rebate and marginal bands. UIF and SDL use the configured rates and caps/threshold. Finalised runs provide downloadable payslips; employees can access theirs after activating an invitation. Payment entries record transfers made elsewhere and do not initiate payments. Employee-specific credits, cumulative tax adjustments, and statutory submissions are not included.</p>
    ${dialog}`;

  const form = document.getElementById('payroll-run-form');
  if (!form) return;
  const linesContainer = document.getElementById('payroll-run-lines');
  function renderEligibleEmployees(periodStart, periodEnd) {
    const eligible = employees.filter((employee) =>
      employee.employment_status !== 'archived' &&
      employee.employment_start_date <= periodEnd &&
      (!employee.employment_end_date || employee.employment_end_date >= periodStart)
    );
    linesContainer.innerHTML = eligible.map((employee) => {
      const baseRate = employee.pay_structure === 'monthly_salary' && employee.base_rate_cents !== null
        ? (Number(employee.base_rate_cents) / 100).toFixed(2)
        : '';
      return `<tr><td><strong>${escapeHtml(employee.first_name)} ${escapeHtml(employee.last_name)}</strong><small>${escapeHtml(employee.employee_number)} · ${escapeHtml(employee.employment_status)}</small></td>
        <td>${employee.base_rate_cents === null ? 'No current rate' : `${money(employee.base_rate_cents, employee.compensation_currency)} · ${escapeHtml(employee.pay_structure || '')}`}</td>
        <td><input aria-label="Gross pay for ${escapeHtml(employee.first_name)} ${escapeHtml(employee.last_name)}" data-employee-id="${employee.id}" name="gross" type="number" min="0" step="0.01" value="${baseRate}" required /></td>
        <td><input aria-label="Other deductions for ${escapeHtml(employee.first_name)} ${escapeHtml(employee.last_name)}" data-employee-id="${employee.id}" name="deductions" type="number" min="0" step="0.01" value="0" required /></td></tr>`;
    }).join('') || '<tr><td colspan="4">No employees are eligible for this period.</td></tr>';
  }
  renderEligibleEmployees(defaultStart, defaultEnd);
  form.elements.periodStart.addEventListener('change', () =>
    renderEligibleEmployees(form.elements.periodStart.value, form.elements.periodEnd.value));
  form.elements.periodEnd.addEventListener('change', () =>
    renderEligibleEmployees(form.elements.periodStart.value, form.elements.periodEnd.value));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form).entries());
    const grossInputs = [...linesContainer.querySelectorAll('input[name="gross"]')];
    const deductionInputs = [...linesContainer.querySelectorAll('input[name="deductions"]')];
    try {
      await api('/api/payroll/runs', {
        method: 'POST',
        body: JSON.stringify({
          periodStart: values.periodStart,
          periodEnd: values.periodEnd,
          payDate: values.payDate,
          lines: grossInputs.map((input, index) => ({
            employeeId: Number(input.dataset.employeeId),
            grossCents: Math.round(Number(input.value) * 100),
            otherDeductionsCents: Math.round(Number(deductionInputs[index].value) * 100),
          })),
        }),
      });
      await renderPayrollRuns(content);
    } catch (error) {
      showInlineError(form, error.message);
    }
  });
  content.querySelectorAll('.payroll-run-transition').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await api(`/api/payroll/runs/${button.dataset.id}/transition`, {
          method: 'POST',
          body: JSON.stringify({ decision: button.dataset.decision }),
        });
        await renderPayrollRuns(content);
      } catch (error) {
        alert(error.message);
      }
    });
  });
  async function showPayrollRun(runId) {
    const [{ run }, { payments }] = await Promise.all([
      api(`/api/payroll/runs/${runId}`),
      api(`/api/payroll/runs/${runId}/payments`),
    ]);
    const detailDialog = document.getElementById('payroll-run-dialog');
    const canPay = run.status === 'finalized';
    const today = new Date().toISOString().slice(0, 10);
    detailDialog.innerHTML = `<form method="dialog" class="dialog-close"><button class="icon-button" aria-label="Close">×</button></form>
      <h2>Payroll ${escapeHtml(String(run.period_start).slice(0, 10))}</h2><p class="form-help">${escapeHtml(run.status)} · rule set #${run.rule_set_id}</p>
      <div class="table-scroll"><table><thead><tr><th>Employee</th><th>Gross</th><th>PAYE</th><th>UIF</th><th>Other deductions</th><th>Net</th><th>Paid / outstanding</th><th>Documents / payment</th></tr></thead><tbody>${run.lines.map((line) => `<tr>
        <td>${escapeHtml(line.first_name)} ${escapeHtml(line.last_name)}<small>${escapeHtml(line.employee_number)}</small></td>
        <td>${money(line.gross_cents, 'ZAR')}</td><td>${money(line.paye_cents, 'ZAR')}</td>
        <td>${money(line.uif_employee_cents, 'ZAR')}</td><td>${money(line.other_deductions_cents, 'ZAR')}</td>
        <td>${money(line.net_cents, 'ZAR')}</td>
        <td>${money(line.paid_cents, 'ZAR')}<small>${money(line.outstanding_cents, 'ZAR')} remaining</small></td>
        <td>${canPay ? `<button class="text-link payroll-payslip" data-employee-id="${line.employee_id}" type="button">Payslip</button>${line.outstanding_cents > 0 ? `<button class="text-link payroll-line-payment" data-employee-id="${line.employee_id}" data-outstanding="${line.outstanding_cents}" type="button">Record payment</button>` : '<span class="status-pill status-completed">Paid</span>'}` : 'Available after finalisation'}</td>
      </tr>`).join('')}</tbody></table></div>
      <p class="form-help">Employer UIF: ${money(run.total_uif_employer_cents, 'ZAR')} · SDL: ${money(run.total_sdl_cents, 'ZAR')} · Payment records do not initiate transfers.</p>
      <form id="payroll-payment-form" class="record-form workflow-form hidden">
        <h3>Record an external payment</h3><input name="employeeId" type="hidden" />
        <label>Amount (ZAR)<input name="amount" type="number" min="0.01" step="0.01" required /></label>
        <label>Paid date<input name="paidAt" type="date" value="${today}" required /></label>
        <label>Method<select name="paymentMethod" required><option value="bank_transfer">Bank transfer</option><option value="cash">Cash</option><option value="cheque">Cheque</option><option value="other">Other</option></select></label>
        <label>Payment reference (optional)<input name="paymentReference" maxlength="100" /></label>
        <button class="button button-primary" type="submit">Save payment record</button><span class="inline-feedback" role="status"></span>
      </form>
      <section class="panel activity-panel"><h3>Payment history</h3>${payments.length ? `<div class="table-scroll"><table><thead><tr><th>Employee</th><th>Date</th><th>Amount</th><th>Method</th><th>Reference</th></tr></thead><tbody>${payments.map((payment) => `<tr><td>${escapeHtml(payment.first_name)} ${escapeHtml(payment.last_name)}<small>${escapeHtml(payment.employee_number)}</small></td><td>${escapeHtml(payment.paid_at)}</td><td>${money(payment.amount_cents, 'ZAR')}</td><td>${escapeHtml(payment.payment_method.replace('_', ' '))}</td><td>${escapeHtml(payment.payment_reference || '—')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="form-help">No payment records. Add a record after an external payment is made.</p>'}</section>`;
    if (!detailDialog.open) detailDialog.showModal();

    detailDialog.querySelectorAll('.payroll-payslip').forEach((payslipButton) => {
      payslipButton.addEventListener('click', async () => {
        try {
          await downloadAuthenticatedFile(
            `/api/payroll/runs/${run.id}/employees/${payslipButton.dataset.employeeId}/payslip.pdf`,
            `payslip-${run.id}-${payslipButton.dataset.employeeId}.pdf`
          );
        } catch (error) {
          alert(error.message);
        }
      });
    });
    const paymentForm = detailDialog.querySelector('#payroll-payment-form');
    detailDialog.querySelectorAll('.payroll-line-payment').forEach((paymentButton) => {
      paymentButton.addEventListener('click', () => {
        paymentForm.elements.employeeId.value = paymentButton.dataset.employeeId;
        paymentForm.elements.amount.value = (Number(paymentButton.dataset.outstanding) / 100).toFixed(2);
        paymentForm.classList.remove('hidden');
        paymentForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
        paymentForm.elements.amount.focus();
      });
    });
    paymentForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(paymentForm).entries());
      try {
        const idempotencyKey = window.crypto?.randomUUID?.() ||
          `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        await api(`/api/payroll/runs/${run.id}/payments`, {
          method: 'POST',
          body: JSON.stringify({
            employeeId: Number(values.employeeId),
            amountCents: Math.round(Number(values.amount) * 100),
            paidAt: values.paidAt,
            paymentMethod: values.paymentMethod,
            paymentReference: values.paymentReference,
            idempotencyKey,
          }),
        });
        await renderPayrollRuns(content);
      } catch (error) {
        showInlineError(paymentForm, error.message);
      }
    });
  }

  content.querySelectorAll('.payroll-run-view').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await showPayrollRun(button.dataset.id);
      } catch (error) {
        alert(error.message);
      }
    });
  });
}

async function renderExpenses(content) {
  const query = new URLSearchParams(expenseFilters);
  query.set('page', String(expensePage));
  query.set('pageSize', '20');
  const [list, summaryResponse, categoriesResponse, suppliersResponse, recurringResponse] = await Promise.all([
    api(`/api/expenses?${query}`),
    api('/api/expenses/summary'),
    api('/api/expenses/categories'),
    api('/api/expenses/suppliers'),
    api('/api/expenses/recurring'),
  ]);
  const summary = summaryResponse.summary;
  const categories = categoriesResponse.categories;
  const suppliers = suppliersResponse.suppliers;
  const recurringExpenses = recurringResponse.recurringExpenses;
  if (!Array.isArray(list.expenses) || !summaryResponse.summary ||
      !Array.isArray(categories) || !Array.isArray(suppliers) ||
      !Array.isArray(recurringExpenses)) {
    throw new Error('The server returned incomplete expense data. Restart WorkflowOS and refresh this page.');
  }
  const currency = sessionInfo.business.currency;
  const activeCategories = categories.filter((category) => category.is_active);

  content.innerHTML = `
    <section class="page-heading"><div><span class="eyebrow">FINANCE</span><h1>Expenses</h1><p>Record business spending, track balances and keep payment history.</p></div><div class="heading-actions"><button class="button button-secondary" id="manage-expense-categories">Manage categories</button><button class="button button-primary" id="new-expense">＋ Add expense</button></div></section>
    <section class="kpi-grid expense-kpis">
      ${kpiCard('−', 'This month', money(summary.thisMonthCents, currency), `Last month ${money(summary.lastMonthCents, currency)}`, changeMetric(summary.monthChangePct, 'vs last month'), 'icon-red')}
      ${kpiCard('◎', 'Outstanding', money(summary.outstandingCents, currency), `${summary.overdueCount} overdue expense${summary.overdueCount === 1 ? '' : 's'}`, '', 'icon-amber')}
      ${kpiCard('✓', 'Paid to date', money(summary.paidCents, currency), 'Recorded expense payments', '', 'icon-green')}
      ${kpiCard('▦', 'This year', money(summary.thisYearCents, currency), `Average ${money(summary.averageMonthlyCents, currency)} per month`, '', 'icon-blue')}
      ${kpiCard('↗', 'Largest category', summary.largestCategory ? escapeHtml(summary.largestCategory.name) : '—', summary.largestCategory ? money(summary.largestCategory.amountCents, currency) : 'No expenses recorded', '', 'icon-violet')}
      ${kpiCard('↻', 'Recurring monthly', money(summary.recurringMonthlyCommitmentsCents, currency), 'Estimated active commitments', '', 'icon-teal')}
    </section>
    <section class="panel list-panel"><div class="panel-heading"><div><h2>Expense records</h2><p>${list.total} record${list.total === 1 ? '' : 's'} · totals are stored in cents</p></div></div>
      <form class="expense-filters" id="expense-filters">
        <label>Period<select name="period"><option value="">All dates</option><option value="today">Today</option><option value="week">This week</option><option value="month">This month</option><option value="last-month">Last month</option><option value="quarter">Last 3 months</option><option value="year">This year</option><option value="custom">Custom range</option></select></label>
        <label>From<input type="date" name="startDate" value="${escapeHtml(expenseFilters.get('startDate') || '')}" /></label><label>To<input type="date" name="endDate" value="${escapeHtml(expenseFilters.get('endDate') || '')}" /></label>
        <label>Status<select name="status"><option value="">All active</option><option value="unpaid" ${expenseFilters.get('status') === 'unpaid' ? 'selected' : ''}>Unpaid</option><option value="partially_paid" ${expenseFilters.get('status') === 'partially_paid' ? 'selected' : ''}>Partially paid</option><option value="paid" ${expenseFilters.get('status') === 'paid' ? 'selected' : ''}>Paid</option><option value="overdue" ${expenseFilters.get('status') === 'overdue' ? 'selected' : ''}>Overdue</option><option value="draft" ${expenseFilters.get('status') === 'draft' ? 'selected' : ''}>Draft</option></select></label>
        <label>Search<input name="search" value="${escapeHtml(expenseFilters.get('search') || '')}" placeholder="Title, supplier or reference" /></label>
        <button class="button button-secondary" type="submit">Apply filters</button>
      </form>
      <div id="expense-editor" class="expense-editor hidden"></div>
      ${list.expenses.length ? `<div class="table-scroll"><table><thead><tr><th>Expense</th><th>Date</th><th>Category</th><th>Supplier</th><th>Total</th><th>Paid</th><th>Balance</th><th>Status</th><th>Actions</th></tr></thead><tbody>${list.expenses.map((expense) => `<tr><td><strong>${escapeHtml(expense.title)}</strong><small>${escapeHtml(expense.reference_number || '')}</small></td><td>${escapeHtml(expense.expense_date)}</td><td>${escapeHtml(expense.category_name || 'Uncategorised')}</td><td>${escapeHtml(expense.supplier_name || '—')}</td><td><strong>${money(expense.total_cents, currency)}</strong></td><td>${money(expense.paid_cents, currency)}</td><td>${money(expense.outstanding_cents, currency)}</td><td><span class="status-pill status-${escapeHtml(expense.status)}">${escapeHtml(expense.status.replace('_', ' '))}</span></td><td><div class="expense-row-actions"><button class="text-link expense-details" data-id="${expense.id}">Details</button>${expense.status !== 'paid' && expense.status !== 'cancelled' && expense.status !== 'draft' ? `<button class="text-link expense-pay" data-id="${expense.id}">Record payment</button>` : ''}${expense.status !== 'paid' && expense.status !== 'cancelled' ? `<button class="text-link expense-edit" data-id="${expense.id}">Edit</button>` : ''}${expense.paid_cents === 0 && expense.status !== 'cancelled' ? `<button class="text-link expense-cancel" data-id="${expense.id}">Cancel</button>` : ''}</div></td></tr>`).join('')}</tbody></table></div>` : '<div class="table-empty"><strong>No expenses found</strong><span>Add an expense or adjust your filters.</span></div>'}
      <div class="expense-pagination"><button class="button button-secondary" id="expense-prev" ${list.page <= 1 ? 'disabled' : ''}>Previous</button><span>Page ${list.page} of ${Math.max(1, Math.ceil(list.total / list.pageSize))}</span><button class="button button-secondary" id="expense-next" ${list.page * list.pageSize >= list.total ? 'disabled' : ''}>Next</button></div>
    </section>
    <section class="dashboard-grid lower-grid">
      <article class="panel"><div class="panel-heading"><div><h2>Spending by category</h2><p>All recorded expenses, excluding drafts and cancellations</p></div></div>${summary.expensesByCategory.length ? `<div class="best-list">${summary.expensesByCategory.slice(0, 8).map((item) => `<div class="best-row"><span class="product-initial">−</span><span class="best-product"><strong>${escapeHtml(item.name)}</strong></span><strong>${money(item.amountCents, currency)}</strong></div>`).join('')}</div>` : '<div class="mini-empty">Category totals appear when expenses are recorded.</div>'}</article>
      <article class="panel"><div class="panel-heading"><div><h2>Categories & suppliers</h2><p>Both lists are private to this business</p></div></div><form id="expense-category-form" class="compact-form"><input name="name" placeholder="New category name" maxlength="100" required /><button class="button button-secondary" type="submit">Add category</button></form><form id="expense-supplier-form" class="compact-form"><input name="name" placeholder="New supplier name" maxlength="191" required /><input name="email" type="email" placeholder="Email (optional)" /><button class="button button-secondary" type="submit">Add supplier</button></form><div class="category-list">${categories.map((category) => `<div><span>${escapeHtml(category.name)}${category.is_system ? ' · default' : ''}</span>${category.is_active && !category.is_system ? `<button class="text-link category-deactivate" data-id="${category.id}">Deactivate</button>` : ''}</div>`).join('')}</div><p class="form-help">Receipt uploads are unavailable until private file storage is configured; no files are exposed publicly.</p></article>
    </section>
    <section class="panel list-panel recurring-panel"><div class="panel-heading"><div><h2>Recurring expenses</h2><p>Due occurrences are created at most once and keep their original scheduled date.</p></div><button class="button button-secondary" id="generate-recurring">Generate due expenses</button></div><div id="recurring-feedback" class="inline-feedback"></div>
      <form id="recurring-expense-form" class="record-form">
        <label>Title<input name="title" maxlength="191" required /></label>
        <label>Frequency<select name="frequency"><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="annually">Annually</option></select></label>
        <label>Category<select name="categoryId"><option value="">Uncategorised</option>${activeCategories.map((category) => `<option value="${category.id}">${escapeHtml(category.name)}</option>`).join('')}</select></label>
        <label>Supplier<select name="supplierId"><option value="">No supplier</option>${suppliers.filter((supplier) => supplier.is_active).map((supplier) => `<option value="${supplier.id}">${escapeHtml(supplier.name)}</option>`).join('')}</select></label>
        <label>Subtotal (${escapeHtml(currency)})<input name="subtotal" type="number" min="0.01" step="0.01" required /></label>
        <label>Tax (${escapeHtml(currency)})<input name="tax" type="number" min="0" step="0.01" value="0" /></label>
        <label>Starts on<input name="startsOn" type="date" value="${escapeHtml(expenseDateForPeriod('today')[0])}" required /></label>
        <label>Ends on (optional)<input name="endsOn" type="date" /></label>
        <button class="button button-secondary" type="submit">Add recurring expense</button>
      </form>
      ${recurringExpenses.length ? `<div class="table-scroll"><table><thead><tr><th>Expense</th><th>Frequency</th><th>Amount</th><th>Next due</th><th>Status</th><th>Action</th></tr></thead><tbody>${recurringExpenses.map((recurring) => `<tr><td><strong>${escapeHtml(recurring.title)}</strong><small>${escapeHtml(recurring.category_name || 'Uncategorised')}${recurring.supplier_name ? ` · ${escapeHtml(recurring.supplier_name)}` : ''}</small></td><td>${escapeHtml(recurring.frequency)}</td><td>${money(Number(recurring.subtotal_cents) + Number(recurring.tax_cents), currency)}</td><td>${escapeHtml(String(recurring.next_due_date).slice(0, 10))}</td><td><span class="status-pill status-${recurring.is_active ? 'completed' : 'cancelled'}">${recurring.is_active ? 'active' : 'paused'}</span></td><td><button class="text-link recurring-toggle" data-id="${recurring.id}" data-active="${recurring.is_active ? '1' : '0'}">${recurring.is_active ? 'Pause' : 'Resume'}</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="table-empty"><strong>No recurring schedules</strong><span>Add a schedule to record regular expenses on due dates.</span></div>'}
    </section>
    <dialog class="expense-dialog" id="expense-details-dialog"></dialog>
    <dialog class="expense-dialog" id="expense-payment-dialog"></dialog>`;

  document.getElementById('new-expense').addEventListener('click', () => openExpenseEditor());
  document.getElementById('manage-expense-categories').addEventListener('click', () => {
    document.getElementById('expense-category-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
    document.getElementById('expense-category-form').querySelector('input').focus();
  });
  document.getElementById('expense-filters').addEventListener('submit', (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    if (values.period && values.period !== 'custom') {
      [values.startDate, values.endDate] = expenseDateForPeriod(values.period);
    }
    expenseFilters = new URLSearchParams();
    for (const [key, value] of Object.entries(values)) {
      if (value && key !== 'period') expenseFilters.set(key, value);
    }
    expensePage = 1;
    renderExpenses(content);
  });
  document.getElementById('expense-prev').addEventListener('click', () => { expensePage -= 1; renderExpenses(content); });
  document.getElementById('expense-next').addEventListener('click', () => { expensePage += 1; renderExpenses(content); });

  content.querySelectorAll('.expense-edit').forEach((button) => button.addEventListener('click', async () => {
    try {
      const data = await api(`/api/expenses/${button.dataset.id}`);
      openExpenseEditor(data.expense);
    } catch (error) {
      alert(error.message);
    }
  }));
  content.querySelectorAll('.expense-cancel').forEach((button) => button.addEventListener('click', async () => {
    if (!confirm('Cancel this unpaid expense? Its record will be retained.')) return;
    try {
      await api(`/api/expenses/${button.dataset.id}`, { method: 'DELETE' });
      await renderExpenses(content);
    } catch (error) {
      alert(error.message);
    }
  }));
  content.querySelectorAll('.expense-details').forEach((button) => button.addEventListener('click', async () => {
    try {
      const data = (await api(`/api/expenses/${button.dataset.id}`)).expense;
      const dialog = document.getElementById('expense-details-dialog');
      dialog.innerHTML = `<form method="dialog" class="dialog-close"><button class="icon-button" aria-label="Close">×</button></form><h2>${escapeHtml(data.title)}</h2><p>${escapeHtml(data.description || 'No description')}</p><dl><div><dt>Category</dt><dd>${escapeHtml(data.category_name || '—')}</dd></div><div><dt>Supplier</dt><dd>${escapeHtml(data.supplier_name || '—')}</dd></div><div><dt>Reference</dt><dd>${escapeHtml(data.reference_number || '—')}</dd></div><div><dt>Date</dt><dd>${escapeHtml(data.expense_date)}</dd></div><div><dt>Total / paid / balance</dt><dd>${money(data.total_cents, currency)} / ${money(data.paid_cents, currency)} / ${money(data.outstanding_cents, currency)}</dd></div></dl><h3>Payment history</h3>${data.payments.length ? `<div class="table-scroll"><table><thead><tr><th>Date</th><th>Method</th><th>Reference</th><th>Amount</th></tr></thead><tbody>${data.payments.map((payment) => `<tr><td>${escapeHtml(String(payment.payment_date).slice(0, 10))}</td><td>${escapeHtml(payment.payment_method)}</td><td>${escapeHtml(payment.reference || '—')}</td><td>${money(payment.amount_cents, currency)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted-copy">No payments recorded.</p>'}`;
      dialog.showModal();
    } catch (error) {
      alert(error.message);
    }
  }));
  content.querySelectorAll('.expense-pay').forEach((button) => button.addEventListener('click', () => {
    const expense = list.expenses.find((item) => item.id === Number(button.dataset.id));
    openExpensePaymentDialog(expense);
  }));
  document.getElementById('expense-category-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await api('/api/expenses/categories', {
        method: 'POST',
        body: JSON.stringify({ name: new FormData(form).get('name') }),
      });
      await renderExpenses(content);
    } catch (error) {
      showInlineError(form, error.message);
    }
  });
  document.getElementById('expense-supplier-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await api('/api/expenses/suppliers', {
        method: 'POST',
        body: JSON.stringify(Object.fromEntries(new FormData(form).entries())),
      });
      await renderExpenses(content);
    } catch (error) {
      showInlineError(form, error.message);
    }
  });
  content.querySelectorAll('.category-deactivate').forEach((button) => button.addEventListener('click', async () => {
    const category = categories.find((item) => item.id === Number(button.dataset.id));
    if (!category || !confirm(`Deactivate “${category.name}”? Existing expenses will retain this category.`)) return;
    try {
      await api(`/api/expenses/categories/${category.id}`, {
        method: 'PUT',
        body: JSON.stringify({ name: category.name, isActive: false }),
      });
      await renderExpenses(content);
    } catch (error) {
      alert(error.message);
    }
  }));
  document.getElementById('recurring-expense-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    const subtotalCents = centsFromInput(values.subtotal);
    const taxCents = centsFromInput(values.tax || '');
    if (subtotalCents === null || taxCents === null) {
      showInlineError(form, 'Enter valid amounts with no more than two decimal places.');
      return;
    }
    try {
      await api('/api/expenses/recurring', {
        method: 'POST',
        body: JSON.stringify({
          ...values,
          categoryId: values.categoryId || null,
          supplierId: values.supplierId || null,
          subtotalCents,
          taxCents,
        }),
      });
      await renderExpenses(content);
      const feedback = document.getElementById('recurring-feedback');
      feedback.textContent = 'Recurring expense saved.';
      feedback.className = 'inline-feedback success';
    } catch (error) {
      showInlineError(form, error.message);
    }
  });
  document.getElementById('generate-recurring').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const result = await api('/api/expenses/recurring/generate', { method: 'POST' });
      await renderExpenses(content);
      const feedback = document.getElementById('recurring-feedback');
      feedback.textContent = `${result.createdCount} due expense${result.createdCount === 1 ? '' : 's'} generated for ${result.checkedAt}.`;
      feedback.className = 'inline-feedback success';
    } catch (error) {
      showInlineError(document.getElementById('recurring-feedback'), error.message);
      button.disabled = false;
    }
  });
  content.querySelectorAll('.recurring-toggle').forEach((button) => button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await api(`/api/expenses/recurring/${button.dataset.id}`, {
        method: 'PUT',
        body: JSON.stringify({ isActive: button.dataset.active !== '1' }),
      });
      await renderExpenses(content);
    } catch (error) {
      button.disabled = false;
      showInlineError(button.closest('td'), error.message);
    }
  }));

  function openExpenseEditor(expense = null) {
    const editor = document.getElementById('expense-editor');
    editor.classList.remove('hidden');
    editor.innerHTML = `<div class="panel-heading"><div><h2>${expense ? 'Edit expense' : 'New expense'}</h2><p>Amounts are entered in ${escapeHtml(currency)} and saved as cents.</p></div><button class="text-link" id="close-expense-editor">Close</button></div><form id="expense-form" class="record-form"><label>Title<input name="title" maxlength="191" value="${escapeHtml(expense?.title || '')}" required /></label><label>Category<select name="categoryId"><option value="">Uncategorised</option>${activeCategories.map((category) => `<option value="${category.id}" ${expense?.category_id === category.id ? 'selected' : ''}>${escapeHtml(category.name)}</option>`).join('')}</select></label><label>Supplier<select name="supplierId"><option value="">No supplier</option>${suppliers.filter((supplier) => supplier.is_active).map((supplier) => `<option value="${supplier.id}" ${expense?.supplier_id === supplier.id ? 'selected' : ''}>${escapeHtml(supplier.name)}</option>`).join('')}</select></label><label>Reference<input name="referenceNumber" maxlength="100" value="${escapeHtml(expense?.reference_number || '')}" /></label><label>Expense date<input name="expenseDate" type="date" value="${escapeHtml(expense?.expense_date || expenseDateForPeriod('today')[0])}" required /></label><label>Due date<input name="dueDate" type="date" value="${escapeHtml(expense?.due_date || '')}" /></label><label>Subtotal (${escapeHtml(currency)})<input name="subtotal" type="number" min="0.01" step="0.01" value="${expense ? (expense.subtotal_cents / 100).toFixed(2) : ''}" ${expense?.paid_cents ? 'readonly' : ''} required /></label><label>Tax (${escapeHtml(currency)})<input name="tax" type="number" min="0" step="0.01" value="${expense ? (expense.tax_cents / 100).toFixed(2) : '0.00'}" ${expense?.paid_cents ? 'readonly' : ''} /></label><label>Status<select name="status" ${expense?.paid_cents ? 'disabled' : ''}><option value="unpaid" ${expense?.status !== 'draft' ? 'selected' : ''}>Unpaid</option><option value="draft" ${expense?.status === 'draft' ? 'selected' : ''}>Draft</option></select></label><label class="span-two">Description<textarea name="description">${escapeHtml(expense?.description || '')}</textarea></label><label class="span-two">Notes<textarea name="notes">${escapeHtml(expense?.notes || '')}</textarea></label><div class="expense-form-actions"><button class="button button-primary" type="submit">${expense ? 'Save changes' : 'Save expense'}</button><button class="button button-secondary" type="button" id="cancel-expense-editor">Cancel</button></div></form>`;
    editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.getElementById('close-expense-editor').addEventListener('click', () => editor.classList.add('hidden'));
    document.getElementById('cancel-expense-editor').addEventListener('click', () => editor.classList.add('hidden'));
    document.getElementById('expense-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const values = Object.fromEntries(new FormData(form).entries());
      const subtotalCents = centsFromInput(values.subtotal);
      const taxCents = centsFromInput(values.tax || '');
      if (subtotalCents === null || taxCents === null) {
        showInlineError(form, 'Enter valid amounts with no more than two decimal places.');
        return;
      }
      const payload = {
        title: values.title,
        categoryId: values.categoryId || null,
        supplierId: values.supplierId || null,
        referenceNumber: values.referenceNumber,
        expenseDate: values.expenseDate,
        dueDate: values.dueDate || null,
        subtotalCents,
        taxCents,
        status: expense?.paid_cents ? undefined : values.status || 'unpaid',
        description: values.description,
        notes: values.notes,
      };
      try {
        await api(expense ? `/api/expenses/${expense.id}` : '/api/expenses', {
          method: expense ? 'PUT' : 'POST',
          body: JSON.stringify(payload),
        });
        await renderExpenses(content);
      } catch (error) {
        showInlineError(form, error.message);
      }
    });
  }

  function openExpensePaymentDialog(expense) {
    const dialog = document.getElementById('expense-payment-dialog');
    dialog.innerHTML = `<form method="dialog" class="dialog-close"><button class="icon-button" aria-label="Close">×</button></form><h2>Record payment</h2><p>${escapeHtml(expense.title)} · balance ${money(expense.outstanding_cents, currency)}</p><form id="expense-payment-form" class="record-form"><label>Amount (${escapeHtml(currency)})<input name="amount" type="number" min="0.01" max="${(expense.outstanding_cents / 100).toFixed(2)}" step="0.01" required /></label><label>Date<input name="paymentDate" type="date" value="${escapeHtml(expenseDateForPeriod('today')[0])}" required /></label><label>Method<select name="paymentMethod"><option value="cash">Cash</option><option value="card">Card</option><option value="eft">EFT</option><option value="bank_transfer">Bank transfer</option><option value="other">Other</option></select></label><label>Reference<input name="reference" maxlength="100" /></label><label class="span-two">Notes<textarea name="notes"></textarea></label><button class="button button-primary" type="submit">Save payment</button></form>`;
    dialog.showModal();
    document.getElementById('expense-payment-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const values = Object.fromEntries(new FormData(form).entries());
      const amountCents = centsFromInput(values.amount);
      if (amountCents === null || amountCents > expense.outstanding_cents) {
        showInlineError(form, 'Payment must be a valid amount no greater than the outstanding balance.');
        return;
      }
      try {
        await api(`/api/expenses/${expense.id}/payments`, {
          method: 'POST',
          headers: { 'Idempotency-Key': crypto.randomUUID() },
          body: JSON.stringify({ ...values, amountCents }),
        });
        dialog.close();
        await renderExpenses(content);
      } catch (error) {
        showInlineError(form, error.message);
      }
    });
  }
}

async function renderReports(content) {
  if (reportType === 'payroll' && !sessionInfo.business.isOwner) reportType = 'sales';
  const query = new URLSearchParams({ period: reportPeriod });
  if (reportStatusFilter) query.set('status', reportStatusFilter);
  if (reportType === 'receivables' && reportEntityFilter) query.set('customerId', reportEntityFilter);
  if (reportType === 'payables' && reportEntityFilter) query.set('supplierId', reportEntityFilter);
  if (reportPeriod === 'custom') {
    if (reportStartDate) query.set('startDate', reportStartDate);
    if (reportEndDate) query.set('endDate', reportEndDate);
  }
  const rangeQuery = query.toString();
  const [overview, report, customerResponse, supplierResponse] = await Promise.all([
    api(`/api/reports/overview?${rangeQuery}`),
    reportType === 'profit-loss' ? Promise.resolve(null) : api(`/api/reports/${reportType}?${rangeQuery}`),
    reportType === 'receivables' ? api('/api/customers') : Promise.resolve({ customers: [] }),
    reportType === 'payables' ? api('/api/expenses/suppliers') : Promise.resolve({ suppliers: [] }),
  ]);
  const reportEntities = reportType === 'receivables'
    ? customerResponse.customers || []
    : supplierResponse.suppliers || [];
  const currency = sessionInfo.business.currency;
  const range = overview.range;
  const periodOptions = [
    ['today', 'Today'],
    ['week', 'This week'],
    ['month', 'This month'],
    ['last-month', 'Last month'],
    ['quarter', 'Last 90 days'],
    ['year', 'Year to date'],
    ['custom', 'Custom range'],
  ];
  const exportHref = `/api/reports/${reportType}.csv?${rangeQuery}`;
  let reportContent = '';

  if (reportType === 'sales') {
    const maxRevenue = Math.max(1, ...report.daily.map((row) => row.revenueCents));
    reportContent = `<section class="panel report-panel"><div class="panel-heading"><div><h2>Daily sales</h2><p>Revenue excludes tax and discounts; only completed sales are included.</p></div></div>${report.daily.length ? `<div class="report-bars">${report.daily.map((row) => `<div class="report-bar-row"><span>${escapeHtml(row.date)}</span><div class="report-bar-track"><i style="width:${Math.max(1, row.revenueCents / maxRevenue * 100)}%"></i></div><strong>${money(row.revenueCents, currency)}</strong><small>${row.transactionCount} sale${row.transactionCount === 1 ? '' : 's'}</small></div>`).join('')}</div>` : '<div class="mini-empty">No sales recorded in this period.</div>'}</section>
      <section class="dashboard-grid lower-grid"><article class="panel report-panel"><div class="panel-heading"><div><h2>Top products</h2><p>Ranked by units sold</p></div></div>${report.products.length ? `<div class="table-scroll"><table><thead><tr><th>Product</th><th>Units</th><th>Revenue</th></tr></thead><tbody>${report.products.map((row) => `<tr><td>${escapeHtml(row.name)}</td><td>${row.quantitySold}</td><td>${money(row.revenueCents, currency)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="mini-empty">No product sales in this period.</div>'}</article>
      <article class="panel report-panel"><div class="panel-heading"><div><h2>Sales by category</h2><p>Revenue by product category</p></div></div>${report.categories.length ? `<div class="best-list">${report.categories.map((row) => `<div class="best-row"><span class="product-initial">◇</span><span class="best-product"><strong>${escapeHtml(row.name)}</strong><small>${row.quantitySold} units</small></span><strong>${money(row.revenueCents, currency)}</strong></div>`).join('')}</div>` : '<div class="mini-empty">No category sales in this period.</div>'}</article></section>
      <section class="panel report-panel"><div class="panel-heading"><div><h2>Sales by payment method</h2><p>Completed transactions only</p></div></div>${report.paymentMethods.length ? `<div class="table-scroll"><table><thead><tr><th>Payment method</th><th>Transactions</th><th>Revenue</th></tr></thead><tbody>${report.paymentMethods.map((row) => `<tr><td>${escapeHtml(row.paymentMethod)}</td><td>${row.transactionCount}</td><td>${money(row.revenueCents, currency)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="mini-empty">No payment data in this period.</div>'}</section>`;
  } else if (reportType === 'expenses') {
    reportContent = `<section class="dashboard-grid lower-grid"><article class="panel report-panel"><div class="panel-heading"><div><h2>Spending by category</h2><p>Drafts and cancellations are excluded.</p></div></div>${report.categories.length ? `<div class="table-scroll"><table><thead><tr><th>Category</th><th>Records</th><th>Amount</th></tr></thead><tbody>${report.categories.map((row) => `<tr><td>${escapeHtml(row.name)}</td><td>${row.count}</td><td>${money(row.amountCents, currency)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="mini-empty">No expenses in this period.</div>'}</article>
      <article class="panel report-panel"><div class="panel-heading"><div><h2>Spending by supplier</h2><p>Includes expenses without a supplier.</p></div></div>${report.suppliers.length ? `<div class="table-scroll"><table><thead><tr><th>Supplier</th><th>Records</th><th>Amount</th></tr></thead><tbody>${report.suppliers.map((row) => `<tr><td>${escapeHtml(row.name)}</td><td>${row.count}</td><td>${money(row.amountCents, currency)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="mini-empty">No expenses in this period.</div>'}</article></section>
      <section class="panel report-panel"><div class="panel-heading"><div><h2>Expense status</h2><p>Balances use recorded payments.</p></div></div>${report.statuses.length ? `<div class="table-scroll"><table><thead><tr><th>Status</th><th>Records</th><th>Total</th><th>Outstanding</th></tr></thead><tbody>${report.statuses.map((row) => `<tr><td>${escapeHtml(row.status.replace('_', ' '))}</td><td>${row.count}</td><td>${money(row.amountCents, currency)}</td><td>${money(row.outstandingCents, currency)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="mini-empty">No expense records in this period.</div>'}</section>`;
  } else if (reportType === 'inventory') {
    reportContent = `<section class="panel report-panel"><div class="panel-heading"><div><h2>Inventory valuation and stock status</h2><p>Values are based on current quantity and recorded product cost.</p></div></div>${report.products.length ? `<div class="table-scroll"><table><thead><tr><th>Product</th><th>Category</th><th>On hand</th><th>Reorder at</th><th>Value</th><th>Status</th><th>Units sold</th></tr></thead><tbody>${report.products.map((row) => `<tr><td><strong>${escapeHtml(row.name)}</strong></td><td>${escapeHtml(row.category || '—')}</td><td>${row.quantityOnHand}</td><td>${row.reorderLevel}</td><td>${money(row.inventoryValueCents, currency)}${row.costKnown ? '' : '<small>Estimate — cost missing</small>'}</td><td><span class="status-pill status-${row.status === 'in_stock' ? 'completed' : 'overdue'}">${escapeHtml(row.status.replace('_', ' '))}</span></td><td>${row.unitsSold}</td></tr>`).join('')}</tbody></table></div>` : '<div class="mini-empty">No active inventory items.</div>'}</section>`;
  } else if (reportType === 'profit-loss') {
    const amount = (value) => value === null ? 'Unavailable — sale-time costs missing' : money(value, currency);
    reportContent = `<section class="panel report-panel"><div class="panel-heading"><div><h2>Profit and loss estimate</h2><p>Revenue excludes sales tax; recorded expenses include tax. This is not a formal accounting statement.</p></div></div><div class="table-scroll"><table><thead><tr><th>Measure</th><th>Amount</th></tr></thead><tbody><tr><td>Sales revenue</td><td>${amount(overview.revenueCents)}</td></tr><tr><td>Cost of sales</td><td>${amount(overview.cogsCents)}</td></tr><tr><td>Gross profit</td><td>${amount(overview.grossProfitCents)}</td></tr><tr><td>Recorded expenses</td><td>${amount(overview.operatingExpensesCents)}</td></tr><tr><td><strong>Estimated operating result</strong></td><td><strong>${amount(overview.netOperatingResultCents)}</strong></td></tr></tbody></table></div><p class="form-help">Expense totals can include stock purchases already counted in cost of sales, so the estimate may double-count them. Review your records with an accountant.</p></section>`;
  } else if (reportType === 'activity') {
    reportContent = `<section class="panel report-panel"><div class="panel-heading"><div><h2>Recorded system activity</h2><p>Inventory movements and expense payments by recording time. This is not a complete audit log; edits and other changes may not be recorded.</p></div></div>${report.truncated ? '<p class="form-help">Showing the latest 500 events. Narrow the date range to see earlier events.</p>' : ''}${report.events.length ? `<div class="table-scroll"><table><thead><tr><th>Recorded at</th><th>Event</th><th>Item</th><th>Details</th></tr></thead><tbody>${report.events.map((row) => `<tr><td>${escapeHtml(dateTime(row.timestamp, sessionInfo.business.timezone))}</td><td>${escapeHtml(row.type)}</td><td>${escapeHtml(row.subject)}</td><td>${escapeHtml(row.detail)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="mini-empty">No recorded inventory movements or expense payments in this period.</div>'}</section>`;
  } else if (reportType === 'receivables' || reportType === 'payables') {
    const receivables = reportType === 'receivables';
    const parties = receivables ? report.customers : report.suppliers;
    const ageing = [
      ['Current', report.aging.currentCents],
      ['1–30 days', report.aging.days1To30Cents],
      ['31–60 days', report.aging.days31To60Cents],
      ['61–90 days', report.aging.days61To90Cents],
      ['Over 90 days', report.aging.over90DaysCents],
    ];
    reportContent = `<section class="kpi-grid report-kpis">
      ${kpiCard('▤', 'Outstanding', money(report.summary.outstandingCents, currency), `${report.invoices.length} invoice${report.invoices.length === 1 ? '' : 's'} in result`, '', 'icon-blue')}
      ${kpiCard('!', 'Overdue', money(report.summary.overdueCents, currency), `${report.summary.overdueCount} overdue invoice${report.summary.overdueCount === 1 ? '' : 's'}`, '', 'icon-red')}
      ${kpiCard('↗', receivables ? 'Payments received' : 'Payments made', money(receivables ? report.summary.paymentsReceivedCents : report.summary.paymentsMadeCents, currency), `${receivables ? report.summary.invoicesIssuedCount : report.summary.invoicesReceivedCount} invoices ${receivables ? 'issued' : 'received'} in period`, '', 'icon-green')}
      ${kpiCard('⌁', 'Part-paid', String(report.summary.partiallyPaidCount), `Average payment time ${report.summary.averagePaymentDays === null ? '—' : `${report.summary.averagePaymentDays} days`}`, '', 'icon-amber')}
    </section>
    ${report.truncated ? '<p class="form-help">Showing the first 1,000 invoices; narrow the filters to see a complete ageing total.</p>' : ''}
    <section class="dashboard-grid lower-grid">
      <article class="panel report-panel"><div class="panel-heading"><div><h2>Ageing summary</h2><p>Balances as of ${escapeHtml(report.range.asOfDate)}</p></div></div><div class="table-scroll"><table><thead><tr><th>Age</th><th>Outstanding</th></tr></thead><tbody>${ageing.map(([label, amount]) => `<tr><td>${label}</td><td>${money(amount, currency)}</td></tr>`).join('')}</tbody></table></div></article>
      <article class="panel report-panel"><div class="panel-heading"><div><h2>${receivables ? 'Customer balances' : 'Supplier balances'}</h2><p>Ranked by overdue balance</p></div></div>${parties.length ? `<div class="table-scroll"><table><thead><tr><th>${receivables ? 'Customer' : 'Supplier'}</th><th>Open invoices</th><th>Overdue</th><th>Outstanding</th></tr></thead><tbody>${parties.map((row) => `<tr><td>${escapeHtml(row.name)}</td><td>${row.invoiceCount}</td><td>${money(row.overdueCents, currency)}</td><td>${money(row.outstandingCents, currency)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="mini-empty">No outstanding balances.</div>'}</article>
    </section>
    <section class="panel report-panel"><div class="panel-heading"><div><h2>${receivables ? 'Customer invoices' : 'Supplier invoices'}</h2><p>POS sales are excluded; linked supplier expenses are not counted twice.</p></div></div>${report.invoices.length ? `<div class="table-scroll"><table><thead><tr><th>${receivables ? 'Customer' : 'Supplier'}</th><th>Invoice</th><th>Invoice date</th><th>Due date</th><th>Amount</th><th>Paid</th>${receivables ? '<th>Credited</th>' : ''}<th>Outstanding</th><th>Days overdue</th></tr></thead><tbody>${report.invoices.map((row) => `<tr><td>${escapeHtml(receivables ? row.customer_name : row.supplier_name)}</td><td><strong>${escapeHtml(receivables ? row.invoice_number : row.supplier_invoice_number)}</strong></td><td>${escapeHtml(row.invoice_date)}</td><td>${escapeHtml(row.due_date)}</td><td>${money(row.total_cents, currency)}</td><td>${money(row.paid_cents, currency)}</td>${receivables ? `<td>${money(row.credited_cents, currency)}</td>` : ''}<td><strong>${money(row.outstanding_cents, currency)}</strong></td><td>${row.days_overdue}</td></tr>`).join('')}</tbody></table></div>` : '<div class="mini-empty">No invoices match these filters.</div>'}</section>`;
  } else if (reportType === 'payroll') {
    reportContent = `<section class="kpi-grid report-kpis">
      ${kpiCard('▤', 'Finalised runs', String(report.summary.runCount), `${report.summary.employeeLineCount} employee payslip lines`, '', 'icon-blue')}
      ${kpiCard('↗', 'Gross pay', money(report.summary.grossCents, currency), 'Finalised runs in the selected pay-date range', '', 'icon-green')}
      ${kpiCard('−', 'PAYE + employee UIF + other deductions', money(report.summary.payeCents + report.summary.employeeUifCents + report.summary.otherDeductionsCents, currency), 'Estimated deductions', '', 'icon-red')}
      ${kpiCard('⌁', 'Employer UIF + SDL', money(report.summary.employerCostCents, currency), 'Estimated employer costs', '', 'icon-amber')}
      ${kpiCard('◎', 'Net pay', money(report.summary.netCents, currency), `${money(report.summary.paidToDateCents, currency)} paid to date`, '', 'icon-violet')}
      ${kpiCard('!', 'Outstanding', money(report.summary.outstandingCents, currency), `${money(report.summary.paymentsRecordedInPeriodCents, currency)} payments recorded in selected period`, '', 'icon-red')}
    </section>
    ${report.truncated ? '<p class="form-help">Showing the first 1,000 runs or employee lines. Narrow the date range for a complete report.</p>' : ''}
    <section class="panel report-panel"><div class="panel-heading"><div><h2>Finalised payroll runs</h2><p>Payment balances are calculated as of ${escapeHtml(report.range.asOfDate)}.</p></div></div>${report.runs.length ? `<div class="table-scroll"><table><thead><tr><th>Pay period</th><th>Pay date</th><th>Gross</th><th>Net</th><th>Paid to date</th><th>Outstanding</th></tr></thead><tbody>${report.runs.map((row) => `<tr><td>${escapeHtml(row.period_start)} – ${escapeHtml(row.period_end)}</td><td>${escapeHtml(row.pay_date)}</td><td>${money(row.total_gross_cents, currency)}</td><td>${money(row.total_net_cents, currency)}</td><td>${money(row.paid_cents, currency)}</td><td><strong>${money(row.outstanding_cents, currency)}</strong></td></tr>`).join('')}</tbody></table></div>` : '<div class="mini-empty">No finalised payroll runs match this pay-date range.</div>'}</section>
    <section class="panel report-panel"><div class="panel-heading"><div><h2>Employee totals</h2><p>Gross, estimated deductions and manual payments per employee.</p></div></div>${report.employeeLines.length ? `<div class="table-scroll"><table><thead><tr><th>Employee</th><th>Employee number</th><th>Pay date</th><th>Gross</th><th>PAYE estimate</th><th>Employee UIF</th><th>Other deductions</th><th>Employer UIF</th><th>SDL estimate</th><th>Net</th><th>Paid</th><th>Outstanding</th></tr></thead><tbody>${report.employeeLines.map((row) => `<tr><td><strong>${escapeHtml(row.first_name)} ${escapeHtml(row.last_name)}</strong></td><td>${escapeHtml(row.employee_number)}</td><td>${escapeHtml(row.pay_date)}</td><td>${money(row.gross_cents, currency)}</td><td>${money(row.paye_cents, currency)}</td><td>${money(row.uif_employee_cents, currency)}</td><td>${money(row.other_deductions_cents, currency)}</td><td>${money(row.uif_employer_cents, currency)}</td><td>${money(row.sdl_cents, currency)}</td><td>${money(row.net_cents, currency)}</td><td>${money(row.paid_cents, currency)}</td><td>${money(row.outstanding_cents, currency)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="mini-empty">No employee totals to show.</div>'}</section>`;
  } else {
    reportContent = `<section class="panel report-panel"><div class="panel-heading"><div><h2>Customer activity</h2><p>Spend and transaction counts for the selected period.</p></div></div>${report.customers.length ? `<div class="table-scroll"><table><thead><tr><th>Customer</th><th>Email</th><th>Transactions</th><th>Average spend</th><th>Total spend</th><th>Last purchase</th></tr></thead><tbody>${report.customers.map((row) => `<tr><td><strong>${escapeHtml(row.name)}</strong></td><td>${escapeHtml(row.email || '—')}</td><td>${row.transactionCount}</td><td>${money(row.averageSpendCents, currency)}</td><td>${money(row.spendCents, currency)}</td><td>${escapeHtml(row.lastPurchaseAt ? dateTime(row.lastPurchaseAt, sessionInfo.business.timezone) : '—')}</td></tr>`).join('')}</tbody></table></div>` : '<div class="mini-empty">No customers found.</div>'}</section>`;
  }

  content.innerHTML = `
    <section class="page-heading"><div><span class="eyebrow">BUSINESS PERFORMANCE</span><h1>Reports</h1><p>${reportType === 'payroll' ? `Finalised payroll estimates and manual payment tracking for ${escapeHtml(overview.business.name)}.` : `Review sales, spending, stock and customer activity for ${escapeHtml(overview.business.name)}.`}</p><div id="report-export-feedback" class="inline-feedback" role="status"></div></div><div class="heading-actions"><button class="button button-secondary" id="report-print" type="button">Print / Save as PDF</button><button class="button button-secondary" id="report-export" type="button">Export CSV</button></div></section>
    <section class="panel report-controls"><form id="report-filter-form" class="expense-filters">
      <label>Report<select id="report-type" name="type"><option value="sales" ${reportType === 'sales' ? 'selected' : ''}>Sales</option><option value="expenses" ${reportType === 'expenses' ? 'selected' : ''}>Expenses</option><option value="profit-loss" ${reportType === 'profit-loss' ? 'selected' : ''}>Profit &amp; loss estimate</option><option value="activity" ${reportType === 'activity' ? 'selected' : ''}>System activity</option><option value="inventory" ${reportType === 'inventory' ? 'selected' : ''}>Inventory</option><option value="customers" ${reportType === 'customers' ? 'selected' : ''}>Customers</option><option value="receivables" ${reportType === 'receivables' ? 'selected' : ''}>Accounts receivable</option><option value="payables" ${reportType === 'payables' ? 'selected' : ''}>Accounts payable</option>${sessionInfo.business.isOwner ? `<option value="payroll" ${reportType === 'payroll' ? 'selected' : ''}>Payroll</option>` : ''}</select></label>
      <label>Period<select id="report-period" name="period">${periodOptions.map(([value, label]) => `<option value="${value}" ${reportPeriod === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
      ${reportType === 'receivables' || reportType === 'payables' ? `<label>${reportType === 'receivables' ? 'Customer' : 'Supplier'}<select name="entityId"><option value="">All</option>${reportEntities.map((entity) => `<option value="${entity.id}" ${String(entity.id) === reportEntityFilter ? 'selected' : ''}>${escapeHtml(entity.name)}</option>`).join('')}</select></label><label>Balance status<select name="status"><option value="" ${!reportStatusFilter ? 'selected' : ''}>All balances</option><option value="outstanding" ${reportStatusFilter === 'outstanding' ? 'selected' : ''}>Outstanding</option><option value="overdue" ${reportStatusFilter === 'overdue' ? 'selected' : ''}>Overdue</option><option value="partially_paid" ${reportStatusFilter === 'partially_paid' ? 'selected' : ''}>Partially paid</option><option value="paid" ${reportStatusFilter === 'paid' ? 'selected' : ''}>Paid</option></select></label>` : ''}
      ${reportPeriod === 'custom' ? `<label>From<input type="date" name="startDate" value="${escapeHtml(reportStartDate || range.startDate)}" required /></label><label>To<input type="date" name="endDate" value="${escapeHtml(reportEndDate || range.endDate)}" required /></label>` : ''}
      ${reportType === 'inventory' ? '<span class="report-range-note">Stock and valuation show current inventory.</span>' : `<span class="report-range-note">Showing ${escapeHtml(range.startDate)} to ${escapeHtml(range.endDate)}</span>`}
      <button class="button button-secondary" type="submit">Apply</button>
    </form></section>
    <section class="kpi-grid report-kpis">
      ${reportType === 'receivables' || reportType === 'payables' || reportType === 'payroll' ? '' : `${kpiCard('↗', 'Sales revenue', money(overview.revenueCents, currency), `${overview.transactionCount} completed sales`, '', 'icon-green')}
      ${kpiCard('−', 'Operating expenses', money(overview.operatingExpensesCents, currency), `${overview.overdueExpenseCount} overdue expense${overview.overdueExpenseCount === 1 ? '' : 's'}`, '', 'icon-red')}
      ${kpiCard('⌁', 'Gross profit', money(overview.grossProfitCents, currency), overview.costCoverageComplete ? `${overview.grossMarginPct ?? 0}% margin` : `Estimate: ${overview.unknownCostUnits} units have missing costs treated as zero`, '', 'icon-amber')}
      ${kpiCard('◎', 'Net operating result', money(overview.netOperatingResultCents, currency), overview.costCoverageComplete ? 'Gross profit less recorded expenses' : 'Estimate: missing sale-time costs treated as zero', '', 'icon-blue')}
      ${kpiCard('▤', 'Stock value', money(overview.inventory.valuationCents, currency), overview.inventory.valuationComplete ? `${overview.inventory.lowStockCount} low · ${overview.inventory.outOfStockCount} out of stock` : 'Estimate — missing product costs treated as zero', '', 'icon-violet')}
      ${kpiCard('◎', 'Customers', String(overview.customers.total), `${overview.customers.newInPeriod} new in selected period`, '', 'icon-teal')}`}
    </section>
    <div class="report-caveats">${reportType === 'payroll' ? 'PAYE, UIF and SDL values are estimates based on rates configured by the business and are not statutory advice or submissions. Payment records are manual bookkeeping only; transfers happen outside WorkflowOS. Payroll figures are separate from sales revenue and operating expenses.' : `${overview.refundedCount ? `${overview.refundedCount} fully refunded sale(s), totalling ${money(overview.refundedCents, currency)}, are excluded from revenue. ` : ''}${overview.inventory.valuationComplete ? '' : 'Stock value is an estimate: missing product costs are treated as zero and may understate value. Add costs under Products & Services. '}${overview.costCoverageComplete ? '' : 'Profit is an estimate: missing sale-time costs are treated as zero and may overstate profit. Adding product costs helps future sales but does not change historical sale snapshots.'}`}</div>
    ${reportContent}
    <p class="form-help">CSV exports are business-scoped and spreadsheet-compatible. Use Print / Save as PDF for a printable report.</p>`;
  document.getElementById('report-print').addEventListener('click', () => window.print());
  document.getElementById('report-export').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const feedback = document.getElementById('report-export-feedback');
    button.disabled = true;
    feedback.textContent = '';
    feedback.className = 'inline-feedback';
    try {
      const response = await fetch(exportHref, {
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      if (response.status === 401) {
        clearSession();
        renderAuth('Your session expired. Please sign in again.');
        return;
      }
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Report export failed.');
      }
      const blob = await response.blob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `workflowos-${reportType}-report.csv`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (error) {
      feedback.textContent = error.message;
      feedback.className = 'inline-feedback error';
    } finally {
      button.disabled = false;
    }
  });
  document.getElementById('report-filter-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    reportType = document.getElementById('report-type').value;
    reportPeriod = document.getElementById('report-period').value;
    const values = Object.fromEntries(new FormData(form).entries());
    reportStartDate = values.startDate || '';
    reportEndDate = values.endDate || '';
    reportStatusFilter = values.status || '';
    reportEntityFilter = values.entityId || '';
    renderView('reports');
  });
  document.getElementById('report-type').addEventListener('change', (event) => {
    reportType = event.target.value;
    reportStatusFilter = '';
    reportEntityFilter = '';
    renderView('reports');
  });
  document.getElementById('report-period').addEventListener('change', (event) => {
    reportPeriod = event.target.value;
    if (reportPeriod !== 'custom') {
      reportStartDate = '';
      reportEndDate = '';
    }
    renderView('reports');
  });
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
  const currency = sessionInfo.business.currency;
  content.innerHTML = `<section class="page-heading"><div><span class="eyebrow">RELATIONSHIPS</span><h1>Customers</h1><p>Keep customer details, invoice balances, receipts, and statements together.</p></div></section><section class="panel form-panel"><h2>Add a customer</h2><form id="customer-form" class="record-form"><label>Name<input name="name" required /></label><label>Email<input type="email" name="email" /></label><label>Phone<input name="phone" /></label><button class="button button-primary" type="submit">Add customer</button></form></section><section class="panel list-panel"><div class="panel-heading"><div><h2>Customer directory</h2><p>${customers.length} registered customer${customers.length === 1 ? '' : 's'}</p></div></div>${customers.length ? `<div class="table-scroll"><table><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Loyalty points</th><th>Added</th><th>Financials</th></tr></thead><tbody>${customers.map((customer) => `<tr><td><strong>${escapeHtml(customer.name)}</strong></td><td>${escapeHtml(customer.email || '—')}</td><td>${escapeHtml(customer.phone || '—')}</td><td>${customer.loyalty_points}</td><td>${escapeHtml(customer.created_at.slice(0, 10))}</td><td><button class="text-link customer-financials" data-id="${customer.id}" data-name="${escapeHtml(customer.name)}" type="button">History / statement</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="table-empty"><strong>No customers yet</strong><span>Customer records you add will appear here.</span></div>'}</section><dialog class="expense-dialog" id="customer-financial-dialog"></dialog>`;
  const financialDialog = document.getElementById('customer-financial-dialog');
  content.querySelectorAll('.customer-financials').forEach((button) => button.addEventListener('click', async () => {
    try {
      const financials = await api(`/api/customers/${button.dataset.id}/financial`);
      const summary = financials.summary;
      financialDialog.innerHTML = `<form method="dialog" class="dialog-close"><button class="icon-button" aria-label="Close">×</button></form><h2>${escapeHtml(financials.customer.name)} · financial history</h2><dl><div><dt>Invoiced</dt><dd>${money(summary.totalInvoicedCents, currency)}</dd></div><div><dt>Paid</dt><dd>${money(summary.totalPaidCents, currency)}</dd></div><div><dt>Outstanding</dt><dd>${money(summary.outstandingCents, currency)}</dd></div><div><dt>Overdue</dt><dd>${money(summary.overdueCents, currency)}</dd></div></dl><div class="invoice-form-actions"><button class="button button-secondary customer-statement" data-format="pdf" type="button">Download PDF statement</button><button class="button button-secondary customer-statement" data-format="csv" type="button">Download CSV statement</button></div><h3>Invoices</h3>${financials.invoices.length ? `<div class="table-scroll"><table><thead><tr><th>Invoice</th><th>Date / due</th><th>Total</th><th>Paid</th><th>Credited</th><th>Balance</th><th>Status</th></tr></thead><tbody>${financials.invoices.map((invoice) => `<tr><td>${escapeHtml(invoice.invoice_number)}</td><td>${escapeHtml(dateInputValue(invoice.invoice_date))} / ${escapeHtml(dateInputValue(invoice.due_date))}</td><td>${money(invoice.total_cents, currency)}</td><td>${money(invoice.paid_cents, currency)}</td><td>${money(invoice.credited_cents, currency)}</td><td>${money(invoice.outstanding_cents, currency)}</td><td>${escapeHtml(invoice.display_status.replace('_', ' '))}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted-copy">No issued customer invoices.</p>'}<h3>Recent payments</h3>${financials.payments.length ? `<div class="table-scroll"><table><thead><tr><th>Receipt</th><th>Invoice</th><th>Date</th><th>Amount</th><th>PDF</th></tr></thead><tbody>${financials.payments.map((payment) => `<tr><td>${escapeHtml(payment.receipt_number || '—')}</td><td>${escapeHtml(payment.invoice_number || '')}</td><td>${escapeHtml(dateInputValue(payment.payment_date))}</td><td>${money(payment.amount_cents, currency)}</td><td><button class="text-link customer-receipt" data-id="${payment.id}" type="button">Download</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted-copy">No payments recorded.</p>'}`;
      financialDialog.showModal();
      financialDialog.querySelectorAll('.customer-statement').forEach((statementButton) => statementButton.addEventListener('click', async () => {
        const timeParts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
          timeZone: sessionInfo.business.timezone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).formatToParts(new Date()).filter((part) => part.type !== 'literal')
          .map((part) => [part.type, part.value]));
        const endDate = `${timeParts.year}-${timeParts.month}-${timeParts.day}`;
        const startDate = window.prompt('Statement start date (YYYY-MM-DD)', `${endDate.slice(0, 7)}-01`);
        if (!startDate) return;
        const params = new URLSearchParams({ startDate, endDate });
        const format = statementButton.dataset.format;
        try {
          await downloadAuthenticatedFile(
            `/api/customers/${button.dataset.id}/statement.${format}?${params}`,
            `customer-${button.dataset.id}-statement.${format}`
          );
        } catch (error) {
          alert(error.message);
        }
      }));
      financialDialog.querySelectorAll('.customer-receipt').forEach((receiptButton) => receiptButton.addEventListener('click', () => {
        downloadAuthenticatedFile(`/api/invoice-payments/${receiptButton.dataset.id}/receipt.pdf`, `receipt-${receiptButton.dataset.id}.pdf`)
          .catch((error) => alert(error.message));
      }));
    } catch (error) {
      alert(error.message);
    }
  }));
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
      <form id="checkout-form" class="checkout-form"><label>Customer<select name="customerId"><option value="">Walk-in customer</option>${customers.customers.map((customer) => `<option value="${customer.id}">${escapeHtml(customer.name)}</option>`).join('')}</select></label><label>Payment method<select name="paymentMethod"><option value="cash">Cash</option><option value="card">Card</option><option value="eft">EFT</option><option value="other">Other</option></select></label><label>Discount amount (${escapeHtml(currency)})<input name="discountAmount" id="sale-discount" type="number" min="0" step="0.01" value="0" /></label><label>Tax amount (${escapeHtml(currency)})<input name="taxAmount" id="sale-tax" type="number" min="0" step="0.01" value="0" /></label><div class="cart-total"><span>Transaction total</span><strong id="cart-total">${money(0, currency)}</strong></div><button class="button button-primary button-wide" type="submit" id="complete-sale" disabled>Record completed sale</button></form>
      <p class="form-help">Enter discount and tax amounts manually; WorkflowOS does not assume a tax rate. This records a transaction stated as already completed; it does not charge or verify a payment. Sale snapshots and stock movements are saved together. Only verified barcode mappings are used for automatic scans.</p>
    </section><section class="panel activity-panel"><div class="panel-heading"><div><h2>Today’s transactions</h2><p>${data.recentSales.length} transaction${data.recentSales.length === 1 ? '' : 's'} · ${escapeHtml(data.todayDate)} local time</p></div></div>${data.recentSales.length ? `<div class="table-scroll"><table><thead><tr><th>Reference</th><th>Time</th><th>Customer</th><th>Items</th><th>Amount</th><th>Payment</th><th>Status</th><th>Action</th></tr></thead><tbody>${data.recentSales.map((sale) => `<tr><td><strong>${escapeHtml(sale.reference)}</strong></td><td>${escapeHtml(dateTime(sale.created_at, data.business.timezone))}</td><td>${escapeHtml(sale.customer_name || 'Walk-in')}</td><td>${sale.items_count}</td><td><strong>${money(sale.total_cents, currency)}</strong></td><td>${escapeHtml(sale.payment_method || '—')}</td><td><span class="status-pill status-${escapeHtml(sale.status)}">${escapeHtml(sale.status)}</span></td><td>${sale.status === 'completed' ? `<button class="text-link refund-button" data-sale-id="${sale.id}">Refund & restock</button>` : '—'}</td></tr>`).join('')}</tbody></table></div>` : '<div class="table-empty"><strong>No transactions today</strong><span>Completed sales will be listed here.</span></div>'}</section></div>`;

  const input = document.getElementById('product-lookup');
  const feedback = document.getElementById('scan-feedback');
  const results = document.getElementById('product-search-results');
  const selectedPanel = document.getElementById('selected-product');
  const addSelected = document.getElementById('add-selected-product');

  function updateCart() {
    const rows = [...cart.values()];
    const discountCents = parseSaleAmount(document.getElementById('sale-discount').value);
    const taxCents = parseSaleAmount(document.getElementById('sale-tax').value);
    const subtotalCents = rows.reduce((sum, item) => sum + item.price_cents * item.quantity, 0);
    const amountsValid = discountCents !== null &&
      taxCents !== null &&
      discountCents <= subtotalCents &&
      Number.isSafeInteger(subtotalCents - discountCents + taxCents);
    document.getElementById('cart-count').textContent = `${rows.reduce((sum, item) => sum + item.quantity, 0)} item${rows.length === 1 && rows[0]?.quantity === 1 ? '' : 's'}`;
    document.getElementById('cart-total').textContent = money(
      subtotalCents - (discountCents || 0) + (taxCents || 0),
      currency
    );
    document.getElementById('complete-sale').disabled = rows.length === 0 || !amountsValid;
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

  function parseSaleAmount(value) {
    if (value === '') return 0;
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) return null;
    const cents = Math.round(amount * 100);
    return Number.isSafeInteger(cents) && Math.abs(amount * 100 - cents) < 0.000001
      ? cents
      : null;
  }

  document.getElementById('sale-discount').addEventListener('input', updateCart);
  document.getElementById('sale-tax').addEventListener('input', updateCart);

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
      const discountCents = parseSaleAmount(values.discountAmount);
      const taxCents = parseSaleAmount(values.taxAmount);
      if (discountCents === null || taxCents === null) {
        throw new Error('Discount and tax must be valid amounts with up to two decimal places.');
      }

      await api('/api/sales', {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({
          paymentMethod: values.paymentMethod,
          customerId: values.customerId || null,
          discountCents,
          taxCents,
          items,
        }),
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
  feedback.classList.add('error');
  feedback.textContent = message;
}

if (location.pathname === '/reset-password') renderResetPassword(new URLSearchParams(location.search).get('token') || '');
else if (publicPagePaths.has(location.pathname)) window.renderPublicSite(location.pathname);
else if (sessionToken && location.pathname !== '/login' && location.pathname !== '/signup') loadAuthenticatedApp();
else renderAuth('', location.pathname === '/signup' ? 'register' : 'login');
