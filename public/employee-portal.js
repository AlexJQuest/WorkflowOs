(() => {
  const content = document.getElementById('portal-content');
  const invitationToken = new URLSearchParams(location.search).get('token');
  const sessionKey = 'workflowosEmployeePortalToken';
  let sessionToken = sessionStorage.getItem(sessionKey);

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[char]));
  }

  function money(cents, currency) {
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(cents) / 100);
  }

  async function jsonRequest(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
        ...options.headers,
      },
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'The request could not be completed.');
    return body;
  }

  function showLogin(error = '') {
    content.innerHTML = `<section class="portal-panel">
      <h2>Sign in</h2>
      <form class="portal-form" id="portal-login-form">
        <label>Email<input name="email" type="email" autocomplete="username" required /></label>
        <label>Password<input name="password" type="password" autocomplete="current-password" required /></label>
        <button class="site-button" type="submit">Sign in</button>
        <p class="portal-error" role="status">${escapeHtml(error)}</p>
      </form>
    </section>`;
    document.getElementById('portal-login-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const status = form.querySelector('.portal-error');
      const values = Object.fromEntries(new FormData(form).entries());
      try {
        const result = await jsonRequest('/api/login', {
          method: 'POST',
          body: JSON.stringify(values),
        });
        sessionToken = result.sessionToken;
        sessionStorage.setItem(sessionKey, sessionToken);
        await showPayslips();
      } catch (requestError) {
        status.textContent = requestError.message;
      }
    });
  }

  function showActivation(error = '') {
    content.innerHTML = `<section class="portal-panel">
      <h2>Activate your employee access</h2>
      <p class="form-help">Choose a password with at least 12 characters. The invitation is single-use.</p>
      <form class="portal-form" id="portal-activation-form">
        <label>Password<input name="password" type="password" minlength="12" maxlength="200" autocomplete="new-password" required /></label>
        <label>Confirm password<input name="confirmPassword" type="password" minlength="12" maxlength="200" autocomplete="new-password" required /></label>
        <button class="site-button" type="submit">Activate access</button>
        <p class="portal-error" role="status">${escapeHtml(error)}</p>
      </form>
    </section>`;
    document.getElementById('portal-activation-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const status = form.querySelector('.portal-error');
      const values = Object.fromEntries(new FormData(form).entries());
      if (values.password !== values.confirmPassword) {
        status.textContent = 'Passwords do not match.';
        return;
      }
      try {
        const result = await jsonRequest('/api/employee-portal/activate', {
          method: 'POST',
          body: JSON.stringify({ token: invitationToken, password: values.password }),
        });
        sessionToken = result.sessionToken;
        sessionStorage.setItem(sessionKey, sessionToken);
        history.replaceState({}, '', '/employee-portal');
        await showPayslips();
      } catch (requestError) {
        status.textContent = requestError.message;
      }
    });
  }

  async function downloadPayslip(runId, button) {
    button.disabled = true;
    try {
      const response = await fetch(`/api/employee-portal/payslips/${runId}.pdf`, {
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error || 'The payslip could not be downloaded.');
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = `payslip-${runId}.pdf`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (error) {
      alert(error.message);
    } finally {
      button.disabled = false;
    }
  }

  async function showPayslips() {
    try {
      const { payslips } = await jsonRequest('/api/employee-portal/payslips');
      content.innerHTML = `<section class="portal-panel">
        <div class="portal-actions"><h2>Finalised payslips</h2><button class="site-button site-button-outline" id="portal-logout" type="button">Sign out</button></div>
        ${payslips.length ? `<div class="portal-slip-list">${payslips.map((slip) => `<article class="portal-slip">
          <div><h3>${escapeHtml(slip.business_name)} · ${escapeHtml(slip.period_start)} to ${escapeHtml(slip.period_end)}</h3>
          <p>Pay date ${escapeHtml(slip.pay_date)} · Net ${escapeHtml(money(slip.net_cents, slip.currency))}</p>
          <small>Paid ${escapeHtml(money(slip.paid_cents, slip.currency))} · Remaining ${escapeHtml(money(slip.outstanding_cents, slip.currency))}</small></div>
          <button class="site-button payslip-download" data-run-id="${slip.payroll_run_id}" type="button">Download payslip</button>
        </article>`).join('')}</div>` : '<div class="portal-empty">No finalised payslips are available yet. Contact your employer if you expect to see one.</div>'}
      </section>`;
      document.getElementById('portal-logout').addEventListener('click', async () => {
        try {
          await jsonRequest('/api/logout', { method: 'POST' });
        } catch (error) {
          alert(`Signed out on this device, but server-side session revocation failed: ${error.message}`);
        }
        sessionStorage.removeItem(sessionKey);
        sessionToken = null;
        showLogin();
      });
      content.querySelectorAll('.payslip-download').forEach((button) => {
        button.addEventListener('click', () =>
          downloadPayslip(button.dataset.runId, button));
      });
    } catch (error) {
      sessionStorage.removeItem(sessionKey);
      sessionToken = null;
      showLogin(error.message);
    }
  }

  if (invitationToken) showActivation();
  else if (sessionToken) showPayslips();
  else showLogin();
})();
