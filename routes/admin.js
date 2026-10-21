const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { getSettings, setSetting, formatVND, addHistory } = require('../helpers');
const { ensureAdmin, ensureStaff, isAdmin } = require('../middleware/auth');
const media = require('../media');
const router = express.Router();

// ---- Upload config (stored on the big disk via media.js) ----
// Product gallery uploads land in the "san-pham" folder
const productUpload = media.uploaderTo(() => 'san-pham');
// Settings QR upload lands in the "qr" folder
const qrUpload = media.uploaderTo(() => 'qr');
// Media library uploads use the chosen folder (from query or body)
const libraryUpload = media.uploaderTo((req) => req.query.folder || req.body.folder || 'khac');

// Wrap a multer middleware to turn upload errors into a friendly page instead of a crash
function withUpload(mw) {
  return (req, res, next) => mw(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).render('error', { title: 'Ảnh quá lớn', message: 'Mỗi ảnh tối đa 15MB. Vui lòng nén hoặc chọn ảnh nhỏ hơn rồi thử lại.' });
      }
      return res.status(400).render('error', { title: 'Lỗi tải ảnh', message: 'Không tải được ảnh. Vui lòng kiểm tra định dạng (jpg, png, webp...) và thử lại.' });
    }
    next();
  });
}

// Staff + admin may enter the admin area; finer gating per route below
router.use(ensureStaff);

// Expose role + new-order notifications to every admin view
router.use((req, res, next) => {
  res.locals.isAdminUser = isAdmin(req.user);
  res.locals.unseenCount = db.prepare("SELECT COUNT(*) c FROM orders WHERE seen_by_admin = 0").get().c;
  res.locals.pendingCount = db.prepare("SELECT COUNT(*) c FROM orders WHERE status = 'pending'").get().c;
  res.locals.unseenOrders = db.prepare("SELECT id, code, customer_name, total, created_at FROM orders WHERE seen_by_admin = 0 ORDER BY id DESC LIMIT 6").all();
  next();
});

// Notifications polling endpoint
router.get('/api/notifications', (req, res) => {
  res.json({
    unseen: db.prepare("SELECT COUNT(*) c FROM orders WHERE seen_by_admin = 0").get().c,
    orders: db.prepare("SELECT id, code, customer_name, total, created_at FROM orders WHERE seen_by_admin = 0 ORDER BY id DESC LIMIT 6").all(),
  });
});

// Mark all orders as seen
router.post('/notifications/seen', (req, res) => {
  db.prepare('UPDATE orders SET seen_by_admin = 1 WHERE seen_by_admin = 0').run();
  res.redirect(req.get('referer') || '/admin');
});

const slugify = (s) => (s || '').toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || ('sp-' + Date.now());

// ---- Dashboard ----
router.get('/', (req, res) => {
  const stats = {
    products: db.prepare('SELECT COUNT(*) c FROM products').get().c,
    orders: db.prepare('SELECT COUNT(*) c FROM orders').get().c,
    pending: db.prepare("SELECT COUNT(*) c FROM orders WHERE status = 'pending'").get().c,
    users: db.prepare('SELECT COUNT(*) c FROM users').get().c,
    revenue: db.prepare("SELECT COALESCE(SUM(total),0) s FROM orders WHERE status != 'cancelled'").get().s,
  };
  const recentOrders = db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 8').all();
  res.render('admin/dashboard', { title: 'Quản trị', stats, recentOrders, page: 'dashboard' });
});

// ---- Products ----
router.get('/products', (req, res) => {
  const products = db.prepare('SELECT * FROM products ORDER BY id DESC').all();
  res.render('admin/products', { title: 'Quản lý sản phẩm', products, page: 'products' });
});

const asArray = (v) => (v == null ? [] : (Array.isArray(v) ? v : [v]));

// Build ordered image list from form: kept existing + new URLs + uploaded files; main first
function buildImages(req) {
  const b = req.body;
  let images = asArray(b.keep_images).filter(Boolean);
  if (b.gallery_urls) {
    b.gallery_urls.split(/[\n,]+/).map(s => s.trim()).filter(Boolean).forEach(u => images.push(u));
  }
  (req.files || []).forEach(f => images.push(media.fileUrl('san-pham', f.filename)));
  // images picked from the media library
  asArray(b.library_images).filter(Boolean).forEach(u => images.push(u));
  images = [...new Set(images)];
  const main = b.main_image && images.includes(b.main_image) ? b.main_image : images[0];
  if (main) images = [main, ...images.filter(i => i !== main)];
  return images;
}

// Per-product feature badges: feature_icon[] + feature_text[] -> JSON [{icon,text}]
function buildFeatures(req) {
  const icons = asArray(req.body.feature_icon);
  const texts = asArray(req.body.feature_text);
  const out = [];
  for (let i = 0; i < texts.length; i++) {
    const text = (texts[i] || '').trim();
    if (!text) continue;
    out.push({ icon: (icons[i] || 'verified_user').trim(), text });
  }
  return JSON.stringify(out);
}

