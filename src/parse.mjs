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

const
  encode = (() => { const te = new TextEncoder(); return str => te.encode(str) })(),
  decode = (() => { const td = new TextDecoder(); return str => td.decode(str) })(),
  subarrEq = (ar1, ar2, offset) => ar1.every((v, i) => v === ar2[offset + i]);


class Result {  // Error handling
  static pure (v) { return new Result(r => r(v)) }  // Resolve
  static throw (e) { return new Result(({}, l) => l(e)) }  // Reject

  #thrown = false; #value = null
  #error = v => (this.#thrown = true, v)
  #join = (fn, v = this.#value) => {
    const r = this.#value = fn(v, this.#error);
    if (Result.prototype.isPrototypeOf(r)) {
      const x = r.unwrap();
      return this.#value = "ok" in x ? x.ok : this.#error(x.err)
    }
  }
  then = fn => (this.#thrown || this.#join(fn.bind(this)), this);  // On resolve
  catch = fn => (this.#thrown && (this.#thrown = false, this.#join(fn.bind(this))), this);  // On reject
  unwrap = () => ({ [ this.#thrown ? "err" : "ok" ]: this.#value });  // Await
  toPromise = () => new Promise((ok, err) => this.then(s => ok(s)).catch(e => err(e)));
  constructor (fn) { return fn.bind(this)(v => this.#join(() => v), e => this.#join(() => this.#error(e))) }
}



class ParserData {
  static identity (d) { return d.#identity() }
  static combine (d, p) { return d.#combine(p) }
  static extract (d) { return d.#value }
  #identity; #combine; #value
  constructor ({ identity, combine }) {
    const self = this;
    this.#identity = identity;
    this.#combine = combine.bind({ self, set value (v) { self.#value = v }, get value () { return self.#value } });
    this.#value = this.#identity()
  }
}

class ConstantData extends ParserData {
  constructor (k) {
    super({ identity: () => k, combine (v) { return this.self } })
  }
}

class WrappedData extends ParserData {
  constructor () {
    super({ identity: () => null, combine (v) {
      if (v !== undefined) this.value = v;
      return this.self
    } })
  }
}

class SummableData extends ParserData {
  constructor (id) {
    super({ identity: () => id, combine (v) {
      if (v !== undefined) this.value += v;
      return this.self
    } })
  }
}

class RowColData extends ParserData {
  constructor () {
    super({ identity: () => [ 1, 0 ], combine (v) {
      if (v !== undefined) {
        const [ row0, col0 ] = this.value, [ row1, col1 ] = v;
        this.value = [ row0 + row1, row1 === 0 ? col0 + col1 : col1 ]
      }
      return this.self
    } })
  }
}

class MultiData extends ParserData {
  constructor (obj) {
    super({
      identity () {
        const id = {};
        for (const k of Object.keys(obj)) id[k] = ParserData.extract(obj[k]);
        return id
      },
      combine (val) {
        const { self, value } = this;
        for (const k of Object.keys(self))
          if (val[k] !== undefined) {
            self[k] = ParserData.combine(self[k], val[k]);
            value[k] = ParserData.extract(self[k])
          }
        return self
      } 
    });
    for (const k of Object.keys(obj)) this[k] = obj[k];
    return this
  }
}

const
  // For an identity value, you only need to provide labels & source
  parserState = ({ labels, source, labelling, region, offset, rowcol, data }) => {
    labelling ??= new Uint8Array(source.length);
    const dataObj = new MultiData({
      // Label number => label name mapping
      labels: new ConstantData(labels),
      // Uint8Array
      source: new ConstantData(source),
      // String space region labelling @Uint8Array
      labelling: ParserData.combine(new WrappedData(), labelling),
      // Current labelling (number)
      region: ParserData.combine(new WrappedData(), region),
      // Current parsing location
      offset: ParserData.combine(new SummableData(0), offset),
      // String space [ row, column ] value
      rowcol: ParserData.combine(new RowColData(), rowcol),
      // Any state data
      data: ParserData.prototype.isPrototypeOf(data) ? data : new WrappedData(),
    });
    dataObj.getChar = function () { return ParserData.extract(dataObj.source)[ParserData.extract(dataObj.offset)] };
    dataObj.clone = function () {
      let { labels, source, labelling, region, offset, rowcol, data } = dataObj;
      return parserState({
        labels: ParserData.extract(labels), source: ParserData.extract(source).slice(),
        labelling: ParserData.extract(labelling).slice(), region: ParserData.extract(region),
        offset: ParserData.extract(offset), rowcol: ParserData.extract(rowcol).slice(),
        data: ParserData.extract(data)
      })
    }
    return dataObj
  };

class Parser {

  // Positive introduction
  static any (state) { return new Result((ok, err) => {
    const stateVal = ParserData.extract(state), { source, offset } = stateVal;
    if (source.length <= offset) return err("Any char");
    else {
      const { labelling, region } = stateVal, char = state.getChar();
      ParserData.combine(state, {
        labelling: labelling.with(region ?? 0, offset),
        offset: 1,
        rowcol: char === 10 || subarrEq([13, 10], source, offset) ? [ 1, 1 ] : [ 0, 1 ],
        data: char,
      });
      return ok(state)
    }
  }) }

  // Negative introduction
  static eof (state) { return new Result((ok, err) => {
    const { source, offset } = ParserData.extract(state);
    return source.length > offset ? err("EOF") : ok(state)
  }) }

  // As monad
  // Aka mapM
  static seq (...ps) { return s0 => ps.reduce((a, p) => a.then(p), Result.pure(s0)) }

  // Aka >>
  static reql (p1, p2) { return state => p1(state).then(s1 => p2(ParserData.combine(s1, { data: ParserData.extract(state.data) }))) }

  // Like functorial <* (but not really)
  static reqr (p1, p2) { return state => p1(state).then(s1 => p2(s1).then(s2 => ParserData.combine(s2, { data: ParserData.extract(s1.data) }))) }

  // As alternative
  // Zero-or-more recurrence
  static many (p) { return state => {
    let s0 = state;
    const data = [], loop = q => q(s0).then(s1 => {
      s0 = s1;
      data.push(ParserData.extract(s1.data));
      return loop(q)
    });
    return loop(p).catch(() => ParserData.combine(s0, { data }))
  } }

  // Predicated guard
  static satisfy (pred) { return state =>
    Parser.any(state.clone()).then((s, err) => pred(ParserData.extract(s.data)) ? s : err(state)) }
  
  // Failures and exceptions
  // Convert exception into failure
  static try (p) { return state => {
    try { return p(state) }
    catch (e) { return Result.throw(e) }
  } }

  // Convert failure into exception
  static cut (p) { return state => p(state).catch(s => { throw s }) }
  
  // Convert failure into success
  static fails (p) { return state => {
    const { ok, err } = p(state).unwrap();
    if (ok === undefined) return Result.pure(err);
    if (err === undefined) return Result.throw(ok)
  } }

  // Handle exception
  static withError (p, handler) { return state => {
    try { return p(state) }
    catch (e) { return handler(e) }
  } }

}



class WASTParser extends Parser {

  constructor () {
    super()
  }

  async run (code) {
    const state = parserState({ source: encode(code) });
    try {
      const { ok, err } =
        Parser.seq(
          Parser.many(Parser.satisfy(c => c < 91)),
          Parser.eof
        )(state).unwrap();
      if (ok) return ParserData.extract(ok.data);
      if (err) console.error(err);
    } catch (e) { throw e }
  }

}


async function parseCode (code) {
  console.log("encoded", code, encode(code));
  const parserRunner = new WASTParser(), parser = await parserRunner.run(code);
  console.log(parser);
  const mod = module([]);
  return mod
}

export { parseCode, WASTParser }