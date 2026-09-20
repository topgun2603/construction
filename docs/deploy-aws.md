# Deploying BUILDR to AWS

One EC2 instance in `ap-south-1` (Mumbai) running everything, S3 for media, and Caddy fetching its
own certificate. Roughly **$16/month**, or nothing for the first year on a new account's free tier.

The region is not a detail. Every person who uses this product is on Indian mobile data, and a
supervisor filing a report at the end of a shift feels every hundred milliseconds. Mumbai is ~25 ms
from Coimbatore; Singapore is ~90 ms; Virginia is ~230 ms.

## Why one box

The tenancy model needs `sitebook_app` as `NOSUPERUSER NOBYPASSRLS` â€” a superuser bypasses row-level
security unconditionally, and an application connecting as one has every tenant policy silently
inert. The platform console needs a *second* role with `BYPASSRLS`, and granting that attribute
requires real superuser.

Managed Postgres generally does not hand out real superuser. **Check before committing to RDS:**

```sql
CREATE ROLE probe NOSUPERUSER BYPASSRLS;  -- must succeed
DROP ROLE probe;
```

If it fails, tenant isolation still works perfectly â€” you lose only `/admin`, which is why
`ADMIN_DATABASE_URL` is optional in the env schema. On this box you have superuser and nothing is
degraded.

**What this shape costs you:** the database is on the same disk as the application. Backups are
yours (`infra/backup.sh`, step 8) and a lost instance is a lost database. When there are customers
whose data you would have to explain losing, move Postgres to RDS â€” it is two environment variables
and deleting one service from the compose file.

---

## 1. Credentials

```bash
aws configure          # access key, secret, region ap-south-1, output json
aws sts get-caller-identity
```

Use an IAM user with its own access key, not the root account. Root has no blast radius limit.

## 2. The media bucket

Photos, drawings and message attachments. It stays **private** â€” the app hands out presigned URLs
that expire, so a link that leaks stops working rather than becoming a permanent window into
somebody's site.

```bash
BUCKET=buildr-media-$(date +%s)          # bucket names are globally unique
aws s3api create-bucket --bucket "$BUCKET" --region ap-south-1 \
  --create-bucket-configuration LocationConstraint=ap-south-1

aws s3api put-public-access-block --bucket "$BUCKET" \
  --public-access-block-configuration \
  "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
```

The browser and the phone `PUT` directly to S3 with a presigned URL, so the bucket needs CORS.
Replace the host with yours once you have it (step 5):

```bash
cat > /tmp/cors.json <<'JSON'
{"CORSRules":[{
  "AllowedHeaders":["*"],
  "AllowedMethods":["PUT","GET","HEAD"],
  "AllowedOrigins":["https://YOUR-HOST"],
  "ExposeHeaders":["ETag"],
  "MaxAgeSeconds":3000
}]}
JSON
aws s3api put-bucket-cors --bucket "$BUCKET" --cors-configuration file:///tmp/cors.json
```

> Without this the upload fails in the browser with an opaque CORS error *after* the presign
> succeeded, which reads like a bug in the app rather than a bucket setting.

## 3. An IAM user for the app

The API signs URLs and reads and writes objects. Nothing else.

```bash
aws iam create-user --user-name buildr-app

cat > /tmp/s3.json <<JSON
{"Version":"2012-10-17","Statement":[{
  "Effect":"Allow",
  "Action":["s3:GetObject","s3:PutObject","s3:DeleteObject"],
  "Resource":"arn:aws:s3:::${BUCKET}/*"
},{
  "Effect":"Allow","Action":["s3:ListBucket"],"Resource":"arn:aws:s3:::${BUCKET}"
}]}
JSON
aws iam put-user-policy --user-name buildr-app \
  --policy-name buildr-media --policy-document file:///tmp/s3.json

aws iam create-access-key --user-name buildr-app   # keep the output; it is shown once
```

## 4. The instance

```bash
# Security group: HTTPS and HTTP from anywhere, SSH from you only.
VPC=$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)
SG=$(aws ec2 create-security-group --group-name buildr --description "BUILDR" \
  --vpc-id "$VPC" --query GroupId --output text)

aws ec2 authorize-security-group-ingress --group-id "$SG" --protocol tcp --port 80  --cidr 0.0.0.0/0
aws ec2 authorize-security-group-ingress --group-id "$SG" --protocol tcp --port 443 --cidr 0.0.0.0/0
aws ec2 authorize-security-group-ingress --group-id "$SG" --protocol tcp --port 22 \
  --cidr "$(curl -s https://checkip.amazonaws.com)/32"

aws ec2 create-key-pair --key-name buildr --query KeyMaterial --output text > ~/.ssh/buildr.pem
chmod 600 ~/.ssh/buildr.pem
```

