import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../../env';

const s3 = new S3Client({ region: env.AWS_REGION });

export const mediaService = {
  async getUploadUrl(
    transactionId: string,
    contentType: 'image/jpeg' | 'image/png',
  ): Promise<{ uploadUrl: string; key: string }> {
    const ext = contentType === 'image/png' ? 'png' : 'jpg';
    const key = `media/${transactionId}/${Date.now()}.${ext}`;
    const command = new PutObjectCommand({
      Bucket: env.MEDIA_BUCKET,
      Key: key,
      ContentType: contentType,
    });
    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 900 });
    return { uploadUrl, key };
  },
};
