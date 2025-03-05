// Emit wasm

class Emitter {
  constructor (buffer) {
    this.view = new DataView(this.buffer = buffer);
    this.length = 0;
  }
  writeU8 (v) {
    this.view.setUint8(this.length++, v);
    return this
  }
  writeU16 (v) {
    this.view.setUint16(this.length, v, true);
    this.length += 2;
    return this
  }
  writeU32 (v) {
    this.view.setUint32(this.length, v, true);
    this.length += 4;
    return this
  }
  writeF32 (v) {
    this.view.setFloat32(this.length, v, true);
    this.length += 4;
    return this
  }
  writeF64 (v) {
    this.view.setFloat64(this.length, v, true);
    this.length += 8;
    return this
  }
  writeBytes (bytes) {
    for (const byte of bytes) this.view.setUint8(this.length++, byte);
    return this
  }
}

const assert = (cond, ...msg) => cond || console.error("ASSERTION FAILURE", ...msg);


// AST

// Type tags

const T = {
  // Atoms
  uint8:         Symbol('u8'),
  uint16:        Symbol('u16'),
  uint32:        Symbol('u32'),
  varuint1:      Symbol('vu1'),
  varuint7:      Symbol('vu7'),
  varuint32:     Symbol('vu32'),
  varint7:       Symbol('vs7'),
  varint32:      Symbol('vs32'),
  varint64:      Symbol('vs64'),
  float32:       Symbol('f32'), // non-standard
  float64:       Symbol('f64'), // non-standard
  prefix:        Symbol('prefix'), // non-standard
  data:          Symbol('data'), // non-standard
  type:          Symbol('type'), // non-standard, signifies a varint7 type constant
  external_kind: Symbol('type'),

  // Instructions
  instr:              Symbol('instr'), // non-standard
  instr_pre:          Symbol('instr_pre'), // non-standard
  instr_pre1:         Symbol('instr_pre1'), // non-standard
  instr_imm1:         Symbol('instr_imm1'), // non-standard
  instr_imm1_post:    Symbol('instr_imm1_post'), // non-standard
  instr_pre_imm:      Symbol('instr_pre_imm'), // non-standard
  instr_pre_imm_post: Symbol('instr_pre_imm_post'), // non-standard

  // Cells
  module:           Symbol('module'),
  section:          Symbol('section'),
  import_entry:     Symbol('import_entry'),
  export_entry:     Symbol('export_entry'),
  local_entry:      Symbol('local_entry'),
  func_type:        Symbol('func_type'),
  table_type:       Symbol('table_type'),
  memory_type:      Symbol('memory_type'),
  global_type:      Symbol('global_type'),
  resizable_limits: Symbol('resizable_limits'),
  global_variable:  Symbol('global_variable'),
  init_expr:        Symbol('init_expr'),
  elem_segment:     Symbol('elem_segment'),
  data_segment:     Symbol('data_segment'),
  function_body:    Symbol('function_body'),
  str:              Symbol('str'), // non-standard
};


// Nodes

const
  // (Emitter, [Emittable]) -> Emitter
  writev = (e, objs) => objs.reduce((e, n) => n.emit(e), e),
  // [N] -> number
  sumz = ns => ns.reduce((sum, { z }) => sum += z, 0),
  // uint8 -> int7
  readVarInt7 = byte => byte < 64 ? byte : -(128 - byte);

// bytes_atom : Atom (ArrayLike uint8)
class bytes_atom {
  // (TypeTag, ArrayLike uint8) -> bytes_atom
  constructor(t, v) { this.t = t; this.z = v.length; this.v = v }
  emit (e) { return e.writeBytes(this.v) }
}

// val_atom T : Atom T
class val_atom {
  // (TypeTag, uint32, T) -> val_atom T
  constructor (t, z, v) { this.t = t; this.z = z; this.v = v }
  emit (e) { return e }
}

// T : number, (val_atom T) (bytesval_atom T) => bytesval_atom
class bytesval_atom extends val_atom {
  // (TypeTag, T, ArrayLike uint8) -> bytesval_atom T
  constructor (t, v, bytes) {
    super(t, bytes.length, v);
    this.bytes = bytes
  }
  emit (e) { return e.writeBytes(this.bytes) }
}

// (val_atom uint32) u32_atom => u32_atom
class u32_atom extends val_atom {
  // uint32 -> u32_atom
  constructor (v) { super(T.uint32, 4, v) }
  emit (e) { return e.writeU32(this.v) }
}

// (val_atom float32) f32_atom => f32_atom
class f32_atom extends val_atom {
  // number -> f32_atom
  constructor (v) { super(T.float32, 4, v) }
  emit (e) { return e.writeF32(this.v) }
}

// (val_atom float64) f64_atom => f64_atom
class f64_atom extends val_atom {
  // number -> f64_atom
  constructor (v) { super(T.float64, 8, v) }
  emit (e) { return e.writeF64(this.v) }
}

// T : number, (val_atom T) (u8_atom T) => u8_atom T
class u8_atom extends val_atom {
  // (TypeTag, T) -> u8_atom T
  constructor (t, v) { super(t, 1, v) }
  emit (e) { return e.writeU8(this.v) }
}

// (u8_atom int7) type_atom => type_atom
class type_atom extends u8_atom {
  // (int7, uint8) -> type_atom
  constructor (v, b) { super(T.type, v); this.b = b }
  emit (e) { return e.writeU8(this.b) }
}

// str_atom : Atom (ArrayLike uint8)
class str_atom {
  // (VarUint32, ArrayLike uint8) -> str_atom
  constructor (len, v) {
    assert(len.v == v.length, "len.v", len.v, "!= v.length", v.length);
    this.t = T.str;
    this.z = len.z + v.length;
    this.v = v;
    this.len = len
  }
  emit (e) { return this.len.emit(e).writeBytes(this.v) }
}

// T : N => cell T : Cell T
class cell {
  // (TypeTag, [T]) -> cell T
  constructor (t, v) {
    this.t = t;
    this.z = sumz(v);
    this.v = v
  }
  emit (e) { return writev(e, this.v) }
}


// Instructions

// (u8_atom uint8) instr_atom : instr_atom
class instr_atom extends u8_atom {
  // (uint8, AnyResult) -> instr_atom
  constructor (v, mbResult) { super(T.instr, v); this.r = mbResult }
}

// instr_cell : N
class instr_cell {
  // (TypeTag, uint8 | uint16, AnyResult, uint32) -> instr_cell
  constructor (t, op, mbResult, z) { this.t = t; this.z = z; this.v = new Uint8Array(op); this.r = mbResult }
  emit (e) { return e }
}

// instr_cell instr_pre1 => instr_pre1
class instr_pre1 extends instr_cell {
  // (uint8 | uint16, AnyResult, N) -> instr_pre1
  constructor (op, mbResult, pre) {
    super(T.instr_pre1, op, mbResult, op.length + pre.z);
    this.pre = pre
  }
  emit (e) { return this.pre.emit(e).writeBytes(this.v) }
}

// instr_cell instr_imm1 => instr_imm1
class instr_imm1 extends instr_cell {
  // (uint8 | uint16, AnyResult, N) -> instr_imm1
  constructor (op, mbResult, imm) {
    super(T.instr_imm1, op, mbResult, op.length + imm.z);
    this.imm = imm
  }
  emit (e) { return this.imm.emit(e.writeBytes(this.v)) }
}

// instr_cell instr_pre => instr_pre
class instr_pre extends instr_cell {
  // (uint8 | uint16, AnyResult, [N]) -> instr_pre
  constructor (op, mbResult, pre) {
    super(T.instr_pre, op, mbResult, op.length + sumz(pre));
    this.pre = pre
  }
  emit (e) { return writev(e, this.pre).writeBytes(this.v) }
}

