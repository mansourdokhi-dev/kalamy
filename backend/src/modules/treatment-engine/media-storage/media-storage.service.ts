import { BadRequestException, Injectable } from '@nestjs/common';
import { createReadStream, mkdirSync, ReadStream, unlink } from 'fs';
import { join, resolve, sep } from 'path';
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

  // Resolves `filename` against the upload directory and asserts the result still
  // lives inside it. Defense-in-depth against a path-traversal filename (e.g.
  // `../../.env`) reaching the filesystem, regardless of what validation callers
  // perform upstream (the DTO layer also rejects any path separator or bare
  // "."/".." segment in recordingUrl — see recording-url.schema.ts).
  private resolveSafePath(filename: string): string {
    const resolved = resolve(this.uploadDir, filename);
    if (!resolved.startsWith(this.uploadDir + sep)) {
      throw new BadRequestException('Invalid file reference');
    }
    return resolved;
  }

  createReadStream(filename: string): ReadStream {
    return createReadStream(this.resolveSafePath(filename));
  }

  async delete(filename: string): Promise<void> {
    try {
      await unlinkAsync(this.resolveSafePath(filename));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }
}
