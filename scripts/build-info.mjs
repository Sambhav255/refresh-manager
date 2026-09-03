import { execSync } from 'child_process'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export function getBuildInfo() {
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
  let gitSha = 'dev'
  try {
    gitSha = execSync('git rev-parse --short HEAD', { encoding: 'utf8', cwd: root }).trim()
  } catch {
    /* not a git repo during some builds */
  }
  const buildDate = new Date().toISOString().slice(0, 10)
  return {
    version: pkg.version || '0.0.0',
    gitSha,
    buildDate
  }
}

export function viteDefine() {
  const { version, gitSha, buildDate } = getBuildInfo()
  return {
    __APP_VERSION__: JSON.stringify(version),
    __GIT_SHA__: JSON.stringify(gitSha),
    __BUILD_DATE__: JSON.stringify(buildDate)
  }
}
