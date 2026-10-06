import JSZip from "jszip";
import { DOMParser } from "@xmldom/xmldom";
import { splitSentences } from "./sentences";
import { detectLanguage } from "./languages";

const MAX_FILE_BYTES = 100 * 1024 * 1024;
const MAX_ENTRIES = 50_000;
const MAX_EXPANDED_BYTES = 200 * 1024 * 1024;
const MAX_ENTRY_BYTES = 50 * 1024 * 1024;
const MAX_PDF_PAGES = 2_500;
const MAX_TEXT_CHARS = 30_000_000;
const BLOCKS = new Set([
  "p",
  "li",
  "blockquote",
  "pre",
  "h1",
  "h2",
  "h3",
  "h4",
  "td",
  "th",
  "dt",
  "dd",
  "figcaption",
]);
const OMIT = new Set(["head", "nav", "script", "style", "noscript"]);

export class ReaderError extends Error {
  constructor(code, message = "") {
    super(message || code);
    this.name = "ReaderError";
    this.code = code;
  }
}

function clean(value) {
  return String(value || "")
    .normalize("NFC")
    .replace(/\u00ad/g, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function localName(node) {
  return String(node.localName || node.nodeName || "")
    .split(":")
    .pop()
    .toLowerCase();
}

function nodes(root, name) {
  const all = root.getElementsByTagName("*");
  return Array.from(all).filter((node) => localName(node) === name);
}

function firstNode(root, name) {
  return nodes(root, name)[0] || null;
}

function xml(source) {
  try {
    const doc = new DOMParser({
      onError(level, message) {
        if (level !== "warning") throw new Error(message);
      },
    }).parseFromString(source, "application/xml");
    if (
      !doc.documentElement ||
      localName(doc.documentElement) === "parsererror" ||
      nodes(doc, "parsererror").length
    )
      throw new Error("Malformed XML");
    return doc;
  } catch {
    throw new ReaderError("invalidBook");
  }
}

function normalizeEntryPath(base, href) {
  let decoded;
  try {
    decoded = decodeURIComponent(href);
  } catch {
    throw new ReaderError("invalidBook");
  }
  if (
    /^[a-z][a-z0-9+.-]*:/iu.test(decoded) ||
    decoded.startsWith("/") ||
    decoded.includes("\\")
  )
    throw new ReaderError("invalidBook");
  const stack = base ? base.split("/").filter(Boolean) : [];
  for (const part of decoded.split("/").filter(Boolean)) {
    if (part === ".") continue;
    if (part === "..") {
      if (!stack.length) throw new ReaderError("invalidBook");
      stack.pop();
    } else {
      stack.push(part);
    }
  }
  return stack.join("/");
}

function resolveHref(base, href) {
  const [pathname, fragment = ""] = href.split("#", 2);
  const [resource] = pathname.split("?", 1);
  let decodedFragment;
  try {
    decodedFragment = fragment ? decodeURIComponent(fragment) : "";
  } catch {
    throw new ReaderError("invalidBook");
  }
  return {
    path: normalizeEntryPath(base, resource),
    fragment: decodedFragment,
  };
}

function childElements(node, name) {
  return Array.from(node?.childNodes || []).filter(
    (child) => child.nodeType === 1 && (!name || localName(child) === name),
  );
}

function textOf(node) {
  if (!node) return "";
  if (node.nodeType === 3 || node.nodeType === 4) return node.nodeValue || "";
  if (node.nodeType !== 1 && node.nodeType !== 9) return "";
  if (OMIT.has(localName(node))) return "";
  if (node.nodeType === 1 && localName(node) === "br") return " ";
  return Array.from(node.childNodes || [])
    .map(textOf)
    .join("");
}

function collectBlocks(body) {
  const found = [];
  const visit = (node) => {
    if (node.nodeType !== 1 || OMIT.has(localName(node))) return;
    const name = localName(node);
    if (BLOCKS.has(name)) {
      const text = clean(textOf(node));
      if (text) found.push({ node, name, text });
      return;
    }
    for (const child of childElements(node)) visit(child);
  };
  for (const child of childElements(body)) visit(child);
  if (!found.length) {
    const text = clean(textOf(body));
    if (text) found.push({ node: body, name: "body", text });
  }
  return found;
}

function anchorFor(node, stopAt) {
  for (
    let current = node;
    current && current !== stopAt;
    current = current.parentNode
  ) {
    const id = current.nodeType === 1 ? current.getAttribute("id") : "";
    if (id) return id;
  }
  return "";
}

function semanticRole(node) {
  for (
    let current = node;
    current?.nodeType === 1;
    current = current.parentNode
  ) {
    const values = [
      current.getAttribute("epub:type"),
      current.getAttribute("role"),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (
      /frontmatter|preface|foreword|dedication|titlepage|copyright-page|doc-preface|doc-foreword/u.test(
        values,
      )
    )
      return "front_matter";
    if (
      /backmatter|endnotes|bibliography|appendix|doc-endnotes|doc-bibliography/u.test(
        values,
      )
    )
      return "back_matter";
    if (/bodymatter|chapter|doc-chapter/u.test(values)) return "chapter";
  }
  return "";
}

function entrySizes(zip) {
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  if (entries.length > MAX_ENTRIES) throw new ReaderError("zipLimit");
  let total = 0;
  for (const entry of entries) {
    const size = Number(entry._data?.uncompressedSize || 0);
    if (size > MAX_ENTRY_BYTES) throw new ReaderError("zipLimit");
    total += size;
    if (total > MAX_EXPANDED_BYTES) throw new ReaderError("zipLimit");
  }
  return entries;
}

async function entryText(zip, path) {
  const entry = zip.file(path);
  if (!entry) throw new ReaderError("invalidBook");
  return entry.async("string");
}

function navForEpub(zip, manifest, packagePath) {
  const navigation = new Map();
  const packageDir = packagePath.split("/").slice(0, -1).join("/");
  const navItems = Object.values(manifest).filter(
    (item) =>
      item.properties?.split(/\s+/u).includes("nav") ||
      item.mediaType === "application/x-dtbncx+xml",
  );
  return Promise.all(
    navItems.map(async (item) => {
      const navPath = normalizeEntryPath(packageDir, item.href);
      const source = await entryText(zip, navPath);
      const doc = xml(source);
      if (item.properties?.split(/\s+/u).includes("nav")) {
        const navs = nodes(doc, "nav");
        const toc =
          navs.find((node) =>
            /(?:^|\s)(?:toc|doc-toc)(?:\s|$)/iu.test(
              `${node.getAttribute("epub:type")} ${node.getAttribute("role")}`,
            ),
          ) || navs[0];
        for (const link of nodes(toc || doc, "a")) {
          const href = link.getAttribute("href");
          if (!href) continue;
          const target = resolveHref(
            navPath.split("/").slice(0, -1).join("/"),
            href,
          );
          navigation.set(
            `${target.path}#${target.fragment}`,
            clean(textOf(link)),
          );
        }
      } else {
        for (const point of nodes(doc, "navpoint")) {
          const content = nodes(point, "content")[0];
          const label = nodes(point, "text")[0];
          const href = content?.getAttribute("src");
          if (!href || !label) continue;
          const target = resolveHref(
            navPath.split("/").slice(0, -1).join("/"),
            href,
          );
          const key = `${target.path}#${target.fragment}`;
          if (!navigation.has(key)) navigation.set(key, clean(textOf(label)));
        }
      }
    }),
  ).then(() => navigation);
}

function assetMime(path, declared) {
  if (declared && /^[\w.+-]+\/[\w.+-]+$/u.test(declared)) return declared;
  const extension = path.split(".").pop()?.toLowerCase();
  return (
    {
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      gif: "image/gif",
      svg: "image/svg+xml",
      webp: "image/webp",
    }[extension] || "application/octet-stream"
  );
}

async function parseEpub(file, language, progress) {
  let zip;
  try {
    zip = await JSZip.loadAsync(file, {
      checkCRC32: false,
      createFolders: false,
    });
  } catch {
    throw new ReaderError("encryptedOrInvalid");
  }
  const entries = entrySizes(zip);
  const encryption = zip.file("META-INF/encryption.xml");
  if (encryption) {
    const source = await encryption.async("string");
    if (/<(?:\w+:)?EncryptedData\b/iu.test(source))
      throw new ReaderError("encryptedBook");
  }
  const container = xml(await entryText(zip, "META-INF/container.xml"));
  const rootfile = firstNode(container, "rootfile");
  const packagePath = rootfile?.getAttribute("full-path");
  if (!packagePath) throw new ReaderError("invalidBook");
  const safePackagePath = normalizeEntryPath("", packagePath);
  const packageDoc = xml(await entryText(zip, safePackagePath));
  const metadata = firstNode(packageDoc, "metadata");
  const metadataValue = (name, fallback) => {
    const node = nodes(metadata || packageDoc, name)[0];
    return clean(textOf(node)) || fallback;
  };
  const manifest = {};
  for (const item of nodes(packageDoc, "item")) {
    const id = item.getAttribute("id");
    if (!id) continue;
    manifest[id] = {
      href: item.getAttribute("href"),
      mediaType: item.getAttribute("media-type"),
      properties: item.getAttribute("properties") || "",
    };
  }
  const packageDir = safePackagePath.split("/").slice(0, -1).join("/");
  const navigation = await navForEpub(zip, manifest, safePackagePath);
  const spine = firstNode(packageDoc, "spine");
  const spineItems = childElements(spine, "itemref");
  if (!spineItems.length) throw new ReaderError("invalidBook");
  const chapters = [];
  let index = 0;
  let extractedChars = 0;
  for (const itemref of spineItems) {
    if (itemref.getAttribute("linear") === "no") continue;
    const manifestItem = manifest[itemref.getAttribute("idref")];
    if (!manifestItem || manifestItem.properties.split(/\s+/u).includes("nav"))
      continue;
    if (
      !/^(?:application\/xhtml\+xml|text\/html)$/iu.test(manifestItem.mediaType)
    )
      continue;
    const resource = normalizeEntryPath(packageDir, manifestItem.href);
    const doc = xml(await entryText(zip, resource));
    const body = firstNode(doc, "body") || doc.documentElement;
    const bodyNav = navigation.get(`${resource}#`);
    const bodyTitle = bodyNav || clean(textOf(firstNode(doc, "title"))) || "";
    const role = semanticRole(body);
    let current = {
      title: bodyTitle,
      source: resource,
      evidence: bodyNav ? "navigation" : "spine",
      role,
      sentences: [],
    };
    let prose = [];
    const flush = () => {
      const text = clean(prose.join(" "));
      if (text) current.sentences.push(text);
      prose = [];
      if (current.sentences.length) chapters.push(current);
      current = {
        title: "",
        source: resource,
        evidence: "spine",
        role,
        sentences: [],
      };
    };
    for (const block of collectBlocks(body)) {
      extractedChars += block.text.length;
      if (extractedChars > MAX_TEXT_CHARS)
        throw new ReaderError("epubTextLimit");
      const anchor = anchorFor(block.node, body);
      const label = anchor ? navigation.get(`${resource}#${anchor}`) : "";
      const heading = /^h[1-4]$/u.test(block.name);
      const blockRole = semanticRole(block.node) || role;
      const hasSectionContent = Boolean(
        prose.length || current.sentences.length,
      );
      if (!hasSectionContent && blockRole) current.role = blockRole;
      if (
        label ||
        heading ||
        (blockRole && hasSectionContent && blockRole !== current.role)
      ) {
        if (prose.length || current.sentences.length) flush();
        current = {
          title: label || (heading ? block.text : ""),
          source: resource + (anchor ? `#${anchor}` : ""),
          evidence: label ? "navigation" : heading ? "heading" : "spine",
          role: blockRole,
          sentences: [],
        };
      } else {
        prose.push(block.text);
      }
    }
    const lastText = clean(prose.join(" "));
    if (lastText) current.sentences.push(lastText);
    if (current.sentences.length) chapters.push(current);
    index++;
    progress({ stage: "reading", current: index, total: spineItems.length });
  }
  if (!chapters.length) throw new ReaderError("noReadableText");

  const languageDetection = detectLanguage(
    chapters.map((chapter) => chapter.sentences.join(" ")),
    metadataValue("language", ""),
    language,
  );
  for (const chapter of chapters)
    chapter.sentences = splitSentences(
      chapter.sentences.join(" "),
      languageDetection.language,
    );

  let cover = null;
  const coverMeta = nodes(metadata || packageDoc, "meta").find(
    (node) => node.getAttribute("name")?.toLowerCase() === "cover",
  );
  let coverId = coverMeta?.getAttribute("content") || "";
  let coverItem = Object.values(manifest).find((item) =>
    item.properties.split(/\s+/u).includes("cover-image"),
  );
  if (coverId && manifest[coverId]) coverItem = manifest[coverId];
  if (coverItem?.href) {
    const coverPath = normalizeEntryPath(packageDir, coverItem.href);
    const item = zip.file(coverPath);
    if (item && item._data?.uncompressedSize <= MAX_ENTRY_BYTES) {
      const bytes = await item.async("uint8array");
      cover = new Blob([bytes], {
        type: assetMime(coverPath, coverItem.mediaType),
      });
    }
  }
  return {
    title: metadataValue("title", file.name.replace(/\.epub$/iu, "")),
    author: metadataValue("creator", ""),
    language: languageDetection.language,
    languageDetection,
    format: "epub",
    chapters,
    cover,
    warnings: [],
    sourceSize: file.size,
    archiveEntries: entries.length,
  };
}

function lineGroups(items) {
  const lines = [];
  const sorted = items
    .filter((item) => item.str && item.str.trim())
    .map((item) => ({
      text: item.str,
      y: Number(item.transform?.[5] || 0),
      x: Number(item.transform?.[4] || 0),
      height: Math.abs(Number(item.height || item.transform?.[3] || 0)),
      hasEOL: Boolean(item.hasEOL),
    }))
    .sort((a, b) => b.y - a.y || a.x - b.x);
  for (const item of sorted) {
    const last = lines.at(-1);
    let line = last && Math.abs(last.y - item.y) < 3 ? last : null;
    if (!line) {
      line = { y: item.y, parts: [], height: 0 };
      lines.push(line);
    }
    line.parts.push(item.text);
    line.height = Math.max(line.height, item.height);
  }
  return lines
    .map((line) => ({
      text: clean(line.parts.join(" ")),
      y: line.y,
      height: line.height,
    }))
    .filter((line) => line.text)
    .sort((a, b) => b.y - a.y);
}

function normalizedMargin(line) {
  return clean(line)
    .toLocaleLowerCase()
    .replace(/\d+/gu, "#")
    .replace(/\s+/gu, " ");
}

function headingCandidate(line, medianHeight) {
  const text = clean(line.text);
  if (!text || text.length > 100 || /[.!?]$/u.test(text)) return false;
  if (
    /^(?:chapter|cap[ií]tulo)\s+(?:\d+|[ivxlcdm]+|one|two|three|uno|dos|tres)\b/iu.test(
      text,
    )
  )
    return true;
  return (
    medianHeight > 0 &&
    line.height >= medianHeight * 1.45 &&
    /\p{L}/u.test(text) &&
    line.y > 40
  );
}

async function pdfWorkerLibrary() {
  const [pdfjs, worker] = await Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  // pdf.js normally expects a Window as its host. Supplying an explicit nested
  // worker port avoids its Window-only URL check and the fake-worker fallback
  // (whose protocol messages would otherwise reach our parsing worker's parent).
  const port = new Worker(new URL(worker.default, self.location.origin), {
    type: "module",
  });
  return {
    ...pdfjs,
    localWorker: new pdfjs.PDFWorker({ port }),
    localPort: port,
  };
}

function flattenOutline(items, output = []) {
  for (const item of items || []) {
    if (Array.isArray(item)) flattenOutline(item, output);
    else {
      output.push(item);
      if (item.items?.length) flattenOutline(item.items, output);
    }
  }
  return output;
}

async function parsePdf(
  file,
  language,
  progress,
  loader = pdfWorkerLibrary,
  options = {},
) {
  let pdfjs;
  try {
    pdfjs = await loader();
  } catch (error) {
    console.warn("PDF module load failed:", error.message);
    throw new ReaderError("pdfUnavailable");
  }
  const task = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    isEvalSupported: false,
    useWorkerFetch: false,
    CanvasFactory:
      typeof OffscreenCanvas !== "undefined"
        ? class {
            create(width, height) {
              const canvas = new OffscreenCanvas(width, height);
              return { canvas, context: canvas.getContext("2d") };
            }
            reset(target, width, height) {
              target.canvas.width = width;
              target.canvas.height = height;
            }
            destroy(target) {
              target.canvas.width = 0;
              target.canvas.height = 0;
              target.canvas = null;
              target.context = null;
            }
          }
        : undefined,
    worker: pdfjs.localWorker,
  });
  let pdf;
  try {
    pdf = await task.promise;
  } catch (error) {
    await task.destroy().catch(() => {});
    pdfjs.localWorker?.destroy();
    pdfjs.localPort?.terminate();
    if (error?.name === "PasswordException")
      throw new ReaderError("encryptedBook");
    throw new ReaderError("invalidBook");
  }
  let closed = false;
  let ocr;
  const close = async () => {
    if (closed) return;
    closed = true;
    await ocr?.dispose();
    try {
      await task.destroy();
    } catch {
      // The PDF is already released or its worker has stopped.
    } finally {
      pdfjs.localWorker?.destroy();
      pdfjs.localPort?.terminate();
    }
  };
  try {
    if (pdf.numPages > MAX_PDF_PAGES) {
      await close();
      throw new ReaderError("pdfPageLimit");
    }
    const pageData = [];
    let charCount = 0;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      let lines = lineGroups(content.items);
      let scanned = !lines.some((l) => /\p{L}/u.test(l.text));
      if (scanned && page.getOperatorList && pdfjs.OPS) {
        const operations = await page.getOperatorList();
        scanned = operations.fnArray.some((fn) =>
          [
            pdfjs.OPS.paintImageXObject,
            pdfjs.OPS.paintInlineImageXObject,
            pdfjs.OPS.paintImageMaskXObject,
          ].includes(fn),
        );
      }
      if (scanned) {
        if (!options.ocr) throw new ReaderError("ocrRequired");
        ocr ||= await (
          options.ocrFactory || (await import("../offline/ocr")).createOCR
        )((value) =>
          progress({ ...value, current: pageNumber, total: pdf.numPages }),
        );
        lines = await ocr.read(page);
      }
      charCount += lines.reduce((sum, line) => sum + line.text.length, 0);
      if (charCount > MAX_TEXT_CHARS) {
        await close();
        throw new ReaderError("pdfTextLimit");
      }
      pageData.push({
        page: pageNumber,
        lines,
        warnings: scanned ? ["ocr_inferred_text"] : [],
      });
      progress({ stage: "reading", current: pageNumber, total: pdf.numPages });
    }
    if (charCount === 0) {
      await close();
      throw new ReaderError("scannedPdf");
    }

    let info = {};
    try {
      info = (await pdf.getMetadata())?.info || {};
    } catch {
      // Optional metadata never prevents reading the text layer.
    }
    const languageDetection = detectLanguage(
      pageData.map((page) => page.lines.map((line) => line.text).join(" ")),
      info.Language || info.Lang || "",
      language,
    );
    language = languageDetection.language;

    const topCounts = new Map();
    const bottomCounts = new Map();
    for (const page of pageData) {
      const lines = page.lines;
      if (lines.length > 2) {
        for (const [line, counts] of [
          [lines[0], topCounts],
          [lines.at(-1), bottomCounts],
        ]) {
          if (line.text.length <= 80) {
            const key = normalizedMargin(line.text);
            counts.set(key, (counts.get(key) || 0) + 1);
          }
        }
      }
    }
    const threshold = Math.max(3, Math.ceil(pageData.length * 0.6));
    const repeated = new Set(
      [...topCounts, ...bottomCounts]
        .filter(([, count]) => count >= threshold)
        .map(([line]) => line),
    );
    for (const page of pageData) {
      const lines = page.lines;
      if (lines.length > 2) {
        while (
          lines.length > 2 &&
          repeated.has(normalizedMargin(lines[0].text))
        ) {
          page.warnings.push(lines.shift().text);
        }
        while (
          lines.length > 2 &&
          repeated.has(normalizedMargin(lines.at(-1).text))
        ) {
          page.warnings.push(lines.pop().text);
        }
      }
      if (
        lines.length &&
        /^(?:page\s+)?(?:\d+|[ivxlcdm]+)$/iu.test(lines[0].text)
      ) {
        page.warnings.push(lines.shift().text);
      }
      if (
        lines.length &&
        /^(?:page\s+)?(?:\d+|[ivxlcdm]+)$/iu.test(lines.at(-1).text)
      ) {
        page.warnings.push(lines.pop().text);
      }
    }

    const outlineStarts = new Map();
    try {
      const outline = await pdf.getOutline();
      for (const item of flattenOutline(outline)) {
        let destination = item.dest;
        if (typeof destination === "string")
          destination = await pdf.getDestination(destination);
        if (!Array.isArray(destination) || !destination[0]) continue;
        const page = (await pdf.getPageIndex(destination[0])) + 1;
        if (page >= 1 && page <= pdf.numPages && !outlineStarts.has(page))
          outlineStarts.set(page, clean(item.title));
      }
    } catch {
      // A broken optional outline must not prevent extracting the text layer.
    }

    const outlinePages = [...outlineStarts.keys()].sort((a, b) => a - b);
    const heights = pageData
      .flatMap((page) => page.lines.map((line) => line.height))
      .filter(Boolean)
      .sort((a, b) => a - b);
    const medianHeight = heights.length
      ? heights[Math.floor(heights.length / 2)]
      : 0;
    const headings = new Map();
    if (!outlinePages.length) {
      for (const page of pageData) {
        for (const [lineIndex, line] of page.lines.entries()) {
          if (headingCandidate(line, medianHeight)) {
            headings.set(`${page.page}:${lineIndex}`, line.text);
          }
        }
      }
    }

    const chapters = [];
    let current = {
      title: "",
      source: "page:1",
      evidence: "page-fallback",
      role: "",
      sentences: [],
      warnings: [],
    };
    let prose = [];
    const flush = () => {
      const text = clean(
        prose.reduce(
          (joined, line) =>
            /\p{L}-$/u.test(joined) && /^\p{Ll}/u.test(line)
              ? joined.slice(0, -1) + line
              : joined + " " + line,
          "",
        ),
      );
      if (text) current.sentences.push(...splitSentences(text, language));
      prose = [];
      if (current.sentences.length) chapters.push(current);
    };
    for (const page of pageData) {
      const outlineTitle = outlineStarts.get(page.page);
      if (outlineTitle) {
        flush();
        current = {
          title: outlineTitle,
          source: `page:${page.page}`,
          evidence: "outline",
          role: "",
          sentences: [],
          warnings: [],
        };
      }
      for (const [lineIndex, line] of page.lines.entries()) {
        const heading = headings.get(`${page.page}:${lineIndex}`);
        if (
          outlineTitle &&
          normalizedMargin(line.text) === normalizedMargin(outlineTitle)
        )
          continue;
        if (heading) {
          if (prose.length || current.sentences.length) flush();
          current = {
            title: heading,
            source: `page:${page.page}`,
            evidence: "heading",
            role: "",
            sentences: [],
            warnings: [],
          };
        } else {
          prose.push(line.text);
        }
      }
      current.warnings.push(...page.warnings);
    }
    flush();
    if (!chapters.length) throw new ReaderError("noReadableText");
    const book = {
      title: clean(info.Title) || file.name.replace(/\.pdf$/iu, ""),
      author: clean(info.Author),
      language,
      languageDetection,
      format: "pdf",
      chapters,
      warnings: pageData.flatMap((page) =>
        page.warnings.map((text) => ({ page: page.page, text })),
      ),
      sourceSize: file.size,
    };
    await close();
    return book;
  } catch (error) {
    await close();
    throw error;
  }
}

export async function parseBookFile(
  file,
  language = "auto",
  progress = () => {},
  { pdfLoader = pdfWorkerLibrary, ...options } = {},
) {
  if (!file || !/\.(pdf|epub)$/iu.test(file.name || ""))
    throw new ReaderError("unsupportedFile");
  if (file.size > MAX_FILE_BYTES) throw new ReaderError("fileTooLarge");
  const lang = language;
  progress({ stage: "reading", current: 0, total: 1 });
  if (/\.epub$/iu.test(file.name)) {
    const book = await parseEpub(file, lang, progress);
    progress({ stage: "structuring", current: 0, total: 1 });
    return book;
  }
  const header = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  if (new TextDecoder().decode(header) !== "%PDF-")
    throw new ReaderError("invalidBook");
  const book = await parsePdf(file, lang, progress, pdfLoader, options);
  progress({ stage: "structuring", current: 0, total: 1 });
  return book;
}
