const express = require('express');
const router = express.Router();
const User = require('../models/user');
const Code = require('../models/code');
const Notification = require('../models/notification');
const { isLoggedIn } = require('../middleware');
const { upload, cloudinary } = require('../config/cloudinary');
const mongoose = require('mongoose');

const ITEMS_PER_PAGE_PROFILE = 8;
const ITEMS_PER_PAGE_NOTIF = 15;
const ITEMS_PER_PAGE_SEARCH = 10;


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
            if (req.file && req.file.filename) await cloudinary.uploader.destroy(req.file.filename);
            return res.redirect('/');
        }

        const { username, email, bio } = req.body;
        let updateData = { bio: bio || '' };

        const newUsername = username ? username.trim().toLowerCase() : null;
        const newEmail = email ? email.toLowerCase().trim() : null;

        if (newUsername && newUsername !== userToUpdate.username) {
            const existingUserByUsername = await User.findOne({ username: newUsername, _id: { $ne: userToUpdate._id } });
            if (existingUserByUsername) {
                req.flash('error', 'Username already taken.');
                if (req.file && req.file.filename) await cloudinary.uploader.destroy(req.file.filename);
                return res.redirect('/users/profile/edit');
            }
            updateData.username = newUsername;
        }

        if (newEmail && newEmail !== userToUpdate.email) {
            const existingUserByEmail = await User.findOne({ email: newEmail, _id: { $ne: userToUpdate._id } });
            if (existingUserByEmail) {
                req.flash('error', 'Email already taken.');
                if (req.file && req.file.filename) await cloudinary.uploader.destroy(req.file.filename);
                return res.redirect('/users/profile/edit');
            }
            updateData.email = newEmail;
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
        if (updatedUser.avatar && updatedUser.avatar.url) {
          req.session.user.avatar_url = updatedUser.avatar.url;
        }

        req.flash('success', 'Profile updated successfully!');
        res.redirect(`/${updatedUser.username.toLowerCase()}`);

    } catch (err) {
        if (req.file && req.file.filename) {
            await cloudinary.uploader.destroy(req.file.filename).catch(e => console.error("Error deleting uploaded avatar on profile update fail:", e));
        }
        if (err.name === 'ValidationError') {
            let errors = Object.values(err.errors).map(val => val.message);
            req.flash('error', errors.join(', '));
        } else {
            console.error("Profile Edit Error:", err);
            req.flash('error', 'Could not update profile.');
        }
        res.redirect('/users/profile/edit');
    }
});

router.post('/:userIdToFollow/follow', isLoggedIn, async (req, res, next) => {
    const backURL = req.header('Referer') || '/';
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.userIdToFollow)) {
            req.flash('error', 'Invalid user ID to follow.');
            return res.redirect(backURL);
        }
        const userToFollowId = new mongoose.Types.ObjectId(req.params.userIdToFollow);
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
        let notification;

        if (isFollowing) {
            currentUser.following.pull(userToFollowId);
            userToFollow.followers.pull(currentUserId);
            req.flash('success', `You unfollowed ${userToFollow.username}.`);
        } else {
            currentUser.following.push(userToFollowId);
            userToFollow.followers.push(currentUserId);
            
            notification = new Notification({
                recipient: userToFollow._id,
                sender: currentUser._id,
                type: 'follow',
            });
            req.flash('success', `You are now following ${userToFollow.username}.`);
        }

        await currentUser.save();
        await userToFollow.save();
        if (notification) await notification.save();

        res.redirect(backURL);

    } catch (err) {
        console.error("Follow error:", err);
        req.flash('error', 'Could not process follow request.');
        res.redirect(backURL);
    }
});

