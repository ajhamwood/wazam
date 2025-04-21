import { c } from "./ast.mjs";

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

class WASTParser {}

function parseCode (code) {
  const mod = module([]);
  return mod
}

export { parseCode, WASTParser }