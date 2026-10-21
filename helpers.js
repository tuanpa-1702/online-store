const db = require('./db');

function formatVND(n) {
  n = Number(n) || 0;
  return n.toLocaleString('vi-VN') + '₫';
}

function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const s = {};
  for (const r of rows) s[r.key] = r.value;
  return s;
}

function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value == null ? '' : String(value));
}

// Cart is stored in session as { [productId]: qty }
function getCartItems(session) {
  const cart = session.cart || {};
  const ids = Object.keys(cart);
  if (!ids.length) return { items: [], subtotal: 0, count: 0 };
  const items = [];
  let subtotal = 0, count = 0;
  for (const id of ids) {
    const p = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(id);
    if (!p) continue;
    const qty = cart[id];
    const lineTotal = p.price * qty;
    subtotal += lineTotal;
    count += qty;
    items.push({ ...p, qty, lineTotal });
  }
  return { items, subtotal, count };
}

function cartCount(session) {
  const cart = session.cart || {};
  return Object.values(cart).reduce((a, b) => a + b, 0);
}

function genOrderCode() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `CT${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${rand}`;
}

// Order status flow (progress steps) + labels
const STATUS_STEPS = ['pending', 'confirmed', 'shipping', 'completed'];
const STATUS_META = {
  pending:   { label: 'Chờ xác nhận', icon: 'schedule' },
  confirmed: { label: 'Đã xác nhận', icon: 'task_alt' },
  shipping:  { label: 'Đang giao',   icon: 'local_shipping' },
  completed: { label: 'Hoàn thành',  icon: 'inventory_2' },
  cancelled: { label: 'Đã hủy',      icon: 'cancel' },
};

function addHistory(db, orderId, status, note) {
  db.prepare('INSERT INTO order_status_history (order_id, status, note) VALUES (?, ?, ?)')
    .run(orderId, status, note || '');
}

// Build a VietQR (qr_only) image URL from settings + optional amount & transfer content
function vietqrUrl(settings, amount, addInfo) {
  const bank = (settings.bank_code || '').trim();
  const acc = (settings.bank_account || '').replace(/\s+/g, '');
  if (!bank || !acc) return '';
  const params = new URLSearchParams();
  if (amount) params.set('amount', String(Math.round(Number(amount) || 0)));
  if (addInfo) params.set('addInfo', addInfo);
  if (settings.bank_holder) params.set('accountName', settings.bank_holder);
  const qs = params.toString();
  return `https://img.vietqr.io/image/${encodeURIComponent(bank)}-${encodeURIComponent(acc)}-qr_only.png${qs ? '?' + qs : ''}`;
}

module.exports = { formatVND, getSettings, setSetting, getCartItems, cartCount, genOrderCode, STATUS_STEPS, STATUS_META, addHistory, vietqrUrl };
