const express = require('express');
const router = express.Router();
const User = require('../models/user');
const Code = require('../models/code');
const { isLoggedIn } = require('../middleware');
const { upload, cloudinary } = require('../config/cloudinary');
const mongoose = require('mongoose');
const ITEMS_PER_PAGE_PROFILE = 8;

const populateFollowsAndCounts = async (userId) => {
    const user = await User.findById(userId)
        .populate('followers', 'username avatar.url _id') // Select specific fields
        .populate('following', 'username avatar.url _id') // Select specific fields
        .lean(); // Use lean for plain JS object

    if (user) {
        // Ensure followers and following are arrays, even if empty from populate
        user.followers = user.followers || [];
        user.following = user.following || [];
        // Add counts directly to the user object
        user.followerCount = user.followers.length;
        user.followingCount = user.following.length;
        user.postCount = await Code.countDocuments({ uploader: userId });
        user.likedPostCount = await Code.countDocuments({ likes: userId, isPublic: true }); // Count public liked posts
    }
    return user;
};

router.get('/profile', isLoggedIn, async (req, res, next) => {
    try {
        const userProfileData = await populateFollowsAndCounts(req.session.user._id);
        if (!userProfileData) {
            req.flash('error', 'User not found.');
            return res.redirect('/');
        }

        const page = +req.query.page || 1;
        const tab = req.query.tab || 'posts';
        let items = [];
        let totalItemsInTab = 0;
        let query = {};
        const currentPathBase = `/users/profile`; // Path dasar untuk link paginasi

        if (tab === 'posts') {
            query = { uploader: req.session.user._id };
            totalItemsInTab = await Code.countDocuments(query);
            items = await Code.find(query)
                .sort({ createdAt: -1 })
                .skip((page - 1) * ITEMS_PER_PAGE_PROFILE)
                .limit(ITEMS_PER_PAGE_PROFILE)
                .populate('uploader', 'username avatar.url')
                .lean();
        } else if (tab === 'liked') {
            query = { likes: req.session.user._id }; // Bisa private atau public yang dia like
            totalItemsInTab = await Code.countDocuments(query);
            items = await Code.find(query)
                .sort({ createdAt: -1 })
                .skip((page - 1) * ITEMS_PER_PAGE_PROFILE)
                .limit(ITEMS_PER_PAGE_PROFILE)
                .populate('uploader', 'username avatar.url')
                .lean();
        } else if (tab === 'followers') {
            totalItemsInTab = userProfileData.followerCount;
            const start = (page - 1) * ITEMS_PER_PAGE_PROFILE;
            const end = start + ITEMS_PER_PAGE_PROFILE;
            items = userProfileData.followers.slice(start, end);
        } else if (tab === 'following') {
            totalItemsInTab = userProfileData.followingCount;
            const start = (page - 1) * ITEMS_PER_PAGE_PROFILE;
            const end = start + ITEMS_PER_PAGE_PROFILE;
            items = userProfileData.following.slice(start, end);
        }

        res.render('profile', {
            user: req.session.user, // currentUser from session
            profileData: userProfileData, // The user whose profile is being viewed
            items,
            tab,
            pageTitle: `${userProfileData.username}'s Profile - SHARE SOURCE CODE`,
            isOwnProfile: true,
            currentPage: page,
            hasNextPage: ITEMS_PER_PAGE_PROFILE * page < totalItemsInTab,
            hasPreviousPage: page > 1,
            nextPage: page + 1,
            previousPage: page - 1,
            lastPage: Math.ceil(totalItemsInTab / ITEMS_PER_PAGE_PROFILE),
            profilePathBase: currentPathBase
        });
    } catch (err) {
        next(err);
    }
});

router.get('/profile/edit', isLoggedIn, async (req, res, next) => {
    try {
        const user = await User.findById(req.session.user._id).lean();
        if (!user) {
            req.flash('error', 'User not found.');
            return res.redirect('/');
        }
        res.render('edit-profile', {
            user,
            pageTitle: 'Edit Profile - SHARE SOURCE CODE'
        });
    } catch (err) {
        next(err);
    }
});

router.post('/profile/edit', isLoggedIn, upload.single('avatar'), async (req, res, next) => {
    try {
        const userToUpdate = await User.findById(req.session.user._id);
        if (!userToUpdate) {
            req.flash('error', 'User not found.');
            return res.redirect('/');
        }

        const { username, email, bio } = req.body;
        let updateData = { bio: bio || '' }; // Ensure bio is not undefined

        if (username && username.trim() !== userToUpdate.username) {
            const existingUserByUsername = await User.findOne({ username: username.trim(), _id: { $ne: userToUpdate._id } });
            if (existingUserByUsername) {
                req.flash('error', 'Username already taken.');
                if (req.file && req.file.filename) await cloudinary.uploader.destroy(req.file.filename);
                return res.redirect('/users/profile/edit');
            }
            updateData.username = username.trim();
        }

        if (email && email.toLowerCase().trim() !== userToUpdate.email) {
            const existingUserByEmail = await User.findOne({ email: email.toLowerCase().trim(), _id: { $ne: userToUpdate._id } });
            if (existingUserByEmail) {
                req.flash('error', 'Email already taken.');
                if (req.file && req.file.filename) await cloudinary.uploader.destroy(req.file.filename);
                return res.redirect('/users/profile/edit');
            }
            updateData.email = email.toLowerCase().trim();
        }

        if (req.file) {
            if (userToUpdate.avatar && userToUpdate.avatar.public_id) {
                await cloudinary.uploader.destroy(userToUpdate.avatar.public_id);
            }
            updateData.avatar = {
                url: req.file.path,
                public_id: req.file.filename
            };
        }

        const updatedUser = await User.findByIdAndUpdate(req.session.user._id, { $set: updateData }, { new: true, runValidators: true });

        req.session.user.username = updatedUser.username;
        req.session.user.email = updatedUser.email;
        // req.session.user.avatar_url = updatedUser.avatar.url; // If you store avatar in session

        req.flash('success', 'Profile updated successfully!');
        res.redirect('/users/profile');

    } catch (err) {
        if (req.file && req.file.filename) {
            await cloudinary.uploader.destroy(req.file.filename).catch(e => console.error("Error deleting uploaded avatar on profile update fail:", e));
        }
        if (err.name === 'ValidationError') {
            let errors = Object.values(err.errors).map(val => val.message);
            req.flash('error', errors.join(', '));
        } else {
            req.flash('error', 'Could not update profile.');
        }
        res.redirect('/users/profile/edit');
    }
});

