import { describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseBookFile } from "./parsers";

const container =
  '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>';

async function epubFile(
  version = 3,
  title = "The Lantern",
  withNavigation = true,
  withCover = false,
) {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file("META-INF/container.xml", container);
  const navItem = !withNavigation
    ? ""
    : version === 3
      ? '<item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/>'
      : '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>';
  const toc =
    version === 3
      ? '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="text/front.xhtml#bio">About the Author</a></li><li><a href="text/chapter.xhtml#one">Chapter One</a></li></ol></nav></body></html>'
      : '<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap><navPoint id="bio"><navLabel><text>About the Author</text></navLabel><content src="text/front.xhtml#bio"/></navPoint><navPoint id="one"><navLabel><text>Chapter One</text></navLabel><content src="text/chapter.xhtml#one"/></navPoint></navMap></ncx>';
  const versionAttr = version === 2 ? ' toc="ncx"' : "";
  const coverItem = withCover
    ? '<item id="cover" href="cover.png" media-type="image/png" properties="cover-image"/>'
    : "";
  zip.file(
    "OPS/package.opf",
    '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="' +
      version +
      '.0"' +
      versionAttr +
      '><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>A Short Reader</dc:title><dc:creator>PageVoice Test</dc:creator><dc:language>en</dc:language></metadata><manifest>' +
      navItem +
      coverItem +
      '<item id="front" href="text/front.xhtml" media-type="application/xhtml+xml"/><item id="story" href="text/chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine' +
      versionAttr +
      '><itemref idref="front"/><itemref idref="story"/></spine></package>',
  );
  zip.file("OPS/nav.xhtml", toc);
  zip.file("OPS/toc.ncx", toc);
  zip.file(
    "OPS/text/front.xhtml",
    '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>About</title></head><body><section epub:type="frontmatter"><h1 id="bio">About the Author</h1><p>The author lived beside the old harbour. She wrote this story in spring.</p></section></body></html>',
  );
  zip.file(
    "OPS/text/chapter.xhtml",
    '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>' +
      title +
      '</title></head><body><section><h1 id="one">' +
      title +
      "</h1><p>Mira opened the door. A little light crossed the room.</p><p>She carried a brass lantern toward the shore.</p></section></body></html>",
  );
  if (withCover)
    zip.file(
      "OPS/cover.png",
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    );
  const data = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
  });
  return Object.assign(new Blob([data], { type: "application/epub+zip" }), {
    name: "sample-" + version + ".epub",
  });
}

function fileFrom(buffer, name) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return {
    name,
    size: bytes.byteLength,
    arrayBuffer: async () => bytes.slice().buffer,
    slice(start, end) {
      const part = bytes.slice(start, end);
      return { arrayBuffer: async () => part.buffer };
    },
  };
}

function fakePdfLoader(pages = [], outline = []) {
  const pdf = {
    numPages: pages.length,
    getPage: vi.fn(async (pageNumber) => ({
      getTextContent: async () => ({ items: pages[pageNumber - 1] }),
    })),
    getOutline: async () =>
      outline.map((item) => ({
        title: item.title,
        dest: [item.page],
        items: [],
      })),
    getPageIndex: async (reference) => reference - 1,
    getDestination: async (destination) => destination,
    getMetadata: async () => ({
      info: { Title: "A Short Reader", Author: "PageVoice Test" },
    }),
  };
  const task = {
    promise: Promise.resolve(pdf),
    destroy: vi.fn(async () => {}),
  };
  const loader = vi.fn(async () => ({ getDocument: () => task }));
  loader.task = task;
  return loader;
}

function textItem(str, x, y, size = 12) {
  return { str, transform: [1, 0, 0, size, x, y], height: size, hasEOL: true };
}

