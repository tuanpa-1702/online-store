# Chợ Trời — Web bán hàng

Node.js (Express + EJS) + SQLite. Chạy trên cổng **3003**.

## Chạy / quản lý app
```bash
cd /var/www/store
pm2 start server.js --name chotroi   # khởi động
pm2 restart chotroi                  # khởi động lại sau khi sửa code
pm2 logs chotroi                     # xem log
pm2 save                             # lưu danh sách process
```

## Tài khoản quản trị mặc định
- URL: `/admin`
- Email: `admin@your-domain.com`
- Mật khẩu: `(đặt trong .env → ADMIN_PASSWORD)`  (đổi trong file `.env` -> `ADMIN_PASSWORD` trước lần chạy đầu, hoặc đổi sau trong DB)

## Tính năng
- Trang chủ: danh sách sản phẩm, lọc theo danh mục, tìm kiếm, sắp xếp.
- Chi tiết sản phẩm, sản phẩm liên quan.
- Giỏ hàng (session), cập nhật số lượng, xóa.
- Thanh toán: COD hoặc chuyển khoản/QR, tạo đơn hàng.
- Đăng nhập Google + Đăng nhập/Đăng ký Email (mật khẩu bcrypt).
- Tài khoản: xem lịch sử đơn hàng.
- Admin: tổng quan, quản lý sản phẩm (CRUD + upload ảnh), đơn hàng (đổi trạng thái),
  người dùng (cấp/bỏ quyền admin), cấu hình (tên web, banner, QR thanh toán, thông tin
  ngân hàng, giới thiệu, phí vận chuyển...).


### 1. Cấu hình nginx reverse proxy (cần sudo)
```bash
sudo cp /var/www/store/nginx-chotroi.conf /etc/nginx/sites-available/chotroi.tuanpa.tech
sudo ln -s /etc/nginx/sites-available/chotroi.tuanpa.tech /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### 2. Cài SSL (HTTPS) bằng certbot
```bash
sudo certbot --nginx -d chotroi.tuanpa.tech
```

### 3. Cấu hình Google OAuth
Vào Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client, thêm:
- **Authorized JavaScript origins:** `https://chotroi.tuanpa.tech`
- **Authorized redirect URIs:** `https://chotroi.tuanpa.tech/auth/google/callback`

(Client ID và Secret đã được đặt sẵn trong file `.env`.)

### 4. (Khuyến nghị) Tự khởi động pm2 khi reboot
```bash
pm2 startup        # chạy dòng lệnh mà nó in ra (cần sudo)
pm2 save
```

## Cấu hình
Mọi thông số nằm trong file `.env`. Đổi `SESSION_SECRET` và `ADMIN_PASSWORD` cho an toàn.
