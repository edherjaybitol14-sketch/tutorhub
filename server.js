const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const expressLayouts = require('express-ejs-layouts');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- Cloudinary (video storage) ----------
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});
const cloudinaryConfigured = Boolean(
  process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET
);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

function uploadVideoBuffer(buffer) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { resource_type: 'video', folder: 'tutorhub-intros' },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    stream.end(buffer);
  });
}

// ---------- Stripe (payments) ----------
const stripeConfigured = Boolean(process.env.STRIPE_SECRET_KEY);
const stripe = stripeConfigured ? require('stripe')(process.env.STRIPE_SECRET_KEY) : null;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layout');

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(
  session({
    secret: 'tutorhub-maize-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 8 },
  })
);

// Make current user + flash-ish messages available in all views
app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.error = req.query.error || null;
  res.locals.success = req.query.success || null;
  next();
});

function requireAuth(role) {
  return (req, res, next) => {
    if (!req.session.user) return res.redirect('/login?error=Please log in first');
    if (role && req.session.user.role !== role) {
      return res.redirect('/?error=You do not have access to that page');
    }
    next();
  };
}

// ---------- Public pages ----------

app.get('/', (req, res) => {
  const tutors = db
    .prepare(
      `SELECT u.id, u.name, tp.headline, tp.subjects, tp.hourly_rate, tp.photo_seed
       FROM users u JOIN tutor_profiles tp ON tp.user_id = u.id
       LIMIT 3`
    )
    .all();
  res.render('landing', { title: 'TutorHub — Learn, your way', tutors });
});

app.get('/tutors', (req, res) => {
  const q = (req.query.q || '').trim().toLowerCase();
  let tutors = db
    .prepare(
      `SELECT u.id, u.name, tp.headline, tp.bio, tp.subjects, tp.hourly_rate, tp.photo_seed
       FROM users u JOIN tutor_profiles tp ON tp.user_id = u.id`
    )
    .all();
  if (q) {
    tutors = tutors.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.subjects.toLowerCase().includes(q) ||
        t.headline.toLowerCase().includes(q)
    );
  }
  res.render('tutors', { title: 'Find a tutor', tutors, q: req.query.q || '' });
});

app.get('/tutors/:id', (req, res) => {
  const tutor = db
    .prepare(
      `SELECT u.id, u.name, tp.headline, tp.bio, tp.subjects, tp.hourly_rate, tp.photo_seed, tp.intro_video_url
       FROM users u JOIN tutor_profiles tp ON tp.user_id = u.id WHERE u.id = ?`
    )
    .get(req.params.id);
  if (!tutor) return res.redirect('/tutors?error=Tutor not found');

  const slots = db
    .prepare(
      `SELECT id, slot_date, slot_time FROM availability
       WHERE tutor_id = ? AND is_booked = 0 AND slot_date >= date('now')
       ORDER BY slot_date, slot_time`
    )
    .all(req.params.id);

  res.render('tutor-profile', { title: tutor.name, tutor, slots });
});

// ---------- Auth ----------

app.get('/signup', (req, res) => {
  res.render('signup', { title: 'Create your account' });
});

