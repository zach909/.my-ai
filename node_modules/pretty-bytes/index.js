const BYTE_UNITS = [
	'B',
	'kB',
	'MB',
	'GB',
	'TB',
	'PB',
	'EB',
	'ZB',
	'YB',
];

const BIBYTE_UNITS = [
	'B',
	'KiB',
	'MiB',
	'GiB',
	'TiB',
	'PiB',
	'EiB',
	'ZiB',
	'YiB',
];

const BIT_UNITS = [
	'b',
	'kbit',
	'Mbit',
	'Gbit',
	'Tbit',
	'Pbit',
	'Ebit',
	'Zbit',
	'Ybit',
];

const BIBIT_UNITS = [
	'b',
	'kibit',
	'Mibit',
	'Gibit',
	'Tibit',
	'Pibit',
	'Eibit',
	'Zibit',
	'Yibit',
];

// Indexed by `bits` and then `binary`, so the four unit systems are picked in one step.
const UNIT_SETS = [BYTE_UNITS, BIBYTE_UNITS, BIT_UNITS, BIBIT_UNITS];

/*
`Number#toString` switches to exponential notation outside the range [1e-6, 1e21) and `Intl.NumberFormat` drops every fraction digit past the 100 it accepts.
Byte counts read as plain decimal numbers, so both losses are undone here. Expects a finite, non-negative number.
*/
const toDecimalString = number => {
	if (number >= 1e-6 && number < 1e21) {
		return String(number);
	}

	const [mantissa, exponentString] = number.toExponential().split('e');
	const digits = mantissa.replace('.', '');
	const pointPosition = Number(exponentString) + 1;
	const isPositive = pointPosition > 0;
	const padded = isPositive ? digits.padEnd(pointPosition, '0') : '0'.repeat(1 - pointPosition) + digits;
	const integerPart = padded.slice(0, isPositive ? pointPosition : 1);
	const fractionPart = padded.slice(isPositive ? pointPosition : 1).replace(/0+$/, '');

	return fractionPart ? `${integerPart}.${fractionPart}` : integerPart;
};

/*
Formats the given number using `Number#toLocaleString`.
- If locale is a string or array, the value is expected to be a BCP 47 language tag or list of language tags (for example: `de`).
- If locale is true, the system default locale is used for translation.
- If locale is false or unspecified, formatting options are applied without localization; without options, the number is written out as plain digits.
*/
const toLocaleString = (number, locale, options) => {
	if (typeof locale === 'string' || Array.isArray(locale) || locale === true) {
		const locales = locale === true ? undefined : locale;

		if (options !== undefined) {
			return number.toLocaleString(locales, options);
		}

		// `Intl.NumberFormat` limits itself to 3 *fraction* digits while the default here is 3 *significant* digits, so the limit comes from the value.
		const text = toDecimalString(number);
		const pointIndex = text.indexOf('.');
		const maximumFractionDigits = pointIndex === -1 ? 0 : text.length - pointIndex - 1;

		// `Intl.NumberFormat` accepts at most 100 fraction digits. Rounding to 3 significant digits only needs more than that for absurdly small values, which are written out as plain digits instead.
		if (maximumFractionDigits > 100) {
			return text;
		}

		return number.toLocaleString(locales, {maximumFractionDigits});
	}

	if (options === undefined) {
		return toDecimalString(number);
	}

	return number.toLocaleString('en-US', {...options, useGrouping: false});
};

const log10 = numberOrBigInt => {
	if (typeof numberOrBigInt === 'number') {
		return Math.log10(numberOrBigInt);
	}

	const string = numberOrBigInt.toString(10);

	// A `number` only holds about 15 significant digits, so the remaining digits cannot move the magnitude. The result can still land exactly on a unit boundary, which the caller corrects for.
	return string.length + Math.log10(`0.${string.slice(0, 15)}`);
};

const log = numberOrBigInt => {
	if (typeof numberOrBigInt === 'number') {
		return Math.log(numberOrBigInt);
	}

	return log10(numberOrBigInt) * Math.log(10);
};

/*
A `bigint` that a `number` can hold exactly is divided the same way, so the output never depends on which type it was given as.
`floor(a / b) + (a % b) / b` is a different double than `a / b`, which flips the rounding at ties like 1805 bytes.
*/
const divide = (numberOrBigInt, base, exponent) => {
	const divisor = base ** exponent;

	if (typeof numberOrBigInt === 'number' || numberOrBigInt <= Number.MAX_SAFE_INTEGER) {
		return Number(numberOrBigInt) / divisor;
	}

	// `divisor` is not exact for every unit, as `1000 ** 8` is not `1e24`, so the exact divisor is rebuilt from the base and the exponent.
	const bigintDivisor = BigInt(base) ** BigInt(exponent);
	const integerPart = numberOrBigInt / bigintDivisor;
	const remainder = numberOrBigInt % bigintDivisor;

	return Number(integerPart) + (Number(remainder) / divisor);
};

