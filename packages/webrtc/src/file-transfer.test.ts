import { describe, expect, it } from "vitest";
import {
  FILE_CHUNK_SIZE,
  IncomingFileReceiver,
  IncrementalSha256,
  sha256Blob,
  type FileMetadata
} from "./file-transfer";

const ABC_SHA256 =
  "ba7816bf8f01cfea414140de5dae2223" +
  "b00361a396177a9cb410ff61f20015ad";

function metadata(
  overrides: Partial<FileMetadata> = {}
): FileMetadata {
  return {
    kind: "meta",
    version: 1,
    id: "test-transfer",
    name: "test.txt",
    size: 3,
    mediaType: "text/plain",
    sha256: ABC_SHA256,
    chunkSize: FILE_CHUNK_SIZE,
    ...overrides
  };
}

describe("IncrementalSha256", () => {
  it("matches the SHA-256 known vector across chunk boundaries", () => {
    const hash = new IncrementalSha256();
    hash.update(new TextEncoder().encode("a"));
    hash.update(new TextEncoder().encode("b"));
    hash.update(new TextEncoder().encode("c"));

    expect(hash.digestHex()).toBe(ABC_SHA256);
  });

  it("streams blob hashing without whole-blob arrayBuffer access", async () => {
    const blob = new Blob(["abc"]);
    const original = blob.arrayBuffer.bind(blob);
    Object.defineProperty(blob, "arrayBuffer", {
      value: () => {
        throw new Error("whole blob read should not be used");
      }
    });

    expect(await sha256Blob(blob)).toBe(ABC_SHA256);
    Object.defineProperty(blob, "arrayBuffer", { value: original });
  });
});

describe("IncomingFileReceiver", () => {
  it("verifies and returns a bounded small-file receive", async () => {
    const receiver = await IncomingFileReceiver.create(metadata());
    await receiver.write(
      new TextEncoder().encode("abc").buffer as ArrayBuffer
    );

    const file = await receiver.finish();

    expect(file.verified).toBe(true);
    expect(file.size).toBe(3);
    expect(await file.blob.text()).toBe("abc");
  });

  it("rejects unsupported transfer metadata", async () => {
    await expect(
      IncomingFileReceiver.create(
        metadata({ chunkSize: FILE_CHUNK_SIZE / 2 })
      )
    ).rejects.toThrow("Unsupported file transfer metadata");
  });

  it("rejects completion before all declared bytes arrive", async () => {
    const receiver = await IncomingFileReceiver.create(
      metadata({ size: 4 })
    );
    await receiver.write(
      new TextEncoder().encode("abc").buffer as ArrayBuffer
    );

    await expect(receiver.finish()).rejects.toThrow(
      "ended before all bytes arrived"
    );
  });
});
