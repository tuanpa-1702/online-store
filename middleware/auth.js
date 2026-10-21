function isAdmin(user) {
  return !!(user && (user.role === 'admin' || user.is_admin));
}
function isStaff(user) {
  return !!(user && (user.role === 'admin' || user.role === 'staff' || user.is_admin));
}

function ensureAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  req.session.returnTo = req.originalUrl;
  res.redirect('/login');
}

function ensureAdmin(req, res, next) {
  if (isAdmin(req.user)) return next();
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/login');
  }
  res.status(403).render('error', { title: 'Không có quyền', message: 'Chức năng này chỉ dành cho quản trị viên.' });
}

// Admin or staff may enter the admin area
function ensureStaff(req, res, next) {
  if (isStaff(req.user)) return next();
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/login');
  }
  res.status(403).render('error', { title: 'Không có quyền', message: 'Bạn không có quyền truy cập trang quản trị.' });
}

module.exports = { ensureAuth, ensureAdmin, ensureStaff, isAdmin, isStaff };
