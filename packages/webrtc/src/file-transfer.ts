import type { ReceivedFile } from "@verge/protocol";

export const FILE_CHUNK_SIZE = 64 * 1024;
export const FILE_HIGH_WATER_MARK = 4 * 1024 * 1024;
export const FILE_LOW_WATER_MARK = 512 * 1024;
export const MAX_MEMORY_RECEIVE_BYTES = 64 * 1024 * 1024;

export interface FileMetadata {
  kind: "meta";
  version: 1;
  id: string;
  name: string;
  size: number;
  mediaType: string;
  sha256: string;
  chunkSize: number;
}

export interface FileDone {
  kind: "done";
}

export interface FileCancel {
  kind: "cancel";
}

export type FileControlMessage =
  | FileMetadata
  | FileDone
  | FileCancel;

export type FileTransferDirection = "send" | "receive";
export type FileTransferState =
  | "hashing"
  | "transferring"
  | "completed"
  | "cancelled"
  | "failed";

export interface FileTransferProgress {
  id: string;
  name: string;
  direction: FileTransferDirection;
  state: FileTransferState;
  bytesTransferred: number;
  totalBytes: number;
}

const SHA256_INITIAL = new Uint32Array([
  0x6a09e667,
  0xbb67ae85,
  0x3c6ef372,
  0xa54ff53a,
  0x510e527f,
  0x9b05688c,
  0x1f83d9ab,
  0x5be0cd19
]);

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

function rotateRight(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

function toHex(words: Uint32Array): string {
  return Array.from(words, (word) =>
    word.toString(16).padStart(8, "0")
  ).join("");
}

export class IncrementalSha256 {
  #state = new Uint32Array(SHA256_INITIAL);
  #buffer = new Uint8Array(64);
  #bufferLength = 0;
  #bytesHashed = 0;
  #finished = false;

  update(input: ArrayBuffer | ArrayBufferView): void {
    if (this.#finished) {
      throw new Error("SHA-256 digest has already been finalized.");
    }

    const data =
      input instanceof ArrayBuffer
        ? new Uint8Array(input)
        : new Uint8Array(
            input.buffer,
            input.byteOffset,
            input.byteLength
          );

    this.#bytesHashed += data.byteLength;
    let offset = 0;

    if (this.#bufferLength > 0) {
      const needed = 64 - this.#bufferLength;
      const take = Math.min(needed, data.byteLength);
      this.#buffer.set(data.subarray(0, take), this.#bufferLength);
      this.#bufferLength += take;
      offset += take;

      if (this.#bufferLength === 64) {
        this.#compress(this.#buffer);
        this.#bufferLength = 0;
      }
    }

    while (offset + 64 <= data.byteLength) {
      this.#compress(data.subarray(offset, offset + 64));
      offset += 64;
    }

    if (offset < data.byteLength) {
      const remaining = data.subarray(offset);
      this.#buffer.set(remaining, 0);
      this.#bufferLength = remaining.byteLength;
    }
  }

  digestHex(): string {
    if (this.#finished) {
      throw new Error("SHA-256 digest has already been finalized.");
    }
    this.#finished = true;

    const bitLength = this.#bytesHashed * 8;
    const high = Math.floor(bitLength / 0x1_0000_0000);
    const low = bitLength >>> 0;

    this.#buffer[this.#bufferLength++] = 0x80;

    if (this.#bufferLength > 56) {
      this.#buffer.fill(0, this.#bufferLength, 64);
      this.#compress(this.#buffer);
      this.#bufferLength = 0;
    }

    this.#buffer.fill(0, this.#bufferLength, 56);
    const view = new DataView(this.#buffer.buffer);
    view.setUint32(56, high >>> 0);
    view.setUint32(60, low);
    this.#compress(this.#buffer);
    this.#bufferLength = 0;

    return toHex(this.#state);
  }

  #compress(chunk: Uint8Array): void {
    const words = new Uint32Array(64);
    const view = new DataView(
      chunk.buffer,
      chunk.byteOffset,
      chunk.byteLength
    );

    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(index * 4);
    }

    for (let index = 16; index < 64; index += 1) {
      const word15 = words[index - 15] ?? 0;
      const word2 = words[index - 2] ?? 0;
      const s0 =
        rotateRight(word15, 7) ^
        rotateRight(word15, 18) ^
        (word15 >>> 3);
      const s1 =
        rotateRight(word2, 17) ^
        rotateRight(word2, 19) ^
        (word2 >>> 10);
      words[index] =
        ((words[index - 16] ?? 0) +
          s0 +
          (words[index - 7] ?? 0) +
          s1) >>>
        0;
    }

    let a = this.#state[0] ?? 0;
    let b = this.#state[1] ?? 0;
    let c = this.#state[2] ?? 0;
    let d = this.#state[3] ?? 0;
    let e = this.#state[4] ?? 0;
    let f = this.#state[5] ?? 0;
    let g = this.#state[6] ?? 0;
    let h = this.#state[7] ?? 0;

    for (let index = 0; index < 64; index += 1) {
      const sigma1 =
        rotateRight(e, 6) ^
        rotateRight(e, 11) ^
        rotateRight(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temp1 =
        (h +
          sigma1 +
          choose +
          (SHA256_K[index] ?? 0) +
          (words[index] ?? 0)) >>>
        0;
      const sigma0 =
        rotateRight(a, 2) ^
        rotateRight(a, 13) ^
        rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sigma0 + majority) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    this.#state[0] = ((this.#state[0] ?? 0) + a) >>> 0;
    this.#state[1] = ((this.#state[1] ?? 0) + b) >>> 0;
    this.#state[2] = ((this.#state[2] ?? 0) + c) >>> 0;
    this.#state[3] = ((this.#state[3] ?? 0) + d) >>> 0;
    this.#state[4] = ((this.#state[4] ?? 0) + e) >>> 0;
    this.#state[5] = ((this.#state[5] ?? 0) + f) >>> 0;
    this.#state[6] = ((this.#state[6] ?? 0) + g) >>> 0;
    this.#state[7] = ((this.#state[7] ?? 0) + h) >>> 0;
  }
}

export async function sha256Blob(blob: Blob): Promise<string> {
  const hash = new IncrementalSha256();
  const reader = blob.stream().getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) hash.update(value);
    }
  } finally {
    reader.releaseLock();
  }

  return hash.digestHex();
}

