const express = require('express');
const router = express.Router();
const User = require('../models/user');
const Code = require('../models/code');
const { isLoggedIn } = require('../middleware');

const ITEMS_PER_PAGE_PROFILE = 8;

// My Profile Route
router.get('/profile', isLoggedIn, async (req, res, next) => {
    try {
        const user = await User.findById(req.session.user._id).lean();
        if (!user) {
            req.flash('error', 'User not found.');
            return res.redirect('/');
        }

        const page = +req.query.page || 1;
        const query = { uploader: req.session.user._id };

        const totalItems = await Code.countDocuments(query);
        const userCodes = await Code.find(query)
            .sort({ createdAt: -1 })
            .skip((page - 1) * ITEMS_PER_PAGE_PROFILE)
            .limit(ITEMS_PER_PAGE_PROFILE)
            .lean();

        res.render('profile', {
            user,
            codes: userCodes,
            pageTitle: `${user.username}'s Profile - SHARE SOURCE CODE`,
            currentPage: page,
            hasNextPage: ITEMS_PER_PAGE_PROFILE * page < totalItems,
            hasPreviousPage: page > 1,
            nextPage: page + 1,
            previousPage: page - 1,
            lastPage: Math.ceil(totalItems / ITEMS_PER_PAGE_PROFILE),
            profilePath: '/users/profile' // For pagination links
        });
    } catch (err) {
        next(err);
    }
});

// (Optional) Public User Profile Route
router.get('/:userId', async (req, res, next) => {
    try {
        const user = await User.findById(req.params.userId).lean();
        if (!user) {
            req.flash('error', 'User not found.');
            return res.redirect('/');
        }

        const page = +req.query.page || 1;
        // Only show public codes for other users' profiles
        const query = { uploader: req.params.userId, isPublic: true }; 

        const totalItems = await Code.countDocuments(query);
        const userCodes = await Code.find(query)
            .sort({ createdAt: -1 })
            .skip((page - 1) * ITEMS_PER_PAGE_PROFILE)
            .limit(ITEMS_PER_PAGE_PROFILE)
            .lean();

        res.render('profile', { // Re-use profile.ejs, but logic inside will differ
            user, // The user whose profile is being viewed
            codes: userCodes,
            pageTitle: `${user.username}'s Profile - SHARE SOURCE CODE`,
            isOwnProfile: req.session.user && req.session.user._id === req.params.userId,
            currentPage: page,
            hasNextPage: ITEMS_PER_PAGE_PROFILE * page < totalItems,
            hasPreviousPage: page > 1,
            nextPage: page + 1,
            previousPage: page - 1,
            lastPage: Math.ceil(totalItems / ITEMS_PER_PAGE_PROFILE),
            profilePath: `/users/${req.params.userId}` // For pagination links
        });

    } catch (err) {
        if (err.kind === 'ObjectId') {
             req.flash('error', 'User not found (invalid ID).');
             return res.redirect('/');
        }
        next(err);
    }
});


module.exports = router;