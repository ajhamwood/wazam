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
  console.log("The buffer:\n", Array.from(new Uint8Array(emitbuf.buffer)).map((byte, i) => byte.toString(16).padStart(2, "0") + ((i + 1) % 4 ? "" : "\n")).join(" "));
  const res = await WebAssembly.instantiate(emitbuf.buffer, imports);
  console.log(res);
  return res
}

var testModules = (() => {
  const {
    uint8, uint32, float32, float64, varuint1, varuint7, varuint32, varint7, varint32, varint64,
    any_func, func, empty_block, void_, external_kind, data, str, str_ascii, str_utf8, module,
    custom_section, type_section, import_section, function_section, table_section, memory_section,
    global_section, export_section, start_section, element_section, code_section, data_section,
    function_import_entry, table_import_entry, memory_import_entry, global_import_entry, export_entry,
    elem_segment, data_segment, func_type, table_type, global_type,
    resizable_limits, global_variable, init_expr, function_body, local_entry,
    unreachable, nop, block, void_block, loop, void_loop, if_, void_if, end, br, br_if, br_table,
    return_, return_void, call, call_indirect, drop, select,
    get_local, set_local, tee_local, get_global, set_global,
    current_memory, grow_memory, align8, align16, align32, align64, i32, i64, f32, f64
  } = c;
  return {
    fact: module([
      type_section([
        func_type([ i32 ], i32)  // type index = 0
      ]),
      function_section([
        varuint32(0)  // function index = 0, using type index 0
      ]),
      export_section([
        // Export "factorial" as function at index 0
        export_entry(str_ascii("factorial"), external_kind.function, varuint32(0))
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
        func_type([ i32, i32 ], i32)
      ]),
      import_section([
        memory_import_entry(
          str_utf8("js"),
          str_utf8("mem"),
          resizable_limits(varuint32(1), varuint32(1))
        )
      ]),
      function_section([
        varuint32(0)
      ]),
      memory_section([
        resizable_limits(varuint32(1), varuint32(1))
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
    ])
  }
})();

(async () => {
  let { instance } = await testWasm(testModules.fact);
  console.log("Wasm factorial test", instance.exports.factorial(8));
  
  const mem = new WebAssembly.Memory({ initial: 1, maximum: 1 });
  ({ instance } = await testWasm(testModules.mem, { js: { mem } }));
  console.log("Wasm memory test", instance.exports.store(0x4, 0xFFFFFFFF), new Uint32Array(mem.buffer));
})()