function copyArrayBuffer(chunk: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(chunk.byteLength);
  copy.set(chunk);
  return copy.buffer;
}

interface ReceiveSink {
  write(chunk: Uint8Array): Promise<void>;
  finish(mediaType: string): Promise<Blob>;
  abort(): Promise<void>;
}

class MemoryReceiveSink implements ReceiveSink {
  #chunks: ArrayBuffer[] = [];
  #size = 0;

  async write(chunk: Uint8Array): Promise<void> {
    this.#size += chunk.byteLength;
    if (this.#size > MAX_MEMORY_RECEIVE_BYTES) {
      throw new Error(
        "Incoming file exceeds the bounded in-memory receive limit."
      );
    }
    this.#chunks.push(copyArrayBuffer(chunk));
  }

  async finish(mediaType: string): Promise<Blob> {
    return new Blob(this.#chunks, { type: mediaType });
  }

  async abort(): Promise<void> {
    this.#chunks = [];
    this.#size = 0;
  }
}

interface StorageManagerWithDirectory extends StorageManager {
  getDirectory(): Promise<FileSystemDirectoryHandle>;
}

function supportsOriginPrivateFileSystem(): boolean {
  if (
    typeof navigator === "undefined" ||
    !navigator.storage
  ) {
    return false;
  }

  return (
    typeof (navigator.storage as StorageManagerWithDirectory)
      .getDirectory === "function"
  );
}

class OpfsReceiveSink implements ReceiveSink {
  constructor(
    private readonly handle: FileSystemFileHandle,
    private readonly writable: FileSystemWritableFileStream
  ) {}

  async write(chunk: Uint8Array): Promise<void> {
    await this.writable.write(copyArrayBuffer(chunk));
  }

