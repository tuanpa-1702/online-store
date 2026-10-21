const express = require('express');
const db = require('../db');
const { getCartItems, getSettings, genOrderCode, addHistory, vietqrUrl } = require('../helpers');
const router = express.Router();

// Checkout page
router.get('/checkout', (req, res) => {
  const cart = getCartItems(req.session);
  if (!cart.items.length) return res.redirect('/cart');
  const settings = getSettings();
  const threshold = Number(settings.free_ship_threshold) || 0;
  const shipFee = Number(settings.shipping_fee) || 0;
  const shipping = cart.subtotal >= threshold ? 0 : shipFee;
  const addresses = req.user
    ? db.prepare('SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC, id DESC').all(req.user.id)
    : [];
  res.render('checkout', {
    title: 'Thanh toán', cart, settings, shipping,
    total: cart.subtotal + shipping,
    user: req.user || null, addresses,
  });
});

// Place order
router.post('/checkout', (req, res) => {
  const cart = getCartItems(req.session);
  if (!cart.items.length) return res.redirect('/cart');

  const { customer_name, phone, email, address, note, payment_method, save_address } = req.body;
  if (!customer_name || !phone || !address) {
    const settings = getSettings();
    const threshold = Number(settings.free_ship_threshold) || 0;
    const shipFee = Number(settings.shipping_fee) || 0;
    const shipping = cart.subtotal >= threshold ? 0 : shipFee;
    const addresses = req.user
      ? db.prepare('SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC, id DESC').all(req.user.id)
      : [];
    return res.render('checkout', {
      title: 'Thanh toán', cart, settings, shipping, total: cart.subtotal + shipping,
      user: req.user || null, addresses, error: 'Vui lòng điền đầy đủ họ tên, số điện thoại và địa chỉ.',
      form: req.body,
    });
  }

  // Optionally save this address to the user's address book
  if (req.user && save_address === '1') {
    const dup = db.prepare('SELECT id FROM addresses WHERE user_id = ? AND phone = ? AND address = ?').get(req.user.id, phone, address);
    if (!dup) {
      const count = db.prepare('SELECT COUNT(*) c FROM addresses WHERE user_id = ?').get(req.user.id).c;
      const makeDefault = count === 0;
      db.prepare('INSERT INTO addresses (user_id, recipient_name, phone, address, note, is_default) VALUES (?, ?, ?, ?, ?, ?)')
        .run(req.user.id, customer_name, phone, address, note || '', makeDefault ? 1 : 0);
    }
  }

  const settings = getSettings();
  const threshold = Number(settings.free_ship_threshold) || 0;
  const shipFee = Number(settings.shipping_fee) || 0;
  const shipping = cart.subtotal >= threshold ? 0 : shipFee;
  const total = cart.subtotal + shipping;
  const code = genOrderCode();
  const method = payment_method === 'bank' ? 'bank' : 'cod';

  const insertOrder = db.prepare(`INSERT INTO orders
    (code, user_id, customer_name, phone, email, address, note, payment_method, subtotal, shipping, total, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`);
  const insertItem = db.prepare(`INSERT INTO order_items (order_id, product_id, name, price, qty, image) VALUES (?, ?, ?, ?, ?, ?)`);
  const updateStock = db.prepare('UPDATE products SET stock = MAX(0, stock - ?), sold = sold + ? WHERE id = ?');

  const tx = db.transaction(() => {
    const info = insertOrder.run(code, req.user ? req.user.id : null, customer_name, phone, email || (req.user && req.user.email) || '', address, note || '', method, cart.subtotal, shipping, total);
    const orderId = info.lastInsertRowid;
    for (const it of cart.items) {
      insertItem.run(orderId, it.id, it.name, it.price, it.qty, it.image);
      updateStock.run(it.qty, it.qty, it.id);
    }
    addHistory(db, orderId, 'pending', 'Khách đặt hàng');
    return orderId;
  });
  tx();

  // Send order confirmation email (non-blocking, fails silently)
  try {
    const order = db.prepare('SELECT * FROM orders WHERE code = ?').get(code);
    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
    require('../mailer').sendOrderConfirmation(order, items);
  } catch (e) { console.error('[checkout] mail error:', e.message); }

  req.session.cart = {};
  res.redirect('/order-success/' + code);
});

// Order success / confirmation
router.get('/order-success/:code', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE code = ?').get(req.params.code);
  if (!order) return res.status(404).render('error', { title: 'Không tìm thấy', message: 'Đơn hàng không tồn tại.' });
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  const history = db.prepare('SELECT * FROM order_status_history WHERE order_id = ? ORDER BY id ASC').all(order.id);
  res.render('order-success', { title: 'Đặt hàng thành công', order, items, history, settings: getSettings() });
});

// Generic QR download (works anywhere, with or without an order code)
router.get('/qr-download.png', async (req, res) => {
  const settings = getSettings();
  const amount = parseInt(req.query.amount) || 0;
  const info = (req.query.info || '').toString().slice(0, 60);
  const url = vietqrUrl(settings, amount, info) || settings.qr_image;
  if (!url) return res.status(404).send('Chưa cấu hình QR');
  const fname = 'QR' + (info ? '-' + info.replace(/[^A-Za-z0-9_-]/g, '') : '') + '.png';
  try {
    if (url.startsWith('/')) return res.redirect(url);
    const r = await fetch(url);
    if (!r.ok) return res.status(502).send('Không tải được QR');
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', r.headers.get('content-type') || 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    res.send(buf);
  } catch (e) { res.status(502).send('Lỗi tải QR'); }
});

// Download the VietQR image for an order (forces attachment)
router.get('/order/:code/qr.png', async (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE code = ?').get(req.params.code);
  if (!order) return res.status(404).send('Không tìm thấy đơn hàng');
  const url = vietqrUrl(getSettings(), order.total, order.code) || getSettings().qr_image;
  if (!url) return res.status(404).send('Chưa cấu hình QR');
  try {
    if (url.startsWith('/')) return res.redirect(url); // local static qr image
    const r = await fetch(url);
    if (!r.ok) return res.status(502).send('Không tải được QR');
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', r.headers.get('content-type') || 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="QR-${order.code}.png"`);
    res.send(buf);
  } catch (e) {
    res.status(502).send('Lỗi tải QR');
  }
});

// Customer reports they have transferred (bank)
router.post('/order/:code/paid-report', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE code = ?').get(req.params.code);
  if (!order) return res.status(404).render('error', { title: 'Không tìm thấy', message: 'Đơn hàng không tồn tại.' });
  if (order.payment_method === 'bank' && order.payment_status === 'unpaid') {
    db.prepare("UPDATE orders SET payment_status = 'reported', seen_by_admin = 0 WHERE id = ?").run(order.id);
    addHistory(db, order.id, order.status, 'Khách báo đã chuyển khoản');
  }
  res.redirect('/order-success/' + order.code);
});

module.exports = router;
