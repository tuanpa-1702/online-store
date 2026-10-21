require('dotenv').config();
if (!process.env.SESSION_SECRET) throw new Error('Thiếu SESSION_SECRET trong .env');
const express = require('express');
const path = require('path');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const passport = require('./config/passport');
const { getSettings, cartCount, formatVND, STATUS_STEPS, STATUS_META, vietqrUrl } = require('./helpers');

const app = express();
const PORT = process.env.PORT || 3003;

// Behind nginx/https proxy
app.set('trust proxy', 1);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
const { MEDIA_DIR } = require('./media');
app.use('/media', express.static(MEDIA_DIR, { maxAge: '7d' }));

app.use(session({
  store: new SQLiteStore({ db: 'sessions.db', dir: path.join(__dirname, 'data') }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 14 }, // 14 days
}));

app.use(passport.initialize());
app.use(passport.session());

// Globals for all views
app.use((req, res, next) => {
  res.locals.currentUser = req.user || null;
  res.locals.settings = getSettings();
  res.locals.cartCount = cartCount(req.session);
  res.locals.fmt = formatVND;
  res.locals.currentPath = req.path;
  res.locals.query = req.query;
  res.locals.STATUS_STEPS = STATUS_STEPS;
  res.locals.STATUS_META = STATUS_META;
  res.locals.vietqr = vietqrUrl;
  next();
});

// Routes
app.use('/', require('./routes/auth'));
app.use('/', require('./routes/shop'));
app.use('/', require('./routes/account'));
app.use('/', require('./routes/cart'));
app.use('/', require('./routes/checkout'));
app.use('/admin', require('./routes/admin'));

// 404
app.use((req, res) => {
  res.status(404).render('error', { title: 'Không tìm thấy', message: 'Trang bạn tìm không tồn tại.' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { title: 'Lỗi hệ thống', message: 'Đã có lỗi xảy ra. Vui lòng thử lại sau.' });
});

app.listen(PORT, () => console.log(`Chợ Trời store running on http://localhost:${PORT}`));
