const deployHookUrl = process.env.DEPLOY_HOOK_URL;

if (!deployHookUrl) {
  console.log('Deployment skipped: configure DEPLOY_HOOK_URL in the production GitHub environment to enable deployment.');
  process.exit(0);
}

let parsedUrl;
try {
  parsedUrl = new URL(deployHookUrl);
} catch {
  console.error('Deployment failed: DEPLOY_HOOK_URL is not a valid URL.');
  process.exit(1);
}

if (parsedUrl.protocol !== 'https:') {
  console.error('Deployment failed: DEPLOY_HOOK_URL must use HTTPS.');
  process.exit(1);
}

fetch(parsedUrl, { method: 'POST' })
  .then((response) => {
    if (!response.ok) {
      console.error(`Deployment hook failed with HTTP ${response.status}.`);
      process.exitCode = 1;
      return;
    }

    console.log(`Deployment hook accepted the request (HTTP ${response.status}).`);
  })
  .catch(() => {
    console.error('Deployment hook request failed. Check provider status and workflow configuration.');
    process.exitCode = 1;
  });
