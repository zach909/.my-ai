/**
 * Windows input-device enumeration: parsing against fixtures shaped like
 * `Get-CimInstance ... | ConvertTo-Json -Compress` output (no real
 * PowerShell or hardware needed), and the honest "unavailable" path on
 * any non-Windows platform (every CI runner this repository's own tests
 * actually run on). Deliberately does not test reading live Raw Input
 * events, because that code does not exist -- see
 * windows-input-devices.ts's header.
 */
import { describe, it, expect } from 'vitest'
import { parseWmiDeviceNames, listInputDevices } from '../../models && skills/core/windows-input-devices.js'

describe('parseWmiDeviceNames', () => {
  it('parses a single result (ConvertTo-Json gives a bare object, not an array)', () => {
    expect(parseWmiDeviceNames('{"Name":"HID-compliant mouse","Caption":"HID-compliant mouse"}')).toEqual(['HID-compliant mouse'])
  })

  it('parses several results as a JSON array', () => {
    const json = '[{"Name":"HID-compliant mouse","Caption":null},{"Name":null,"Caption":"Logitech USB Keyboard"}]'
    expect(parseWmiDeviceNames(json)).toEqual(['HID-compliant mouse', 'Logitech USB Keyboard'])
  })

  it('falls back to Caption when Name is null', () => {
    expect(parseWmiDeviceNames('{"Name":null,"Caption":"Logitech USB Keyboard"}')).toEqual(['Logitech USB Keyboard'])
  })

  it('drops a row with neither Name nor Caption rather than inventing an empty device', () => {
    expect(parseWmiDeviceNames('[{"Name":null,"Caption":null},{"Name":"Keyboard"}]')).toEqual(['Keyboard'])
  })

  it('returns nothing for empty output', () => {
    expect(parseWmiDeviceNames('')).toEqual([])
    expect(parseWmiDeviceNames('   \n  ')).toEqual([])
  })

  it('never throws on malformed JSON (e.g. PowerShell error text on stdout)', () => {
    expect(parseWmiDeviceNames('not json at all')).toEqual([])
  })
})

describe('listInputDevices', () => {
  it('reports unavailable, honestly, off Windows', async () => {
    const result = await listInputDevices()
    // This repository's own tests run on Linux/macOS CI, never Windows.
    if (process.platform !== 'win32') {
      expect(result.available).toBe(false)
      expect(result.reason).toBeTruthy()
      expect(result.devices).toEqual([])
    }
  })
})
