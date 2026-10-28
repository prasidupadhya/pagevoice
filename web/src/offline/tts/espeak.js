// eSpeak NG, as built for Piper (piper-phonemize), with every language's data.
// Piper reads its phoneme ids; Kokoro's Spanish voices read its phonemes. The
// files come from a pinned npm package and are served by this site.
let ready;
export function espeak() {
  ready ||= (async () => {
    const base = new URL("/runtime/piper/", self.location.origin).href;
    const { default: create } = await import(
      /* @vite-ignore */ `${base}piper_phonemize.js`
    );
    let lines = [];
    const module = await create({
      noInitialRun: true,
      locateFile: (file) => `${base}${file}`,
      print: (line) => lines.push(JSON.parse(line)),
      printErr: () => {},
    });
    // One line per sentence: { phonemes: [...], phoneme_ids: [...] }.
    return (text, voice) => {
      lines = [];
      module.callMain([
        "-l",
        voice,
        "--input",
        JSON.stringify([{ text }]),
        "--espeak_data",
        "/espeak-ng-data",
      ]);
      return lines;
    };
  })().catch((error) => {
    ready = undefined;
    throw error;
  });
  return ready;
}