// instr_cell instr_imm1_post => instr_imm1_post
class instr_imm1_post extends instr_cell {
  // (uint8 | uint16, N, [N]) -> instr_imm1_post
  constructor (op, imm, post) {
    super(T.instr_imm1_post, op, mbResult, op.length + imm.z + sumz(post));
    this.imm = imm; this.post = post
  }
  emit (e) { return writev(this.imm.emit(e.writeBytes(this.v)), this.post) }
}

// instr_cell instr_pre_imm => instr_pre_imm
class instr_pre_imm extends instr_cell {
  // (uint8 | uint16, AnyResult, [N], [N])
  constructor (op, mbResult, pre, imm) {
    super(T.instr_pre_imm, op, mbResult, op.length + sumz(pre) + sumz(imm));
    this.pre = pre; this.imm = imm
  }
  emit (e) { return writev(writev(e, this.pre).writeBytes(this.v), this.imm) }
}

// instr_pre_imm_post : instr_cell
class instr_pre_imm_post extends instr_cell {
  // (uint8 | uint16, AnyResult, [N], [N], [N])
  constructor (op, mbResult, pre, imm, post) {
    super(T.instr_pre_imm_post, op, mbResult, op.length + sumz(pre) + sumz(imm) + sumz(post));
    this.pre = pre; this.imm = imm; this.post = post
  }
  emit (e) { return writev(writev(writev(e, this.pre).writeBytes(this.v), this.imm), this.post) }
}

// R => (number, number, number -> Maybe R) -> [R]
function maprange (start, stop, fn) {
  let a = []  // [R]
  while (start < stop) {
    let v = fn(start)  // R
    if (typeof v !== "undefined") a.push(v);
    start++
  }
  return a
}


// Constructors

const
  uint8Cache = maprange(0, 16, v => new u8_atom(T.uint8, v)),  // [Uint8]
  varUint7Cache = maprange(0, 16, v => new u8_atom(T.varuint7, v)),  // [VarUint7]
  varUint32Cache = maprange(0, 16, v => new u8_atom(T.varuint32, v)),  // [VarUint7]
  varuint1_0 = new u8_atom(T.varuint1, 0),  // Atom uint1
  varuint1_1 = new u8_atom(T.varuint1, 1);  // Atom uint1
function uint8 (v) { return uint8Cache[v] || new u8_atom(T.uint8, v) }  // uint8 -> Uint8
function uint32 (v) { return new u32_atom(v) }  // uint32 -> Uint32
function float32 (v) { return new f32_atom(v) }  // float32 -> Float32
function float64 (v) { return new f64_atom(v) }  // float64 -> Float64

// leb128-encoded integers in N bits
// unsigned range 0 to (2 ** N) - 1
// signed range -(2 ** (N - 1)) to (2 ** (N - 1)) - 1
function varuint1 (v) { return v ? varuint1_1 : varuint1_0 }
// uint7 -> VarUint7
function varuint7 (v) {
  assert(v >= 0 && v <= 128, "v", v, "< 0 || v > 128");
  return varUint7Cache[v] || new u8_atom(T.varuint7, v)
}
// uint32 -> VarUint32
function varuint32 (value) {
  const c = varUint32Cache[value];
  if (c) return c;
  assert(value >= 0 && value <= 0xffff_ffff, "value", value, "< 0 || value > 0xffff_ffff");
  let v = value;
  const bytes = []  // [uint8]
  while (v >= 0x80) {
    bytes.push((v & 0x7f) | 0x80);
    v >>>= 7  // Unsigned right shift
  }
  bytes.push(v);
  return new bytesval_atom(T.varuint32, value, bytes)
}
// int7 -> VarInt7
function varint7 (value) {
  assert(value >= -64 && value <= 63, "value", value, "< -64 || value > 63");
  return new u8_atom(T.varint7, value < 0 ? (128 + value) : value)
}
// int32 -> [uint8]
function encVarIntN (v) {
  const bytes = [];  // [uint8]
  while (true) {
    let b = v & 0x7f;
    if (-64 <= v && v < 64) {
      bytes.push(b);
      break
    }
    v >>= 7;  // Signed right shift
    bytes.push(b | 0x80)
  }
  return bytes
}
// int64 -> [uint8]
function encVarIntNBig (v) {
  const bytes = [];  // [uint8]
  while (true) {
    let b = Number(v & 0x7fn);
    if (-64 <= v && v < 64) {
      bytes.push(b);
      break
    }
    v >>= 7n;  // Signed right shift
    bytes.push(b | 0x80)
  }
  return bytes
}
// int32 -> VarInt32
function varint32 (value) {
  assert(value >= -0x8000_0000 && value <= 0x7fff_ffff, "value", value, "< -0x8000_0000 || value > 0x7fff_ffff");
  return new bytesval_atom(T.varint32, value, encVarIntN(value))
}
// int64 -> VarInt64
function varint64 (value) {
  assert(value >= -0x8000_0000_0000_0000n && value <= 0x7fff_ffff_ffff_ffffn,
    "value", value, "< -0x8000_0000_0000_0000n || value > 0x7fff_ffff_ffff_ffffn");
  return new bytesval_atom(T.varint64, value, encVarIntNBig(value))
}


// Language types
const
  AnyFunc = new type_atom(-0x10, 0x70),  // AnyFunc
  Func = new type_atom(-0x20, 0x60),  // Func
  Void = new type_atom(-0x40, 0x40),  // Void

  external_kind_function = new u8_atom(T.external_kind, 0),  // ExternalKind
  external_kind_table = new u8_atom(T.external_kind, 1),  // ExternalKind
  external_kind_memory = new u8_atom(T.external_kind, 2),  // ExternalKind
  external_kind_global = new u8_atom(T.external_kind, 3),  // ExternalKind

  str = data => new str_atom(varuint32(data.length), data),  // ArrayLike uint8 -> Str

  sect_id_custom = varuint7(0),
  sect_id_type = varuint7(1),
  sect_id_import = varuint7(2),
  sect_id_function = varuint7(3),
  sect_id_table = varuint7(4),
  sect_id_memory = varuint7(5),
  sect_id_global = varuint7(6),
  sect_id_export = varuint7(7),
  sect_id_start = varuint7(8),
  sect_id_element = varuint7(9),
  sect_id_code = varuint7(10),
  sect_id_data = varuint7(11),
  sect_id = {
    custom: sect_id_custom,
    type: sect_id_type,
    import: sect_id_import,
    function: sect_id_function,
    table: sect_id_table,
    memory: sect_id_memory,
    global: sect_id_global,
    export: sect_id_export,
    start: sect_id_start,
    element: sect_id_element,
    code: sect_id_code,
    data: sect_id_data,
  };

// (VarUint7, N, [N]) -> Cell N
function section (id, imm, payload) {
  return new cell(T.section, [id, varuint32(imm.z + sumz(payload)), imm, ...payload])
}


const
  // R : Result => (OpCode, R, MemImm, Op Int) -> Op R
  memload = (op, r, mi, addr) => new instr_pre_imm([op], r, [addr], mi),
  // (OpCode, MemImm, Op Int, Op Result) -> Op Void
  memstore = (op, mi, addr, v) => new instr_pre_imm([op], Void, [addr, v], mi),
  // (uint32, uint32, number, number) -> boolean
  // natAl and al should be encoded as log2(bytes)  - ?? check this in reference
  addrIsAligned = (natAl, al, offs, addr) => al <= natAl && ((addr + offs) % [1, 2, 4, 8][al]) == 0,

  // (OpCode, AnyResult, N) -> Op R
  trunc_sat = (op, r, a) => new instr_pre1([0xfc, op], r, a);


// type_atom i32ops => i32ops : I32ops
class i32ops extends type_atom {
  // Constants
  constv (v) { return new instr_imm1([0x41], this, v) }                           // VarInt32 -> Op I32
  const (v) { return this.constv(varint32(v)) }                                   // int32 -> Op I32