  async finish(): Promise<Blob> {
    await this.writable.close();
    return this.handle.getFile();
  }

  async abort(): Promise<void> {
    await this.writable.abort().catch(() => undefined);
  }
}

async function createReceiveSink(
  id: string
): Promise<ReceiveSink> {
  if (!supportsOriginPrivateFileSystem()) {
    return new MemoryReceiveSink();
  }

  try {
    const root = await (
      navigator.storage as StorageManagerWithDirectory
    ).getDirectory();
    const directory = await root.getDirectoryHandle(
      "verge-transfers",
      { create: true }
    );
    const handle = await directory.getFileHandle(
      `${id}.part`,
      { create: true }
    );
    const writable = await handle.createWritable({
      keepExistingData: false
    });
    return new OpfsReceiveSink(handle, writable);
  } catch {
    return new MemoryReceiveSink();
  }
}

export class IncomingFileReceiver {
  readonly metadata: FileMetadata;

  #hash = new IncrementalSha256();
  #sink: ReceiveSink;
  #receivedBytes = 0;
  #closed = false;

  private constructor(
    metadata: FileMetadata,
    sink: ReceiveSink
  ) {
    this.metadata = metadata;
    this.#sink = sink;
  }

  static async create(
    metadata: FileMetadata
  ): Promise<IncomingFileReceiver> {
    if (
      metadata.version !== 1 ||
      metadata.size < 0 ||
      metadata.chunkSize !== FILE_CHUNK_SIZE ||
      !/^[a-f0-9]{64}$/i.test(metadata.sha256)
    ) {
      throw new Error("Unsupported file transfer metadata.");
    }

    return new IncomingFileReceiver(
      metadata,
      await createReceiveSink(metadata.id)
    );
  }

  get receivedBytes(): number {
    return this.#receivedBytes;
  }

  async write(chunk: ArrayBuffer): Promise<void> {
    if (this.#closed) {
      throw new Error("Incoming file receiver is closed.");
    }

    const bytes = new Uint8Array(chunk);
    if (
      bytes.byteLength > this.metadata.chunkSize ||
      this.#receivedBytes + bytes.byteLength >
        this.metadata.size
    ) {
      throw new Error("Incoming file chunk exceeds declared bounds.");
    }

    this.#hash.update(bytes);
    await this.#sink.write(bytes);
    this.#receivedBytes += bytes.byteLength;
  }

  async finish(): Promise<ReceivedFile> {
    if (this.#closed) {
      throw new Error("Incoming file receiver is closed.");
    }
    this.#closed = true;

    if (this.#receivedBytes !== this.metadata.size) {
      await this.#sink.abort();
      throw new Error("Incoming file ended before all bytes arrived.");
    }

    const digest = this.#hash.digestHex();
    const blob = await this.#sink.finish(this.metadata.mediaType);

    return {
      id: this.metadata.id,
      name: this.metadata.name,
      mediaType: this.metadata.mediaType,
      size: this.metadata.size,
      sha256: this.metadata.sha256,
      verified:
        digest.toLowerCase() ===
          this.metadata.sha256.toLowerCase() &&
        blob.size === this.metadata.size,
      blob
    };
  }

  async abort(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await this.#sink.abort();
  }
}

export function parseFileControlMessage(
  value: unknown
): FileControlMessage | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  if (record.kind === "done") {
    return { kind: "done" };
  }

  if (record.kind === "cancel") {
    return { kind: "cancel" };
  }

  if (
    record.kind !== "meta" ||
    record.version !== 1 ||
    typeof record.id !== "string" ||
    typeof record.name !== "string" ||
    typeof record.size !== "number" ||
    !Number.isSafeInteger(record.size) ||
    record.size < 0 ||
    typeof record.mediaType !== "string" ||
    typeof record.sha256 !== "string" ||
    typeof record.chunkSize !== "number"
  ) {
    return undefined;
  }

  return {
    kind: "meta",
    version: 1,
    id: record.id,
    name: record.name,
    size: record.size,
    mediaType: record.mediaType,
    sha256: record.sha256,
    chunkSize: record.chunkSize
  };
}
