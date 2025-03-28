## Design notes for WebAssembly scripting language

```
    custom "bytes"                         // custom section
    import (i32 i32) -> (i32 i32) f;       // function import
    import table {5} ext t;                // table import, externref
    import memory {1, 64} shared m;        // memory import, shared
    m[65531] = "hello";                    // data
    import mut i64 x;                      // global import, mutable
    table {2, 4} r;                        // table entry
    r[0] = [&fact, &g];                    // element, funcref
    export table {1} ext u[0] = &f;        // table export
    export import memory {1} l;            // both import and export
    export f64 y = add(x, 2.0);            // global variable
    import exception f64 err               // tag import
      // function name, function type including reference types, start, function export
    export start fn fact : (i32 v) -> (&fn, &ext) {
      i32 a;                               // local variable
      (v, b) = if(f(a, v), eqz(a)) {       // assignment, block application, function calling
        (mul(add(3), neg()), true);        // partial application, expression sequencing
      } else {
          // Comma and semicolon have same meaning, but semicolon is only used in blocks
        (add(1, mul(3, add())), false);
      };
      $outer loop(v) : i32 -> () {         // labelled block, block type
        break(*r[1]()) $outer;             // br_if, call_indirect (*r[1]\g)(v)
        $inner (b) {                       // block application for "block" instruction
          break() [$inner, $outer];        // br_table using a
        }
      };
      (&null, &null)                       // return value
    }
    export fn g: (f64 v) -> (i32) {
      try() {
        atomic i64 wait m[1] 0;            // atomic op
        atomic u64 m[0] = cast v;          // conversion op (i64.trunc64_u)
        throw(v) err;                      // throw an exception with given tag
        unreachable
      } catch (err e) {
        nop;
        rethrow(e)
      };
      lt(v, 0)
    }
    export fn h: () -> () {
      atomic notify m[1] 1;
      i64 w;
      i64x2 [x, w] = i32 m[4];             // SIMD load extend
    }
```