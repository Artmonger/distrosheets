const B2 = require('backblaze-b2');
const fs = require('fs');
const path = require('path');

const b2 = new B2({
  applicationKeyId: '005bf6d58260bfa0000000004', // keyID
  applicationKey: 'K005VsCa5YlUEfEnzHrmqrb+UQLr7ik' // applicationKey
});

const BUCKET_NAME = 'ImageResizer';
const LOGS_DIR = path.join(__dirname, 'logs');
const LOGS_PREFIX = 'logs/'; // Folder in B2 bucket

function getDateFromLogFilename(filename) {
  // Assumes log files are named like user-YYYY-MM-DD.log
  const match = filename.match(/(\d{4}-\d{2}-\d{2})/);
  if (!match) return null;
  return new Date(match[1]);
}

async function uploadLogs() {
  await b2.authorize();

  // Get bucket ID
  const buckets = await b2.listBuckets();
  const bucket = buckets.data.buckets.find(b => b.bucketName === BUCKET_NAME);
  if (!bucket) throw new Error('Bucket not found');

  // Upload each log file
  const files = fs.readdirSync(LOGS_DIR);
  for (const file of files) {
    const filePath = path.join(LOGS_DIR, file);
    const data = fs.readFileSync(filePath);
    const uploadUrlResp = await b2.getUploadUrl({ bucketId: bucket.bucketId });
    await b2.uploadFile({
      uploadUrl: uploadUrlResp.data.uploadUrl,
      uploadAuthToken: uploadUrlResp.data.authorizationToken,
      fileName: `${LOGS_PREFIX}${file}`,
      data: data
    });
    console.log(`Uploaded ${file} to B2`);
  }
}

async function deleteOldLogs() {
  await b2.authorize();

  // Get bucket ID
  const buckets = await b2.listBuckets();
  const bucket = buckets.data.buckets.find(b => b.bucketName === BUCKET_NAME);
  if (!bucket) throw new Error('Bucket not found');

  // List all files in the logs/ folder in B2
  let startFileName = null;
  const sixtyDaysAgo = Date.now() - 60 * 24 * 60 * 60 * 1000;
  do {
    const listResp = await b2.listFileNames({
      bucketId: bucket.bucketId,
      prefix: LOGS_PREFIX,
      startFileName,
      maxFileCount: 1000
    });
    for (const file of listResp.data.files) {
      const logDate = getDateFromLogFilename(file.fileName);
      if (logDate && logDate.getTime() < sixtyDaysAgo) {
        await b2.deleteFileVersion({
          fileName: file.fileName,
          fileId: file.fileId
        });
        console.log(`Deleted old log from B2: ${file.fileName}`);
      }
    }
    startFileName = listResp.data.nextFileName;
  } while (startFileName);
}

(async () => {
  await uploadLogs();
  await deleteOldLogs();
})(); 