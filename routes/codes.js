const express = require('express');
const router = express.Router();
const Code = require('../models/code');
const Comment = require('../models/comment'); // <-- BARU
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
        console.error(`Failed to delete ${publicId} from Cloudinary:`, error);
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
      const snippetFileName = `${sanitizedTitle}${getFileExtensionForSnippet(snippetLanguage)}`;
      
      tempFileObject = tmp.fileSync({ postfix: getFileExtensionForSnippet(snippetLanguage) });
      await fs.writeFile(tempFileObject.name, snippetContentFromForm);

      const result = await cloudinary.uploader.upload(tempFileObject.name, {
        folder: process.env.CLOUDINARY_UPLOAD_FOLDER || 'code_share_uploads',
        resource_type: "raw",
        public_id: `${sanitizedTitle}_${Date.now()}`
      });
      
      newCodeData.fileUrl = result.secure_url;
      newCodeData.fileName = snippetFileName;
      newCodeData.fileType = 'text/plain';
      newCodeData.cloudinaryPublicId = result.public_id;
    }

    const newCode = new Code(newCodeData);
    await newCode.save();
    req.flash('success', 'Code/File uploaded successfully!');
    res.redirect(`/codes/view/${newCode._id}`);

  } catch (err) {
    if (err.name === 'ValidationError') {
        let errors = Object.values(err.errors).map(val => val.message);
        req.flash('error', errors.join(', '));
        return res.redirect('/codes/upload');
    }
    console.error("Upload error:", err);
    req.flash('error', `Upload failed: ${err.message || 'Unknown error'}`);
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
    const code = await Code.findById(req.params.id).populate('uploader', 'username').lean();
    if (!code) {
      req.flash('error', 'Code not found.');
      return res.redirect('/');
    }

    if (!code.isPublic && (!req.session.user || !code.uploader._id.toString() === (req.session.user._id).toString() )) {
      req.flash('error', 'This code is private.');
      return res.redirect('/');
    }
    
    let fetchedSnippetContent = null;
    if (code.fileUrl && code.isSnippetTextFile) {
      try {
        const response = await axios.get(code.fileUrl, { timeout: 5000 });
        fetchedSnippetContent = response.data;
      } catch (fetchErr) {
        console.error(`Failed to fetch snippet content from ${code.fileUrl}:`, fetchErr.message);
      }
    }
    
    const comments = await Comment.find({ codePost: code._id }).populate('author.id', 'username').sort({ createdAt: -1 }).lean(); // <-- BARU
    await Code.updateOne({ _id: req.params.id }, { $inc: { views: 1 } });

    res.render('view', {
      code: { ...code, fetchedSnippetContent },
      comments, // <-- BARU
      pageTitle: `${code.title} - SHARE SOURCE CODE`
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/edit', isLoggedIn, isAuthor, async (req, res, next) => {
    let codeToEdit = res.locals.code.toObject();
    let fetchedSnippetContentForEdit = null;

    if (codeToEdit.fileUrl && codeToEdit.isSnippetTextFile) {
        try {
            const response = await axios.get(codeToEdit.fileUrl, { timeout: 5000 });
            fetchedSnippetContentForEdit = response.data;
        } catch (fetchErr) {
            console.error(`Failed to fetch snippet for edit from ${codeToEdit.fileUrl}:`, fetchErr.message);
        }
    }
    res.render('edit', {
        code: { ...codeToEdit, fetchedSnippetContentForEdit },
        pageTitle: `Edit ${codeToEdit.title} - SHARE SOURCE CODE`
    });
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
        const snippetFileName = `${sanitizedTitle}${getFileExtensionForSnippet(snippetLanguage)}`;

        tempFileObject = tmp.fileSync({ postfix: getFileExtensionForSnippet(snippetLanguage) });
        await fs.writeFile(tempFileObject.name, snippetContentFromForm);
        const result = await cloudinary.uploader.upload(tempFileObject.name, {
            folder: process.env.CLOUDINARY_UPLOAD_FOLDER || 'code_share_uploads',
            resource_type: "raw",
            public_id: `${sanitizedTitle}_${Date.now()}`
        });
        codeToUpdate.fileUrl = result.secure_url;
        codeToUpdate.fileName = snippetFileName;
        codeToUpdate.fileType = 'text/plain';
        codeToUpdate.cloudinaryPublicId = result.public_id;
        codeToUpdate.isSnippetTextFile = true;
    }

    await codeToUpdate.save();
    req.flash('success', 'Code/File updated successfully!');
    res.redirect(`/codes/view/${codeToUpdate._id}`);
  } catch (err) {
     if (err.name === 'ValidationError') {
        let errors = Object.values(err.errors).map(val => val.message);
        req.flash('error', errors.join(', '));
        return res.redirect(`/codes/${req.params.id}/edit`);
    }
    console.error("Update error:", err);
    req.flash('error', `Update failed: ${err.message || 'Unknown error'}`);
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
    // Hapus komentar terkait sebelum menghapus postingan kode
    await Comment.deleteMany({ codePost: codeToDelete._id });
    
    await Code.findByIdAndRemove(req.params.id); // findByIdAndRemove is okay here

    req.flash('success', 'Code/File and associated comments deleted successfully!');
    res.redirect('/');
  } catch (err) {
    next(err);
  }
});

