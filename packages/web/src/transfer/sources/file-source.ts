import type { Source } from '@shareit/shared';

/**
 * A `Source` backed by a browser `File`/`Blob`. `slice` reads only the requested range, so the
 * file is never fully loaded into memory — universal across browsers.
 */
export class FileSource implements Source {
  readonly size: number;
  constructor(private readonly file: File) {
    this.size = file.size;
  }
  async slice(start: number, end: number): Promise<Uint8Array> {
    return new Uint8Array(await this.file.slice(start, end).arrayBuffer());
  }
}