  // Memory
  load (mi, addr) { return memload(0x28, this, mi, addr) }                        // (MemImm, Op Int) -> Op I32
  load8_s (mi, addr) { return memload(0x2c, this, mi, addr) }                     // (MemImm, Op Int) -> Op I32
  load8_u (mi, addr) { return memload(0x2d, this, mi, addr) }                     // (MemImm, Op Int) -> Op I32
  load16_s (mi, addr) { return memload(0x2e, this, mi, addr) }                    // (MemImm, Op Int) -> Op I32
  load16_u (mi, addr) { return memload(0x2f, this, mi, addr) }                    // (MemImm, Op Int) -> Op I32
  store (mi, addr, v) { return memstore(0x36, mi, addr, v) }                      // (MemImm, Op Int, Op I32) -> Op Void
  store8 (mi, addr, v) { return memstore(0x3a, mi, addr, v) }                     // (MemImm, Op Int, Op I32) -> Op Void
  store16 (mi, addr, v) { return memstore(0x3b, mi, addr, v) }                    // (MemImm, Op Int, Op I32) -> Op Void
  addrIsAligned (mi, addr) { return addrIsAligned(2, mi[0].v, mi[1].v, addr) }    // (MemImm, number) -> boolean

  // Comparison
  eqz (a) { return new instr_pre1([0x45], this, a) }                              // Op I32 -> Op I32
  eq (a, b) { return new instr_pre([0x46], this, [a, b]) }                        // (Op I32, Op I32) -> Op I32
  ne (a, b) { return new instr_pre([0x47], this, [a, b]) }                        // (Op I32, Op I32) -> Op I32
  lt_s (a, b) { return new instr_pre([0x48], this, [a, b]) }                      // (Op I32, Op I32) -> Op I32
  lt_u (a, b) { return new instr_pre([0x49], this, [a, b]) }                      // (Op I32, Op I32) -> Op I32
  gt_s (a, b) { return new instr_pre([0x4a], this, [a, b]) }                      // (Op I32, Op I32) -> Op I32
  gt_u (a, b) { return new instr_pre([0x4b], this, [a, b]) }                      // (Op I32, Op I32) -> Op I32
  le_s (a, b) { return new instr_pre([0x4c], this, [a, b]) }                      // (Op I32, Op I32) -> Op I32
  le_u (a, b) { return new instr_pre([0x4d], this, [a, b]) }                      // (Op I32, Op I32) -> Op I32
  ge_s (a, b) { return new instr_pre([0x4e], this, [a, b]) }                      // (Op I32, Op I32) -> Op I32
  ge_u (a, b) { return new instr_pre([0x4f], this, [a, b]) }                      // (Op I32, Op I32) -> Op I32

  // Numeric
  clz (a) { return new instr_pre1([0x67], this, a) }                              // Op I32 -> Op I32
  ctz (a) { return new instr_pre1([0x68], this, a) }                              // Op I32 -> Op I32
  popcnt (a) { return new instr_pre1([0x69], this, a) }                           // Op I32 -> Op I32
  add (a, b) { return new instr_pre([0x6a], this, [a, b]) }                       // (Op I32, Op I32) -> Op I32
  sub (a, b) { return new instr_pre([0x6b], this, [a, b]) }                       // (Op I32, Op I32) -> Op I32
  mul (a, b) { return new instr_pre([0x6c], this, [a, b]) }                       // (Op I32, Op I32) -> Op I32
  div_s (a, b) { return new instr_pre([0x6d], this, [a, b]) }                     // (Op I32, Op I32) -> Op I32
  div_u (a, b) { return new instr_pre([0x6e], this, [a, b]) }                     // (Op I32, Op I32) -> Op I32
  rem_s (a, b) { return new instr_pre([0x6f], this, [a, b]) }                     // (Op I32, Op I32) -> Op I32
  rem_u (a, b) { return new instr_pre([0x70], this, [a, b]) }                     // (Op I32, Op I32) -> Op I32
  and (a, b) { return new instr_pre([0x71], this, [a, b]) }                       // (Op I32, Op I32) -> Op I32
  or (a, b) { return new instr_pre([0x72], this, [a, b]) }                        // (Op I32, Op I32) -> Op I32
  xor (a, b) { return new instr_pre([0x73], this, [a, b]) }                       // (Op I32, Op I32) -> Op I32
  shl (a, b) { return new instr_pre([0x74], this, [a, b]) }                       // (Op I32, Op I32) -> Op I32
  shr_s (a, b) { return new instr_pre([0x75], this, [a, b]) }                     // (Op I32, Op I32) -> Op I32
  shr_u (a, b) { return new instr_pre([0x76], this, [a, b]) }                     // (Op I32, Op I32) -> Op I32
  rotl (a, b) { return new instr_pre([0x77], this, [a, b]) }                      // (Op I32, Op I32) -> Op I32
  rotr (a, b) { return new instr_pre([0x78], this, [a, b]) }                      // (Op I32, Op I32) -> Op I32

  // Conversion
  wrap_i64 (a) { return new instr_pre1([0xa7], this, a) }                         // Op I64 -> Op I32
  trunc_f32_s (a) { return new instr_pre1([0xa8], this, a) }                      // Op F32 -> Op I32
  trunc_f32_u (a) { return new instr_pre1([0xa9], this, a) }                      // Op F32 -> Op I32
  trunc_f64_s (a) { return new instr_pre1([0xaa], this, a) }                      // Op F64 -> Op I32
  trunc_f64_u (a) { return new instr_pre1([0xab], this, a) }                      // Op F64 -> Op I32
  reinterpret_f32 (a) { return new instr_pre1([0xbc], this, a) }                  // Op F32 -> Op I32

  // Non-trapping conversion
  trunc_sat_f32_s (a) { return trunc_sat(0x00, this, a) }                         // Op F32 -> Op I32
  trunc_sat_f32_u (a) { return trunc_sat(0x01, this, a) }                         // Op F32 -> Op I32
  trunc_sat_f64_s (a) { return trunc_sat(0x02, this, a) }                         // Op F64 -> Op I32
  trunc_sat_f64_u (a) { return trunc_sat(0x03, this, a) }                         // Op F64 -> Op I32

  // Sign-extension operators
  extend8_s (a) { return new instr_pre1([0xc0], this, a) }                        // Op I32 -> Op I32
  extend16_s (a) { return new instr_pre1([0xc1], this, a) }                       // Op I32 -> Op I32
}

// type_atom i64ops => i64ops : I64ops
class i64ops extends type_atom {
  // Constants
  constv (v) { return new instr_imm1([0x42], this, v) }                           // VarInt64 -> Op I64
  const (v) { return this.constv(varint64(BigInt(v))) }                           // int64 -> Op I64

  // Memory
  load (mi, addr) { return memload(0x29, this, mi, addr) }                        // (MemImm, Op Int) -> Op I64
  load8_s (mi, addr) { return memload(0x30, this, mi, addr) }                     // (MemImm, Op Int) -> Op I64
  load8_u (mi, addr) { return memload(0x31, this, mi, addr) }                     // (MemImm, Op Int) -> Op I64
  load16_s (mi, addr) { return memload(0x32, this, mi, addr) }                    // (MemImm, Op Int) -> Op I64
  load16_u (mi, addr) { return memload(0x33, this, mi, addr) }                    // (MemImm, Op Int) -> Op I64
  load32_s (mi, addr) { return memload(0x34, this, mi, addr) }                    // (MemImm, Op Int) -> Op I64
  load32_u (mi, addr) { return memload(0x35, this, mi, addr) }                    // (MemImm, Op Int) -> Op I64
  store (mi, addr, v) { return memstore(0x37, mi, addr, v) }                      // (MemImm, Op Int, Op I64) -> Op Void
  store8 (mi, addr, v) { return memstore(0x3c, mi, addr, v) }                     // (MemImm, Op Int, Op I64) -> Op Void
  store16 (mi, addr, v) { return memstore(0x3d, mi, addr, v) }                    // (MemImm, Op Int, Op I64) -> Op Void
  store32 (mi, addr, v) { return memstore(0x3e, mi, addr, v) }                    // (MemImm, Op Int, Op I64) -> Op Void
  addrIsAligned (mi, addr) { return addrIsAligned(3, mi[0].v, mi[1].v, addr) }    // (MemImm, number) -> boolean

