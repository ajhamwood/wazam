import $ from "./machine.mjs";
import "../wasm-sim/wc.mjs";
import { WasmSim } from "./sim.mjs";
import { parseCode } from "../src/wasm.mjs";

self.app = new $.Machine({ simEl: $("wasm-sim") });
$.targets({
  app: {
    updateSim () {
      const { simEl } = this;
      simEl.init(new WasmSim({
        module: parseCode(""),
        async runner () {}
      }));
      $.targets({
        input (e) {
          const { console, printBuf, code } = simEl.sim;
          console.clear();
          console.log("Updated sim:");
          console.log(printBuf)
          console.log(simEl.editTextElement.value)
        }
      }, simEl)
    }
  }
});

$.pipe("wc-loaded").then(() => app.emit("updateSim"));