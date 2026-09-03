/* global __APP_VERSION__, __GIT_SHA__, __BUILD_DATE__ */
// Injected at compile time by electron.vite.config.mjs
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'
export const GIT_SHA = typeof __GIT_SHA__ !== 'undefined' ? __GIT_SHA__ : 'dev'
export const BUILD_DATE = typeof __BUILD_DATE__ !== 'undefined' ? __BUILD_DATE__ : ''

export function getBuildIdentity() {
  return {
    version: APP_VERSION,
    gitSha: GIT_SHA,
    buildDate: BUILD_DATE
  }
}
