const express = require('express');
const router = express.Router();
const User = require('../models/user');
const Code = require('../models/code');
const Notification = require('../models/notification');
const { isLoggedIn } = require('../middleware');
const { upload, cloudinary } = require('../config/cloudinary');
const mongoose = require('mongoose');
const axios = require('axios');

const ITEMS_PER_PAGE_PROFILE = 8;
const ITEMS_PER_PAGE_NOTIF = 15;

async function populateProfileData(identifier) {
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

router.get('/profile/edit', isLoggedIn, async (req, res, next) => {
    try {
        const user = await User.findById(req.session.user._id).lean();
        if (!user) {
            req.flash('error', 'User not found.');
            return res.redirect('/');
        }
        const countries = ["Afghanistan","Albania","Algeria","Andorra","Angola","Antigua and Barbuda","Argentina","Armenia","Australia","Austria","Azerbaijan","Bahamas","Bahrain","Bangladesh","Barbados","Belarus","Belgium","Belize","Benin","Bhutan","Bolivia","Bosnia and Herzegovina","Botswana","Brazil","Brunei","Bulgaria","Burkina Faso","Burundi","Cabo Verde","Cambodia","Cameroon","Canada","Central African Republic","Chad","Chile","China","Colombia","Comoros","Congo, Democratic Republic of the","Congo, Republic of the","Costa Rica","Croatia","Cuba","Cyprus","Czech Republic","Denmark","Djibouti","Dominica","Dominican Republic","Ecuador","Egypt","El Salvador","Equatorial Guinea","Eritrea","Estonia","Eswatini","Ethiopia","Fiji","Finland","France","Gabon","Gambia","Georgia","Germany","Ghana","Greece","Grenada","Guatemala","Guinea","Guinea-Bissau","Guyana","Haiti","Honduras","Hungary","Iceland","India","Indonesia","Iran","Iraq","Ireland","Israel","Italy","Ivory Coast","Jamaica","Japan","Jordan","Kazakhstan","Kenya","Kiribati","Kosovo","Kuwait","Kyrgyzstan","Laos","Latvia","Lebanon","Lesotho","Liberia","Libya","Liechtenstein","Lithuania","Luxembourg","Madagascar","Malawi","Malaysia","Maldives","Mali","Malta","Marshall Islands","Mauritania","Mauritius","Mexico","Micronesia","Moldova","Monaco","Mongolia","Montenegro","Morocco","Mozambique","Myanmar","Namibia","Nauru","Nepal","Netherlands","New Zealand","Nicaragua","Niger","Nigeria","North Korea","North Macedonia","Norway","Oman","Pakistan","Palau","Palestine","Panama","Papua New Guinea","Paraguay","Peru","Philippines","Poland","Portugal","Qatar","Romania","Russia","Rwanda","Saint Kitts and Nevis","Saint Lucia","Saint Vincent and the Grenadines","Samoa","San Marino","Sao Tome and Principe","Saudi Arabia","Senegal","Serbia","Seychelles","Sierra Leone","Singapore","Slovakia","Slovenia","Solomon Islands","Somalia","South Africa","South Korea","South Sudan","Spain","Sri Lanka","Sudan","Suriname","Sweden","Switzerland","Syria","Taiwan","Tajikistan","Tanzania","Thailand","Timor-Leste","Togo","Tonga","Trinidad and Tobago","Tunisia","Turkey","Turkmenistan","Tuvalu","Uganda","Ukraine","United Arab Emirates","United Kingdom","United States","Uruguay","Uzbekistan","Vanuatu","Vatican City","Venezuela","Vietnam","Yemen","Zambia","Zimbabwe", "Other"];
        res.render('edit-profile', {
            user,
            countries,
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

        const { username, email, bio, country } = req.body;
        let updateData = { bio: bio || '', country: country || '' };

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
        req.session.user.country = updatedUser.country;


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
        res.json({ success: true, read: true }); 
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
        const ITEMS_PER_PAGE_SEARCH = 10;

        let results = [];
        let totalItems = 0;
        let searchTitle = `Search Results for "${query}"`;

        if (query.trim() === '') {
            req.flash('error', 'Please enter a search term.');
            return res.redirect(req.header('Referer') || '/');
        }

        if (searchType === 'users') {
            searchTitle = `User Search Results for "${query}"`;
            const userSearchQuery = { username: { $regex: query, $options: 'i' } };
            totalItems = await User.countDocuments(userSearchQuery);
            results = await User.find(userSearchQuery)
                .select('username bio avatar.url createdAt country')
                .sort({ createdAt: -1 })
                .skip((page - 1) * ITEMS_PER_PAGE_SEARCH)
                .limit(ITEMS_PER_PAGE_SEARCH)
                .lean();
        } else {
            searchTitle = `Code Search Results for "${query}"`;
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

router.get('/auth/github', isLoggedIn, (req, res) => {
    if (!process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_CALLBACK_URL) {
        req.flash('error', 'GitHub integration is not configured on the server.');
        return res.redirect('back');
    }
    const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${process.env.GITHUB_CLIENT_ID}&redirect_uri=${process.env.GITHUB_CALLBACK_URL}&scope=gist,user:email`;
    res.redirect(githubAuthUrl);
});

router.get('/auth/github/callback', isLoggedIn, async (req, res) => {
    const { code, error, error_description } = req.query;
    const backURL = '/users/profile/edit';

    if (error) {
        req.flash('error', `GitHub authorization failed: ${error_description || error}`);
        return res.redirect(backURL);
    }
    if (!code) {
        req.flash('error', 'GitHub authorization failed: No code received.');
        return res.redirect(backURL);
    }

    try {
        const tokenResponse = await axios.post('https://github.com/login/oauth/access_token', {
            client_id: process.env.GITHUB_CLIENT_ID,
            client_secret: process.env.GITHUB_CLIENT_SECRET,
            code: code,
            redirect_uri: process.env.GITHUB_CALLBACK_URL
        }, {
            headers: { 'Accept': 'application/json' }
        });

        const accessToken = tokenResponse.data.access_token;
        if (!accessToken) {
            req.flash('error', 'Failed to get GitHub access token.');
            return res.redirect(backURL);
        }

        const userResponse = await axios.get('https://api.github.com/user', {
            headers: { 'Authorization': `token ${accessToken}` }
        });
        
        const githubUser = userResponse.data;

        const currentUser = await User.findById(req.session.user._id);
        if (!currentUser) {
             req.flash('error', 'User session not found.');
             return res.redirect('/login');
        }
        
        currentUser.githubId = githubUser.id.toString();
        currentUser.githubAccessToken = accessToken;
        
        await currentUser.save();

        req.flash('success', 'GitHub account linked successfully!');
        res.redirect(backURL);

    } catch (error) {
        console.error('GitHub OAuth Callback Error:', error.response ? error.response.data : error.message);
        req.flash('error', 'Failed to link GitHub account. Please try again.');
        res.redirect(backURL);
    }
});

module.exports = router;