router.get('/:userId', async (req, res, next) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.userId)) {
            req.flash('error', 'Invalid user ID format.');
            return res.redirect('/');
        }
        if (req.session.user && req.session.user._id.toString() === req.params.userId.toString()) {
            return res.redirect('/users/profile');
        }

        const profileUserData = await populateFollowsAndCounts(req.params.userId);
        if (!profileUserData) {
            req.flash('error', 'User not found.');
            return res.redirect('/');
        }

        const page = +req.query.page || 1;
        const tab = req.query.tab || 'posts';
        let items = [];
        let totalItemsInTab = 0;
        let query = {};
        const currentPathBase = `/users/${req.params.userId}`;

        if (tab === 'posts') {
            query = { uploader: req.params.userId, isPublic: true };
            totalItemsInTab = await Code.countDocuments(query);
            items = await Code.find(query)
                .sort({ createdAt: -1 })
                .skip((page - 1) * ITEMS_PER_PAGE_PROFILE)
                .limit(ITEMS_PER_PAGE_PROFILE)
                .populate('uploader', 'username avatar.url')
                .lean();
        } else if (tab === 'liked') {
            query = { likes: req.params.userId, isPublic: true };
            totalItemsInTab = await Code.countDocuments(query);
            items = await Code.find(query)
                .sort({ createdAt: -1 })
                .skip((page - 1) * ITEMS_PER_PAGE_PROFILE)
                .limit(ITEMS_PER_PAGE_PROFILE)
                .populate('uploader', 'username avatar.url')
                .lean();
        } else if (tab === 'followers') {
            totalItemsInTab = profileUserData.followerCount;
            const start = (page - 1) * ITEMS_PER_PAGE_PROFILE;
            const end = start + ITEMS_PER_PAGE_PROFILE;
            items = profileUserData.followers.slice(start, end);
        } else if (tab === 'following') {
            totalItemsInTab = profileUserData.followingCount;
            const start = (page - 1) * ITEMS_PER_PAGE_PROFILE;
            const end = start + ITEMS_PER_PAGE_PROFILE;
            items = profileUserData.following.slice(start, end);
        }

        res.render('profile', {
            user: req.session.user,
            profileData: profileUserData,
            items,
            tab,
            pageTitle: `${profileUserData.username}'s Profile - SHARE SOURCE CODE`,
            isOwnProfile: false,
            currentPage: page,
            hasNextPage: ITEMS_PER_PAGE_PROFILE * page < totalItemsInTab,
            hasPreviousPage: page > 1,
            nextPage: page + 1,
            previousPage: page - 1,
            lastPage: Math.ceil(totalItemsInTab / ITEMS_PER_PAGE_PROFILE),
            profilePathBase: currentPathBase
        });

    } catch (err) {
        if (err.kind === 'ObjectId' && err.path === '_id') { // More specific check
             req.flash('error', 'User not found (invalid ID).');
             return res.redirect('/');
        }
        next(err);
    }
});

router.post('/:userId/follow', isLoggedIn, async (req, res, next) => {
    const backURL = req.header('Referer') || `/users/${req.params.userId}`;
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.userId)) {
            req.flash('error', 'Invalid user ID to follow.');
            return res.redirect(backURL);
        }
        const userToFollowId = new mongoose.Types.ObjectId(req.params.userId);
        const currentUserId = new mongoose.Types.ObjectId(req.session.user._id);

        if (currentUserId.equals(userToFollowId)) {
            req.flash('error', 'You cannot follow yourself.');
            return res.redirect(backURL);
        }
        
        const userToFollow = await User.findById(userToFollowId);
        const currentUser = await User.findById(currentUserId);

        if (!userToFollow || !currentUser) {
            req.flash('error', 'User not found.');
            return res.redirect(backURL);
        }

        const isFollowing = currentUser.following.some(id => id.equals(userToFollowId));

        if (isFollowing) {
            currentUser.following.pull(userToFollowId);
            userToFollow.followers.pull(currentUserId);
            req.flash('success', `You unfollowed ${userToFollow.username}.`);
        } else {
            currentUser.following.push(userToFollowId);
            userToFollow.followers.push(currentUserId);
            req.flash('success', `You are now following ${userToFollow.username}.`);
        }

        await currentUser.save();
        await userToFollow.save();
        res.redirect(backURL);

    } catch (err) {
        req.flash('error', 'Could not process follow request.');
        res.redirect(backURL);
    }
});

module.exports = router;