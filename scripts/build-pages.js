
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.join(__dirname, '..');
const publicDir = path.join(projectRoot, 'public');
const outputDir = path.join(projectRoot, 'dist');

if (!fs.existsSync(path.join(publicDir, 'index.html'))) {
  throw new Error('Missing public/index.html');
}

fs.rmSync(outputDir, { recursive: true, force: true });
fs.cpSync(publicDir, outputDir, { recursive: true });

console.log('WorkflowOS GitHub Pages build completed.');
console.log(`Output directory: ${outputDir}`);