  // Comparison
  eqz (a) { return new instr_pre1([0x50], this, a) }                              // Op I64 -> Op I32
  eq (a, b) { return new instr_pre([0x51], this, [a, b]) }                        // (Op I64, Op I64) -> Op I32
  ne (a, b) { return new instr_pre([0x52], this, [a, b]) }                        // (Op I64, Op I64) -> Op I32
  lt_s (a, b) { return new instr_pre([0x53], this, [a, b]) }                      // (Op I64, Op I64) -> Op I32
  lt_u (a, b) { return new instr_pre([0x54], this, [a, b]) }                      // (Op I64, Op I64) -> Op I32
  gt_s (a, b) { return new instr_pre([0x55], this, [a, b]) }                      // (Op I64, Op I64) -> Op I32
  gt_u (a, b) { return new instr_pre([0x56], this, [a, b]) }                      // (Op I64, Op I64) -> Op I32
  le_s (a, b) { return new instr_pre([0x57], this, [a, b]) }                      // (Op I64, Op I64) -> Op I32
  le_u (a, b) { return new instr_pre([0x58], this, [a, b]) }                      // (Op I64, Op I64) -> Op I32
  ge_s (a, b) { return new instr_pre([0x59], this, [a, b]) }                      // (Op I64, Op I64) -> Op I32
  ge_u (a, b) { return new instr_pre([0x5a], this, [a, b]) }                      // (Op I64, Op I64) -> Op I32

  // Numeric
  clz (a) { return new instr_pre1([0x79], this, a) }                              // Op I64 -> Op I64
  ctz (a) { return new instr_pre1([0x7a], this, a) }                              // Op I64 -> Op I64
  popcnt (a) { return new instr_pre1([0x7b], this, a) }                           // Op I64 -> Op I64
  add (a, b) { return new instr_pre([0x7c], this, [a, b]) }                       // (Op I64, Op I64) -> Op I64
  sub (a, b) { return new instr_pre([0x7d], this, [a, b]) }                       // (Op I64, Op I64) -> Op I64
  mul (a, b) { return new instr_pre([0x7e], this, [a, b]) }                       // (Op I64, Op I64) -> Op I64
  div_s (a, b) { return new instr_pre([0x7f], this, [a, b]) }                     // (Op I64, Op I64) -> Op I64
  div_u (a, b) { return new instr_pre([0x80], this, [a, b]) }                     // (Op I64, Op I64) -> Op I64
  rem_s (a, b) { return new instr_pre([0x81], this, [a, b]) }                     // (Op I64, Op I64) -> Op I64
  rem_u (a, b) { return new instr_pre([0x82], this, [a, b]) }                     // (Op I64, Op I64) -> Op I64
  and (a, b) { return new instr_pre([0x83], this, [a, b]) }                       // (Op I64, Op I64) -> Op I64
  or (a, b) { return new instr_pre([0x84], this, [a, b]) }                        // (Op I64, Op I64) -> Op I64
  xor (a, b) { return new instr_pre([0x85], this, [a, b]) }                       // (Op I64, Op I64) -> Op I64
  shl (a, b) { return new instr_pre([0x86], this, [a, b]) }                       // (Op I64, Op I64) -> Op I64
  shr_s (a, b) { return new instr_pre([0x87], this, [a, b]) }                     // (Op I64, Op I64) -> Op I64
  shr_u (a, b) { return new instr_pre([0x88], this, [a, b]) }                     // (Op I64, Op I64) -> Op I64
  rotl (a, b) { return new instr_pre([0x89], this, [a, b]) }                      // (Op I64, Op I64) -> Op I64
  rotr (a, b) { return new instr_pre([0x8a], this, [a, b]) }                      // (Op I64, Op I64) -> Op I64

  // Conversion
  extend_i32_s (a) { return new instr_pre1([0xac], this, a) }                     // Op I32 -> Op I64
  extend_i32_u (a) { return new instr_pre1([0xad], this, a) }                     // Op I32 -> Op I64
  trunc_f32_s (a) { return new instr_pre1([0xae], this, a) }                      // Op F32 -> Op I64
  trunc_f32_u (a) { return new instr_pre1([0xaf], this, a) }                      // Op F32 -> Op I64
  trunc_f64_s (a) { return new instr_pre1([0xb0], this, a) }                      // Op F64 -> Op I64
  trunc_f64_u (a) { return new instr_pre1([0xb1], this, a) }                      // Op F64 -> Op I64
  reinterpret_f64 (a) { return new instr_pre1([0xbd], this, a) }                  // Op F64 -> Op I64

  // Non-trapping conversion
  trunc_sat_f32_s (a) { return trunc_sat(0x04, this, a) }                         // Op F32 -> Op I64
  trunc_sat_f32_u (a) { return trunc_sat(0x05, this, a) }                         // Op F32 -> Op I64
  trunc_sat_f64_s (a) { return trunc_sat(0x06, this, a) }                         // Op F64 -> Op I64
  trunc_sat_f64_u (a) { return trunc_sat(0x07, this, a) }                         // Op F64 -> Op I64

  // Sign-extension operators
  extend8_s (a) { return new instr_pre1([0xc2], this, a) }                        // Op I64 -> Op I64
  extend16_s (a) { return new instr_pre1([0xc3], this, a) }                       // Op I64 -> Op I64
  extend32_s (a) { return new instr_pre1([0xc4], this, a) }                       // Op I64 -> Op I64
}

// type_atom f32ops => f32ops : F32ops
class f32ops extends type_atom {
  // Constants
  constv (v) { return new instr_imm1([0x43], this, v) }                           // Float32 -> Op F32
  const (v) { return this.constv(float32(v)) }                                    // float32 -> Op F32

  // Memory
  load (mi, addr) { return memload(0x2a, this, mi, addr) }                        // (MemImm, Op Int) -> F32
  store (mi, addr, v) { return memstore(0x38, mi, addr, v) }                      // (MemImm, Op Int, Op F32) -> Op Void
  addrIsAligned (mi, addr) { return addrIsAligned(2, mi[0].v, mi[1].v, addr) }    // (MemImm, number) -> boolean

  // Comparison
  eq (a, b) { return new instr_pre([0x5b], this, [a, b]) }                        // (Op F32, Op F32) -> Op I32
  ne (a, b) { return new instr_pre([0x5c], this, [a, b]) }                        // (Op F32, Op F32) -> Op I32
  lt (a, b) { return new instr_pre([0x5d], this, [a, b]) }                        // (Op F32, Op F32) -> Op I32
  gt (a, b) { return new instr_pre([0x5e], this, [a, b]) }                        // (Op F32, Op F32) -> Op I32
  le (a, b) { return new instr_pre([0x5f], this, [a, b]) }                        // (Op F32, Op F32) -> Op I32
  ge (a, b) { return new instr_pre([0x60], this, [a, b]) }                        // (Op F32, Op F32) -> Op I32

  // Numeric
  abs (a) { return instr_pre1([0x8b], this, a) }                                  // Op F32 -> Op F32
  neg (a) { return instr_pre1([0x8c], this, a) }                                  // Op F32 -> Op F32
  ceil (a) { return instr_pre1([0x8d], this, a) }                                 // Op F32 -> Op F32
  floor (a) { return instr_pre1([0x8e], this, a) }                                // Op F32 -> Op F32
  trunc (a) { return instr_pre1([0x8f], this, a) }                                // Op F32 -> Op F32
  nearest (a) { return instr_pre1([0x90], this, a) }                              // Op F32 -> Op F32
  sqrt (a) { return instr_pre1([0x91], this, a) }                                 // Op F32 -> Op F32
  add (a, b) { return instr_pre([0x92], this, [a, b]) }                           // (Op F32, Op F32) -> Op F32
  sub (a, b) { return instr_pre([0x93], this, [a, b]) }                           // (Op F32, Op F32) -> Op F32
  mul (a, b) { return instr_pre([0x94], this, [a, b]) }                           // (Op F32, Op F32) -> Op F32
  div (a, b) { return instr_pre([0x95], this, [a, b]) }                           // (Op F32, Op F32) -> Op F32
  min (a, b) { return instr_pre([0x96], this, [a, b]) }                           // (Op F32, Op F32) -> Op F32
  max (a, b) { return instr_pre([0x97], this, [a, b]) }                           // (Op F32, Op F32) -> Op F32
  copysign (a, b) { return instr_pre([0x98], this, [a, b]) }                      // (Op F32, Op F32) -> Op F32

