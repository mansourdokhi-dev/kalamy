import { z } from 'zod';

// `recordingUrl` is later used to build a filesystem path in MediaStorageService
// (which independently confines the resolved path to its upload directory as a
// second, authoritative line of defense). This schema is the first line: reject
// any value that looks like a path rather than a bare filename, so a
// path-traversal payload (e.g. `../../.env`, `..`, a value containing `/` or `\`)
// is turned away at the API boundary with a clear 400 instead of ever reaching
// storage code.
export const recordingUrlSchema = z
  .string()
  .min(1)
  .max(255)
  .refine(
    (value) => !/[/\\]/.test(value) && !value.includes('\0') && value !== '.' && value !== '..',
    { message: 'recordingUrl must be a bare filename with no path separators' },
  );
