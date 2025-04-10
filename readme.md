Adapted from Rasmus Andersson's [WASM-Util](https://github.com/rsms/wasm-util), following the list of WebAssembly [feature extensions](https://webassembly.org/features/)

<details>
  <summary>Development plan</summary>

WebAssembly extensions

  - [x] (FF62) Mutable globals
  - [x] (FF62) Sign extension operations
  - [x] (FF64) Non-trapping float-to-int conversions
  - [x] (FF78) BigInt-to-i64 integration
  - [x] (FF78) Bulk memory operations
  - [x] (FF78) Multi-value
  - [x] (FF79) Reference types
  - [x] (FF79) Threads and atomics
  - [x] (FF89) Fixed width SIMD
  - [x] (FF100) Legacy exception handling
  - [x] (FF112) Extended constant expressions
  - [x] (FF120) Typed function references
  - [x] (FF120) Garbage collection
  - [x] (FF121) Tail calls
  - [x] (FF125) Multi-memory
  - [x] (FF131) Exception handling with exnref
  - [x] (FF134) JS string builtins
  - [ ] (FF134) Memory64
  - [ ] (?) Relaxed SIMD

Wazam features

  - [ ] WAST ↔ WASM (base on WASM-Util)
  - [ ] Design & implement my own scripting language

Other

  - [ ] Port Citizen VM language to script
</details>