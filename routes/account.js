const express = require('express');
const db = require('../db');
const { ensureAuth } = require('../middleware/auth');
const router = express.Router();

function clearDefault(userId) {
  db.prepare('UPDATE addresses SET is_default = 0 WHERE user_id = ?').run(userId);
}

// Add address
router.post('/account/addresses', ensureAuth, (req, res) => {
  const { recipient_name, phone, address, note, is_default } = req.body;
  if (!recipient_name || !phone || !address) return res.redirect('/account?err=missing#addresses');
  const count = db.prepare('SELECT COUNT(*) c FROM addresses WHERE user_id = ?').get(req.user.id).c;
  const makeDefault = is_default === '1' || count === 0; // first address is default
  if (makeDefault) clearDefault(req.user.id);
  db.prepare('INSERT INTO addresses (user_id, recipient_name, phone, address, note, is_default) VALUES (?, ?, ?, ?, ?, ?)')
    .run(req.user.id, recipient_name, phone, address, note || '', makeDefault ? 1 : 0);
  res.redirect('/account#addresses');
});

// Edit address
router.post('/account/addresses/:id/edit', ensureAuth, (req, res) => {
  const addr = db.prepare('SELECT * FROM addresses WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!addr) return res.redirect('/account#addresses');
  const { recipient_name, phone, address, note, is_default } = req.body;
  if (is_default === '1') clearDefault(req.user.id);
  db.prepare('UPDATE addresses SET recipient_name = ?, phone = ?, address = ?, note = ?, is_default = ? WHERE id = ? AND user_id = ?')
    .run(recipient_name, phone, address, note || '', is_default === '1' ? 1 : addr.is_default, req.params.id, req.user.id);
  res.redirect('/account#addresses');
});

// Set default
router.post('/account/addresses/:id/default', ensureAuth, (req, res) => {
  const addr = db.prepare('SELECT id FROM addresses WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (addr) { clearDefault(req.user.id); db.prepare('UPDATE addresses SET is_default = 1 WHERE id = ?').run(addr.id); }
  res.redirect(req.body.redirect || '/account#addresses');
});

// Delete
router.post('/account/addresses/:id/delete', ensureAuth, (req, res) => {
  const addr = db.prepare('SELECT * FROM addresses WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (addr) {
    db.prepare('DELETE FROM addresses WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    if (addr.is_default) {
      const next = db.prepare('SELECT id FROM addresses WHERE user_id = ? ORDER BY id LIMIT 1').get(req.user.id);
      if (next) db.prepare('UPDATE addresses SET is_default = 1 WHERE id = ?').run(next.id);
    }
  }
  res.redirect('/account#addresses');
});

// ---- Reviews ----
router.post('/account/review', ensureAuth, (req, res) => {
  const pid = parseInt(req.body.product_id);
  const rating = Math.max(1, Math.min(5, parseInt(req.body.rating) || 5));
  const comment = (req.body.comment || '').trim();
  if (!pid) return res.redirect('/account?tab=purchases');
  // Only allow reviewing a product the user actually bought
  const bought = db.prepare(`SELECT 1 FROM order_items oi JOIN orders o ON oi.order_id = o.id
    WHERE o.user_id = ? AND oi.product_id = ? LIMIT 1`).get(req.user.id, pid);
  if (!bought) return res.redirect('/account?tab=purchases');
  const existing = db.prepare('SELECT id FROM reviews WHERE user_id = ? AND product_id = ?').get(req.user.id, pid);
  if (existing) {
    db.prepare('UPDATE reviews SET rating = ?, comment = ?, created_at = datetime(\'now\') WHERE id = ?').run(rating, comment, existing.id);
  } else {
    db.prepare('INSERT INTO reviews (user_id, product_id, rating, comment) VALUES (?, ?, ?, ?)').run(req.user.id, pid, rating, comment);
  }
  res.redirect('/account?tab=reviews');
});

module.exports = router;
