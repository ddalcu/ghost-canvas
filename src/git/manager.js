import { simpleGit } from 'simple-git';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export class GitManager {
  constructor(designsDir) {
    this.designsDir = designsDir;
    this.git = simpleGit(designsDir);
  }

  async init() {
    const gitDir = join(this.designsDir, '.git');
    if (!existsSync(gitDir)) {
      await this.git.init();
      await this.git.addConfig('user.email', 'ghostcanvas@localhost');
      await this.git.addConfig('user.name', 'GhostCanvas');
    }

    // Initial commit if files exist but no commits yet
    try {
      await this.git.log();
    } catch {
      // No commits yet — stage everything and create initial commit
      await this.git.add('.');
      await this.git.commit('Initial design state');
    }
  }

  async commit(message) {
    await this.git.add('.');
    const result = await this.git.commit(message);
    return result;
  }

  async getLog(limit = 50) {
    try {
      const log = await this.git.log({ maxCount: limit });
      return log.all.map(entry => ({
        hash: entry.hash,
        shortHash: entry.hash.substring(0, 7),
        message: entry.message,
        date: entry.date,
      }));
    } catch {
      return [];
    }
  }

  async checkout(commitHash) {
    // Restore all tracked files from the target commit
    await this.git.checkout([commitHash, '--', '.']);
    // Clean any files that don't exist in target commit (e.g. orphan page files)
    await this.git.clean('f', ['-d']);
  }

  async getDiff(commitHash) {
    try {
      const args = commitHash ? [commitHash, 'HEAD'] : ['HEAD'];
      return await this.git.diff(args);
    } catch {
      return '';
    }
  }
}
