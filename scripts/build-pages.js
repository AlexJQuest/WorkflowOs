const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.join(__dirname, '..');
const publicDir = path.join(projectRoot, 'public');
const outputDir = path.join(projectRoot, 'dist');
const basePath = '/WorkflowOs/';

if (!fs.existsSync(path.join(publicDir, 'index.html'))) {
  throw new Error('Missing public/index.html');
}

fs.rmSync(outputDir, { recursive: true, force: true });
fs.cpSync(publicDir, outputDir, { recursive: true });

const indexPath = path.join(outputDir, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');

html = html
  .replace('href="/styles.css"', 'href="/WorkflowOs/styles.css"')
  .replace('src="/app.js"', 'src="/WorkflowOs/app.js"');

fs.writeFileSync(indexPath, html);
fs.copyFileSync(indexPath, path.join(outputDir, '404.html'));

const appPath = path.join(outputDir, 'app.js');
let app = fs.readFileSync(appPath, 'utf8');

app = app.replace(
  "const app = document.getElementById('app');",
  `const BASE_PATH = '${basePath}';\nconst app = document.getElementById('app');`
);

app = app.replace(
  "function escapeHtml(value) {",
  `function appPath(path) {
  return BASE_PATH + String(path || '').replace(/^\\/+/, '');
}

function navigate(path, replace = false) {
  const url = appPath(path);
  if (replace) history.replaceState({}, '', url);
  else history.pushState({}, '', url);
}

function escapeHtml(value) {`
);

app = app.replaceAll("history.pushState({}, '', path);", "navigate(path);");
app = app.replaceAll("history.replaceState({}, '', '/dashboard');", "navigate('/dashboard', true);");
app = app.replaceAll("history.replaceState({}, '', '/login');", "navigate('/login', true);");
app = app.replaceAll("location.pathname !== '/dashboard' && location.pathname !== '/'", "location.pathname !== appPath('/dashboard') && location.pathname !== BASE_PATH");
app = app.replaceAll("location.pathname === '/'", "location.pathname === BASE_PATH");
app = app.replaceAll('href="/"', 'href="/WorkflowOs/"');
app = app.replaceAll('href="/dashboard"', 'href="/WorkflowOs/dashboard"');

fs.writeFileSync(appPath, app);

console.log('WorkflowOS GitHub Pages build completed.');
console.log(`Output directory: ${outputDir}`);
console.log(`Base path: ${basePath}`);

