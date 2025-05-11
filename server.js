require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const flash = require('connect-flash');
const methodOverride = require('method-override');
const path = require('path');
const User = require('./models/user');
const connectDB = require('./config/database');
const indexRoutes = require('./routes/index');
const authRoutes = require('./routes/auth');
const codeRoutes = require('./routes/codes');
const app = express();
connectDB();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    // secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
}));
app.use(flash());
app.use((req, res, next) => {
  res.locals.currentUser = req.session.user;
  res.locals.success = req.flash('success');
  res.locals.error = req.flash('error');
  next();
});
app.use('/', indexRoutes);
app.use('/', authRoutes);
app.use('/codes', codeRoutes);
app.use((err, req, res, next) => {
  console.error("Global error handler:", err);
  req.flash('error', err.message || 'Something went terribly wrong!');
  const backURL = req.header('Referer') || '/';
  res.redirect(backURL);
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`SHARE SOURCE CODE server running on port ${PORT}`);
});