router.get('/:id/download-snippet', async (req, res, next) => {
  try {
    const code = await Code.findById(req.params.id).lean();
    const backURL = req.header('Referer') || `/codes/view/${req.params.id}`;

    if (!code) {
      req.flash('error', 'Code not found.');
      return res.redirect(backURL);
    }
    if (!code.isPublic && (!req.session.user || !code.uploader._id.toString() === (req.session.user._id).toString())) {
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

// Like/Unlike Route
router.post('/:id/like', isLoggedIn, async (req, res, next) => {
    const backURL = req.header('Referer') || `/codes/view/${req.params.id}`;
    try {
        const code = await Code.findById(req.params.id);
        if (!code) {
            req.flash('error', 'Code not found.');
            return res.redirect(backURL);
        }

        const userId = req.session.user._id;
        const userIndexInLikes = code.likes.findIndex(id => id.equals(userId));

        if (userIndexInLikes > -1) {
            code.likes.splice(userIndexInLikes, 1); // Unlike
            req.flash('success', 'Post unliked!');
        } else {
            code.likes.push(userId); // Like
            req.flash('success', 'Post liked!');
        }
        await code.save();
        res.redirect(backURL);
    } catch (err) {
        console.error("Like/Unlike error:", err);
        req.flash('error', 'Could not update like status.');
        res.redirect(backURL);
    }
});

// Add Comment Route
router.post('/:id/comments', isLoggedIn, async (req, res, next) => {
    const backURL = req.header('Referer') || `/codes/view/${req.params.id}`;
    try {
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
            text: req.body.comment.text,
            author: {
                id: req.session.user._id,
                username: req.session.user.username
            },
            codePost: code._id
        });
        await newComment.save();
        req.flash('success', 'Comment added successfully!');
        res.redirect(backURL + '#comments-section'); // Redirect to comments section
    } catch (err) {
        if (err.name === 'ValidationError') {
            let errors = Object.values(err.errors).map(val => val.message);
            req.flash('error', errors.join(', '));
        } else {
            console.error("Add comment error:", err);
            req.flash('error', 'Could not add comment.');
        }
        res.redirect(backURL);
    }
});

// Delete Comment Route (Optional - requires isCommentAuthor middleware if implemented fully)
router.delete('/:id/comments/:comment_id', isLoggedIn, async (req, res, next) => {
    const backURL = req.header('Referer') || `/codes/view/${req.params.id}`;
    try {
        const comment = await Comment.findById(req.params.comment_id);
        if (!comment) {
            req.flash('error', 'Comment not found.');
            return res.redirect(backURL);
        }
        // Basic author check (can be expanded into a middleware)
        if (!comment.author.id.equals(req.session.user._id)) {
            req.flash('error', 'You are not authorized to delete this comment.');
            return res.redirect(backURL);
        }
        await Comment.findByIdAndRemove(req.params.comment_id);
        req.flash('success', 'Comment deleted successfully!');
        res.redirect(backURL + '#comments-section');
    } catch (err) {
        console.error("Delete comment error:", err);
        req.flash('error', 'Could not delete comment.');
        res.redirect(backURL);
    }
});


module.exports = router;