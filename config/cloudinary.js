const cloudinary             = require('cloudinary').v2;
const { CloudinaryStorage }  = require('multer-storage-cloudinary');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary,
  params: (req, file) => {
    if (file.fieldname === 'image') {
      return {
        folder:        'verto/images',
        resource_type: 'image',
        // ✅ حذفنا allowed_formats — Cloudinary يقبل كل الصور تلقائياً
        format:        'jpg', // ✅ يحول كل صورة لـ jpg
      };
    }
    if (file.fieldname.startsWith('video_file')) {
      return {
        folder:        'verto/videos',
        resource_type: 'video',
        // ✅ حذفنا allowed_formats — يقبل كل أنواع الفيديو
      };
    }
    // pdf_course_* و pdf_exercise_*
    return {
      folder:        'verto/pdfs',
      resource_type: 'raw',
      // ✅ حذفنا allowed_formats — يقبل كل الملفات
    };
  },
});

module.exports = { cloudinary, storage };