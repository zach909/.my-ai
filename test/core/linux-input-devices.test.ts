/**
 * Linux input-device enumeration: parsing against a fixture (no real
 * hardware or root needed), and the honest "unavailable" path when the
 * /proc file is missing (every CI runner that isn't Linux, or a Linux box
 * without /proc). Deliberately does not test reading /dev/input/eventN,
 * because that code does not exist -- see linux-input-devices.ts's header.
 */
import { describe, it, expect } from 'vitest'
import { parseInputDevices, listInputDevices, summarizeDevices } from '../../models && skills/core/linux-input-devices.js'

const FIXTURE = `I: Bus=0003 Vendor=046d Product=c52b Version=0111
N: Name="Logitech USB Receiver"
P: Phys=usb-0000:00:14.0-1/input0
S: Sysfs=/devices/pci0000:00/0000:00:14.0/usb1/1-1/1-1:1.0
U: Uniq=
H: Handlers=sysrq kbd event3
B: PROP=0
B: EV=120013

I: Bus=0003 Vendor=046d Product=c52b Version=0111
N: Name="Logitech USB Receiver Mouse"
P: Phys=usb-0000:00:14.0-1/input1
S: Sysfs=/devices/pci0000:00/0000:00:14.0/usb1/1-1/1-1:1.1
U: Uniq=
H: Handlers=mouse0 event4
B: PROP=0
B: EV=17

I: Bus=0003 Vendor=413c Product=2113 Version=0111
N: Name="Dell KB216 Wired Keyboard"
P: Phys=usb-0000:00:14.0-2/input0
S: Sysfs=/devices/pci0000:00/0000:00:14.0/usb1/1-2/1-2:1.0
U: Uniq=
H: Handlers=sysrq kbd event5 leds
B: PROP=0
B: EV=120013

I: Bus=0000 Vendor=0000 Product=0000 Version=0000
N: Name="Power Button"
P: Phys=PNP0C0C/button/input0
S: Sysfs=/devices/LNXSYSTM:00/LNXSYBUS:00/PNP0C0C:00/input/input6
U: Uniq=
H: Handlers=kbd event6
B: PROP=0
B: EV=3
`

describe('parseInputDevices', () => {
  it('splits the block format into one device per block', () => {
    const devices = parseInputDevices(FIXTURE)
    expect(devices).toHaveLength(4)
  })

  it('classifies a device with a mouseN handler as a mouse', () => {
    const devices = parseInputDevices(FIXTURE)
    const mouse = devices.find(d => d.name === 'Logitech USB Receiver Mouse')
    expect(mouse?.kind).toBe('mouse')
    expect(mouse?.handlers).toEqual(['mouse0', 'event4'])
  })

  it('classifies a device with a kbd handler as a keyboard', () => {
    const devices = parseInputDevices(FIXTURE)
    const keyboard = devices.find(d => d.name === 'Dell KB216 Wired Keyboard')
    expect(keyboard?.kind).toBe('keyboard')
  })

  it('does not call every kbd-handled device a keyboard\'s worth of a vote away from "other" -- the Power Button is still classified by its handler, honestly, even though it is not a typing keyboard', () => {
    const devices = parseInputDevices(FIXTURE)
    const button = devices.find(d => d.name === 'Power Button')
    // The kernel itself reports this as a "kbd" handler device; the parser
    // reflects that rather than guessing from the device name.
    expect(button?.kind).toBe('keyboard')
  })

  it('captures the Phys field', () => {
    const devices = parseInputDevices(FIXTURE)
    expect(devices[0].phys).toBe('usb-0000:00:14.0-1/input0')
  })

  it('returns nothing for empty input', () => {
    expect(parseInputDevices('')).toEqual([])
  })

  it('skips a block with no Name line rather than throwing', () => {
    const devices = parseInputDevices('H: Handlers=mouse0\n\n' + FIXTURE)
    expect(devices).toHaveLength(4)
  })
})

describe('summarizeDevices', () => {
  it('counts mice, keyboards and other separately', () => {
    const summary = summarizeDevices(parseInputDevices(FIXTURE))
    expect(summary).toEqual({ mice: 1, keyboards: 3, other: 0 })
  })
})

describe('listInputDevices', () => {
  it('reports unavailable, honestly, when the file does not exist', () => {
    const result = listInputDevices('/this/path/does/not/exist/devices')
    expect(result.available).toBe(false)
    expect(result.reason).toBeTruthy()
    expect(result.devices).toEqual([])
  })
})
