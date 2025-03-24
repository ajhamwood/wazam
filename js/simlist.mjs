import { c, get, sect_id, Emitter, printCode } from "./wasm.mjs";



class WasmSim {

  #name; #module; #importsObj; #compileOpts; #runner; #teardown
  makeInstance; makeModule; #code_pretty; #buffer; #log = []; #component
  constructor ({ module, importsObj, compileOpts, runner, teardown }) {
    this.#module = module;
    this.#importsObj = importsObj;
    this.#compileOpts = compileOpts;
    this.#runner = runner?.bind(this);
    this.#teardown = teardown?.bind(this);

    this.#init()
  }

  #init () {
    const mod = this.#module, codeSection = get.section(mod, sect_id.code);
    // TODO print entire module
    this.#code_pretty = "";
    for (let funcBody of get.function_bodies(codeSection)) {
      if (this.#code_pretty) this.#code_pretty += "\n";
      printCode(funcBody.code, s => this.#code_pretty += s)
    }
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
  get printBuf () { return Array.from(new Uint8Array(this.#buffer)).map((byte, i) => byte.toString(16).padStart(2, "0") + ((i + 1) % 8 ? "" : "\n")).join(" ") }
  set printBuf (_) {}
  get imports () { return this.#importsObj }
  set imports (_) {}

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
        self.#log = [];
        self.#component.consoleElement.innerText = ""
      },
      error (tag, arity, e) {
        const exnArgs = [];
        for (let i = 0; i < arity; i++) exnArgs.push(e.getArg(tag, i));
        self.#log.push({ logLevel: 4, params: [ e, ...exnArgs ] });
        const displayedErr = [ "WASM: user defined exception", self.findImport(tag), ":", ...exnArgs ];
        self.#component.consoleElement.innerText += displayedErr.map(JSON.stringify).join(" ") + "\n";
        self.#component.consoleElement.scrollTo(0, 32768);
        console.error(...displayedErr)
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



const simList = (() => {

  const {
    uint8, uint32, biguint64, float32, float64, varuint1, varuint7, varuint32, varint7, varint32, varint64,
    vari8x16, vari16x8, vari32x4, vari64x2, varf32x4, varf64x2,
    func, void_, heap, ref, ref_null, external_kind, data, str, str_ascii, str_utf8, module,
    custom_section, type_section, import_section, function_section, table_section, memory_section,
    global_section, export_section, start_section, element_section, code_section, data_section, datacount_section, tag_section,
    function_import_entry, table_import_entry, memory_import_entry, global_import_entry, tag_import_entry, export_entry,
    active_elem_segment, passive_elem_segment, declarative_elem_segment, active_data_segment, passive_data_segment,
    comp_type, func_type, table_type, global_type, tag_type, resizable_limits, global_variable, init_expr, elem_expr_func, elem_expr_null, function_body, local_entry,
    unreachable, nop, block, void_block, loop, void_loop, if_, void_if, end, br, br_if, br_table,
    try_catch, catch_clause, try_delegate, throw_, rethrow, return_, return_void, return_multi, call, call_indirect, drop, select,
    get_local, set_local, tee_local, get_global, set_global,
    current_memory, grow_memory, init_memory, drop_data, copy_memory, fill_memory, init_table, drop_elem, copy_table, set_table, get_table,
    null_ref, is_null_ref, func_ref, eq_ref, as_non_null_ref, atomic_notify, atomic_wait32, atomic_wait64, atomic_fence,
    align8, align16, align32, align64, i32, i64, f32, f64, v128, i8x16, i16x8, i32x4, i64x2, f32x4, f64x2
  } = c;

  return [

    new WasmSim({
      module: module([
        type_section([
          comp_type(func, [ i32 ], [ i32 ])  // type index = 0
        ]),
        function_section([
          varuint32(0)  // function index = 0, using type index 0
        ]),
        export_section([
          // Export "fact" as function at index 0
          export_entry(str_utf8("fact"), external_kind.function, varuint32(0))
        ]),
        code_section([
          // Body of function at index 0
          function_body([ /* local variables */ ], [
            if_(i32,  // Result type of "if" expression
              i32.eq(get_local(i32, 0), i32.const(0)),  // Condition
              [ i32.const(1) ],  // Then
              [ i32.mul(  // Else
                get_local(i32, 0),
                call(i32, varuint32(0), [  // 0 is the function index
                  i32.sub(get_local(i32, 0), i32.const(1))
                ])
              ) ]
            )
          ])
        ])
      ]),
      async runner () {
        const { instance } = await this.makeInstance();
        this.console.log("Wasm factorial test:", instance.exports.fact(8));
      }
    }),

    new WasmSim({
      module: module([
        type_section([
          comp_type(func, [ i32, i32 ], [ i32 ])
        ]),
        import_section([
          memory_import_entry(
            str_utf8("js"),
            str_utf8("mem"),
            resizable_limits(1, 1)
          )
        ]),
        function_section([
          varuint32(0)
        ]),
        export_section([
          export_entry(str_utf8("store"), external_kind.function, varuint32(0))
        ]),
        code_section([
          function_body([], [
            if_(i32,
              i32.or(
                i32.lt_u(
                  i32.ctz(get_local(i32, 0)),
                  i32.const(2)
                ),
                i32.gt_u(
                  get_local(i32, 0),
                  i32.const(0xFFFC)
                ),
              ),
              [ i32.const(0) ],
              [
                i32.store(align32,
                  get_local(i32, 0),
                  get_local(i32, 1)
                ),
                i32.const(1)
              ]
            )
          ])
        ])
      ]),
      async runner () {
        const { instance } = await this.makeInstance();
        this.console.log("Wasm memory test:", instance.exports.store(0x4, 0xFFFFFFFF),
          Array.from(new Uint32Array(this.imports.js.mem.buffer.slice(0, 8))));
      },
      importsObj: { js: { mem: new WebAssembly.Memory({ initial: 1, maximum: 1 }) } }
    }),

    new WasmSim({
      module: module([
        type_section([
          comp_type(func, [ f32 ], [ i32 ])
        ]),
        function_section([
          varuint32(0)
        ]),
        export_section([
          export_entry(str_utf8("sat"), external_kind.function, varuint32(0))
        ]),
        code_section([
          function_body([], [
            i32.trunc_sat_f32_s(
              get_local(f32, 0)
            )
          ])
        ])
      ]),
      async runner () {
        const { instance } = await this.makeInstance();
        this.console.log("Wasm non-trapping num conversion test: NaN ->", instance.exports.sat(NaN));
      }
    }),

    new WasmSim({
      module: module([
        type_section([
          comp_type(func, [ i32 ], [ i32 ])
        ]),
        function_section([
          varuint32(0)
        ]),
        export_section([
          export_entry(str_utf8("sext"), external_kind.function, varuint32(0))
        ]),
        code_section([
          function_body([], [
            i32.extend8_s(
              get_local(i32, 0)
            )
          ])
        ])
      ]),
      async runner () {
        const { instance } = await this.makeInstance();
        this.console.log("Wasm sign extension test:", instance.exports.sext(130));
      }
    }),

    new WasmSim({
      module: module([
        type_section([
          comp_type(func, [ i32, i32, i32 ])
        ]),
        import_section([
          memory_import_entry(
            str_utf8("js"),
            str_utf8("mem"),
            resizable_limits(1, 1)
          )
        ]),
        function_section([
          varuint32(0)
        ]),
        export_section([
          export_entry(str_utf8("bulk"), external_kind.function, varuint32(0))
        ]),
        datacount_section(
          varuint32(1)
        ),
        code_section([
          function_body([], [
            init_memory(0,
              get_local(i32, 0),
              get_local(i32, 1),
              get_local(i32, 2)
            ),
            drop_data(0)
          ])
        ]),
        data_section([
          passive_data_segment(str_utf8("ABCDEFGH"))
        ])
      ]),
      async runner () {
        const { instance } = await this.makeInstance();
        this.console.log("Wasm bulk memory ops test:", instance.exports.bulk(8, 0, 0),
          Array.from(new Uint8Array(this.imports.js.mem.buffer.slice(0, 12))));
      },
      importsObj: { js: { mem: new WebAssembly.Memory({ initial: 1, maximum: 1 }) } }
    }),

    new WasmSim({
      module: module([
        type_section([
          comp_type(func, [ heap.Extern ]),
          comp_type(func, [ i32, heap.Extern ]),
          comp_type(func, [ i32 ]),
        ]),
        import_section([
          function_import_entry(
            str_utf8("js"),
            str_utf8("run"),
            varuint32(0)
          )
        ]),
        function_section([
          varuint32(1),
          varuint32(2)
        ]),
        table_section([
          table_type(heap.Extern, resizable_limits(1)),
        ]),
        export_section([
          export_entry(str_utf8("set_externref"), external_kind.function, varuint32(1)),
          export_entry(str_utf8("run_from_table"), external_kind.function, varuint32(2))
        ]),
        code_section([
          function_body([], [
            set_table(0, get_local(heap.Extern, 1), get_local(i32, 0))
          ]),
          function_body([], [
            call(void_, varuint32(0), [ get_table(0, get_local(i32, 0)) ])
          ]),
        ])
      ]),
      async runner () {
        const { instance } = await this.makeInstance(), self = this;
        this.console.log("Wasm bulk table ops test:",
          instance.exports.set_externref(0, function () { self.console.log('yo') }),
          instance.exports.run_from_table(0));
      },
      importsObj: { js: { run (fn) { fn?.() } } }
    }),

    new WasmSim({
      module: module([
        type_section([
          comp_type(func, [], [ i32, i32 ])
        ]),
        function_section([
          varuint32(0)
        ]),
        export_section([
          export_entry(str_utf8("multi_block"), external_kind.function, varuint32(0))
        ]),
        code_section([
          function_body([], [
            block(
              varuint32(0),
              [
                i32.const(2),
                i32.const(3)
              ]
            )
          ])
        ])
      ]),
      async runner () {
        const { instance } = await this.makeInstance();
        this.console.log("Wasm multi value test:", instance.exports.multi_block())
      }
    }),

    new WasmSim({
      module: module([
        type_section([
          comp_type(func, [ i32 ], []),
          comp_type(func, [], [ i32 ])
        ]),
        import_section([
          memory_import_entry(
            str_utf8("js"),
            str_utf8("mem"),
            resizable_limits(1, 1, true)
          )
        ]),
        function_section([
          varuint32(0),
          varuint32(1)
        ]),
        export_section([
          export_entry(str_utf8("notify_all"), external_kind.function, varuint32(0)),
          export_entry(str_utf8("run_atomic"), external_kind.function, varuint32(1))
        ]),
        code_section([
          function_body([], [
            i32.atomic_store(align32, i32.const(0), get_local(i32, 0)),
            drop(void_,
              atomic_notify(align32, i32.const(4), get_local(i32, 0))
            )
          ]),
          function_body([], [
            if_(i32,
              i32.eq(
                atomic_wait32(align32, i32.const(4), i32.const(0), i64.const(20_000_000)),
                i32.const(2)
              ),
              [ i32.const(-1) ],
              [
                drop(void_,
                  i32.atomic_add(align32, i32.const(8), i32.const(1))
                ),
                i32.eq(
                  i32.atomic_load(align32, i32.const(8)),
                  i32.atomic_load(align32, i32.const(0))
                )
              ]
            )
          ])
        ])
      ]),
      async runner () {
        const
          { instance, module } = await this.makeInstance(), { mem } = this.imports.js,
          { hardwareConcurrency: count } = navigator, { timeOrigin } = performance,
          threads = count - 1, c = new Concurrent("js/atomics-test.js", threads),
          view = new Int32Array(this.imports.js.mem.buffer),
          rs = new Map(), ps = new Map(Array(threads).fill(0).map((_, i) => [ i, new Promise(r => rs.set(i, r)) ]));
        let r, p = new Promise(res => r = res);
        await c.runOverAll((w, wid) => {
          w.onmessage = ({ data }) => {
            const { state, result, log } = data;
            if (state === "before") rs.get(wid)();
            if (result) r(~result ? "done" : "timeout");
            if (log !== undefined) this.console.log(...log)
          };
          w.postMessage({ module, mem, wid, timeOrigin })
        });
        await Promise.all(ps.values());
        this.console.log("before", performance.now());
        instance.exports.notify_all(threads);
        this.console.log("Wasm threads and atomics test:", await p, Array.from(view.slice(0, 3)));
        c.closeAll()
      },
      teardown () { new Int32Array(this.imports.js.mem.buffer).subarray(0, 3).fill(0) },
      importsObj: { js: { mem: new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true }) } }
    }),

    new WasmSim({
      module: module([
        type_section([
          comp_type(func, [], [])
        ]),
        import_section([
          memory_import_entry(
            str_utf8("js"),
            str_utf8("mem"),
            resizable_limits(1, 1)
          )
        ]),
        function_section([
          varuint32(0)
        ]),
        export_section([
          export_entry(str_utf8("simd"), external_kind.function, varuint32(0))
        ]),
        code_section([
          function_body([], [
            v128.store(align32,
              i32.const(16),
              // f64x2.promote_low_f32x4(
              //   v128.load(align64, i32.const(0)),
              //   // v128.load(align64, i32.const(16)),
              // )
              // // i64x2.splat(i64.load(align32, i32.const(16)))
              i8x16.narrow_i16x8_u(
                v128.load(align64, i32.const(0)),
                v128.load(align64, i32.const(16)),
              )
            )
          ])
        ])
      ]),
      async runner () {
        const { instance } = await this.makeInstance();
        // new Uint8Array(this.imports.js.mem.buffer).set(Array(32).fill(0).map((_, i) => i))
        new Uint16Array(this.imports.js.mem.buffer).set(Array(16).fill(0).map((_, i) => i))
        // new Uint32Array(this.imports.js.mem.buffer).set(Array(8).fill(0).map((_, i) => i))
        // new BigUint64Array(this.imports.js.mem.buffer).set(Array(4).fill(0).map((_, i) => BigInt(i)))
        // new Float32Array(this.imports.js.mem.buffer).set(Array(8).fill(0).map((_, i) => i + .3))
        // new Float64Array(this.imports.js.mem.buffer).set(Array(4).fill(0).map((_, i) => i + .3))
        this.console.log("Wasm simd test:",
          // Array.from(new BigUint64Array(this.imports.js.mem.buffer.slice(0, 32))).map(n => Number(n)),
          Array.from(new Uint8Array(this.imports.js.mem.buffer.slice(0, 32))),
          instance.exports.simd(),
          // Array.from(new BigUint64Array(this.imports.js.mem.buffer.slice(0, 32))).map(n => Number(n))
          Array.from(new Uint8Array(this.imports.js.mem.buffer.slice(0, 32)))
        );
      },
      importsObj: { js: { mem: new WebAssembly.Memory({ initial: 1, maximum: 1 }) } }
    }),

    new WasmSim({
      module: module([
        type_section([
          comp_type(func, [ i32 ], [ i32 ]),
          comp_type(func, [ i32 ], [])
        ]),
        import_section([
          tag_import_entry(str_utf8("js"), str_utf8("exn"), tag_type(varuint32(1)))
        ]),
        function_section([
          varuint32(0)
        ]),
        tag_section([
          tag_type(varuint32(1))
        ]),
        export_section([
          export_entry(str_utf8("throw_leg"), external_kind.function, varuint32(0))
        ]),
        code_section([
          function_body([], [
            try_catch(void_, [
              if_(void_,
                i32.rem_u(
                  get_local(i32, 0),
                  i32.const(2)
                ),
                [
                  throw_(varuint32(0), [
                    i32.div_u(
                      get_local(i32, 0),
                      i32.const(2)
                    )
                  ])
                ]
              )
            ], [
              catch_clause(varuint32(0),[
                rethrow(varuint32(0))
              ])
            ]),
            i32.div_u(
              get_local(i32, 0),
              i32.const(2)
            )
          ])
        ])
      ]),
      async runner () {
        const { instance } = await this.makeInstance(), self = this;
        let res;
        try { res = instance.exports.throw_leg(5) }
        catch (e) { if (e.is(this.imports.js.exn)) this.console.error(this.imports.js.exn, 1, e) }
        this.console.log("Wasm legacy exceptions test:", res)
      },
      importsObj: { js: { exn: new WebAssembly.Tag({ parameters: [ "i32" ] }) } }
    })
    
  ]
})();

export { WasmSim, simList }