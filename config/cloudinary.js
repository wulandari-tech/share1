const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Storage untuk file umum (termasuk snippet teks, zip, pdf, doc, dll.)
const rawFileStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: process.env.CLOUDINARY_UPLOAD_FOLDER || 'code_share_uploads/raw_files', // Folder terpisah
    resource_type: "raw", // Penting untuk file non-media agar tidak error format
    // allowed_formats tidak seketat untuk 'raw', Cloudinary akan mencoba menyimpannya apa adanya.
    // Namun, Anda tetap bisa menambahkannya jika ingin validasi sisi client/server sebelum ke Cloudinary
    // Tapi error "unknown file format" biasanya dari Cloudinary yang mencoba memprosesnya sebagai image/video.
    // Dengan "raw", Cloudinary tidak melakukan pemrosesan format.
    format: (req, file) => { // Opsional: coba dapatkan ekstensi asli untuk nama file di Cloudinary
        const nameParts = file.originalname.split('.');
        if (nameParts.length > 1) {
            return nameParts.pop().toLowerCase();
        }
        return 'bin'; // default jika tidak ada ekstensi
    },
    public_id: (req, file) => {
        const nameParts = file.originalname.split('.');
        const originalNameWithoutExt = nameParts.slice(0, -1).join('.');
        return `${originalNameWithoutExt.replace(/[^a-zA-Z0-9_]/g, '_')}_${Date.now()}`;
    }
  }
});

// Storage khusus untuk gambar jika Anda ingin transformasi dan validasi format gambar
const imageFileStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: process.env.CLOUDINARY_UPLOAD_FOLDER || 'code_share_uploads/images', // Folder terpisah
    resource_type: "image",
    allowed_formats: ['jpeg', 'png', 'jpg', 'gif', 'webp', 'svg', 'bmp', 'tiff'],
    // transformation: [{ width: 1024, height: 1024, crop: 'limit' }] // Contoh transformasi
    public_id: (req, file) => {
        const nameParts = file.originalname.split('.');
        const originalNameWithoutExt = nameParts.slice(0, -1).join('.');
        return `${originalNameWithoutExt.replace(/[^a-zA-Z0-9_]/g, '_')}_${Date.now()}`;
    }
  }
});


// Middleware Multer akan menggunakan rawFileStorage secara default
// Anda bisa membuat middleware upload terpisah jika perlu,
// atau menentukan storage secara dinamis di rute.
// Untuk kesederhanaan, kita akan menggunakan rawFileStorage untuk semua unggahan file saat ini.
// Ini berarti gambar juga akan disimpan sebagai "raw" jika tidak ada logika pemisahan.
// Jika ingin gambar diproses sebagai gambar oleh Cloudinary, perlu logika berbeda.

const upload = multer({ storage: rawFileStorage });

// Anda bisa mengekspor kedua storage jika ingin memilih di rute:
// module.exports = { cloudinary, upload, rawFileStorage, imageFileStorage };
// Atau, jika Anda ingin satu `upload` yang lebih pintar:
const intelligentUpload = multer({
    storage: rawFileStorage, // Default ke raw
    fileFilter: (req, file, cb) => {
        // Di sini Anda bisa menambahkan logika untuk mengubah storage berdasarkan mimetype
        // Contoh: if (file.mimetype.startsWith('image/')) { req.multerStorageType = 'image'; }
        // Lalu di rute, Anda bisa membuat instance multer lagi dengan storage yang sesuai.
        // Untuk saat ini, kita biarkan sederhana.
        cb(null, true);
    }
});

module.exports = { cloudinary, upload: intelligentUpload }; // Menggunakan intelligentUpload sebagai default