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
  writeU64 (v) { // BigInt
    this.view.setBigUint64(this.length, v, true);
    this.length += 8;
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
  uint8:          Symbol('u8'),
  uint16:         Symbol('u16'),
  uint32:         Symbol('u32'),
  varuint1:       Symbol('vu1'),
  varuint7:       Symbol('vu7'),
  varuint32:      Symbol('vu32'),
  varint7:        Symbol('vs7'),
  varint32:       Symbol('vs32'),
  varint64:       Symbol('vs64'),
  float32:        Symbol('f32'), // non-standard
  float64:        Symbol('f64'), // non-standard
  vec128:         Symbol('v128'),
  prefix:         Symbol('prefix'), // non-standard
  data:           Symbol('data'), // non-standard
  type:           Symbol('type'), // non-standard, signifies a varint7 type constant
  external_kind:  Symbol('type'),
  reference_kind: Symbol('type'),

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
  comp_type:        Symbol('comp_type'),
  func_type:        Symbol('func_type'),
  table_type:       Symbol('table_type'),
  memory_type:      Symbol('memory_type'),
  global_type:      Symbol('global_type'),
  tag_type:         Symbol("tag_type"),
  resizable_limits: Symbol('resizable_limits'),
  global_variable:  Symbol('global_variable'),
  init_expr:        Symbol('init_expr'),
  elem_segment:     Symbol('elem_segment'),
  elem_expr:        Symbol('elem_expr'),
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

// (val_atom uint64) u64_atom => u64_atom
class u64_atom extends val_atom {
  // biguint64 -> u64_atom
  constructor (v) { super(T.biguint64, 8, v) }
  emit (e) { return e.writeU64(this.v) }
}

// (val_atom float64) f64_atom => f64_atom
class f64_atom extends val_atom {
  // number -> f64_atom
  constructor (v) { super(T.float64, 8, v) }
  emit (e) { return e.writeF64(this.v) }
}

// ([val_atom] vec128) v128_atom => v128_atom
class v128_atom extends val_atom {
  // number -> v128_atom
  constructor (v) { super(T.vec128, 16, v) }
  emit (e) { return e.writeBytes(this.v) }
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
  constructor (t, [op, prefix], mbResult, z) { this.t = t; this.z = z; this.p = prefix; this.v = op; this.r = mbResult }
  emit (e) { return e }
}

// instr_cell instr_pre1 => instr_pre1
class instr_pre1 extends instr_cell {
  // (uint8 | uint16, AnyResult, N) -> instr_pre1
  constructor (op, mbResult, pre) {
    super(T.instr_pre1, op, mbResult, op.length + pre.z);
    this.pre = pre
  }
  emit (e) { return this.p === undefined ?
    this.pre.emit(e).writeU8(this.v) :
    this.pre.emit(e).writeU8(this.p).writeU8(this.v) }
}

// instr_cell instr_imm1 => instr_imm1
class instr_imm1 extends instr_cell {
  // (uint8 | uint16, AnyResult, N) -> instr_imm1
  constructor (op, mbResult, imm) {
    super(T.instr_imm1, op, mbResult, op.length + imm.z);
    this.imm = imm
  }
  emit (e) { return this.p === undefined ?
    this.imm.emit(e.writeU8(this.v)) :
    this.imm.emit(e.writeU8(this.p).writeU8(this.v)) }
}

// instr_cell instr_pre => instr_pre
class instr_pre extends instr_cell {
  // (uint8 | uint16, AnyResult, [N]) -> instr_pre
  constructor (op, mbResult, pre) {
    super(T.instr_pre, op, mbResult, op.length + sumz(pre));
    this.pre = pre
  }
  emit (e) { return this.p === undefined ?
    writev(e, this.pre).writeU8(this.v) :
    writev(e, this.pre).writeU8(this.p).writeU8(this.v) }
}

// instr_cell instr_imm1_post => instr_imm1_post
class instr_imm1_post extends instr_cell {
  // (uint8 | uint16, R as N, [N]) -> instr_imm1_post
  constructor (op, imm, post) {
    super(T.instr_imm1_post, op, imm, op.length + imm.z + sumz(post));
    this.imm = imm; this.post = post
  }
  emit (e) { return this.p === undefined ?
    writev(this.imm.emit(e.writeU8(this.v)), this.post) :
    writev(this.imm.emit(e.writeU8(this.p).writeU8(this.v)), this.post) }
}

// instr_cell instr_pre_imm => instr_pre_imm
class instr_pre_imm extends instr_cell {
  // (uint8 | uint16, AnyResult, [N], [N])
  constructor (op, mbResult, pre, imm) {
    super(T.instr_pre_imm, op, mbResult, op.length + sumz(pre) + sumz(imm));
    this.pre = pre; this.imm = imm
  }
  emit (e) { return this.p === undefined ?
    writev(writev(e, this.pre).writeU8(this.v), this.imm) :
    writev(writev(e, this.pre).writeU8(this.p).writeU8(this.v), this.imm) }
}

// instr_pre_imm_post : instr_cell
class instr_pre_imm_post extends instr_cell {
  // (uint8 | uint16, AnyResult, [N], [N], [N])
  constructor (op, mbResult, pre, imm, post) {
    super(T.instr_pre_imm_post, op, mbResult, op.length + sumz(pre) + sumz(imm) + sumz(post));
    this.pre = pre; this.imm = imm; this.post = post
  }
  emit (e) { return this.p === undefined ?
    writev(writev(writev(e, this.pre).writeU8(this.v), this.imm), this.post) :
    writev(writev(writev(e, this.pre).writeU8(this.p).writeU8(this.v), this.imm), this.post) }
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
function biguint64 (v) { return new u64_atom(v) }  // biguint64 -> BigUint64
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
// Vector packing
function vari8x16 (value) {
  assert(value.length === 16 && value.BYTES_PER_ELEMENT === 1,
    "length", value.length, "!== 16 || bytes_per_element", value.BYTES_PER_ELEMENT, "!== 1");
  return new v128_atom(value)
}
function vari16x8 (value) {
  assert(value.length === 8 && value.BYTES_PER_ELEMENT === 2,
    "length", value.length, "!== 8 || bytes_per_element", value.BYTES_PER_ELEMENT, "!== 2");
  return new v128_atom(new Uint8Array(value.buffer))
}
function vari32x4 (value) {
  assert(value.length === 4 && value.BYTES_PER_ELEMENT === 4,
    "length", value.length, "!== 4 || bytes_per_element", value.BYTES_PER_ELEMENT, "!== 4");
  return new v128_atom(new Uint8Array(value.buffer))
}
function vari64x2 (value) {
  assert(value.length === 2 && value.BYTES_PER_ELEMENT === 8,
    "length", value.length, "!== 2 || bytes_per_element", value.BYTES_PER_ELEMENT, "!== 8");
  return new v128_atom(new Uint8Array(value.buffer))
}
function varf32x4 (value) {
  assert(value.length === 4 && value.BYTES_PER_ELEMENT === 4,
    "length", value.length, "!== 4 || bytes_per_element", value.BYTES_PER_ELEMENT, "!== 4");
  return new v128_atom(new Uint8Array(value.buffer))
}
function varf64x2 (value) {
  assert(value.length === 2 && value.BYTES_PER_ELEMENT === 8,
    "length", value.length, "!== 2 || bytes_per_element", value.BYTES_PER_ELEMENT, "!== 8");
  return new v128_atom(new Uint8Array(value.buffer))
}


// Language types
function ref (heapType) {
  return new instr_imm1([0x64], T.reference_kind, heapType)
}
function ref_null (heapType) {
  return new instr_imm1([0x63], T.reference_kind, heapType)
}
const
  Arr = new type_atom(-0x22, 0x5E),    // Array
  Struct = new type_atom(-0x21, 0x5F), // Struct
  Func = new type_atom(-0x20, 0x60),   // Func
  Void = new type_atom(-0x40, 0x40),   // Void
  Heap = {
    Func: new type_atom(-0x10, 0x70),   // Func ref
    Extern: new type_atom(-0x11, 0x6F)  // Extern ref
  },

  external_kind_function = new u8_atom(T.external_kind, 0),  // ExternalKind
  external_kind_table = new u8_atom(T.external_kind, 1),  // ExternalKind
  external_kind_memory = new u8_atom(T.external_kind, 2),  // ExternalKind
  external_kind_global = new u8_atom(T.external_kind, 3),  // ExternalKind
  external_kind_tag = new u8_atom(T.external_kind, 4),  // ExternalKind

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
  sect_id_datacount = varuint7(12),
  sect_id_tag = varuint7(13),
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
    datacount: sect_id_datacount,
    tag: sect_id_tag
  };

// (VarUint7, N, [N]) -> Cell N
function section (id, imm, payload) {
  return new cell(T.section, [id, varuint32(imm.z + sumz(payload)), imm, ...payload])
}


const
  // R : Result => (OpCode, R, MemImm, Op Int) -> Op R
  memload = (op, r, mi, addr) => new instr_pre_imm(op, r, [addr], mi),
  memload_lane = (op, r, [a, o], lane, addr) => new instr_pre_imm([op, 0xfd], r, [addr], [a, o, lane]),
  // (OpCode, MemImm, Op Int, Op Result) -> Op Void
  memstore = (op, mi, addr, v) => new instr_pre_imm(op, Void, [addr, v], mi),
  memstore_lane = (op, [a, o], lane, addr, v) => new instr_pre_imm([op, 0xfd], r, [addr, v], [a, o, lane]),

  // R : Result => (OpCode, R, Op R) -> Op R
  unop = (op, r, v) => new instr_pre1(op, r, v),
  // R : Result => (OpCode, R, Op R, Op R) -> Op R
  binop = (op, r, a, b) => new instr_pre(op, r, [a, b]),
  // R : Result => (OpCode, R, Op R, Op R, Op R) -> Op R
  ternop = (op, r, a, b, c) => new instr_pre(op, r, [a, b, c]),
  // R : Result => (OpCode, R, Op R) -> Op I32
  testop = (op, v) => new instr_pre1(op, c.i32, v),
  // R : Result => (OpCode, R, Op R, Op R) -> Op I32
  relop = (op, a, b) => new instr_pre(op, c.i32, [a, b]),
  // Return value is equivalent to a load op
  // R : Result => (OpCode, R, MemImm, Op Int, Op R) -> Op R
  rmw_atomic = (op, r, mi, addr, v) => new instr_pre_imm([op, 0xfe], r, [addr, v], mi),

  // (uint32, uint32, number, number) -> boolean
  // natAl and al should be encoded as log2(bytes)  - ?? check this in reference
  addrIsAligned = (natAl, al, offs, addr) => al <= natAl && ((addr + offs) % [1, 2, 4, 8][al]) == 0,

  // TODO cvtop?
  // (OpCode, AnyResult, N) -> Op R
  trunc_sat = (op, r, a) => new instr_pre1([op, 0xfc], r, a);


// type_atom i32ops => i32ops : I32ops
class i32ops extends type_atom {
  // Constants
  constv (v) { return new instr_imm1([0x41], this, v) }                           // VarInt32 -> Op I32
  const (v) { return this.constv(varint32(v)) }                                   // int32 -> Op I32

  // Memory
  load (mi, addr) { return memload([0x28], this, mi, addr) }                      // (MemImm, Op Int) -> Op I32
  load8_s (mi, addr) { return memload([0x2c], this, mi, addr) }                   // (MemImm, Op Int) -> Op I32
  load8_u (mi, addr) { return memload([0x2d], this, mi, addr) }                   // (MemImm, Op Int) -> Op I32
  load16_s (mi, addr) { return memload([0x2e], this, mi, addr) }                  // (MemImm, Op Int) -> Op I32
  load16_u (mi, addr) { return memload([0x2f], this, mi, addr) }                  // (MemImm, Op Int) -> Op I32
  store (mi, addr, v) { return memstore([0x36], mi, addr, v) }                    // (MemImm, Op Int, Op I32) -> Op Void
  store8 (mi, addr, v) { return memstore([0x3a], mi, addr, v) }                   // (MemImm, Op Int, Op I32) -> Op Void
  store16 (mi, addr, v) { return memstore([0x3b], mi, addr, v) }                  // (MemImm, Op Int, Op I32) -> Op Void
  addrIsAligned (mi, addr) { return addrIsAligned(2, mi[0].v, mi[1].v, addr) }    // (MemImm, number) -> boolean

  // Comparison
  eqz (a) { return testop([0x45], a) }                                            // Op I32 -> Op I32
  eq (a, b) { return relop([0x46], a, b) }                                        // (Op I32, Op I32) -> Op I32
  ne (a, b) { return relop([0x47], a, b) }                                        // (Op I32, Op I32) -> Op I32
  lt_s (a, b) { return relop([0x48], a, b) }                                      // (Op I32, Op I32) -> Op I32
  lt_u (a, b) { return relop([0x49], a, b) }                                      // (Op I32, Op I32) -> Op I32
  gt_s (a, b) { return relop([0x4a], a, b) }                                      // (Op I32, Op I32) -> Op I32
  gt_u (a, b) { return relop([0x4b], a, b) }                                      // (Op I32, Op I32) -> Op I32
  le_s (a, b) { return relop([0x4c], a, b) }                                      // (Op I32, Op I32) -> Op I32
  le_u (a, b) { return relop([0x4d], a, b) }                                      // (Op I32, Op I32) -> Op I32
  ge_s (a, b) { return relop([0x4e], a, b) }                                      // (Op I32, Op I32) -> Op I32
  ge_u (a, b) { return relop([0x4f], a, b) }                                      // (Op I32, Op I32) -> Op I32

  // Numeric
  clz (a) { return unop([0x67], this, a) }                                        // Op I32 -> Op I32
  ctz (a) { return unop([0x68], this, a) }                                        // Op I32 -> Op I32
  popcnt (a) { return unop([0x69], this, a) }                                     // Op I32 -> Op I32
  add (a, b) { return binop([0x6a], this, a, b) }                                 // (Op I32, Op I32) -> Op I32
  sub (a, b) { return binop([0x6b], this, a, b) }                                 // (Op I32, Op I32) -> Op I32
  mul (a, b) { return binop([0x6c], this, a, b) }                                 // (Op I32, Op I32) -> Op I32
  div_s (a, b) { return binop([0x6d], this, a, b) }                               // (Op I32, Op I32) -> Op I32
  div_u (a, b) { return binop([0x6e], this, a, b) }                               // (Op I32, Op I32) -> Op I32
  rem_s (a, b) { return binop([0x6f], this, a, b) }                               // (Op I32, Op I32) -> Op I32
  rem_u (a, b) { return binop([0x70], this, a, b) }                               // (Op I32, Op I32) -> Op I32
  and (a, b) { return binop([0x71], this, a, b) }                                 // (Op I32, Op I32) -> Op I32
  or (a, b) { return binop([0x72], this, a, b) }                                  // (Op I32, Op I32) -> Op I32
  xor (a, b) { return binop([0x73], this, a, b) }                                 // (Op I32, Op I32) -> Op I32
  shl (a, b) { return binop([0x74], this, a, b) }                                 // (Op I32, Op I32) -> Op I32
  shr_s (a, b) { return binop([0x75], this, a, b) }                               // (Op I32, Op I32) -> Op I32
  shr_u (a, b) { return binop([0x76], this, a, b) }                               // (Op I32, Op I32) -> Op I32
  rotl (a, b) { return binop([0x77], this, a, b) }                                // (Op I32, Op I32) -> Op I32
  rotr (a, b) { return binop([0x78], this, a, b) }                                // (Op I32, Op I32) -> Op I32

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

  // Sign-extension operations
  extend8_s (a) { return new instr_pre1([0xc0], this, a) }                        // Op I32 -> Op I32
  extend16_s (a) { return new instr_pre1([0xc1], this, a) }                       // Op I32 -> Op I32

  // Atomic operations
  atomic_load (mi, addr) { return memload([0x10, 0xfe], this, mi, addr) }         // (MemImm, Op Int) -> Op I32
  atomic_load8_u (mi, addr) { return memload([0x12, 0xfe], this, mi, addr) }      // (MemImm, Op Int) -> Op I32
  atomic_load16_u (mi, addr) { return memload([0x13, 0xfe], this, mi, addr) }     // (MemImm, Op Int) -> Op I32
  atomic_store (mi, addr, v) { return memstore([0x17, 0xfe], mi, addr, v) }       // (MemImm, Op Int, Op I32) -> Op Void
  atomic_store8_u (mi, addr, v) { return memstore([0x19, 0xfe], mi, addr, v) }    // (MemImm, Op Int, Op I32) -> Op Void
  atomic_store16_u (mi, addr, v) { return memstore([0x1a, 0xfe], mi, addr, v) }   // (MemImm, Op Int, Op I32) -> Op Void

  atomic_add (mi, addr, v) { return rmw_atomic(0x1e, this, mi, addr, v) }         // (MemImm, Op Int, Op I32) -> Op I32
  atomic_add8_u (mi, addr, v) { return rmw_atomic(0x20, this, mi, addr, v) }      // (MemImm, Op Int, Op I32) -> Op I32
  atomic_add16_u (mi, addr, v) { return rmw_atomic(0x21, this, mi, addr, v) }     // (MemImm, Op Int, Op I32) -> Op I32
  atomic_sub (mi, addr, v) { return rmw_atomic(0x25, this, mi, addr, v) }         // (MemImm, Op Int, Op I32) -> Op I32
  atomic_sub8_u (mi, addr, v) { return rmw_atomic(0x27, this, mi, addr, v) }      // (MemImm, Op Int, Op I32) -> Op I32
  atomic_sub16_u (mi, addr, v) { return rmw_atomic(0x28, this, mi, addr, v) }     // (MemImm, Op Int, Op I32) -> Op I32
  atomic_and (mi, addr, v) { return rmw_atomic(0x2c, this, mi, addr, v) }         // (MemImm, Op Int, Op I32) -> Op I32
  atomic_and8_u (mi, addr, v) { return rmw_atomic(0x2e, this, mi, addr, v) }      // (MemImm, Op Int, Op I32) -> Op I32
  atomic_and16_u (mi, addr, v) { return rmw_atomic(0x2f, this, mi, addr, v) }     // (MemImm, Op Int, Op I32) -> Op I32
  atomic_or (mi, addr, v) { return rmw_atomic(0x33, this, mi, addr, v) }          // (MemImm, Op Int, Op I32) -> Op I32
  atomic_or8_u (mi, addr, v) { return rmw_atomic(0x35, this, mi, addr, v) }       // (MemImm, Op Int, Op I32) -> Op I32
  atomic_or16_u (mi, addr, v) { return rmw_atomic(0x36, this, mi, addr, v) }      // (MemImm, Op Int, Op I32) -> Op I32
  atomic_xor (mi, addr, v) { return rmw_atomic(0x3a, this, mi, addr, v) }         // (MemImm, Op Int, Op I32) -> Op I32
  atomic_xor8_u (mi, addr, v) { return rmw_atomic(0x3c, this, mi, addr, v) }      // (MemImm, Op Int, Op I32) -> Op I32
  atomic_xor16_u (mi, addr, v) { return rmw_atomic(0x3d, this, mi, addr, v) }     // (MemImm, Op Int, Op I32) -> Op I32
  atomic_xchg (mi, addr, v) { return rmw_atomic(0x41, this, mi, addr, v) }        // (MemImm, Op Int, Op I32) -> Op I32
  atomic_xchg8_u (mi, addr, v) { return rmw_atomic(0x43, this, mi, addr, v) }     // (MemImm, Op Int, Op I32) -> Op I32
  atomic_xchg16_u (mi, addr, v) { return rmw_atomic(0x44, this, mi, addr, v) }    // (MemImm, Op Int, Op I32) -> Op I32
  atomic_cmpxchg (mi, addr, expect, v) {
    return new instr_pre_imm([0x48, 0xfe], this, [addr, expect, v], mi) }         // (MemImm, Op Int, Op I32, Op I32) -> Op I32
  atomic_cmpxchg8_u (mi, addr, expect, v) {
    return new instr_pre_imm([0x4a, 0xfe], this, [addr, expect, v], mi) }         // (MemImm, Op Int, Op I32, Op I32) -> Op I32
  atomic_cmpxchg16_u (mi, addr, expect, v) {
    return new instr_pre_imm([0x4b, 0xfe], this, [addr, expect, v], mi) }         // (MemImm, Op Int, Op I32, Op I32) -> Op I32
}

// type_atom i64ops => i64ops : I64ops
class i64ops extends type_atom {
  // Constants
  constv (v) { return new instr_imm1([0x42], this, v) }                           // VarInt64 -> Op I64
  const (v) { return this.constv(varint64(BigInt(v))) }                           // int64 -> Op I64

  // Memory
  load (mi, addr) { return memload([0x29], this, mi, addr) }                      // (MemImm, Op Int) -> Op I64
  load8_s (mi, addr) { return memload([0x30], this, mi, addr) }                   // (MemImm, Op Int) -> Op I64
  load8_u (mi, addr) { return memload([0x31], this, mi, addr) }                   // (MemImm, Op Int) -> Op I64
  load16_s (mi, addr) { return memload([0x32], this, mi, addr) }                  // (MemImm, Op Int) -> Op I64
  load16_u (mi, addr) { return memload([0x33], this, mi, addr) }                  // (MemImm, Op Int) -> Op I64
  load32_s (mi, addr) { return memload([0x34], this, mi, addr) }                  // (MemImm, Op Int) -> Op I64
  load32_u (mi, addr) { return memload([0x35], this, mi, addr) }                  // (MemImm, Op Int) -> Op I64
  store (mi, addr, v) { return memstore([0x37], mi, addr, v) }                    // (MemImm, Op Int, Op I64) -> Op Void
  store8 (mi, addr, v) { return memstore([0x3c], mi, addr, v) }                   // (MemImm, Op Int, Op I64) -> Op Void
  store16 (mi, addr, v) { return memstore([0x3d], mi, addr, v) }                  // (MemImm, Op Int, Op I64) -> Op Void
  store32 (mi, addr, v) { return memstore([0x3e], mi, addr, v) }                  // (MemImm, Op Int, Op I64) -> Op Void
  addrIsAligned (mi, addr) { return addrIsAligned(3, mi[0].v, mi[1].v, addr) }    // (MemImm, number) -> boolean

  // Comparison
  eqz (a) { return testop([0x50], a) }                                            // Op I64 -> Op I32
  eq (a, b) { return relop([0x51], a, b) }                                        // (Op I64, Op I64) -> Op I32
  ne (a, b) { return relop([0x52], a, b) }                                        // (Op I64, Op I64) -> Op I32
  lt_s (a, b) { return relop([0x53], a, b) }                                      // (Op I64, Op I64) -> Op I32
  lt_u (a, b) { return relop([0x54], a, b) }                                      // (Op I64, Op I64) -> Op I32
  gt_s (a, b) { return relop([0x55], a, b) }                                      // (Op I64, Op I64) -> Op I32
  gt_u (a, b) { return relop([0x56], a, b) }                                      // (Op I64, Op I64) -> Op I32
  le_s (a, b) { return relop([0x57], a, b) }                                      // (Op I64, Op I64) -> Op I32
  le_u (a, b) { return relop([0x58], a, b) }                                      // (Op I64, Op I64) -> Op I32
  ge_s (a, b) { return relop([0x59], a, b) }                                      // (Op I64, Op I64) -> Op I32
  ge_u (a, b) { return relop([0x5a], a, b) }                                      // (Op I64, Op I64) -> Op I32

  // Numeric
  clz (a) { return unop([0x79], this, a) }                                        // Op I64 -> Op I64
  ctz (a) { return unop([0x7a], this, a) }                                        // Op I64 -> Op I64
  popcnt (a) { return unop([0x7b], this, a) }                                     // Op I64 -> Op I64
  add (a, b) { return binop([0x7c], this, a, b) }                                 // (Op I64, Op I64) -> Op I64
  sub (a, b) { return binop([0x7d], this, a, b) }                                 // (Op I64, Op I64) -> Op I64
  mul (a, b) { return binop([0x7e], this, a, b) }                                 // (Op I64, Op I64) -> Op I64
  div_s (a, b) { return binop([0x7f], this, a, b) }                               // (Op I64, Op I64) -> Op I64
  div_u (a, b) { return binop([0x80], this, a, b) }                               // (Op I64, Op I64) -> Op I64
  rem_s (a, b) { return binop([0x81], this, a, b) }                               // (Op I64, Op I64) -> Op I64
  rem_u (a, b) { return binop([0x82], this, a, b) }                               // (Op I64, Op I64) -> Op I64
  and (a, b) { return binop([0x83], this, a, b) }                                 // (Op I64, Op I64) -> Op I64
  or (a, b) { return binop([0x84], this, a, b) }                                  // (Op I64, Op I64) -> Op I64
  xor (a, b) { return binop([0x85], this, a, b) }                                 // (Op I64, Op I64) -> Op I64
  shl (a, b) { return binop([0x86], this, a, b) }                                 // (Op I64, Op I64) -> Op I64
  shr_s (a, b) { return binop([0x87], this, a, b) }                               // (Op I64, Op I64) -> Op I64
  shr_u (a, b) { return binop([0x88], this, a, b) }                               // (Op I64, Op I64) -> Op I64
  rotl (a, b) { return binop([0x89], this, a, b) }                                // (Op I64, Op I64) -> Op I64
  rotr (a, b) { return binop([0x8a], this, a, b) }                                // (Op I64, Op I64) -> Op I64

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

  // Sign-extension operations
  extend8_s (a) { return new instr_pre1([0xc2], this, a) }                        // Op I64 -> Op I64
  extend16_s (a) { return new instr_pre1([0xc3], this, a) }                       // Op I64 -> Op I64
  extend32_s (a) { return new instr_pre1([0xc4], this, a) }                       // Op I64 -> Op I64

  // Atomic operations
  atomic_load (mi, addr) { return memload([0x11, 0xfe], this, mi, addr) }         // (MemImm, Op Int) -> Op I32
  atomic_load8_u (mi, addr) { return memload([0x14, 0xfe], this, mi, addr) }      // (MemImm, Op Int) -> Op I32
  atomic_load16_u (mi, addr) { return memload([0x15, 0xfe], this, mi, addr) }     // (MemImm, Op Int) -> Op I32
  atomic_load32_u (mi, addr) { return memload([0x16, 0xfe], this, mi, addr) }     // (MemImm, Op Int) -> Op I32
  atomic_store (mi, addr, v) { return memstore([0x18, 0xfe], mi, addr, v) }       // (MemImm, Op Int, Op I32) -> Op Void
  atomic_store8_u (mi, addr, v) { return memstore([0x1b, 0xfe], mi, addr, v) }    // (MemImm, Op Int, Op I32) -> Op Void
  atomic_store16_u (mi, addr, v) { return memstore([0x1c, 0xfe], mi, addr, v) }   // (MemImm, Op Int, Op I32) -> Op Void
  atomic_store32_u (mi, addr, v) { return memstore([0x1d, 0xfe], mi, addr, v) }   // (MemImm, Op Int, Op I32) -> Op Void

  atomic_add (mi, addr, v) { return rmw_atomic(0x1f, this, mi, addr, v) }         // (MemImm, Op Int, Op I32) -> Op I32
  atomic_add8_u (mi, addr, v) { return rmw_atomic(0x22, this, mi, addr, v) }      // (MemImm, Op Int, Op I32) -> Op I32
  atomic_add16_u (mi, addr, v) { return rmw_atomic(0x23, this, mi, addr, v) }     // (MemImm, Op Int, Op I32) -> Op I32
  atomic_add32_u (mi, addr, v) { return rmw_atomic(0x24, this, mi, addr, v) }     // (MemImm, Op Int, Op I32) -> Op I32
  atomic_sub (mi, addr, v) { return rmw_atomic(0x26, this, mi, addr, v) }         // (MemImm, Op Int, Op I32) -> Op I32
  atomic_sub8_u (mi, addr, v) { return rmw_atomic(0x29, this, mi, addr, v) }      // (MemImm, Op Int, Op I32) -> Op I32
  atomic_sub16_u (mi, addr, v) { return rmw_atomic(0x2a, this, mi, addr, v) }     // (MemImm, Op Int, Op I32) -> Op I32
  atomic_sub32_u (mi, addr, v) { return rmw_atomic(0x2b, this, mi, addr, v) }     // (MemImm, Op Int, Op I32) -> Op I32
  atomic_and (mi, addr, v) { return rmw_atomic(0x2d, this, mi, addr, v) }         // (MemImm, Op Int, Op I32) -> Op I32
  atomic_and8_u (mi, addr, v) { return rmw_atomic(0x30, this, mi, addr, v) }      // (MemImm, Op Int, Op I32) -> Op I32
  atomic_and16_u (mi, addr, v) { return rmw_atomic(0x31, this, mi, addr, v) }     // (MemImm, Op Int, Op I32) -> Op I32
  atomic_and32_u (mi, addr, v) { return rmw_atomic(0x32, this, mi, addr, v) }     // (MemImm, Op Int, Op I32) -> Op I32
  atomic_or (mi, addr, v) { return rmw_atomic(0x34, this, mi, addr, v) }          // (MemImm, Op Int, Op I32) -> Op I32
  atomic_or8_u (mi, addr, v) { return rmw_atomic(0x37, this, mi, addr, v) }       // (MemImm, Op Int, Op I32) -> Op I32
  atomic_or16_u (mi, addr, v) { return rmw_atomic(0x38, this, mi, addr, v) }      // (MemImm, Op Int, Op I32) -> Op I32
  atomic_or32_u (mi, addr, v) { return rmw_atomic(0x39, this, mi, addr, v) }      // (MemImm, Op Int, Op I32) -> Op I32
  atomic_xor (mi, addr, v) { return rmw_atomic(0x3b, this, mi, addr, v) }         // (MemImm, Op Int, Op I32) -> Op I32
  atomic_xor8_u (mi, addr, v) { return rmw_atomic(0x3e, this, mi, addr, v) }      // (MemImm, Op Int, Op I32) -> Op I32
  atomic_xor16_u (mi, addr, v) { return rmw_atomic(0x3f, this, mi, addr, v) }     // (MemImm, Op Int, Op I32) -> Op I32
  atomic_xor32_u (mi, addr, v) { return rmw_atomic(0x40, this, mi, addr, v) }     // (MemImm, Op Int, Op I32) -> Op I32
  atomic_xchg (mi, addr, v) { return rmw_atomic(0x42, this, mi, addr, v) }        // (MemImm, Op Int, Op I32) -> Op I32
  atomic_xchg8_u (mi, addr, v) { return rmw_atomic(0x45, this, mi, addr, v) }     // (MemImm, Op Int, Op I32) -> Op I32
  atomic_xchg16_u (mi, addr, v) { return rmw_atomic(0x46, this, mi, addr, v) }    // (MemImm, Op Int, Op I32) -> Op I32
  atomic_xchg32_u (mi, addr, v) { return rmw_atomic(0x47, this, mi, addr, v) }    // (MemImm, Op Int, Op I32) -> Op I32
  atomic_cmpxchg (mi, addr, expect, v) {
    return new instr_pre_imm([0x49, 0xfe], this, [addr, expect, v], mi) }         // (MemImm, Op Int, Op I32, Op I32) -> Op I32
  atomic_cmpxchg8_u (mi, addr, expect, v) {
    return new instr_pre_imm([0x4c, 0xfe], this, [addr, expect, v], mi) }         // (MemImm, Op Int, Op I32, Op I32) -> Op I32
  atomic_cmpxchg16_u (mi, addr, expect, v) {
    return new instr_pre_imm([0x4d, 0xfe], this, [addr, expect, v], mi) }         // (MemImm, Op Int, Op I32, Op I32) -> Op I32
  atomic_cmpxchg32_u (mi, addr, expect, v) {
    return new instr_pre_imm([0x4e, 0xfe], this, [addr, expect, v], mi) }         // (MemImm, Op Int, Op I32, Op I32) -> Op I32
}

// type_atom f32ops => f32ops : F32ops
class f32ops extends type_atom {
  // Constants
  constv (v) { return new instr_imm1([0x43], this, v) }                           // Float32 -> Op F32
  const (v) { return this.constv(float32(v)) }                                    // float32 -> Op F32

  // Memory
  load (mi, addr) { return memload([0x2a], this, mi, addr) }                      // (MemImm, Op Int) -> F32
  store (mi, addr, v) { return memstore([0x38], mi, addr, v) }                    // (MemImm, Op Int, Op F32) -> Op Void
  addrIsAligned (mi, addr) { return addrIsAligned(2, mi[0].v, mi[1].v, addr) }    // (MemImm, number) -> boolean

  // Comparison
  eq (a, b) { return relop([0x5b], a, b) }                                        // (Op F32, Op F32) -> Op I32
  ne (a, b) { return relop([0x5c], a, b) }                                        // (Op F32, Op F32) -> Op I32
  lt (a, b) { return relop([0x5d], a, b) }                                        // (Op F32, Op F32) -> Op I32
  gt (a, b) { return relop([0x5e], a, b) }                                        // (Op F32, Op F32) -> Op I32
  le (a, b) { return relop([0x5f], a, b) }                                        // (Op F32, Op F32) -> Op I32
  ge (a, b) { return relop([0x60], a, b) }                                        // (Op F32, Op F32) -> Op I32

  // Numeric
  abs (a) { return unop([0x8b], this, a) }                                        // Op F32 -> Op F32
  neg (a) { return unop([0x8c], this, a) }                                        // Op F32 -> Op F32
  ceil (a) { return unop([0x8d], this, a) }                                       // Op F32 -> Op F32
  floor (a) { return unop([0x8e], this, a) }                                      // Op F32 -> Op F32
  trunc (a) { return unop([0x8f], this, a) }                                      // Op F32 -> Op F32
  nearest (a) { return unop([0x90], this, a) }                                    // Op F32 -> Op F32
  sqrt (a) { return unop([0x91], this, a) }                                       // Op F32 -> Op F32
  add (a, b) { return binop([0x92], this, a, b) }                                 // (Op F32, Op F32) -> Op F32
  sub (a, b) { return binop([0x93], this, a, b) }                                 // (Op F32, Op F32) -> Op F32
  mul (a, b) { return binop([0x94], this, a, b) }                                 // (Op F32, Op F32) -> Op F32
  div (a, b) { return binop([0x95], this, a, b) }                                 // (Op F32, Op F32) -> Op F32
  min (a, b) { return binop([0x96], this, a, b) }                                 // (Op F32, Op F32) -> Op F32
  max (a, b) { return binop([0x97], this, a, b) }                                 // (Op F32, Op F32) -> Op F32
  copysign (a, b) { return binop([0x98], this, a, b) }                            // (Op F32, Op F32) -> Op F32

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
  load (mi, addr) { return memload([0x2b], this, mi, addr) }                      // (MemImm, Op Int) -> F64
  store (mi, addr, v) { return memstore([0x39], mi, addr, v) }                    // (MemImm, Op Int, Op F64) -> Op Void
  addrIsAligned (mi, addr) { return addrIsAligned(3, mi[0].v, mi[1].v, addr) }    // (MemImm, number) -> boolean

  // Comparison
  eq (a, b) { return relop([0x61], a, b) }                                        // (Op F64, Op F64) -> Op I32
  ne (a, b) { return relop([0x62], a, b) }                                        // (Op F64, Op F64) -> Op I32
  lt (a, b) { return relop([0x63], a, b) }                                        // (Op F64, Op F64) -> Op I32
  gt (a, b) { return relop([0x64], a, b) }                                        // (Op F64, Op F64) -> Op I32
  le (a, b) { return relop([0x65], a, b) }                                        // (Op F64, Op F64) -> Op I32
  ge (a, b) { return relop([0x66], a, b) }                                        // (Op F64, Op F64) -> Op I32

  // Numeric
  abs (a) { return unop([0x99], this, a) }                                        // Op F64 -> Op F64
  neg (a) { return unop([0x9a], this, a) }                                        // Op F64 -> Op F64
  ceil (a) { return unop([0x9b], this, a) }                                       // Op F64 -> Op F64
  floor (a) { return unop([0x9c], this, a) }                                      // Op F64 -> Op F64
  trunc (a) { return unop([0x9d], this, a) }                                      // Op F64 -> Op F64
  nearest (a) { return unop([0x9e], this, a) }                                    // Op F64 -> Op F64
  sqrt (a) { return unop([0x9f], this, a) }                                       // Op F64 -> Op F64
  add (a, b) { return binop([0xa0], this, a, b) }                                 // (Op F64, Op F64) -> Op F64
  sub (a, b) { return binop([0xa1], this, a, b) }                                 // (Op F64, Op F64) -> Op F64
  mul (a, b) { return binop([0xa2], this, a, b) }                                 // (Op F64, Op F64) -> Op F64
  div (a, b) { return binop([0xa3], this, a, b) }                                 // (Op F64, Op F64) -> Op F64
  min (a, b) { return binop([0xa4], this, a, b) }                                 // (Op F64, Op F64) -> Op F64
  max (a, b) { return binop([0xa5], this, a, b) }                                 // (Op F64, Op F64) -> Op F64
  copysign (a, b) { return binop([0xa6], this, a, b) }                            // (Op F64, Op F64) -> Op F64

  // Conversion
  convert_s_i32 (a) { return new instr_pre1([0xb7], this, a) }                    // Op I32 -> Op F64
  convert_u_i32 (a) { return new instr_pre1([0xb8], this, a) }                    // Op I32 -> Op F64
  convert_s_i64 (a) { return new instr_pre1([0xb9], this, a) }                    // Op I64 -> Op F64
  convert_u_i64 (a) { return new instr_pre1([0xba], this, a) }                    // Op I64 -> Op F64
  promote_f64 (a) { return new instr_pre1([0xbb], this, a) }                      // Op F32 -> Op F64
  reinterpret_i64 (a) { return new instr_pre1([0xbf], this, a) }                  // Op I64 -> Op F64
}

// type_atom v128ops => v128ops : V128ops
class v128ops extends type_atom {
  // Constant
  // Value must be constructed with one of the iNxM | fNxM functions
  const (v) { return new instr_imm1([0x0c, 0xfd], this, v) }

  // Memory
  load (mi, addr) { return memload([0x00, 0xfd], this, mi, addr) }                // (MemImm, Op Int) -> Op V128
  load8x8_s (mi, addr) { return memload([0x01, 0xfd], this, mi, addr) }           // (MemImm, Op Int) -> Op V128
  load8x8_u (mi, addr) { return memload([0x02, 0xfd], this, mi, addr) }           // (MemImm, Op Int) -> Op V128
  load16x4_s (mi, addr) { return memload([0x03, 0xfd], this, mi, addr) }          // (MemImm, Op Int) -> Op V128
  load16x4_u (mi, addr) { return memload([0x04, 0xfd], this, mi, addr) }          // (MemImm, Op Int) -> Op V128
  load32x2_s (mi, addr) { return memload([0x05, 0xfd], this, mi, addr) }          // (MemImm, Op Int) -> Op V128
  load32x2_u (mi, addr) { return memload([0x06, 0xfd], this, mi, addr) }          // (MemImm, Op Int) -> Op V128
  load8_splat (mi, addr) { return memload([0x07, 0xfd], this, mi, addr) }         // (MemImm, Op Int) -> Op V128
  load16_splat (mi, addr) { return memload([0x08, 0xfd], this, mi, addr) }        // (MemImm, Op Int) -> Op V128
  load32_splat (mi, addr) { return memload([0x09, 0xfd], this, mi, addr) }        // (MemImm, Op Int) -> Op V128
  load64_splat (mi, addr) { return memload([0x0a, 0xfd], this, mi, addr) }        // (MemImm, Op Int) -> Op V128
  load8_lane (mi, lane, addr) { return memload_lane(0x54, this, mi, lane, addr) }    // (MemImm, uint8, Op Int) -> Op V128
  load16_lane (mi, lane, addr) { return memload_lane(0x55, this, mi, lane, addr) }   // (MemImm, uint8, Op Int) -> Op V128
  load32_lane (mi, lane, addr) { return memload_lane(0x56, this, mi, lane, addr) }   // (MemImm, uint8, Op Int) -> Op V128
  load64_lane (mi, lane, addr) { return memload_lane(0x57, this, mi, lane, addr) }   // (MemImm, uint8, Op Int) -> Op V128
  load32_zero (mi, addr) { return memload(0x5c, this, mi, addr) }                 // (MemImm, Op Int) -> Op V128
  load64_zero (mi, addr) { return memload(0x5d, this, mi, addr) }                 // (MemImm, Op Int) -> Op V128
  store (mi, addr, v) { return memstore([0x0b, 0xfd], mi, addr, v) }              // (MemImm, Op Int, Op Result) -> Op Void
  store8_lane (mi, lane, addr, v) { return memstore_lane(0x58, mi, lane, addr, v) }  // (MemImm, uint8, Op Int, Op Result) -> Op Void
  store16_lane (mi, lane, addr, v) { return memstore_lane(0x59, mi, lane, addr, v) } // (MemImm, uint8, Op Int, Op Result) -> Op Void
  store32_lane (mi, lane, addr, v) { return memstore_lane(0x5a, mi, lane, addr, v) } // (MemImm, uint8, Op Int, Op Result) -> Op Void
  store64_lane (mi, lane, addr, v) { return memstore_lane(0x5b, mi, lane, addr, v) } // (MemImm, uint8, Op Int, Op Result) -> Op Void

  // Bitwise operations
  not (a) { return unop([0x4d, 0xfd], this, a) }                                  // Op V128 -> Op V128
  and (a, b) { return binop([0x4e, 0xfd], this, a, b) }                           // (Op V128, Op V128) -> Op V128
  andnot (a, b) { return binop([0x4f, 0xfd], this, a, b) }                        // (Op V128, Op V128) -> Op V128
  or (a, b) { return binop([0x50, 0xfd], this, a, b) }                            // (Op V128, Op V128) -> Op V128
  xor (a, b) { return binop([0x51, 0xfd], this, a, b) }                           // (Op V128, Op V128) -> Op V128
  bitselect (a, b, c) { return ternop([0x52, 0xfd], this, a, b, c) }              // (Op V128, Op V128, Op V128) -> Op V128

  // Predicate
  any_true (a) { return testop([0x53, 0xfd], a) }                                 // Op V128 -> Op I32
}

// type_atom i8x16ops => i8x16ops : V128ops
class i8x16ops extends type_atom {
  // Lane operations
  shuffle (lanes, a, b) {                                                         // ([uint8]{16}, Op V128, Op V128) -> Op V128
    assert(lanes.every(v => v >= 0 && v < 32), "lanes", lanes, ".some v: v < 0 || v >= 32");
    return new instr_pre_imm([0x0d, 0xfd], c.v128, [a, b], lanes) }
  swizzle (a, b) { return binop([0x0e, 0xfd], c.v128, a, b) }                     // (Op V128, Op V128) -> Op V128
  splat (a) { return new instr_pre1([0x0f, 0xfd], c.v128, a) }                    // Op I32 -> Op V128
  extract_lane_s (lane, a) { return new instr_pre_imm([0x15, 0xfd], c.i32, [a], [lane]) }      // (uint8, Op V128) -> Op I32
  extract_lane_u (lane, a) { return new instr_pre_imm([0x16, 0xfd], c.i32, [a], [lane]) }      // (uint8, Op V128) -> Op I32
  replace_lane (lane, a, v) { return new instr_pre_imm([0x17, 0xfd], c.v128, [a, v], [lane]) } // (uint8, Op V128, Op I32) -> Op V128

  // Comparison
  eq (a, b) { return binop([0x23, 0xfd], c.v128, a, b) }                          // (Op V128, Op V128) -> Op V128
  ne (a, b) { return binop([0x24, 0xfd], c.v128, a, b) }                          // (Op V128, Op V128) -> Op V128
  lt_s (a, b) { return binop([0x25, 0xfd], c.v128, a, b) }                        // (Op V128, Op V128) -> Op V128
  lt_u (a, b) { return binop([0x26, 0xfd], c.v128, a, b) }                        // (Op V128, Op V128) -> Op V128
  gt_s (a, b) { return binop([0x27, 0xfd], c.v128, a, b) }                        // (Op V128, Op V128) -> Op V128
  gt_u (a, b) { return binop([0x28, 0xfd], c.v128, a, b) }                        // (Op V128, Op V128) -> Op V128
  le_s (a, b) { return binop([0x29, 0xfd], c.v128, a, b) }                        // (Op V128, Op V128) -> Op V128
  le_u (a, b) { return binop([0x2a, 0xfd], c.v128, a, b) }                        // (Op V128, Op V128) -> Op V128
  ge_s (a, b) { return binop([0x2b, 0xfd], c.v128, a, b) }                        // (Op V128, Op V128) -> Op V128
  ge_u (a, b) { return binop([0x2c, 0xfd], c.v128, a, b) }                        // (Op V128, Op V128) -> Op V128

  // Numeric
  abs (a) { return unop([0x60, 0xfd], c.v128, a) }                                // Op V128 -> Op V128
  neg (a) { return unop([0x61, 0xfd], c.v128, a) }                                // Op V128 -> Op V128
  popcnt (a) { return unop([0x62, 0xfd], c.v128, a) }                             // Op V128 -> Op V128
  all_true (a) { return testop([0x63, 0xfd], a) }                                 // Op V128 -> Op I32
  bitmask (a) { return testop([0x64, 0xfd], a) }                                  // Op V128 -> Op I32
  narrow_i16x8_s (a, b) { return binop([0x65, 0xfd], c.v128, a, b) }              // (Op V128 -> Op V128) -> Op V128
  narrow_i16x8_u (a, b) { return binop([0x66, 0xfd], c.v128, a, b) }              // (Op V128 -> Op V128) -> Op V128
  shl (a, v) { return binop([0x6b, 0xfd], c.v128, a, v) }                         // (Op V128 -> Op I32) -> Op V128
  shr_s (a, v) { return binop([0x6c, 0xfd], c.v128, a, v) }                       // (Op V128 -> Op I32) -> Op V128
  shr_u (a, v) { return binop([0x6b, 0xfd], c.v128, a, v) }                       // (Op V128 -> Op I32) -> Op V128
  add (a, b) { return binop([0x6e, 0xfd], c.v128, a, b) }                         // (Op V128 -> Op V128) -> Op V128
  add_sat_s (a, b) { return binop([0x6f, 0xfd], c.v128, a, b) }                   // (Op V128 -> Op V128) -> Op V128
  add_sat_u (a, b) { return binop([0x70, 0xfd], c.v128, a, b) }                   // (Op V128 -> Op V128) -> Op V128
  sub (a, b) { return binop([0x71, 0xfd], c.v128, a, b) }                         // (Op V128 -> Op V128) -> Op V128
  sub_sat_s (a, b) { return binop([0x72, 0xfd], c.v128, a, b) }                   // (Op V128 -> Op V128) -> Op V128
  sub_sat_u (a, b) { return binop([0x73, 0xfd], c.v128, a, b) }                   // (Op V128 -> Op V128) -> Op V128
  min_s (a, b) { return binop([0x76, 0xfd], c.v128, a, b) }                       // (Op V128 -> Op V128) -> Op V128
  min_u (a, b) { return binop([0x77, 0xfd], c.v128, a, b) }                       // (Op V128 -> Op V128) -> Op V128
  max_s (a, b) { return binop([0x78, 0xfd], c.v128, a, b) }                       // (Op V128 -> Op V128) -> Op V128
  max_u (a, b) { return binop([0x79, 0xfd], c.v128, a, b) }                       // (Op V128 -> Op V128) -> Op V128
  avgr_u (a, b) { return binop([0x7b, 0xfd], c.v128, a, b) }                      // (Op V128 -> Op V128) -> Op V128
}

// type_atom i16x8ops => i16x8ops : V128ops
class i16x8ops extends type_atom {
  // Lane operations
  splat (a) { return new instr_pre1([0x10, 0xfd], c.v128, a) }                    // Op I32 -> Op V128
  extract_lane_s (lane, a) { return new instr_pre_imm([0x18, 0xfd], c.i32, [a], [lane]) }      // (uint8, Op V128) -> Op I32
  extract_lane_u (lane, a) { return new instr_pre_imm([0x19, 0xfd], c.i32, [a], [lane]) }      // (uint8, Op V128) -> Op I32
  replace_lane (lane, a, v) { return new instr_pre_imm([0x1a, 0xfd], c.v128, [a, v], [lane]) } // (uint8, Op V128, Op I32) -> Op V128

  // Comparison
  eq (a, b) { return binop([0x2d, 0xfd], c.v128, a, b) }                          // (Op V128, Op V128) -> Op V128
  ne (a, b) { return binop([0x2e, 0xfd], c.v128, a, b) }                          // (Op V128, Op V128) -> Op V128
  lt_s (a, b) { return binop([0x2f, 0xfd], c.v128, a, b) }                        // (Op V128, Op V128) -> Op V128
  lt_u (a, b) { return binop([0x30, 0xfd], c.v128, a, b) }                        // (Op V128, Op V128) -> Op V128
  gt_s (a, b) { return binop([0x31, 0xfd], c.v128, a, b) }                        // (Op V128, Op V128) -> Op V128
  gt_u (a, b) { return binop([0x32, 0xfd], c.v128, a, b) }                        // (Op V128, Op V128) -> Op V128
  le_s (a, b) { return binop([0x33, 0xfd], c.v128, a, b) }                        // (Op V128, Op V128) -> Op V128
  le_u (a, b) { return binop([0x34, 0xfd], c.v128, a, b) }                        // (Op V128, Op V128) -> Op V128
  ge_s (a, b) { return binop([0x35, 0xfd], c.v128, a, b) }                        // (Op V128, Op V128) -> Op V128
  ge_u (a, b) { return binop([0x36, 0xfd], c.v128, a, b) }                        // (Op V128, Op V128) -> Op V128

  // Numeric
  extadd_pairwise_i8x16_s (a) { return unop([0x7c, 0xfd], c.v128, a) }            // Op V128 -> Op V128
  extadd_pairwise_i8x16_u (a) { return unop([0x7d, 0xfd], c.v128, a) }            // Op V128 -> Op V128
  abs (a) { return unop([0x80, 0xfd], c.v128, a) }                                // Op V128 -> Op V128
  neg (a) { return unop([0x81, 0xfd], c.v128, a) }                                // Op V128 -> Op V128
  q15mulr_sat_s (a, b) { return binop([0x82, 0xfd], c.v128, a, b) }               // (Op V128 -> Op V128) -> Op V128
  all_true (a) { return testop([0x83, 0xfd], a) }                                 // Op V128 -> Op I32
  bitmask (a) { return testop([0x84, 0xfd], a) }                                  // Op V128 -> Op I32
  narrow_i32x4_s (a, b) { return binop([0x85, 0xfd], c.v128, a, b) }              // (Op V128 -> Op V128) -> Op V128
  narrow_i32x4_u (a, b) { return binop([0x86, 0xfd], c.v128, a, b) }              // (Op V128 -> Op V128) -> Op V128
  extend_low_i8x16_s (a) { return unop([0x87, 0xfd], c.v128, a) }                 // Op V128 -> Op V128
  extend_high_i8x16_s (a) { return unop([0x88, 0xfd], c.v128, a) }                // Op V128 -> Op V128
  extend_low_i8x16_u (a) { return unop([0x89, 0xfd], c.v128, a) }                 // Op V128 -> Op V128
  extend_high_i8x16_u (a) { return unop([0x8a, 0xfd], c.v128, a) }                // Op V128 -> Op V128
  shl (a, v) { return binop([0x8b, 0xfd], c.v128, a, v) }                         // (Op V128 -> Op I32) -> Op V128
  shr_s (a, v) { return binop([0x8c, 0xfd], c.v128, a, v) }                       // (Op V128 -> Op I32) -> Op V128
  shr_u (a, v) { return binop([0x8b, 0xfd], c.v128, a, v) }                       // (Op V128 -> Op I32) -> Op V128
  add (a, b) { return binop([0x8e, 0xfd], c.v128, a, b) }                         // (Op V128 -> Op V128) -> Op V128
  add_sat_s (a, b) { return binop([0x8f, 0xfd], c.v128, a, b) }                   // (Op V128 -> Op V128) -> Op V128
  add_sat_u (a, b) { return binop([0x90, 0xfd], c.v128, a, b) }                   // (Op V128 -> Op V128) -> Op V128
  sub (a, b) { return binop([0x91, 0xfd], c.v128, a, b) }                         // (Op V128 -> Op V128) -> Op V128
  sub_sat_s (a, b) { return binop([0x92, 0xfd], c.v128, a, b) }                   // (Op V128 -> Op V128) -> Op V128
  sub_sat_u (a, b) { return binop([0x93, 0xfd], c.v128, a, b) }                   // (Op V128 -> Op V128) -> Op V128
  mul (a, b) { return binop([0x95, 0xfd], c.v128, a, b) }                         // (Op V128 -> Op V128) -> Op V128
  min_s (a, b) { return binop([0x96, 0xfd], c.v128, a, b) }                       // (Op V128 -> Op V128) -> Op V128
  min_u (a, b) { return binop([0x97, 0xfd], c.v128, a, b) }                       // (Op V128 -> Op V128) -> Op V128
  max_s (a, b) { return binop([0x98, 0xfd], c.v128, a, b) }                       // (Op V128 -> Op V128) -> Op V128
  max_u (a, b) { return binop([0x99, 0xfd], c.v128, a, b) }                       // (Op V128 -> Op V128) -> Op V128
  avgr_u (a, b) { return binop([0x9b, 0xfd], c.v128, a, b) }                      // (Op V128 -> Op V128) -> Op V128
  extmul_low_i8x16_s (a, b) { return binop([0x9c, 0xfd], c.v128, a, b) }          // (Op V128 -> Op V128) -> Op V128
  extmul_high_i8x16_s (a, b) { return binop([0x9d, 0xfd], c.v128, a, b) }         // (Op V128 -> Op V128) -> Op V128
  extmul_low_i8x16_u (a, b) { return binop([0x9e, 0xfd], c.v128, a, b) }          // (Op V128 -> Op V128) -> Op V128
  extmul_high_i8x16_u (a, b) { return binop([0x9f, 0xfd], c.v128, a, b) }         // (Op V128 -> Op V128) -> Op V128
}

// type_atom i32x4ops => i32x4ops : V128ops
class i32x4ops extends type_atom {
  // Lane operations
  splat (a) { return new instr_pre1([0x11, 0xfd], c.v128, a) }                    // Op I32 -> Op V128
  extract_lane (lane, a) { return new instr_pre_imm([0x1b, 0xfd], c.i32, [a], [lane]) }        // (uint8, Op V128) -> Op I32
  replace_lane (lane, a, v) { return new instr_pre_imm([0x1c, 0xfd], c.v128, [a, v], [lane]) } // (uint8, Op V128, Op I32) -> Op I32

  // Comparison
  eq (a, b) { return binop([0x37, 0xfd], c.v128, a, b) }                          // (Op V128, Op V128) -> Op V128
  ne (a, b) { return binop([0x38, 0xfd], c.v128, a, b) }                          // (Op V128, Op V128) -> Op V128
  lt_s (a, b) { return binop([0x39, 0xfd], c.v128, a, b) }                        // (Op V128, Op V128) -> Op V128
  lt_u (a, b) { return binop([0x3a, 0xfd], c.v128, a, b) }                        // (Op V128, Op V128) -> Op V128
  gt_s (a, b) { return binop([0x3b, 0xfd], c.v128, a, b) }                        // (Op V128, Op V128) -> Op V128
  gt_u (a, b) { return binop([0x3c, 0xfd], c.v128, a, b) }                        // (Op V128, Op V128) -> Op V128
  le_s (a, b) { return binop([0x3d, 0xfd], c.v128, a, b) }                        // (Op V128, Op V128) -> Op V128
  le_u (a, b) { return binop([0x3e, 0xfd], c.v128, a, b) }                        // (Op V128, Op V128) -> Op V128
  ge_s (a, b) { return binop([0x3f, 0xfd], c.v128, a, b) }                        // (Op V128, Op V128) -> Op V128
  ge_u (a, b) { return binop([0x40, 0xfd], c.v128, a, b) }                        // (Op V128, Op V128) -> Op V128

  // Numeric
  extadd_pairwise_i16x8_s (a) { return unop([0x7e, 0xfd], c.v128, a) }            // Op V128 -> Op V128
  extadd_pairwise_i16x8_u (a) { return unop([0x7f, 0xfd], c.v128, a) }            // Op V128 -> Op V128
  abs (a) { return unop([0xa0, 0xfd], c.v128, a) }                                // Op V128 -> Op V128
  neg (a) { return unop([0xa1, 0xfd], c.v128, a) }                                // Op V128 -> Op V128
  all_true (a) { return testop([0xa2, 0xfd], a) }                                 // Op V128 -> Op I32
  bitmask (a) { return testop([0xa4, 0xfd], a) }                                  // Op V128 -> Op I32
  extend_low_i16x8_s (a) { return unop([0xa7, 0xfd], c.v128, a) }                 // Op V128 -> Op V128
  extend_high_i16x8_s (a) { return unop([0xa8, 0xfd], c.v128, a) }                // Op V128 -> Op V128
  extend_low_i16x8_u (a) { return unop([0xa9, 0xfd], c.v128, a) }                 // Op V128 -> Op V128
  extend_high_i16x8_u (a) { return unop([0xaa, 0xfd], c.v128, a) }                // Op V128 -> Op V128
  shl (a, v) { return binop([0xab, 0xfd], c.v128, a, v) }                         // (Op V128 -> Op I32) -> Op V128
  shr_s (a, v) { return binop([0xac, 0xfd], c.v128, a, v) }                       // (Op V128 -> Op I32) -> Op V128
  shr_u (a, v) { return binop([0xad, 0xfd], c.v128, a, v) }                       // (Op V128 -> Op I32) -> Op V128
  add (a, b) { return binop([0xae, 0xfd], c.v128, a, b) }                         // (Op V128 -> Op V128) -> Op V128
  sub (a, b) { return binop([0xb1, 0xfd], c.v128, a, b) }                         // (Op V128 -> Op V128) -> Op V128
  mul (a, b) { return binop([0xb5, 0xfd], c.v128, a, b) }                         // (Op V128 -> Op V128) -> Op V128
  min_s (a, b) { return binop([0xb6, 0xfd], c.v128, a, b) }                       // (Op V128 -> Op V128) -> Op V128
  min_u (a, b) { return binop([0xb7, 0xfd], c.v128, a, b) }                       // (Op V128 -> Op V128) -> Op V128
  max_s (a, b) { return binop([0xb8, 0xfd], c.v128, a, b) }                       // (Op V128 -> Op V128) -> Op V128
  max_u (a, b) { return binop([0xb9, 0xfd], c.v128, a, b) }                       // (Op V128 -> Op V128) -> Op V128
  dot_i16x8_s (a, b) { return binop([0xba, 0xfd], c.v128, a, b) }                 // (Op V128 -> Op V128) -> Op V128
  extmul_low_i16x8_s (a, b) { return binop([0xbc, 0xfd], c.v128, a, b) }          // (Op V128 -> Op V128) -> Op V128
  extmul_high_i16x8_s (a, b) { return binop([0xbd, 0xfd], c.v128, a, b) }         // (Op V128 -> Op V128) -> Op V128
  extmul_low_i16x8_u (a, b) { return binop([0xbe, 0xfd], c.v128, a, b) }          // (Op V128 -> Op V128) -> Op V128
  extmul_high_i16x8_u (a, b) { return binop([0xbf, 0xfd], c.v128, a, b) }         // (Op V128 -> Op V128) -> Op V128
  trunc_sat_f32x4_s (a, b) { return binop([0xf8, 0xfd], c.v128, a, b) }           // (Op V128 -> Op V128) -> Op V128
  trunc_sat_f32x4_u (a, b) { return binop([0xf9, 0xfd], c.v128, a, b) }           // (Op V128 -> Op V128) -> Op V128
  trunc_sat_f64x2_s_zero (a, b) { return binop([0xfc, 0xfd], c.v128, a, b) }      // (Op V128 -> Op V128) -> Op V128
  trunc_sat_f64x2_u_zero (a, b) { return binop([0xfd, 0xfd], c.v128, a, b) }      // (Op V128 -> Op V128) -> Op V128
}

// type_atom i64x2ops => i64x2ops : V128ops
class i64x2ops extends type_atom {
  // Lane operations
  splat (a) { return new instr_pre1([0x12, 0xfd], c.v128, a) }                    // Op I64 -> Op V128
  extract_lane (lane, a) { return new instr_pre_imm([0x1d, 0xfd], c.i64, [a], [lane]) }        // (uint8, Op V128) -> Op I64
  replace_lane (lane, a, v) { return new instr_pre_imm([0x1e, 0xfd], c.v128, [a, v], [lane]) } // (uint8, Op V128, Op I64) -> Op V128

  // Comparison
  eq (a, b) { return binop([0xd6, 0xfd], c.v128, a, b) }                          // (Op V128, Op V128) -> Op V128
  ne (a, b) { return binop([0xd7, 0xfd], c.v128, a, b) }                          // (Op V128, Op V128) -> Op V128
  lt_s (a, b) { return binop([0xd8, 0xfd], c.v128, a, b) }                        // (Op V128, Op V128) -> Op V128
  gt_s (a, b) { return binop([0xd9, 0xfd], c.v128, a, b) }                        // (Op V128, Op V128) -> Op V128
  le_s (a, b) { return binop([0xda, 0xfd], c.v128, a, b) }                        // (Op V128, Op V128) -> Op V128
  ge_s (a, b) { return binop([0xdb, 0xfd], c.v128, a, b) }                        // (Op V128, Op V128) -> Op V128

  // Numeric
  abs (a) { return unop([0xc0, 0xfd], c.v128, a) }                                // Op V128 -> Op V128
  neg (a) { return unop([0xc1, 0xfd], c.v128, a) }                                // Op V128 -> Op V128
  all_true (a) { return testop([0xc3, 0xfd], a) }                                 // Op V128 -> Op I32
  bitmask (a) { return testop([0xc4, 0xfd], a) }                                  // Op V128 -> Op I32
  extend_low_i32x4_s (a) { return unop([0xc7, 0xfd], c.v128, a) }                 // Op V128 -> Op V128
  extend_high_i32x4_s (a) { return unop([0xc8, 0xfd], c.v128, a) }                // Op V128 -> Op V128
  extend_low_i32x4_u (a) { return unop([0xc9, 0xfd], c.v128, a) }                 // Op V128 -> Op V128
  extend_high_i32x4_u (a) { return unop([0xca, 0xfd], c.v128, a) }                // Op V128 -> Op V128
  shl (a, v) { return binop([0xcb, 0xfd], c.v128, a, v) }                         // (Op V128 -> Op I64) -> Op V128
  shr_s (a, v) { return binop([0xcc, 0xfd], c.v128, a, v) }                       // (Op V128 -> Op I64) -> Op V128
  shr_u (a, v) { return binop([0xcd, 0xfd], c.v128, a, v) }                       // (Op V128 -> Op I64) -> Op V128
  add (a, b) { return binop([0xce, 0xfd], c.v128, a, b) }                         // (Op V128 -> Op V128) -> Op V128
  sub (a, b) { return binop([0xd1, 0xfd], c.v128, a, b) }                         // (Op V128 -> Op V128) -> Op V128
  mul (a, b) { return binop([0xd5, 0xfd], c.v128, a, b) }                         // (Op V128 -> Op V128) -> Op V128
  extmul_low_i32x4_s (a, b) { return binop([0xdc, 0xfd], c.v128, a, b) }          // (Op V128 -> Op V128) -> Op V128
  extmul_high_i32x4_s (a, b) { return binop([0xdd, 0xfd], c.v128, a, b) }         // (Op V128 -> Op V128) -> Op V128
  extmul_low_i32x4_u (a, b) { return binop([0xde, 0xfd], c.v128, a, b) }          // (Op V128 -> Op V128) -> Op V128
  extmul_high_i32x4_u (a, b) { return binop([0xdf, 0xfd], c.v128, a, b) }         // (Op V128 -> Op V128) -> Op V128
}

// type_atom f32x4ops => f32x4ops : V128ops
class f32x4ops extends type_atom {
  // Lane operations
  splat (a) { return new instr_pre1([0x13, 0xfd], c.v128, a) }                    // Op F32 -> Op V128
  extract_lane (lane, a) { return new instr_pre_imm([0x1f, 0xfd], c.f32, [a], [lane]) }        // (uint8, Op V128) -> Op F32
  replace_lane (lane, a, v) { return new instr_pre_imm([0x20, 0xfd], c.v128, [a, v], [lane]) } // (uint8, Op V128, Op F32) -> Op V128

  // Comparison
  eq (a, b) { return binop([0x41, 0xfd], c.v128, a, b) }                          // (Op V128, Op V128) -> Op V128
  ne (a, b) { return binop([0x42, 0xfd], c.v128, a, b) }                          // (Op V128, Op V128) -> Op V128
  lt (a, b) { return binop([0x43, 0xfd], c.v128, a, b) }                          // (Op V128, Op V128) -> Op V128
  gt (a, b) { return binop([0x44, 0xfd], c.v128, a, b) }                          // (Op V128, Op V128) -> Op V128
  le (a, b) { return binop([0x45, 0xfd], c.v128, a, b) }                          // (Op V128, Op V128) -> Op V128
  ge (a, b) { return binop([0x46, 0xfd], c.v128, a, b) }                          // (Op V128, Op V128) -> Op V128

  // Numeric
  demote_f64x2_zero (a) { return unop([0x5e, 0xfd], c.v128, a) }                  // Op V128 -> Op V128
  ceil (a) { return unop([0x67, 0xfd], c.v128, a) }                               // Op V128 -> Op V128
  floor (a) { return unop([0x68, 0xfd], c.v128, a) }                              // Op V128 -> Op V128
  trunc (a) { return unop([0x69, 0xfd], c.v128, a) }                              // Op V128 -> Op V128
  nearest (a) { return unop([0x6a, 0xfd], c.v128, a) }                            // Op V128 -> Op V128
  abs (a) { return unop([0xe0, 0xfd], c.v128, a) }                                // Op V128 -> Op V128
  neg (a) { return unop([0xe1, 0xfd], c.v128, a) }                                // Op V128 -> Op V128
  sqrt (a) { return unop([0xe3, 0xfd], c.v128, a) }                               // Op V128 -> Op V128
  add (a, b) { return binop([0xe4, 0xfd], c.v128, a, b) }                         // (Op V128, Op V128) -> Op V128
  sub (a, b) { return binop([0xe5, 0xfd], c.v128, a, b) }                         // (Op V128, Op V128) -> Op V128
  mul (a, b) { return binop([0xe6, 0xfd], c.v128, a, b) }                         // (Op V128, Op V128) -> Op V128
  div (a, b) { return binop([0xe7, 0xfd], c.v128, a, b) }                         // (Op V128, Op V128) -> Op V128
  min (a, b) { return binop([0xe8, 0xfd], c.v128, a, b) }                         // (Op V128, Op V128) -> Op V128
  max (a, b) { return binop([0xe9, 0xfd], c.v128, a, b) }                         // (Op V128, Op V128) -> Op V128
  pmin (a, b) { return binop([0xea, 0xfd], c.v128, a, b) }                        // (Op V128, Op V128) -> Op V128
  pmax (a, b) { return binop([0xeb, 0xfd], c.v128, a, b) }                        // (Op V128, Op V128) -> Op V128
  convert_i32x4_s (a) { return unop([0xfa, 0xfd], c.v128, a) }                    // Op V128 -> Op V128
  convert_i32x4_u (a) { return unop([0xfb, 0xfd], c.v128, a) }                    // Op V128 -> Op V128
}

// type_atom f64x2ops => f64x2ops : V128ops
class f64x2ops extends type_atom {
  // Lane operations
  splat (a) { return new instr_pre1([0x14, 0xfd], c.v128, a) }                    // Op F64 -> Op V128
  extract_lane (lane, a) { return new instr_pre_imm([0x21, 0xfd], c.f32, [a], [lane]) }        // (uint8, Op V128) -> Op F64
  replace_lane (lane, a, v) { return new instr_pre_imm([0x22, 0xfd], c.v128, [a, v], [lane]) } // (uint8, Op V128, Op F64) -> Op V128

  // Comparison
  eq (a, b) { return binop([0x47, 0xfd], c.v128, a, b) }                          // (Op V128, Op V128) -> Op V128
  ne (a, b) { return binop([0x48, 0xfd], c.v128, a, b) }                          // (Op V128, Op V128) -> Op V128
  lt (a, b) { return binop([0x49, 0xfd], c.v128, a, b) }                          // (Op V128, Op V128) -> Op V128
  gt (a, b) { return binop([0x4a, 0xfd], c.v128, a, b) }                          // (Op V128, Op V128) -> Op V128
  le (a, b) { return binop([0x4b, 0xfd], c.v128, a, b) }                          // (Op V128, Op V128) -> Op V128
  ge (a, b) { return binop([0x4c, 0xfd], c.v128, a, b) }                          // (Op V128, Op V128) -> Op V128

  // Numeric
  promote_low_f32x4 (a) { return unop([0x5f, 0xfd], c.v128, a) }                  // Op V128 -> Op V128
  ceil (a) { return unop([0x74, 0xfd], c.v128, a) }                               // Op V128 -> Op V128
  floor (a) { return unop([0x75, 0xfd], c.v128, a) }                              // Op V128 -> Op V128
  trunc (a) { return unop([0x7a, 0xfd], c.v128, a) }                              // Op V128 -> Op V128
  nearest (a) { return unop([0x94, 0xfd], c.v128, a) }                            // Op V128 -> Op V128
  abs (a) { return unop([0xec, 0xfd], c.v128, a) }                                // Op V128 -> Op V128
  neg (a) { return unop([0xed, 0xfd], c.v128, a) }                                // Op V128 -> Op V128
  sqrt (a) { return unop([0xef, 0xfd], c.v128, a) }                               // Op V128 -> Op V128
  add (a, b) { return binop([0xf0, 0xfd], c.v128, a, b) }                         // (Op V128, Op V128) -> Op V128
  sub (a, b) { return binop([0xf1, 0xfd], c.v128, a, b) }                         // (Op V128, Op V128) -> Op V128
  mul (a, b) { return binop([0xf2, 0xfd], c.v128, a, b) }                         // (Op V128, Op V128) -> Op V128
  div (a, b) { return binop([0xf3, 0xfd], c.v128, a, b) }                         // (Op V128, Op V128) -> Op V128
  min (a, b) { return binop([0xf4, 0xfd], c.v128, a, b) }                         // (Op V128, Op V128) -> Op V128
  max (a, b) { return binop([0xf5, 0xfd], c.v128, a, b) }                         // (Op V128, Op V128) -> Op V128
  pmin (a, b) { return binop([0xf6, 0xfd], c.v128, a, b) }                        // (Op V128, Op V128) -> Op V128
  pmax (a, b) { return binop([0xf7, 0xfd], c.v128, a, b) }                        // (Op V128, Op V128) -> Op V128
  convert_low_i32x4_s (a) { return unop([0xfe, 0xfd], c.v128, a) }                // Op V128 -> Op V128
  convert_low_i32x4_u (a) { return unop([0xff, 0xfd], c.v128, a) }                // Op V128 -> Op V128
}


const
  magic = uint32(0x6d736100),
  latestVersion = uint32(0x1),
  end = new instr_atom(0x0b, Void),  // Op Void
  elseOp = new instr_atom(0x05, Void),  // Op Void
  catchAllOp = new instr_atom(0x19, Void),  // Op Void
  delegateOp = new instr_atom(0x18, Void),  // Op Void

// AnyResult R => (R, Op I32, [AnyOp], Maybe [AnyOp]) -> Op R
  if_ = (mbResult, cond, then_, else_) => {
    assert(mbResult.t === T.varuint32 || mbResult === then_.at(-1).r,
      "mbResult", mbResult, "!== then_.at(-1).r", then_.at(-1).r);
    assert(!else_ || else_.length == 0 || mbResult.t === T.varuint32 || mbResult === else_.at(-1).r,
      "else_", else_, "!== undefined && else_.length", else_?.length,
      "!= 0 && mbResult", mbResult, "!== else_.at(-1).r", else_?.at(-1).r);
    return new instr_pre_imm_post([0x04], mbResult, [cond], [mbResult], else_ ?
      [ ...then_, elseOp, ...else_, end ] : [ ...then_, end ]) },

// Result R => Op R -> Op R
  return_ = value => new instr_pre1([0x0f], value.r, value),
// Result R => 
  return_multi = values => new instr_pre([0x0f], values.map(v => v.r), values),

  t = T,
  c = {
    uint8,
    uint32,
    biguint64,
    float32,
    float64,
    varuint1,
    varuint7,
    varuint32,
    varint7,
    varint32,
    varint64,

    func: Func, struct: Struct, arr: Arr,
    void: Void, void_: Void,
    heap: Heap, ref, ref_null,

    external_kind: {
      function: external_kind_function,
      table:    external_kind_table,
      memory:   external_kind_memory,
      global:   external_kind_global,
      tag:      external_kind_tag
    },

    data (buf) { return new bytes_atom(T.data, buf) },  // ArrayLike uint8 -> Data
    str,
    // string -> Str
    str_utf8: (() => {
      const t = new TextEncoder();
      return text => str(t.encode(text))
    })(),

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
    // VarUint32 -> DataCountSection
    datacount_section: dataCount => section(sect_id_datacount, dataCount, []),
    // [TagType] -> TagSection
    tag_section: types => section(sect_id_tag, varuint32(types.length), types),

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
    // (Str, Str, TagType) -> ImportEntry
    tag_import_entry: (module, field, type) =>
      new cell(T.import_entry, [ module, field, external_kind_tag, type ]),

    // (Str, Str, ExternalKind, AnyImport) -> ImportEntry
    // import_entry: (module, field, kind, imp) => new cell(T.import_entry, [ module, field, kind, imp ]),
    
    // (Str, ExternalKind, VarUint32) -> ExportEntry
    export_entry: (field, kind, index) => new cell(T.export_entry, [ field, kind, index ]),
    
    // (InitExpr, [VarUint32] | [ElemExpr], Maybe RefType, Maybe VarUint32) -> ElemSegment
    active_elem_segment: (offset, elemPayload, refType, tableIndex) => new cell(T.elem_segment, tableIndex ?
      [ varuint32(2 + 4 * !!refType), tableIndex ?? varuint1_0, c.init_expr([offset]), refType ?? varuint1_0, varuint32(elemPayload.length), ...elemPayload ] :
      [ varuint32(0 + 4 * !!refType), c.init_expr([offset]), varuint32(elemPayload.length), ...elemPayload ]),
    // ([VarUint32] | [ElemExpr], Maybe RefType) -> ElemSegment
    passive_elem_segment: (elemPayload, refType) => new cell(T.elem_segment,
      [ varuint32(1 + 4 * !!refType), refType ?? varuint1_0, varuint32(elemPayload.length), ...elemPayload ]),
    // ([VarUint32] | [ElemExpr], Maybe RefType) -> ElemSegmentbulk memory examples
    declarative_elem_segment: (elemPayload, refType) => new cell(T.elem_segment,
      [ varuint32(3 + 4 * !!refType), refType ?? varuint1_0, varuint32(elemPayload.length), ...elemPayload ]),

    // Data -> DataSegment
    passive_data_segment: data => new cell(T.data_segment, [ varuint32(1), data ]),
    // (InitExpr, Data, Maybe VarUint32) -> DataSegment
    active_data_segment: (offset, data, memid) => new cell(T.data_segment,
      memid ? [ varuint32(2), memid, offset, data ] : [ varuint32(0), offset, data ]),

    // ([ValueType], [ValueType]) -> FuncType
    func_type: (paramTypes = [], returnType = []) => new cell(T.func_type, 
      [ varuint32(paramTypes.length), ...paramTypes, varuint32(returnType.length), ...returnType ]),
    // (R, ArrType | StructType | FuncType) -> CompType
    comp_type: (ctype, ...typeData) => {
      switch (ctype) {
        case Func: return new cell(T.comp_type, [ Func, c.func_type(...typeData) ]);
        case Arr: break;
        case Struct: break;
      }
    },
    // (ElemType, ResizableLimits) -> TableType
    table_type: (type, limits) => {
      assert(type.v == Heap.Extern.v || type.v == Heap.Func.v, "type.v", type.v, "!= Extern.v", Heap.Extern.v, "&& type.v !== Func.v", Heap.Func.v);
      return new cell(T.table_type, [ type, limits ]) },
    // (ValueType, Maybe boolean) -> GlobalType
    global_type: (contentType, mutable) => new cell(T.global_type, [
      contentType, mutable ? varuint1_1 : varuint1_0 ]),
    // VarUint32 -> TagType
    tag_type: typeIndex => new cell(T.tag_type, [ uint8(0), typeIndex ]),      
    
    // Expressed in number of memory pages (1 page = 64KiB)
    // (uint32, Maybe uint32) -> ResizableLimits
    resizable_limits: (initial, maximum, shared) => new cell(T.resizable_limits, maximum ?
      shared ? [ varuint32(3), varuint32(initial), varuint32(maximum) ] :
      [ varuint1_1, varuint32(initial), varuint32(maximum) ] : [ varuint1_0, varuint32(initial) ]),
    // (GlobalType, InitExpr) -> GlobalVariable
    global_variable: (type, init) => new cell(T.global_variable, [ type, init ]),
    // [N] -> InitExpr
    init_expr: expr => new cell(T.init_expr, [ ...expr, end ]),
    // uint32 -> ElemExpr
    elem_expr_func: funcIndex => new cell(T.elem_expr, [ c.func_ref(funcIndex), end ]),
    // ElemType -> ElemExpr
    elem_expr_null: type => {
      assert(type.v == Heap.Extern.v || type.v == Heap.Func.v, "type.v", type.v, "!= Extern.v", Heap.Extern.v, "&& type.v !== Func.v", Heap.Func.v);
      return new cell(T.elem_expr, [ c.null_ref(type), end ])
    },
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
    // AnyResult R => (R | VarUint32, [AnyOp]) -> Op R
    block: (mbResult, body) => {
      assert(mbResult.t === T.varuint32 || mbResult === body.at(-1).r,
        "mbResult", mbResult, "!== body.at(-1).r", body.at(-1).r);
      return new instr_imm1_post([0x02], mbResult, [ ...body, end ]) },
    // [AnyOp] -> Op Void
    void_block: body => {
      assert(body.length == 0 || Void === body.at(-1).r,
        "body.length", body.length, "!= 0 && Void !== body.at(-1).r", body.at(-1).r);
      return new instr_imm1_post([0x02], Void, [ ...body, end ]) },

    // Begin a block which can also form control flow loops
    // AnyResult R => (R | VarUint32, [AnyOp]) -> Op R
    loop: (mbResult, body) => {
      assert(mbResult.t === T.varuint32 || mbResult === body.at(-1).r,
        "mbResult", mbResult, "!== body.at(-1).r", body.at(-1).r);
      return new instr_imm1_post([0x03], mbResult, [ ...body, end ]) },
    // [AnyOp] -> Op Void
    void_loop: body => {
      assert(body.length == 0 || Void === body.at(-1).r,
        "body.length", body.length, "!= 0 && Void !== body.at(-1).r", body.at(-1).r);
      return new instr_imm1_post([0x03], Void, [ ...body, end ]) },
    if: if_, if_,  // AnyResult R => (R | VarUint32, Op I32, [AnyOp], Maybe [AnyOp]) -> Op R
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
    return_multi, // [Op R] -> [Op R]
    // Calling
    // Result R => (R, VarUint32, [AnyOp]) -> Op R
    call: (r, funcIndex, args) => new instr_pre_imm([0x10], r, args, [ funcIndex ]),
    // Result R => (R, [AnyOp], InitExpr, VarUint32, VarUint32) -> Op R
    call_indirect: (r, args, offset, funcIndex, typeIndex) =>
      new instr_pre_imm([0x11], r, [ ...args, offset ], [ typeIndex, funcIndex ]),

    // Drop discards the value of its operand
    // R should be the value "under" the operand on the stack
    // Eg with stack I32 (top) : F64 : F32 (bottom)  =drop=>  F64 (top) : F32 (bottom), then R = F64
    // AnyResult R => (R, Op Result) -> Op R
    drop: (r, n) => new instr_pre1([0x1a], r, n),
    // Select one of two values based on condition
    // Result R => (Op I32, Op R, Op R, Maybe [Type, Type]) -> Op R
    select: (cond, trueRes, falseRes, [trueType, falseType] = []) => {
      assert(trueRes.r === falseRes.r || (trueType && falseType));
      return trueType && falseType ?
        new instr_pre_imm([0x1c], Void, [ trueRes, falseRes, cond ], [ varuint32(2), trueType, falseType ]) :
        new instr_pre([0x1b], trueRes.r, [ trueRes, falseRes, cond ]) },

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

    // Bulk memory operations
    // (uint32, InitExpr, InitExpr, InitExpr) -> Void
    init_memory: (seg, size, offset, dest) =>
      new instr_pre_imm([0x08, 0xfc], Void, [ dest, offset, size ], [ varuint32(seg), varuint1_0 ]),
    // uint32 -> Void
    drop_data: seg => new instr_imm1([0x09, 0xfc], Void, varuint32(seg)),
    // (InitExpr, InitExpr, InitExpr) -> Void
    copy_memory: (size, offset, dest) =>
      new instr_pre_imm([0x0a, 0xfc], Void, [ dest, offset, size ], [ varuint1_0, varuint1_0 ]),
    // (InitExpr, Value, InitExpr) -> Void
    fill_memory: (size, byteVal, dest) =>
      new instr_pre_imm([0x0b, 0xfc], Void, [ dest, byteVal, size ], [ varuint1_0 ]),
    // Result R => (InitExpr, uint32) -> Op R
    get_table: (tableIndex, offset) =>
      new instr_pre_imm([0x25], ref(Func), [ offset ], [ varuint32(tableIndex) ]),
    // (Op Ref, InitExpr, uint32) -> Void
    set_table: (tableIndex, value, offset) =>
      new instr_pre_imm([0x26], Void, [ offset, value ], [ varuint32(tableIndex) ]),
    // (InitExpr, InitExpr, InitExpr) -> Void
    init_table: (seg, size, offset, dest) =>
      new instr_pre_imm([0x0c, 0xfc], Void, [ dest, offset, size ], [ seg, varuint1_0 ]),
    // uint32 -> Void
    drop_elem: seg => new instr_imm1([0x0d, 0xfc], Void, varuint32(seg)),
    // (InitExpr, InitExpr, InitExpr) -> Void
    copy_table: (size, offset, dest) =>
      new instr_pre_imm([0x0e, 0xfc], Void, [ dest, offset, size ], [ varuint1_0, varuint1_0 ]),

    // Reference types
    // HeapType -> RefType
    null_ref: heapType => new instr_imm1([0xd0], ref_null(heapType), heapType),
    // RefType -> Op I32
    is_null_ref: reference => new instr_pre1([0xd1], c.i32, reference),
    // uint32 -> RefType
    func_ref: funcIndex => new instr_imm1([0xd2], ref(Func), varuint32(funcIndex)), // Is this correct?
    // (RefType, RefType) -> Op I32
    eq_ref: (ref1, ref2) => new instr_pre([0xd3], c.i32, [ ref1, ref2 ]),
    // RefType -> RefType
    as_non_null_ref: reference => new instr_pre1([0xd4], reference.t, reference),

    // Atomic operations
    // (MemImm, Op I32, Op I32) -> Op I32
    atomic_notify: (mi, addr, numThreads) => new instr_pre_imm([0x00, 0xfe], c.i32, [ addr, numThreads ], mi),
    // Mem type must be shared. Result: 0 => OK, 1 => result not equal to expected, 2 => timed out
    // (MemImm, Op I32, Op I32, Op I64) -> Op I32
    atomic_wait32: (mi, addr, expect, timeout) => new instr_pre_imm([0x01, 0xfe], c.i32, [ addr, expect, timeout ], mi),
    // (MemImm, Op I32, Op I64, Op I64) -> Op I32
    atomic_wait64: (mi, addr, expect, timeout) => new instr_pre_imm([0x02, 0xfe], c.i32, [ addr, expect, timeout ], mi),
    atomic_fence: new instr_imm1([0x03, 0xfe], Void, varuint1_0),

    // Exceptions
    // AnyResult R => (R, [AnyOp], [CatchClause], [AnyOp]) -> Op R
    try_catch: (mbResult, body, catchClauses, catchAllClause = []) => {
      assert(mbResult.t === T.varuint32 || mbResult === body.at(-1).r,
        "mbResult", mbResult, "!== body.at(-1).r", body.at(-1).r);
      assert(catchClauses.every(c => c.v === 0x07), "catchClauses", catchClauses, ".some c: c.v !== 0x07");
      return new instr_imm1_post([0x06], mbResult, [ ...body,
        ...catchClauses, catchAllOp, ...catchAllClause, end ]) },
    // (VarUint32, [AnyOp]) -> CatchClause
    catch_clause: (tagIndex, body) => new instr_imm1_post([0x07], tagIndex, body),
    // AnyResult R => (R, [AnyOp], VarUint32) -> Op R
    try_delegate: (mbResult, body, labelIndex) =>
      new instr_imm1_post([0x06], mbResult, [ ...body, delegateOp, labelIndex ]),
    // (VarUint32, [AnyOp]) -> Op Void
    throw_: (tagIndex, args) => new instr_pre_imm([0x08], Void, args, [tagIndex]),
    // VarUint32 -> Op Void
    rethrow: labelIndex => new instr_imm1([0x09], Void, labelIndex),

    // Vector const immediate value constructors
    vari8x16, vari16x8, vari32x4, vari64x2, varf32x4, varf64x2,

    i32: new i32ops(-0x01, 0x7f),   // I32ops
    i64: new i64ops(-0x02, 0x7e),   // I64ops
    f32: new f32ops(-0x03, 0x7d),   // F32ops
    f64: new f64ops(-0x04, 0x7c),   // F64ops
    v128: new v128ops(-0x05, 0x7b), // V128ops

    // V128shapedOps
    i8x16: new i8x16ops(-0x05, 0x7b),
    i16x8: new i16x8ops(-0x05, 0x7b),
    i32x4: new i32x4ops(-0x05, 0x7b),
    i64x2: new i64x2ops(-0x05, 0x7b),
    f32x4: new f32x4ops(-0x05, 0x7b),
    f64x2: new f64x2ops(-0x05, 0x7b)
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
    [ 0x6, "try" ],
    [ 0x7, "catch" ],
    [ 0x8, "throw" ],
    [ 0x9, "rethrow" ],
    [ 0xb, "end" ],
    [ 0xc, "br" ],
    [ 0xd, "br_if" ],
    [ 0xe, "br_table" ],
    [ 0xf, "return" ],
    [ 0x10, "call" ],
    [ 0x11, "call_indirect" ],
    [ 0x12, "delegate" ],
    [ 0x13, "catch_all" ],
    [ 0x1a, "drop" ],
    [ 0x1b, "select" ],
    [ 0x20, "local.get" ],
    [ 0x21, "local.set" ],
    [ 0x22, "local.tee" ],
    [ 0x23, "global.get" ],
    [ 0x24, "global.set" ],
    [ 0x25, "table.get" ],
    [ 0x26, "table.set" ],
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
    [ 0xd0, "ref.null" ],
    [ 0xd1, "ref.is_null" ],
    [ 0xd2, "ref.func" ],
    [ 0xd3, "ref.eq" ],
    [ 0xd4, "ref.as_non_null" ]
  ]),
  prefix_fc = new Map([
    [ 0x00, "i32.trunc_sat_f32_s" ],
    [ 0x01, "i32.trunc_sat_f32_u" ],
    [ 0x02, "i32.trunc_sat_f64_s" ],
    [ 0x03, "i32.trunc_sat_f64_u" ],
    [ 0x04, "i64.trunc_sat_f32_s" ],
    [ 0x05, "i64.trunc_sat_f32_u" ],
    [ 0x06, "i64.trunc_sat_f64_s" ],
    [ 0x07, "i64.trunc_sat_f64_u" ],
    [ 0x08, "memory.init" ],
    [ 0x09, "data.drop" ],
    [ 0x0a, "memory.copy" ],
    [ 0x0b, "memory.fill" ],
    [ 0x0c, "table.init" ],
    [ 0x0d, "elem.drop" ],
    [ 0x0e, "table.copy" ]
  ]),
  prefix_fd = new Map([
    [ 0x00, "v128.load" ],
    [ 0x01, "v128.load8x8_s" ],
    [ 0x02, "v128.load8x8_u" ],
    [ 0x03, "v128.load16x4_s" ],
    [ 0x04, "v128.load16x4_u" ],
    [ 0x05, "v128.load32x2_s" ],
    [ 0x06, "v128.load32x2_u" ],
    [ 0x07, "v128.load8_splat" ],
    [ 0x08, "v128.load16_splat" ],
    [ 0x09, "v128.load32_splat" ],
    [ 0x0a, "v128.load64_splat" ],
    [ 0x0b, "v128.store" ],
    [ 0x0c, "v128.const" ],
    [ 0x0d, "i8x16.shuffle" ],
    [ 0x0e, "i8x16.swizzle" ],
    [ 0x0f, "i8x16.splat" ],
    [ 0x10, "i16x8.splat" ],
    [ 0x11, "i32x4.splat" ],
    [ 0x12, "i64x2.splat" ],
    [ 0x13, "f32x4.splat" ],
    [ 0x14, "f64x2.splat" ],
    [ 0x15, "i8x16.extract_lane_s" ],
    [ 0x16, "i8x16.extract_lane_u" ],
    [ 0x17, "i8x16.replace_lane" ],
    [ 0x18, "i16x8.extract_lane_s" ],
    [ 0x19, "i16x8.extract_lane_u" ],
    [ 0x1a, "i16x8.replace_lane" ],
    [ 0x1b, "i32x4.extract_lane" ],
    [ 0x1c, "i32x4.replace_lane" ],
    [ 0x1d, "i64x2.extract_lane" ],
    [ 0x1e, "i64x2.replace_lane" ],
    [ 0x1f, "f32x4.extract_lane" ],
    [ 0x20, "f32x4.replace_lane" ],
    [ 0x21, "f64x2.extract_lane" ],
    [ 0x22, "f64x2.replace_lane" ],
    [ 0x23, "i8x16.eq" ],
    [ 0x24, "i8x16.ne" ],
    [ 0x25, "i8x16.lt_s" ],
    [ 0x26, "i8x16.lt_u" ],
    [ 0x27, "i8x16.gt_s" ],
    [ 0x28, "i8x16.gt_u" ],
    [ 0x29, "i8x16.le_s" ],
    [ 0x2a, "i8x16.le_u" ],
    [ 0x2b, "i8x16.ge_s" ],
    [ 0x2c, "i8x16.ge_u" ],
    [ 0x2d, "i16x8.eq" ],
    [ 0x2e, "i16x8.ne" ],
    [ 0x2f, "i16x8.lt_s" ],
    [ 0x30, "i16x8.lt_u" ],
    [ 0x31, "i16x8.gt_s" ],
    [ 0x32, "i16x8.gt_u" ],
    [ 0x33, "i16x8.le_s" ],
    [ 0x34, "i16x8.le_u" ],
    [ 0x35, "i16x8.ge_s" ],
    [ 0x36, "i16x8.ge_u" ],
    [ 0x37, "i32x4.eq" ],
    [ 0x38, "i32x4.ne" ],
    [ 0x39, "i32x4.lt_s" ],
    [ 0x3a, "i32x4.lt_u" ],
    [ 0x3b, "i32x4.gt_s" ],
    [ 0x3c, "i32x4.gt_u" ],
    [ 0x3d, "i32x4.le_s" ],
    [ 0x3e, "i32x4.le_u" ],
    [ 0x3f, "i32x4.ge_s" ],
    [ 0x40, "i32x4.ge_u" ],
    [ 0x41, "f32x4.eq" ],
    [ 0x42, "f32x4.ne" ],
    [ 0x43, "f32x4.lt" ],
    [ 0x44, "f32x4.gt" ],
    [ 0x45, "f32x4.le" ],
    [ 0x46, "f32x4.ge" ],
    [ 0x47, "f64x2.eq" ],
    [ 0x48, "f64x2.ne" ],
    [ 0x49, "f64x2.lt" ],
    [ 0x4a, "f64x2.gt" ],
    [ 0x4b, "f64x2.le" ],
    [ 0x4c, "f64x2.ge" ],
    [ 0x4d, "v128.not" ],
    [ 0x4e, "v128.and" ],
    [ 0x4f, "v128.andnot" ],
    [ 0x50, "v128.or" ],
    [ 0x51, "v128.xor" ],
    [ 0x52, "v128.bitselect" ],
    [ 0x53, "v128.any_true" ],
    [ 0x54, "v128.load8_lane" ],
    [ 0x55, "v128.load16_lane" ],
    [ 0x56, "v128.load32_lane" ],
    [ 0x57, "v128.load64_lane" ],
    [ 0x58, "v128.store8_lane" ],
    [ 0x59, "v128.store16_lane" ],
    [ 0x5a, "v128.store32_lane" ],
    [ 0x5b, "v128.store64_lane" ],
    [ 0x5c, "v128.load32_zero" ],
    [ 0x5d, "v128.load64_zero" ],
    [ 0x5e, "f32x4.demote_f64x2_zero" ],
    [ 0x5f, "f64x2.promote_low_f32x4" ],
    [ 0x60, "i8x16.abs" ],
    [ 0x61, "i8x16.neg" ],
    [ 0x62, "i8x16.popcnt" ],
    [ 0x63, "i8x16.all_true" ],
    [ 0x64, "i8x16.bitmask" ],
    [ 0x65, "i8x16.narrow_i16x8_s" ],
    [ 0x66, "i8x16.narrow_i16x8_u" ],
    [ 0x67, "f32x4.ceil" ],
    [ 0x68, "f32x4.floor" ],
    [ 0x69, "f32x4.trunc" ],
    [ 0x6a, "f32x4.nearest" ],
    [ 0x6b, "i8x16.shl" ],
    [ 0x6c, "i8x16.shr_s" ],
    [ 0x6d, "i8x16.shr_u" ],
    [ 0x6e, "i8x16.add" ],
    [ 0x6f, "i8x16.add_sat_s" ],
    [ 0x70, "i8x16.add_sat_u" ],
    [ 0x71, "i8x16.sub" ],
    [ 0x72, "i8x16.sub_sat_s" ],
    [ 0x73, "i8x16.sub_sat_u" ],
    [ 0x74, "f64x2.ceil" ],
    [ 0x75, "f64x2.floor" ],
    [ 0x76, "i8x16.min_s" ],
    [ 0x77, "i8x16.min_u" ],
    [ 0x78, "i8x16.max_s" ],
    [ 0x79, "i8x16.max_u" ],
    [ 0x7a, "f64x2.trunc" ],
    [ 0x7b, "i8x16.avgr_u" ],
    [ 0x7c, "i16x8.extadd_pairwise_i8x16_s" ],
    [ 0x7d, "i16x8.extadd_pairwise_i8x16_u" ],
    [ 0x7e, "i32x4.extadd_pairwise_i16x8_s" ],
    [ 0x7f, "i32x4.extadd_pairwise_i16x8_u" ],
    [ 0x80, "i16x8.abs" ],
    [ 0x81, "i16x8.neg" ],
    [ 0x82, "i16x8.q15mulr_sat_s" ],
    [ 0x83, "i16x8.all_true" ],
    [ 0x84, "i16x8.bitmask" ],
    [ 0x85, "i16x8.narrow_i32x4_s" ],
    [ 0x86, "i16x8.narrow_i32x4_u" ],
    [ 0x87, "i16x8.extend_low_i8x16_s" ],
    [ 0x88, "i16x8.extend_high_i8x16_s" ],
    [ 0x89, "i16x8.extend_low_i8x16_u" ],
    [ 0x8a, "i16x8.extend_high_i8x16_u" ],
    [ 0x8b, "i16x8.shl" ],
    [ 0x8c, "i16x8.shr_s" ],
    [ 0x8d, "i16x8.shr_u" ],
    [ 0x8e, "i16x8.add" ],
    [ 0x8f, "i16x8.add_sat_s" ],
    [ 0x90, "i16x8.add_sat_u" ],
    [ 0x91, "i16x8.sub" ],
    [ 0x92, "i16x8.sub_sat_s" ],
    [ 0x93, "i16x8.sub_sat_u" ],
    [ 0x94, "f64x2.nearest" ],
    [ 0x95, "i16x8.mul" ],
    [ 0x96, "i16x8.min_s" ],
    [ 0x97, "i16x8.min_u" ],
    [ 0x98, "i16x8.max_s" ],
    [ 0x99, "i16x8.max_u" ],
    [ 0x9b, "i16x8.avgr_u" ],
    [ 0x9c, "i16x8.extmul_low_i8x16_s" ],
    [ 0x9d, "i16x8.extmul_high_i8x16_s" ],
    [ 0x9e, "i16x8.extmul_low_i8x16_u" ],
    [ 0x9f, "i16x8.extmul_high_i8x16_u" ],
    [ 0xa0, "i32x4.abs" ],
    [ 0xa1, "i32x4.neg" ],
    [ 0xa2, "i32x4.all_true" ],
    [ 0xa4, "i32x4.bitmask" ],
    [ 0xa7, "i32x4.extend_low_i16x8_s" ],
    [ 0xa8, "i32x4.extend_high_i16x8_s" ],
    [ 0xa9, "i32x4.extend_low_i16x8_u" ],
    [ 0xaa, "i32x4.extend_high_i16x8_u" ],
    [ 0xab, "i32x4.shl" ],
    [ 0xac, "i32x4.shr_s" ],
    [ 0xad, "i32x4.shr_u" ],
    [ 0xae, "i32x4.add" ],
    [ 0xb1, "i32x4.sub" ],
    [ 0xb5, "i32x4.mul" ],
    [ 0xb6, "i32x4.min_s" ],
    [ 0xb7, "i32x4.min_u" ],
    [ 0xb8, "i32x4.max_s" ],
    [ 0xb9, "i32x4.max_u" ],
    [ 0xba, "i32x4.dot_i16x8_s" ],
    [ 0xbc, "i32x4.extmul_low_i16x8_s" ],
    [ 0xbd, "i32x4.extmul_high_i16x8_s" ],
    [ 0xbe, "i32x4.extmul_low_i16x8_u" ],
    [ 0xbf, "i32x4.extmul_high_i16x8_u" ],
    [ 0xc0, "i64x2.abs" ],
    [ 0xc1, "i64x2.neg" ],
    [ 0xc3, "i64x2.all_true" ],
    [ 0xc4, "i64x2.bitmask" ],
    [ 0xc7, "i64x2.extend_low_i32x4_s" ],
    [ 0xc8, "i64x2.extend_high_i32x4_s" ],
    [ 0xc9, "i64x2.extend_low_i32x4_u" ],
    [ 0xca, "i64x2.extend_high_i32x4_u" ],
    [ 0xcb, "i64x2.shl" ],
    [ 0xcc, "i64x2.shr_s" ],
    [ 0xcd, "i64x2.shr_u" ],
    [ 0xce, "i64x2.add" ],
    [ 0xd1, "i64x2.sub" ],
    [ 0xd5, "i64x2.mul" ],
    [ 0xd6, "i64x2.eq" ],
    [ 0xd7, "i64x2.ne" ],
    [ 0xd8, "i64x2.lt_s" ],
    [ 0xd9, "i64x2.gt_s" ],
    [ 0xda, "i64x2.le_s" ],
    [ 0xdb, "i64x2.ge_s" ],
    [ 0xdc, "i64x2.extmul_low_i32x4_s" ],
    [ 0xdd, "i64x2.extmul_high_i32x4_s" ],
    [ 0xde, "i64x2.extmul_low_i32x4_u" ],
    [ 0xdf, "i64x2.extmul_high_i32x4_u" ],
    [ 0xe0, "f32x4.abs" ],
    [ 0xe1, "f32x4.neg" ],
    [ 0xe3, "f32x4.sqrt" ],
    [ 0xe4, "f32x4.add" ],
    [ 0xe5, "f32x4.sub" ],
    [ 0xe6, "f32x4.mul" ],
    [ 0xe7, "f32x4.div" ],
    [ 0xe8, "f32x4.min" ],
    [ 0xe9, "f32x4.max" ],
    [ 0xea, "f32x4.pmin" ],
    [ 0xeb, "f32x4.pmax" ],
    [ 0xec, "f64x2.abs" ],
    [ 0xed, "f64x2.neg" ],
    [ 0xef, "f64x2.sqrt" ],
    [ 0xf0, "f64x2.add" ],
    [ 0xf1, "f64x2.sub" ],
    [ 0xf2, "f64x2.mul" ],
    [ 0xf3, "f64x2.div" ],
    [ 0xf4, "f64x2.min" ],
    [ 0xf5, "f64x2.max" ],
    [ 0xf6, "f64x2.pmin" ],
    [ 0xf7, "f64x2.pmax" ],
    [ 0xf8, "i32x4.trunc_sat_f32x4_s" ],
    [ 0xf9, "i32x4.trunc_sat_f32x4_u" ],
    [ 0xfa, "f32x4.convert_i32x4_s" ],
    [ 0xfb, "f32x4.convert_i32x4_u" ],
    [ 0xfc, "i32x4.trunc_sat_f64x2_s_zero" ],
    [ 0xfd, "i32x4.trunc_sat_f64x2_u_zero" ],
    [ 0xfe, "f64x2.convert_low_i32x4_s" ],
    [ 0xff, "f64x2.convert_low_i32x4_u" ]
  ]),
  prefix_fe = new Map([
    [ 0x00, "memory.atomic.notify" ],
    [ 0x01, "memory.atomic.wait32" ],
    [ 0x02, "memory.atomic.wait64" ],
    [ 0x03, "atomic.fence" ],
    [ 0x10, "i32.atomic.load" ],
    [ 0x11, "i64.atomic.load" ],
    [ 0x12, "i32.atomic.load8_u" ],
    [ 0x13, "i32.atomic.load16_u" ],
    [ 0x14, "i64.atomic.load8_u" ],
    [ 0x15, "i64.atomic.load16_u" ],
    [ 0x16, "i64.atomic.load32_u" ],
    [ 0x17, "i32.atomic.store" ],
    [ 0x18, "i64.atomic.store" ],
    [ 0x19, "i32.atomic.store8" ],
    [ 0x1a, "i32.atomic.store16" ],
    [ 0x1b, "i64.atomic.store8" ],
    [ 0x1c, "i64.atomic.store16" ],
    [ 0x1d, "i64.atomic.store32" ],
    [ 0x1e, "i32.atomic.rmv.add" ],
    [ 0x1f, "i64.atomic.rmv.add" ],
    [ 0x20, "i32.atomic.rmv8.add_u" ],
    [ 0x21, "i32.atomic.rmv16.add_u" ],
    [ 0x22, "i64.atomic.rmv8.add_u" ],
    [ 0x23, "i64.atomic.rmv16.add_u" ],
    [ 0x24, "i64.atomic.rmv32.add_u" ],
    [ 0x25, "i32.atomic.rmv.sub" ],
    [ 0x26, "i64.atomic.rmv.sub" ],
    [ 0x27, "i32.atomic.rmv8.sub_u" ],
    [ 0x28, "i32.atomic.rmv16.sub_u" ],
    [ 0x29, "i64.atomic.rmv8.sub_u" ],
    [ 0x2a, "i64.atomic.rmv16.sub_u" ],
    [ 0x2b, "i64.atomic.rmv32.sub_u" ],
    [ 0x2c, "i32.atomic.rmv.and" ],
    [ 0x2d, "i64.atomic.rmv.and" ],
    [ 0x2e, "i32.atomic.rmv8.and_u" ],
    [ 0x2f, "i32.atomic.rmv16.and_u" ],
    [ 0x30, "i64.atomic.rmv8.and_u" ],
    [ 0x31, "i64.atomic.rmv16.and_u" ],
    [ 0x32, "i64.atomic.rmv32.and_u" ],
    [ 0x33, "i32.atomic.rmv.or" ],
    [ 0x34, "i64.atomic.rmv.or" ],
    [ 0x35, "i32.atomic.rmv8.or_u" ],
    [ 0x36, "i32.atomic.rmv16.or_u" ],
    [ 0x37, "i64.atomic.rmv8.or_u" ],
    [ 0x38, "i64.atomic.rmv16.or_u" ],
    [ 0x39, "i64.atomic.rmv32.or_u" ],
    [ 0x3a, "i32.atomic.rmv.xor" ],
    [ 0x3b, "i64.atomic.rmv.xor" ],
    [ 0x3c, "i32.atomic.rmv8.xor_u" ],
    [ 0x3d, "i32.atomic.rmv16.xor_u" ],
    [ 0x3e, "i64.atomic.rmv8.xor_u" ],
    [ 0x3f, "i64.atomic.rmv16.xor_u" ],
    [ 0x40, "i64.atomic.rmv32.xor_u" ],
    [ 0x41, "i32.atomic.rmv.xchg" ],
    [ 0x42, "i64.atomic.rmv.xchg" ],
    [ 0x43, "i32.atomic.rmv8.xchg_u" ],
    [ 0x44, "i32.atomic.rmv16.xchg_u" ],
    [ 0x45, "i64.atomic.rmv8.xchg_u" ],
    [ 0x46, "i64.atomic.rmv16.xchg_u" ],
    [ 0x47, "i64.atomic.rmv32.xchg_u" ],
    [ 0x48, "i32.atomic.rmv.cmpxchg" ],
    [ 0x49, "i64.atomic.rmv.cmpxchg" ],
    [ 0x4a, "i32.atomic.rmv8.cmpxchg_u" ],
    [ 0x4b, "i32.atomic.rmv16.cmpxchg_u" ],
    [ 0x4c, "i64.atomic.rmv8.cmpxchg_u" ],
    [ 0x4d, "i64.atomic.rmv16.cmpxchg_u" ],
    [ 0x4e, "i64.atomic.rmv32.cmpxchg_u" ]
  ]);


