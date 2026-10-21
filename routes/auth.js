const express = require('express');
const bcrypt = require('bcryptjs');
const passport = require('../config/passport');
const db = require('../db');
const router = express.Router();

function redirectBack(req, res, fallback = '/') {
  const to = req.session.returnTo || fallback;
  delete req.session.returnTo;
  res.redirect(to);
}

// ---- Login page ----
router.get('/login', (req, res) => {
  if (req.isAuthenticated()) return res.redirect('/');
  res.render('login', { title: 'Đăng nhập', mode: 'login', error: null, form: {} });
});

router.get('/register', (req, res) => {
  if (req.isAuthenticated()) return res.redirect('/');
  res.render('login', { title: 'Đăng ký', mode: 'register', error: null, form: {} });
});

// ---- Email register ----
router.post('/register', (req, res) => {
  const { name, email, password } = req.body;
  if (!email || !password || password.length < 6) {
    return res.render('login', { title: 'Đăng ký', mode: 'register', error: 'Email và mật khẩu (tối thiểu 6 ký tự) là bắt buộc.', form: req.body });
  }
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (exists) {
    return res.render('login', { title: 'Đăng ký', mode: 'register', error: 'Email này đã được đăng ký.', form: req.body });
  }
  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare('INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)')
    .run(email.toLowerCase(), hash, name || email.split('@')[0]);
  const user = db.prepare('SELECT id, email, name, avatar, is_admin, role FROM users WHERE id = ?').get(info.lastInsertRowid);
  req.login(user, (err) => {
    if (err) return res.render('login', { title: 'Đăng ký', mode: 'register', error: 'Có lỗi xảy ra, thử lại.', form: req.body });
    redirectBack(req, res);
  });
});

// ---- Email login ----
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get((email || '').toLowerCase());
  if (!user || !user.password_hash || !bcrypt.compareSync(password || '', user.password_hash)) {
    return res.render('login', { title: 'Đăng nhập', mode: 'login', error: 'Email hoặc mật khẩu không đúng.', form: req.body });
  }
  const safe = { id: user.id, email: user.email, name: user.name, avatar: user.avatar, is_admin: user.is_admin, role: user.role };
  req.login(safe, (err) => {
    if (err) return res.render('login', { title: 'Đăng nhập', mode: 'login', error: 'Có lỗi xảy ra, thử lại.', form: req.body });
    redirectBack(req, res);
  });
});

// ---- Google OAuth ----
router.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

router.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/login' }),
  (req, res) => redirectBack(req, res)
);

// ---- Logout ----
router.post('/logout', (req, res) => {
  req.logout(() => res.redirect('/'));
});
router.get('/logout', (req, res) => {
  req.logout(() => res.redirect('/'));
});

module.exports = router;
