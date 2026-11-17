import { join } from 'node:path';

/**
 * Where the app's own files are: next to dist/ while developing, in the installed app's "resources" folder
 * once packaged. Files a program outside the app runs (the replay reader, the sound helper) cannot be read
 * from inside the app's archive, so the installer puts them there.
 */
export function appFile(...parts: string[]): string {
  const packaged = __dirname.includes('app.asar');
  return packaged ? join(process.resourcesPath, ...parts) : join(__dirname, '..', ...parts);
}
