const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const deployScript = path.join(__dirname, '..', 'scripts', 'deploy-hook.js');

test('deployment hook skips safely when no provider hook is configured', () => {
  const env = { ...process.env };
  delete env.DEPLOY_HOOK_URL;

  const result = spawnSync(process.execPath, [deployScript], { env, encoding: 'utf8' });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Deployment skipped/);
});

test('deployment hook rejects non-HTTPS URLs before making a request', () => {
  const result = spawnSync(process.execPath, [deployScript], {
    env: { ...process.env, DEPLOY_HOOK_URL: 'http://example.test/deploy' },
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /must use HTTPS/);
});
