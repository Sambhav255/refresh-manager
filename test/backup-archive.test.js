import { describe, it, expect } from 'vitest'
import { packEncrypted, unpackEncrypted, isEncryptedBackup } from '../src/main/backup-archive.js'

const entries = [
  { name: 'refresh.db', data: Buffer.from('SQLite format 3\0fake-db-bytes') },
  { name: 'photos/1.jpg', data: Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02]) },
  { name: 'photos/2.jpg', data: Buffer.from('another photo') }
]

describe('2-F — encrypted backup archive', () => {
  it('round-trips db + photos through pack/unpack with the right passphrase', () => {
    const blob = packEncrypted('correct horse', entries)
    expect(isEncryptedBackup(blob)).toBe(true)

    const out = unpackEncrypted('correct horse', blob)
    expect(out.map((e) => e.name)).toEqual(['refresh.db', 'photos/1.jpg', 'photos/2.jpg'])
    expect(out[0].data.equals(entries[0].data)).toBe(true)
    expect(out[1].data.equals(entries[1].data)).toBe(true)
    expect(out[2].data.equals(entries[2].data)).toBe(true)
  })

  it('rejects a wrong passphrase', () => {
    const blob = packEncrypted('right', entries)
    expect(() => unpackEncrypted('wrong', blob)).toThrow(/wrong passphrase|corrupt/i)
  })

  it('detects tampering (a flipped byte fails the auth tag)', () => {
    const blob = packEncrypted('pw', entries)
    blob[blob.length - 5] ^= 0xff // corrupt the ciphertext
    expect(() => unpackEncrypted('pw', blob)).toThrow(/corrupt|wrong passphrase/i)
  })

  it('does not recognise a plain sqlite file as an encrypted backup', () => {
    expect(isEncryptedBackup(Buffer.from('SQLite format 3\0rest'))).toBe(false)
  })
})
