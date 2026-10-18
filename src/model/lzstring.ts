/**
 * LZ-based string compression, compatible with the lz-string library (pieroxy/lz-string, MIT),
 * which shinylive uses for app links: `https://shinylive.io/r/app/#code=<compressed>`.
 *
 * Only the URL-safe variant is needed. This is a direct port of the library's algorithm, so the
 * output is byte-for-byte what `LZString.compressToEncodedURIComponent()` produces; a decoder is
 * included so tests can check round trips.
 */

const URI_SAFE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-$';

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

export function compressToEncodedURIComponent(input: string): string {
  return compress(input, 6, (n) => URI_SAFE.charAt(n));
}

export function decompressFromEncodedURIComponent(input: string): string | null {
  if (input === '') return null;
  // URLSearchParams turns "+" into a space; the library undoes that too.
  const s = input.replace(/ /g, '+');
  return decompress(s.length, 32, (i) => URI_SAFE.indexOf(s.charAt(i)));
}

function compress(uncompressed: string, bitsPerChar: number, charFromInt: (n: number) => string): string {
  const dictionary: Record<string, number> = {};
  const toCreate: Record<string, true> = {};
  let w = '';
  let enlargeIn = 2; // compensates for the first entry, which should not count
  let dictSize = 3;
  let numBits = 2;
  const data: string[] = [];
  let dataVal = 0;
  let dataPosition = 0;

  /** Write the lowest `bits` bits of `value`, least significant first. */
  const write = (value: number, bits: number) => {
    for (let i = 0; i < bits; i++) {
      dataVal = (dataVal << 1) | (value & 1);
      if (dataPosition === bitsPerChar - 1) {
        dataPosition = 0;
        data.push(charFromInt(dataVal));
        dataVal = 0;
      } else {
        dataPosition++;
      }
      value >>= 1;
    }
  };

  const bumpEnlarge = () => {
    enlargeIn--;
    if (enlargeIn === 0) {
      enlargeIn = 2 ** numBits;
      numBits++;
    }
  };

  /** Output the code for `w` (a new single character is written out literally the first time). */
  const emit = (w: string) => {
    if (has(toCreate, w)) {
      const code = w.charCodeAt(0);
      if (code < 256) {
        write(0, numBits);
        write(code, 8);
      } else {
        write(1, numBits);
        write(code, 16);
      }
      bumpEnlarge();
      delete toCreate[w];
    } else {
      write(dictionary[w], numBits);
    }
    bumpEnlarge();
  };

  for (let ii = 0; ii < uncompressed.length; ii++) {
    const c = uncompressed.charAt(ii);
    if (!has(dictionary, c)) {
      dictionary[c] = dictSize++;
      toCreate[c] = true;
    }
    const wc = w + c;
    if (has(dictionary, wc)) {
      w = wc;
    } else {
      emit(w);
      dictionary[wc] = dictSize++;
      w = c;
    }
  }
  if (w !== '') emit(w);

  // End of stream
  write(2, numBits);

  // Flush the last character
  for (;;) {
    dataVal <<= 1;
    if (dataPosition === bitsPerChar - 1) {
      data.push(charFromInt(dataVal));
      break;
    }
    dataPosition++;
  }
  return data.join('');
}

function decompress(length: number, resetValue: number, nextValue: (index: number) => number): string | null {
  const dictionary: string[] = [];
  let enlargeIn = 4;
  let dictSize = 4;
  let numBits = 3;
  const result: string[] = [];
  const data = { val: nextValue(0), position: resetValue, index: 1 };

  const read = (bits: number) => {
    let out = 0;
    for (let power = 1, i = 0; i < bits; i++, power <<= 1) {
      const bit = data.val & data.position;
      data.position >>= 1;
      if (data.position === 0) {
        data.position = resetValue;
        data.val = nextValue(data.index++);
      }
      if (bit > 0) out |= power;
    }
    return out;
  };

  for (let i = 0; i < 3; i++) dictionary[i] = String(i);

  let c: string;
  switch (read(2)) {
    case 0:
      c = String.fromCharCode(read(8));
      break;
    case 1:
      c = String.fromCharCode(read(16));
      break;
    case 2:
      return '';
    default:
      return null;
  }
  dictionary[3] = c;
  let w = c;
  result.push(c);

  for (;;) {
    if (data.index > length) return '';
    let code = read(numBits);
    switch (code) {
      case 0:
        dictionary[dictSize++] = String.fromCharCode(read(8));
        code = dictSize - 1;
        enlargeIn--;
        break;
      case 1:
        dictionary[dictSize++] = String.fromCharCode(read(16));
        code = dictSize - 1;
        enlargeIn--;
        break;
      case 2:
        return result.join('');
    }
    if (enlargeIn === 0) {
      enlargeIn = 2 ** numBits;
      numBits++;
    }
    let entry: string;
    if (code < dictSize && dictionary[code] !== undefined && code > 2) entry = dictionary[code];
    else if (code === dictSize) entry = w + w.charAt(0);
    else return null;
    result.push(entry);
    dictionary[dictSize++] = w + entry.charAt(0);
    enlargeIn--;
    w = entry;
    if (enlargeIn === 0) {
      enlargeIn = 2 ** numBits;
      numBits++;
    }
  }
}
