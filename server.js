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
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
}));

app.use(flash());

app.use(async (req, res, next) => {
  res.locals.currentUser = req.session.user;
  if (req.session.user) {
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
        .populate('followers', 'username avatar.url _id')
        .populate('following', 'username avatar.url _id')
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
        const commonRoutesAndPrefixes = ['login', 'register', 'logout', 'search', 'public', 'uploads', 'images', 'js', 'css', 'favicon.ico', 'users', 'codes', 'notifications', 'assets', 'fonts'];
        
        if (commonRoutesAndPrefixes.some(routeOrPrefix => requestedUsername.startsWith(routeOrPrefix))) {
            if (commonRoutesAndPrefixes.includes(requestedUsername) || 
                (requestedUsername.includes('/') && commonRoutesAndPrefixes.some(prefix => requestedUsername.startsWith(prefix + '/'))) ) {
                return next(); 
            }
        }
        // Khusus untuk rute yang mungkin konflik dengan file statis
        if (/\.[a-zA-Z0-9]+$/.test(requestedUsername)) { // Ada ekstensi file
            return next();
        }
        
        const profileUserData = await populateProfileDataForServer(requestedUsername);

        if (!profileUserData) {
            return next(); // Biarkan 404 handler di bawah menangani jika tidak ditemukan
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
    const error = new Error(`Not Found - ${req.originalUrl}`);
    error.status = 404;
    next(error);
});

app.use((err, req, res, next) => {
  console.error("Global error handler:", err.name, err.message, err.status);
  const backURL = req.header('Referer') || '/';
  if (!res.headersSent) {
    if (err.status === 404) {
        res.status(404).render('404', { pageTitle: "Page Not Found - SHARE SOURCE CODE" });
    } else {
        req.flash('error', err.message || 'Something went terribly wrong!');
        res.status(err.status || 500).redirect(backURL);
    }
  } else {
    next(err);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`SHARE SOURCE CODE server running on port ${PORT}`);
});