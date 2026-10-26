// Usage: npm run make-admin -- someone@example.com
import { config } from '../src/config.js';
import { openDb } from '../src/db.js';

const email = process.argv[2];
if (!email) {
  console.error('Usage: npm run make-admin -- <email>');
  process.exit(1);
}
const db = openDb(config.dbPath);
const info = db.prepare("UPDATE users SET role = 'admin' WHERE email = ?").run(email);
console.log(info.changes ? `${email} is now an admin.` : `No user found with email ${email}.`);
db.close();
