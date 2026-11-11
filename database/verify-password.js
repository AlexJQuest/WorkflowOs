const bcrypt = require('bcryptjs');
const readline = require('node:readline');

const hash = '$2a$10$lGXn1w0TIAeTpkw.ua0kxu2gpOYyV4n1Db1Y8na1oJLgomKBp1zfm';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('Enter password to test: ', async (password) => {
  const matches = await bcrypt.compare(password, hash);

  console.log(matches ? 'PASSWORD MATCH' : 'PASSWORD DOES NOT MATCH');

  rl.close();
});