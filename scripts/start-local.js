const { spawn } = require('node:child_process');
const app = require('../server');

const port = Number(process.env.PORT || 3000);

app.startServer(port)
  .then((server) => {
    const actualPort = server.address().port;
    const url = `http://localhost:${actualPort}`;
    const command = process.platform === 'win32' ? 'cmd' : 'open';
    const args = process.platform === 'win32'
      ? ['/c', 'start', '', url]
      : [url];

    spawn(command, args, {
      stdio: 'ignore',
      detached: true,
    }).unref();

    console.log(`Opening WorkflowOS in the browser: ${url}`);
  })
  .catch((error) => {
    console.error('Unable to start WorkflowOS:', error.message);
    process.exit(1);
  });
