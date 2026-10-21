const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const db = require('../db');
require('dotenv').config();

passport.serializeUser((user, done) => done(null, user.id));

passport.deserializeUser((id, done) => {
  try {
    const user = db.prepare('SELECT id, email, name, avatar, is_admin, role FROM users WHERE id = ?').get(id);
    done(null, user || false);
  } catch (e) {
    done(e);
  }
});

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback',
  }, (accessToken, refreshToken, profile, done) => {
    try {
      const email = profile.emails && profile.emails[0] && profile.emails[0].value;
      const name = profile.displayName || 'Người dùng';
      const avatar = profile.photos && profile.photos[0] && profile.photos[0].value;
      const googleId = profile.id;

      let user = db.prepare('SELECT * FROM users WHERE google_id = ? OR email = ?').get(googleId, email);
      if (user) {
        // link google id / update avatar if missing
        db.prepare('UPDATE users SET google_id = ?, avatar = COALESCE(?, avatar), name = COALESCE(name, ?) WHERE id = ?')
          .run(googleId, avatar, name, user.id);
      } else {
        const info = db.prepare('INSERT INTO users (email, name, avatar, google_id) VALUES (?, ?, ?, ?)')
          .run(email, name, avatar, googleId);
        user = { id: info.lastInsertRowid };
      }
      const full = db.prepare('SELECT id, email, name, avatar, is_admin, role FROM users WHERE id = ?').get(user.id);
      done(null, full);
    } catch (e) {
      done(e);
    }
  }));
}

module.exports = passport;
