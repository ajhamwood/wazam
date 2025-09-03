import $ from "./machine.mjs";
import "../wasm-sim/wc.mjs";
import { WasmSim } from "./sim.mjs";
import { parseCode } from "../src/wasm.mjs";

self.app = new $.Machine({ simEl: $("wasm-sim") });
let module;
$.targets({
  app: {
    async updateSim () {
      const { simEl } = this;
      // module = parseCode(simEl.editTextElement?.value ?? "");
      module = await parseCode("XYZ");
      simEl.init(new WasmSim({
        module,
        async runner () {}
      }))
    },
    simEl: {
      input () {
        const { sim } = this, { printBuf } = sim;
        sim.console.clear();
        sim.console.log("Updated sim:");
        sim.console.log(printBuf)
        sim.console.log(this.editTextElement.value);
        console.log(module)
      }
    }
  }
});

$.pipe("wc-loaded").then(() => app.emit("updateSim"));