Postgres (5432) and Redis (6379) are **not** opened. They are reachable only over the compose
network, from the containers beside them.

```bash
# Ubuntu 24.04 LTS, arm64 â€” Graviton is cheaper per unit of work than x86.
AMI=$(aws ssm get-parameter \
  --name /aws/service/canonical/ubuntu/server/24.04/stable/current/arm64/hvm/ebs-gp3/ami-id \
  --query Parameter.Value --output text)

aws ec2 run-instances \
  --image-id "$AMI" --instance-type t4g.small --key-name buildr \
  --security-group-ids "$SG" --count 1 \
  --block-device-mappings 'DeviceName=/dev/sda1,Ebs={VolumeSize=30,VolumeType=gp3}' \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=buildr}]' \
  --query 'Instances[0].InstanceId' --output text
```

`t4g.small` is 2 GB. That runs the stack comfortably but **will not build the web image** â€” Next.js
needs more, and the OOM killer arrives silently mid-build. Images are built in CI (step 7).

> On a new account, `t4g.micro` is free-tier eligible for 12 months and works for a demo, but 1 GB
> with Postgres, Redis and three Node processes is tight enough that the first surprise will be a
> container being killed.

Get the address, and give the instance an Elastic IP so a stop/start does not change it â€” the
certificate is issued for the hostname, and the hostname contains the IP:

```bash
IP=$(aws ec2 allocate-address --domain vpc --query PublicIp --output text)
aws ec2 associate-address --instance-id "$INSTANCE_ID" --public-ip "$IP"
echo "$IP"
```

## 5. The hostname

No domain needed. sslip.io resolves any IP embedded in the name back to that IP, and Let's Encrypt
will issue for it:

```
13.234.56.78   ->   13-234-56-78.sslip.io
```

That is your `SITE_HOST`. Both halves of the product live on it: the dashboard at `/` and the API
at `/v1`, so there is no cross-origin preflight on every request and one certificate covers both.

## 6. Set the box up

```bash
ssh -i ~/.ssh/buildr.pem ubuntu@$IP

sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2 awscli git
sudo usermod -aG docker ubuntu && exec sg docker newgrp

sudo mkdir -p /opt/sitebook && sudo chown ubuntu:ubuntu /opt/sitebook
git clone https://github.com/topgun2603/construction.git /opt/sitebook
cd /opt/sitebook
```

Then write `/opt/sitebook/.env.prod` from `.env.prod.example`. The values that matter most:

| Variable | Value |
|---|---|
| `SITE_HOST` | `13-234-56-78.sslip.io` |
| `POSTGRES_PASSWORD` | a long random string |
| `DATABASE_URL` | `postgresql://sitebook_app:sitebook@postgres:5432/sitebook` â€” the service name, and **`sitebook_app`**, never `sitebook` |
| `ADMIN_DATABASE_URL` | `postgresql://sitebook_admin:â€¦@postgres:5432/sitebook` |
| `REDIS_URL` | `redis://redis:6379` |
| `S3_*` | the bucket and the access key from step 3; leave `S3_ENDPOINT` empty for real S3 and set `S3_FORCE_PATH_STYLE=false` |
| `NEXT_PUBLIC_API_URL` | `https://13-234-56-78.sslip.io/v1` |
| `CORS_ORIGINS` | `https://13-234-56-78.sslip.io` |
| `DEV_AUTH_BYPASS` | `false` â€” the env schema refuses to start the process otherwise |

> **Every compose command here passes `--env-file .env.prod`, and it is not optional.**
> `env_file:` inside a service only populates that container's environment. It does nothing for the
> `${SITE_HOST}` and `${POSTGRES_PASSWORD}` written in the compose file itself — Compose resolves
> those from its own environment, which by default means a `.env` beside the compose file. Without
> the flag, Caddy asks for a certificate for an empty hostname and Postgres refuses to start, and
> neither error mentions the file you thought you were using.

Set the two Postgres role passwords once the volume exists:

