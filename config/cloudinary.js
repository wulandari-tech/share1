const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: process.env.CLOUDINARY_UPLOAD_FOLDER || 'code_share_uploads',
    allowed_formats: ['jpeg', 'png', 'jpg', 'gif', 'zip', 'pdf', 'txt', 'doc', 'docx'],
  }
});

const upload = multer({ storage: storage });

module.exports = { cloudinary, upload };