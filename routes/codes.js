const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Code = require('../models/code');
const Comment = require('../models/comment');
const Notification = require('../models/notification');
const Report = require('../models/report');
const User = require('../models/user');
const { cloudinary, upload } = require('../config/cloudinary');
const { isLoggedIn, isAuthor } = require('../middleware');
const tmp = require('tmp');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');

function getFileExtensionForSnippet(language) {
  const langMap = {
    'javascript': '.js', 'python': '.py', 'htmlmixed': '.html', 'html': '.html',
    'css': '.css', 'java': '.java', 'c': '.c', 'cpp': '.cpp',
    'php': '.php', 'ruby': '.rb', 'go': '.go', 'rust': '.rs', 'swift': '.swift',
    'kotlin': '.kt', 'sql': '.sql', 'markdown': '.md', 'json': '.json',
    'yaml': '.yml', 'shell': '.sh', 'plaintext': '.txt'
  };
  return langMap[language] || '.txt';
}

async function deleteFromCloudinary(publicId, resourceType = "auto") {
    if (!publicId) return;
    try {
        await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
    } catch (error) {
        console.error(`Cloudinary Deletion Error for ${publicId}:`, error.message);
    }
}

router.get('/upload', isLoggedIn, (req, res) => {
  res.render('upload', { pageTitle: "Upload Code - SHARE SOURCE CODE", code: {} });
});

router.post('/', isLoggedIn, upload.single('file'), async (req, res, next) => {
  let tempFileObject = null;
  try {
    const { title, description, content: snippetContentFromForm, snippetLanguage, isPublic } = req.body;

    if (!snippetContentFromForm && !req.file) {
      req.flash('error', 'You must provide either code content or upload a file.');
      return res.redirect('/codes/upload');
    }

    const newCodeData = {
      title,
      description,
      snippetLanguage,
      isPublic: isPublic === 'on',
      uploader: req.session.user._id,
      isSnippetTextFile: false
    };

    if (req.file) {
      newCodeData.fileUrl = req.file.path;
      newCodeData.fileName = req.file.originalname;
      newCodeData.fileType = req.file.mimetype;
      newCodeData.cloudinaryPublicId = req.file.filename;
    } else if (snippetContentFromForm) {
      newCodeData.isSnippetTextFile = true;
      const sanitizedTitle = title.replace(/[^a-z0-9_.-]/gi, '_') || 'snippet';
      const snippetFileExtension = getFileExtensionForSnippet(snippetLanguage);
      const snippetFileName = `${sanitizedTitle}${snippetFileExtension}`;
      
      tempFileObject = tmp.fileSync({ postfix: snippetFileExtension });
      await fs.writeFile(tempFileObject.name, snippetContentFromForm);

      const result = await cloudinary.uploader.upload(tempFileObject.name, {
        folder: (process.env.CLOUDINARY_UPLOAD_FOLDER || 'code_share_uploads') + '/snippets',
        resource_type: "raw",
        public_id: `${sanitizedTitle}_${Date.now()}`
      });
      
      newCodeData.fileUrl = result.secure_url;
      newCodeData.fileName = snippetFileName;
      newCodeData.fileType = `text/${snippetLanguage === 'plaintext' ? 'plain' : snippetLanguage}`;
      newCodeData.cloudinaryPublicId = result.public_id;
    }

    const newCode = new Code(newCodeData);
    await newCode.save();
    req.flash('success', 'Code/File uploaded successfully!');
    res.redirect(`/codes/view/${newCode._id}`);

  } catch (err) {
    if (err.name === 'ValidationError') {
        let errors = Object.values(err.errors).map(val => val.message);
        req.flash('error', errors.join(' '));
        return res.redirect('/codes/upload');
    }
    if (err.http_code && err.message) {
        req.flash('error', `Cloudinary error: ${err.message}`);
    } else {
        console.error("Upload POST Error:", err);
        req.flash('error', `Upload failed: ${err.message || 'Unknown error'}`);
    }
    const backURLReferer = req.header('Referer') || '/codes/upload';
    res.redirect(backURLReferer);
  } finally {
    if (tempFileObject) {
      tempFileObject.removeCallback();
    }
  }
});

