require('dotenv').config();
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const BUCKET_NAME = process.env.S3_BUCKET_NAME;
const REGION = process.env.AWS_REGION;
const APP_NAME = 'image-resizer-app-2024'; // <-- Heroku app name set
const LOGS_DIR = path.join(__dirname, 'logs');
const s3 = new S3Client({ region: REGION });

if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR);

const logFile = `heroku-log-${new Date().toISOString().slice(0, 10)}.log`;
const logPath = path.join(LOGS_DIR, logFile);

// Fetch logs from Heroku CLI
try {
  execSync(`heroku logs --app ${APP_NAME} --num 1500 > ${logPath}`);
  console.log(`Fetched logs to ${logPath}`);
} catch (err) {
  console.error('Failed to fetch Heroku logs:', err.message);
  process.exit(1);
}

// Upload to S3
async function uploadLog() {
  const fileStream = fs.createReadStream(logPath);
  const key = `logs/${logFile}`;
  try {
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: fileStream
    }));
    console.log(`Uploaded ${logFile} to S3 as ${key}`);
  } catch (err) {
    console.error(`Failed to upload ${logFile}:`, err);
  }
}

uploadLog(); 