app.post('/signup', (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password || !role) {
    return res.redirect('/signup?error=All fields are required');
  }
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return res.redirect('/signup?error=An account with that email already exists');

  const hashed = bcrypt.hashSync(password, 10);
  const info = db
    .prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)')
    .run(name, email, hashed, role);

  if (role === 'tutor') {
    db.prepare(
      `INSERT INTO tutor_profiles (user_id, headline, bio, subjects, hourly_rate, photo_seed)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(info.lastInsertRowid, 'New Tutor', 'Tell students about yourself in your profile.', 'General', 20, String(info.lastInsertRowid));
  }

  req.session.user = { id: info.lastInsertRowid, name, email, role };
  res.redirect('/dashboard');
});

app.get('/login', (req, res) => {
  res.render('login', { title: 'Log in' });
});

app.post('/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.redirect('/login?error=Invalid email or password');
  }
  req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role };
  res.redirect('/dashboard');
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// ---------- Tutor profile editing ----------

app.get('/profile/edit', requireAuth('tutor'), (req, res) => {
  const profile = db.prepare('SELECT * FROM tutor_profiles WHERE user_id = ?').get(req.session.user.id);
  res.render('profile-edit', { title: 'Edit your profile', profile, cloudinaryConfigured });
});

app.post('/profile/edit', requireAuth('tutor'), upload.single('intro_video'), async (req, res) => {
  const { headline, bio, subjects, hourly_rate } = req.body;
  if (!headline || !bio || !subjects || !hourly_rate) {
    return res.redirect('/profile/edit?error=Please fill in all fields');
  }

  let videoUrl = null;
  if (req.file) {
    if (!cloudinaryConfigured) {
      return res.redirect('/profile/edit?error=Video upload is not configured yet');
    }
    try {
      const result = await uploadVideoBuffer(req.file.buffer);
      videoUrl = result.secure_url;
    } catch (e) {
      return res.redirect('/profile/edit?error=Video upload failed — try a smaller file');
    }
  }

  if (videoUrl) {
    db.prepare(
      `UPDATE tutor_profiles SET headline = ?, bio = ?, subjects = ?, hourly_rate = ?, intro_video_url = ?
       WHERE user_id = ?`
    ).run(headline, bio, subjects, hourly_rate, videoUrl, req.session.user.id);
  } else {
    db.prepare(
      `UPDATE tutor_profiles SET headline = ?, bio = ?, subjects = ?, hourly_rate = ?
       WHERE user_id = ?`
    ).run(headline, bio, subjects, hourly_rate, req.session.user.id);
  }

  res.redirect('/dashboard?success=Profile updated');
});

// ---------- Dashboard ----------

app.get('/dashboard', requireAuth(), (req, res) => {
  const user = req.session.user;
  if (user.role === 'tutor') {
    const upcoming = db
      .prepare(
        `SELECT b.id as booking_id, a.slot_date, a.slot_time, u.name as student_name,
                b.payment_status, b.amount
         FROM bookings b
         JOIN availability a ON a.id = b.availability_id
         JOIN users u ON u.id = b.student_id
         WHERE b.tutor_id = ? AND a.slot_date >= date('now')
         ORDER BY a.slot_date, a.slot_time`
      )
      .all(user.id);
    const openSlots = db
      .prepare(
        `SELECT id, slot_date, slot_time FROM availability
         WHERE tutor_id = ? AND is_booked = 0 AND slot_date >= date('now')
         ORDER BY slot_date, slot_time`
      )
      .all(user.id);
    const earnings = db
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) as total FROM bookings
         WHERE tutor_id = ? AND payment_status = 'paid'`
      )
      .get(user.id).total;
    return res.render('dashboard-tutor', { title: 'Your dashboard', upcoming, openSlots, earnings });
  }

  const upcoming = db
    .prepare(
      `SELECT b.id as booking_id, a.slot_date, a.slot_time, u.name as tutor_name, u.id as tutor_id,
              b.payment_status, b.amount
       FROM bookings b
       JOIN availability a ON a.id = b.availability_id
       JOIN users u ON u.id = b.tutor_id
       WHERE b.student_id = ? AND a.slot_date >= date('now')
       ORDER BY a.slot_date, a.slot_time`
    )
    .all(user.id);
  res.render('dashboard-student', { title: 'Your dashboard', upcoming });
});

// ---------- Booking + payment ----------

