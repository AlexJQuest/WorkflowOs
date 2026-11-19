(() => {
  const pages = {
    '/': {
      title: 'WorkflowOS | Run your business smarter',
      render: landing,
    },
    '/about': { title: 'About | WorkflowOS', render: about },
    '/features': { title: 'Features | WorkflowOS', render: features },
    '/solutions': { title: 'Solutions | WorkflowOS', render: solutions },
    '/pricing': { title: 'Pricing | WorkflowOS', render: pricing },
    '/contact': { title: 'Contact | WorkflowOS', render: contact },
    '/faq': { title: 'FAQ | WorkflowOS', render: faq },
    '/privacy': { title: 'Privacy | WorkflowOS', render: privacy },
    '/terms': { title: 'Terms | WorkflowOS', render: terms },
  };

  const implementedFeatures = [
    ['Sales & transactions', 'Record sales and refunds while keeping transaction data in the business workspace.'],
    ['Products & inventory', 'Manage product records, stock adjustments, barcode information and supplier stock receipts.'],
    ['Customers & invoices', 'Keep customer records, issue invoices, record payments and prepare statements.'],
    ['Expenses & suppliers', 'Record expenses, suppliers, payable invoices and payment history.'],
    ['Reports', 'Review sales, expenses, inventory, customer activity, receivables and payables.'],
    ['Employee records', 'Manage employee profiles, attendance, and leave. Owner-entered payroll estimates support finalised payslips, invited employee access, and manual payment tracking; tax adjustments and SARS submissions are not supported.'],
  ];

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[char]));
  }

  function link(path, label, className = '') {
    return `<a class="${className}" href="${path}">${label}</a>`;
  }

  function header() {
    return `<header class="site-header"><a class="site-brand" href="/" aria-label="WorkflowOS home"><span class="site-brand-mark">W</span><span>workflow<span>OS</span></span></a><button class="site-menu-button" type="button" aria-expanded="false" aria-controls="site-navigation">Menu</button><nav class="site-nav" id="site-navigation" aria-label="Main navigation"><a href="/features">Features</a><a href="/solutions">Solutions</a><a href="/pricing">Pricing</a><a href="/about">About</a><a href="/employee-portal">Employee portal</a><a class="site-login" href="/login">Log in</a><a class="site-button" href="/signup">Get started</a></nav></header>`;
  }

  function footer() {
    return `<footer class="site-footer"><a class="site-brand site-brand-light" href="/"><span class="site-brand-mark">W</span><span>workflow<span>OS</span></span></a><p>Tools for the day-to-day work of small businesses.</p><div class="site-footer-links"><a href="/features">Features</a><a href="/solutions">Solutions</a><a href="/pricing">Pricing</a><a href="/contact">Contact</a><a href="/faq">FAQ</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/employee-portal">Employee portal</a><a href="/login">Log in</a></div><small>Company and contact details will be published here when configured.</small></footer>`;
  }

  function layout(content) {
    return `<div class="public-site">${header()}<main>${content}</main>${footer()}</div>`;
  }

  function cta(title = 'Bring your business work into one workspace.') {
    return `<section class="site-cta"><div><h2>${title}</h2><p>Create a workspace to explore the tools currently available.</p></div><div class="site-cta-actions">${link('/signup', 'Get started', 'site-button')}${link('/contact', 'Contact us', 'site-button site-button-outline')}</div></section>`;
  }

  function landing() {
    const cards = implementedFeatures.map(([title, description]) =>
      `<article class="site-feature-card"><span aria-hidden="true">✓</span><h3>${title}</h3><p>${description}</p></article>`
    ).join('');
    return layout(`
      <section class="site-hero"><div class="site-hero-copy"><p class="site-eyebrow">A clearer way to run your business</p><h1>Run your business smarter. Manage everything in one place.</h1><p>WorkflowOS brings everyday sales, customers, stock, expenses, employee records and business reports together for small businesses.</p><div class="site-hero-actions">${link('/signup', 'Get started', 'site-button')}${link('/features', 'Explore features', 'site-button site-button-outline')}</div><small>Features are being released in stages. See what is available today.</small></div><div class="site-preview" role="img" aria-label="Illustration of the WorkflowOS business workspace"><div class="preview-top"><span></span><span></span><span></span><b>Business workspace</b></div><div class="preview-body"><aside><i></i><i></i><i></i><i></i></aside><div class="preview-content"><strong>Daily operations</strong><small>One workspace for your business</small><div class="preview-kpis"><i></i><i></i><i></i></div><div class="preview-chart"><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span></div><div class="preview-rows"><i></i><i></i><i></i></div></div></div></div></section>
      <section class="site-section site-problems"><p class="site-eyebrow">LESS ADMIN. MORE CLARITY.</p><h2>Small-business work is spread across too many places.</h2><p>When sales, stock, customer details and spending live in disconnected tools and notebooks, it takes more effort to understand what is happening.</p><div class="site-problem-list"><span>Disconnected records</span><span>Unclear stock levels</span><span>Untracked spending</span><span>Scattered customer details</span><span>Time-consuming admin</span></div></section>
      <section class="site-section"><div class="site-section-heading"><p class="site-eyebrow">BUILT AROUND DAILY WORK</p><h2>Keep core business tasks connected.</h2><p>Start with the capabilities available now and use one workspace to manage operations and review activity.</p></div><div class="site-card-grid">${cards}</div>${link('/features', 'See all current features →', 'site-text-link')}</section>
      <section class="site-section site-steps"><div class="site-section-heading"><p class="site-eyebrow">HOW IT WORKS</p><h2>Get started in a few practical steps.</h2></div><ol><li><b>01</b><strong>Create your business account</strong><span>Set up an account and workspace.</span></li><li><b>02</b><strong>Add your business records</strong><span>Enter products, customers, suppliers and expenses.</span></li><li><b>03</b><strong>Use the tools that fit</strong><span>Record transactions, manage stock and issue invoices.</span></li><li><b>04</b><strong>Review business activity</strong><span>Use reports and dashboard summaries based on recorded data.</span></li></ol></section>
      <section class="site-security"><div><p class="site-eyebrow">BUSINESS DATA</p><h2>Access belongs in the right workspace.</h2><p>Authenticated business APIs check workspace membership. Financial documents are served through authenticated routes from private storage, not from the public website. Security controls vary by feature; no certification or regulatory compliance claim is made.</p></div>${link('/privacy', 'Read our privacy information →', 'site-text-link')}</section>
      ${cta()}`);
  }

  function about() {
    return layout(`<section class="site-page-hero"><p class="site-eyebrow">ABOUT WORKFLOWOS</p><h1>Business operations, made easier to see.</h1><p>WorkflowOS is a business management platform being built to help small businesses bring routine work and business records into one place.</p></section><section class="site-prose"><h2>Why WorkflowOS exists</h2><p>Small teams often spend valuable time switching between tools, keeping duplicate records and trying to piece together how the business is performing. WorkflowOS aims to reduce that repetitive administration by connecting everyday operational and financial records.</p><h2>Who it is for</h2><p>The platform is designed for local retailers, salons, service businesses and independent professionals who need a practical way to manage day-to-day work. The available tools are evolving; not every workflow is suitable for every business.</p><h2>How we approach the product</h2><p>We focus on clear workflows, usable interfaces and business data that stays scoped to the workspace. Owners should be able to review activity without needing to maintain multiple disconnected records.</p><h2>Company information</h2><p>Founder details, company history, registration information and customer figures have not been provided. These details will be published only after they are verified.</p></section>${cta()}`);
  }

  function features() {
    const grouped = [
      ['OPERATIONS', ['Sales & transactions', 'Products & inventory', 'Customers & invoices']],
      ['FINANCE', ['Expenses & suppliers', 'Reports']],
      ['PEOPLE', ['Employee records']],
    ].map(([group, titles]) => `<section class="site-feature-group"><p class="site-eyebrow">${group}</p><div class="site-card-grid">${implementedFeatures.filter(([title]) => titles.includes(title)).map(([title, description]) => `<article class="site-feature-card"><span aria-hidden="true">✓</span><h2>${title}</h2><p>${description}</p></article>`).join('')}</div></section>`).join('');
    return layout(`<section class="site-page-hero"><p class="site-eyebrow">CURRENT CAPABILITIES</p><h1>Tools for the work that keeps business moving.</h1><p>Explore the capabilities available in WorkflowOS today. Planned or incomplete workflows are not presented as live features.</p></section>${grouped}${cta()}`);
  }

  function solutions() {
    const cases = [
      ['Hair salons & barbers', 'Keep customer records, track service and product sales, manage stock and expenses, and review business activity. Payroll runs are owner-entered estimates; appointment booking is not currently available.'],
      ['Spaza shops & small retailers', 'Record sales, manage a product catalogue and stock, use barcode information, track suppliers and expenses, and review reports.'],
      ['Service businesses', 'Organise customer records, record sales, issue customer invoices, track payments and expenses, and review business reports.'],
      ['Independent professionals', 'Keep customer and invoice records together with expense and business activity reporting.'],
    ];
    return layout(`<section class="site-page-hero"><p class="site-eyebrow">SOLUTIONS</p><h1>Practical tools for local businesses.</h1><p>Workflows differ by business. These examples use current capabilities and call out important gaps.</p></section><section class="site-solution-grid">${cases.map(([title, description]) => `<article class="site-solution-card"><h2>${title}</h2><p>${description}</p></article>`).join('')}</section>${cta()}`);
  }

  function pricing() {
    return layout(`<section class="site-page-hero"><p class="site-eyebrow">PRICING</p><h1>Plan details are being configured.</h1><p>WorkflowOS pricing, limits and support levels have not yet been approved. We will publish them here when plan entitlements and subscription enforcement are ready.</p></section><section class="site-pricing-note"><h2>No unverified prices or limits</h2><p>There are no public prices, employee limits, storage allowances or subscription payment integrations to advertise yet. Contact us for product availability information.</p>${link('/contact', 'Ask about availability', 'site-button')}</section>${cta('See what WorkflowOS can do today.')}`);
  }

  function contact() {
    return layout(`<section class="site-page-hero"><p class="site-eyebrow">CONTACT</p><h1>Talk to us about WorkflowOS.</h1><p>Use this form to ask a question or share product feedback. Do not include passwords, bank details or other sensitive information.</p></section><section class="site-contact-panel"><form id="site-contact-form" class="site-contact-form"><label>Name<input name="name" maxlength="100" autocomplete="name" required /></label><label>Business name (optional)<input name="businessName" maxlength="191" autocomplete="organization" /></label><label>Email<input name="email" type="email" maxlength="191" autocomplete="email" required /></label><label>Phone (optional)<input name="phone" type="tel" maxlength="50" autocomplete="tel" /></label><label>Subject<input name="subject" maxlength="120" required /></label><label>Message<textarea name="message" rows="6" maxlength="5000" required></textarea></label><label class="site-trap" aria-hidden="true">Leave this field empty<input name="website" tabindex="-1" autocomplete="off" /></label><button class="site-button" type="submit">Send message</button><p class="site-form-status" id="site-contact-status" role="status" aria-live="polite"></p><small>Messages are sent using the configured email provider. If contact delivery is not configured, the form will explain that.</small></form></section>`);
  }

  function faq() {
    const questions = [
      ['What is WorkflowOS?', 'A business management platform for managing operational records and reviewing business activity.'],
      ['Which businesses can use it?', 'The current product is aimed at small retailers, salons, service businesses and independent professionals. Available workflows differ by business type.'],
      ['Can I manage inventory?', 'Yes. The application includes product and stock management, inventory adjustments and supplier stock receipts.'],
      ['Can I track expenses?', 'Yes. Businesses can record expenses, payments, suppliers and supplier invoices.'],
      ['Can I issue customer invoices?', 'Yes. Customer invoices can be issued, paid, credited and included in statements.'],
      ['Can I manage employees and payroll?', 'Business owners can manage employee records, attendance, leave, user-configured PAYE/UIF/SDL rules and monthly payroll estimates. Gross pay is entered manually. Finalised runs provide payslips to the owner and invited employees; owners can record external payments, but the app does not initiate transfers, calculate every employee-specific tax adjustment, or submit SARS returns. Rates are not preloaded.'],
      ['Can I view business reports?', 'Reports are available for sales, expenses, inventory, customers, receivables and payables.'],
      ['Is my business information protected?', 'Authenticated APIs check business workspace access. The product does not claim security certifications or regulatory compliance. Review the privacy page for current limitations.'],
      ['Can I access WorkflowOS on mobile?', 'The app and public pages are responsive and designed to work on mobile.'],
      ['How do I get started?', 'Create an account to establish a business workspace, then add your business records.'],
    ];
    return layout(`<section class="site-page-hero"><p class="site-eyebrow">HELP & ANSWERS</p><h1>Frequently asked questions.</h1></section><section class="site-faq">${questions.map(([question, answer]) => `<details><summary>${question}</summary><p>${answer}</p></details>`).join('')}</section>${cta()}`);
  }

  function privacy() {
    return layout(`<section class="site-page-hero"><p class="site-eyebrow">PRIVACY</p><h1>Privacy information</h1><p>This information describes current application behavior and is a draft for review. It is not legal advice or a substitute for an approved privacy notice.</p></section><section class="site-prose"><h2>Information in the workspace</h2><p>WorkflowOS processes account and business information entered by users, including customer, sales, product, inventory, invoice, expense and (where enabled) employee profile and compensation records.</p><h2>Access and storage</h2><p>Authenticated business APIs check workspace membership. Employee, attendance, leave, compensation and payroll administration are limited to the business owner. An invited employee account can access only its own finalised payslips. Invitation tokens are stored as hashes and expire after seven days; employers are responsible for sharing invitation links securely. Financial document files are stored outside the public web directory and served through authenticated routes. Deployment storage, backups, logs and email providers require appropriate operator controls.</p><h2>External providers</h2><p>Invoice email may use Resend when configured. Other external services may process information only where explicitly enabled. Do not submit confidential information to public contact forms.</p><h2>Retention and requests</h2><p>Retention periods, data-subject request handling, breach procedures and legal bases require review and configuration by the service operator. Contact details have not been supplied; a public contact address will be added when configured.</p><h2>Review required</h2><p>This draft must be reviewed and completed by the responsible business before production use.</p></section>`);
  }

  function terms() {
    return layout(`<section class="site-page-hero"><p class="site-eyebrow">TERMS</p><h1>Terms and conditions</h1><p>This is a draft placeholder, not an approved legal agreement. Do not rely on it as the terms governing a production service.</p></section><section class="site-prose"><h2>Service availability</h2><p>WorkflowOS is under active development. Features may be incomplete, unavailable or changed. Important business, payroll, tax and accounting decisions should not rely on the application without independent verification.</p><h2>Accounts and business data</h2><p>Users are responsible for authorised account use and for the accuracy and lawful handling of information they enter. The service operator must define account, data retention, support and termination procedures before production use.</p><h2>Pricing and subscriptions</h2><p>Pricing and subscription terms have not been approved or published.</p><h2>Legal review required</h2><p>Governing law, limitation of liability, warranties, privacy obligations and dispute procedures must be supplied and reviewed by qualified counsel before launch.</p></section>`);
  }

  function landingPage(path) {
    const page = pages[path] || pages['/'];
    document.title = page.title;
    document.body.classList.add('public-body');
    document.getElementById('app').innerHTML = page.render();
    const menuButton = document.querySelector('.site-menu-button');
    menuButton?.addEventListener('click', () => {
      const open = menuButton.getAttribute('aria-expanded') !== 'true';
      menuButton.setAttribute('aria-expanded', String(open));
      document.getElementById('site-navigation')?.classList.toggle('site-nav-open', open);
    });
    const form = document.getElementById('site-contact-form');
    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = form.querySelector('button[type="submit"]');
      const status = document.getElementById('site-contact-status');
      button.disabled = true;
      status.textContent = 'Sending…';
      status.className = 'site-form-status';
      try {
        const response = await fetch('/api/contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(Object.fromEntries(new FormData(form).entries())),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'The message could not be sent.');
        form.reset();
        status.textContent = 'Your message was sent.';
        status.classList.add('site-form-success');
      } catch (error) {
        status.textContent = error.message;
        status.classList.add('site-form-error');
      } finally {
        button.disabled = false;
      }
    });
  }

  window.renderPublicSite = landingPage;
})();
