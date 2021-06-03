/*
MIT License

Copyright (c) 2021 Marcel Kottmann

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
const READ_CR = 0;
const READ_LF = 1;
const READ_LEN = 2;
const READ_PAYL = 3;
const FINISHED = 4;

function assertTransferChunked(test: boolean, message: string) {
  if (!test) {
    throw Error("Invalid chunked transfer encoding. Failed test " + message);
  }
}

export type ChunkedEncodingConsumer = (data: Uint8Array) => boolean;

export function createChunkedEncodingConsumer(
  onData?: (data: Uint8Array) => void
): ChunkedEncodingConsumer {
  let state = READ_LEN;
  let tempLen = 0;
  let chunkLen = -1;
  let finishing = false;

  return (data: Uint8Array) => {
    let p = 0;

    while (p < data.length && state !== FINISHED) {
      /*console.log("s=" + state);
      console.log("p=" + p);
      console.log("cl=" + chunkLen);
      console.log("dl=" + data.length);
*/
      const d = data[p];

      switch (state) {
        case READ_CR:
          assertTransferChunked(d === 13, "d === 13");
          state = READ_LF;
          p++;
          break;
        case READ_LF:
          assertTransferChunked(d === 10, "d === 10");
          if (finishing) {
            state = FINISHED;
          } else if (chunkLen == 0) {
            finishing = true;
            state = READ_CR;
          } else if (chunkLen > 0) {
            state = READ_PAYL;
          } else {
            state = READ_LEN;
          }
          p++;
          break;
        case READ_LEN:
          if (d == 13) {
            state = READ_CR;
            chunkLen = tempLen;
            tempLen = 0;
            break;
          } else if (d >= 97 && d <= 102) {
            // a-f
            tempLen = tempLen * 16 + (d - 97) + 10;
          } else if (d >= 65 && d <= 70) {
            // A-F
            tempLen = tempLen * 16 + (d - 65) + 10;
          } else if (d >= 48 && d <= 57) {
            // 0-9
            tempLen = tempLen * 16 + (d - 48);
          } else {
            assertTransferChunked(false, "Invalid length char: " + d);
          }
          //console.log("templen=" + tempLen + "d=" + d);
          p++;
          break;
        case READ_PAYL:
          assertTransferChunked(chunkLen > 0, "chunkLen > 0");
          if (chunkLen >= data.length - p) {
            if (onData) {
              onData(data.subarray(p, data.length));
            }
            chunkLen -= data.length - p;
            p = data.length;
          } else {
            if (onData) {
              onData(data.subarray(p, p + chunkLen));
            }
            p += chunkLen;
            chunkLen = -1;
            state = READ_CR;
          }
          break;
        case FINISHED:
          return true;
      }
    }
    return state === FINISHED;
  };
}
