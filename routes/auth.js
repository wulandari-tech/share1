const express = require('express');
const router = express.Router();
const User = require('../models/user');
const bcrypt = require('bcryptjs'); // Pastikan bcryptjs di-require jika belum ada

router.get('/register', (req, res) => {
  if (req.session.user) {
    return res.redirect('/');
  }
  res.render('register', { pageTitle: "Register - SHARE SOURCE CODE" });
});

router.post('/register', async (req, res, next) => {
  try {
    if (req.session.user) {
      return res.redirect('/');
    }
    const { username, email, password, confirmPassword } = req.body;

    if (!username || !email || !password || !confirmPassword) {
        req.flash('error', 'All fields are required.');
        return res.redirect('/register');
    }

    if (password !== confirmPassword) {
      req.flash('error', 'Passwords do not match.');
      return res.redirect('/register');
    }

    const existingUser = await User.findOne({ $or: [{ email: email.toLowerCase() }, { username }] });
    if (existingUser) {
      req.flash('error', 'Email or Username already exists.');
      return res.redirect('/register');
    }

    const user = new User({ username, email: email.toLowerCase(), password });
    await user.save();
    
    req.session.user = { _id: user._id, username: user.username, email: user.email };
    req.flash('success', 'Welcome to SHARE SOURCE CODE! You are now registered and logged in.');
    res.redirect('/');

  } catch (err) {
    if (err.name === 'ValidationError') {
        let errors = Object.values(err.errors).map(val => val.message);
        req.flash('error', errors.join(', '));
        return res.redirect('/register');
    }
    // Untuk error lain, teruskan ke global error handler
    // req.flash() mungkin tidak aman di sini jika session rusak
    console.error("Register POST error:", err);
    next(err); // Ini akan ditangkap oleh global error handler di server.js
  }
});

router.get('/login', (req, res) => {
  if (req.session.user) {
    return res.redirect('/');
  }
  res.render('login', { pageTitle: "Login - SHARE SOURCE CODE" });
});

router.post('/login', async (req, res, next) => {
  try {
    if (req.session.user) {
      return res.redirect('/');
    }
    const { email, password } = req.body;

    if (!email || !password) {
        req.flash('error', 'Email and password are required.');
        return res.redirect('/login');
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      req.flash('error', 'Invalid email or password.');
      return res.redirect('/login');
    }

    const isMatch = await user.comparePassword(password); // comparePassword dari model User.js
    if (!isMatch) {
      req.flash('error', 'Invalid email or password.');
      return res.redirect('/login');
    }

    req.session.user = { _id: user._id, username: user.username, email: user.email };
    req.flash('success', 'Logged in successfully. Welcome back!');
    res.redirect('/');

  } catch (err) {
    // req.flash() mungkin tidak aman di sini jika session rusak
    console.error("Login POST error:", err);
    next(err); // Ini akan ditangkap oleh global error handler di server.js
  }
});

router.get('/logout', (req, res, next) => {
  if (!req.session) { // Pengecekan tambahan jika sesi entah bagaimana tidak ada
    console.error("Logout attempt with no session object.");
    return res.redirect('/'); // Redirect ke home jika tidak ada sesi
  }
  req.session.destroy(err => {
    const backURL = req.header('Referer') || '/';
    if (err) {
      console.error("Logout error during session.destroy:", err);
      // Di sini, jika session.destroy gagal, req.flash() juga bisa gagal.
      // Jadi, kita mungkin perlu mengirim pesan error dengan cara lain atau hanya redirect.
      // req.flash('error', 'Could not log you out. Please try again.');
      // Untuk amannya, kita hindari flash jika destroy gagal, karena bisa jadi session sudah rusak.
      return res.status(500).send(`
        <h1>Error Logging Out</h1>
        <p>Could not properly log you out due to a session error. Please try clearing your browser cookies for this site and try again.</p>
        <a href="/">Go to Homepage</a>
      `); // Atau cara lain yang lebih user-friendly
    }
    res.clearCookie('connect.sid'); // Nama cookie sesi default
    // Sekarang req.session sudah dihancurkan, jadi req.flash() tidak akan berfungsi.
    // Kita perlu cara lain untuk menampilkan pesan sukses, atau menerimanya begitu saja.
    // Salah satu cara adalah menggunakan query parameter setelah redirect, lalu menampilkannya di client.
    // Atau, terima saja redirect tanpa pesan sukses yang persisten.
    // Untuk konsistensi, kita akan mencoba mengandalkan sistem redirect yang mungkin menampilkan flash jika middleware-nya bisa.
    // Namun, karena req.session sudah tidak ada, req.flash() di middleware berikutnya juga tidak akan bekerja.
    // Jadi, kita tidak bisa menggunakan req.flash() di sini.
    
    // Solusi sederhana: redirect dengan query param untuk pesan
    // res.redirect('/?logout_success=true');
    // atau
    res.redirect('/'); // Pengguna akan melihat UI berubah menjadi logged out.
  });
});

module.exports = router;