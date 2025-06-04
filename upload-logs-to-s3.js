require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const BUCKET_NAME = process.env.S3_BUCKET_NAME;
const REGION = process.env.AWS_REGION;
const LOGS_DIR = path.join(__dirname, 'logs');

const s3 = new S3Client({ region: REGION });

async function uploadLogs() {
  const files = fs.readdirSync(LOGS_DIR);
  for (const file of files) {
    const filePath = path.join(LOGS_DIR, file);
    const fileStream = fs.createReadStream(filePath);
    const key = `logs/${file}`;
    try {
      await s3.send(new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        Body: fileStream
      }));
      console.log(`Uploaded ${file} to S3 as ${key}`);
    } catch (err) {
      console.error(`Failed to upload ${file}:`, err);
    }
  }
}

uploadLogs().catch(console.error); 