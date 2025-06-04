const B2 = require('backblaze-b2');
const fs = require('fs');
const path = require('path');

const b2 = new B2({
  applicationKeyId: '005bf6d58260bfa0000000004', // keyID
  applicationKey: 'K005VsCa5YlUEfEnzHrmqrb+UQLr7ik' // applicationKey
});

const BUCKET_NAME = 'ImageResizer';
const LOGS_DIR = path.join(__dirname, 'logs');

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
    const stat = fs.statSync(filePath);
    // Only upload files modified in the last 60 days
    const sixtyDaysAgo = Date.now() - 60 * 24 * 60 * 60 * 1000;
    if (stat.mtimeMs < sixtyDaysAgo) continue;
    const uploadUrlResp = await b2.getUploadUrl({ bucketId: bucket.bucketId });
    await b2.uploadFile({
      uploadUrl: uploadUrlResp.data.uploadUrl,
      uploadAuthToken: uploadUrlResp.data.authorizationToken,
      fileName: `logs/${file}`,
      data: data
    });
    console.log(`Uploaded ${file} to B2`);
  }
}

uploadLogs().catch(console.error); 