router.get('/view/:id', async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        req.flash('error', 'Invalid Post ID.');
        return res.redirect('/');
    }
    const codeDocument = await Code.findById(req.params.id).populate('uploader', 'username avatar.url _id');
    if (!codeDocument) {
      req.flash('error', 'Code not found.');
      return res.redirect('/');
    }
    
    const code = codeDocument.toObject();

    if (!code.isPublic && (!req.session.user || !code.uploader._id.toString() === (req.session.user._id).toString() )) {
      req.flash('error', 'This code is private.');
      return res.redirect('/');
    }
    
    let fetchedSnippetContent = null;
    if (code.fileUrl && code.isSnippetTextFile) {
      try {
        const response = await axios.get(code.fileUrl, { timeout: 7000 });
        fetchedSnippetContent = response.data;
      } catch (fetchErr) {
        console.error(`Fetch snippet content error from ${code.fileUrl}:`, fetchErr.message);
        fetchedSnippetContent = null; // Set to null on error
        req.flash('error', 'Could not load snippet content. It might be unavailable or too large.');
      }
    }
    
    const comments = await Comment.find({ codePost: code._id })
        .populate('author.id', 'username avatar.url _id')
        .sort({ createdAt: -1 })
        .lean();

    // Increment views only if not the uploader and logged in
    if (req.session.user && code.uploader._id.toString() !== req.session.user._id.toString()) {
        if(typeof codeDocument.views !== 'number') codeDocument.views = 0;
        codeDocument.views += 1;
        await codeDocument.save(); // Save the Mongoose document
        code.views = codeDocument.views; // Update the plain object
    }


    res.render('view', {
      code: { ...code, fetchedSnippetContent },
      comments,
      pageTitle: `${code.title} - SHARE SOURCE CODE`
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/edit', isLoggedIn, isAuthor, async (req, res, next) => {
    try {
        let codeToEdit = res.locals.code.toObject();
        let fetchedSnippetContentForEdit = null;

        if (codeToEdit.fileUrl && codeToEdit.isSnippetTextFile) {
            try {
                const response = await axios.get(codeToEdit.fileUrl, { timeout: 7000 });
                fetchedSnippetContentForEdit = response.data;
            } catch (fetchErr) {
                console.error(`Fetch snippet for edit error from ${codeToEdit.fileUrl}:`, fetchErr.message);
                req.flash('error', 'Could not load current snippet content for editing.');
            }
        }
        res.render('edit', {
            code: { ...codeToEdit, fetchedSnippetContentForEdit },
            pageTitle: `Edit ${codeToEdit.title} - SHARE SOURCE CODE`
        });
    } catch (err) {
        next(err);
    }
});

router.put('/:id', isLoggedIn, isAuthor, upload.single('file'), async (req, res, next) => {
  let tempFileObject = null;
  const codeToUpdate = res.locals.code;
  try {
    const { title, description, content: snippetContentFromForm, snippetLanguage, isPublic, removeFile } = req.body;

    if (!snippetContentFromForm && !req.file && !codeToUpdate.fileUrl && removeFile !== 'on') {
        req.flash('error', 'You must provide either code content or a file.');
        return res.redirect(`/codes/${req.params.id}/edit`);
    }
    
    const oldCloudinaryPublicId = codeToUpdate.cloudinaryPublicId;
    const oldIsSnippetTextFile = codeToUpdate.isSnippetTextFile;

    codeToUpdate.title = title;
    codeToUpdate.description = description;
    codeToUpdate.snippetLanguage = snippetLanguage;
    codeToUpdate.isPublic = isPublic === 'on';

    if (req.file) {
        if (oldCloudinaryPublicId) {
            await deleteFromCloudinary(oldCloudinaryPublicId, oldIsSnippetTextFile ? "raw" : "auto");
        }
        codeToUpdate.fileUrl = req.file.path;
        codeToUpdate.fileName = req.file.originalname;
        codeToUpdate.fileType = req.file.mimetype;
        codeToUpdate.cloudinaryPublicId = req.file.filename;
        codeToUpdate.isSnippetTextFile = false;
    } else if (removeFile === 'on') {
        if (oldCloudinaryPublicId) {
            await deleteFromCloudinary(oldCloudinaryPublicId, oldIsSnippetTextFile ? "raw" : "auto");
        }
        codeToUpdate.fileUrl = null;
        codeToUpdate.fileName = null;
        codeToUpdate.fileType = null;
        codeToUpdate.cloudinaryPublicId = null;
        codeToUpdate.isSnippetTextFile = false;
    } else if (snippetContentFromForm) {
        if (oldCloudinaryPublicId && (oldCloudinaryPublicId !== codeToUpdate.cloudinaryPublicId || !codeToUpdate.isSnippetTextFile)) {
            await deleteFromCloudinary(oldCloudinaryPublicId, oldIsSnippetTextFile ? "raw" : "auto");
        }
        
        const sanitizedTitle = title.replace(/[^a-z0-9_.-]/gi, '_') || 'snippet';
        const snippetFileExtension = getFileExtensionForSnippet(snippetLanguage);
        const snippetFileName = `${sanitizedTitle}${snippetFileExtension}`;

        tempFileObject = tmp.fileSync({ postfix: snippetFileExtension });
        await fs.writeFile(tempFileObject.name, snippetContentFromForm);
        
        const result = await cloudinary.uploader.upload(tempFileObject.name, {
            folder: (process.env.CLOUDINARY_UPLOAD_FOLDER || 'code_share_uploads') + '/snippets',
            resource_type: "raw",
            public_id: `${sanitizedTitle}_${Date.now()}`
        });

        codeToUpdate.fileUrl = result.secure_url;
        codeToUpdate.fileName = snippetFileName;
        codeToUpdate.fileType = `text/${snippetLanguage === 'plaintext' ? 'plain' : snippetLanguage}`;
        codeToUpdate.cloudinaryPublicId = result.public_id;
        codeToUpdate.isSnippetTextFile = true;
    }

    await codeToUpdate.save();
    req.flash('success', 'Code/File updated successfully!');
    res.redirect(`/codes/view/${codeToUpdate._id}`);
  } catch (err) {
     if (err.name === 'ValidationError') {
        let errors = Object.values(err.errors).map(val => val.message);
        req.flash('error', errors.join(' '));
        return res.redirect(`/codes/${req.params.id}/edit`);
    }
    if (err.http_code && err.message) {
        req.flash('error', `Cloudinary error: ${err.message}`);
    } else {
        console.error("Code PUT Error:", err);
        req.flash('error', `Update failed: ${err.message || 'Unknown error'}`);
    }
    const backURLReferer = req.header('Referer') || `/codes/${req.params.id}/edit`;
    res.redirect(backURLReferer);
  } finally {
    if (tempFileObject) {
      tempFileObject.removeCallback();
    }
  }
});

