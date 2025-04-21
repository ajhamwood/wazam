import { Emitter, printCode } from "../src/wasm.mjs";

class WasmSim {

  #name; #module; #importsObj; #compileOpts; #runner; #teardown
  makeInstance; makeModule; #code_pretty; #buffer; #log = []; #component; #sec_lengths
  constructor ({ module, importsObj = {}, compileOpts, runner, teardown }) {
    this.#module = module;
    this.#importsObj = importsObj;
    this.#compileOpts = compileOpts;
    this.#runner = runner?.bind(this);
    this.#teardown = teardown?.bind(this);

    this.#init()
  }

  #init () {
    const mod = this.#module;
    // TODO print entire module
    this.#code_pretty = "";
    this.#sec_lengths = mod.v.map(s => s.z);
    printCode([mod], s => this.#code_pretty += s);

    const emitbuf = new Emitter(new ArrayBuffer(mod.z));
    mod.emit(emitbuf);
    this.#buffer = emitbuf.buffer;
    this.makeInstance = () => WebAssembly.instantiate(emitbuf.buffer, this.#importsObj, this.#compileOpts);
    this.makeModule = () => WebAssembly.compile(emitbuf.buffer, this.#compileOpts)
  }

  get name () { return this.#name }
  set name (str) { this.#name = str }
  get component () { return this.#component }
  set component (_) {}
  get code () { return this.#code_pretty }
  set code (_) {}
  get printBuf () { return Array.from(new Uint8Array(this.#buffer))
    .map((byte, i) => byte.toString(16).padStart(2, "0") + ((i + 1) % 8 ? "" : "\n"))
    .join(" ").trim() }
  set printBuf (_) {}
  get imports () { return this.#importsObj }
  set imports (_) {}
  get raw () { return new Uint8Array(this.#buffer) }
  set raw (_) {}
  get sectionLengths () { return this.#sec_lengths.slice() }
  set sectionLengths (_) {}

  findImport (im) {
    for (const [module, mObj] of Object.entries(this.#importsObj))
      for (const [field, fVal] of Object.entries(mObj))
        if (fVal === im) return module + "." + field
  }

  connect (el) { this.#component = el }

  console = (() => {
    const self = this;
    return {
      log (...params) {
        self.#log.push({ logLevel: 2, params });
        self.#component.consoleElement.innerText += params.map(JSON.stringify).join(" ") + "\n";
        self.#component.consoleElement.scrollTo(0, 32768);
        console.log("@sim", self.#name, "—", ...params)
      },
      clear () {
        self.#log = ["Console was cleared."];
        self.#component.consoleElement.innerText = self.#log[0] + "\n";
        console.clear()
      },
      error (tag, e, arity, ...args) {
        if (tag === undefined) {
          const unknErr = "WASM: unknown error";
          self.#component.consoleElement.innerText += JSON.stringify(unknErr) + "\n";
          self.#component.consoleElement.scrollTo(0, 32768);
          console.error(unknErr)
        } else {
          const exnArgs = [];
          for (let i = 0; i < arity; i++) exnArgs.push(e.getArg(tag, i));
          self.#log.push({ logLevel: 4, params: [ e, ...exnArgs ] });
          const displayedErr = [ "WASM: user defined exception", self.findImport(tag), ...args, ":", ...exnArgs ];
          self.#component.consoleElement.innerText += displayedErr.map(JSON.stringify).join(" ") + "\n";
          self.#component.consoleElement.scrollTo(0, 32768);
          console.error(...displayedErr)
        }
      }
    }
  })()

  play () { this.#runner?.(this.#module, this.#importsObj, this.#compileOpts) }
  reset () {
    this.#teardown?.();
    this.console.clear()
  }

}



class Concurrent {

  #workers = new Map(); #freeWorkers; #fp
  constructor (fp, count) {
    this.#fp = fp;
    this.#freeWorkers = Array(count).fill(0).map((_, i) => i)
  }

  async runOverAll (fn) {
    while (this.#freeWorkers.length) await this.allocateOne(fn);
  }
  async allocateOne (fn) {
    const wid = this.#freeWorkers.shift();
    if (!~wid) return;
    this.#workers.set(wid, new Worker(this.#fp));
    return await fn(this.#workers.get(wid), wid)
  }

  async closeAll () { for (const wid of this.#workers.keys()) this.deallocate(wid) }
  async deallocate (wid) {
    this.#workers.get(wid).terminate();
    this.#freeWorkers.push(wid)
  }

}

export { WasmSim, Concurrent }