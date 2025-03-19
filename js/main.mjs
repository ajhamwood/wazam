import $ from "./machine.mjs"
import { simList } from "./simlist.mjs"

const sims = {};
([
  sims.fact,
  sims.mem,
  sims.sat,
  sims.sext,
  sims.bulk,
  sims.bulk_table,
  sims.multi_val,
  sims.atomics
] = simList);
self.app = new $.Machine({ inView: 0, simList });



navigator.serviceWorker?.register(import.meta.resolve("../coop-coep.js"))
  .then(reg => {
    console.log("COOP/COEP Service Worker is registered for:", reg.scope);
    if (reg.active && !navigator.serviceWorker.controller) window.location.reload()
  })
  .catch(err => console.log("COOP/COEP Service Worker failed to register with error:", err));



$.targets({
  load () { app.emit("init") },
  scroll () { app.inView = Math.floor(window.scrollY / window.innerHeight) },
  app: {
    init () {}
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
    $.queries({
      ".run-wasm": { click () { sim.play() } },
      ".reset-wasm": { click () { sim.reset() } }
    }, this.shadowRoot)
  }
})