```bash
docker compose --env-file .env.prod -f infra/docker-compose.prod.yml up -d postgres
docker compose --env-file .env.prod -f infra/docker-compose.prod.yml exec postgres \
  psql -U sitebook -d sitebook -c "ALTER ROLE sitebook_app WITH PASSWORD 'CHOSEN'"
docker compose --env-file .env.prod -f infra/docker-compose.prod.yml exec postgres \
  psql -U sitebook -d sitebook -c "ALTER ROLE sitebook_admin WITH PASSWORD 'CHOSEN'"
```

The Firebase Admin key is a private key for the whole Firebase project. It goes in Parameter Store,
not in the repository and never in an image â€” layers survive the deletion of a file, so an image
that ever contained it carries it to every registry it is pushed to.

```bash
# from your laptop
aws ssm put-parameter --name /buildr/firebase-service-account --type SecureString \
  --value "file://construction-service-account.json"

# on the box
mkdir -p /opt/sitebook/secrets
aws ssm get-parameter --name /buildr/firebase-service-account --with-decryption \
  --query Parameter.Value --output text > /opt/sitebook/secrets/firebase.json
chmod 600 /opt/sitebook/secrets/firebase.json
```

and in `.env.prod`: `FIREBASE_SERVICE_ACCOUNT_FILE=/run/secrets/firebase.json`, with the file
mounted into the api and worker services.

## 7. Images

Built in CI and pulled by the box â€” a 2 GB instance cannot build the web image.

```bash
aws ecr create-repository --repository-name buildr-api --region ap-south-1
aws ecr create-repository --repository-name buildr-web --region ap-south-1
```

`.github/workflows/deploy.yml` builds both and pushes them on a manual run. Give the instance an
IAM role with `AmazonEC2ContainerRegistryReadOnly` so it can pull without any credential living on
the disk, then:

```bash
aws ecr get-login-password --region ap-south-1 \
  | docker login --username AWS --password-stdin "$ACCOUNT.dkr.ecr.ap-south-1.amazonaws.com"

export IMAGE_API=$ACCOUNT.dkr.ecr.ap-south-1.amazonaws.com/buildr-api:latest
export IMAGE_WEB=$ACCOUNT.dkr.ecr.ap-south-1.amazonaws.com/buildr-web:latest
docker compose --env-file .env.prod -f infra/docker-compose.prod.yml pull
```

## 8. Start it

Migrations first, before anything serves a request:

```bash
docker compose --env-file .env.prod -f infra/docker-compose.prod.yml run --rm api \
  npx prisma migrate deploy --schema prisma/schema.prisma

docker compose --env-file .env.prod -f infra/docker-compose.prod.yml up -d
docker compose --env-file .env.prod -f infra/docker-compose.prod.yml ps
```

Then the backups, because on this shape nothing else is taking them:

```bash
sudo cp infra/backup.sh /usr/local/bin/sitebook-backup && sudo chmod +x /usr/local/bin/sitebook-backup
echo "BACKUP_BUCKET=$BUCKET" | sudo tee -a /etc/environment
( crontab -l 2>/dev/null; echo "15 2 * * * BACKUP_BUCKET=$BUCKET /usr/local/bin/sitebook-backup >> /var/log/sitebook-backup.log 2>&1" ) | crontab -
```

## 9. Check it

```bash
curl -sS https://13-234-56-78.sslip.io/v1/health         # {"status":"ok"}
curl -sSI https://13-234-56-78.sslip.io/login | head -1  # 200
```

Then in a browser: onboard a tenant, invite a client, and open a site. The things worth confirming
because they are the ones that only break in production:

- **Sign-in sends a real OTP.** `DEV_AUTH_BYPASS` is off, so Firebase has to be configured and the
  hostname added to Firebase's authorised domains.
- **A photo uploads.** That exercises the presign, the bucket CORS and the credentials together.
- **The map draws.** `NEXT_PUBLIC_MAPTILER_KEY` is compiled into the image, so a missing one shows
  a placeholder rather than an error â€” and add the host to the MapTiler key's allowed referrers.
- **A notification arrives.** That means the worker is running and reaching Redis.

## Afterwards

- Restrict the MapTiler key to this hostname.
- Add the hostname to Firebase â†’ Authentication â†’ Settings â†’ Authorised domains.
- Set `GEOCODER_CONTACT`, or the search falls back to Nominatim anonymously and they block it.
- Leave `PLATFORM_ADMIN_PHONES` empty unless you want `/admin` reachable; it can change plans and
  suspend accounts.
- Test a restore. A backup nobody has restored is a file, not a backup.
