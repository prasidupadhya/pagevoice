import { guardInferenceFetch } from "./assets";
import { hashText } from "./library";
guardInferenceFetch();
const loaded = {};
async function pipelineFor(kind) {
  const { pipeline, env } = await import("@huggingface/transformers");
  env.allowLocalModels = false;
  env.useBrowserCache = false;
  env.backends.onnx.wasm.numThreads = 1;
  env.backends.onnx.wasm.proxy = false;
  env.backends.onnx.wasm.wasmPaths = "/runtime/transformers/";
  if (!loaded[kind])
    loaded[kind] = await pipeline(
      kind === "embeddings" ? "feature-extraction" : "token-classification",
      kind === "embeddings"
        ? "Xenova/paraphrase-multilingual-MiniLM-L12-v2"
        : "Xenova/bert-base-multilingual-cased-ner-hrl",
      { dtype: "q8", device: "wasm" },
    );
  return loaded[kind];
}
let pending = Promise.resolve();
self.onmessage = ({ data }) => {
  pending = pending.then(() => process(data));
};
async function process({ id, kind, book, query }) {
  try {
    const model = await pipelineFor(kind);
    if (query !== undefined) {
      const v = await model(query.slice(0, 500), {
        pooling: "mean",
        normalize: true,
      });
      self.postMessage({ id, result: Array.from(v.data) });
      return;
    }
    const records = [],
      entities = [];
    let count = 0;
    const total = book.chapters.reduce(
      (n, c) => n + Math.ceil(c.sentences.length / 3),
      0,
    );
    if (total > 12000) throw Error("analysisLimit");
    for (const [chapter, c] of book.chapters.entries()) {
      for (let sentence = 0; sentence < c.sentences.length; sentence += 3) {
        const text = c.sentences
          .slice(sentence, sentence + 3)
          .join(" ")
          .slice(0, 1800);
        if (kind === "embeddings") {
          const signature = await hashText(text);
          const previous = book.semantics?.records.find(
            (r) => r.signature === signature,
          );
          const vector =
            previous?.vector ||
            Array.from(
              (await model(text, { pooling: "mean", normalize: true })).data,
            );
          records.push({ chapter, sentence, signature, vector });
        } else {
          const tokens = await model(text, { ignore_labels: ["O"] });
          let current;
          for (const token of tokens) {
            const label = token.entity?.replace(/^[BI]-/u, "");
            if (label !== "PER") {
              current = null;
              continue;
            }
            const word = token.word.replace(/^##/u, "");
            if (token.entity.startsWith("B-") || !current) {
              current = {
                name: word,
                label,
                chapter,
                sentence,
                score: token.score,
              };
              entities.push(current);
            } else
              current.name += (token.word.startsWith("##") ? "" : " ") + word;
          }
        }
        self.postMessage({ id, progress: { current: ++count, total } });
      }
    }
    self.postMessage({
      id,
      result:
        kind === "embeddings"
          ? { records, version: 1, model: "multilingual-MiniLM-L12-v2-q8" }
          : entities,
    });
  } catch (error) {
    self.postMessage({ id, error: error.message });
  }
}
