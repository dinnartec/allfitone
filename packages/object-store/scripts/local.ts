/**
 * MinIO for local development, standing in for the private S3 bucket (ADR-039).
 *
 * Starts the container if it is not running and makes sure the bucket exists, with the
 * values of `.env.local`. Idempotent: running it twice changes nothing.
 */

import { CreateBucketCommand, HeadBucketCommand, S3Client } from '@aws-sdk/client-s3'

const NAME = 'allfit-minio'
const bucket = process.env.OBJECT_STORE_BUCKET ?? 'allfit-private'
const user = process.env.OBJECT_STORE_ACCESS_KEY_ID ?? 'allfit'
const secret = process.env.OBJECT_STORE_SECRET_ACCESS_KEY ?? 'allfit-local-secret'

const running = Bun.spawnSync([
  'docker',
  'ps',
  '--filter',
  `name=^${NAME}$`,
  '--format',
  '{{.Names}}',
])
if (running.stdout.toString().trim() !== NAME) {
  Bun.spawnSync(['docker', 'rm', '-f', NAME])
  const started = Bun.spawnSync([
    'docker',
    'run',
    '-d',
    '--name',
    NAME,
    '-p',
    '9000:9000',
    '-p',
    '9001:9001',
    '-e',
    `MINIO_ROOT_USER=${user}`,
    '-e',
    `MINIO_ROOT_PASSWORD=${secret}`,
    'minio/minio:latest',
    'server',
    '/data',
    '--console-address',
    ':9001',
  ])
  if (started.exitCode !== 0) throw new Error(started.stderr.toString())
}

// From this machine the store is localhost, whatever address the phone uses.
const client = new S3Client({
  region: 'us-east-1',
  endpoint: 'http://127.0.0.1:9000',
  forcePathStyle: true,
  credentials: { accessKeyId: user, secretAccessKey: secret },
})

for (let attempt = 0; ; attempt += 1) {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }))
    break
  } catch (cause) {
    const status = (cause as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
    if (status === 404) {
      await client.send(new CreateBucketCommand({ Bucket: bucket }))
      break
    }
    if (attempt > 20) throw cause
    await Bun.sleep(500)
  }
}

console.log(`MinIO is up at http://127.0.0.1:9000 with the private bucket «${bucket}».`)
