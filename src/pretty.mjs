import { t } from "./ast.mjs";
import { opcodeToInstr } from "./data.mjs";
const { seccodes, opcodes, prefix_fb, prefix_fc, prefix_fd, prefix_fe, opcodes_ty, opcodes_cc } = opcodeToInstr;


// Linear bytecode textual representation

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
// ([N], Ctx, number) -> IO string
function visitAll (nodes, c, depth) {
  let { atNewLine } = c;
  for (let n of nodes) {
    c.atNewLine ||= atNewLine;
    visit(n, c, depth)
  }
}
// (N, Ctx, number) -> IO string
function visit (n, c, depth) {
  // console.log(n, depth);
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
    case t.vec128: return c.write(depth, n.v.toString(10));
    case t.varint7: return c.write(depth, readVarInt7(n.v).toString(10));
    case t.type: return c.write(depth, opcodes_ty.get(n.v));
    case t.ref_type: //return visitAll(n.v, c, depth);
      c.write(depth, "(");
      c.supSp = true;
      visitAll(n.v, c, depth);
      return c.write(depth, ")", true)

    // TOOD if (c.folded) {}
    case t.instr:
      if (n.v == 0x0b /*end*/ || n.v == 0x05 /*else*/) depth--;
      return c.writeln(depth, getOpcode(n.p, n.v))
    case t.instr_imm1:
      c.writeln(depth, getOpcode(n.p, n.v))
      visit(n.imm, c, depth + 1);
      return c.atNewLine = true;
    case t.instr_pre:
      visitAll(n.pre, c, depth);
      return c.writeln(depth, getOpcode(n.p, n.v))
    case t.instr_pre1:
      visit(n.pre, c, depth);
      return c.writeln(depth, getOpcode(n.p, n.v))
    case t.instr_imm1_post:
      c.write(depth, getOpcode(n.p, n.v));
      visit(n.imm, c, depth + 1);
      c.atNewLine = true;
      return visitAll(n.post, c, depth + 1)
    case t.instr_pre_imm:
      visitAll(n.pre, c, depth);
      c.writeln(depth, getOpcode(n.p, n.v));
      visitAll(n.imm, c, depth + 1);
      return c.atNewLine = true
    case t.instr_pre_imm_post:
      visitAll(n.pre, c, depth);
      c.writeln(depth, getOpcode(n.p, n.v));
      visitAll(n.imm, c, depth + 1);
      c.atNewLine = true;
      return visitAll(n.post, c, depth + 1)
    case t.catch_clauses: return visitAll(n.v.slice(1), c, depth)
    case t.instr_catch_clause:
      c.writeln(depth, opcodes_cc.get(n.v))
      return visitAll(n.imm, c, depth)

    case t.external_kind:
      switch (n.v) {
        case 0: return c.write(depth, "external_kind.function")
        case 1: return c.write(depth, "external_kind.table")
        case 2: return c.write(depth, "external_kind.memory")
        case 3: return c.write(depth, "external_kind.global")
        case 4: return c.write(depth, "external_kind.tag")
        default: console.error("Unexpected kind " + n.v);
      }
    case t.data: throw new Error("Unimplemented") // TODO

    case t.module:
      c.writeln(depth, "(module");
      visitAll(n.v.slice(2), c, depth + 1);
      return c.writeln(depth, ")", true)
    case t.section: {
      switch (n.v[0].v) {
        case 1: // type
        for (const recGroup of n.v.slice(3))
          if (recGroup.v[0].v !== -0x32) {
            c.writeln(depth, "(type");
            visit(recGroup, c, depth + 1);
            c.write(depth, ")", true)
          } else {
            c.atNewLine = true;
            visit(recGroup, c, depth)
          }
        return
        case 2: // import
        case 4: // table
        case 6: // global
        case 7: // export
        case 9: // elem
        case 10: // code
        case 11: // data
        case 13: // tag
          c.atNewLine = true;
          return visitAll(n.v.slice(3), c, depth);
      }
      const
        v = n.v.slice(n.v[0].v === 8 || n.v[0].v === 12 ? 2 : 3),
        atNewLine = n.v[0].v !== 3 && v.length > 1;
      c.writeln(depth, "(" + seccodes.get(n.v[0].v));
      c.atNewLine = atNewLine;
      visitAll(v, c, depth + 1);
      c.atNewLine ||= atNewLine;
      return c.write(depth, ")", true)
    }

    case t.import_entry: {
      c.write(depth, "(import");
      visit(n.v[0], c, depth + 1);
      visit(n.v[1], c, depth + 1);
      switch (n.v[2].v) {
        case 0: c.write(depth + 1, "(func"); break;
        case 2: c.write(depth + 1, "(memory"); break;
        case 3: c.write(depth + 1, "(global"); break;

        case 1: 
        case 4:
          visit(n.v[3], c, depth + 1);
          return c.write(depth, ")", true)
      }
      visit(n.v[3], c, depth + 2);
      c.write(depth + 1, ")", true)
      return c.write(depth, ")", true)
    }
    case t.export_entry: {
      c.write(depth, "(export");
      visit(n.v[0], c, depth);
      switch (n.v[1].v) {
        case 0: c.write(depth + 1, "(func"); break;
        case 1: c.write(depth + 1, "(table"); break;
        case 2: c.write(depth + 1, "(memory"); break;
        case 3: c.write(depth + 1, "(global"); break;
        case 4: c.write(depth + 1, "(tag"); break;
      }
      visit(n.v[2], c, depth + 2);
      c.write(depth + 1, ")", true)
      return c.write(depth, ")", true)
    }
    case t.table_entry:
      c.write(depth, "(table");
      visit(n.v[2].v[1], c, depth + 1);
      visit(n.v[2].v[0], c, depth + 1)
      visit(n.v[3], c, depth + 1);
      return c.write(depth, ")", true)
    case t.local_entry: return;
    case t.memory_type:

    case t.global_variable:
      c.write(depth, "(global");
      visitAll(n.v, c, depth + 1);
      return c.write(depth, ")", true)
    case t.elem_segment: {
      c.write(depth, "(elem");
      if (n.v[0].v & 4) visit(n.v[1], c, depth + 1);
      switch (n.v[0].v & 3) {
        // Active
        case 2:
          c.write(depth + 1, "(table");
          visit(n.v[1], c, depth + 2);
          c.write(depth + 1, ")", true);
        case 0:
          const hasTableIndex = n.v[0].v & 2;
          c.write(depth, "(");
          c.supSp = true;
          visit(n.v[1 + hasTableIndex], c, depth + 1);
          c.write(depth, ")", true)
          visitAll(n.v.slice(3 + hasTableIndex), c, depth + 1);
          break;
        // Declared
        case 3: c.write(depth + 1, "declare");
        // Passive
        case 1: visitAll(n.v.slice(3), c, depth + 1);
      }
      return c.write(depth, ")", true)
    }
    case t.data_segment: {
      c.writeln(depth, "(data");
      switch (n.v[0].v) {
        case 0: visitAll(n.v.slice(1), c, depth + 1); break;
        case 1: visit(n.v[1], c, depth + 1); break;
        case 2:
          c.write(depth + 1, "(memory");
          visitAll(n.v, c, depth + 2);
          c.write(depth + 1, ")", true)
          visitAll(n.v.slice(2), c, depth + 1); break;
      }
      c.write(depth, ")", true);
      return c.atNewLine = true
    }
    case t.init_expr:
      visitAll(n.v.slice(0, -1), c, depth);
      return c.atNewLine = true
    case t.function_body: {
      let locals = [];
      const lnum = n.v[1].v, v = n.v.slice(lnum + 2, -1);
      for (let i = 2; i < lnum + 2; i++)
        locals = locals.concat(Array(n.v[i].v[0].v).fill(n.v[i].v[1]));
      c.writeln(depth, "(func");
      if (locals.length > 0) {
        c.write(depth + 1, "(local");
        visitAll(locals, c, depth + 2);
        c.write(depth + 1, ")", true)
      }
      c.atNewLine = true;
      visitAll(v, c, depth + 1);
      return c.writeln(depth, ")", true)
    }
    case t.elem_expr:
      c.write(depth, "(item");
      visit(n.v[0], c, depth + 1);
      return c.write(depth, ")", true)

    case t.global_type:
      if (n.v[1].v === 1) {
        c.write(depth, "(mut");
        visit(n.v[0], c, depth + 1);
        return c.write(depth, ")", true)
      } else return visit(n.v[0], c, depth)
    case t.tag_type:
      c.write(depth, "(tag");
      visit(n.v[1], c, depth + 1);
      return c.write(depth, ")", true)
    case t.table_type:
      c.write(depth, "(table");
      visit(n.v[1], c, depth + 1);
      visit(n.v[0], c, depth + 1)
      return c.write(depth, ")", true)
    case t.resizable_limits:
      return c.write(depth, `${n.v[0].v & 4 ? "i64 " : ""}${
        n.v[1].v}${n.v[0].v & 1 ? " " + n.v[2].v : ''}${n.v[0].v & 2 ? " shared" : ""}`)

    case t.comp_type:
      switch (n.v[0].v) {
        case -0x20: return visit(n.v[1], c, depth)
        case -0x21:
          c.write(depth, "(struct");
          visitAll(n.v.slice(2), c, depth + 1);
          return c.write(depth, ")", true)
        case -0x22:
          c.write(depth, "(array");
          visitAll(n.v.slice(1), c, depth + 1);
          return c.write(depth, ")", true)
      }
    case t.func_type: {
      const plen = n.v[0].v;
      c.write(depth, "(func");
      if (plen > 0) {
        c.write(depth, "(param");
        visitAll(n.v.slice(1, plen + 1), c, depth + 1)
        c.write(depth, ")", true)
      }
      if (n.v[plen + 1].v > 0) {
        c.write(depth, "(result");
        visitAll(n.v.slice(plen + 2), c, depth + 1)
        c.write(depth, ")", true)
      }
      return c.write(depth, ")", true)
    }
    case t.field_type:
      c.write(depth, "(field");
      if (n.v[1].v === 1) {
        c.write(depth, "(mut");
        visit(n.v[0], c, depth + 1);
        c.write(depth, ")", true)
      } else visit(n.v[0], c, depth)
      return c.write(depth, ")", true)
    case t.rec_type: {
      const atNewLine = n.v[1].v > 1;
      c.write(depth, "(rec");
      c.atNewLine = atNewLine;
      visitAll(n.v.slice(2), c, depth + 1);
      c.atNewLine = atNewLine;
      return c.write(depth, ")", true)
    }
    case t.sub_type:
      c.write(depth, "(type");
      c.write(depth + 1, "(sub" + (n.v[0].v === -0x30 ? "" : " final"));
      visitAll(n.v.slice(2, -1), c, depth + 2);
      visit(n.v.at(-1), c, depth + 2);
      c.write(depth + 1, ")", true);
      return c.write(depth, ")", true)

    case t.str:
      return c.write(depth, `"${new TextDecoder().decode(n.v)}"`)

    default: console.error("Unexpected op " + n.t,
      "0x" + (n.v.bytes?.toSpliced(0, 0, n.p).reduce((s, b) => s + b.toString(16).padStart(2, "0"), "") ?? n.v))

  }
}
// ([N], Writer) -> Writer string
function printCode (instructions, writer) {
  let atFirstLine = true;
  const ctx = {
    folded: false,
    atNewLine: true,
    supSp: false,
    writeln (depth, chunk) {
      writer((atFirstLine ? "" : "\n") + "  ".repeat(depth) + chunk);
      atFirstLine = false;
      this.atNewLine = false;
      this.supSp = false
    },
    write (depth, chunk, supSp = false) {
      this.supSp ||= supSp;
      if (this.atNewLine) this.writeln(depth, chunk);
      else {
        writer((this.supSp ? "" : " ") + chunk);
        this.atNewLine = false
      }
      this.supSp = false
    }
  };
  visitAll(instructions, ctx, 0)
}

export { printCode }