app.post('/book/:slotId', requireAuth('student'), async (req, res) => {
  const slot = db.prepare('SELECT * FROM availability WHERE id = ?').get(req.params.slotId);
  if (!slot || slot.is_booked) {
    return res.redirect('/tutors?error=That slot is no longer available');
  }
  const tutor = db
    .prepare(
      `SELECT u.id, u.name, tp.hourly_rate FROM users u
       JOIN tutor_profiles tp ON tp.user_id = u.id WHERE u.id = ?`
    )
    .get(slot.tutor_id);

  if (!stripeConfigured) {
    return res.redirect(`/tutors/${slot.tutor_id}?error=Payments are not set up yet`);
  }

  try {
    const checkoutSession = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: { name: `Tutoring session with ${tutor.name}` },
            unit_amount: Math.round(tutor.hourly_rate * 100),
          },
          quantity: 1,
        },
      ],
      success_url: `${req.protocol}://${req.get('host')}/booking/confirm?slot_id=${slot.id}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.protocol}://${req.get('host')}/tutors/${slot.tutor_id}?error=Payment cancelled`,
      metadata: {
        slot_id: String(slot.id),
        student_id: String(req.session.user.id),
        tutor_id: String(slot.tutor_id),
      },
    });
    res.redirect(303, checkoutSession.url);
  } catch (e) {
    res.redirect(`/tutors/${slot.tutor_id}?error=Could not start checkout`);
  }
});

app.get('/booking/confirm', requireAuth('student'), async (req, res) => {
  const { slot_id, session_id } = req.query;
  if (!slot_id || !session_id) {
    return res.redirect('/dashboard?error=Missing confirmation details');
  }

  const alreadyBooked = db.prepare('SELECT id FROM bookings WHERE stripe_session_id = ?').get(session_id);
  if (alreadyBooked) {
    return res.redirect('/dashboard?success=Session booked!');
  }

  try {
    const checkoutSession = await stripe.checkout.sessions.retrieve(session_id);
    if (checkoutSession.payment_status !== 'paid') {
      return res.redirect('/dashboard?error=Payment was not completed');
    }

    const slot = db.prepare('SELECT * FROM availability WHERE id = ?').get(slot_id);
    if (!slot || slot.is_booked) {
      return res.redirect('/dashboard?error=That slot was booked by someone else — contact support for a refund');
    }

    db.prepare('UPDATE availability SET is_booked = 1 WHERE id = ?').run(slot.id);
    db.prepare(
      `INSERT INTO bookings (student_id, tutor_id, availability_id, payment_status, amount, stripe_session_id)
       VALUES (?, ?, ?, 'paid', ?, ?)`
    ).run(
      req.session.user.id,
      slot.tutor_id,
      slot.id,
      (checkoutSession.amount_total || 0) / 100,
      session_id
    );
    res.redirect('/dashboard?success=Payment successful — session booked!');
  } catch (e) {
    res.redirect('/dashboard?error=Could not confirm payment');
  }
});

app.post('/bookings/:id/cancel', requireAuth(), (req, res) => {
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (!booking) return res.redirect('/dashboard?error=Booking not found');
  const isOwner =
    booking.student_id === req.session.user.id || booking.tutor_id === req.session.user.id;
  if (!isOwner) return res.redirect('/dashboard?error=Not your booking');

  db.prepare('UPDATE availability SET is_booked = 0 WHERE id = ?').run(booking.availability_id);
  db.prepare('DELETE FROM bookings WHERE id = ?').run(booking.id);
  res.redirect('/dashboard?success=Booking cancelled');
});

// Tutor: add a new availability slot
app.post('/availability', requireAuth('tutor'), (req, res) => {
  const { slot_date, slot_time } = req.body;
  if (!slot_date || !slot_time) return res.redirect('/dashboard?error=Pick a date and time');
  try {
    db.prepare('INSERT INTO availability (tutor_id, slot_date, slot_time) VALUES (?, ?, ?)').run(
      req.session.user.id,
      slot_date,
      slot_time
    );
    res.redirect('/dashboard?success=Slot added');
  } catch (e) {
    res.redirect('/dashboard?error=That slot already exists');
  }
});

app.listen(PORT, () => {
  console.log(`TutorHub running at http://localhost:${PORT}`);
});