  // Conversion
  convert_i32_s (a) { return new instr_pre1([0xb2], this, a) }                    // Op I32 -> Op F32
  convert_i32_u (a) { return new instr_pre1([0xb3], this, a) }                    // Op I32 -> Op F32
  convert_i64_s (a) { return new instr_pre1([0xb4], this, a) }                    // Op I64 -> Op F32
  convert_i64_u (a) { return new instr_pre1([0xb5], this, a) }                    // Op I64 -> Op F32
  demote_f64 (a) { return new instr_pre1([0xb6], this, a) }                       // Op F64 -> Op F32
  reinterpret_i32 (a) { return new instr_pre1([0xbe], this, a) }                  // Op I32 -> Op F32
}

// type_atom f64ops => f64ops : F64ops
class f64ops extends type_atom {
  // Constants
  constv (v) { return new instr_imm1([0x44], this, v) }                           // Float64 -> Op F64
  const (v) { return this.constv(float64(v)) }                                    // float64 -> Op F64

  // Memory
  load (mi, addr) { return memload(0x2b, this, mi, addr) }                        // (MemImm, Op Int) -> F64
  store (mi, addr, v) { return memstore(0x39, mi, addr, v) }                      // (MemImm, Op Int, Op F64) -> Op Void
  addrIsAligned (mi, addr) { return addrIsAligned(3, mi[0].v, mi[1].v, addr) }    // (MemImm, number) -> boolean

  // Comparison
  eq (a, b) { return new instr_pre([0x61], this, [a, b]) }                        // (Op F64, Op F64) -> Op I32
  ne (a, b) { return new instr_pre([0x62], this, [a, b]) }                        // (Op F64, Op F64) -> Op I32
  lt (a, b) { return new instr_pre([0x63], this, [a, b]) }                        // (Op F64, Op F64) -> Op I32
  gt (a, b) { return new instr_pre([0x64], this, [a, b]) }                        // (Op F64, Op F64) -> Op I32
  le (a, b) { return new instr_pre([0x65], this, [a, b]) }                        // (Op F64, Op F64) -> Op I32
  ge (a, b) { return new instr_pre([0x66], this, [a, b]) }                        // (Op F64, Op F64) -> Op I32

  // Numeric
  abs (a) { return instr_pre1([0x99], this, a) }                                  // Op F64 -> Op F64
  neg (a) { return instr_pre1([0x9a], this, a) }                                  // Op F64 -> Op F64
  ceil (a) { return instr_pre1([0x9b], this, a) }                                 // Op F64 -> Op F64
  floor (a) { return instr_pre1([0x9c], this, a) }                                // Op F64 -> Op F64
  trunc (a) { return instr_pre1([0x9d], this, a) }                                // Op F64 -> Op F64
  nearest (a) { return instr_pre1([0x9e], this, a) }                              // Op F64 -> Op F64
  sqrt (a) { return instr_pre1([0x9f], this, a) }                                 // Op F64 -> Op F64
  add (a, b) { return instr_pre([0xa0], this, [a, b]) }                           // (Op F64, Op F64) -> Op F64
  sub (a, b) { return instr_pre([0xa1], this, [a, b]) }                           // (Op F64, Op F64) -> Op F64
  mul (a, b) { return instr_pre([0xa2], this, [a, b]) }                           // (Op F64, Op F64) -> Op F64
  div (a, b) { return instr_pre([0xa3], this, [a, b]) }                           // (Op F64, Op F64) -> Op F64
  min (a, b) { return instr_pre([0xa4], this, [a, b]) }                           // (Op F64, Op F64) -> Op F64
  max (a, b) { return instr_pre([0xa5], this, [a, b]) }                           // (Op F64, Op F64) -> Op F64
  copysign (a, b) { return instr_pre([0xa6], this, [a, b]) }                      // (Op F64, Op F64) -> Op F64

  // Conversion
  convert_s_i32 (a) { return new instr_pre1([0xb7], this, a) }                    // Op I32 -> Op F64
  convert_u_i32 (a) { return new instr_pre1([0xb8], this, a) }                    // Op I32 -> Op F64
  convert_s_i64 (a) { return new instr_pre1([0xb9], this, a) }                    // Op I64 -> Op F64
  convert_u_i64 (a) { return new instr_pre1([0xba], this, a) }                    // Op I64 -> Op F64
  promote_f64 (a) { return new instr_pre1([0xbb], this, a) }                      // Op F32 -> Op F64
  reinterpret_i64 (a) { return new instr_pre1([0xbf], this, a) }                  // Op I64 -> Op F64
}

const
  magic = uint32(0x6d736100),
  latestVersion = uint32(0x1),
  end = new instr_atom(0x0b, Void),  // Op Void
  elseOp = new instr_atom(0x05, Void),  // Op Void

// AnyResult R => (R, Op I32, [AnyOp], Maybe [AnyOp]) -> Op R
  if_ = (mbResult, cond, then_, else_) => {
    assert(mbResult === then_.at(-1).r, "mbResult", mbResult, "!== then_.at(-1).r", then_.at(-1).r);
    assert(!else_ || else_.length == 0 || mbResult === else_.at(-1).r,
      "else_", else_, "!== undefined && else_.length", else_.length, "!= 0 && mbResult", mbResult, "!== else_.at(-1).r", else_.at(-1).r);
    return new instr_pre_imm_post([0x04], mbResult,
      [cond],  // pre
      [mbResult],  // imm
      else_ ?
        [ ...then_, elseOp, ...else_, end ] :
        [ ...then_, end ]) },

