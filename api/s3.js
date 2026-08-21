const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const path = require('path');

const BUCKET = process.env.S3_BUCKET || 'ulsan-ht-team-5-s3';
const REGION = process.env.S3_REGION || 'us-east-1';

const s3 = new S3Client({ region: REGION });

/**
 * Upload a file buffer to S3 and return the public URL.
 * @param {Buffer} buffer - file content
 * @param {string} originalname - original filename (used for extension)
 * @param {string} mimetype - MIME type
 * @returns {Promise<string>} public URL of the uploaded file
 */
async function uploadToS3(buffer, originalname, mimetype) {
  const ext = path.extname(originalname) || '';
  const key = `uploads/${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;

  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: mimetype,
  }));

  // Return the S3 public URL
  return `https://${BUCKET}.s3.${REGION}.amazonaws.com/${key}`;
}

module.exports = { uploadToS3, BUCKET, REGION };
