# TutorHub

A fully functional tutoring booking platform (Preply-style) with a maize-branded UI.

## Features

- Public landing page, tutor directory with search, and tutor profile pages
- Student & tutor accounts (signup/login/logout) with hashed passwords
- Students browse tutors and book open time slots
- Tutors manage availability and see upcoming sessions
- Both roles can cancel bookings from their dashboard
- Demo data seeded automatically on first run

## Requirements

- Node.js **20.10+** (uses the built-in `node:sqlite` module — no native build tools needed)

## Setup

```bash
cd tutorhub
npm install
npm start
```

Then open **http://localhost:3000**.

The database (`db/tutorhub.sqlite`) is created automatically on first run and seeded with 3 demo tutors and 1 demo student.

## Demo logins

| Role    | Email                    | Password      |
|---------|---------------------------|---------------|
| Student | student@tutorhub.demo    | password123   |
| Tutor   | amara@tutorhub.demo      | password123   |
| Tutor   | diego@tutorhub.demo      | password123   |
| Tutor   | priya@tutorhub.demo      | password123   |

## Project structure

```
tutorhub/
  server.js          Express app + routes (auth, tutors, booking, dashboards)
  db.js               SQLite schema + demo data seeding
  views/              EJS templates
  public/css/         Maize-branded stylesheet
  db/                 SQLite database file lives here (auto-created)
```

## Notes / next steps

- Change `secret: 'tutorhub-maize-secret'` in `server.js` before deploying publicly.
- To reset all data, stop the server and delete `db/tutorhub.sqlite`, then restart.
- To deploy, host on any Node-friendly platform (Render, Railway, Fly.io, a VPS) and set `PORT` via environment variable if needed.
