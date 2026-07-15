const fs = require('fs');
const { Pool } = require('pg');

let pool;

function readSecret(name, fileEnv) {
  const file = process.env[fileEnv];
  if (file && fs.existsSync(file)) {
    return fs.readFileSync(file, 'utf8').trim();
  }
  return process.env[name] || '';
}

function getPool() {
  if (pool) return pool;
  let url = readSecret('DATABASE_URL', 'DATABASE_URL_FILE');
  if (!url) throw new Error('DATABASE_URL not configured for Haraka');
  pool = new Pool({ connectionString: url, max: 5 });
  return pool;
}

exports.readSecret = readSecret;
exports.getPool = getPool;
