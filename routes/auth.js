const express = require('express');
const router = express.Router();
const User = require('../models/user');

router.get('/register', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('register', { pageTitle: "Register - SHARE SOURCE CODE" });
});

router.post('/register', async (req, res, next) => {
  if (req.session.user) return res.redirect('/');
  const { username, email, password, confirmPassword } = req.body;

  if (password !== confirmPassword) {
    req.flash('error', 'Passwords do not match.');
    return res.redirect('/register');
  }

  try {
    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) {
      req.flash('error', 'Email or Username already exists.');
      return res.redirect('/register');
    }

    const user = new User({ username, email, password });
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
    next(err);
  }
});

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login', { pageTitle: "Login - SHARE SOURCE CODE" });
});

router.post('/login', async (req, res, next) => {
  if (req.session.user) return res.redirect('/');
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) {
      req.flash('error', 'Invalid email or password.');
      return res.redirect('/login');
    }
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      req.flash('error', 'Invalid email or password.');
      return res.redirect('/login');
    }
    req.session.user = { _id: user._id, username: user.username, email: user.email };
    req.flash('success', 'Logged in successfully. Welcome back!');
    res.redirect('/');
  } catch (err) {
    next(err);
  }
});

router.get('/logout', (req, res, next) => {
  req.session.destroy(err => {
    if (err) {
      console.error("Logout error:", err);
      req.flash('error', 'Could not log you out. Please try again.');
      const backURL = req.header('Referer') || '/';
      return res.redirect(backURL);
    }
    res.clearCookie('connect.sid');
    req.flash('success', 'You have been logged out.');
    res.redirect('/');
  });
});

module.exports = router;