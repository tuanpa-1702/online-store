const express = require('express');
const db = require('../db');
const { getSettings } = require('../helpers');
const { ensureAuth } = require('../middleware/auth');
const router = express.Router();

const BASE = (process.env.BASE_URL || '').replace(/\/$/, '');

function xmlEscape(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---- robots.txt ----
router.get('/robots.txt', (req, res) => {
  const base = BASE || (req.protocol + '://' + req.get('host'));
  res.type('text/plain').send(
    `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /account\nDisallow: /cart\nDisallow: /checkout\nDisallow: /login\nDisallow: /register\n\nSitemap: ${base}/sitemap.xml\n`
  );
});

// ---- sitemap.xml ----
router.get('/sitemap.xml', (req, res) => {
  const base = BASE || (req.protocol + '://' + req.get('host'));
  const urls = [];
  const add = (loc, opts = {}) => urls.push({ loc: base + loc, ...opts });
  add('/', { changefreq: 'daily', priority: '1.0' });
  add('/about', { changefreq: 'monthly', priority: '0.5' });
  const categories = db.prepare('SELECT DISTINCT category FROM products WHERE active = 1 AND category IS NOT NULL').all().map(r => r.category);
  categories.forEach(c => add('/?category=' + encodeURIComponent(c), { changefreq: 'weekly', priority: '0.6' }));
  const products = db.prepare('SELECT slug, created_at FROM products WHERE active = 1 ORDER BY id DESC').all();
  products.forEach(p => add('/product/' + p.slug, {
    changefreq: 'weekly', priority: '0.8',
    lastmod: (p.created_at || '').slice(0, 10) || undefined,
  }));
  const body = urls.map(u => `  <url>\n    <loc>${xmlEscape(u.loc)}</loc>` +
    (u.lastmod ? `\n    <lastmod>${u.lastmod}</lastmod>` : '') +
    (u.changefreq ? `\n    <changefreq>${u.changefreq}</changefreq>` : '') +
    (u.priority ? `\n    <priority>${u.priority}</priority>` : '') +
    `\n  </url>`).join('\n');
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`);
});

// ---- Home / product listing ----
router.get('/', (req, res) => {
  const { category, q, sort } = req.query;
  let sql = 'SELECT * FROM products WHERE active = 1';
  const params = [];
  if (category) { sql += ' AND category = ?'; params.push(category); }
  if (q) { sql += ' AND (name LIKE ? OR description LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
  switch (sort) {
    case 'price-asc': sql += ' ORDER BY price ASC'; break;
    case 'price-desc': sql += ' ORDER BY price DESC'; break;
    case 'best-seller': sql += ' ORDER BY sold DESC'; break;
    default: sql += ' ORDER BY created_at DESC, id DESC';
  }
  const products = db.prepare(sql).all(...params);
  const categories = db.prepare('SELECT DISTINCT category FROM products WHERE active = 1 AND category IS NOT NULL').all().map(r => r.category);
  res.render('home', {
    title: 'Trang chủ',
    products, categories,
    activeCategory: category || '',
    q: q || '', sort: sort || 'newest',
    settings: getSettings(),
  });
});

// ---- Product detail ----
router.get('/product/:slug', (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE slug = ? AND active = 1').get(req.params.slug);
  if (!p) return res.status(404).render('error', { title: 'Không tìm thấy', message: 'Sản phẩm không tồn tại hoặc đã ngừng kinh doanh.' });
  let images = [];
  try { images = JSON.parse(p.images || '[]'); } catch (e) {}
  if (!images.length) images = [p.image];
  const related = db.prepare('SELECT * FROM products WHERE active = 1 AND category = ? AND id != ? ORDER BY RANDOM() LIMIT 4').all(p.category, p.id);
  const reviews = db.prepare(`SELECT r.rating, r.comment, r.created_at, u.name AS user_name
    FROM reviews r LEFT JOIN users u ON u.id = r.user_id
    WHERE r.product_id = ? ORDER BY r.id DESC LIMIT 20`).all(p.id);
  res.render('product', { title: p.name, product: p, images, related, reviews });
});

// ---- About page ----
router.get('/about', (req, res) => {
  res.render('about', { title: 'Về chúng tôi', settings: getSettings() });
});

// ---- Account / order history ----
router.get('/account', ensureAuth, (req, res) => {
  const uid = req.user.id;
  const orders = db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC').all(uid);
  const addresses = db.prepare('SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC, id DESC').all(uid);
  // Purchase history: distinct products bought by this user
  const purchases = db.prepare(`
    SELECT oi.product_id, oi.name, oi.image, p.slug,
           SUM(oi.qty) AS total_qty, MAX(o.created_at) AS last_bought
    FROM order_items oi
    JOIN orders o ON oi.order_id = o.id
    LEFT JOIN products p ON p.id = oi.product_id
    WHERE o.user_id = ?
    GROUP BY oi.product_id
    ORDER BY last_bought DESC`).all(uid);
  const reviews = db.prepare(`
    SELECT r.*, p.name AS product_name, p.slug, p.image
    FROM reviews r LEFT JOIN products p ON p.id = r.product_id
    WHERE r.user_id = ? ORDER BY r.id DESC`).all(uid);
  const reviewedMap = {};
  reviews.forEach(r => { reviewedMap[r.product_id] = r; });
  const tab = ['orders', 'purchases', 'addresses', 'reviews'].includes(req.query.tab) ? req.query.tab : 'orders';
  res.render('account', { title: 'Trang cá nhân', orders, addresses, purchases, reviews, reviewedMap, tab });
});

router.get('/account/order/:code', ensureAuth, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE code = ? AND user_id = ?').get(req.params.code, req.user.id);
  if (!order) return res.status(404).render('error', { title: 'Không tìm thấy', message: 'Đơn hàng không tồn tại.' });
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  const history = db.prepare('SELECT * FROM order_status_history WHERE order_id = ? ORDER BY id ASC').all(order.id);
  res.render('order-detail', { title: 'Đơn hàng ' + order.code, order, items, history, settings: getSettings() });
});

module.exports = router;