// Result R => Op R -> Op R
  return_ = value => new instr_pre1([0x0f], value.r, value),

  t = T,
  c = {
    uint8,
    uint32,
    float32,
    float64,
    varuint1,
    varuint7,
    varuint32,
    varint7,
    varint32,
    varint64,

    any_func: AnyFunc,
    func: Func,
    void: Void, void_: Void,

    external_kind: {
      function: external_kind_function,
      table:    external_kind_table,
      memory:   external_kind_memory,
      global:   external_kind_global
    },

    data (buf) { return new bytes_atom(T.data, buf) },  // ArrayLike uint8 -> Data
    str,
    // string -> Str
    str_ascii: text => {
      const bytes = [];  // [uint8]
      for (let i = 0, L = text.length; i < L; ++i)
        bytes[i] = 0xff & text.charCodeAt(i);
      return str(bytes)
    },
    // string -> Str
    str_utf8: text => str(new TextEncoder().encode(text)),

    // ([Section], Maybe uint32) -> Module
    module (sections, version) {
      const v = version ? uint32(version) : latestVersion;
      return new cell(T.module, [ magic, v, ...sections ])
    },

    // (Str, [N]) -> CustomSection
    custom_section: (name, payload) => section(sect_id_custom, name, payload),
    // [FuncType] -> TypeSection
    type_section: types => section(sect_id_type, varuint32(types.length), types),
    // [ImportEntry] -> ImportSection
    import_section: entries => section(sect_id_import, varuint32(entries.length), entries),
    // [VarUint32] -> FunctionSection
    function_section: types => section(sect_id_function, varuint32(types.length), types),
    // [TableType] -> TableSection
    table_section: types => section(sect_id_table, varint32(types.length), types),
    // [ResizableLimits] -> MemorySection
    memory_section: limits => section(sect_id_memory, varuint32(limits.length), limits),
    // [GlobalVairable] -> GlobalSection
    global_section: globals => section(sect_id_global, varuint32(globals.length), globals),
    // [ExportEntry] -> ExportSection
    export_section: exports => section(sect_id_export, varuint32(exports.length), exports),
    // VarUint32 -> StartSection
    start_section: funcIndex => section(sect_id_start, funcIndex, []),
    // [ElemSegment] -> ElementSection
    element_section: entries => section(sect_id_element, varuint32(entries.length), entries),
    // [FunctionBody] -> CodeSection
    code_section: bodies => section(sect_id_code, varuint32(bodies.length), bodies),
    // [DataSegment] -> DataSection
    data_section: entries => section(sect_id_data, varuint32(entries.length), entries),

    // (Str, Str, VarUint32) -> ImportEntry
    function_import_entry: (module, field, typeIndex) =>
      new cell(T.import_entry, [ module, field, external_kind_function, typeIndex ]),
    // (Str, Str, TableType) -> ImportEntry
    table_import_entry: (module, field, type) =>
      new cell(T.import_entry, [ module, field, external_kind_table, type ]),
    // (Str, Str, ResizableLimits) -> ImportEntry
    memory_import_entry: (module, field, limits) =>
      new cell(T.import_entry, [ module, field, external_kind_memory, limits ]),
    // (Str, Str, GlobalType) -> ImportEntry
    global_import_entry: (module, field, type) =>
      new cell(T.import_entry, [ module, field, external_kind_global, type ]),
    
    // (Str, ExternalKind, VarUint32) -> ExportEntry
    export_entry: (field, kind, index) => new cell(T.export_entry, [ field, kind, index ]),
    
    // (VarUint32, InitExpr, [VarUint32]) -> ElemSegment
    elem_segment: (index, offset, funcIndex) =>
      new cell(T.elem_segment, [ index, offset, varuint32(funcIndex.length), ...funcIndex ]),
    // (VarUint32, InitExpr, Data) -> DataSegment
    data_segment: (index, offset, data) =>
      new cell(T.data_segment, [ index, offset, varuint32(data.z), data ]),
    
    // ([ValueType], Maybe ValueType) -> FuncType
    func_type: (paramTypes, returnType) => new cell(T.func_type, [ Func, varuint32(paramTypes.length),
      ...paramTypes, ...(returnType ? [ varuint1_1, returnType ] : [ varuint1_0 ]) ]),
    // (ElemType, ResizableLimits) -> TableType
    table_type: (type, limits) => {
      assert(type.v == AnyFunc.v, "type.v", type.v, "!= AnyFunc.v", AnyFunc.v)  // WASM MVP limitation
      return new cell(T.table_type, [ type, limits ]) },
    // (ValueType, Maybe boolean) -> GlobalType
    global_type: (contentType, mutable) => new cell(T.global_type, [
      contentType, mutable ? varuint1_1 : varuint1_0 ]),
    
    // Expressed in number of memory pages (1 page = 64KiB)
    // (VarUint32, Maybe VarUint32) -> ResizableLimits
    resizable_limits: (initial, maximum) => new cell(T.resizable_limits, maximum ?
      [ varuint1_1, initial, maximum ] : [ varuint1_0, initial ]),
    // (GlobalType, InitExpr) -> GlobalVariable
    global_variable: (type, init) => new cell(T.global_variable, [ type, init ]),
    // [N] -> InitExpr
    init_expr: expr => new cell(T.init_expr, [ ...expr, end ]),
    // ([LocalEntry], [N]) -> FunctionBody
    function_body: (locals, code) => {
      const localCount = varuint32(locals.length);
      return new cell(T.function_body, [
        varuint32(localCount.z + sumz(locals) + sumz(code) + 1),  // body_size
        localCount, ...locals, ...code, end ]) },
    // (VarUint32, ValueType) -> LocalEntry
    local_entry: (count, type) => new cell(T.local_entry, [ count, type ]),

    // Semantics of the WebAssembly stack machine:
    // - Control instructions pop their argument value(s) off the stack, may change
    //   the program counter, and push result value(s) onto the stack.
    // - Simple instructions pop their argument value(s) from the stack, apply an
    //   operator to the values, and then push the result value(s) onto the stack,
    //   followed by an implicit advancement of the program counter.
    //       - @github.com/rsms

    // Op Void
    unreachable: new instr_atom(0x00, Void),
    // Op Void
    nop: new instr_atom(0x01, Void),
    // Begin a block which can also form control flow loops
    // AnyResult R => (R, [AnyOp]) -> Op R
    block: (mbResult, body) => {
      assert(mbResult === body.at(-1).r, "mbResult", mbResult, "!== body.at(-1).r", body.at(-1).r);
      return new instr_imm1_post([0x02], mbResult, [ ...body, end ]) },
    // [AnyOp] -> Op Void
    void_block: body => {
      assert(body.length == 0 || Void === body.at(-1).r,
        "body.length", body.length, "!= 0 && Void !== body.at(-1).r", body.at(-1).r);
      return new instr_imm1_post([0x02], Void, [ ...body, end ]) },

    // Begin a block which can also form control flow loops
    // AnyResult R => (R, [AnyOp]) -> Op R
    loop: (mbResult, body) => {
      assert(mbResult === body.at(-1).r, "mbResult", mbResult, "!== body.at(-1).r", body.at(-1).r);
      return new instr_imm1_post([0x03], mbResult, [ ...body, end ]) },
    // [AnyOp] -> Op Void
    void_loop: body => {
      assert(body.length == 0 || Void === body.at(-1).r,
        "body.length", body.length, "!= 0 && Void !== body.at(-1).r", body.at(-1).r);
      return new instr_imm1_post([0x03], Void, [ ...body, end ]) },
    if: if_, if_,  // AnyResult R => (R, Op I32, [AnyOp], Maybe [AnyOp]) -> Op R
    // (Op I32, [AnyOp], Maybe [AnyOp]) -> Op Void
    void_if: (cond, then_, else_) => if_(Void, cond, then_, else_),
    end,
    // Branch to the label given as a relative depth, in an enclosing construct
    // (branching to a block = "break"; branching to a loop = "continue")
    // uint32 -> Op Void
    br: relDepth => new instr_imm1([0x0c], Void, varuint32(relDepth)),
    // Conditionally branch to the given label, in an enclosing construct
    // (cond false = "Nop"; cond true = "Br")
    // (uint32, Op I32) -> Op Void
    br_if: (relDepth, cond) => new instr_pre_imm([0x0d], Void, [ cond ], [ varuint32(relDepth) ]),
    // Jump table, jumps to a label in an enclosing construct
    // Has a zero-based array of labels, a default label, and an index operand.
    // Jumps to the label indexed in the array, or the default label if index is out of bounds.
    // ([VarUint32], VarUint32, AnyOp) -> Op Void
    br_table: (targetLabels, defaultLabel, index) => new instr_pre_imm([0x0e], Void,
      [ index ], [ varuint32(targetLabels.length), ...targetLabels, defaultLabel ]),
    // Returns a value or no values from this function
    return: return_, return_,  // Result R => Op R -> Op R
    return_void: new instr_atom(0x0f, Void),  // Op Void
    // Calling
    // Result R => (R, VarUint32, [AnyOp]) -> Op R
    call: (r, funcIndex, args) => new instr_pre_imm([0x10], r, args, [ funcIndex ]),
    // Result R => (R, VarUint32, [AnyOp]) -> Op R
    call_indirect: (r, funcIndex, args) => new instr_pre_imm([0x11], r, args, [ funcIndex, varuint1_0 ]),
    // Drop discards the value of its operand
    // R should be the value "under" the operand on the stack
    // Eg with stack I32 (top) : F64 : F32 (bottom)  =drop=>  F64 (top) : F32 (bottom), then R = F64
    // AnyResult R => (R, Op Result) -> Op R
    drop: (r, n) => new instr_pre1([0x1a], r, n),
    // Select one of two values based on condition
    // Result R => (Op I32, Op R, Op R) -> Op R
    select: (cond, trueRes, falseRes) => {
      assert(trueRes.r === falseRes.r);
      return new instr_pre([0x1b], trueRes.r, [ trueRes, falseRes, cond ]) },

    // Variable access
    // Result R => (R, uint32) -> Op R
    get_local: (r, localIndex) => new instr_imm1([0x20], r, varuint32(localIndex)),
    // (uint32, Op Result) -> Op Void
    set_local: (localIndex, expr) => new instr_pre_imm([0x21], Void, [ expr ], [ varuint32(localIndex) ]),
    // Result R => (uint32, Op R) => Op R
    tee_local: (localIndex, expr) => new instr_pre_imm([0x22], expr.r, [ expr ], [ varuint32(localIndex) ]),
    // Result R => (R, uint32) -> Op R
    get_global: (r, globalIndex) => new instr_imm1([0x23], r, varuint32(globalIndex)),
    // (uint32, Op Result) -> Op Void
    set_global: (globalIndex, expr) => new instr_pre_imm([0x24], Void, [ expr ], [ varuint32(globalIndex) ]),

    // Memory
    // () -> Op Int
    current_memory: () => new instr_imm1([0x3f], c.i32, varuint1_0),
    // Grows the size of memory by "delta" memory pages, returns the previous memory size in pages, or -1 on failure.
    // Op Int -> Op Int
    grow_memory: delta => {
      assert(delta.v >= 0, "delta.v", delta.v, "< 0");
      return new instr_pre_imm([0x40], c.i32, [ delta ], [ varuint1_0 ]) },
    // MemImm, as [ alignment, offset ]
    align8:  [ varUint32Cache[0], varUint32Cache[0] ],  // [ VarUint32, Int ]
    align16: [ varUint32Cache[1], varUint32Cache[0] ],  // [ VarUint32, Int ]
    align32: [ varUint32Cache[2], varUint32Cache[0] ],  // [ VarUint32, Int ]
    align64: [ varUint32Cache[3], varUint32Cache[0] ],  // [ VarUint32, Int ]

    i32: new i32ops(-0x01, 0x7f),  // I32ops
    i64: new i64ops(-0x02, 0x7e),  // I64ops
    f32: new f32ops(-0x03, 0x7d),  // F32ops
    f64: new f64ops(-0x04, 0x7c)   // F64ops
  },

  // Access helpers
  get = {
    // Module -> [Section]
    sections: m => m.v.slice(2),  // 0=magic, 1=version, 2...=[Section]
    // (Module, Either VarUint7 uint7) -> Section
    section: (m, id) => {
      let ido = (typeof id !== "object") ? varuint7(id) : id;  // VarUint7
      for (let i = 2; i < m.v.length; ++i) {
        let section = m.v[i];
        if (section.v[0] === ido) return section } },
    // CodeSection -> Iterable FunctionBodyInfo
    * function_bodies (s) {
      let index = 3, funcBody;
      while (funcBody = s.v[index]) {
        let localCount = funcBody.v[1];
        yield {
          index: index++,
          locals: funcBody.v.slice(2, localCount.v + 2),
          code: funcBody.v.slice(2 + localCount.v, funcBody.v.length - 1)  // [AnyOp]
            // -1 to skip terminating "end"
        }
      }
    }
  };


