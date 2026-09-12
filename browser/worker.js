import { WASI, File, OpenFile, ConsoleStdout, PreopenDirectory } from './vendor/wasi/index.js';

let compiled;
const ready = (async () => {
  const response = await fetch('./sc-tools.wasm.gz');
  if (!response.ok) throw new Error('The WASM artifact is unavailable. Build it with wasm/build.sh first.');
  const buffer = await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  compiled = await WebAssembly.compile(buffer);
  self.postMessage({ type: 'ready', wasmBytes: buffer.byteLength, imports: WebAssembly.Module.imports(compiled) });
})();
ready.catch(error => self.postMessage({ type: 'load-error', error: error.message }));

self.onmessage = async ({ data }) => {
  const { id, amountLovelace, datum, redeemer } = data;
  try {
    await ready;
    const stdout = [], stderr = [];
    const wasi = new WASI(['sc-tools-browser', amountLovelace, datum, redeemer], [], [
      new OpenFile(new File(new Uint8Array())),
      ConsoleStdout.lineBuffered(line => stdout.push(line)),
      ConsoleStdout.lineBuffered(line => stderr.push(line)),
      new PreopenDirectory('/', new Map()),
    ], { debug: false });
    const started = performance.now();
    const instance = await WebAssembly.instantiate(compiled, { wasi_snapshot_preview1: wasi.wasiImport });
    const exitCode = wasi.start(instance);
    const output = stdout.findLast(line => line.startsWith('{'));
    if (!output || exitCode !== 0) throw new Error(stderr.join('\n') || `WASM exited with code ${exitCode}`);
    self.postMessage({ type: 'result', id, result: { ...JSON.parse(output), elapsedMs: performance.now() - started }, stderr });
  } catch (error) {
    self.postMessage({ type: 'error', id, error: error.message });
  }
};
