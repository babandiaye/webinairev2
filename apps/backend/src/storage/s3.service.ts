import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { S3Upload } from "livekit-server-sdk";

@Injectable()
export class S3Service {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(private readonly config: ConfigService) {
    this.bucket = this.config.get<string>("s3.bucket")!;
    this.client = new S3Client({
      endpoint: this.config.get<string>("s3.endpoint")!,
      region: this.config.get<string>("s3.region")!,
      forcePathStyle: true,
      credentials: {
        accessKeyId: this.config.get<string>("s3.accessKey")!,
        secretAccessKey: this.config.get<string>("s3.secret")!,
      },
    });
  }

  // Config S3Upload à passer à LiveKit Egress (le worker egress uploade lui-même
  // le fichier vers MinIO, indépendamment de ce client S3Service).
  buildEgressUploadConfig(): S3Upload {
    return new S3Upload({
      accessKey: this.config.get<string>("s3.accessKey")!,
      secret: this.config.get<string>("s3.secret")!,
      region: this.config.get<string>("s3.region")!,
      endpoint: this.config.get<string>("s3.endpoint")!,
      bucket: this.bucket,
      forcePathStyle: true,
    });
  }

  async headObject(key: string) {
    return this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async putObject(key: string, body: Buffer, contentType: string) {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType })
    );
  }

  async deleteObject(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  // MinIO n'est joignable que depuis le réseau interne (10.149.2.209), pas depuis
  // le navigateur du client — jamais d'URL directe, le backend agit en proxy et
  // relaie les requêtes Range pour permettre le seek dans la lecture vidéo.
  async getObjectStream(key: string, range?: string) {
    return this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: range })
    );
  }
}
