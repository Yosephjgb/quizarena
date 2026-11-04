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
  // Technology
  ['Which data structure follows FIFO (first in, first out) ordering?', ['Stack', 'Queue', 'Tree', 'Graph'], 1, 'Technology', 15],
  ['What does HTTP status code 404 mean?', ['Server error', 'Forbidden', 'Not Found', 'Redirect'], 2, 'Technology', 15],
  ['Which SQL keyword removes duplicate rows from a result?', ['UNIQUE', 'DISTINCT', 'GROUP', 'LIMIT'], 1, 'Technology', 15],
  ['What is the time complexity of binary search?', ['O(n)', 'O(n log n)', 'O(log n)', 'O(1)'], 2, 'Technology', 20],
  ['Which protocol is used for secure web browsing?', ['FTP', 'HTTP', 'SMTP', 'HTTPS'], 3, 'Technology', 15],
  ['What does CSS stand for?', ['Cascading Style Sheets', 'Computer Style Syntax', 'Creative Style System', 'Coded Site Styles'], 0, 'Technology', 15],
  ['Which Git command copies a remote repository to your machine?', ['git push', 'git init', 'git clone', 'git merge'], 2, 'Technology', 15],
  ['Which of these is NOT a programming paradigm?', ['Object-oriented', 'Functional', 'Alphabetical', 'Procedural'], 2, 'Technology', 20],
  ['What does RAM stand for?', ['Random Access Memory', 'Read Only Memory', 'Rapid Allocation Module', 'Run And Manage'], 0, 'Technology', 15],
  ['What is the default port for HTTPS?', ['21', '80', '443', '8080'], 2, 'Technology', 15],
  ['Which HTTP method is normally used to create a new resource?', ['GET', 'POST', 'DELETE', 'HEAD'], 1, 'Technology', 15],
  ['What is the decimal number 5 in binary?', ['100', '110', '111', '101'], 3, 'Technology', 20],
  ['What does API stand for?', ['Application Programming Interface', 'Automated Program Instruction', 'Application Process Integration', 'Advanced Programming Input'], 0, 'Technology', 15],
  ['Which company developed the Android operating system?', ['Apple', 'Microsoft', 'Google', 'Samsung'], 2, 'Technology', 15],
  ['What does SSD stand for in computing?', ['Solid State Drive', 'System Storage Device', 'Super Speed Disk', 'Secure System Data'], 0, 'Technology', 15],
  // World Geography
  ['What is the capital city of Japan?', ['Osaka', 'Kyoto', 'Tokyo', 'Hiroshima'], 2, 'World Geography', 15],
  ['Which is the largest continent by area?', ['Africa', 'North America', 'Europe', 'Asia'], 3, 'World Geography', 15],
  ['What is the longest river in the world?', ['Amazon', 'Nile', 'Yangtze', 'Mississippi'], 1, 'World Geography', 20],
  ['Which country has the most population in the world?', ['USA', 'Indonesia', 'India', 'Brazil'], 2, 'World Geography', 15],
  ['What is the smallest country in the world by area?', ['Monaco', 'Vatican City', 'San Marino', 'Liechtenstein'], 1, 'World Geography', 15],
  ['Which desert is the largest hot desert on Earth?', ['Gobi', 'Kalahari', 'Sahara', 'Arabian'], 2, 'World Geography', 20],
  ['In which country is the Great Barrier Reef located?', ['New Zealand', 'Australia', 'Indonesia', 'Philippines'], 1, 'World Geography', 15],
  ['What is the capital city of Brazil?', ['Rio de Janeiro', 'São Paulo', 'Brasília', 'Salvador'], 2, 'World Geography', 15],
  // Science
  ['Which planet is the largest in our solar system?', ['Saturn', 'Earth', 'Jupiter', 'Neptune'], 2, 'Science', 15],
  ['What is the chemical formula of water?', ['CO2', 'H2O', 'O2', 'NaCl'], 1, 'Science', 15],
  ['How many continents are there?', ['5', '6', '8', '7'], 3, 'Science', 15],
  ['Which planet is known as the Red Planet?', ['Mars', 'Venus', 'Mercury', 'Uranus'], 0, 'Science', 15],
  ['What is the fastest land animal?', ['Lion', 'Cheetah', 'Horse', 'Leopard'], 1, 'Science', 15],
  ['What is the square root of 144?', ['10', '11', '12', '14'], 2, 'Science', 15],
  ['What gas do plants absorb from the atmosphere during photosynthesis?', ['Oxygen', 'Nitrogen', 'Carbon Dioxide', 'Hydrogen'], 2, 'Science', 15],
  ['What is the hardest natural substance on Earth?', ['Gold', 'Iron', 'Diamond', 'Platinum'], 2, 'Science', 15],
  ['Which element has the chemical symbol Fe?', ['Fluorine', 'Iron', 'Francium', 'Fermium'], 1, 'Science', 20],
  // History
  ['In which year did World War II end?', ['1943', '1944', '1945', '1946'], 2, 'History', 15],
  ['Who was the first President of the United States?', ['Thomas Jefferson', 'George Washington', 'Abraham Lincoln', 'John Adams'], 1, 'History', 15],
  ['Which ancient civilization built the pyramids at Giza?', ['Romans', 'Greeks', 'Mesopotamians', 'Egyptians'], 3, 'History', 15],
  ['The Renaissance period began in which country?', ['France', 'England', 'Italy', 'Spain'], 2, 'History', 20],
  ['Who discovered penicillin?', ['Marie Curie', 'Louis Pasteur', 'Alexander Fleming', 'Joseph Lister'], 2, 'History', 20],
  ['Which empire was ruled by Genghis Khan?', ['Ottoman Empire', 'Roman Empire', 'Mongol Empire', 'Persian Empire'], 2, 'History', 15],
  ['In what year did the Berlin Wall fall?', ['1987', '1989', '1991', '1993'], 1, 'History', 15],
  ['Which country was the first to land a human on the Moon?', ['Soviet Union', 'United States', 'China', 'United Kingdom'], 1, 'History', 15],
  // Sports
  ['How many players are on a standard soccer team on the field?', ['9', '10', '11', '12'], 2, 'Sports', 15],
  ['In which sport is the term "love" used to mean zero?', ['Badminton', 'Tennis', 'Cricket', 'Golf'], 1, 'Sports', 15],
  ['Which country has won the most FIFA World Cup titles?', ['Germany', 'Argentina', 'Brazil', 'Italy'], 2, 'Sports', 15],
  ['How many rings are on the Olympic flag?', ['4', '5', '6', '7'], 1, 'Sports', 15],
  ['In basketball, how many points is a shot from beyond the arc worth?', ['1', '2', '3', '4'], 2, 'Sports', 15],
  ['Which Grand Slam tennis tournament is played on clay courts?', ['Wimbledon', 'US Open', 'French Open', 'Australian Open'], 2, 'Sports', 20],
  // Entertainment
  ['Who directed the movie "Jurassic Park"?', ['James Cameron', 'Steven Spielberg', 'Ridley Scott', 'George Lucas'], 1, 'Entertainment', 15],
  ['Which band released the album "Abbey Road"?', ['The Rolling Stones', 'The Beatles', 'Led Zeppelin', 'Pink Floyd'], 1, 'Entertainment', 15],
  ['What is the name of the fictional wizarding school in Harry Potter?', ['Durmstrang', 'Beauxbatons', 'Hogwarts', 'Ilvermorny'], 2, 'Entertainment', 15],
  ['Which animated movie features a character named Simba?', ['Finding Nemo', 'Shrek', 'The Lion King', 'Aladdin'], 2, 'Entertainment', 15],
  ['In the TV show "Friends", what is the name of Ross and Monica\'s dog as kids?', ['Buddy', 'Chi-Chi', 'Rex', 'LaPooh'], 3, 'Entertainment', 20],
  ['Which superhero is known as the "Man of Steel"?', ['Batman', 'Iron Man', 'Superman', 'Captain America'], 2, 'Entertainment', 15],
  // Guess the Flag
  ['Which country does this flag belong to?\n[image:/flags/fr.svg]', ['Italy', 'France', 'Netherlands', 'Russia'], 1, 'Flags', 15],
  ['Which country does this flag belong to?\n[image:/flags/de.svg]', ['Belgium', 'Germany', 'Austria', 'Poland'], 1, 'Flags', 15],
  ['Which country does this flag belong to?\n[image:/flags/jp.svg]', ['South Korea', 'China', 'Japan', 'Bangladesh'], 2, 'Flags', 15],
  ['Which country does this flag belong to?\n[image:/flags/it.svg]', ['Ireland', 'Hungary', 'Italy', 'Mexico'], 2, 'Flags', 15],
  ['Which country does this flag belong to?\n[image:/flags/ca.svg]', ['Canada', 'Denmark', 'Switzerland', 'Peru'], 0, 'Flags', 15],
  ['Which country does this flag belong to?\n[image:/flags/br.svg]', ['Colombia', 'Brazil', 'South Africa', 'Jamaica'], 1, 'Flags', 15],
  ['Which country does this flag belong to?\n[image:/flags/ar.svg]', ['Uruguay', 'Guatemala', 'Argentina', 'Honduras'], 2, 'Flags', 15],
  ['Which country does this flag belong to?\n[image:/flags/gb.svg]', ['Australia', 'New Zealand', 'United Kingdom', 'Iceland'], 2, 'Flags', 15],
  ['Which country does this flag belong to?\n[image:/flags/es.svg]', ['Portugal', 'Spain', 'Venezuela', 'Ecuador'], 1, 'Flags', 15],
  ['Which country does this flag belong to?\n[image:/flags/kr.svg]', ['Japan', 'North Korea', 'South Korea', 'Singapore'], 2, 'Flags', 15],
  ['Which country does this flag belong to?\n[image:/flags/se.svg]', ['Finland', 'Norway', 'Sweden', 'Denmark'], 2, 'Flags', 15],
  ['Which country does this flag belong to?\n[image:/flags/ch.svg]', ['Austria', 'Switzerland', 'Czech Republic', 'Malta'], 1, 'Flags', 15],
  ['Which country does this flag belong to?\n[image:/flags/us.svg]', ['Liberia', 'Malaysia', 'United States', 'Chile'], 2, 'Flags', 15],
  ['Which country does this flag belong to?\n[image:/flags/gr.svg]', ['Cyprus', 'Greece', 'Israel', 'Finland'], 1, 'Flags', 15],
  ['Which country does this flag belong to?\n[image:/flags/tr.svg]', ['Tunisia', 'Turkey', 'Algeria', 'Azerbaijan'], 1, 'Flags', 15],
  ['Which country does this flag belong to?\n[image:/flags/mx.svg]', ['Italy', 'Bolivia', 'Mexico', 'Peru'], 2, 'Flags', 15],
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
