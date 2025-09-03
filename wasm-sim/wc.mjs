import $ from "../js/machine.mjs";

$.pipe("wc-loaded", () => $.loadWc("wasm-sim", {
  sim: null, editable: false,
  
  constructor () {},

  init (sim) {
    const simEl = this;
    this.sim = sim;
    sim.name = this.id;
    sim.connect(this);
    const
      [ titleElement, copyElement, reprElement, consoleElement, controlsElement ] = $.all("article > *", this.shadowRoot),
      [ textReprElement, , bufferReprElement ] = reprElement.children,
      [ editTextElement, highlightTextElement ] = textReprElement.firstElementChild.children;
    Object.assign(this, { titleElement, copyElement, highlightTextElement, editTextElement, bufferReprElement, consoleElement, controlsElement });
    highlightTextElement.innerText = editTextElement.value = sim.code;
    bufferReprElement.innerText = sim.printBuf;
    this.makeSections(bufferReprElement);
    $.all("br", bufferReprElement).forEach(br => br.parentElement.insertBefore(document.createElement("label"), br));
    bufferReprElement.append(document.createElement("label"));
    $.queries({
      ".display-buffer": { click () { reprElement.classList.toggle("hide-buffer") } },
      ".run-wasm": { click () { sim.play() } },
      ".reset-wasm": { click () { sim.reset() } },
      ".editor": { input (e) {
        highlightTextElement.innerText = this.value;
        simEl.dispatchEvent(new Event(e))
      } }
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
  },

  attributeChangedCallback (name) {
    if (name === "editable") this.editable = true
  }

}, [ "editable" ], "wasm-sim/template.html"))