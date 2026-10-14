import archiver from 'archiver';
import { PassThrough, type Readable } from 'node:stream';

/**
 * A ZIP written entry by entry, each entry finished before the next begins.
 *
 * Node has no ZIP writer of its own; `archiver` is the one exceljs already brings into the
 * dependency tree. The wrapper exists for one property: an entry's bytes are produced only when the
 * archive is ready to take them. Appending a hundred photographs' download streams at once would
 * open a hundred connections to storage and buffer whatever arrived; here each one is opened, copied
 * and closed in turn, and a table is read from its cursor only as fast as the ZIP is written.
 */
export class ZipWriter {
  private readonly archive = archiver('zip', { zlib: { level: 6 } });
  private failure: Error | null = null;

  constructor() {
    this.archive.on('warning', (error: Error) => {
      this.failure ??= error;
    });
    this.archive.on('error', (error: Error) => {
      this.failure ??= error;
    });
  }

  /** The ZIP's bytes, for whoever stores or sends it. Read it while entries are being added. */
  get output(): Readable {
    return this.archive;
  }

  /** A small entry already in memory: a manifest, a JSON document. */
  async addBuffer(name: string, content: Buffer | string): Promise<void> {
    await this.addEntry(name, () => {
      this.archive.append(typeof content === 'string' ? Buffer.from(content, 'utf8') : content, { name });
    });
  }

  /** An entry copied from a stream that already exists — a file out of storage. */
  async addStream(name: string, stream: Readable): Promise<void> {
    await this.addEntry(name, () => {
      this.archive.append(stream, { name });
    }, stream);
  }

  /**
   * An entry whose content `produce` writes as it goes — a table's rows, a workbook. `write` waits
   * when the archive is not ready for more, which is what keeps a large table out of memory.
   */
  async addProduced(name: string, produce: (sink: ProducedEntry) => Promise<void>): Promise<void> {
    const stream = new PassThrough();
    const done = this.addEntry(name, () => {
      this.archive.append(stream, { name });
    }, stream);
    const sink: ProducedEntry = {
      stream,
      write: (chunk: string | Buffer) =>
        new Promise<void>((resolve, reject) => {
          if (this.failure) {
            reject(this.failure);
            return;
          }
          if (stream.write(chunk)) resolve();
          else stream.once('drain', resolve);
        }),
    };
    try {
      await produce(sink);
      stream.end();
    } catch (error) {
      stream.destroy(error as Error);
      throw error;
    }
    await done;
  }

  /** Writes the central directory. The output ends once whoever reads it has the last byte. */
  async finish(): Promise<void> {
    if (this.failure) throw this.failure;
    await this.archive.finalize();
    if (this.failure) throw this.failure;
  }

  /** Stops early, so whoever is reading the output sees an error rather than a short file. */
  abort(error: Error): void {
    this.failure ??= error;
    this.archive.abort();
    this.archive.destroy(error);
  }

  private addEntry(name: string, append: () => void, source?: Readable): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const onEntry = (entry: { name: string }) => {
        if (entry.name !== name) return;
        cleanup();
        resolve();
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const cleanup = () => {
        this.archive.off('entry', onEntry);
        this.archive.off('error', onError);
        source?.off('error', onError);
      };
      this.archive.on('entry', onEntry);
      this.archive.on('error', onError);
      source?.on('error', onError);
      if (this.failure) {
        onError(this.failure);
        return;
      }
      append();
    });
  }
}

export interface ProducedEntry {
  /** The raw stream, for writers that pipe into one (the workbook). */
  stream: PassThrough;
  /** Writes a chunk, waiting while the archive catches up. */
  write(chunk: string | Buffer): Promise<void>;
}
