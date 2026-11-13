
const allowedEnvironments = ['DEV', 'TEST', 'STD', 'LIVE'];

const environment = String(
  process.env.APP_ENV || 'DEV'
).toUpperCase();

if (!allowedEnvironments.includes(environment)) {
  throw new Error(`Invalid APP_ENV: ${environment}`);
}

const isProduction = environment === 'LIVE';

module.exports = {
  environment,
  isProduction,
  isTest: environment === 'TEST',
  isStandard: environment === 'STD',
  isLive: environment === 'LIVE',

  allowPublicRegistration: environment === 'LIVE',

  requireTestInvitation: environment === 'TEST',

  allowDemoAccounts: environment === 'STD',
};
