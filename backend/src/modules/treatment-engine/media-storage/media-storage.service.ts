import { Injectable } from '@nestjs/common';
import { createReadStream, mkdirSync, ReadStream, unlink } from 'fs';
import { join } from 'path';
import { promisify } from 'util';

const unlinkAsync = promisify(unlink);

export abstract class MediaStorageService {
  abstract getUploadDir(): string;
  abstract createReadStream(filename: string): ReadStream;
  abstract delete(filename: string): Promise<void>;
}

@Injectable()
export class LocalDiskMediaStorageService extends MediaStorageService {
  private readonly uploadDir: string;

  constructor(rootDir: string = process.cwd()) {
    super();
    this.uploadDir = join(rootDir, 'uploads', 'video');
    mkdirSync(this.uploadDir, { recursive: true });
  }

  getUploadDir(): string {
    return this.uploadDir;
  }

  createReadStream(filename: string): ReadStream {
    return createReadStream(join(this.uploadDir, filename));
  }

  async delete(filename: string): Promise<void> {
    try {
      await unlinkAsync(join(this.uploadDir, filename));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }
}