describe("browser EPUB parser", () => {
  it.each([
    [3, "sample-epub3.epub"],
    [2, "sample-epub2.epub"],
  ])("reads EPUB %s spine and its navigation labels", async (version, name) => {
    const bytes = await readFile(
      resolve(process.cwd(), "src/browser/fixtures/" + name),
    );
    const file = Object.assign(new Blob([bytes]), { name });
    const book = await parseBookFile(file, "en");
    expect(book).toMatchObject({
      title: "A Short Reader",
      author: "PageVoice Test",
      format: "epub",
    });
    expect(book.chapters.map((chapter) => chapter.title)).toEqual([
      "About the Author",
      "Chapter One",
    ]);
    expect(book.chapters[0].role).toBe("front_matter");
    expect(book.chapters[1].evidence).toBe("navigation");
    expect(book.chapters[1].source).toContain("#one");
    expect(book.chapters[1].sentences).toHaveLength(3);
  });

  it("keeps an unlabelled EPUB section heading as metadata", async () => {
    const book = await parseBookFile(
      await epubFile(3, "Untitled section", false),
      "en",
    );
    expect(book.chapters[1].title).toBe("Untitled section");
    expect(book.chapters[1].evidence).toBe("heading");
    expect(book.chapters[1].sentences.join(" ")).not.toContain(
      "Untitled section.",
    );
  });

  it("extracts an EPUB cover as an in-memory Blob", async () => {
    const book = await parseBookFile(
      await epubFile(3, "The Lantern", true, true),
      "en",
    );
    expect(book.cover).toBeInstanceOf(Blob);
    expect(book.cover.type).toBe("image/png");
  });

  it("rejects unsupported extensions and archive paths that escape the EPUB root", async () => {
    await expect(
      parseBookFile(fileFrom(new Uint8Array([1, 2, 3]), "notes.txt")),
    ).rejects.toMatchObject({ code: "unsupportedFile" });
    const zip = new JSZip();
    zip.file(
      "META-INF/container.xml",
      container.replace("OPS/package.opf", "../../outside.opf"),
    );
    const protectedEpub = Object.assign(
      new Blob([await zip.generateAsync({ type: "uint8array" })]),
      { name: "bad.epub" },
    );
    await expect(parseBookFile(protectedEpub)).rejects.toMatchObject({
      code: "invalidBook",
    });
  });
});

describe("native text PDF structure extraction", () => {
  const fixture = resolve(
    process.cwd(),
    "src/browser/fixtures/native-text.pdf",
  );

  it("extracts bookmark chapters, sentences and metadata from a native PDF fixture", async () => {
    const bytes = await readFile(fixture);
    const loader = fakePdfLoader(
      [
        [
          textItem("Chapter One: The Lantern", 72, 710, 20),
          textItem(
            "Mira opened the old door. A little light crossed the quiet room.",
            72,
            670,
          ),
          textItem(
            "She found a brass lantern and carried it toward the harbour.",
            72,
            650,
          ),
        ],
        [
          textItem("Chapter Two: The Shore", 72, 710, 20),
          textItem(
            "At dawn, the sea was calm. The lighthouse keeper waved.",
            72,
            670,
          ),
          textItem(
            "Mira smiled, then walked home beneath the clear sky.",
            72,
            650,
          ),
        ],
      ],
      [
        { title: "Chapter One: The Lantern", page: 1 },
        { title: "Chapter Two: The Shore", page: 2 },
      ],
    );
    const book = await parseBookFile(
      fileFrom(bytes, "native-text.pdf"),
      "en",
      () => {},
      { pdfLoader: loader },
    );
    expect(book).toMatchObject({
      title: "A Short Reader",
      author: "PageVoice Test",
      format: "pdf",
    });
    expect(book.chapters.map((chapter) => chapter.title)).toEqual([
      "Chapter One: The Lantern",
      "Chapter Two: The Shore",
    ]);
    expect(book.chapters[0].sentences[0]).toBe("Mira opened the old door.");
    expect(book.chapters[0].sentences.join(" ")).not.toContain("Chapter One:");
    expect(loader.task.destroy).toHaveBeenCalledOnce();
  });

  it("recognizes a PDF with no text layer as scanned instead of inventing text", async () => {
    const loader = fakePdfLoader([[]]);
    const scan = fileFrom(
      new TextEncoder().encode("%PDF-1.4\n%%EOF"),
      "scan.pdf",
    );
    await expect(
      parseBookFile(scan, "es", () => {}, { pdfLoader: loader }),
    ).rejects.toMatchObject({ code: "scannedPdf" });
  });
});
