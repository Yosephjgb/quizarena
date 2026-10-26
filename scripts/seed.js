// Usage: npm run seed
// Loads sample questions and creates an admin account (credentials from env or defaults below).
import bcrypt from 'bcryptjs';
import { config } from '../src/config.js';
import { openDb } from '../src/db.js';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@example.com';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin12345';

// [text, [options], correctIndex, category, timeLimitSeconds]
const QUESTIONS = [
  // Computer Science
  ['Which data structure follows FIFO (first in, first out) ordering?', ['Stack', 'Queue', 'Tree', 'Graph'], 1, 'Computer Science', 15],
  ['What does HTTP status code 404 mean?', ['Server error', 'Forbidden', 'Not Found', 'Redirect'], 2, 'Computer Science', 15],
  ['Which SQL keyword removes duplicate rows from a result?', ['UNIQUE', 'DISTINCT', 'GROUP', 'LIMIT'], 1, 'Computer Science', 15],
  ['What is the time complexity of binary search?', ['O(n)', 'O(n log n)', 'O(log n)', 'O(1)'], 2, 'Computer Science', 20],
  ['Which protocol is used for secure web browsing?', ['FTP', 'HTTP', 'SMTP', 'HTTPS'], 3, 'Computer Science', 15],
  ['What does CSS stand for?', ['Cascading Style Sheets', 'Computer Style Syntax', 'Creative Style System', 'Coded Site Styles'], 0, 'Computer Science', 15],
  ['Which Git command copies a remote repository to your machine?', ['git push', 'git init', 'git clone', 'git merge'], 2, 'Computer Science', 15],
  ['Which of these is NOT a programming paradigm?', ['Object-oriented', 'Functional', 'Alphabetical', 'Procedural'], 2, 'Computer Science', 20],
  ['What does RAM stand for?', ['Random Access Memory', 'Read Only Memory', 'Rapid Allocation Module', 'Run And Manage'], 0, 'Computer Science', 15],
  ['What is the default port for HTTPS?', ['21', '80', '443', '8080'], 2, 'Computer Science', 15],
  ['Which HTTP method is normally used to create a new resource?', ['GET', 'POST', 'DELETE', 'HEAD'], 1, 'Computer Science', 15],
  ['What is the decimal number 5 in binary?', ['100', '110', '111', '101'], 3, 'Computer Science', 20],
  // Ethiopia
  ['What is the capital city of Ethiopia?', ['Hawassa', 'Addis Ababa', 'Bahir Dar', 'Mekelle'], 1, 'Ethiopia', 15],
  ['How many months are in the Ethiopian calendar?', ['10', '12', '13', '14'], 2, 'Ethiopia', 20],
  ['Which lake is the source of the Blue Nile?', ['Lake Tana', 'Lake Victoria', 'Lake Abaya', 'Lake Ziway'], 0, 'Ethiopia', 20],
  ['What is the highest mountain in Ethiopia?', ['Mount Kenya', 'Ras Dashen', 'Kilimanjaro', 'Mount Entoto'], 1, 'Ethiopia', 20],
  ['What is the currency of Ethiopia?', ['Shilling', 'Nakfa', 'Birr', 'Rand'], 2, 'Ethiopia', 15],
  ['Which Ethiopian town is famous for its rock-hewn churches?', ['Lalibela', 'Adama', 'Jimma', 'Dessie'], 0, 'Ethiopia', 15],
  ['Which popular drink is believed to have originated in Ethiopia?', ['Tea', 'Coffee', 'Cocoa', 'Cola'], 1, 'Ethiopia', 15],
  ['In which year was the Battle of Adwa fought?', ['1935', '1974', '1896', '1991'], 2, 'Ethiopia', 20],
  // General
  ['Which planet is the largest in our solar system?', ['Saturn', 'Earth', 'Jupiter', 'Neptune'], 2, 'General', 15],
  ['What is the chemical formula of water?', ['CO2', 'H2O', 'O2', 'NaCl'], 1, 'General', 15],
  ['How many continents are there?', ['5', '6', '8', '7'], 3, 'General', 15],
  ['Which planet is known as the Red Planet?', ['Mars', 'Venus', 'Mercury', 'Uranus'], 0, 'General', 15],
  ['What is the fastest land animal?', ['Lion', 'Cheetah', 'Horse', 'Leopard'], 1, 'General', 15],
  ['What is the square root of 144?', ['10', '11', '12', '14'], 2, 'General', 15],
];

const db = openDb(config.dbPath);

const admin = db.prepare('SELECT id FROM users WHERE email = ?').get(ADMIN_EMAIL);
let adminId = admin?.id;
if (!admin) {
  adminId = db
    .prepare("INSERT INTO users (email, username, password_hash, role) VALUES (?, ?, ?, 'admin')")
    .run(ADMIN_EMAIL, ADMIN_USERNAME, bcrypt.hashSync(ADMIN_PASSWORD, 10)).lastInsertRowid;
  console.log(`Created admin: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}  (change this password!)`);
} else {
  db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(adminId);
  console.log(`Admin ${ADMIN_EMAIL} already exists.`);
}

const exists = db.prepare('SELECT 1 FROM questions WHERE text = ?');
const insert = db.prepare(
  'INSERT INTO questions (text, options, correct_index, category, time_limit, created_by) VALUES (?,?,?,?,?,?)'
);
let added = 0;
db.transaction(() => {
  for (const [text, options, correct, category, time] of QUESTIONS) {
    if (exists.get(text)) continue;
    insert.run(text, JSON.stringify(options), correct, category, time, adminId);
    added++;
  }
})();
console.log(`Added ${added} new questions (${QUESTIONS.length - added} already existed).`);
db.close();