router.delete('/:id', isLoggedIn, isAuthor, async (req, res, next) => {
  try {
    const codeToDelete = res.locals.code;
    if (codeToDelete.cloudinaryPublicId) {
        await deleteFromCloudinary(codeToDelete.cloudinaryPublicId, codeToDelete.isSnippetTextFile ? "raw" : "auto");
    }
    await Comment.deleteMany({ codePost: codeToDelete._id });
    await Notification.deleteMany({ targetPost: codeToDelete._id });
    await Code.findByIdAndRemove(req.params.id);
    req.flash('success', 'Code/File and associated data deleted successfully!');
    res.redirect('/');
  } catch (err) {
    next(err);
  }
});

router.get('/:id/download-snippet', async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        req.flash('error', 'Invalid Post ID.');
        return res.redirect(req.header('Referer') || '/');
    }
    const code = await Code.findById(req.params.id).lean();
    const backURL = req.header('Referer') || `/codes/view/${req.params.id}`;

    if (!code) {
      req.flash('error', 'Code not found.');
      return res.redirect(backURL);
    }
    const uploaderIdString = code.uploader ? code.uploader.toString() : null;
    const currentUserIdString = req.session.user ? req.session.user._id.toString() : null;

    if (!code.isPublic && (!req.session.user || uploaderIdString !== currentUserIdString )) {
      req.flash('error', 'This code is private.');
      return res.redirect('/');
    }

    if (code.fileUrl && code.isSnippetTextFile) {
      return res.redirect(code.fileUrl);
    } else {
      req.flash('error', 'This entry does not have a direct text snippet file to download.');
      return res.redirect(backURL);
    }
  } catch (err) {
    next(err);
  }
});

router.post('/:id/like', isLoggedIn, async (req, res, next) => {
    const backURL = req.header('Referer') || `/codes/view/${req.params.id}`;
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            req.flash('error', 'Invalid Post ID.');
            return res.redirect(backURL);
        }
        const code = await Code.findById(req.params.id);
        if (!code) {
            req.flash('error', 'Code not found.');
            return res.redirect(backURL);
        }

        const userId = new mongoose.Types.ObjectId(req.session.user._id);
        const userIndexInLikes = code.likes.findIndex(id => id.equals(userId));
        let notification;

        if (userIndexInLikes > -1) {
            code.likes.splice(userIndexInLikes, 1);
            req.flash('success', 'Post unliked!');
        } else {
            code.likes.push(userId);
            if (!code.uploader.equals(userId)) {
                notification = new Notification({
                    recipient: code.uploader,
                    sender: userId,
                    type: 'like',
                    targetPost: code._id,
                });
            }
            req.flash('success', 'Post liked!');
        }
        await code.save();
        if (notification) await notification.save();

        res.redirect(backURL);
    } catch (err) {
        console.error("Like Error:", err);
        req.flash('error', 'Could not update like status.');
        res.redirect(backURL);
    }
});

