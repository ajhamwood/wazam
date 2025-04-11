import { t } from "./ast.mjs";
import { opcodeToInstr } from "./data.mjs";
const { opcodes, prefix_fb, prefix_fc, prefix_fd, prefix_fe, opcodes_ty, opcodes_cc } = opcodeToInstr;


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
    case t.vec128: return n.v.toString(10);
    case t.varint7: return readVarInt7(n.v).toString(10);
    case t.type: return opcodes_ty.get(n.v);
    case t.ref_type: return fmtimm(n.v[0]) + " " + fmtimm(n.v[1]);
    default: throw new Error('unexpected imm ' + n.t.toString())
  }
}
// Either uint8 (uint8, VarUint32) -> string
function getOpcode (p, v) {
  switch (p) {
    case undefined: return opcodes.get(v);
    case 0xfb: return prefix_fb.get(v.v);
    case 0xfc: return prefix_fc.get(v.v);
    case 0xfd: return prefix_fd.get(v.v);
    case 0xfe: return prefix_fe.get(v.v)
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
      return visitOps(n.post, c, depth + 1);
    case t.catch_clauses: return visitOps(n.v.slice(1), c, depth);
    case t.instr_catch_clause:
      return c.writeln(depth, opcodes_cc.get(n.v) + fmtimmv(n.imm));
    default: console.error("Unexpected op " + n.t.toString(),
      "0x" + (n.v.bytes?.toSpliced(0, 0, n.p).reduce((s, b) => s + b.toString(16).padStart(2, "0"), "") ?? n.v))
  }
}
// ([N], Writer) -> Writer string
function printCode (instructions, writer) {
  const ctx = { writeln (depth, chunk) { writer("  ".repeat(depth) + chunk + "\n") } };
  visitOps(instructions, ctx, 0)
}

export { printCode }