/*
The plain decimal digits of a scaled value that no `number` can hold. `Intl.NumberFormat` is not involved, so the output carries no grouping or localized separator, the same as the fallback for a value with more fraction digits than it accepts.
*/
const toUnrepresentableString = (number, base, exponent, localeOptions) => {
	const scale = BigInt(base) ** BigInt(exponent);
	const whole = number / scale;

	// The 3 significant digit default never bites here: it only ever rounds to at least as many digits as the value has integers, and this one has far more than 3.
	if (localeOptions === undefined) {
		return whole.toString();
	}

	// The fraction digit options take over from that default, so the integer part stays exact and the fraction is truncated.
	const minimumFractionDigits = localeOptions.minimumFractionDigits ?? 0;
	const maximumFractionDigits = Math.max(localeOptions.maximumFractionDigits ?? 3, minimumFractionDigits);
	const truncated = ((number % scale) * (10n ** BigInt(maximumFractionDigits)) / scale).toString().padStart(maximumFractionDigits, '0');
	const fraction = truncated.replace(/0+$/, '').padEnd(minimumFractionDigits, '0');

	return fraction ? `${whole}.${fraction}` : whole.toString();
};

/*
The sign to print in front of the number. A difference of exactly zero gets a space instead of a plus sign, for better alignment. `0 === 0n` is `false`, so both are compared.
*/
const signOf = (number, signed) => {
	if (number < 0) {
		return '-';
	}

	if (!signed) {
		return '';
	}

	return number === 0 || number === 0n ? ' ' : '+';
};

const assertFixedWidth = fixedWidth => {
	if (fixedWidth !== undefined && (typeof fixedWidth !== 'number' || !Number.isSafeInteger(fixedWidth) || fixedWidth < 0)) {
		throw new TypeError(`Expected fixedWidth to be a non-negative integer, got ${typeof fixedWidth}: ${fixedWidth}`);
	}
};

/*
`Intl.NumberFormat` silently truncates non-integers, so they are rejected here instead of quietly changing the output.
*/
const assertFractionDigits = (name, value) => {
	if (value !== undefined && (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 100)) {
		throw new TypeError(`Expected ${name} to be an integer between 0 and 100, got ${typeof value}: ${value}`);
	}
};

const buildLocaleOptions = options => {
	const {minimumFractionDigits, maximumFractionDigits} = options;

	if (minimumFractionDigits === undefined && maximumFractionDigits === undefined) {
		return undefined;
	}

	assertFractionDigits('minimumFractionDigits', minimumFractionDigits);
	assertFractionDigits('maximumFractionDigits', maximumFractionDigits);

	// Checked here rather than left to `Intl.NumberFormat`, which is skipped for a value past the number range.
	if (minimumFractionDigits > maximumFractionDigits) {
		throw new RangeError(`Expected minimumFractionDigits (${minimumFractionDigits}) to not be greater than maximumFractionDigits (${maximumFractionDigits})`);
	}

	return {
		...(minimumFractionDigits !== undefined && {minimumFractionDigits}),
		...(maximumFractionDigits !== undefined && {maximumFractionDigits}),
		roundingMode: 'trunc',
	};
};

export default function prettyBytes(number, options) {
	if (typeof number !== 'bigint' && !Number.isFinite(number)) {
		throw new TypeError(`Expected a finite number, got ${typeof number}: ${number}`);
	}

	options = {
		bits: false,
		binary: false,
		space: true,
		nonBreakingSpace: false,
		...options,
	};

	assertFixedWidth(options.fixedWidth);
	const localeOptions = buildLocaleOptions(options);

	// Indexed by `bits` then `binary`, so the four combinations line up in one table.
	const UNITS = UNIT_SETS[(options.bits ? 2 : 0) + (options.binary ? 1 : 0)];

	const separator = options.space ? (options.nonBreakingSpace ? '\u00A0' : ' ') : '';

	// Normalize `-0` to `0` so it never formats as `-0`.
	if (Object.is(number, -0)) {
		number = 0;
	}

	const prefix = signOf(number, options.signed);

	if (number < 0) {
		number = -number;
	}

	const base = options.binary ? 1024 : 1000;

	let exponent = 0;
	if (number >= 1) {
		exponent = Math.min(Math.floor(options.binary ? log(number) / Math.log(base) : log10(number) / 3), UNITS.length - 1);
	}

	// A `number` always scales down to something a `number` can hold, and a `bigint` stops being able to once the quotient passes `Number.MAX_VALUE`, where `divide` overflows to `Infinity` and the exact quotient is formatted instead.
	const scaled = divide(number, base, exponent);

	let numberString;
	if (Number.isFinite(scaled)) {
		number = scaled;

		// A value that sits just below a unit boundary, like `999999999999999` bytes, has a `log10` that rounds up to the boundary itself, so the exponent has to be corrected back.
		if (number < 1 && exponent > 0) {
			number *= base;
			exponent -= 1;
		}

		if (!localeOptions) {
			const minimumPrecision = Math.max(3, Math.floor(number).toString().length);
			number = Number(number.toPrecision(minimumPrecision));

			if (number >= base && exponent < UNITS.length - 1) {
				number /= base;
				exponent += 1;
			}
		}

		numberString = toLocaleString(number, options.locale, localeOptions);
	} else {
		// The scaled value is past what a `number` can hold, so the exact quotient is written out instead.
		numberString = toUnrepresentableString(number, base, exponent, localeOptions);
	}

	const result = prefix + numberString + separator + UNITS[exponent];
	return result.padStart(options.fixedWidth ?? 0);
}
