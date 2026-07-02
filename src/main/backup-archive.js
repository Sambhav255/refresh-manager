import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'

// 2-F: encrypted backup container. A backup is bundled (refresh.db + every
// member photo) into one authenticated blob, encrypted with AES-256-GCM under a
// key derived from the owner's passphrase (scrypt). The GCM auth tag means a
// wrong passphrase or a single flipped byte fails to decrypt — so it doubles as
// tamper/corruption detection. Uses only Node built-ins (no native zip/AES dep
// to break Electron packaging). Container is app-private; restore is app-only.

const MAGIC = Buffer.from('RMBAK1\n', 'utf8') // 7-byte format marker
const SALT_LEN = 16
const IV_LEN = 12
const TAG_LEN = 16

function deriveKey(passphrase, salt) {
  // N=2^15 keeps this well under a second while being far costlier to brute.
  // maxmem must be raised above the 32 MiB default for these cost params.
  return scryptSync(Buffer.from(passphrase, 'utf8'), salt, 32, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024
  })
}

// Plaintext container: uint32be entryCount, then per entry:
// uint32be nameLen | name(utf8) | uint64be dataLen | data.
function packContainer(entries) {
  const parts = []
  const count = Buffer.alloc(4)
  count.writeUInt32BE(entries.length)
  parts.push(count)
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8')
    const nl = Buffer.alloc(4)
    nl.writeUInt32BE(name.length)
    const dl = Buffer.alloc(8)
    dl.writeBigUInt64BE(BigInt(e.data.length))
    parts.push(nl, name, dl, e.data)
  }
  return Buffer.concat(parts)
}

function unpackContainer(buf) {
  let o = 0
  const count = buf.readUInt32BE(o)
  o += 4
  const entries = []
  for (let i = 0; i < count; i++) {
    const nl = buf.readUInt32BE(o)
    o += 4
    const name = buf.toString('utf8', o, o + nl)
    o += nl
    const dl = Number(buf.readBigUInt64BE(o))
    o += 8
    const data = buf.subarray(o, o + dl)
    o += dl
    entries.push({ name, data })
  }
  return entries
}

export function isEncryptedBackup(buf) {
  return (
    Buffer.isBuffer(buf) &&
    buf.length >= MAGIC.length &&
    buf.subarray(0, MAGIC.length).equals(MAGIC)
  )
}

export function packEncrypted(passphrase, entries) {
  if (!passphrase) throw new Error('A backup passphrase is required to encrypt the backup.')
  const salt = randomBytes(SALT_LEN)
  const iv = randomBytes(IV_LEN)
  const key = deriveKey(passphrase, salt)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(packContainer(entries)), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([MAGIC, salt, iv, tag, ciphertext])
}

export function unpackEncrypted(passphrase, buf) {
  if (!isEncryptedBackup(buf)) throw new Error('Not an encrypted Refresh backup.')
  if (!passphrase) throw new Error('Backup passphrase required to restore this backup.')
  let o = MAGIC.length
  const salt = buf.subarray(o, o + SALT_LEN)
  o += SALT_LEN
  const iv = buf.subarray(o, o + IV_LEN)
  o += IV_LEN
  const tag = buf.subarray(o, o + TAG_LEN)
  o += TAG_LEN
  const ciphertext = buf.subarray(o)
  const key = deriveKey(passphrase, salt)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  try {
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    return unpackContainer(plaintext)
  } catch {
    throw new Error('Could not decrypt backup — wrong passphrase or the file is corrupt.')
  }
}