// Show opcode

const
  opcodes = new Map([
    [ 0x0, "unreachable" ],
    [ 0x1, "nop" ],
    [ 0x2, "block" ],
    [ 0x3, "loop" ],
    [ 0x4, "if" ],
    [ 0x5, "else" ],
    [ 0xb, "end" ],
    [ 0xc, "br" ],
    [ 0xd, "br_if" ],
    [ 0xe, "br_table" ],
    [ 0xf, "return" ],
    [ 0x10, "call" ],
    [ 0x11, "call_indirect" ],
    [ 0x1a, "drop" ],
    [ 0x1b, "select" ],
    [ 0x20, "get_local" ],
    [ 0x21, "set_local" ],
    [ 0x22, "tee_local" ],
    [ 0x23, "get_global" ],
    [ 0x24, "set_global" ],
    [ 0x28, "i32.load" ],
    [ 0x29, "i64.load" ],
    [ 0x2a, "f32.load" ],
    [ 0x2b, "f64.load" ],
    [ 0x2c, "i32.load8_s" ],
    [ 0x2d, "i32.load8_u" ],
    [ 0x2e, "i32.load16_s" ],
    [ 0x2f, "i32.load16_u" ],
    [ 0x30, "i64.load8_s" ],
    [ 0x31, "i64.load8_u" ],
    [ 0x32, "i64.load16_s" ],
    [ 0x33, "i64.load16_u" ],
    [ 0x34, "i64.load32_s" ],
    [ 0x35, "i64.load32_u" ],
    [ 0x36, "i32.store" ],
    [ 0x37, "i64.store" ],
    [ 0x38, "f32.store" ],
    [ 0x39, "f64.store" ],
    [ 0x3a, "i32.store8" ],
    [ 0x3b, "i32.store16" ],
    [ 0x3c, "i64.store8" ],
    [ 0x3d, "i64.store16" ],
    [ 0x3e, "i64.store32" ],
    [ 0x3f, "current_memory" ],
    [ 0x40, "grow_memory" ],
    [ 0x41, "i32.const" ],
    [ 0x42, "i64.const" ],
    [ 0x43, "f32.const" ],
    [ 0x44, "f64.const" ],
    [ 0x45, "i32.eqz" ],
    [ 0x46, "i32.eq" ],
    [ 0x47, "i32.ne" ],
    [ 0x48, "i32.lt_s" ],
    [ 0x49, "i32.lt_u" ],
    [ 0x4a, "i32.gt_s" ],
    [ 0x4b, "i32.gt_u" ],
    [ 0x4c, "i32.le_s" ],
    [ 0x4d, "i32.le_u" ],
    [ 0x4e, "i32.ge_s" ],
    [ 0x4f, "i32.ge_u" ],
    [ 0x50, "i64.eqz" ],
    [ 0x51, "i64.eq" ],
    [ 0x52, "i64.ne" ],
    [ 0x53, "i64.lt_s" ],
    [ 0x54, "i64.lt_u" ],
    [ 0x55, "i64.gt_s" ],
    [ 0x56, "i64.gt_u" ],
    [ 0x57, "i64.le_s" ],
    [ 0x58, "i64.le_u" ],
    [ 0x59, "i64.ge_s" ],
    [ 0x5a, "i64.ge_u" ],
    [ 0x5b, "f32.eq" ],
    [ 0x5c, "f32.ne" ],
    [ 0x5d, "f32.lt" ],
    [ 0x5e, "f32.gt" ],
    [ 0x5f, "f32.le" ],
    [ 0x60, "f32.ge" ],
    [ 0x61, "f64.eq" ],
    [ 0x62, "f64.ne" ],
    [ 0x63, "f64.lt" ],
    [ 0x64, "f64.gt" ],
    [ 0x65, "f64.le" ],
    [ 0x66, "f64.ge" ],
    [ 0x67, "i32.clz" ],
    [ 0x68, "i32.ctz" ],
    [ 0x69, "i32.popcnt" ],
    [ 0x6a, "i32.add" ],
    [ 0x6b, "i32.sub" ],
    [ 0x6c, "i32.mul" ],
    [ 0x6d, "i32.div_s" ],
    [ 0x6e, "i32.div_u" ],
    [ 0x6f, "i32.rem_s" ],
    [ 0x70, "i32.rem_u" ],
    [ 0x71, "i32.and" ],
    [ 0x72, "i32.or" ],
    [ 0x73, "i32.xor" ],
    [ 0x74, "i32.shl" ],
    [ 0x75, "i32.shr_s" ],
    [ 0x76, "i32.shr_u" ],
    [ 0x77, "i32.rotl" ],
    [ 0x78, "i32.rotr" ],
    [ 0x79, "i64.clz" ],
    [ 0x7a, "i64.ctz" ],
    [ 0x7b, "i64.popcnt" ],
    [ 0x7c, "i64.add" ],
    [ 0x7d, "i64.sub" ],
    [ 0x7e, "i64.mul" ],
    [ 0x7f, "i64.div_s" ],
    [ 0x80, "i64.div_u" ],
    [ 0x81, "i64.rem_s" ],
    [ 0x82, "i64.rem_u" ],
    [ 0x83, "i64.and" ],
    [ 0x84, "i64.or" ],
    [ 0x85, "i64.xor" ],
    [ 0x86, "i64.shl" ],
    [ 0x87, "i64.shr_s" ],
    [ 0x88, "i64.shr_u" ],
    [ 0x89, "i64.rotl" ],
    [ 0x8a, "i64.rotr" ],
    [ 0x8b, "f32.abs" ],
    [ 0x8c, "f32.neg" ],
    [ 0x8d, "f32.ceil" ],
    [ 0x8e, "f32.floor" ],
    [ 0x8f, "f32.trunc" ],
    [ 0x90, "f32.nearest" ],
    [ 0x91, "f32.sqrt" ],
    [ 0x92, "f32.add" ],
    [ 0x93, "f32.sub" ],
    [ 0x94, "f32.mul" ],
    [ 0x95, "f32.div" ],
    [ 0x96, "f32.min" ],
    [ 0x97, "f32.max" ],
    [ 0x98, "f32.copysign" ],
    [ 0x99, "f64.abs" ],
    [ 0x9a, "f64.neg" ],
    [ 0x9b, "f64.ceil" ],
    [ 0x9c, "f64.floor" ],
    [ 0x9d, "f64.trunc" ],
    [ 0x9e, "f64.nearest" ],
    [ 0x9f, "f64.sqrt" ],
    [ 0xa0, "f64.add" ],
    [ 0xa1, "f64.sub" ],
    [ 0xa2, "f64.mul" ],
    [ 0xa3, "f64.div" ],
    [ 0xa4, "f64.min" ],
    [ 0xa5, "f64.max" ],
    [ 0xa6, "f64.copysign" ],
    [ 0xa7, "i32.wrap_i64" ],
    [ 0xa8, "i32.trunc_f32_s" ],
    [ 0xa9, "i32.trunc_f32_u" ],
    [ 0xaa, "i32.trunc_f64_s" ],
    [ 0xab, "i32.trunc_f64_u" ],
    [ 0xac, "i64.extend_i32_s" ],
    [ 0xad, "i64.extend_i32_u" ],
    [ 0xae, "i64.trunc_f32_s" ],
    [ 0xaf, "i64.trunc_f32_u" ],
    [ 0xb0, "i64.trunc_f64_s" ],
    [ 0xb1, "i64.trunc_f64_u" ],
    [ 0xb2, "f32.convert_i32_s" ],
    [ 0xb3, "f32.convert_i32_u" ],
    [ 0xb4, "f32.convert_i64_s" ],
    [ 0xb5, "f32.convert_i64_u" ],
    [ 0xb6, "f32.demote_f64" ],
    [ 0xb7, "f64.convert_i32_s" ],
    [ 0xb8, "f64.convert_i32_u" ],
    [ 0xb9, "f64.convert_i64_s" ],
    [ 0xba, "f64.convert_i64_u" ],
    [ 0xbb, "f64.promote_f32" ],
    [ 0xbc, "i32.reinterpret_f32" ],
    [ 0xbd, "i64.reinterpret_f64" ],
    [ 0xbe, "f32.reinterpret_i32" ],
    [ 0xbf, "f64.reinterpret_i64" ],
    [ 0xc0, "i32.extend8_s" ],
    [ 0xc1, "i32.extend16_s" ],
    [ 0xc2, "i64.extend8_s" ],
    [ 0xc3, "i64.extend16_s" ],
    [ 0xc4, "i64.extend32_s" ],
    [ 0x00fc, "i32.trunc_sat_f32_s" ],
    [ 0x01fc, "i32.trunc_sat_f32_u" ],
    [ 0x02fc, "i32.trunc_sat_f64_s" ],
    [ 0x03fc, "i32.trunc_sat_f64_u" ],
    [ 0x04fc, "i64.trunc_sat_f32_s" ],
    [ 0x05fc, "i64.trunc_sat_f32_u" ],
    [ 0x06fc, "i64.trunc_sat_f64_s" ],
    [ 0x07fc, "i64.trunc_sat_f64_u" ]
  ]);


