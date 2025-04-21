import $ from "./machine.mjs";
import "../wasm-sim/wc.mjs";
import { simList } from "./simlist.mjs";


const sims = {};
([
  sims.fact,
  sims.sat,
  sims.sext,
  sims.bulk,
  sims.bulk_table,
  sims.multi_val,
  sims.atomics,
  sims.simd_all,
  sims.exn_legacy,
  sims.ext_const,
  sims.func_refs,
  sims.gc_tailcall,
  sims.multi_mem64,
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


$.pipe("wc-loaded").then(() => $.all("wasm-sim").forEach(el=> el.init(sims[el.id])));


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
})