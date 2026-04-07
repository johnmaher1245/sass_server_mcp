import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

class S3Service {
    constructor() {
        this.client = null;
        this.bucket = null;
    }

    _ensureClient() {
        if (this.client) return;

        const accessKeyId = process.env.AWS_S3_ACCESS_KEY_ID;
        const secretAccessKey = process.env.AWS_S3_SECRET_ACCESS_KEY;
        const region = process.env.AWS_S3_REGION;
        this.bucket = process.env.AWS_BUCKET_PRIVATE;

        if (!accessKeyId || !secretAccessKey || !region) {
            throw new Error('Missing AWS S3 credentials (AWS_S3_ACCESS_KEY_ID, AWS_S3_SECRET_ACCESS_KEY, AWS_S3_REGION)');
        }

        this.client = new S3Client({
            region,
            credentials: { accessKeyId, secretAccessKey },
        });
    }

    async getObject(key, bucket) {
        this._ensureClient();

        const command = new GetObjectCommand({
            Bucket: bucket || this.bucket,
            Key: key,
        });

        const response = await this.client.send(command);
        const chunks = [];
        for await (const chunk of response.Body) {
            chunks.push(chunk);
        }
        return Buffer.concat(chunks);
    }
}

export default new S3Service();