// Linear bytecode textual representation

const opnames = new Map();  // string :=> uint8
opcodes.forEach((...kv) => opnames.set(...kv));

// N -> string
function fmtimm (n) {
  switch (n.t) {
    case t.uint8:
    case t.uint16:
    case t.uint32:
    case t.varuint1:
    case t.varuint7:
    case t.varuint32:
    case t.varint32:
    case t.varint64:
    case t.float32:
    case t.float64: return n.v.toString(10)
    case t.varint7: return readVarInt7(n.v).toString(10)
    case t.type: switch (n.v) {
      case -1:    return 'i32'
      case -2:    return 'i64'
      case -3:    return 'f32'
      case -4:    return 'f64'
      case -0x10: return 'anyfunc'
      case -0x20: return 'func'
      case -0x40: return 'void'
      default: throw new Error('unexpected type ' + n.t.toString())
    }
    default: throw new Error('unexpected imm ' + n.t.toString())
  }
}
// Op -> uint8 | uint16
function opToNum (op) {
  switch (op.length) {
    case 1: return op[0];
    case 2: return new Uint16Array(op.buffer)[0]
  }
}
// [N] -> string
function fmtimmv (ns) { return ns.map(n => " " + fmtimm(n)).join("") }
// ([N], Ctx, number) -> IO string
function visitOps (nodes, c, depth) { for (let n of nodes) visitOp(n, c, depth) }
// (N, Ctx, number) -> IO string
function visitOp (n, c, depth) {
  switch (n.t) {
    case t.instr:
      if (n.v == 0x0b /*end*/ || n.v == 0x05 /*else*/) depth--;
      return c.writeln(depth, opcodes.get(opToNum(n.v)))
    case t.instr_imm1:
      return c.writeln(depth, opcodes.get(opToNum(n.v)) + " " + fmtimm(n.imm))
    case t.instr_pre:
      visitOps(n.pre, c, depth);
      return c.writeln(depth, opcodes.get(opToNum(n.v)))
    case t.instr_pre1:
      visitOp(n.pre, c, depth);
      return c.writeln(depth, opcodes.get(opToNum(n.v)))
    case t.instr_imm1_post:
      c.writeln(depth, opcodes.get(opToNum(n.v)) + " " + fmtimm(n.imm));
      return visitOps(n.post, c, depth + n.v.length)
    case t.instr_pre_imm:
      visitOps(n.pre, c, depth);
      return c.writeln(depth, opcodes.get(opToNum(n.v)) + fmtimmv(n.imm))
    case t.instr_pre_imm_post:
      visitOps(n.pre, c, depth);
      c.writeln(depth, opcodes.get(opToNum(n.v)) + fmtimmv(n.imm));
      visitOps(n.post, c, depth + n.v.length); break;
    default: console.error("Unexpected op " + n.t.toString(),
      n.v.reduce((s, b) => s + b.toString(16).padStart(2, "0"), "0x"))
  }
}
// ([N], Writer) -> Writer string
function printCode (instructions, writer) {
  const ctx = { writeln (depth, chunk) { writer("  ".repeat(depth) + chunk + "\n") } };
  visitOps(instructions, ctx, 0)
}

export { T as t, c, get, sect_id, Emitter, printCode };