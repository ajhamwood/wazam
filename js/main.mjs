import $ from "./machine.mjs"
import { simList } from "./simlist.mjs"

const sims = {};
([
  sims.fact,
  sims.sat,
  sims.sext,
  sims.bulk,
  sims.bulk_table,
  sims.multi_val,
  sims.atomics,
  sims.simd,
  sims.exn_legacy,
  sims.ext_const,
  sims.func_refs,
  sims.gc_tailcall,
  sims.multi_mem,
  sims.exn,
  sims.str_builtins
] = simList);
self.app = new $.Machine({ inView: 0, simList, viewportHeight: null });



navigator.serviceWorker?.register(import.meta.resolve("../coop-coep.js"))
  .then(reg => {
    console.log("COOP/COEP Service Worker is registered for:", reg.scope);
    if (reg.active && !navigator.serviceWorker.controller) window.location.reload()
  })
  .catch(err => console.log("COOP/COEP Service Worker failed to register with error:", err));



$.targets({
  "load resize" () { app.emit("resize") },
  scroll () { app.inView = Math.floor(window.scrollY / app.viewportHeight) },
  app: {
    resize () { this.viewportHeight = document.body.scrollHeight / (simList.length + .5) }
  }
});



$.queries({
  "#first": { click () { simList[0].component.scrollIntoView() } },
  "#prev": { click () { simList[Math.max(0, app.inView - 1)].component.scrollIntoView() } },
  "#next": { click () { simList[Math.min(simList.length - 1, app.inView + 1)].component.scrollIntoView() } },
  "#last": { click () { simList.at(-1).component.scrollIntoView() } }
});



$.loadWc("wasm-sim", {
  sim: null,
  
  constructor () {
    const sim =  this.sim = sims[this.id];
    sim.name = this.id;
    sim.connect(this);
    const [ titleElement, copyElement, textReprElement, bufferReprElement, consoleElement, controlsElement ] = $.all("article > *", this.shadowRoot);
    Object.assign(this, { titleElement, copyElement, textReprElement, bufferReprElement, consoleElement, controlsElement });
    textReprElement.innerText = sim.code;
    bufferReprElement.innerText = sim.printBuf;
    this.makeSections(bufferReprElement);
    $.all("br", bufferReprElement).forEach(br => br.parentElement.insertBefore(document.createElement("label"), br));
    bufferReprElement.append(document.createElement("label"));
    $.queries({
      ".run-wasm": { click () { sim.play() } },
      ".reset-wasm": { click () { sim.reset() } }
    }, this.shadowRoot)
  },

  makeSections (el) {
    const
      cuml = this.sim.sectionLengths.reduce((a, x) => a.concat([[ a.at(-1)[1] + 1, a.at(-1)[1] + x ]]), [[, -1]]).slice(1),
      textNodes = Array.from(el.childNodes).filter(n => n.nodeType === 3);
    for (const [a, f] of cuml.toReversed()) {
      const
        range = document.createRange(), span = document.createElement("span"),
        an = Math.floor(a / 8), ao = a % 8, fn = Math.floor(f / 8), fo = f % 8;
      range.setStart(textNodes[an], 3 * ao + (an !== 0));
      range.setEnd(textNodes[fn], 3 * fo + 2 + (fn !== 0));
      range.surroundContents(span)
    }
  }

})