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
export class StringBuffer {
  private content: (string | StringBuffer)[];
  public length: number;

  constructor(s?: string) {
    this.content = [];
    this.length = 0;

    if (typeof s === "string") {
      this.append(s);
    }
  }

  public indexOf(searchString: string, position?: number): number {
    return this.toString().indexOf(searchString, position);
  }

  public toLowerCase(): string {
    return this.toString().toLowerCase();
  }

  public toUpperCase(): string {
    return this.toString().toUpperCase();
  }

  public toString(): string {
    if (this.content.length === 1) {
      return this.content[0].toString();
    }
    const s = this.content.join("");
    this.content = [s];
    return s;
  }

  public append(...s: (StringBuffer | string)[]): StringBuffer {
    s.forEach((str) => {
      this.length += str.length;
      this.content.push(str);
    });
    return this;
  }

  public substring(s: number, e?: number): StringBuffer {
    if (typeof e === "undefined") {
      e = this.length;
    }
    if (e < s) {
      const b = s;
      s = e;
      e = b;
    }
    if (s > this.length) {
      s = this.length;
    }
    if (e > this.length) {
      e = this.length;
    }
    if (s < 0) {
      s = 0;
    }
    if (e < 0) {
      e = 0;
    }
    const ns = new StringBuffer();
    if (this.content.length > 0) {
      let accs = 0;
      let i = 0;
      for (i = 0; i < this.content.length; i++) {
        if (s <= accs + this.content[i].length) {
          break;
        } else {
          accs += this.content[i].length;
        }
      }
      let acce = 0;
      let ei = 0;
      for (ei = 0; ei < this.content.length; ei++) {
        if (e <= acce + this.content[ei].length) {
          break;
        } else {
          acce += this.content[ei].length;
        }
      }
      if (i === ei) {
        ns.append(this.content[i].substring(s - accs, e - acce));
      } else {
        ns.append(this.content[i].substring(s - accs));
        this.content.slice(i + 1, ei).forEach(function (e) {
          ns.append(e);
        });

        ns.append(this.content[ei].substring(0, e - acce));
      }
    }
    return ns;
  }

  public substr(s: number, l: number): StringBuffer {
    if (s < 0) {
      s += this.length;
    }
    if (s < 0) {
      s = 0;
    }
    if (l < 0) {
      l = 0;
    }
    return this.substring(s, s + l);
  }
}
