/**
 * macOS input-device enumeration: parsing against a fixture shaped like
 * `ioreg -c IOHIDDevice -r -l` output (no real ioreg or hardware needed),
 * and the honest "unavailable" path on any non-macOS platform (every CI
 * runner this repository's own tests actually run on). Deliberately does
 * not test reading IOHIDManager's live input value stream, because that
 * code does not exist -- see macos-input-devices.ts's header.
 */
import { describe, it, expect } from 'vitest'
import { parseIoregOutput, listInputDevices } from '../../models && skills/core/macos-input-devices.js'

const FIXTURE = `+-o Root  <class IORegistryEntry, id 0x100000100, retain 25>
  +-o AppleUSBHostResources  <class IOResources, id 0x100000111>
    +-o Apple Internal Keyboard / Trackpad  <class AppleUserHIDEventDriver, id 0x100000275, registered, matched, active, busy 0 (0 ms), retain 12>
      {
        "HIDPointerAccelerationType" = "HIDMouseAcceleration"
        "Transport" = "SPI"
        "BootProtocol" = 1
        "Product" = "Apple Internal Keyboard / Trackpad"
        "PrimaryUsagePage" = 1
        "PrimaryUsage" = 6
        "VendorID" = 1452
      }
    +-o Logitech USB Receiver  <class AppleUserHIDEventDriver, id 0x100000a3c, registered, matched, active, busy 0 (0 ms), retain 10>
      {
        "Transport" = "USB"
        "Product" = "Logitech USB Receiver"
        "PrimaryUsagePage" = 1
        "PrimaryUsage" = 2
        "VendorID" = 1133
      }
    +-o Apple Internal Keyboard / Trackpad  <class AppleUserHIDEventDriver, id 0x100000290, registered, matched, active, busy 0 (0 ms), retain 8>
      {
        "Transport" = "SPI"
        "Product" = "Apple Internal Keyboard / Trackpad"
        "PrimaryUsagePage" = 1
        "PrimaryUsage" = 2
        "VendorID" = 1452
      }
    +-o IOHIDConsumerFunctionKeyDevice  <class IOHIDConsumerFunctionKeyDevice, id 0x100000320, registered, matched, active, busy 0 (0 ms), retain 6>
      {
        "Product" = "Consumer Function Keys"
        "PrimaryUsagePage" = 12
        "PrimaryUsage" = 1
      }
`

describe('parseIoregOutput', () => {
  it('splits the tree into one device per "+-o" block', () => {
    expect(parseIoregOutput(FIXTURE)).toHaveLength(4)
  })

  it('classifies HID usage page 1 / usage 6 as a keyboard', () => {
    const devices = parseIoregOutput(FIXTURE)
    expect(devices[0].name).toBe('Apple Internal Keyboard / Trackpad')
    expect(devices[0].kind).toBe('keyboard')
  })

  it('classifies HID usage page 1 / usage 2 as a mouse (the trackpad\'s separate pointer interface, same physical device)', () => {
    const devices = parseIoregOutput(FIXTURE)
    const mice = devices.filter(d => d.kind === 'mouse')
    expect(mice.map(d => d.name)).toEqual(['Logitech USB Receiver', 'Apple Internal Keyboard / Trackpad'])
  })

  it('classifies a non-Generic-Desktop usage page as other, not a guess', () => {
    const devices = parseIoregOutput(FIXTURE)
    const consumerKeys = devices.find(d => d.name === 'Consumer Function Keys')
    expect(consumerKeys?.kind).toBe('other')
  })

  it('returns nothing for empty or Product-less input', () => {
    expect(parseIoregOutput('')).toEqual([])
    expect(parseIoregOutput('garbage with no Product lines')).toEqual([])
  })
})

describe('listInputDevices', () => {
  it('reports unavailable, honestly, off macOS', async () => {
    const result = await listInputDevices()
    // This repository's own tests run on Linux/Windows CI, never macOS.
    if (process.platform !== 'darwin') {
      expect(result.available).toBe(false)
      expect(result.reason).toBeTruthy()
      expect(result.devices).toEqual([])
    }
  })
})
