require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const flash = require('connect-flash');
const methodOverride = require('method-override');
const path = require('path');
const User = require('./models/user');
const Code = require('./models/code');
const Notification = require('./models/notification');
const connectDB = require('./config/database');

const indexRoutes = require('./routes/index');
const authRoutes = require('./routes/auth');
const codeRoutes = require('./routes/codes');
const userRoutes = require('./routes/users');
const app = express();
connectDB();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.locals.moment = require('moment'); // Jika Anda ingin menggunakan moment.js di EJS

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
    maxAge: 1000 * 60 * 60 * 24 * 7 // 1 minggu
  }
}));

app.use(flash());

app.use(async (req, res, next) => {
  res.locals.currentUser = req.session.user;
  if (req.session.user && req.session.user._id) { // Pastikan _id ada
    try {
        res.locals.unreadNotificationsCount = await Notification.countDocuments({
            recipient: req.session.user._id,
            isRead: false
        });
    } catch (error) {
        console.error("Error fetching unread notifications count for header:", error);
        res.locals.unreadNotificationsCount = 0;
    }
  } else {
    res.locals.unreadNotificationsCount = 0;
  }
  res.locals.success = req.flash('success');
  res.locals.error = req.flash('error');
  res.locals.SITE_NAME = "SHARE SOURCE CODE"; // Contoh variabel global untuk EJS
  res.locals.currentPath = req.path; // Untuk active link di navigasi jika perlu
  next();
});

app.use('/', indexRoutes);
app.use('/', authRoutes);
app.use('/codes', codeRoutes);
app.use('/users', userRoutes);


const ITEMS_PER_PAGE_PROFILE_SERVER = 8;

async function populateProfileDataForServer(identifier) {
    let query = {};
    if (mongoose.Types.ObjectId.isValid(identifier)) {
        query._id = identifier;
    } else if (typeof identifier === 'string') {
        query.username = identifier.toLowerCase();
    } else {
        return null;
    }

    const user = await User.findOne(query)
        .populate('followers', 'username avatar.url _id country')
        .populate('following', 'username avatar.url _id country')
        .lean();

    if (!user) return null;

    user.followers = user.followers || [];
    user.following = user.following || [];
    user.followerCount = user.followers.length;
    user.followingCount = user.following.length;
    user.postCount = await Code.countDocuments({ uploader: user._id });
    user.likedPostCount = await Code.countDocuments({ likes: user._id, isPublic: true });
    return user;
}


app.get('/:username', async (req, res, next) => {
    try {
        const requestedUsername = req.params.username.toLowerCase();
        const commonRoutesAndPrefixes = ['login', 'register', 'logout', 'search', 'public', 'uploads', 'images', 'js', 'css', 'favicon.ico', 'users', 'codes', 'notifications', 'assets', 'api', 'admin'];
        if (commonRoutesAndPrefixes.some(prefix => requestedUsername.startsWith(prefix))) {
            return next(); 
        }
        
        const profileUserData = await populateProfileDataForServer(requestedUsername);

        if (!profileUserData) {
            req.flash('error', `User profile for "${req.params.username}" not found.`);
            return res.redirect('/');
        }
        
        const isOwnProfile = req.session.user && req.session.user._id.toString() === profileUserData._id.toString();

        const page = +req.query.page || 1;
        const tab = req.query.tab || 'posts';
        let items = [];
        let totalItemsInTab = 0;
        let query = {};
        const currentPathBase = `/${profileUserData.username.toLowerCase()}`;

        if (tab === 'posts') {
            query = { uploader: profileUserData._id };
            if (!isOwnProfile) query.isPublic = true; 
            totalItemsInTab = await Code.countDocuments(query);
            items = await Code.find(query)
                .sort({ createdAt: -1 })
                .skip((page - 1) * ITEMS_PER_PAGE_PROFILE_SERVER)
                .limit(ITEMS_PER_PAGE_PROFILE_SERVER)
                .populate('uploader', 'username avatar.url')
                .lean();
        } else if (tab === 'liked') {
            query = { likes: profileUserData._id, isPublic: true };
            totalItemsInTab = await Code.countDocuments(query);
            items = await Code.find(query)
                .sort({ createdAt: -1 })
                .skip((page - 1) * ITEMS_PER_PAGE_PROFILE_SERVER)
                .limit(ITEMS_PER_PAGE_PROFILE_SERVER)
                .populate('uploader', 'username avatar.url')
                .lean();
        } else if (tab === 'followers') {
            totalItemsInTab = profileUserData.followerCount;
            const start = (page - 1) * ITEMS_PER_PAGE_PROFILE_SERVER;
            const end = start + ITEMS_PER_PAGE_PROFILE_SERVER;
            items = profileUserData.followers.slice(start, end);
        } else if (tab === 'following') {
            totalItemsInTab = profileUserData.followingCount;
            const start = (page - 1) * ITEMS_PER_PAGE_PROFILE_SERVER;
            const end = start + ITEMS_PER_PAGE_PROFILE_SERVER;
            items = profileUserData.following.slice(start, end);
        }

        res.render('profile', {
            user: req.session.user,
            profileData: profileUserData,
            items,
            tab,
            pageTitle: `${profileUserData.username}'s Profile - SHARE SOURCE CODE`,
            isOwnProfile,
            currentPage: page,
            hasNextPage: ITEMS_PER_PAGE_PROFILE_SERVER * page < totalItemsInTab,
            hasPreviousPage: page > 1,
            nextPage: page + 1,
            previousPage: page - 1,
            lastPage: Math.ceil(totalItemsInTab / ITEMS_PER_PAGE_PROFILE_SERVER),
            profilePathBase: currentPathBase
        });

    } catch (err) {
        if (err.kind === 'ObjectId' && err.path === '_id') {
             req.flash('error', 'User not found or invalid ID format.');
             return res.redirect('/');
        }
        console.error("Error in /:username route:", err);
        next(err);
    }
});

app.use((req, res, next) => {
    const err = new Error('Page Not Found');
    err.status = 404;
    next(err);
});

app.use((err, req, res, next) => {
  console.error("Global error handler:", err);
  const statusCode = err.status || 500;
  const message = statusCode === 500 ? 'Oh no, something went wrong on our end!' : err.message;
  
  if (!res.headersSent) {
    if (req.accepts('html')) {
        res.status(statusCode).render('error', { // Asumsi ada error.ejs
            pageTitle: `${statusCode} Error - ${message}`,
            errorCode: statusCode,
            errorMessage: message,
            errorStack: process.env.NODE_ENV === 'development' ? err.stack : null
        });
    } else if (req.accepts('json')) {
        res.status(statusCode).json({ error: message, code: statusCode });
    } else {
        res.status(statusCode).send(message);
    }
  } else {
    next(err);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`SHARE SOURCE CODE server running on port ${PORT}`);
});