router.post('/:id/comments', isLoggedIn, async (req, res, next) => {
    const backURL = req.header('Referer') || `/codes/view/${req.params.id}`;
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            req.flash('error', 'Invalid Post ID.');
            return res.redirect(backURL);
        }
        const code = await Code.findById(req.params.id);
        if (!code) {
            req.flash('error', 'Code not found.');
            return res.redirect(backURL);
        }
        if (!req.body.comment || !req.body.comment.text.trim()) {
            req.flash('error', 'Comment text cannot be empty.');
            return res.redirect(backURL);
        }

        const newComment = new Comment({
            text: req.body.comment.text.trim(),
            author: {
                id: req.session.user._id,
                username: req.session.user.username
            },
            codePost: code._id
        });
        await newComment.save();
        
        let notification;
        if (!code.uploader.equals(req.session.user._id)) {
            notification = new Notification({
                recipient: code.uploader,
                sender: req.session.user._id,
                type: 'comment',
                targetPost: code._id,
            });
            await notification.save();
        }
        req.flash('success', 'Comment added successfully!');
        res.redirect(backURL + '#comments-section');
    } catch (err) {
        if (err.name === 'ValidationError') {
            let errors = Object.values(err.errors).map(val => val.message);
            req.flash('error', errors.join(' '));
        } else {
            console.error("Comment POST Error:", err);
            req.flash('error', 'Could not add comment.');
        }
        res.redirect(backURL);
    }
});

router.delete('/:id/comments/:comment_id', isLoggedIn, async (req, res, next) => {
    const backURL = req.header('Referer') || `/codes/view/${req.params.id}`;
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id) || !mongoose.Types.ObjectId.isValid(req.params.comment_id)) {
            req.flash('error', 'Invalid ID.');
            return res.redirect(backURL);
        }
        const comment = await Comment.findById(req.params.comment_id);
        if (!comment) {
            req.flash('error', 'Comment not found.');
            return res.redirect(backURL);
        }
        
        const codePost = await Code.findById(req.params.id); // Ambil post untuk cek uploader
        const isCommentAuthor = comment.author.id.equals(req.session.user._id);
        const isPostUploader = codePost && codePost.uploader.equals(req.session.user._id);
        const isAdmin = req.session.user && req.session.user.role === 'admin'; // Perlu info role di session

        if (!isCommentAuthor && !isPostUploader && !isAdmin) {
             req.flash('error', 'You are not authorized to delete this comment.');
             return res.redirect(backURL);
        }

        await Comment.findByIdAndRemove(req.params.comment_id);
        req.flash('success', 'Comment deleted successfully!');
        res.redirect(backURL + '#comments-section');
    } catch (err) {
        console.error("Comment DELETE Error:", err);
        req.flash('error', 'Could not delete comment.');
        res.redirect(backURL);
    }
});

router.post('/:id/report', isLoggedIn, async (req, res, next) => {
    const backURL = req.header('Referer') || `/codes/view/${req.params.id}`;
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            req.flash('error', 'Invalid Post ID.');
            return res.redirect(backURL);
        }
        const codeToReport = await Code.findById(req.params.id);
        if (!codeToReport) {
            req.flash('error', 'Post not found.');
            return res.redirect(backURL);
        }

        const { reason } = req.body;
        if (!reason || reason.trim().length < 10) {
            req.flash('error', 'Please provide a reason for reporting (at least 10 characters).');
            return res.redirect(backURL);
        }

        const existingReport = await Report.findOne({
            reportedItemId: codeToReport._id,
            reporter: req.session.user._id,
            reportedItemType: 'Code'
        });

        if (existingReport) {
            req.flash('error', 'You have already reported this post.');
            return res.redirect(backURL);
        }

        const newReport = new Report({
            reportedItemType: 'Code',
            reportedItemId: codeToReport._id,
            reporter: req.session.user._id,
            reason: reason.trim()
        });
        await newReport.save();

        req.flash('success', 'Post reported successfully. Our team will review it.');
        res.redirect(backURL);

    } catch (err) {
        if (err.name === 'ValidationError') {
            let errorMessages = [];
            for (let field in err.errors) {
                errorMessages.push(err.errors[field].message);
            }
            req.flash('error', errorMessages.join(' '));
        } else {
            console.error("Report Post Error:", err);
            req.flash('error', 'Could not submit report. Please try again.');
        }
        res.redirect(backURL);
    }
});

module.exports = router;