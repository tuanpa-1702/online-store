const express = require('express');
const db = require('../db');
const { getCartItems, getSettings, cartCount } = require('../helpers');
const router = express.Router();

function ensureCart(req) { if (!req.session.cart) req.session.cart = {}; }

// View cart
router.get('/cart', (req, res) => {
  const cart = getCartItems(req.session);
  const settings = getSettings();
  const threshold = Number(settings.free_ship_threshold) || 0;
  const shipFee = Number(settings.shipping_fee) || 0;
  const shipping = cart.subtotal >= threshold || cart.subtotal === 0 ? 0 : shipFee;
  res.render('cart', { title: 'Giỏ hàng', cart, settings, shipping, total: cart.subtotal + shipping });
});

// Add to cart
router.post('/cart/add', (req, res) => {
  ensureCart(req);
  const id = String(req.body.productId);
  const qty = Math.max(1, parseInt(req.body.qty) || 1);
  const p = db.prepare('SELECT id, stock FROM products WHERE id = ? AND active = 1').get(id);
  if (!p) {
    if (req.xhr || req.headers.accept?.includes('application/json')) return res.status(404).json({ ok: false });
    return res.redirect('back');
  }
  req.session.cart[id] = Math.min((req.session.cart[id] || 0) + qty, Math.max(1, p.stock));
  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.json({ ok: true, count: cartCount(req.session) });
  }
  res.redirect(req.body.redirect || '/cart');
});

// Update quantity
router.post('/cart/update', (req, res) => {
  ensureCart(req);
  const id = String(req.body.productId);
  const qty = parseInt(req.body.qty);
  if (qty <= 0 || isNaN(qty)) delete req.session.cart[id];
  else req.session.cart[id] = qty;
  res.redirect('/cart');
});

// Remove item
router.post('/cart/remove', (req, res) => {
  ensureCart(req);
  delete req.session.cart[String(req.body.productId)];
  res.redirect('/cart');
});

module.exports = router;
