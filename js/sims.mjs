import { c, get, sect_id, Emitter, printCode } from "./wasm.mjs";

async function testWasm (mod, imports) {
  const codeSection = get.section(mod, sect_id.code);
  for (let funcBody of get.function_bodies(codeSection)) {
    let log = "";
    printCode(funcBody.code, s => log += s);
    console.log(log)
  }
  const emitbuf = new Emitter(new ArrayBuffer(mod.z));
  mod.emit(emitbuf);
  console.log("The buffer:\n", Array.from(new Uint8Array(emitbuf.buffer)).map((byte, i) => byte.toString(16).padStart(2, "0") + ((i + 1) % 8 ? "" : "\n")).join(" "));
  const res = await WebAssembly.instantiate(emitbuf.buffer, imports);
  console.log(res);
  return res
}

var testModules = (() => {
  const {
    uint8, uint32, float32, float64, varuint1, varuint7, varuint32, varint7, varint32, varint64,
    func, void_, heap, ref, ref_null, external_kind, data, str, str_ascii, str_utf8, module,
    custom_section, type_section, import_section, function_section, table_section, memory_section,
    global_section, export_section, start_section, element_section, code_section, data_section, datacount_section,
    function_import_entry, table_import_entry, memory_import_entry, global_import_entry, export_entry,
    active_elem_segment, passive_elem_segment, declarative_elem_segment, active_data_segment, passive_data_segment,
    comp_type, func_type, table_type, global_type, resizable_limits, global_variable, init_expr, elem_expr_func, elem_expr_null, function_body, local_entry,
    unreachable, nop, block, void_block, loop, void_loop, if_, void_if, end, br, br_if, br_table,
    return_, return_void, return_multi, call, call_indirect, drop, select, get_local, set_local, tee_local, get_global, set_global,
    current_memory, grow_memory, init_memory, drop_data, copy_memory, fill_memory, init_table, drop_elem, copy_table,
    set_table, get_table, null_ref, is_null_ref, func_ref, eq_ref, as_non_null_ref,
    align8, align16, align32, align64, i32, i64, f32, f64
  } = c;
  return {
    fact: module([
      type_section([
        comp_type(func, [ i32 ], [ i32 ])  // type index = 0
      ]),
      function_section([
        varuint32(0)  // function index = 0, using type index 0
      ]),
      export_section([
        // Export "fact" as function at index 0
        export_entry(str_ascii("fact"), external_kind.function, varuint32(0))
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
    mem: module([
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
      memory_section([
        resizable_limits(1, 1)
      ]),
      export_section([
        export_entry(str_ascii("store"), external_kind.function, varuint32(0))
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
    sat: module([
      type_section([
        comp_type(func, [ f32 ], [ i32 ])
      ]),
      function_section([
        varuint32(0)
      ]),
      export_section([
        export_entry(str_ascii("sat"), external_kind.function, varuint32(0))
      ]),
      code_section([
        function_body([], [
          i32.trunc_sat_f32_s(
            get_local(f32, 0)
          )
        ])
      ])
    ]),
    sext: module([
      type_section([
        comp_type(func, [ i32 ], [ i32 ])
      ]),
      function_section([
        varuint32(0)
      ]),
      export_section([
        export_entry(str_ascii("sext"), external_kind.function, varuint32(0))
      ]),
      code_section([
        function_body([], [
          i32.extend8_s(
            get_local(i32, 0)
          )
        ])
      ])
    ]),
    bulk: module([
      type_section([
        comp_type(func, [i32, i32, i32])
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
      memory_section([
        resizable_limits(1, 1)
      ]),
      export_section([
        export_entry(str_ascii("bulk"), external_kind.function, varuint32(0))
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
        passive_data_segment(str_ascii("ABCDEFGH"))
      ])
    ]),
    bulk_table: module([
      type_section([
        comp_type(func, [heap.Extern]),
        comp_type(func, [i32, heap.Extern]),
        comp_type(func, [i32]),
      ]),
      import_section([
        function_import_entry(
          str_ascii("js"),
          str_ascii("run"),
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
        export_entry(str_ascii("set_externref"), external_kind.function, varuint32(1)),
        export_entry(str_ascii("run_from_table"), external_kind.function, varuint32(2))
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
    multi_val: module([
      type_section([
        comp_type(func, [], [i32, i32])
      ]),
      function_section([
        varuint32(0)
      ]),
      export_section([
        export_entry(str_ascii("multi_block"), external_kind.function, varuint32(0))
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
    ])
  }
})();
(async () => {
  let { instance } = await testWasm(testModules.fact);
  console.log("Wasm factorial test:", instance.exports.fact(8));
  
  let mem = new WebAssembly.Memory({ initial: 1, maximum: 1 });
  ({ instance } = await testWasm(testModules.mem, { js: { mem } }));
  console.log("Wasm memory test:", instance.exports.store(0x4, 0xFFFFFFFF), new Uint32Array(mem.buffer));

  ({ instance } = await testWasm(testModules.sat));
  console.log("Wasm non-trapping num conversion test:", NaN, "->", instance.exports.sat(NaN));

  ({ instance } = await testWasm(testModules.sext));
  console.log("Wasm sign extension test:", instance.exports.sext(130));

  mem = new WebAssembly.Memory({ initial: 1, maximum: 1 });
  ({ instance } = await testWasm(testModules.bulk, { js: { mem } }));
  console.log("Wasm bulk memory ops test:", instance.exports.bulk(8, 0, 0), new Uint8Array(mem.buffer));

  ({ instance } = await testWasm(testModules.bulk_table, { js: { run (fn) { fn?.() } } }));
  console.log("Wasm bulk table ops test:",
    instance.exports.set_externref(0, function () { console.log('yo') }),
    instance.exports.run_from_table(0));
  
  ({ instance } = await testWasm(testModules.multi_val));
  console.log("Wasm multi value test:", instance.exports.multi_block())
})()
