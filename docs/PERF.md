# Performance Budget & Log

**Target hardware:** Apple M3, 8 GB unified memory.

| Budget               | Limit                                            |
| -------------------- | ------------------------------------------------ |
| Frame rate           | 60 fps sustained on the globe view               |
| Process memory (RAM) | < 1.5 GB                                         |
| GPU texture memory   | < 400 MB                                         |
| Single texture size  | ≤ 4096 px on its longest side; prefer KTX2/Basis |
| Main thread          | No simulation work; the sim runs in a Web Worker |

## Rules of thumb

- Use instancing (`InstancedMesh` / drei `<Instances>`) for any object drawn more than ~20 times.
- Use KTX2 + mipmaps for every texture. Don't decode large PNG/JPEG files at runtime.
- Keep draw calls under about 300 on the globe view. Merge static geometry.
- Cap DPR at 2 (`<Canvas dpr={[1, 2]}>`). Consider adaptive DPR under load.
- Send only the state the UI needs from the worker. Move to diffs as the state grows.

## Log

| Date       | Branch          | Measurement                     | Notes                                            |
| ---------- | --------------- | ------------------------------- | ------------------------------------------------ |
| 2026-11-02 | chore/bootstrap | JS bundle 1.03 MB (280 kB gzip) | Placeholder sphere only; not yet profiled on M3. |
