const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const dbDir = path.join(__dirname, 'db');
fs.mkdirSync(dbDir, { recursive: true });

const db = new DatabaseSync(path.join(dbDir, 'tutorhub.sqlite'));

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('student','tutor')),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tutor_profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  headline TEXT,
  bio TEXT,
  subjects TEXT,
  hourly_rate REAL DEFAULT 20,
  photo_seed TEXT
);

CREATE TABLE IF NOT EXISTS availability (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tutor_id INTEGER NOT NULL REFERENCES users(id),
  slot_date TEXT NOT NULL,
  slot_time TEXT NOT NULL,
  is_booked INTEGER DEFAULT 0,
  UNIQUE(tutor_id, slot_date, slot_time)
);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES users(id),
  tutor_id INTEGER NOT NULL REFERENCES users(id),
  availability_id INTEGER NOT NULL REFERENCES availability(id),
  status TEXT DEFAULT 'confirmed',
  created_at TEXT DEFAULT (datetime('now'))
);
`);

// Seed demo data on first run
const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
if (userCount === 0) {
  const insertUser = db.prepare(
    'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)'
  );
  const insertProfile = db.prepare(
    'INSERT INTO tutor_profiles (user_id, headline, bio, subjects, hourly_rate, photo_seed) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const insertSlot = db.prepare(
    'INSERT INTO availability (tutor_id, slot_date, slot_time) VALUES (?, ?, ?)'
  );

  const demoTutors = [
    {
      name: 'Amara Chen',
      email: 'amara@tutorhub.demo',
      headline: 'Spanish & French Conversation Coach',
      bio: 'Certified language instructor with 8 years of experience helping adult learners build real conversational fluency.',
      subjects: 'Spanish, French',
      rate: 28,
    },
    {
      name: 'Diego Alvarez',
      email: 'diego@tutorhub.demo',
      headline: 'Math & Physics Tutor',
      bio: 'Former engineer turned tutor. I specialize in making calculus and physics click for high school and college students.',
      subjects: 'Calculus, Physics, Algebra',
      rate: 32,
    },
    {
      name: 'Priya Nair',
      email: 'priya@tutorhub.demo',
      headline: 'English & IELTS Prep Specialist',
      bio: 'I help students build confidence in written and spoken English, with a focus on test prep and business communication.',
      subjects: 'English, IELTS, Business Writing',
      rate: 25,
    },
  ];

  const pass = bcrypt.hashSync('password123', 10);
  const today = new Date();

  demoTutors.forEach((t, idx) => {
    const info = insertUser.run(t.name, t.email, pass, 'tutor');
    const tutorId = info.lastInsertRowid;
    insertProfile.run(tutorId, t.headline, t.bio, t.subjects, t.rate, String(idx + 1));

    for (let d = 1; d <= 5; d++) {
      const date = new Date(today);
      date.setDate(date.getDate() + d);
      const dateStr = date.toISOString().slice(0, 10);
      ['10:00', '14:00', '17:00'].forEach((time) => {
        insertSlot.run(tutorId, dateStr, time);
      });
    }
  });

  insertUser.run('Sam Rivera', 'student@tutorhub.demo', pass, 'student');
}

module.exports = db;
