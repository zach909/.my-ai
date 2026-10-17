# pretty-bytes

> Convert bytes to a human readable string: `1337` → `1.34 kB`

Useful for displaying file sizes for humans.

*Note that it uses base-10 (e.g. kilobyte).
[Read about the difference between kilobyte and kibibyte.](https://web.archive.org/web/20150324153922/https://pacoup.com/2009/05/26/kb-kb-kib-whats-up-with-that/)*

## Install

```sh
npm install pretty-bytes
```

## Usage

```js
import prettyBytes from 'pretty-bytes';

prettyBytes(1337);
//=> '1.34 kB'

prettyBytes(100);
//=> '100 B'

// Display with units of bits
prettyBytes(1337, {bits: true});
//=> '1.34 kbit'

// Display file size differences
prettyBytes(42, {signed: true});
//=> '+42 B'

// Localized output using German locale
prettyBytes(1337, {locale: 'de'});
//=> '1,34 kB'

// Fixed width for alignment (useful for progress bars and tables)
prettyBytes(1337, {fixedWidth: 8});
//=> ' 1.34 kB'
```

## API

### prettyBytes(number, options?)

#### number

Type: `number | bigint`

The number to format.

A `bigint` of any size is accepted. Past roughly `1e332` bytes the scaled value no longer fits a `number`, and it is written out in full from the exact quotient, so it carries no grouping and no localized decimal separator, the same as a value below `1e-100`.

Byte counts are otherwise formatted with the precision of a JavaScript number, which holds about 16 significant digits, so above roughly `1e17` bytes the trailing digits of the output may not be exact. A value that rounds up onto a unit boundary can therefore be printed in the larger unit, so `999499999999999999` bytes is `1 EB` rather than `999 PB`.

> [!NOTE]
> Rounding uses `Number#toPrecision`, so at an exact tie the direction comes from how that value is stored as a floating point number. `1005` bytes is `1.005 kB` and rounds down to `1 kB`, while `1125` bytes is `1.125 kB` and rounds up to `1.13 kB`.

#### options

Type: `object`

##### signed

Type: `boolean`\
Default: `false`

Include plus sign for positive numbers. If the difference is exactly zero a space character will be prepended instead for better alignment.

##### bits

Type: `boolean`\
Default: `false`

Format the number as [bits](https://en.wikipedia.org/wiki/Bit) instead of [bytes](https://en.wikipedia.org/wiki/Byte). This can be useful when, for example, referring to [bit rate](https://en.wikipedia.org/wiki/Bit_rate).

```js
import prettyBytes from 'pretty-bytes';

prettyBytes(1337, {bits: true});
//=> '1.34 kbit'
```

##### binary

Type: `boolean`\
Default: `false`

Format the number using the [Binary Prefix](https://en.wikipedia.org/wiki/Binary_prefix) instead of the [SI Prefix](https://en.wikipedia.org/wiki/SI_prefix). This can be useful for presenting memory amounts. However, this should not be used for presenting file sizes.

```js
import prettyBytes from 'pretty-bytes';

prettyBytes(1000, {binary: true});
//=> '1000 B'

prettyBytes(1024, {binary: true});
//=> '1 KiB'
```

##### locale

Type: `boolean | string | string[]`\
Default: `false`

- If `false`: Output won't be localized.
- If `true`: Localize the output using the system/browser locale.
- If `string`: Expects a [BCP 47 language tag](https://en.wikipedia.org/wiki/IETF_language_tag) (For example: `en`, `de`, …)
- If `string[]`: Expects a list of [BCP 47 language tags](https://en.wikipedia.org/wiki/IETF_language_tag) (For example: `en`, `de`, …)

> [!IMPORTANT]
> Only the number and decimal separator are localized. The unit title is not and will not be localized.

> [!NOTE]
> A value below `1e-100` bytes needs more than the 100 fraction digits `Intl.NumberFormat` accepts, so it is written out with plain digits instead of a localized decimal separator.

```js
import prettyBytes from 'pretty-bytes';

prettyBytes(1337, {locale: 'de'});
//=> '1,34 kB'
```

##### minimumFractionDigits

Type: `number`\
Default: `undefined`

The minimum number of fraction digits to display.

If neither `minimumFractionDigits` nor `maximumFractionDigits` is set, the default behavior is to round to 3 significant digits.

Must be an integer between 0 and 100. Throws a `TypeError` for invalid values.

Must not be greater than `maximumFractionDigits`, which throws a `RangeError` when both are set.

> [!NOTE]
> When `minimumFractionDigits` or `maximumFractionDigits` is specified, values are truncated instead of rounded to provide more intuitive results for file sizes.

```js
import prettyBytes from 'pretty-bytes';

// Show the number with at least 3 fractional digits
prettyBytes(1900, {minimumFractionDigits: 3});
//=> '1.900 kB'

prettyBytes(1900);
//=> '1.9 kB'
```

##### maximumFractionDigits

Type: `number`\
Default: `undefined`

The maximum number of fraction digits to display.

If neither `minimumFractionDigits` nor `maximumFractionDigits` is set, the default behavior is to round to 3 significant digits.

Must be an integer between 0 and 100. Throws a `TypeError` for invalid values.

Must not be less than `minimumFractionDigits`, which throws a `RangeError` when both are set.

> [!NOTE]
> When `minimumFractionDigits` or `maximumFractionDigits` is specified, values are truncated instead of rounded to provide more intuitive results for file sizes.

```js
import prettyBytes from 'pretty-bytes';

// Show the number with at most 1 fractional digit
prettyBytes(1920, {maximumFractionDigits: 1});
//=> '1.9 kB'

prettyBytes(1920);
//=> '1.92 kB'
```

##### space

Type: `boolean`\
Default: `true`

Put a space between the number and unit.

```js
import prettyBytes from 'pretty-bytes';

prettyBytes(1920, {space: false});
//=> '1.92kB'

prettyBytes(1920);
//=> '1.92 kB'
```

##### nonBreakingSpace

Type: `boolean`\
Default: `false`

Use a non-breaking space instead of a regular space to prevent the unit from wrapping to a new line.

Has no effect when `space` is `false`.

```js
import prettyBytes from 'pretty-bytes';

prettyBytes(1337, {nonBreakingSpace: true});
//=> '1.34\u00A0kB'

prettyBytes(1337, {space: false, nonBreakingSpace: true});
//=> '1.34kB'
```

##### fixedWidth

Type: `number`\
Default: `undefined`

Pad the output to a fixed width by right-aligning it.

Useful for creating aligned columns in tables or progress bars.

If the output is longer than the specified width, no padding is applied.

Must be a non-negative integer. Throws a `TypeError` for invalid values.

```js
import prettyBytes from 'pretty-bytes';

prettyBytes(1337, {fixedWidth: 10});
//=> '   1.34 kB'

prettyBytes(100_000, {fixedWidth: 10});
//=> '    100 kB'

// Useful for progress bars and tables
[1000, 10_000, 100_000].map(bytes => prettyBytes(bytes, {fixedWidth: 8}));
//=> ['    1 kB', '   10 kB', '  100 kB']
```

## FAQ

### Why kB and not KB?

`k` is the [standardized SI prefix](https://en.wikipedia.org/wiki/Metric_prefix) for kilo.

## Related

- [pretty-bytes-cli](https://github.com/sindresorhus/pretty-bytes-cli) - CLI for this module
- [pretty-ms](https://github.com/sindresorhus/pretty-ms) - Convert milliseconds to a human readable string
