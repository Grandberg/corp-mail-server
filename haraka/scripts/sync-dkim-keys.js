#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { getPool } = require('../plugins/db');

const DKIM_DIR = path.join(__dirname, '..', 'config', 'dkim');

async function main() {
  const db = getPool();
  const { rows } = await db.query(
    `SELECT domain_name, dkim_private_key, dkim_selector
     FROM domains
     WHERE dkim_private_key IS NOT NULL
       AND TRIM(dkim_private_key) <> ''
       AND is_active = true`,
  );

  fs.mkdirSync(DKIM_DIR, { recursive: true });

  let synced = 0;
  for (const row of rows) {
    const domain = String(row.domain_name).trim().toLowerCase();
    if (!domain) continue;

    const domainDir = path.join(DKIM_DIR, domain);
    fs.mkdirSync(domainDir, { recursive: true });

    const privateKey = String(row.dkim_private_key).trim();
    const selector = String(row.dkim_selector || 'mail').trim() || 'mail';

    fs.writeFileSync(path.join(domainDir, 'private'), `${privateKey}\n`, { mode: 0o600 });
    fs.writeFileSync(path.join(domainDir, 'selector'), selector);

    console.log(`[dkim-sync] ${domain} (selector=${selector})`);
    synced += 1;
  }

  console.log(`[dkim-sync] synced ${synced} domain(s)`);
  await db.end();
}

main().catch((err) => {
  console.error('[dkim-sync] failed:', err.message);
  process.exit(1);
});
