import { c, get, sect_id, Emitter, printCode } from "./wasm.mjs";



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
    const mod = this.#module, codeSection = get.section(mod, sect_id.code);
    // TODO print entire module
    this.#code_pretty = "";
    this.#sec_lengths = mod.v.map(s => s.z);
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
        self.#log = [];
        self.#component.consoleElement.innerText = ""
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



const simList = (() => {

  const {
    uint8, uint32, biguint64, float32, float64, varuint1, varuint7, varuint32, varint7, varint32, varint64,
    vari8x16, vari16x8, vari32x4, vari64x2, varf32x4, varf64x2,
    packed, heap, comp, void_, ref, ref_null, external_kind, data, str, str_ascii, str_utf8, module,
    custom_section, type_section, import_section, function_section, table_section, memory_section,
    global_section, export_section, start_section, element_section, code_section, data_section, datacount_section, tag_section,
    function_import_entry, table_import_entry, memory_import_entry, global_import_entry, tag_import_entry, export_entry,
    active_elem_segment, passive_elem_segment, declarative_elem_segment, active_data_segment, passive_data_segment,
    rec_type, sub_type, comp_type, func_type, field_type, table_type, table_init_entry, global_type, tag_type,
    resizable_limits, global_variable, init_expr, elem_expr_func, elem_expr_null, function_body, local_entry,
    unreachable, nop, block, void_block, loop, void_loop, if_, void_if, end, br, br_if, br_table, br_on_null, br_on_non_null, br_on_cast, br_on_cast_fail,
    try_catch, catch_clause, try_delegate, throw_, rethrow, throw_ref, try_table, catch_clauses, catch_, catch_ref, catch_all, catch_all_ref,
    return_, return_void, return_multi, return_call_ref, return_call, return_call_indirect, call, call_indirect, call_ref, drop, select,
    get_local, set_local, tee_local, get_global, set_global, null_ref, is_null_ref, func_ref, eq_ref, as_non_null_ref,
    size_memory, grow_memory, init_memory, drop_data, copy_memory, fill_memory, init_table, drop_elem, copy_table, grow_table, size_table, fill_table, set_table, get_table,
    new_struct, new_default_struct, get_struct, get_struct_s, get_struct_u, set_struct,
    new_array, new_default_array, new_fixed_array, new_data_array, new_elem_array,
    get_array, get_array_s, get_array_u, set_array, len_array, fill_array, copy_array, init_data_array, init_elem_array,
    test_ref, test_null_ref, cast_ref, cast_null_ref, convert_extern_any, convert_any_extern, i31_ref, get_i31_s, get_i31_u, 
    atomic_notify, atomic_wait32, atomic_wait64, atomic_fence,
    align8, align16, align32, align64, i32, i64, f32, f64, v128, i8x16, i16x8, i32x4, i64x2, f32x4, f64x2
  } = c;

  return [

    new WasmSim({
      module: module([
        type_section([
          comp_type(comp.Func, [ i32 ], [ i32 ])  // type index = 0
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
          comp_type(comp.Func, [ f32 ], [ i32 ])
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
          comp_type(comp.Func, [ i32 ], [ i32 ])
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
          comp_type(comp.Func, [ i32, i32, i32 ])
        ]),
        import_section([
          memory_import_entry(str_utf8("js"), str_utf8("mem"), resizable_limits(1, 1))
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
          comp_type(comp.Func, [ heap.Extern ]),
          comp_type(comp.Func, [ i32, heap.Extern ]),
          comp_type(comp.Func, [ i32 ]),
        ]),
        import_section([
          function_import_entry(str_utf8("js"), str_utf8("run"), varuint32(0))
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
            set_table(0, get_local(i32, 0), get_local(heap.Extern, 1))
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
          comp_type(comp.Func, [], [ i32, i32 ])
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
          comp_type(comp.Func, [ i32 ], []),
          comp_type(comp.Func, [], [ i32 ])
        ]),
        import_section([
          memory_import_entry(str_utf8("js"), str_utf8("mem"), resizable_limits(1, 1, true))
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
          comp_type(comp.Func, [], [])
        ]),
        import_section([
          memory_import_entry(str_utf8("js"), str_utf8("mem"), resizable_limits(1, 1))
        ]),
        function_section([
          varuint32(0),
          varuint32(0)
        ]),
        export_section([
          export_entry(str_utf8("simd"), external_kind.function, varuint32(0)),
          export_entry(str_utf8("relax"), external_kind.function, varuint32(0))
        ]),
        code_section([
          function_body([], [
            v128.store(align32,
              i32.const(16),
              i16x8.q15mulr_sat_s(
                v128.load(align64, i32.const(0)),
                v128.load(align64, i32.const(16)),
              )
            )
          ]),
          function_body([], [
            v128.store(align32,
              i32.const(16),
              i16x8.relaxed_q15mulr_s(
                v128.load(align64, i32.const(0)),
                v128.load(align64, i32.const(16)),
              )
            )
          ])
        ])
      ]),
      async runner () {
        const { instance } = await this.makeInstance();
        new Uint16Array(this.imports.js.mem.buffer).set(Array(16).fill(0).map((_, i) => (i + 1) * 0x0800 - 1));
        this.console.log("Wasm simd test:",
          Array.from(new Int16Array(this.imports.js.mem.buffer.slice(0, 16))).map(v => (v / 0x8000).toPrecision(6)),
          Array.from(new Int16Array(this.imports.js.mem.buffer.slice(16, 32))).map(v => (v / 0x8000).toPrecision(6)),
          instance.exports.simd(),
          Array.from(new Int16Array(this.imports.js.mem.buffer.slice(16, 32))).map(v => (v / 0x8000).toPrecision(6))
        );
        this.console.log("Wasm relaxed simd test:",
          instance.exports.relax(),
          Array.from(new Int16Array(this.imports.js.mem.buffer.slice(16, 32))).map(v => (v / 0x8000).toPrecision(6))
        );
      },
      importsObj: { js: { mem: new WebAssembly.Memory({ initial: 1, maximum: 1 }) } }
    }),

    new WasmSim({
      module: module([
        type_section([
          comp_type(comp.Func, [ i32 ], [ i32 ]),
          comp_type(comp.Func, [ i32 ])
        ]),
        import_section([
          tag_import_entry(str_utf8("js"), str_utf8("exn"), tag_type(varuint32(1)))
        ]),
        function_section([
          varuint32(0)
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
        const { instance } = await this.makeInstance();
        let res;
        try { res = instance.exports.throw_leg(5) }
        catch (e) {
          if (e.is(this.imports.js.exn)) this.console.error(this.imports.js.exn, e, 1);
          else this.console.error()
        }
        this.console.log("Wasm legacy exceptions test:", res)
      },
      importsObj: { js: { exn: new WebAssembly.Tag({ parameters: [ "i32" ] }) } }
    }),

    new WasmSim({
      module: module([
        type_section([
          comp_type(comp.Func, [], [ i32 ])
        ]),
        import_section([
          global_import_entry(str_utf8("js"), str_utf8("global0"), global_type(i32))
        ]),
        function_section([
          varuint32(0)
        ]),
        global_section([
          global_variable(
            global_type(i32),
            init_expr([
              i32.add(
                get_global(i32, 0),
                i32.const(1)
              )
            ])
          )
        ]),
        export_section([
          export_entry(str_utf8("next"), external_kind.function, varuint32(0))
        ]),
        code_section([
          function_body([], [
            get_global(i32, 1)
          ])
        ])
      ]),
      async runner () {
        const { instance } = await this.makeInstance();
        this.console.log("Wasm extended constant expressions test:", instance.exports.next())
      },
      importsObj: { js: { global0: new WebAssembly.Global({ value: "i32" }, 1) } }
    }),

    new WasmSim({
      module: module([
        type_section([
          comp_type(comp.Func, [], [ i32 ]),
          comp_type(comp.Func, [ ref_null(varuint32(0)) ], [ i32 ])
        ]),
        import_section([
          table_import_entry(str_utf8("js"), str_utf8("tbl"), table_type(heap.Func, resizable_limits(2)))
        ]),
        function_section([
          varuint32(0),
          varuint32(0),
          varuint32(1)
        ]),
        export_section([
          export_entry(str_utf8("run_ref"), external_kind.function, varuint32(2))
        ]),
        element_section([
          active_elem_segment(
            init_expr([ i32.const(0) ]),
            [ varuint32(0), varuint32(1) ]
          )
        ]),
        code_section([
          function_body([], [ i32.const(-1) ]),
          function_body([], [ i32.const(3) ]),
          function_body([], [
            call_ref(i32,
              block(ref_null(varuint32(0)),
                [
                  return_(call_ref(i32,
                    func_ref(0),
                    varuint32(0),
                    [ br_on_non_null(0, get_local(i32, 0)) ]
                  ))
                ]
              ),
              varuint32(0)
            )
          ])
        ])
      ]),
      async runner () {
        const { instance } = await this.makeInstance();
        this.console.log("Wasm typed function references test:",
          instance.exports.run_ref(this.imports.js.tbl.get(1)),
          instance.exports.run_ref(null));
      },
      importsObj: { js: { tbl: new WebAssembly.Table({ initial: 2, maximum: 2, element: "anyfunc" }) } }
    }),

    new WasmSim({
      module: module([
        type_section([
          rec_type([
            sub_type([], comp_type(comp.Struct)),                     // List
            sub_type([ varuint32(0) ], comp_type(comp.Struct), true), // Nil
            sub_type([ varuint32(0) ],                                // Cons
              comp_type(comp.Struct, field_type(ref(varuint32(0))), field_type(ref(heap.Any))),
              true
            )
          ]),
          comp_type(comp.Func, [], [ ref(varuint32(1)) ]),                                   // nil
          comp_type(comp.Func, [ ref(varuint32(0)), ref(heap.Any) ], [ ref(varuint32(2)) ]), // cons
          comp_type(comp.Func, [ ref(varuint32(0)), ref(heap.Any), ref(heap.Any) ], [ ref(heap.Any) ]),    // reducer
          comp_type(comp.Func, [ ref(varuint32(0)), ref(varuint32(5)), ref(heap.Any) ], [ ref(heap.Any) ]) // fold
        ]),
        function_section([
          varuint32(3),
          varuint32(4),
          varuint32(6),
          varuint32(5)
        ]),
        table_section([
          table_init_entry(
            table_type(ref(heap.Func), resizable_limits(1, 1)),
            init_expr([ func_ref(3) ])
          )
        ]),
        export_section([
          export_entry(str_utf8("nil"), external_kind.function, varuint32(0)),
          export_entry(str_utf8("cons"), external_kind.function, varuint32(1)),
          export_entry(str_utf8("fold"), external_kind.function, varuint32(2)),
          export_entry(str_utf8("funcs"), external_kind.table, varuint32(0))
        ]),
        code_section([
          function_body([], [ // nil
            new_struct(1, [])
          ]),
          function_body([], [ // cons
            new_struct(2, [ get_local(ref(varuint32(0)), 0), get_local(ref(heap.Any), 1) ])
          ]),
          function_body([ local_entry(1, ref(varuint32(0))) ], [ // fold
            drop(void_, block(ref(varuint32(1)), [
              set_local(3,
                get_struct(ref(varuint32(0)), 2, 0,
                  block(ref(varuint32(2)), [
                    br_on_cast(varuint32(0), varuint32(0), varuint32(2), uint8(0),
                      br_on_cast(varuint32(1), varuint32(0), varuint32(1), uint8(0),
                        get_local(ref(varuint32(0)), 0)
                      )
                    ),
                    unreachable
                  ])
                )
              ),
              return_call(ref(heap.Any),
                varuint32(2),
                [
                  get_local(ref(varuint32(0)), 3),
                  get_local(ref(varuint32(5)), 1),
                  call_ref(ref(heap.Any),
                    get_local(ref(varuint32(5)), 1),
                    varuint32(5),
                    [
                      get_local(ref(varuint32(0)), 3),
                      get_struct(ref(heap.Any), 2, 1,
                        cast_ref(varuint32(2),
                          get_local(ref(varuint32(0)), 0)
                        )
                      ),
                      get_local(ref(heap.Any), 2)
                    ]
                  )
                ]
              )
            ])),
            get_local(ref(heap.Any), 2)
          ]),
          function_body([], [ // sum
            i31_ref(i32.add(
              get_i31_s(cast_ref(heap.I31, get_local(i32, 1))),
              get_i31_s(cast_ref(heap.I31, get_local(i32, 2)))
            ))
          ]),
        ])
      ]),
      async runner () {
        const
          { instance } = await this.makeInstance(),
          { funcs, nil, cons, fold } = instance.exports,
          reducer = funcs.get(0), list = cons(cons(nil(), 2), 3);
        this.console.log("Wasm garbage collection and tail calls test:", fold(list, reducer, 1))
      }
    }),

    new WasmSim({
      module: module([
        type_section([
          comp_type(comp.Func, [ i64, i32 ], [ i32 ])
        ]),
        import_section([
          memory_import_entry( str_utf8("js"), str_utf8("mem1"), resizable_limits(1, 1, false, true)),
          memory_import_entry( str_utf8("js"), str_utf8("mem2"), resizable_limits(1, 1, false, true))
        ]),
        function_section([
          varuint32(0)
        ]),
        export_section([
          export_entry(str_utf8("multistore"), external_kind.function, varuint32(0))
        ]),
        code_section([
          function_body([], [
            if_(i32,
              i32.or(
                i64.lt_u(
                  i64.ctz(get_local(i64, 0)),
                  i64.const(2)
                ),
                i64.gt_u(
                  get_local(i64, 0),
                  i64.const(0xFFFC)
                ),
              ),
              [ i32.const(0) ],
              [
                i32.store(align32,
                  get_local(i64, 0),
                  get_local(i32, 1)
                ),
                i32.store(align32,
                  get_local(i64, 0),
                  i32.mul(
                    get_local(i32, 1),
                    i32.const(2)
                  ),
                  1
                ),
                i32.const(1)
              ]
            )
          ])
        ])
      ]),
      async runner () { // TODO check threaded multi-memory ops
        const { instance } = await this.makeInstance();
        this.console.log("Wasm multi-memory and memory64 test:", instance.exports.multistore(0x4n, 0x7FFFFFFF),
          Array.from(new Uint32Array(this.imports.js.mem1.buffer.slice(0, 8))),
          Array.from(new Uint32Array(this.imports.js.mem2.buffer.slice(0, 8))));
      },
      importsObj: { js: {
        mem1: new WebAssembly.Memory({ initial: 1n, maximum: 1n, address: "i64" }),
        mem2: new WebAssembly.Memory({ initial: 1n, maximum: 1n, address: "i64" })
      } }
    }),

    new WasmSim({
      module: module([
        type_section([
          comp_type(comp.Func, [ i32 ], [ i32 ]),
          comp_type(comp.Func, [ i32 ]),
          comp_type(comp.Func, [ i32, heap.Exn ]),
          comp_type(comp.Func, [], [ i32, heap.Exn ])
        ]),
        import_section([
          tag_import_entry(str_utf8("js"), str_utf8("exn1"), tag_type(varuint32(1)))
        ]),
        function_section([
          varuint32(0)
        ]),
        tag_section([
          tag_type(varuint32(2))
        ]),
        export_section([
          export_entry(str_utf8("throw_by_ref"), external_kind.function, varuint32(0)),
          export_entry(str_utf8("exn2"), external_kind.tag, varuint32(1))
        ]),
        code_section([
          function_body([], [
            throw_ref(block(varuint32(3), [
              return_(drop(i32, block(varuint32(3), [
                try_table(void_,
                  catch_clauses([
                    catch_ref(varuint32(0), varuint32(1)),
                    catch_(varuint32(1), varuint32(0)),
                  ]),
                  [
                    if_(void_, i32.eqz(get_local(i32, 0)),
                      [ throw_(varuint32(0), [ i32.const(5) ]) ],
                      [ throw_(varuint32(1), [ i32.const(6), null_ref(heap.Exn) ]) ]
                    )
                  ],
                ),
                i32.const(-1),
                null_ref(heap.Exn)
              ])))
            ]))
          ])
        ])
      ]),
      async runner () {
        const { instance } = await this.makeInstance();
        let res;
        try { res = instance.exports.throw_by_ref(0) }
        catch (e) {
          if (e.is(this.imports.js.exn1)) this.console.error(this.imports.js.exn1, e, 1, "caught");
          else if (e.is(instance.exports.exn2)) this.console.error(instance.exports.exn2, e, 2, "caught")
        }
        this.console.log("Wasm exnref test:", res);
      },
      importsObj: { js: {
        exn1: new WebAssembly.Tag({ parameters: [ "i32" ] })
      } }
    }),

    new WasmSim({
      module: module([
        type_section([
          comp_type(comp.Func, [ i32 ]),
          comp_type(comp.Arr, field_type(packed.I16, true)),
          comp_type(comp.Func, [ heap.Extern, ref_null(varuint32(1)), i32 ], [ i32 ]),
        ]),
        import_section([
          global_import_entry(str_utf8("str1"), str_utf8("my string"), global_type(heap.Extern)),
          function_import_entry(str_utf8("wasm:js-string"), str_utf8("intoCharCodeArray"), varuint32(2))
        ]),
        function_section([
          varuint32(0)
        ]),
        table_section([
          table_init_entry(
            table_type(ref(heap.Func), resizable_limits(1, 1)),
            init_expr([ func_ref(0) ])
          )
        ]),
        memory_section([
          resizable_limits(1, 1)
        ]),
        export_section([
          export_entry(str_utf8("load"), external_kind.function, varuint32(1)),
          export_entry(str_utf8("data"), external_kind.memory, varuint32(0))
        ]),
        code_section([
          function_body([ local_entry(1, ref_null(varuint32(1))), local_entry(2, i32) ], [
            set_local(1, new_array(1, i32.const(0), i32.const(9))),
            drop(void_, call_indirect(i32,
              i32.const(0),
              varuint32(0),
              varuint32(2),
              [
                get_global(heap.Extern, 0),
                get_local(ref(varuint32(1)), 1),
                i32.const(0)
              ]
            )),
            // set_local(1, cast_ref(varuint32(1),
            //   convert_extern_any(get_global(heap.Extern, 0))
            // )),
            set_local(3, len_array(get_local(ref(varuint32(1)), 1))),
            void_block([ void_loop([
              br_if(1,
                i32.ge_s(
                  get_local(i32, 2),
                  get_local(i32, 3)
                )
              ),
              i32.store(align32,
                i32.add(
                  get_local(i32, 2),
                  get_local(i32, 0)
                ),
                get_array_u(i32, 1,
                  get_local(ref(varuint32(1)), 1),
                  get_local(i32, 2)
                )
              ),
              set_local(2, i32.add(
                get_local(i32, 2),
                i32.const(1)
              )),
              br(0)
            ]) ])
          ])
        ])
      ]),
      async runner () {
        const { instance } = await this.makeInstance();
        instance.exports.load(3);
        this.console.log("Wasm js string builtins test:",
          new TextDecoder().decode(instance.exports.data.buffer.slice(0, 16)));
      },
      compileOpts: { builtins: [ 'js-string' ], importedStringConstants: "str1" }
    })
    
  ]
})();

export { WasmSim, simList }