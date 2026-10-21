const nodemailer = require('nodemailer');
const { getSettings, formatVND, STATUS_META } = require('./helpers');

function buildTransport(s) {
  if (!s.mail_enabled || s.mail_enabled === '0' || !s.mail_user || !s.mail_pass) return null;
  const port = parseInt(s.mail_port) || 587;
  return nodemailer.createTransport({
    host: s.mail_host || 'smtp.gmail.com',
    port,
    secure: String(s.mail_secure) === '1' || port === 465,
    auth: { user: s.mail_user, pass: s.mail_pass },
  });
}

function fromHeader(s) {
  const name = s.mail_from_name || s.site_name || 'Chợ Trời';
  return `"${name}" <${s.mail_user}>`;
}

// Low-level send; never throws (logs instead)
async function send(to, subject, html) {
  try {
    const s = getSettings();
    const t = buildTransport(s);
    if (!t || !to) return { ok: false, skipped: true };
    await t.sendMail({ from: fromHeader(s), to, subject, html });
    return { ok: true };
  } catch (e) {
    console.error('[mailer] send failed:', e.message);
    return { ok: false, error: e.message };
  }
}

function layout(s, title, bodyHtml) {
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;background:#fff8f6;padding:24px;color:#1e1b1a">
    <div style="text-align:center;margin-bottom:16px">
      <span style="font-size:22px;font-weight:800;color:#1e1b1a">${s.site_name || 'Chợ Trời'}</span>
    </div>
    <div style="background:#ffffff;border:1px solid #efe6e4;border-radius:16px;padding:24px">
      <h2 style="margin:0 0 12px;font-size:18px;color:#972b25">${title}</h2>
      ${bodyHtml}
    </div>
    <p style="text-align:center;color:#8b716e;font-size:12px;margin-top:16px">
      Email tự động từ ${s.site_name || 'Chợ Trời'}${s.hotline ? ' • Hotline: ' + s.hotline : ''}
    </p>
  </div>`;
}

function itemsTable(items) {
  const rows = items.map(it => `<tr>
    <td style="padding:6px 0;color:#57413f">${it.name} × ${it.qty}</td>
    <td style="padding:6px 0;text-align:right;font-weight:600">${formatVND(it.price * it.qty)}</td>
  </tr>`).join('');
  return `<table style="width:100%;border-collapse:collapse;font-size:14px;margin:8px 0">${rows}</table>`;
}

async function sendOrderConfirmation(order, items) {
  if (!order.email) return { ok: false, skipped: true };
  const s = getSettings();
  const base = (process.env.BASE_URL || '').replace(/\/$/, '');
  const link = base ? `${base}/order-success/${order.code}` : '';
  const body = `
    <p>Chào ${order.customer_name || 'bạn'}, cảm ơn bạn đã đặt hàng tại ${s.site_name || 'Chợ Trời'}!</p>
    <p>Mã đơn hàng: <strong style="color:#972b25">#${order.code}</strong></p>
    ${itemsTable(items)}
    <table style="width:100%;border-top:1px solid #efe6e4;font-size:14px;margin-top:8px">
      <tr><td style="padding:6px 0;color:#57413f">Phí vận chuyển</td><td style="text-align:right">${order.shipping === 0 ? 'Miễn phí' : formatVND(order.shipping)}</td></tr>
      <tr><td style="padding:6px 0;font-weight:700">Tổng cộng</td><td style="text-align:right;font-weight:700;color:#972b25">${formatVND(order.total)}</td></tr>
    </table>
    <p style="font-size:14px;color:#57413f">Giao đến: ${order.customer_name} • ${order.phone}<br>${order.address}</p>
    <p style="font-size:14px">Thanh toán: ${order.payment_method === 'bank' ? 'Chuyển khoản' : 'COD (trả khi nhận)'}</p>
    ${link ? `<p style="margin-top:16px"><a href="${link}" style="background:#972b25;color:#fff;text-decoration:none;padding:10px 20px;border-radius:10px;font-weight:600">Xem đơn hàng</a></p>` : ''}
  `;
  return send(order.email, `Xác nhận đơn hàng #${order.code} • ${s.site_name || 'Chợ Trời'}`, layout(s, 'Đặt hàng thành công', body));
}

async function sendStatusUpdate(order, status, note) {
  if (!order.email) return { ok: false, skipped: true };
  const s = getSettings();
  const label = (STATUS_META[status] && STATUS_META[status].label) || status;
  const base = (process.env.BASE_URL || '').replace(/\/$/, '');
  const link = base ? `${base}/order-success/${order.code}` : '';
  const body = `
    <p>Đơn hàng <strong style="color:#972b25">#${order.code}</strong> của bạn vừa được cập nhật:</p>
    <p style="font-size:16px"><strong>Trạng thái: ${label}</strong></p>
    ${note ? `<p style="color:#57413f">${note}</p>` : ''}
    ${link ? `<p style="margin-top:16px"><a href="${link}" style="background:#972b25;color:#fff;text-decoration:none;padding:10px 20px;border-radius:10px;font-weight:600">Theo dõi đơn hàng</a></p>` : ''}
  `;
  return send(order.email, `Cập nhật đơn #${order.code}: ${label}`, layout(s, 'Cập nhật đơn hàng', body));
}

async function sendTest(to) {
  const s = getSettings();
  return send(to, `Email thử từ ${s.site_name || 'Chợ Trời'}`, layout(s, 'Email thử nghiệm', '<p>Nếu bạn nhận được email này, cấu hình gửi email đã hoạt động. 🎉</p>'));
}

module.exports = { send, sendOrderConfirmation, sendStatusUpdate, sendTest, buildTransport };
