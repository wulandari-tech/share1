const mongoose = require('mongoose');

const CodeSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Title is required'],
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  snippetLanguage: { // Renamed from 'language'
    type: String,
    default: 'plaintext'
  },
  fileUrl: { // URL from Cloudinary for EITHER uploaded file OR snippet text file
    type: String
  },
  fileName: { // Original name of the uploaded file OR generated name for snippet text file
    type: String
  },
  fileType: { // Mime type of the uploaded file OR 'text/plain' or similar for snippet
    type: String
  },
  cloudinaryPublicId: { // To help with deleting from Cloudinary
    type: String
  },
  isSnippetTextFile: { // True if fileUrl points to a text snippet uploaded from CodeMirror
    type: Boolean,
    default: false
  },
  isPublic: {
    type: Boolean,
    default: true
  },
  uploader: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  views: {
    type: Number,
    default: 0
  }
}, { timestamps: true });

CodeSchema.index({ title: 'text', description: 'text' });

module.exports = mongoose.model('Code', CodeSchema);