router.get('/products/new', ensureAdmin, (req, res) => {
  res.render('admin/product-form', { title: 'Thêm sản phẩm', product: {}, images: [], mediaByFolder: media.allMedia(), page: 'products', action: '/admin/products/new' });
});

router.post('/products/new', ensureAdmin, withUpload(productUpload.array('gallery_files', 10)), (req, res) => {
  const b = req.body;
  const images = buildImages(req);
  const image = images[0] || '';
  db.prepare(`INSERT INTO products
    (name, slug, category, price, old_price, image, images, description, long_description, badge, tags, stock, active, features)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    b.name, slugify(b.name), b.category, parseInt(b.price) || 0, parseInt(b.old_price) || null,
    image, JSON.stringify(images), b.description || '', b.long_description || '',
    b.badge || '', b.tags || '', parseInt(b.stock) || 0, b.active ? 1 : 0, buildFeatures(req)
  );
  res.redirect('/admin/products');
});

router.get('/products/:id/edit', (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.redirect('/admin/products');
  let images = [];
  try { images = JSON.parse(product.images || '[]'); } catch (e) {}
  if (!images.length && product.image) images = [product.image];
  res.render('admin/product-form', { title: 'Sửa sản phẩm', product, images, mediaByFolder: media.allMedia(), page: 'products', action: '/admin/products/' + product.id + '/edit' });
});

router.post('/products/:id/edit', withUpload(productUpload.array('gallery_files', 10)), (req, res) => {
  const b = req.body;
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!existing) return res.redirect('/admin/products');
  let images = buildImages(req);
  if (!images.length) images = [existing.image].filter(Boolean); // fallback: keep old
  const image = images[0] || '';
  db.prepare(`UPDATE products SET name=?, slug=?, category=?, price=?, old_price=?, image=?, images=?,
    description=?, long_description=?, badge=?, tags=?, stock=?, active=?, features=? WHERE id=?`).run(
    b.name, slugify(b.name), b.category, parseInt(b.price) || 0, parseInt(b.old_price) || null,
    image, JSON.stringify(images), b.description || '', b.long_description || '',
    b.badge || '', b.tags || '', parseInt(b.stock) || 0, b.active ? 1 : 0, buildFeatures(req), req.params.id
  );
  res.redirect('/admin/products');
});

router.post('/products/:id/delete', ensureAdmin, (req, res) => {
  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  res.redirect('/admin/products');
});

// ---- Orders ----
router.get('/orders', (req, res) => {
  const status = req.query.status;
  let orders;
  if (status) orders = db.prepare('SELECT * FROM orders WHERE status = ? ORDER BY id DESC').all(status);
  else orders = db.prepare('SELECT * FROM orders ORDER BY id DESC').all();
  res.render('admin/orders', { title: 'Quản lý đơn hàng', orders, page: 'orders', status: status || '' });
});

router.get('/orders/:id', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.redirect('/admin/orders');
  // Mark as seen when admin opens it
  if (!order.seen_by_admin) db.prepare('UPDATE orders SET seen_by_admin = 1 WHERE id = ?').run(order.id);
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  const history = db.prepare('SELECT * FROM order_status_history WHERE order_id = ? ORDER BY id ASC').all(order.id);
  res.render('admin/order-detail', { title: 'Đơn ' + order.code, order, items, history, page: 'orders', settings: getSettings() });
});

router.post('/orders/:id/status', (req, res) => {
  const allowed = ['pending', 'confirmed', 'shipping', 'completed', 'cancelled'];
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.redirect('/admin/orders');
  const status = allowed.includes(req.body.status) ? req.body.status : 'pending';
  if (status !== order.status) {
    db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, order.id);
    addHistory(db, order.id, status, req.body.note || '');
    try { require('../mailer').sendStatusUpdate({ ...order, status }, status, req.body.note || ''); } catch (e) { console.error('[mail]', e.message); }
  } else if (req.body.note) {
    addHistory(db, order.id, status, req.body.note);
  }
  res.redirect('/admin/orders/' + order.id);
});

// Confirm payment received (bank transfer verification by admin)
router.post('/orders/:id/payment', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.redirect('/admin/orders');
  const paid = req.body.payment_status === 'paid';
  db.prepare('UPDATE orders SET payment_status = ? WHERE id = ?').run(paid ? 'paid' : 'unpaid', order.id);
  addHistory(db, order.id, order.status, paid ? 'Admin xác nhận ĐÃ NHẬN thanh toán' : 'Admin đánh dấu CHƯA nhận thanh toán');
  // When payment confirmed on a still-pending order, advance to confirmed
  if (paid && order.status === 'pending') {
    db.prepare("UPDATE orders SET status = 'confirmed' WHERE id = ?").run(order.id);
    addHistory(db, order.id, 'confirmed', 'Tự xác nhận sau khi nhận thanh toán');
  }
  res.redirect('/admin/orders/' + order.id);
});

// ---- Settings ----
// ---- Media library ----
router.get('/media', (req, res) => {
  const folders = media.listFolders();
  const current = media.safeFolder(req.query.folder) || folders[0] || 'san-pham';
  const files = media.listFiles(current);
  res.render('admin/media', { title: 'Thư viện ảnh', folders, current, files, page: 'media' });
});

router.post('/media/folder', ensureAdmin, (req, res) => {
  const { folder } = media.ensureFolder(req.body.name);
  res.redirect('/admin/media?folder=' + encodeURIComponent(folder));
});

router.post('/media/upload', withUpload(libraryUpload.array('files', 20)), (req, res) => {
  const folder = media.safeFolder(req.query.folder || req.body.folder) || 'khac';
  res.redirect('/admin/media?folder=' + encodeURIComponent(folder));
});

router.post('/media/delete', ensureAdmin, (req, res) => {
  media.deleteByUrl(req.body.url);
  const folder = media.safeFolder(req.body.folder) || '';
  res.redirect('/admin/media' + (folder ? '?folder=' + encodeURIComponent(folder) : ''));
});

// ---- Settings ----
router.get('/settings', ensureAdmin, (req, res) => {
  res.render('admin/settings', { title: 'Cấu hình website', settings: getSettings(), page: 'settings', saved: req.query.saved });
});

router.post('/settings', ensureAdmin, withUpload(qrUpload.single('qr_file')), (req, res) => {
  const keys = ['site_name', 'announcement', 'hotline', 'support_email', 'intro', 'about',
    'bank_name', 'bank_code', 'bank_account', 'bank_holder', 'bank_branch', 'free_ship_threshold',
    'shipping_fee', 'hero_eyebrow', 'hero_title', 'hero_subtitle',
    'home_products_title', 'home_products_subtitle', 'home_promise_title',
    'promise1_title', 'promise1_desc', 'promise2_title', 'promise2_desc', 'promise3_title', 'promise3_desc',
    'mail_host', 'mail_port', 'mail_user', 'mail_from_name'];
  for (const k of keys) if (k in req.body) setSetting(k, req.body[k]);
  // Checkboxes
  setSetting('mail_enabled', req.body.mail_enabled === '1' ? '1' : '0');
  setSetting('mail_secure', req.body.mail_secure === '1' ? '1' : '0');
  // Only overwrite password when a new one is provided (keep existing otherwise)
  if (req.body.mail_pass && req.body.mail_pass.trim()) setSetting('mail_pass', req.body.mail_pass.trim());
  if (req.file) setSetting('qr_image', media.fileUrl('qr', req.file.filename));
  const tab = req.body._tab ? '&tab=' + encodeURIComponent(req.body._tab) : '';
  res.redirect('/admin/settings?saved=1' + tab);
});

// Send a test email
router.post('/settings/test-email', ensureAdmin, async (req, res) => {
  const mailer = require('../mailer');
  const to = (req.body.to || req.user.email || '').trim();
  const r = await mailer.sendTest(to);
  const msg = r.ok ? 'Đã gửi email thử tới ' + to : (r.skipped ? 'Chưa bật/điền cấu hình email.' : 'Gửi thất bại: ' + (r.error || 'lỗi'));
  res.redirect('/admin/settings?tab=email&mail_test=' + encodeURIComponent(msg));
});

// ---- Users ----
router.get('/users', ensureAdmin, (req, res) => {
  const users = db.prepare('SELECT id, email, name, is_admin, role, google_id, created_at FROM users ORDER BY id DESC').all();
  res.render('admin/users', { title: 'Người dùng', users, page: 'users', error: req.query.error, ok: req.query.ok });
});

// Create a new user with a role
router.post('/users/new', ensureAdmin, (req, res) => {
  const { name, email, password, role } = req.body;
  const r = ['admin', 'staff', 'customer'].includes(role) ? role : 'customer';
  if (!email || !password || password.length < 6) {
    return res.redirect('/admin/users?error=' + encodeURIComponent('Cần email và mật khẩu tối thiểu 6 ký tự.'));
  }
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (exists) return res.redirect('/admin/users?error=' + encodeURIComponent('Email đã tồn tại.'));
  const hash = bcrypt.hashSync(password, 10);
  db.prepare('INSERT INTO users (email, password_hash, name, is_admin, role) VALUES (?, ?, ?, ?, ?)')
    .run(email.toLowerCase(), hash, name || email.split('@')[0], r === 'admin' ? 1 : 0, r);
  res.redirect('/admin/users?ok=1');
});

// Change a user's role
router.post('/users/:id/role', ensureAdmin, (req, res) => {
  const role = ['admin', 'staff', 'customer'].includes(req.body.role) ? req.body.role : 'customer';
  // Prevent removing the last admin
  if (role !== 'admin') {
    const target = db.prepare('SELECT role FROM users WHERE id = ?').get(req.params.id);
    if (target && target.role === 'admin') {
      const admins = db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'admin'").get().c;
      if (admins <= 1) return res.redirect('/admin/users?error=' + encodeURIComponent('Phải còn ít nhất 1 quản trị viên.'));
    }
  }
  db.prepare('UPDATE users SET role = ?, is_admin = ? WHERE id = ?').run(role, role === 'admin' ? 1 : 0, req.params.id);
  res.redirect('/admin/users');
});

module.exports = router;