router.get('/notifications', isLoggedIn, async (req, res, next) => {
    try {
        const page = +req.query.page || 1;
        const query = { recipient: req.session.user._id };

        const totalNotifications = await Notification.countDocuments(query);
        const notifications = await Notification.find(query)
            .populate('sender', 'username avatar.url _id')
            .populate('targetPost', 'title _id uploader')
            .sort({ createdAt: -1 })
            .skip((page - 1) * ITEMS_PER_PAGE_NOTIF)
            .limit(ITEMS_PER_PAGE_NOTIF)
            .lean();
        
        const unreadCount = await Notification.countDocuments({ recipient: req.session.user._id, isRead: false });

        res.render('notifications', {
            pageTitle: 'Your Notifications - SHARE SOURCE CODE',
            notifications,
            currentPage: page,
            hasNextPage: ITEMS_PER_PAGE_NOTIF * page < totalNotifications,
            hasPreviousPage: page > 1,
            nextPage: page + 1,
            previousPage: page - 1,
            lastPage: Math.ceil(totalNotifications / ITEMS_PER_PAGE_NOTIF),
            unreadNotificationsCount: unreadCount
        });

        const notificationIdsToMarkRead = notifications.filter(n => !n.isRead).map(n => n._id);
        if (notificationIdsToMarkRead.length > 0) {
            await Notification.updateMany(
                { _id: { $in: notificationIdsToMarkRead }, recipient: req.session.user._id },
                { $set: { isRead: true } }
            );
        }
    } catch (err) {
        next(err);
    }
});

router.post('/notifications/:notifId/read', isLoggedIn, async (req, res) => {
    try {
        const notification = await Notification.findOneAndUpdate(
            { _id: req.params.notifId, recipient: req.session.user._id },
            { $set: { isRead: true } },
            { new: true }
        ).populate('targetPost', '_id').populate('sender', 'username');

        if (notification) {
            if (req.query.redirect === 'true') {
                if (notification.targetPost && notification.targetPost._id) {
                    return res.redirect(`/codes/view/${notification.targetPost._id}`);
                } else if (notification.type === 'follow' && notification.sender && notification.sender.username) {
                    return res.redirect(`/${notification.sender.username.toLowerCase()}`);
                }
            }
        }
        res.json({ success: true });
    } catch (error) {
        console.error("Error marking notification read:", error);
        res.status(500).json({ success: false, message: 'Failed to mark as read' });
    }
});

router.get('/search', async (req, res, next) => {
    try {
        const query = req.query.q || '';
        const page = +req.query.page || 1;
        const searchType = req.query.type || 'codes';
        
        let results = [];
        let totalItems = 0;
        let searchTitle = `Search Results`;
        const backURL = req.header('Referer') || '/';

        if (query.trim() === '') {
            req.flash('error', 'Please enter a search term.');
            return res.redirect(backURL);
        }

        searchTitle = `${searchType === 'users' ? 'User' : 'Code'} Search for "${query}"`;

        if (searchType === 'users') {
            const userSearchQuery = { username: { $regex: query, $options: 'i' } };
            totalItems = await User.countDocuments(userSearchQuery);
            results = await User.find(userSearchQuery)
                .select('username bio avatar.url createdAt')
                .sort({ createdAt: -1 })
                .skip((page - 1) * ITEMS_PER_PAGE_SEARCH)
                .limit(ITEMS_PER_PAGE_SEARCH)
                .lean();
        } else {
            const codeSearchQuery = {
                isPublic: true,
                $or: [
                    { title: { $regex: query, $options: 'i' } },
                    { description: { $regex: query, $options: 'i' } },
                    { snippetLanguage: { $regex: query, $options: 'i' } }
                ]
            };
            totalItems = await Code.countDocuments(codeSearchQuery);
            results = await Code.find(codeSearchQuery)
                .populate('uploader', 'username avatar.url')
                .sort({ createdAt: -1 })
                .skip((page - 1) * ITEMS_PER_PAGE_SEARCH)
                .limit(ITEMS_PER_PAGE_SEARCH)
                .lean();
        }

        res.render('search-results', {
            pageTitle: searchTitle,
            query,
            searchType,
            results,
            currentPage: page,
            hasNextPage: ITEMS_PER_PAGE_SEARCH * page < totalItems,
            hasPreviousPage: page > 1,
            nextPage: page + 1,
            previousPage: page - 1,
            lastPage: Math.ceil(totalItems / ITEMS_PER_PAGE_SEARCH)
        });

    } catch (err) {
        next(err);
    }
});

module.exports = router;