const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const db = new Database(path.join(__dirname, 'data', 'store.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE,
  password_hash TEXT,
  name TEXT,
  avatar TEXT,
  google_id TEXT,
  is_admin INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT UNIQUE,
  category TEXT,
  price INTEGER NOT NULL,
  old_price INTEGER,
  image TEXT,
  images TEXT,
  description TEXT,
  long_description TEXT,
  badge TEXT,
  tags TEXT,
  stock INTEGER DEFAULT 100,
  rating REAL DEFAULT 5.0,
  reviews INTEGER DEFAULT 0,
  sold INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE,
  user_id INTEGER,
  customer_name TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  note TEXT,
  payment_method TEXT,
  subtotal INTEGER,
  shipping INTEGER DEFAULT 0,
  total INTEGER,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER,
  product_id INTEGER,
  name TEXT,
  price INTEGER,
  qty INTEGER,
  image TEXT
);

CREATE TABLE IF NOT EXISTS addresses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  recipient_name TEXT,
  phone TEXT,
  address TEXT,
  note TEXT,
  is_default INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS order_status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  status TEXT,
  note TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  order_id INTEGER,
  rating INTEGER DEFAULT 5,
  comment TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
`);

// --- Lightweight migrations ---
const orderCols = db.prepare("PRAGMA table_info(orders)").all().map(c => c.name);
if (!orderCols.includes('seen_by_admin')) {
  db.exec("ALTER TABLE orders ADD COLUMN seen_by_admin INTEGER DEFAULT 0");
}
if (!orderCols.includes('payment_status')) {
  // unpaid | reported (khách báo đã CK) | paid (admin xác nhận)
  db.exec("ALTER TABLE orders ADD COLUMN payment_status TEXT DEFAULT 'unpaid'");
}

const prodCols = db.prepare("PRAGMA table_info(products)").all().map(c => c.name);
if (!prodCols.includes('features')) {
  // JSON array of { icon, text }
  db.exec("ALTER TABLE products ADD COLUMN features TEXT DEFAULT ''");
}

const userCols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
if (!userCols.includes('role')) {
  // customer | staff | admin
  db.exec("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'customer'");
  db.exec("UPDATE users SET role = 'admin' WHERE is_admin = 1");
  db.exec("UPDATE users SET role = 'customer' WHERE role IS NULL OR role = ''");
}

// ---- Seed settings ----
const settingsDefaults = {
  site_name: 'Chợ Trời',
  announcement: 'Miễn phí vận chuyển cho đơn hàng từ 500k • Đổi trả trong 30 ngày • Chợ Trời Tuyển Chọn',
  hotline: '1900 6868',
  support_email: 'it@nagase.com.vn',
  intro: 'Sàn tuyển chọn thiết bị & phụ kiện phong cách sống ấm áp, tinh tuyển chất liệu tự nhiên và công nghệ thủ công chuẩn mực.',
  about: 'Chợ Trời là phòng thí nghiệm thẩm mỹ công nghệ — không gian tuyển chọn thiết bị âm học, phụ kiện workstation và desk setup chuẩn mực cho giới sáng tạo đương đại.',
  qr_image: '',
  bank_name: 'TPBank',
  bank_code: 'TPB',
  bank_account: '84863939979',
  bank_holder: 'PHAN ANH TUAN',
  bank_branch: '',
  free_ship_threshold: '500000',
  shipping_fee: '30000',
  mail_enabled: '0',
  mail_host: 'smtp.gmail.com',
  mail_port: '587',
  mail_secure: '0',
  mail_user: '',
  mail_pass: '',
  mail_from_name: 'Chợ Trời',
  hero_eyebrow: 'Chào bạn, mời ghé Chợ Trời',
  hero_title: 'Âm Học & Vật Liệu Đương Đại',
  hero_subtitle: 'Sự hòa quyện giữa nhôm nguyên khối, gỗ óc chó thủ công và mạch xử lý âm học thế hệ mới.',
  home_products_title: 'Hàng đang có tại chợ',
  home_products_subtitle: 'Mỗi món đều được tụi mình dùng thử trước khi bày bán.',
  home_promise_title: 'Vài điều tụi mình luôn giữ lời',
  promise1_title: 'Bảo hành thật',
  promise1_desc: 'Có lỗi phần cứng trong 24 tháng là đổi máy mới, không bắt bạn chờ sửa lắt nhắt.',
  promise2_title: 'Giao nhanh, gói kỹ',
  promise2_desc: 'Nội thành Hà Nội và TP.HCM nhận trong ngày, mọi đơn đều bọc chống sốc cẩn thận.',
  promise3_title: 'Tư vấn như bạn bè',
  promise3_desc: 'Nhắn tụi mình bất cứ lúc nào — gợi ý món hợp nhu cầu, không nói thách, không ép mua.',
};
const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(settingsDefaults)) insertSetting.run(k, v);

// ---- Seed admin ----
const adminEmail = process.env.ADMIN_EMAIL || 'admin@chotroi.vn';
const existingAdmin = db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail);
if (!existingAdmin && process.env.ADMIN_PASSWORD) {
  const hash = bcrypt.hashSync(process.env.ADMIN_PASSWORD, 10);
  db.prepare('INSERT INTO users (email, password_hash, name, is_admin) VALUES (?, ?, ?, 1)')
    .run(adminEmail, hash, 'Quản trị viên');
  console.log('Seeded admin account:', adminEmail);
}

// ---- Seed products ----
const productCount = db.prepare('SELECT COUNT(*) AS c FROM products').get().c;
if (productCount === 0) {
  const img = (u) => u;
  const products = [
    {
      name: 'Tai nghe Master ANC Studio', category: 'Thiết bị âm thanh', price: 3190000, old_price: 3690000,
      image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuDKMyOg3-GnyKbAafrXShRYnbW6CgkZmcSzXdUcBRrAMc3Onopat0e66vcsF4G1lLJjYEHcxVdRgArwFJb1vlKbNiMXGDA6Tax6RGA6U-wW_B9I1up0cfbQ0TRPDk7GBnPuGvEvVm_4DiUjtypegOLXoxu2dtjsp9rkPQToge9L9IZVe6_jy03UkxJd16TMpYR0eNDMM0W1hoI3b-zYL38srwpKNqJDjnqnE6aJCv8BbMbRQdxIp6V3',
      description: 'Màng loa Planar 45mm, chống ồn chủ động 42dB, thời lượng pin 55H, codec LDAC & Hi-Res.',
      badge: 'MỚI RA MẮT', tags: 'LDAC 990kbps,Pin 55h', rating: 4.9, reviews: 42, sold: 350, stock: 18,
    },
    {
      name: 'Bàn phím Acoustic 75 Nhôm', category: 'Bàn phím & Chuột làm việc', price: 2490000, old_price: 2890000,
      image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBHDW6cKvS04Lj21Jxz79Iql-OVoRl_Kg6iVI-tEIHT0e9tqozagGvc4nWhELh4wV0UNjWuZFdc3pDy_Vl8pbIwL7HOJxSXYaIsF3If7EceuSfYHjmArCYg1HF5lhyDdNZXZTpCm_5TIyTfDy2cSuYP-zgHRpiGxMkZchlBQpFPRUVNrXRN5MbDK1eRLeciLkJ181oP2oRlCrXBXDyPOpUKmdCTV2evHvBXNaochUXttHPoNAZx6RZx',
      description: 'Vỏ nhôm Anodized 6063, cấu trúc 5 lớp foam tiêu âm PORON, Switch Custom prelube gõ mượt mà.',
      badge: 'HOT PICK', tags: '3 Mode Kết Nối,Gasket Mount', rating: 5.0, reviews: 58, sold: 210, stock: 25,
    },
    {
      name: 'Đèn kẹp màn hình cảm ứng', category: 'Ánh sáng bảo vệ mắt', price: 1150000, old_price: 1350000,
      image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBc-YBrSN00-y0YmmeixL9Gh6E1HJV1yzE6OVSmAfN8vkzt__DvGSpZife0yWqp_BXC96yPFaFCx5Lsv8vFI3WsJpnOg-lbcVtb16DAsdcfE31e_zKxYfE1ixQC9C5moFIAkrv5M2RZleMscCTQh3Ah6Llkxm_ffxrtGz8-XPh3fN6XaJZf9a5ObR6CrNZgeFu2SkmiPDFhA5ocIrm1Qb61rlULCS29LabQfUkZIGnr98IabVaY2qoS',
      description: 'Quang học bất đối xứng chống phản xạ chói lóa, chỉ số hoàn màu Ra98, điều khiển núm xoay không dây.',
      badge: 'CÔNG THÁI HỌC', tags: 'CRI Ra98,Núm vặn 2.4G', rating: 4.8, reviews: 27, sold: 120, stock: 40,
    },
    {
      name: 'Trạm sạc nhanh GaN 120W', category: 'Nguồn & Trạm sạc đa năng', price: 1350000, old_price: 1590000,
      image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuDp0YAyAIGhIJttAXCqcjx8pzJR_sbausjIMXDOXZEtO4hf_x_qxa-5u_mgEWvxW9D1dWEVhKU77tj7QVLkgAQ9QavpiClNdTIBK1nYJ-Sj3L9jTF8RIaeKlsS0TDxNUsYFBAHAnr2M68Gja2xzx24FPKOSQpyOp5i4FlUiMY6AA136H7W5lFkAlQshzxRnCMAcUEHKZ2G989tbKswNyuihggXqSMZcp0iFU8s-99Kvbm3Ep3XwwFf7',
      description: 'Công nghệ GaN thế hệ 5 mát máy, phân phối nguồn điện thông minh qua 3 cổng USB-C và 1 cổng USB-A.',
      badge: 'BÁN CHẠY', tags: 'PD 3.1 100W,4 Cổng Ra', rating: 4.9, reviews: 83, sold: 480, stock: 60,
    },
    {
      name: 'Chuột không dây hợp kim siêu nhẹ', category: 'Bàn phím & Chuột làm việc', price: 980000, old_price: 1190000,
      image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCJcBeUA0cCU1dyiKzTJaSUaW2ASvWaNczKuCuYjT_NfjES2RQhn-HBD-qZaqxVon1Fh2ynK95XxbBFGWCLni5teeT0EtR1RgkK_bmRnWRUNG5xTqSQLeTLYnIe7Q9Qhsf1N61tRYqM0ZiPQ0UnSbpOQqiFJD5CMuXC2BMd8my2RWwE9iB903RuaGFbE1URX8uoTQtbTgNtxdCqRSy8PHs_6Blf0rygAGBbrQeYMHFp78Pp_mBMYp_K',
      description: 'Khung sườn hợp kim Magie siêu bền, cảm biến quang học PAW3395 26.000 DPI, nút bấm im lặng giảm ồn.',
      badge: 'SIÊU NHẸ 54G', tags: 'Nặng 54g,26.000 DPI', rating: 4.7, reviews: 31, sold: 90, stock: 35,
    },
    {
      name: 'Loa để bàn Carbon Fiber 50W', category: 'Thiết bị âm thanh', price: 2590000, old_price: 2990000,
      image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCl0G9x9ZXwApvD7j4KQtbstDqVCXkCIkX_O2BXBX_U0r0Gurd2MAiYeCdKXVmAZmsm6FNfcWoyaU1Vq8PZ2peLmva9SaxndHpO0rlYShTIiXePSUG6d_dY_7y_-CUUK3xc7z5WsmdJa0eBoKAVod9frUFTT0J6DyPdHg0xN8dHU-KSrgyZcqB5UvfEbJNO_WahGXbt_tHnKeEYcphS9PMGp6lc43T8EzpvxT7IdnKu7Y6jwlREcqNG',
      description: 'Củ loa dệt sợi Carbon composite tái tạo bass uy lực, mạch DSP khuếch đại Class D chuẩn xác không méo tiếng.',
      badge: 'ACOUSTIC PRO', tags: 'Công suất 50W RMS,Optical & AUX', rating: 4.9, reviews: 19, sold: 70, stock: 22,
    },
    {
      name: 'Hub mở rộng đa cổng kim loại', category: 'Phụ kiện bàn làm việc', price: 1650000, old_price: 1890000,
      image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuA-sTZ9tdS0ElHYVj2BXIAfqupzPkbYIeBixKt93v4TaVx3L6MvKnDkcIqYYT02WlVnWZaZcz1QjOzJpYtEiBIVS5DbtLhBilFHuFPvA2XizqrrsHKvAisi742EvPsQ-5tw21cS6EDHgxLY0L0Axa9bCChGQQlU-1gspE6bxunB9t21VA5cU9stNgKKUHJ3hEBDAbnB9_Q9t3bcj7YCdHS9xi7nTXJoxUwFDtGouQwGAG9OAMzStrAf',
      description: 'Hỗ trợ xuất hình 4K 120Hz qua HDMI 2.1, cổng mạng Gigabit LAN 2.5Gbps, khe thẻ SD UHS-II tốc độ cao.',
      badge: 'TẢN NHIỆT RÃNH', tags: 'HDMI 4K120Hz,LAN 2.5G', rating: 4.8, reviews: 64, sold: 150, stock: 48,
    },
    {
      name: 'Đế sạc không dây 3 in 1 Da Mộc', category: 'Nguồn & Trạm sạc đa năng', price: 850000, old_price: 1050000,
      image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuB-LtQuBtzDOU94opKzskjVIXkhokeXM1ECPqK-bfIZ0HsN-DfRT4LNcab6hjvJeOz7ALaVH_SSldcwlgbqEEu4i_7QSn6kt0rZbxsLH8RziBlPYbx0xDiECiF3k-JTzrbu0OdODcXFkbtvp7G0dHXIIUkYboAJuQuEgeejtEiQ-FC6g4Qo_9JJJTX4mJyvm1ShamB06tToNJeIf3vtl_NGW3iEZd8RY9PJTyP_Pb7a8RI0RcVyD8B0',
      description: 'Mặt lót da bò veg-tan nguyên bản patina theo thời gian, hỗ trợ chuẩn sạc nam châm Qi2 15W sạc nhanh.',
      badge: 'DA THẬT HANDMADE', tags: 'Chuẩn Qi2 15W,Da Bò Veg-tan', rating: 4.9, reviews: 52, sold: 200, stock: 30,
    },
  ];

  const slugify = (s) => s.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  const insert = db.prepare(`INSERT INTO products
    (name, slug, category, price, old_price, image, images, description, long_description, badge, tags, stock, rating, reviews, sold)
    VALUES (@name, @slug, @category, @price, @old_price, @image, @images, @description, @long_description, @badge, @tags, @stock, @rating, @reviews, @sold)`);

  for (const p of products) {
    insert.run({
      ...p,
      slug: slugify(p.name),
      images: JSON.stringify([p.image]),
      long_description: p.description + ' Sản phẩm được Chợ Trời tuyển chọn kỹ lưỡng, kiểm tra chất lượng và bảo hành chính hãng 24 tháng.',
    });
  }
  console.log('Seeded', products.length, 'products');
}

module.exports = db;
