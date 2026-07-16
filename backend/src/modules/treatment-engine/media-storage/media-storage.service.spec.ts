import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { LocalDiskMediaStorageService } from './media-storage.service';

describe('LocalDiskMediaStorageService', () => {
  let tempRoot: string;
  let service: LocalDiskMediaStorageService;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'kalamy-media-test-'));
    service = new LocalDiskMediaStorageService(tempRoot);
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('creates and returns the upload directory', () => {
    const dir = service.getUploadDir();
    expect(existsSync(dir)).toBe(true);
    expect(dir).toContain(tempRoot);
  });

  it('streams back a file that was written to the upload directory', (done) => {
    const dir = service.getUploadDir();
    const filePath = join(dir, 'test-video.mp4');
    writeFileSync(filePath, 'fake video bytes');

    const stream = service.createReadStream('test-video.mp4');
    const chunks: Buffer[] = [];
    stream.on('data', (chunk) => chunks.push(chunk as Buffer));
    stream.on('end', () => {
      expect(Buffer.concat(chunks).toString()).toBe('fake video bytes');
      done();
    });
    stream.on('error', done);
  });

  it('deletes a file from the upload directory', async () => {
    const dir = service.getUploadDir();
    const filePath = join(dir, 'to-delete.mp4');
    writeFileSync(filePath, 'bytes');

    await service.delete('to-delete.mp4');

    expect(existsSync(filePath)).toBe(false);
  });

  it('does not throw when deleting a file that does not exist', async () => {
    await expect(service.delete('never-existed.mp4')).resolves.toBeUndefined();
  });

  it('rejects a path-traversal filename on createReadStream instead of escaping the upload directory', () => {
    expect(() => service.createReadStream('../../../../../../etc/passwd')).toThrow('Invalid file reference');
  });

  it('rejects a path-traversal filename on delete instead of escaping the upload directory', async () => {
    await expect(service.delete('../../../../../../etc/passwd')).rejects.toThrow('Invalid file reference');
  });

  it('rejects an absolute path filename', () => {
    expect(() => service.createReadStream('/etc/passwd')).toThrow('Invalid file reference');
  });
});
