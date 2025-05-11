const Code = require('../models/code');
const User = require('../models/user'); // Tambahkan User

const middlewareObj = {};

middlewareObj.isLoggedIn = function(req, res, next) {
  if (req.session.user) {
    return next();
  }
  req.flash('error', 'You need to be logged in to do that!');
  res.redirect('/login');
};

middlewareObj.isAuthor = async function(req, res, next) {
    const backURL = req.header('Referer') || '/';
    if (req.session.user) {
        try {
            const code = await Code.findById(req.params.id);
            if (!code) {
                req.flash('error', 'Code not found.');
                return res.redirect(backURL);
            }
            if (code.uploader.equals(req.session.user._id)) {
                res.locals.code = code;
                return next();
            } else {
                req.flash('error', 'You do not have permission to do that!');
                return res.redirect(backURL);
            }
        } catch (err) {
            console.error("isAuthor error:", err);
            req.flash('error', 'Something went wrong while checking permissions.');
            return res.redirect(backURL);
        }
    } else {
        req.flash('error', 'You need to be logged in to do that!');
        res.redirect('/login');
    }
};

middlewareObj.isAdmin = async function(req, res, next) {
    if (req.session.user) {
        try {
            const user = await User.findById(req.session.user._id).select('role').lean();
            if (user && user.role === 'admin') {
                return next();
            } else {
                req.flash('error', 'You do not have permission to access this page.');
                return res.redirect('/');
            }
        } catch (error) {
            req.flash('error', 'Error verifying admin status.');
            return res.redirect('/');
        }
    } else {
        req.flash('error', 'You need to be logged in to do that.');
        res.redirect('/login');
    }
};

module.exports = middlewareObj;