const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const rawFileStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: process.env.CLOUDINARY_UPLOAD_FOLDER || 'code_share_uploads/raw_files',
    resource_type: "raw",
    format: (req, file) => {
        const nameParts = file.originalname.split('.');
        if (nameParts.length > 1) {
            return nameParts.pop().toLowerCase();
        }
        return 'bin';
    },
    public_id: (req, file) => {
        const nameParts = file.originalname.split('.');
        const originalNameWithoutExt = nameParts.slice(0, -1).join('.');
        return `${originalNameWithoutExt.replace(/[^a-zA-Z0-9_.-]/g, '_')}_${Date.now()}`;
    }
  }
});

const imageFileStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: process.env.CLOUDINARY_UPLOAD_FOLDER || 'code_share_uploads/images',
    resource_type: "image",
    allowed_formats: ['jpeg', 'png', 'jpg', 'gif', 'webp', 'svg', 'bmp', 'tiff'],
    public_id: (req, file) => {
        const nameParts = file.originalname.split('.');
        const originalNameWithoutExt = nameParts.slice(0, -1).join('.');
        return `${originalNameWithoutExt.replace(/[^a-zA-Z0-9_.-]/g, '_')}_${Date.now()}`;
    }
  }
});

const upload = multer({ storage: rawFileStorage });
const uploadImage = multer({ storage: imageFileStorage }); // Untuk avatar

module.exports = { cloudinary, upload, uploadImage };