// Linear bytecode textual representation

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
    case t.float64:
    case t.vec128: return n.v.toString(10)
    case t.varint7: return readVarInt7(n.v).toString(10)
    case t.type: switch (n.v) {
      case -1:    return 'i32'
      case -2:    return 'i64'
      case -3:    return 'f32'
      case -4:    return 'f64'
      case -5:    return 'v128'
      case -0x10: return 'extern'
      case -0x20: return 'func'
      case -0x40: return 'void'
      default: throw new Error('unexpected type ' + n.t.toString())
    }
    default: throw new Error('unexpected imm ' + n.t.toString())
  }
}
// Either uint8 (uint8, VarUint32) -> string
function getOpcode (p, v) {
  switch (p) {
    case undefined: return opcodes.get(v);
    case 0xfc: return prefix_fc.get(v);
    case 0xfd: return prefix_fd.get(v);
    case 0xfe: return prefix_fe.get(v)
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
      return c.writeln(depth, getOpcode(n.p, n.v))
    case t.instr_imm1:
      return c.writeln(depth, getOpcode(n.p, n.v) + " " + fmtimm(n.imm))
    case t.instr_pre:
      visitOps(n.pre, c, depth);
      return c.writeln(depth, getOpcode(n.p, n.v))
    case t.instr_pre1:
      visitOp(n.pre, c, depth);
      return c.writeln(depth, getOpcode(n.p, n.v))
    case t.instr_imm1_post:
      c.writeln(depth, getOpcode(n.p, n.v) + " " + fmtimm(n.imm));
      return visitOps(n.post, c, depth + 1)
    case t.instr_pre_imm:
      visitOps(n.pre, c, depth);
      return c.writeln(depth, getOpcode(n.p, n.v) + fmtimmv(n.imm))
    case t.instr_pre_imm_post:
      visitOps(n.pre, c, depth);
      c.writeln(depth, getOpcode(n.p, n.v) + fmtimmv(n.imm));
      visitOps(n.post, c, depth + 1); break;
    default: console.error("Unexpected op " + n.t.toString(),
      n.v.reduce?.((s, b) => s + b.toString(16).padStart(2, "0"), "0x") ?? n.v)
  }
}
// ([N], Writer) -> Writer string
function printCode (instructions, writer) {
  const ctx = { writeln (depth, chunk) { writer("  ".repeat(depth) + chunk + "\n") } };
  visitOps(instructions, ctx, 0)
}

export { t, c, get, sect_id, Emitter, printCode };