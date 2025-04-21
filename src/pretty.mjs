import { t } from "./ast.mjs";
import { seccodes, opcodes, prefix_fb, prefix_fc, prefix_fd, prefix_fe, opcodes_ty, opcodes_cc } from "./data.mjs";


// Build S-expression
function sexpr (depth, c, label, innerCB, { atNewLine = false, supSp = false } = {}) {
  c.write(depth, "(" + label);
  c.atNewLine ||= atNewLine;
  c.supSp ||= supSp;
  innerCB(depth + 1, c);
  c.atNewLine ||= atNewLine;
  return c.write(depth, ")", true)
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
// ([N], Ctx, number) -> IO string
function visitAll (nodes, c, depth) {
  let { atNewLine } = c;
  for (let n of nodes) {
    c.atNewLine ||= atNewLine;
    visit(n, c, depth)
  }
}
// (N, Ctx, number) -> IO string
const exportLabels = ["func", "table", "memory", "global", "tag"];
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
    case t.ref_type: return sexpr(depth, c, "", (depth, c) => visitAll(n.v, c, depth), { supSp: true });

    // TOOD if (c.folded) {}
    case t.instr:
      if (n.v == 0x0b /*end*/ || n.v == 0x05 /*else*/) depth--;
      c.writeln(depth, getOpcode(n.p, n.v));
      return c.atNewLine = true
    case t.instr_imm1:
      c.writeln(depth, getOpcode(n.p, n.v))
      visit(n.imm, c, depth + 1);
      return c.atNewLine = true;
    case t.instr_pre:
      visitAll(n.pre, c, depth);
      c.writeln(depth, getOpcode(n.p, n.v));
      return c.atNewLine = true
    case t.instr_pre1:
      visit(n.pre, c, depth);
      c.writeln(depth, getOpcode(n.p, n.v));
      return c.atNewLine = true
    case t.instr_imm1_post:
      c.write(depth, getOpcode(n.p, n.v));
      visit(n.imm, c, depth + 1);
      c.atNewLine = true;
      visitAll(n.post, c, depth + 1);
      return c.atNewLine = true;
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
      visitAll(n.post, c, depth + 1);
      return c.atNewLine = true
    case t.catch_clauses: return visitAll(n.v.slice(1), c, depth)
    case t.instr_catch_clause:
      c.writeln(depth, opcodes_cc.get(n.v))
      visitAll(n.imm, c, depth);
      return c.atNewLine = true

    case t.data: throw new Error("Unimplemented") // TODO

    case t.module: return sexpr(depth, c, "module", (depth, c) => visitAll(n.v.slice(2), c, depth), { atNewLine: true });
    case t.section: {
      switch (n.v[0].v) {
        case 1: // type
          for (const recGroup of n.v.slice(3))
            if (recGroup.v[0].v !== -0x32) {
              c.atNewLine = true;
              sexpr(depth, c, "type", (depth, c) => {
                c.write(depth, c.indices.type++);
                visit(recGroup, c, depth)
              })
            } else {
              c.atNewLine = true;
              visit(recGroup, c, depth)
            }
          return
        case 3: // function
          c.funcOffset = c.indices.func;
          for (const i of n.v.slice(3)) c.types.push(i.v);
          return
        case 5: // memory
          for (const memEntry of n.v.slice(3))
            sexpr(depth, c, "memory", (depth, c) => {
              c.write(depth, c.indices.memory++);
              visit(memEntry, c, depth)
            });
          return
        case 12: // datacount
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
      c.atNewLine = true;
      return sexpr(depth, c, seccodes.get(n.v[0].v), (depth, c) => visitAll(v, c, depth), { atNewLine })
    }

    case t.import_entry:
      return sexpr(depth, c, "import", (depth, c) => {
        visit(n.v[0], c, depth);
        visit(n.v[1], c, depth);
        let label;
        switch (n.v[2].v) {
          case 0:
            sexpr(depth, c, "func", (depth, c) => {
              c.write(depth, c.indices.func++);
              sexpr(depth, c, "type", (depth, c) => c.write(depth, n.v[3].v))
            });
            break;
          case 2:
            sexpr(depth, c, "memory", (depth, c) => {
              c.write(depth, c.indices.memory++);
              visit(n.v[3], c, depth)
            });
            break;
          case 3:
            sexpr(depth, c, "global", (depth, c) => {
              c.write(depth, c.indices.global++);
              visit(n.v[3], c, depth)
            });
            break;
          case 1: case 4: return visit(n.v[3], c, depth)
        }
      });
    case t.export_entry:
      return sexpr(depth, c, "export", (depth, c) => {
        visit(n.v[0], c, depth);
        sexpr(depth, c, exportLabels[n.v[1].v], (depth, c) => visit(n.v[2], c, depth))
      });
    case t.table_entry:
      return sexpr(depth, c, "table", (depth, c) => {
        c.write(depth, c.indices.table++);
        visit(n.v[2].v[1], c, depth);
        visit(n.v[2].v[0], c, depth);
        visit(n.v[3], c, depth)
      });
    case t.local_entry: return;

    case t.global_variable: return sexpr(depth, c, "global", (depth, c) => {
      c.write(depth, c.indices.global++);
      visitAll(n.v, c, depth)
  });
    case t.elem_segment:
      return sexpr(depth, c, "elem", (depth, c) => {
        c.atNewLine = false;
        c.write(depth, c.indices.elem++);
        if (n.v[0].v & 4) visit(n.v[1], c, depth);
        switch (n.v[0].v & 3) {
          // Active
          case 2: sexpr(depth, c, "table", (depth, c) => visit(n.v[1], c, depth));
          case 0:
            const hasTableIndex = n.v[0].v & 2;
            c.atNewLine = !c.folded;
            sexpr(depth, c, "item", (depth, c) => visit(n.v[1 + hasTableIndex], c, depth), { supSp: true });
            c.atNewLine = false;
            visitAll(n.v.slice(3 + hasTableIndex), c, depth);
            break;
          // Declared
          case 3: c.write(depth, "declare");
          // Passive
          case 1: visitAll(n.v.slice(3), c, depth);
        }
      }, { atNewLine: !c.folded });
    case t.data_segment:
      sexpr(depth, c, "data", (depth, c) => {
        c.write(depth, c.indices.data++);
        switch (n.v[0].v) {
          case 0: visitAll(n.v.slice(1), c, depth); break;
          case 1: visit(n.v[1], c, depth); break;
          case 2:
            sexpr(depth, c, "memory", (depth, c) => visitAll(n.v, c, depth));
            visitAll(n.v.slice(2), c, depth); break;
        }
      });
      return c.atNewLine = true
    case t.init_expr:
      visitAll(n.v.slice(0, -1), c, depth);
      return c.atNewLine = true
    case t.function_body: {
      let locals = [];
      const lnum = n.v[1].v, v = n.v.slice(lnum + 2, -1);
      for (let i = 2; i < lnum + 2; i++)
        locals = locals.concat(Array(n.v[i].v[0].v).fill(n.v[i].v[1]));
      return sexpr(depth, c, "func", (depth, c) => {
        c.atNewLine = false;
        const i = c.indices.func++;
        c.write(depth, i);
        sexpr(depth, c, "type", (depth, c) => c.write(depth, c.types[i - c.funcOffset]))
        if (locals.length > 0) sexpr(depth, c, "local", (depth, c) => visitAll(locals, c, depth))
        c.atNewLine = true;
        visitAll(v, c, depth);
      }, { atNewLine: true });
    }
    case t.elem_expr: return sexpr(depth, c, "item", (depth, c) => visit(n.v[0], c, depth));

    case t.global_type:
      return n.v[1].v === 1 ?
        sexpr(depth, c, "mut", (depth, c) => visit(n.v[0], c, depth)) :
        visit(n.v[0], c, depth);
    case t.tag_type: return sexpr(depth, c, "tag", (depth, c) => {
      c.write(depth, c.indices.tag++);
      sexpr(depth, c, "type", (depth, c) => c.write(depth, n.v[1].v))
    });
    case t.table_type:
      return sexpr(depth, c, "table", (depth, c) => {
        visit(n.v[1], c, depth);
        visit(n.v[0], c, depth)
      });
    case t.resizable_limits:
      return c.write(depth, `${n.v[0].v & 4 ? "i64 " : ""}${
        n.v[1].v}${n.v[0].v & 1 ? " " + n.v[2].v : ''}${n.v[0].v & 2 ? " shared" : ""}`)

    case t.comp_type:
      switch (n.v[0].v) {
        case -0x20: return visit(n.v[1], c, depth)
        case -0x21: return sexpr(depth, c, "struct", (depth, c) => visitAll(n.v.slice(2), c, depth))
        case -0x22: return sexpr(depth, c, "array", (depth, c) => visitAll(n.v.slice(1), c, depth))
      }
    case t.func_type: {
      const plen = n.v[0].v;
      return sexpr(depth, c, "func", (depth, c) => {
        if (plen > 0) return sexpr(depth, c, "param", (depth, c) => visitAll(n.v.slice(1, plen + 1), c, depth))
        if (n.v[plen + 1].v > 0) return sexpr(depth, c, "result", (depth, c) => visitAll(n.v.slice(plen + 2), c, depth))
      })
    }
    case t.field_type:
      return sexpr(depth, c, "field", (depth, c) => {
        if (n.v[1].v === 1) sexpr(depth, c, "mut", (depth, c) => visit(n.v[0], c, depth));
        else visit(n.v[0], c, depth)
      });
    case t.rec_type: {
      const atNewLine = n.v[1].v > 1;
      return sexpr(depth, c, "rec", (depth, c) => visitAll(n.v.slice(2), c, depth), { atNewLine })
    }
    case t.sub_type:
      return sexpr(depth, c, "type", (depth, c) => {
        c.write(depth, c.indices.type++);
        sexpr(depth, c, "sub" + (n.v[0].v === -0x30 ? "" : " final"), (depth, c) => {
          visitAll(n.v.slice(2, -1), c, depth);
          visit(n.v.at(-1), c, depth);
        })
      });

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
    indices: { type: 0, func: 0, table: 0, memory: 0, global: 0, tag: 0, elem: 0, data: 0 },
    types: [],
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