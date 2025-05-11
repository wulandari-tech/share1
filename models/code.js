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
  snippetLanguage: {
    type: String,
    default: 'plaintext'
  },
  fileUrl: { type: String },
  fileName: { type: String },
  fileType: { type: String },
  cloudinaryPublicId: { type: String },
  isSnippetTextFile: { type: Boolean, default: false },
  isPublic: { type: Boolean, default: true },
  uploader: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  views: { type: Number, default: 0 },
  likes: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }]
   //forkedFrom: { type: mongoose.Schema.Types.ObjectId, ref: 'Code' }
  //tags: [String]
}, { timestamps: true });

CodeSchema.index({ title: 'text', description: 'text' });

module.exports = mongoose.model('Code', CodeSchema);