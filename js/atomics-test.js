self.onmessage = async ({ data: { module, mem, wid, timeOrigin } }) => {
  const
    timeAdj = performance.timeOrigin - timeOrigin,
    instance = await WebAssembly.instantiate(module, { js: { mem } });
  self.postMessage({ state: "before" });
  console.log(wid, timeAdj + performance.now());
  const result = instance.exports.run_atomic();
  if (result === 1) console.log("after", timeAdj + performance.now());
  self.postMessage({ result })
}