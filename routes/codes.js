const express = require('express');
const router = express.Router();
const Code = require('../models/code');
const User = require('../models/user');
const Comment = require('../models/comment');
const Notification = require('../models/notification');
const { cloudinary, upload } = require('../config/cloudinary');
const { isLoggedIn, isAuthor } = require('../middleware');
const tmp = require('tmp');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const mongoose = require('mongoose');

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

function getJudge0LanguageId(languageName) {
    const mapping = {
        'python': 71, 'javascript': 63, 'java': 62, 'c': 50, 'cpp': 54,
        'csharp': 51, 'php': 68, 'ruby': 72, 'go': 60, 'rust': 73,
        'swift': 83, 'kotlin': 78, 'sql': 82,
    };
    if (!languageName) return null;
    const normalizedLang = languageName.toLowerCase()
        .replace('htmlmixed', 'html')
        .replace('text/x-csrc', 'c')
        .replace('text/x-c++src', 'cpp')
        .replace('text/x-java', 'java');
    return mapping[normalizedLang] || null;
}

router.get('/upload', isLoggedIn, (req, res) => {
  res.render('upload', { pageTitle: "Upload Code - SHARE SOURCE CODE", code: {} });
});

router.post('/', isLoggedIn, upload.single('file'), async (req, res, next) => {
  let tempFileObject = null;
  try {
    const { title, description, content: snippetContentFromForm, snippetLanguage, isPublic, importGistUrl, actionType } = req.body;

    if (actionType === 'importGist') {
        if (!importGistUrl) {
            req.flash('error', 'GitHub Gist URL is required for import.');
            return res.redirect('/codes/upload');
        }
        const user = await User.findById(req.session.user._id).select('githubAccessToken').lean();
        if (!user || !user.githubAccessToken) {
            req.flash('error', 'Please link your GitHub account in profile settings to import Gists.');
            return res.redirect('/users/profile/edit');
        }
        const gistUrlParts = importGistUrl.trim().split('/');
        const gistId = gistUrlParts[gistUrlParts.length - 1].split('#')[0];

        if (!gistId) {
            req.flash('error', 'Invalid Gist URL format.');
            return res.redirect('/codes/upload');
        }
        
        const gistResponse = await axios.get(`https://api.github.com/gists/${gistId}`, {
            headers: { 'Authorization': `token ${user.githubAccessToken}`, 'Accept': 'application/vnd.github.v3+json' }
        });
        const gistData = gistResponse.data;
        if (!gistData.files || Object.keys(gistData.files).length === 0) {
            req.flash('error', 'The Gist is empty or files could not be retrieved.');
            return res.redirect('/codes/upload');
        }
        const firstFileName = Object.keys(gistData.files)[0];
        const gistFile = gistData.files[firstFileName];

        if (!gistFile || typeof gistFile.content === 'undefined') {
             req.flash('error', 'Could not retrieve content from the Gist file.');
             return res.redirect('/codes/upload');
        }
        
        const newCodeDataFromGist = {
            title: gistData.description || firstFileName || `Gist ${gistId}`,
            description: gistData.description || `Imported from Gist: ${importGistUrl}`,
            snippetLanguage: gistFile.language ? gistFile.language.toLowerCase() : 'plaintext',
            isPublic: gistData.public,
            uploader: req.session.user._id,
            isSnippetTextFile: true 
        };
        
        const sanitizedTitle = (newCodeDataFromGist.title).replace(/[^a-z0-9_.-]/gi, '_').substring(0, 50) || 'gist_snippet';
        const snippetFileExtension = getFileExtensionForSnippet(newCodeDataFromGist.snippetLanguage);
        const snippetFileName = `${sanitizedTitle}${snippetFileExtension}`;

        tempFileObject = tmp.fileSync({ postfix: snippetFileExtension });
        await fs.writeFile(tempFileObject.name, gistFile.content);

        const result = await cloudinary.uploader.upload(tempFileObject.name, {
            folder: (process.env.CLOUDINARY_UPLOAD_FOLDER || 'code_share_uploads') + '/snippets',
            resource_type: "raw",
            public_id: `${sanitizedTitle}_${Date.now()}`
        });
        
        newCodeDataFromGist.fileUrl = result.secure_url;
        newCodeDataFromGist.fileName = snippetFileName;
        newCodeDataFromGist.fileType = `text/${newCodeDataFromGist.snippetLanguage === 'plaintext' ? 'plain' : newCodeDataFromGist.snippetLanguage}`;
        newCodeDataFromGist.cloudinaryPublicId = result.public_id;

        const newCode = new Code(newCodeDataFromGist);
        await newCode.save();
        req.flash('success', `Gist "${newCodeDataFromGist.title}" imported successfully!`);
        return res.redirect(`/codes/view/${newCode._id}`);
    }


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
      const sanitizedTitle = title.replace(/[^a-z0-9_.-]/gi, '_').substring(0,50) || 'snippet';
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
        req.flash('error', errors.join(', '));
        return res.redirect('/codes/upload');
    }
    if (err.isAxiosError) {
        console.error("Axios Error (Gist Import/Other):", err.response ? err.response.data : err.message);
        let errMsg = 'Failed to process external request.';
        if (err.response && err.response.status === 404) errMsg = 'External resource not found or access denied.';
        else if (err.response && err.response.data && err.response.data.message) errMsg = `External API Error: ${err.response.data.message}`;
        req.flash('error', errMsg);
    } else if (err.http_code && err.message) {
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
    const codeDocument = await Code.findById(req.params.id).populate('uploader', 'username avatar.url _id githubId githubAccessToken');
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
      }
    }
    
    const comments = await Comment.find({ codePost: code._id })
        .populate('author.id', 'username avatar.url _id')
        .sort({ createdAt: -1 })
        .lean();

    if(typeof codeDocument.views !== 'number') codeDocument.views = 0;
    codeDocument.views += 1;
    await codeDocument.save();

    res.render('view', {
      code: { ...code, views: codeDocument.views, fetchedSnippetContent },
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
        
        const sanitizedTitle = title.replace(/[^a-z0-9_.-]/gi, '_').substring(0,50) || 'snippet';
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
        req.flash('error', errors.join(', '));
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
    await Code.findByIdAndRemove(req.params.id);
    req.flash('success', 'Code/File and associated comments deleted successfully!');
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
    if (!code.isPublic && (!req.session.user || !code.uploader.toString() === (req.session.user._id).toString())) {
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
            text: req.body.comment.text,
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
            req.flash('error', errors.join(', '));
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
        if (!comment.author.id.equals(req.session.user._id)) {
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

router.post('/:id/export-gist', isLoggedIn, async (req, res, next) => {
    const backURL = req.header('Referer') || `/codes/view/${req.params.id}`;
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            req.flash('error', 'Invalid Post ID.');
            return res.redirect(backURL);
        }
        const code = await Code.findById(req.params.id).lean();
        const user = await User.findById(req.session.user._id).select('githubAccessToken').lean();

        if (!code) {
            req.flash('error', 'Code not found.');
            return res.redirect(backURL);
        }
        if (!user || !user.githubAccessToken) {
            req.flash('error', 'GitHub not linked or access token missing. Please link your GitHub account in your profile settings.');
            return res.redirect(`/${req.session.user.username.toLowerCase()}`);
        }

        let contentToExport = '';
        let fileNameForGist = `${code.title.replace(/[^a-zA-Z0-9_.-]/g, '_').substring(0,50) || 'snippet'}${getFileExtensionForSnippet(code.snippetLanguage)}`;

        if (code.isSnippetTextFile && code.fileUrl) {
            const response = await axios.get(code.fileUrl, { timeout: 7000 });
            contentToExport = response.data;
        } else if (!code.isSnippetTextFile && code.fileName) {
            contentToExport = `File: ${code.fileName}\nDescription: ${code.description}\n\nView original on SHARE SOURCE CODE: ${req.protocol}://${req.get('host')}/codes/view/${code._id}`;
            fileNameForGist = `${code.fileName}.md`;
        } else {
             req.flash('error', 'No content available to export to Gist.');
             return res.redirect(backURL);
        }

        const gistPayload = {
            description: code.title,
            public: code.isPublic,
            files: {
                [fileNameForGist]: {
                    content: contentToExport
                }
            }
        };
        
        const gistResponse = await axios.post('https://api.github.com/gists', gistPayload, {
            headers: { 'Authorization': `token ${user.githubAccessToken}`, 'Accept': 'application/vnd.github.v3+json' }
        });
        
        const gistUrl = gistResponse.data.html_url;

        req.flash('success', `Successfully exported to GitHub Gist! View it here: <a href="${gistUrl}" target="_blank" class="font-bold hover:underline">${gistUrl}</a>`);
        res.redirect(backURL);

    } catch (err) {
        console.error("Gist Export Error:", err.response ? err.response.data : err.message);
        let errMsg = `Failed to export to Gist.`;
        if (err.isAxiosError && err.response && err.response.data && err.response.data.message) {
            errMsg = `GitHub API Error: ${err.response.data.message}`;
        } else if (err.isAxiosError) {
            errMsg = `Network error during Gist export: ${err.message}`;
        }
        req.flash('error', errMsg);
        res.redirect(backURL);
    }
});

router.post('/:id/execute-judge0', isLoggedIn, async (req, res, next) => {
    const { codeContent, language, stdin } = req.body;

    if (!codeContent || !language) {
        return res.status(400).json({ success: false, error: 'Code content and language are required.' });
    }

    const languageId = getJudge0LanguageId(language);
    if (!languageId) {
        return res.status(400).json({ success: false, error: `Language "${language}" is not supported for server-side execution via Judge0.` });
    }

    if (!process.env.JUDGE0_RAPIDAPI_KEY || !process.env.JUDGE0_RAPIDAPI_HOST) {
        console.error("Server Config Error: Judge0 API Key or Host not configured in .env");
        return res.status(500).json({ success: false, error: 'Server-side execution service is not configured by the administrator.' });
    }

    try {
        const options = {
            method: 'POST',
            url: `https://${process.env.JUDGE0_RAPIDAPI_HOST}/submissions`,
            params: {
                base64_encoded: 'false',
                wait: 'true'
            },
            headers: {
                'Content-Type': 'application/json',
                'X-RapidAPI-Key': process.env.JUDGE0_RAPIDAPI_KEY,
                'X-RapidAPI-Host': process.env.JUDGE0_RAPIDAPI_HOST
            },
            data: {
                language_id: languageId,
                source_code: codeContent,
                stdin: stdin || ''
            }
        };

        const judgeResponse = await axios.request(options);
        
        if (judgeResponse && judgeResponse.data) {
            return res.json({
                success: true,
                output: judgeResponse.data.stdout,
                stderr: judgeResponse.data.stderr,
                status: judgeResponse.data.status ? judgeResponse.data.status.description : 'Unknown Status',
                time: judgeResponse.data.time,
                memory: judgeResponse.data.memory,
                compile_output: judgeResponse.data.compile_output,
                message: judgeResponse.data.message
            });
        } else {
            console.error('Judge0 API Error: Invalid response structure from Judge0', judgeResponse);
            return res.status(500).json({ success: false, error: 'Received an invalid response from the execution service.' });
        }

    } catch (error) {
        console.error('Judge0 API Execution Error on Server:', error.message);
        let statusCode = 500;
        let responseData = { success: false, error: 'Failed to execute code via Judge0 API.' };

        if (error.isAxiosError && error.response) {
            console.error('Judge0 API Response Error Data:', JSON.stringify(error.response.data, null, 2));
            statusCode = error.response.status || 500;
            responseData.details = error.response.data;
            if (error.response.data && error.response.data.error) {
                responseData.error = `Judge0 Error: ${error.response.data.error}`;
            } else if (error.response.data && error.response.data.message) {
                responseData.error = `Judge0 Error: ${error.response.data.message}`;
            } else if (typeof error.response.data === 'string' && error.response.data.startsWith('<!DOCTYPE')) {
                responseData.error = 'Execution service returned an HTML error page instead of JSON. Check API Key or service status.';
                 console.error('Judge0 returned HTML, possibly an auth error or service issue.');
            }
        } else if (error.isAxiosError) {
            console.error('Axios Request Error (no response):', error.message);
            responseData.error = `Network error or Judge0 API unreachable: ${error.message}`;
        } else {
            responseData.error = `Internal server error during execution: ${error.message}`;
        }
        return res.status(statusCode).json(responseData);
    }
});

module.exports = router;